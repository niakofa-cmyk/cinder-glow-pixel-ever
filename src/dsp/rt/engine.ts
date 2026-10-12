import type { ChainParams, Stereo } from "../types.ts";
import { StreamBiquad } from "./biquad-rt.ts";
import { StreamLimiter } from "./limiter-rt.ts";
import { StreamCorrelation, StreamLoudness, StreamTruePeak, smallSpeakerCoeffs } from "./meters-rt.ts";
import { SaturationStage, DynBandStage, EqStage, MultibandStage, TransientStage, WidthStage } from "./stages.ts";
import { CenterCarveStage, SerialGlueStage } from "./analog-imaging.ts";
import { LINEAR_EQ_LATENCY, LIN_P, LinearEqStage } from "./linear-eq.ts";
import { BlockSmoother, DelayLine, GainRamp, dbToGain, gainToDb } from "./util.ts";
import { neutralParams } from "../presets.ts";
import { realtimeLimitations } from "./capabilities.ts";

export type EngineSource = "original" | "processed" | "reference";
export type MonitorMode = "full" | "mono" | "small";

export type MeterFrame = {
  inMomentary: number;
  outMomentary: number;
  outShortTerm: number;
  outIntegrated: number;
  outRange: number;
  inIntegrated: number;
  outTruePeakDb: number;
  outTruePeakHoldDb: number;
  outSamplePeakDb: number;
  inTruePeakDb: number;
  limiterReductionDb: number;
  glueReductionDb: number;
  bandReductionDb: [number, number, number];
  dynEqReductionDb: number;
  deEssReductionDb: number;
  correlation: number;
  latencySamples: number;
  /** True if the engine had to recover from a non-finite sample. */
  recovered: boolean;
};

/** Fade used whenever something switches: long enough to be click-free, short enough to feel instant. */
const SWITCH_MS = 15;
const STAGE_FADE_MS = 10;

/**
 * Real-time mastering engine. One instance, one code path: playback and the
 * offline bounce both run through `process`. All buffers are allocated here;
 * `process` does not allocate.
 *
 * Latency is constant for the life of the engine (oversampler + limiter
 * lookahead), whatever is switched on, so A/B comparisons stay aligned and
 * the timeline never shifts when a module is toggled.
 */
export class RealtimeEngine {
  readonly sampleRate: number;
  readonly maxBlock: number;
  readonly latency: number;

  private params: ChainParams = neutralParams();
  private readonly blockSeconds: number;

  // chain
  private readonly inGain: BlockSmoother;
  private inGainPrev = 1;
  private readonly eq: EqStage;
  private readonly eqLin: LinearEqStage;
  private readonly eqDelay = [new DelayLine(0), new DelayLine(0)];
  private readonly eqMode = new GainRamp(0);
  /** Samples left before the linear path has real output and the crossfade may start. */
  private linWarm = 0;
  private readonly eqInL: Float64Array;
  private readonly eqInR: Float64Array;
  private readonly linL: Float64Array;
  private readonly linR: Float64Array;
  private readonly dyn: DynBandStage;
  private readonly deess: DynBandStage;
  private readonly multi: MultibandStage;
  private readonly glue: SerialGlueStage;
  private readonly carve: CenterCarveStage;
  private readonly transient: TransientStage;
  private readonly sat: SaturationStage;
  private readonly width: WidthStage;
  private readonly limiter: StreamLimiter;

  // enable ramps (one per module) and a shared dry scratch
  private readonly en: Record<"dyn" | "deess" | "multi" | "glue" | "transient" | "limiter", GainRamp>;
  private readonly dryL: Float64Array;
  private readonly dryR: Float64Array;
  private readonly wetBuf: Float64Array;

  // working buffers
  private readonly wl: Float64Array;
  private readonly wr: Float64Array;
  private readonly ol: Float64Array;
  private readonly or: Float64Array;
  private readonly rl: Float64Array;
  private readonly rr: Float64Array;

  // monitor
  private readonly origDelay = [new DelayLine(0), new DelayLine(0)];
  private readonly refDelay = [new DelayLine(0), new DelayLine(0)];
  private readonly srcGain: Record<EngineSource, GainRamp> = {
    original: new GainRamp(0),
    processed: new GainRamp(1),
    reference: new GainRamp(0),
  };
  private readonly monoAmt = new GainRamp(0);
  private readonly smallAmt = new GainRamp(0);
  private readonly smallHp = [new StreamBiquad(), new StreamBiquad()];
  private readonly smallLp = [new StreamBiquad(), new StreamBiquad()];
  private readonly matchGain = new GainRamp(1);
  private readonly master = new GainRamp(1);
  private source: EngineSource = "processed";

