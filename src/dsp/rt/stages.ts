import { designBiquad } from "../biquad.ts";
import { gainReductionDb } from "../dynamics.ts";
import { bandIsActive } from "../eq.ts";
import type { BiquadCoeffs, DynamicsBand, EqBand } from "../types.ts";
import { StreamBiquad } from "./biquad-rt.ts";
import { BlockSmoother, DelayLine, dbToGain, flush, pole } from "./util.ts";
import { openAlignedSat, type AlignedSat, type SaturationMode, type SaturationOptions } from "../saturation.ts";

const SMOOTH_MS = 25;

/* ------------------------------------------------------------------ EQ */

export const MAX_BANDS = 16;

class EqSlot {
  readonly freq: BlockSmoother;
  readonly gain: BlockSmoother;
  readonly q: BlockSmoother;
  type: EqBand["type"] = "peaking";
  active = false;
  dirty = true;
  readonly a = new StreamBiquad();
  readonly b = new StreamBiquad();
  constructor(blockSeconds: number) {
    this.freq = new BlockSmoother(1000, SMOOTH_MS, blockSeconds);
    this.gain = new BlockSmoother(0, SMOOTH_MS, blockSeconds);
    this.q = new BlockSmoother(1, SMOOTH_MS, blockSeconds);
  }
}

/**
 * Minimum-phase parametric EQ with persistent filter state. Frequency, gain
 * and Q glide between blocks, so dragging a knob does not zipper. A band that
 * is off is skipped, and its state is cleared so it cannot ring when it returns.
 */
export type BandSnap = { type: EqBand["type"]; freq: number; gainDb: number; q: number };

export class EqStage {
  private readonly slots: EqSlot[] = [];
  private target: "stereo" | "mid" | "side" = "stereo";
  /** Bumps whenever the realised curve may have changed. The linear-phase stage redesigns on a new version. */
  version = 0;
  private readonly sampleRate: number;

  constructor(sampleRate: number, blockSeconds: number) {
    this.sampleRate = sampleRate;
    for (let i = 0; i < MAX_BANDS; i++) this.slots.push(new EqSlot(blockSeconds));
  }

  get targetChannel(): "stereo" | "mid" | "side" {
    return this.target;
  }

  /** Current (smoothed) parameters of every active band, written into `out`. Returns the count. */
  snapshot(out: BandSnap[]): number {
    let n = 0;
    for (const s of this.slots) {
      if (!s.active) continue;
      const o = out[n] as BandSnap;
      o.type = s.type;
      o.freq = s.freq.value;
      o.gainDb = s.gain.value;
      o.q = s.q.value;
      n++;
    }
    return n;
  }

  set(bands: EqBand[], target: "stereo" | "mid" | "side"): void {
    this.version++;
    if (target !== this.target) {
      this.target = target;
      for (const s of this.slots) {
        s.a.reset();
        s.b.reset();
      }
    }
    for (let i = 0; i < MAX_BANDS; i++) {
      const slot = this.slots[i] as EqSlot;
      const band = bands[i];
      const active = band ? bandIsActive(band) : false;
      if (band && active) {
        if (!slot.active) {
          slot.freq.snap(band.freq);
          slot.gain.snap(band.gainDb);
          slot.q.snap(band.q);
          slot.a.reset();
          slot.b.reset();
          slot.dirty = true;
        }
        if (slot.type !== band.type) {
          slot.type = band.type;
          slot.dirty = true;
        }
        slot.freq.target = band.freq;
        slot.gain.target = band.gainDb;
        slot.q.target = band.q;
      }
      slot.active = active;
    }
  }

  reset(): void {
    for (const s of this.slots) {
      s.a.reset();
      s.b.reset();
    }
  }

  /** Jump every smoother to its target (used when loading a preset or building an offline render). */
  snap(): void {
    for (const s of this.slots) {
      s.freq.snap(s.freq.target);
      s.gain.snap(s.gain.target);
      s.q.snap(s.q.target);
      s.dirty = true;
    }
  }

