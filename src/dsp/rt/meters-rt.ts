import { designBiquad } from "../biquad.ts";
import { kWeightingCoeffs } from "../kweight.ts";
import { interpKernels } from "../truepeak.ts";
import { StreamBiquad } from "./biquad-rt.ts";
import { Window32, windowTruePeak } from "./limiter-rt.ts";
import { gainToDb } from "./util.ts";

const ABS_GATE = -70;
const HIST_LO = -70;
const HIST_HI = 10;
const BIN = 0.1;
const BINS = Math.round((HIST_HI - HIST_LO) / BIN) + 1;

function lufs(z: number): number {
  return z <= 1e-20 ? -Infinity : -0.691 + 10 * Math.log10(z);
}

class GatedHistogram {
  readonly count = new Float64Array(BINS);
  readonly energy = new Float64Array(BINS);
  add(loudness: number, z: number): void {
    if (!(loudness > ABS_GATE)) return;
    const i = Math.min(BINS - 1, Math.max(0, Math.round((loudness - HIST_LO) / BIN)));
    this.count[i] = (this.count[i] as number) + 1;
    this.energy[i] = (this.energy[i] as number) + z;
  }
  reset(): void {
    this.count.fill(0);
    this.energy.fill(0);
  }
  /** BS.1770-4 two-stage gate: absolute −70, then 10 LU under the mean of what passed. */
  integrated(): number {
    let n = 0;
    let e = 0;
    for (let i = 0; i < BINS; i++) {
      n += this.count[i] as number;
      e += this.energy[i] as number;
    }
    if (n === 0) return -Infinity;
    const gate = lufs(e / n) - 10;
    let n2 = 0;
    let e2 = 0;
    for (let i = 0; i < BINS; i++) {
      if (HIST_LO + i * BIN > gate) {
        n2 += this.count[i] as number;
        e2 += this.energy[i] as number;
      }
    }
    return n2 === 0 ? lufs(e / n) : lufs(e2 / n2);
  }
  /** Tech 3342 loudness range: 95th minus 10th percentile above a −20 LU relative gate. */
  range(): number {
    let n = 0;
    let e = 0;
    for (let i = 0; i < BINS; i++) {
      n += this.count[i] as number;
      e += this.energy[i] as number;
    }
    if (n < 2) return 0;
    const gate = lufs(e / n) - 20;
    const kept: number[] = [];
    let total = 0;
    for (let i = 0; i < BINS; i++) {
      if (HIST_LO + i * BIN >= gate - BIN / 2) {
        kept.push(i);
        total += this.count[i] as number;
      }
    }
    if (total < 2) return 0;
    const at = (p: number): number => {
      const target = p * (total - 1);
      let run = 0;
      for (const i of kept) {
        run += this.count[i] as number;
        if (run > target) return HIST_LO + i * BIN;
      }
      return HIST_LO + (kept[kept.length - 1] as number) * BIN;
    };
    return Math.max(0, at(0.95) - at(0.1));
  }
}

/**
 * Streaming BS.1770-4 loudness. Momentary is 400 ms, short-term 3 s, both
 * updated every 100 ms; integrated and range use 0.1 LU histograms so memory
 * stays flat over a long session.
 */
export class StreamLoudness {
  private readonly shelf = [new StreamBiquad(), new StreamBiquad()];
  private readonly hp = [new StreamBiquad(), new StreamBiquad()];
  private readonly hop: number;
  private readonly sub = new Float64Array(30);
  private subPos = 0;
  private filled = 0;
  private acc = 0;
  private accN = 0;
  private readonly integ = new GatedHistogram();
  private readonly stHist = new GatedHistogram();
  momentary = -Infinity;
  shortTerm = -Infinity;
  integrated = -Infinity;
  range = 0;
  momentaryMax = -Infinity;
  shortTermMax = -Infinity;

  constructor(sampleRate: number) {
    const k = kWeightingCoeffs(sampleRate);
    for (let c = 0; c < 2; c++) {
      (this.shelf[c] as StreamBiquad).set(k.shelf);
      (this.hp[c] as StreamBiquad).set(k.highpass);
    }
    this.hop = Math.round(0.1 * sampleRate);
  }

  reset(): void {
    for (const f of [...this.shelf, ...this.hp]) f.reset();
    this.sub.fill(0);
    this.subPos = 0;
    this.filled = 0;
    this.acc = 0;
    this.accN = 0;
    this.integ.reset();
    this.stHist.reset();
    this.momentary = this.shortTerm = this.integrated = -Infinity;
    this.range = 0;
    this.momentaryMax = this.shortTermMax = -Infinity;
  }