  // meters
  private readonly inLoud: StreamLoudness;
  private readonly outLoud: StreamLoudness;
  private readonly inPeak = new StreamTruePeak();
  private readonly outPeak = new StreamTruePeak();
  private readonly corr: StreamCorrelation;
  private readonly scope = new Float32Array(4096);
  private scopePos = 0;
  private recovered = false;

  constructor(sampleRate: number, maxBlock = 4096) {
    this.sampleRate = sampleRate;
    this.maxBlock = maxBlock;
    this.blockSeconds = 128 / sampleRate;
    const p = this.params;
    this.inGain = new BlockSmoother(1, 25, this.blockSeconds);
    this.eq = new EqStage(sampleRate, this.blockSeconds);
    this.eqLin = new LinearEqStage(sampleRate);
    this.eqDelay[0] = new DelayLine(LINEAR_EQ_LATENCY);
    this.eqDelay[1] = new DelayLine(LINEAR_EQ_LATENCY);
    this.eqInL = new Float64Array(maxBlock);
    this.eqInR = new Float64Array(maxBlock);
    this.linL = new Float64Array(maxBlock);
    this.linR = new Float64Array(maxBlock);
    this.dyn = new DynBandStage(sampleRate, this.blockSeconds, maxBlock, p.dynamicEq);
    this.deess = new DynBandStage(sampleRate, this.blockSeconds, maxBlock, p.deEss);
    this.multi = new MultibandStage(sampleRate, this.blockSeconds, maxBlock, p.multiband);
    this.glue = new SerialGlueStage(sampleRate, p.glue);
    this.carve = new CenterCarveStage(sampleRate);
    this.transient = new TransientStage(sampleRate, this.blockSeconds, 0, 0);
    this.sat = new SaturationStage(sampleRate, this.blockSeconds, p.saturation.driveDb, p.saturation.mix);
    this.width = new WidthStage(this.blockSeconds, 1);
    this.limiter = new StreamLimiter(sampleRate);
    this.latency = SaturationStage.latency + this.limiter.latency + LINEAR_EQ_LATENCY;

    this.en = {
      dyn: new GainRamp(0),
      deess: new GainRamp(0),
      multi: new GainRamp(0),
      glue: new GainRamp(0),
      transient: new GainRamp(0),
      limiter: new GainRamp(1),
    };
    this.dryL = new Float64Array(maxBlock);
    this.dryR = new Float64Array(maxBlock);
    this.wetBuf = new Float64Array(maxBlock);
    this.wl = new Float64Array(maxBlock);
    this.wr = new Float64Array(maxBlock);
    this.ol = new Float64Array(maxBlock);
    this.or = new Float64Array(maxBlock);
    this.rl = new Float64Array(maxBlock);
    this.rr = new Float64Array(maxBlock);
    this.origDelay[0] = new DelayLine(this.latency);
    this.origDelay[1] = new DelayLine(this.latency);
    this.refDelay[0] = new DelayLine(this.latency);
    this.refDelay[1] = new DelayLine(this.latency);
    this.inLoud = new StreamLoudness(sampleRate);
    this.outLoud = new StreamLoudness(sampleRate);
    this.corr = new StreamCorrelation(sampleRate);
    const sp = smallSpeakerCoeffs(sampleRate);
    for (let c = 0; c < 2; c++) {
      (this.smallHp[c] as StreamBiquad).set(sp.hp);
      (this.smallLp[c] as StreamBiquad).set(sp.lp);
    }
    this.setParams(p, true);
  }

  /* ----------------------------------------------------- control */