  process(l: Float64Array, r: Float64Array, n: number): void {
    let any = false;
    for (const s of this.slots) {
      if (!s.active) continue;
      any = true;
      const freqMoved = s.freq.step();
      const gainMoved = s.gain.step();
      const qMoved = s.q.step();
      const moved = freqMoved || gainMoved || qMoved;
      if (moved || s.dirty) {
        this.version++;
        const c: BiquadCoeffs = designBiquad(s.type, s.freq.value, s.q.value, s.gain.value, this.sampleRate);
        s.a.set(c);
        s.b.set(c);
        s.dirty = false;
      }
    }
    if (!any) return;
    if (this.target === "stereo") {
      for (const s of this.slots) {
        if (!s.active) continue;
        s.a.block(l, n);
        s.b.block(r, n);
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      const a = l[i] as number;
      const b = r[i] as number;
      l[i] = (a + b) * 0.5;
      r[i] = (a - b) * 0.5;
    }
    const ch = this.target === "mid" ? l : r;
    for (const s of this.slots) {
      if (!s.active) continue;
      (this.target === "mid" ? s.a : s.b).block(ch, n);
    }
    for (let i = 0; i < n; i++) {
      const m = l[i] as number;
      const s = r[i] as number;
      l[i] = m + s;
      r[i] = m - s;
    }
  }
}

/* ------------------------------------------------------- Compressor */

/**
 * Stereo-linked feedforward compressor. Same detector and gain computer as
 * the offline renderer, so a block-split run reproduces it to rounding error.
 */
export class Compressor {
  private env = 0;
  private atk: number;
  private rel: number;
  private readonly thr: BlockSmoother;
  private readonly ratio: BlockSmoother;
  private readonly makeup: BlockSmoother;
  private knee = 0;
  /** Largest gain reduction in the last block, positive dB. */
  reductionDb = 0;

  private readonly sampleRate: number;

  constructor(sampleRate: number, blockSeconds: number, p: DynamicsBand) {
    this.sampleRate = sampleRate;
    this.thr = new BlockSmoother(p.thresholdDb, SMOOTH_MS, blockSeconds);
    this.ratio = new BlockSmoother(p.ratio, SMOOTH_MS, blockSeconds);
    this.makeup = new BlockSmoother(p.makeupDb, SMOOTH_MS, blockSeconds);
    this.atk = pole(p.attackMs, sampleRate);
    this.rel = pole(p.releaseMs, sampleRate);
    this.knee = p.kneeDb;
  }

  set(p: DynamicsBand): void {
    this.thr.target = p.thresholdDb;
    this.ratio.target = p.ratio;
    this.makeup.target = p.makeupDb;
    this.atk = pole(p.attackMs, this.sampleRate);
    this.rel = pole(p.releaseMs, this.sampleRate);
    this.knee = p.kneeDb;
  }

  reset(): void {
    this.env = 0;
    this.reductionDb = 0;
  }

  snap(): void {
    this.thr.snap(this.thr.target);
    this.ratio.snap(this.ratio.target);
    this.makeup.snap(this.makeup.target);
  }

  process(l: Float64Array, r: Float64Array, n: number): void {
    this.thr.step();
    this.ratio.step();
    this.makeup.step();
    const thr = this.thr.value;
    const ratio = this.ratio.value;
    const makeup = dbToGain(this.makeup.value);
    const { atk, rel, knee } = this;
    let env = this.env;
    let maxGr = 0;
    for (let i = 0; i < n; i++) {
      const a = l[i] as number;
      const b = r[i] as number;
      const det = Math.max(a < 0 ? -a : a, b < 0 ? -b : b);
      const c = det > env ? atk : rel;
      env = c * env + (1 - c) * det;
      const gr = gainReductionDb(20 * Math.log10(env + 1e-12), thr, ratio, knee);
      if (gr > maxGr) maxGr = gr;
      const g = dbToGain(-gr) * makeup;
      l[i] = a * g;
      r[i] = b * g;
    }
    this.env = flush(env);
    this.reductionDb = maxGr;
  }
}

/* ------------------------------------------------ Dynamic band cut */

class BandCutChannel {
  readonly bp = new StreamBiquad();
  env = 0;
  reset(): void {
    this.bp.reset();
    this.env = 0;
  }
}

export type DynBandParams = {
  freq: number;
  q: number;
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  maxCutDb: number;
};

/** Split-band dynamic cut (dynamic EQ and de-esser). Bandpass is scaled down only while it is loud. */
export class DynBandStage {
  private readonly ch = [new BandCutChannel(), new BandCutChannel()];
  private p: DynBandParams;
  private atk: number;
  private rel: number;
  private readonly freq: BlockSmoother;
  private readonly thr: BlockSmoother;
  private readonly maxCut: BlockSmoother;
  private dirty = true;
  reductionDb = 0;
  /** Block-sized scratch for the band signal. */
  private readonly band: Float64Array;