  process(l: Float64Array, r: Float64Array, n: number): void {
    const sl = this.shelf[0] as StreamBiquad;
    const sr = this.shelf[1] as StreamBiquad;
    const hl = this.hp[0] as StreamBiquad;
    const hr = this.hp[1] as StreamBiquad;
    for (let i = 0; i < n; i++) {
      const a = hl.tick(sl.tick(l[i] as number));
      const b = hr.tick(sr.tick(r[i] as number));
      this.acc += a * a + b * b;
      if (++this.accN === this.hop) {
        this.closeSubBlock();
      }
    }
  }

  private windowEnergy(count: number): number {
    let s = 0;
    for (let k = 0; k < count; k++) s += this.sub[(this.subPos - 1 - k + 30 * 2) % 30] as number;
    return s / count;
  }

  private closeSubBlock(): void {
    this.sub[this.subPos] = this.acc / this.hop;
    this.subPos = (this.subPos + 1) % 30;
    this.acc = 0;
    this.accN = 0;
    this.filled = Math.min(30, this.filled + 1);
    if (this.filled >= 4) {
      const z = this.windowEnergy(4);
      this.momentary = lufs(z);
      if (this.momentary > this.momentaryMax) this.momentaryMax = this.momentary;
      this.integ.add(this.momentary, z);
      this.integrated = this.integ.integrated();
    }
    if (this.filled >= 30) {
      const z = this.windowEnergy(30);
      this.shortTerm = lufs(z);
      if (this.shortTerm > this.shortTermMax) this.shortTermMax = this.shortTerm;
      this.stHist.add(this.shortTerm, z);
      this.range = this.stHist.range();
    }
  }
}

/**
 * Streaming 4× true-peak meter. Uses the same interpolator as the limiter and
 * the offline meter, with a cheap pre-check so quiet passages cost nothing.
 */
export class StreamTruePeak {
  private readonly win = [new Window32(), new Window32()];
  private readonly phases = interpKernels();
  /** Linear peak seen since the last `takeBlock()`. */
  private block = 0;
  /** Linear peak seen since reset. */
  hold = 0;
  samplePeak = 0;

  reset(): void {
    for (const w of this.win) w.reset();
    this.block = 0;
    this.hold = 0;
    this.samplePeak = 0;
  }

  process(l: Float64Array, r: Float64Array, n: number): void {
    const wl = this.win[0] as Window32;
    const wr = this.win[1] as Window32;
    for (let i = 0; i < n; i++) {
      const a = l[i] as number;
      const b = r[i] as number;
      wl.push(a);
      wr.push(b);
      const m = Math.max(a < 0 ? -a : a, b < 0 ? -b : b);
      if (m > this.samplePeak) this.samplePeak = m;
      // Inter-sample overs hide within ~12 dB of the loudest neighbour, so skip the sinc when everything is far below the peak.
      if (m >= this.hold * 0.25 || this.hold === 0) {
        const p = Math.max(windowTruePeak(wl, this.phases), windowTruePeak(wr, this.phases));
        const q = p > m ? p : m;
        if (q > this.block) this.block = q;
        if (q > this.hold) this.hold = q;
      }
    }
  }

  takeBlockDb(): number {
    const v = gainToDb(this.block);
    this.block = 0;
    return v;
  }

  get holdDb(): number {
    return gainToDb(this.hold);
  }
}

/** Exponentially-windowed stereo correlation (~300 ms). +1 mono, 0 uncorrelated, −1 out of phase. */
export class StreamCorrelation {
  private ll = 0;
  private rr = 0;
  private lr = 0;
  private readonly k: number;
  constructor(sampleRate: number) {
    this.k = Math.exp(-1 / (0.3 * sampleRate));
  }
  reset(): void {
    this.ll = this.rr = this.lr = 0;
  }
  process(l: Float64Array, r: Float64Array, n: number): void {
    let { ll, rr, lr } = this;
    const k = this.k;
    for (let i = 0; i < n; i++) {
      const a = l[i] as number;
      const b = r[i] as number;
      ll = k * ll + (1 - k) * a * a;
      rr = k * rr + (1 - k) * b * b;
      lr = k * lr + (1 - k) * a * b;
    }
    this.ll = ll;
    this.rr = rr;
    this.lr = lr;
  }
  get value(): number {
    const d = Math.sqrt(this.ll * this.rr);
    return d < 1e-14 ? 1 : Math.max(-1, Math.min(1, this.lr / d));
  }
}

/** Small-speaker monitor curve used by the console. Not a model of any speaker. */
export function smallSpeakerCoeffs(sampleRate: number) {
  return {
    hp: designBiquad("highpass", 180, 0.7, 0, sampleRate),
    lp: designBiquad("lowpass", 5500, 0.7, 0, sampleRate),
  };
}