  setParams(p: ChainParams, immediate = false): void {
    const limitations = realtimeLimitations(p);
    if (limitations.length) throw new Error(`The offline renderer is required for ${limitations.join(", ")}.`);
    this.params = p;
    this.inGain.target = dbToGain(p.inputGainDb);
    if (immediate) {
      this.inGain.snap(dbToGain(p.inputGainDb));
      this.inGainPrev = this.inGain.value;
    }
    this.eq.set(p.bands, p.eqTarget);
    const goal = p.eqMode === "linear" ? 1 : 0;
    if (immediate) {
      this.eqMode.snap(goal);
      this.linWarm = 0;
    } else if (goal === 1 && this.eqMode.goal === 0 && this.linWarm === 0) {
      // Let the convolver produce a full hop of real output before fading it in.
      this.linWarm = 3 * LIN_P;
    } else if (goal === 0) {
      this.linWarm = 0;
      this.eqMode.setTarget(0, Math.round(0.015 * this.sampleRate));
    }
    this.dyn.set(p.dynamicEq);
    this.deess.set(p.deEss);
    this.multi.set(p.multiband);
    this.glue.set(p.glue, immediate);
    this.carve.set(p.carve, p.carveHz, immediate);
    this.transient.set(p.transient.attack, p.transient.sustain);
    this.sat.set(p.saturation.enabled && p.saturation.mix > 0.001, p.saturation.mode, p.saturation.driveDb, p.saturation.mix, {
      memory: p.saturation.memory, lowColor: p.saturation.lowColor,
      highColor: p.saturation.highColor, tubeTapeMix: p.saturation.tubeTapeMix,
    });
    this.width.set(p.width);
    this.limiter.configure(p.limiter.ceilingDb, p.limiter.releaseMs, p.limiter.lookaheadMs);
    if (immediate) {
      this.eq.snap();
      this.dyn.snap();
      this.deess.snap();
      this.multi.snap();
      this.transient.snap();
      this.sat.snap();
      this.width.snap();
    }
    const f = Math.round((STAGE_FADE_MS / 1000) * this.sampleRate);
    const flag = (r: GainRamp, on: boolean, onEnable: () => void) => {
      const goal = on ? 1 : 0;
      if (r.goal === goal) return;
      if (on && r.value === 0) onEnable();
      r.setTarget(goal, immediate ? 1 : f);
    };
    flag(this.en.dyn, p.dynamicEq.enabled, () => this.dyn.reset());
    flag(this.en.deess, p.deEss.enabled, () => this.deess.reset());
    flag(this.en.multi, p.multiband.enabled, () => this.multi.reset());
    flag(this.en.glue, p.glue.enabled, () => this.glue.reset());
    flag(
      this.en.transient,
      p.transient.enabled && (Math.abs(p.transient.attack) > 0.001 || Math.abs(p.transient.sustain) > 0.001),
      () => this.transient.reset(),
    );
    flag(this.en.limiter, p.limiter.enabled, () => undefined);
  }

  setSource(source: EngineSource, immediate = false): void {
    this.source = source;
    const f = immediate ? 1 : Math.round((SWITCH_MS / 1000) * this.sampleRate);
    (Object.keys(this.srcGain) as EngineSource[]).forEach((k) => this.srcGain[k].setTarget(k === source ? 1 : 0, f));
  }

  setMonitor(mode: MonitorMode, immediate = false): void {
    const f = immediate ? 1 : Math.round((SWITCH_MS / 1000) * this.sampleRate);
    this.monoAmt.setTarget(mode === "mono" ? 1 : 0, f);
    this.smallAmt.setTarget(mode === "small" ? 1 : 0, f);
  }

  /** Playback-only trim (loudness match). Never reaches the render. */
  setMatchGainDb(db: number, immediate = false): void {
    this.matchGain.setTarget(dbToGain(Math.max(-24, Math.min(24, db))), immediate ? 1 : Math.round(0.03 * this.sampleRate));
  }

  /** Fade the output to silence or back. Used by play, pause and seek. */
  fadeMaster(to: 0 | 1, ms = 10): void {
    this.master.setTarget(to, Math.max(1, Math.round((ms / 1000) * this.sampleRate)));
  }

  /** Cut to silence immediately (nothing is playing, so there is nothing to click). */
  silence(): void {
    this.master.snap(0);
  }

  /** Start from silence and rise, so a seek or a start never clicks. */
  fadeIn(ms = 10): void {
    this.master.snap(0);
    this.master.setTarget(1, Math.max(1, Math.round((ms / 1000) * this.sampleRate)));
  }

  get masterSettledSilent(): boolean {
    return this.master.settled && this.master.value === 0;
  }