  private readonly sampleRate: number;

  constructor(sampleRate: number, blockSeconds: number, maxBlock: number, p: DynBandParams) {
    this.sampleRate = sampleRate;
    this.p = p;
    this.atk = pole(p.attackMs, sampleRate);
    this.rel = pole(p.releaseMs, sampleRate);
    this.freq = new BlockSmoother(p.freq, SMOOTH_MS, blockSeconds);
    this.thr = new BlockSmoother(p.thresholdDb, SMOOTH_MS, blockSeconds);
    this.maxCut = new BlockSmoother(p.maxCutDb, SMOOTH_MS, blockSeconds);
    this.band = new Float64Array(maxBlock);
  }

  set(p: DynBandParams): void {
    if (p.q !== this.p.q) this.dirty = true;
    this.p = p;
    this.atk = pole(p.attackMs, this.sampleRate);
    this.rel = pole(p.releaseMs, this.sampleRate);
    this.freq.target = p.freq;
    this.thr.target = p.thresholdDb;
    this.maxCut.target = p.maxCutDb;
  }

  reset(): void {
    for (const c of this.ch) c.reset();
    this.reductionDb = 0;
  }

  snap(): void {
    this.freq.snap(this.freq.target);
    this.thr.snap(this.thr.target);
    this.maxCut.snap(this.maxCut.target);
    this.dirty = true;
  }

  private runChannel(c: BandCutChannel, x: Float64Array, n: number, thr: number, floor: number): number {
    const band = this.band;
    for (let i = 0; i < n; i++) band[i] = x[i] as number;
    c.bp.block(band, n);
    let env = c.env;
    let minDepth = 1;
    const { atk, rel } = this;
    const ratio = this.p.ratio;
    for (let i = 0; i < n; i++) {
      const bi = band[i] as number;
      const det = bi < 0 ? -bi : bi;
      const k = det > env ? atk : rel;
      env = k * env + (1 - k) * det;
      const gr = gainReductionDb(20 * Math.log10(env + 1e-12), thr, ratio, 0);
      const depth = Math.max(floor, dbToGain(-gr));
      if (depth < minDepth) minDepth = depth;
      x[i] = (x[i] as number) + (depth - 1) * bi;
    }
    c.env = flush(env);
    return minDepth;
  }