  /** Clear every delay line, filter and envelope. Keeps the parameters. */
  reset(): void {
    this.eq.reset();
    this.eqLin.reset();
    for (const d of this.eqDelay) d.reset();
    this.dyn.reset();
    this.deess.reset();
    this.multi.reset();
    this.glue.reset();
    this.carve.reset();
    this.transient.reset();
    this.sat.reset();
    this.limiter.reset();
    for (const d of [...this.origDelay, ...this.refDelay]) d.reset();
    for (const f of [...this.smallHp, ...this.smallLp]) f.reset();
    this.corr.reset();
    this.inGainPrev = this.inGain.value;
    this.recovered = false;
  }

  resetMeters(): void {
    this.inLoud.reset();
    this.outLoud.reset();
    this.inPeak.reset();
    this.outPeak.reset();
  }

  /* ----------------------------------------------------- process */

  /** Runs one zero-latency module with a click-free enable fade around it. */
  private fadeStage(ramp: GainRamp, n: number, run: (l: Float64Array, r: Float64Array, n: number) => void): void {
    if (ramp.settled && ramp.value === 0) return;
    const { wl, wr, dryL, dryR } = this;
    if (ramp.settled && ramp.value === 1) {
      run(wl, wr, n);
      return;
    }
    dryL.set(wl.subarray(0, n));
    dryR.set(wr.subarray(0, n));
    run(wl, wr, n);
    for (let i = 0; i < n; i++) {
      const w = ramp.next();
      wl[i] = (dryL[i] as number) + w * ((wl[i] as number) - (dryL[i] as number));
      wr[i] = (dryR[i] as number) + w * ((wr[i] as number) - (dryR[i] as number));
    }
  }

  /**
   * EQ with a fixed delay in both modes. The minimum-phase path always runs
   * (it is cheap) and the linear path always listens, so switching between
   * them is a 15 ms crossfade between two correctly aligned signals.
   */
  private runEq(n: number): void {
    const { wl, wr, eqInL, eqInR, linL, linR } = this;
    eqInL.set(wl.subarray(0, n));
    eqInR.set(wr.subarray(0, n));
    this.eq.process(wl, wr, n);
    const d0 = this.eqDelay[0] as DelayLine;
    const d1 = this.eqDelay[1] as DelayLine;
    for (let i = 0; i < n; i++) {
      wl[i] = d0.tick(wl[i] as number, LINEAR_EQ_LATENCY);
      wr[i] = d1.tick(wr[i] as number, LINEAR_EQ_LATENCY);
    }
    const want = this.linWarm > 0 || !(this.eqMode.settled && this.eqMode.value === 0);
    if (this.linWarm > 0) {
      this.linWarm -= n;
      if (this.linWarm <= 0) {
        this.linWarm = 0;
        this.eqMode.setTarget(1, Math.round(0.015 * this.sampleRate));
      }
    }
    this.eqLin.update(this.eq, want);
    this.eqLin.process(eqInL, eqInR, linL, linR, n, want, this.eq.targetChannel);
    if (want) {
      for (let i = 0; i < n; i++) {
        const a = this.eqMode.next();
        wl[i] = (wl[i] as number) + a * ((linL[i] as number) - (wl[i] as number));
        wr[i] = (wr[i] as number) + a * ((linR[i] as number) - (wr[i] as number));
      }
    }
  }

  /**
   * The full chain, in place on `wl`/`wr` (first n samples are the program).
   * Output is delayed by `latency` samples.
   */
  private runChain(n: number): void {
    const { wl, wr } = this;
    const p = this.params;
    this.inGain.step();
    const g0 = this.inGainPrev;
    const g1 = this.inGain.value;
    this.inGainPrev = g1;
    if (g0 !== 1 || g1 !== 1) {
      for (let i = 0; i < n; i++) {
        const g = g0 + ((g1 - g0) * (i + 1)) / n;
        wl[i] = (wl[i] as number) * g;
        wr[i] = (wr[i] as number) * g;
      }
    }
    this.runEq(n);
    this.fadeStage(this.en.dyn, n, (l, r, m) => this.dyn.process(l, r, m));
    this.fadeStage(this.en.deess, n, (l, r, m) => this.deess.process(l, r, m));
    this.fadeStage(this.en.multi, n, (l, r, m) => this.multi.process(l, r, m));
    this.fadeStage(this.en.glue, n, (l, r, m) => this.glue.process(l, r, m));
    this.fadeStage(this.en.transient, n, (l, r, m) => this.transient.process(l, r, m));
    this.sat.process(wl, wr, n);
    this.width.process(wl, wr, n);
    this.carve.process(wl, wr, n);
    const wet = this.wetBuf;
    const ramp = this.en.limiter;
    for (let i = 0; i < n; i++) wet[i] = ramp.next();
    this.limiter.process(wl, wr, n, wet);
    void p;
  }