  process(l: Float64Array, r: Float64Array, n: number): void {
    const moved = this.freq.step();
    this.thr.step();
    this.maxCut.step();
    if (moved || this.dirty) {
      const c = designBiquad("bandpass", this.freq.value, this.p.q, 0, this.sampleRate);
      this.ch[0]?.bp.set(c);
      this.ch[1]?.bp.set(c);
      this.dirty = false;
    }
    const floor = dbToGain(-Math.max(0, this.maxCut.value));
    const a = this.runChannel(this.ch[0] as BandCutChannel, l, n, this.thr.value, floor);
    const b = this.runChannel(this.ch[1] as BandCutChannel, r, n, this.thr.value, floor);
    this.reductionDb = -20 * Math.log10(Math.min(a, b));
  }
}

/* ---------------------------------------------------- Multiband */

class LR4 {
  readonly s1 = new StreamBiquad();
  readonly s2 = new StreamBiquad();
  set(kind: "lowpass" | "highpass", freq: number, sampleRate: number): void {
    const c = designBiquad(kind, freq, Math.SQRT1_2, 0, sampleRate);
    this.s1.set(c);
    this.s2.set(c);
  }
  block(x: Float64Array, n: number): void {
    this.s1.block(x, n);
    this.s2.block(x, n);
  }
  reset(): void {
    this.s1.reset();
    this.s2.reset();
  }
}

class SplitChannel {
  readonly lowLp = new LR4();
  readonly lowHp = new LR4();
  readonly highLp = new LR4();
  readonly highHp = new LR4();
  readonly apLp = new LR4();
  readonly apHp = new LR4();
  readonly low: Float64Array;
  readonly mid: Float64Array;
  readonly high: Float64Array;
  readonly tmp: Float64Array;
  constructor(maxBlock: number) {
    this.low = new Float64Array(maxBlock);
    this.mid = new Float64Array(maxBlock);
    this.high = new Float64Array(maxBlock);
    this.tmp = new Float64Array(maxBlock);
  }
  reset(): void {
    for (const f of [this.lowLp, this.lowHp, this.highLp, this.highHp, this.apLp, this.apHp]) f.reset();
  }
  /** Linkwitz–Riley 4th-order three-band split. Low is all-passed at the upper crossover so the sum is flat. */
  split(x: Float64Array, n: number): void {
    const { low, mid, high, tmp } = this;
    for (let i = 0; i < n; i++) {
      low[i] = x[i] as number;
      tmp[i] = x[i] as number;
    }
    this.lowLp.block(low, n);
    this.lowHp.block(tmp, n); // tmp = first.high
    for (let i = 0; i < n; i++) {
      mid[i] = tmp[i] as number;
      high[i] = tmp[i] as number;
    }
    this.highLp.block(mid, n);
    this.highHp.block(high, n);
    for (let i = 0; i < n; i++) tmp[i] = low[i] as number;
    this.apLp.block(low, n);
    this.apHp.block(tmp, n);
    for (let i = 0; i < n; i++) low[i] = (low[i] as number) + (tmp[i] as number);
  }
}

export class MultibandStage {
  private readonly left: SplitChannel;
  private readonly right: SplitChannel;
  readonly comps: [Compressor, Compressor, Compressor];
  private readonly lowHz: BlockSmoother;
  private readonly highHz: BlockSmoother;
  private dirty = true;

  private readonly sampleRate: number;

  constructor(
    sampleRate: number,
    blockSeconds: number,
    maxBlock: number,
    p: { lowHz: number; highHz: number; low: DynamicsBand; mid: DynamicsBand; high: DynamicsBand },
  ) {
    this.sampleRate = sampleRate;
    this.left = new SplitChannel(maxBlock);
    this.right = new SplitChannel(maxBlock);
    this.comps = [
      new Compressor(sampleRate, blockSeconds, p.low),
      new Compressor(sampleRate, blockSeconds, p.mid),
      new Compressor(sampleRate, blockSeconds, p.high),
    ];
    this.lowHz = new BlockSmoother(p.lowHz, SMOOTH_MS, blockSeconds);
    this.highHz = new BlockSmoother(p.highHz, SMOOTH_MS, blockSeconds);
  }

  set(p: { lowHz: number; highHz: number; low: DynamicsBand; mid: DynamicsBand; high: DynamicsBand }): void {
    this.lowHz.target = p.lowHz;
    this.highHz.target = p.highHz;
    this.comps[0].set(p.low);
    this.comps[1].set(p.mid);
    this.comps[2].set(p.high);
  }

  reset(): void {
    this.left.reset();
    this.right.reset();
    for (const c of this.comps) c.reset();
    this.dirty = true;
  }

  snap(): void {
    this.lowHz.snap(this.lowHz.target);
    this.highHz.snap(this.highHz.target);
    for (const c of this.comps) c.snap();
    this.dirty = true;
  }

  process(l: Float64Array, r: Float64Array, n: number): void {
    const lowMoved = this.lowHz.step();
    const highMoved = this.highHz.step();
    const moved = lowMoved || highMoved;
    if (moved || this.dirty) {
      const lo = this.lowHz.value;
      const hi = Math.max(lo * 1.5, this.highHz.value);
      for (const c of [this.left, this.right]) {
        c.lowLp.set("lowpass", lo, this.sampleRate);
        c.lowHp.set("highpass", lo, this.sampleRate);
        c.highLp.set("lowpass", hi, this.sampleRate);
        c.highHp.set("highpass", hi, this.sampleRate);
        c.apLp.set("lowpass", hi, this.sampleRate);
        c.apHp.set("highpass", hi, this.sampleRate);
      }
      this.dirty = false;
    }
    this.left.split(l, n);
    this.right.split(r, n);
    this.comps[0].process(this.left.low, this.right.low, n);
    this.comps[1].process(this.left.mid, this.right.mid, n);
    this.comps[2].process(this.left.high, this.right.high, n);
    for (let i = 0; i < n; i++) {
      l[i] = (this.left.low[i] as number) + (this.left.mid[i] as number) + (this.left.high[i] as number);
      r[i] = (this.right.low[i] as number) + (this.right.mid[i] as number) + (this.right.high[i] as number);
    }
  }
}

/* ---------------------------------------------------- Transients */

class TransientChannel {
  fast = 0;
  slow = 0;
}

export class TransientStage {
  private readonly ch = [new TransientChannel(), new TransientChannel()];
  private readonly fastA: number;
  private readonly fastR: number;
  private readonly slowA: number;
  private readonly slowR: number;
  private readonly attack: BlockSmoother;
  private readonly sustain: BlockSmoother;

  constructor(sampleRate: number, blockSeconds: number, attack: number, sustain: number) {
    this.fastA = Math.exp(-1 / (sampleRate * 0.0008));
    this.fastR = Math.exp(-1 / (sampleRate * 0.03));
    this.slowA = Math.exp(-1 / (sampleRate * 0.025));
    this.slowR = Math.exp(-1 / (sampleRate * 0.25));
    this.attack = new BlockSmoother(attack, SMOOTH_MS, blockSeconds);
    this.sustain = new BlockSmoother(sustain, SMOOTH_MS, blockSeconds);
  }

  set(attack: number, sustain: number): void {
    this.attack.target = attack;
    this.sustain.target = sustain;
  }

  reset(): void {
    for (const c of this.ch) {
      c.fast = 0;
      c.slow = 0;
    }
  }

  snap(): void {
    this.attack.snap(this.attack.target);
    this.sustain.snap(this.sustain.target);
  }

  private run(c: TransientChannel, x: Float64Array, n: number, attack: number, sustain: number): void {
    let { fast, slow } = c;
    const { fastA, fastR, slowA, slowR } = this;
    for (let i = 0; i < n; i++) {
      const v = x[i] as number;
      const a = v < 0 ? -v : v;
      fast = a > fast ? fastA * fast + (1 - fastA) * a : fastR * fast + (1 - fastR) * a;
      slow = a > slow ? slowA * slow + (1 - slowA) * a : slowR * slow + (1 - slowR) * a;
      const trans = Math.max(0, fast - slow) / (fast + 1e-9);
      const body = slow / (fast + 1e-9);
      const g = 1 + attack * trans * 1.4 + sustain * Math.min(1, body) * 0.85;
      x[i] = v * Math.max(0, g);
    }
    c.fast = flush(fast);
    c.slow = flush(slow);
  }

  process(l: Float64Array, r: Float64Array, n: number): void {
    this.attack.step();
    this.sustain.step();
    this.run(this.ch[0] as TransientChannel, l, n, this.attack.value, this.sustain.value);
    this.run(this.ch[1] as TransientChannel, r, n, this.attack.value, this.sustain.value);
  }
}

/* ------------------------------------------------------ Saturation */

/**
 * Shared 8× stateful tape/tube/hybrid model with an aligned dry path.
 * The dry signal is delayed by the oversampler's latency so the blend does not comb.
 * `latency` is constant whether the stage is on or off, and the enable fade is
 * counted in samples, so the result does not depend on the block size.
 */
export class SaturationStage {
  static readonly latency = 16;
  private readonly dry = [new DelayLine(16), new DelayLine(16)];
  private readonly sampleRate: number;
  private config: { mode: SaturationMode; driveDb: number; mix: number; options: SaturationOptions };
  private active: { l: AlignedSat; r: AlignedSat; mix: number };
  private pending: { l: AlignedSat; r: AlignedSat; mix: number } | null = null;
  private transition = 0;
  private enabled = false;
  private wet = 0;
  private readonly wetStep: number;