  /**
   * Render n frames. `prog` is the program; `ref` is the reference or null.
   * Writes the monitored signal into outL/outR (Float64, length ≥ n).
   * Sanitises non-finite input and recovers if any stage blows up.
   */
  process(
    progL: Float64Array,
    progR: Float64Array,
    refL: Float64Array | null,
    refR: Float64Array | null,
    n: number,
    outL: Float64Array,
    outR: Float64Array,
  ): void {
    if (n > this.maxBlock) {
      for (let o = 0; o < n; o += this.maxBlock) {
        const m = Math.min(this.maxBlock, n - o);
        this.process(
          progL.subarray(o, o + m),
          progR.subarray(o, o + m),
          refL ? refL.subarray(o, o + m) : null,
          refR ? refR.subarray(o, o + m) : null,
          m,
          outL.subarray(o, o + m),
          outR.subarray(o, o + m),
        );
      }
      return;
    }
    const { wl, wr, ol, or, rl, rr } = this;
    let bad = false;
    for (let i = 0; i < n; i++) {
      const a = progL[i] as number;
      const b = progR[i] as number;
      if (!Number.isFinite(a) || !Number.isFinite(b)) bad = true;
      wl[i] = Number.isFinite(a) ? a : 0;
      wr[i] = Number.isFinite(b) ? b : 0;
      ol[i] = wl[i] as number;
      or[i] = wr[i] as number;
      const c = refL ? (refL[i] as number) : 0;
      const d = refR ? (refR[i] as number) : 0;
      rl[i] = Number.isFinite(c) ? c : 0;
      rr[i] = Number.isFinite(d) ? d : 0;
    }

    this.inLoud.process(wl, wr, n);
    this.inPeak.process(wl, wr, n);
    this.runChain(n);

    let finite = !bad;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(wl[i] as number) || !Number.isFinite(wr[i] as number)) {
        finite = false;
        break;
      }
    }
    if (!finite) {
      // A stage went non-finite. Drop its state rather than let it poison the next block.
      this.reset();
      this.recovered = true;
      for (let i = 0; i < n; i++) {
        wl[i] = 0;
        wr[i] = 0;
      }
    }

    this.outLoud.process(wl, wr, n);
    this.outPeak.process(wl, wr, n);
    this.corr.process(wl, wr, n);
    for (let i = 0; i < n; i++) {
      this.scope[this.scopePos] = ((wl[i] as number) + (wr[i] as number)) * 0.5;
      this.scopePos = this.scopePos + 1 === this.scope.length ? 0 : this.scopePos + 1;
    }

    // Sources, latency-matched to the processed path.
    const gO = this.srcGain.original;
    const gP = this.srcGain.processed;
    const gR = this.srcGain.reference;
    const o0 = this.origDelay[0] as DelayLine;
    const o1 = this.origDelay[1] as DelayLine;
    const r0 = this.refDelay[0] as DelayLine;
    const r1 = this.refDelay[1] as DelayLine;
    const lat = this.latency;
    for (let i = 0; i < n; i++) {
      const go = gO.next();
      const gp = gP.next();
      const gr = gR.next();
      const dl = o0.tick(ol[i] as number, lat);
      const dr = o1.tick(or[i] as number, lat);
      const el = r0.tick(rl[i] as number, lat);
      const er = r1.tick(rr[i] as number, lat);
      wl[i] = (wl[i] as number) * gp + dl * go + el * gr;
      wr[i] = (wr[i] as number) * gp + dr * go + er * gr;
    }

    // Monitor.
    if (!(this.monoAmt.settled && this.monoAmt.value === 0)) {
      for (let i = 0; i < n; i++) {
        const k = this.monoAmt.next();
        const m = ((wl[i] as number) + (wr[i] as number)) * 0.5;
        wl[i] = (wl[i] as number) + k * (m - (wl[i] as number));
        wr[i] = (wr[i] as number) + k * (m - (wr[i] as number));
      }
    }
    if (!(this.smallAmt.settled && this.smallAmt.value === 0)) {
      const hl = this.smallHp[0] as StreamBiquad;
      const hr = this.smallHp[1] as StreamBiquad;
      const ll = this.smallLp[0] as StreamBiquad;
      const lr = this.smallLp[1] as StreamBiquad;
      for (let i = 0; i < n; i++) {
        const k = this.smallAmt.next();
        const fl = ll.tick(hl.tick(wl[i] as number));
        const fr = lr.tick(hr.tick(wr[i] as number));
        wl[i] = (wl[i] as number) + k * (fl - (wl[i] as number));
        wr[i] = (wr[i] as number) + k * (fr - (wr[i] as number));
      }
    } else {
      for (const f of [...this.smallHp, ...this.smallLp]) f.reset();
    }

    for (let i = 0; i < n; i++) {
      const g = this.matchGain.next() * this.master.next();
      outL[i] = (wl[i] as number) * g;
      outR[i] = (wr[i] as number) * g;
    }
  }

  /* ------------------------------------------------------ meters */

  meters(): MeterFrame {
    const rec = this.recovered;
    this.recovered = false;
    return {
      inMomentary: this.inLoud.momentary,
      outMomentary: this.outLoud.momentary,
      outShortTerm: this.outLoud.shortTerm,
      outIntegrated: this.outLoud.integrated,
      outRange: this.outLoud.range,
      inIntegrated: this.inLoud.integrated,
      outTruePeakDb: this.outPeak.takeBlockDb(),
      outTruePeakHoldDb: this.outPeak.holdDb,
      outSamplePeakDb: gainToDb(this.outPeak.samplePeak),
      inTruePeakDb: this.inPeak.holdDb,
      limiterReductionDb: this.limiter.reductionDb * this.en.limiter.value,
      glueReductionDb: this.glue.reductionDb * this.en.glue.value,
      bandReductionDb: [
        this.multi.comps[0].reductionDb * this.en.multi.value,
        this.multi.comps[1].reductionDb * this.en.multi.value,
        this.multi.comps[2].reductionDb * this.en.multi.value,
      ],
      dynEqReductionDb: this.dyn.reductionDb * this.en.dyn.value,
      deEssReductionDb: this.deess.reductionDb * this.en.deess.value,
      correlation: this.corr.value,
      latencySamples: this.latency,
      recovered: rec,
    };
  }

  /** Last 4096 output samples (mono, oldest first) for the spectrum display. */
  scopeInto(dst: Float32Array): void {
    const n = Math.min(dst.length, this.scope.length);
    let idx = (this.scopePos - n + this.scope.length) % this.scope.length;
    for (let i = 0; i < n; i++) {
      dst[i] = this.scope[idx] as number;
      idx = idx + 1 === this.scope.length ? 0 : idx + 1;
    }
  }
}