  constructor(sampleRate: number, _blockSeconds: number, driveDb: number, mix: number) {
    this.sampleRate = sampleRate;
    this.config = { mode: "tape", driveDb, mix, options: {} };
    this.active = this.makePair();
    this.wetStep = 1 / Math.max(1, 0.012 * sampleRate);
  }

  private makePair() {
    const { mode, driveDb, mix, options } = this.config;
    return {
      l: openAlignedSat(this.sampleRate, mode, driveDb, 1, options),
      r: openAlignedSat(this.sampleRate, mode, driveDb, 1, options),
      mix: Math.max(0, Math.min(1, mix)),
    };
  }

  set(enabled: boolean, mode: SaturationMode, driveDb: number, mix: number, options: SaturationOptions = {}): void {
    const config = { mode, driveDb, mix, options };
    if (JSON.stringify(config) !== JSON.stringify(this.config)) {
      this.config = config;
      this.pending = this.makePair();
      this.transition = 0;
    }
    if (enabled && !this.enabled) {
      this.active = this.makePair();
      this.pending = null;
      this.wet = 0;
    }
    this.enabled = enabled;
  }

  snap(): void {
    this.active = this.makePair();
    this.pending = null;
    this.wet = this.enabled ? 1 : 0;
  }

  reset(): void {
    this.active = this.makePair();
    this.pending = null;
    for (const d of this.dry) d.reset();
    this.wet = this.enabled ? 1 : 0;
  }

  process(l: Float64Array, r: Float64Array, n: number): void {
    const L = SaturationStage.latency;
    const d0 = this.dry[0] as DelayLine;
    const d1 = this.dry[1] as DelayLine;
    if (this.wet === 0 && !this.enabled) {
      for (let i = 0; i < n; i++) {
        l[i] = d0.tick(l[i] as number, L);
        r[i] = d1.tick(r[i] as number, L);
      }
      return;
    }
    const step = this.wetStep;
    let wet = this.wet;
    for (let i = 0; i < n; i++) {
      wet = this.enabled ? (wet + step > 1 ? 1 : wet + step) : wet - step < 0 ? 0 : wet - step;
      const xl = l[i] as number;
      const xr = r[i] as number;
      const dl = d0.tick(xl, L);
      const dr = d1.tick(xr, L);
      let sl = (this.active.l.push(xl) ?? dl) * this.active.mix + dl * (1 - this.active.mix);
      let sr = (this.active.r.push(xr) ?? dr) * this.active.mix + dr * (1 - this.active.mix);
      if (this.pending) {
        const nl = this.pending.l.push(xl);
        const nr = this.pending.r.push(xr);
        if (nl !== null && nr !== null) {
          this.transition = Math.min(1, this.transition + step);
          sl += ((nl * this.pending.mix + dl * (1 - this.pending.mix)) - sl) * this.transition;
          sr += ((nr * this.pending.mix + dr * (1 - this.pending.mix)) - sr) * this.transition;
          if (this.transition === 1) { this.active = this.pending; this.pending = null; }
        }
      }
      l[i] = dl * (1 - wet) + sl * wet;
      r[i] = dr * (1 - wet) + sr * wet;
    }
    this.wet = wet;
  }
}

/* ----------------------------------------------------------- Width */

export class WidthStage {
  private prev = 1;
  private readonly w: BlockSmoother;
  constructor(blockSeconds: number, width: number) {
    this.w = new BlockSmoother(width, SMOOTH_MS, blockSeconds);
    this.prev = width;
  }
  set(width: number): void {
    this.w.target = width;
  }
  snap(): void {
    this.w.snap(this.w.target);
    this.prev = this.w.value;
  }
  process(l: Float64Array, r: Float64Array, n: number): void {
    this.w.step();
    const from = this.prev;
    const to = this.w.value;
    this.prev = to;
    if (from === 1 && to === 1) return;
    for (let i = 0; i < n; i++) {
      const w = from + ((to - from) * (i + 1)) / n;
      const a = l[i] as number;
      const b = r[i] as number;
      const mid = (a + b) * 0.5;
      const side = (a - b) * 0.5 * w;
      l[i] = mid + side;
      r[i] = mid - side;
    }
  }
}