/**
 * Bounce a whole program through the real-time engine, compensating latency so
 * the result lines up with the input. This is the same code path as playback.
 */
export function bounceThroughEngine(input: Stereo, params: ChainParams, block = 512): Stereo {
  const engine = new RealtimeEngine(input.sampleRate, block);
  engine.setParams(params, true);
  engine.setSource("processed", true);
  engine.setMonitor("full", true);
  const total = input.l.length;
  const lat = engine.latency;
  const outL = new Float64Array(total + lat);
  const outR = new Float64Array(total + lat);
  const zero = new Float64Array(block);
  const inL = new Float64Array(block);
  const inR = new Float64Array(block);
  for (let pos = 0; pos < total + lat; pos += block) {
    const n = Math.min(block, total + lat - pos);
    for (let i = 0; i < n; i++) {
      inL[i] = pos + i < total ? (input.l[pos + i] as number) : 0;
      inR[i] = pos + i < total ? (input.r[pos + i] as number) : 0;
    }
    engine.process(inL.subarray(0, n), inR.subarray(0, n), zero.subarray(0, n), zero.subarray(0, n), n, outL.subarray(pos, pos + n), outR.subarray(pos, pos + n));
  }
  return { l: outL.slice(lat, lat + total), r: outR.slice(lat, lat + total), sampleRate: input.sampleRate };
}
