import { dbToGain, designBiquad, gainToDb } from "./biquad.ts";
import { gainReductionDb } from "./dynamics.ts";
import { bandIsActive } from "./eq.ts";
import { limitInto, openLimitStream, type LimitStream } from "./limiter.ts";
import { measureLoudness, openLoudness } from "./lufs.ts";
import { peakAbs } from "./meters.ts";
import { openAlignedSat, saturateInPlace, type AlignedSat } from "./saturation.ts";
import { measureTruePeak, openStereoPeak } from "./truepeak.ts";
import type { BiquadCoeffs, ChainParams, DynamicsBand, EqBand, ProcessReport } from "./types.ts";

type Samples = ArrayLike<number>;
type Buf = Float32Array;

type Biq = { c: BiquadCoeffs; s1: number; s2: number };

function biq(c: BiquadCoeffs): Biq {
  return { c, s1: 0, s2: 0 };
}

function stepBiq(b: Biq, x: number): number {
  const y = b.c.b0 * x + b.s1;
  b.s1 = b.c.b1 * x - b.c.a1 * y + b.s2;
  b.s2 = b.c.b2 * x - b.c.a2 * y;
  return y;
}

type CompState = {
  atk: number;
  rel: number;
  env: number;
  makeup: number;
  threshold: number;
  ratio: number;
  knee: number;
  grSum: number;
  n: number;
};

function openComp(sampleRate: number, p: DynamicsBand, attackMs: number, releaseMs: number): CompState {
  return {
    atk: Math.exp(-1 / Math.max(1, (attackMs / 1000) * sampleRate)),
    rel: Math.exp(-1 / Math.max(1, (releaseMs / 1000) * sampleRate)),
    env: 0,
    makeup: dbToGain(p.makeupDb),
    threshold: p.thresholdDb,
    ratio: p.ratio,
    knee: p.kneeDb,
    grSum: 0,
    n: 0,
  };
}

function compGain(st: CompState, det: number): number {
  const c = det > st.env ? st.atk : st.rel;
  st.env = c * st.env + (1 - c) * det;
  const gr = gainReductionDb(20 * Math.log10(st.env + 1e-12), st.threshold, st.ratio, st.knee);
  st.grSum += gr;
  st.n++;
  return dbToGain(-gr) * st.makeup;
}

/**
 * Master a clip into `outL`/`outR` without allocating another copy of the song.
 * `out` must already exist and must not alias `input`. Disabled stages are skipped.
 * Linear-phase EQ and linear-phase multiband splits need a second full copy, so on
 * this path the EQ stays minimum-phase and the multiband split is minimum-phase
 * Linkwitz–Riley. The report says so when those stages actually run.
 */
export function renderClip(
  inL: Samples,
  inR: Samples,
  sampleRate: number,
  params: ChainParams,
  outL: Buf,
  outR: Buf,
): ProcessReport {
  const n = Math.min(inL.length, inR.length, outL.length, outR.length);
  const notes: string[] = [];
  const gain = dbToGain(params.inputGainDb);
  for (let i = 0; i < n; i++) {
    outL[i] = (inL[i] ?? 0) * gain;
    outR[i] = (inR[i] ?? 0) * gain;
  }

  const active = params.bands.filter(bandIsActive);
  if (active.length > 0) {
    const left = active.map((b) => biq(coeff(b, sampleRate, 1)));
    const right = active.map((b) => biq(coeff(b, sampleRate, 1)));
    for (let i = 0; i < n; i++) {
      let l = outL[i] ?? 0;
      let r = outR[i] ?? 0;
      for (let b = 0; b < left.length; b++) {
        l = stepBiq(left[b] ?? biq(left[0]!.c), l);
        r = stepBiq(right[b] ?? biq(right[0]!.c), r);
      }
      outL[i] = l;
      outR[i] = r;
    }
    if (params.eqMode === "linear") {
      notes.push("This file is mastered in place. EQ is minimum-phase here, because linear-phase EQ needs a second copy of the song.");
    }
  }

  if (params.dynamicEq.enabled) runDyn(outL, outR, sampleRate, params.dynamicEq);
  if (params.deEss.enabled) {
    runDyn(outL, outR, sampleRate, params.deEss);
    notes.push("De-esser is split-band. It only turns down the sibilance band, and only while that band is loud.");
  }

  if (params.multiband.enabled) {
    runMultiband(outL, outR, sampleRate, params);
    notes.push(
      "Multiband on a long file is minimum-phase Linkwitz–Riley so the bands do not need their own copy of the song. The sum stays close to flat. It is not the linear-phase split used on short files.",
    );
  }

  let glueReduction = 0;
  if (params.glue.enabled) {
    glueReduction = runGlue(outL, outR, sampleRate, params);
    notes.push(
      "Glue is two stages in series. The first is a fast RMS VCA on your threshold, ratio, attack and release. The second is a slower optical-style leveler. Optical is how much of that second stage you hear.",
    );
  }

  if (params.transient.enabled && (Math.abs(params.transient.attack) > 0.001 || Math.abs(params.transient.sustain) > 0.001)) {
    runTransient(outL, sampleRate, params.transient.attack, params.transient.sustain);
    runTransient(outR, sampleRate, params.transient.attack, params.transient.sustain);
  }

  if (params.saturation.enabled && params.saturation.mix > 0.001) {
    const s = params.saturation;
    const opts = { sampleRate, memory: s.memory, lowColor: s.lowColor, highColor: s.highColor, tubeTapeMix: s.tubeTapeMix };
    saturateInPlace(outL, sampleRate, s.mode, s.driveDb, s.mix, opts);
    saturateInPlace(outR, sampleRate, s.mode, s.driveDb, s.mix, opts);
    notes.push(
      s.mode === "tube"
        ? "Tube is an 8× oversampled asymmetric exponential plus a hysteresis play operator. Even harmonics. It is not a valve."
        : s.mode === "hybrid"
          ? "Hybrid crossfades the tube curve into tanh at 8×, then the downsampler throws away harmonics above Nyquist."
          : "Tape is an 8× oversampled tanh plus a hysteresis play operator. Odd harmonics, unity small-signal gain. It is not a tape machine.",
    );
  }

  if (Math.abs(params.width - 1) > 0.001) {
    const w = params.width;
    for (let i = 0; i < n; i++) {
      const l = outL[i] ?? 0;
      const r = outR[i] ?? 0;
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5 * w;
      outL[i] = mid + side;
      outR[i] = mid - side;
    }
  }

  if (params.carve > 0.001) {
    runCarve(outL, outR, sampleRate, params.carve, params.carveHz);
    notes.push(
      `Center carve ducks the side band around ${Math.round(params.carveHz)} Hz while the center of that band is loud. It does not pull a vocal out of other centered sounds.`,
    );
  }

  let limiterReduction = 0;
  let latency = 0;
  if (params.limiter.enabled) {
    limiterReduction = limitInto(outL, outR, outL, outR, sampleRate, params.limiter.ceilingDb, params.limiter.releaseMs, params.limiter.lookaheadMs);
    latency = Math.round((params.limiter.lookaheadMs / 1000) * sampleRate);
    if (limiterReduction < 0.05) notes.push("Limiter is armed and did not reduce gain. The signal was already under the ceiling.");
  }

  const peakOut = measureTruePeak([outL, outR]);
  const loudOut = measureLoudness([outL, outR], sampleRate);
  const loudIn = measureLoudness([inL, inR], sampleRate);
  const peakIn = measureTruePeak([inL, inR]);
  return {
    samplePeakInDb: peakIn.samplePeakDb,
    samplePeakOutDb: gainToDb(Math.max(peakAbs(outL), peakAbs(outR))),
    truePeakInDb: peakIn.truePeakDb,
    truePeakOutDb: peakOut.truePeakDb,
    integratedIn: loudIn.integrated,
    integratedOut: loudOut.integrated,
    limiterReductionDb: limiterReduction,
    glueReductionDb: glueReduction,
    latencySamples: latency,
    notes,
  };
}

function coeff(band: EqBand, sampleRate: number, gainScale: number): BiquadCoeffs {
  return designBiquad(band.type, band.freq, band.q, band.gainDb * gainScale, sampleRate);
}

function runDyn(
  l: Buf,
  r: Buf,
  sampleRate: number,
  d: { freq: number; q: number; thresholdDb: number; ratio: number; attackMs: number; releaseMs: number; maxCutDb: number },
): void {
  const c = designBiquad("bandpass", d.freq, d.q, 0, sampleRate);
  const bl = biq(c);
  const br = biq(c);
  const atk = Math.exp(-1 / Math.max(1, (d.attackMs / 1000) * sampleRate));
  const rel = Math.exp(-1 / Math.max(1, (d.releaseMs / 1000) * sampleRate));
  const floor = dbToGain(-Math.max(0, d.maxCutDb));
  let envL = 0;
  let envR = 0;
  const n = Math.min(l.length, r.length);
  for (let i = 0; i < n; i++) {
    l[i] = dynSample(l[i] ?? 0, bl, atk, rel, floor, d, envL, (e) => {
      envL = e;
    });
    r[i] = dynSample(r[i] ?? 0, br, atk, rel, floor, d, envR, (e) => {
      envR = e;
    });
  }
}

function dynSample(
  x: number,
  band: Biq,
  atk: number,
  rel: number,
  floor: number,
  d: { thresholdDb: number; ratio: number },
  env: number,
  setEnv: (e: number) => void,
): number {
  const b = stepBiq(band, x);
  const det = Math.abs(b);
  const c = det > env ? atk : rel;
  const next = c * env + (1 - c) * det;
  setEnv(next);
  const gr = gainReductionDb(20 * Math.log10(next + 1e-12), d.thresholdDb, d.ratio, 0);
  const depth = Math.max(floor, dbToGain(-gr));
  const g = Math.max(floor, depth);
  return x + (g - 1) * b;
}

function runMultiband(l: Buf, r: Buf, sampleRate: number, params: ChainParams): void {
  const mb = params.multiband;
  const lowLP = [biq(butter(sampleRate, "lowpass", mb.lowHz)), biq(butter(sampleRate, "lowpass", mb.lowHz))];
  const lowHP = [biq(butter(sampleRate, "highpass", mb.lowHz)), biq(butter(sampleRate, "highpass", mb.lowHz))];
  const midLP = [biq(butter(sampleRate, "lowpass", mb.highHz)), biq(butter(sampleRate, "lowpass", mb.highHz))];
  const midHP = [biq(butter(sampleRate, "highpass", mb.highHz)), biq(butter(sampleRate, "highpass", mb.highHz))];
  const right = {
    lowLP: [biq(lowLP[0]!.c), biq(lowLP[1]!.c)],
    lowHP: [biq(lowHP[0]!.c), biq(lowHP[1]!.c)],
    midLP: [biq(midLP[0]!.c), biq(midLP[1]!.c)],
    midHP: [biq(midHP[0]!.c), biq(midHP[1]!.c)],
  };
  const cLow = openComp(sampleRate, mb.low, mb.low.attackMs, mb.low.releaseMs);
  const cMid = openComp(sampleRate, mb.mid, mb.mid.attackMs, mb.mid.releaseMs);
  const cHigh = openComp(sampleRate, mb.high, mb.high.attackMs, mb.high.releaseMs);
  const n = Math.min(l.length, r.length);
  for (let i = 0; i < n; i++) {
    const ls = split(l[i] ?? 0, lowLP, lowHP, midLP, midHP);
    const rs = split(r[i] ?? 0, right.lowLP, right.lowHP, right.midLP, right.midHP);
    const gL = compGain(cLow, Math.max(Math.abs(ls.low), Math.abs(rs.low)));
    const gM = compGain(cMid, Math.max(Math.abs(ls.mid), Math.abs(rs.mid)));
    const gH = compGain(cHigh, Math.max(Math.abs(ls.high), Math.abs(rs.high)));
    l[i] = ls.low * gL + ls.mid * gM + ls.high * gH;
    r[i] = rs.low * gL + rs.mid * gM + rs.high * gH;
  }
}

function butter(sampleRate: number, kind: "lowpass" | "highpass", freq: number): BiquadCoeffs {
  return designBiquad(kind, freq, Math.SQRT1_2, 0, sampleRate);
}

function split(x: number, lowLP: Biq[], lowHP: Biq[], midLP: Biq[], midHP: Biq[]): { low: number; mid: number; high: number } {
  let low = x;
  let high = x;
  for (const b of lowLP) low = stepBiq(b, low);
  for (const b of lowHP) high = stepBiq(b, high);
  let mid = high;
  let top = high;
  for (const b of midLP) mid = stepBiq(b, mid);
  for (const b of midHP) top = stepBiq(b, top);
  return { low, mid, high: top };
}

function runGlue(l: Buf, r: Buf, sampleRate: number, params: ChainParams): number {
  const p = params.glue;
  const o = Math.max(0, Math.min(1, p.optical));
  const n = Math.min(l.length, r.length);
  const atk1 = Math.exp(-1 / Math.max(1, (p.attackMs / 1000) * sampleRate));
  const rel1 = Math.exp(-1 / Math.max(1, (p.releaseMs / 1000) * sampleRate));
  const rmsC = 1 - Math.exp(-1 / Math.max(1, sampleRate * 0.008));
  const atk2 = Math.exp(-1 / Math.max(1, sampleRate * 0.012));
  const relFast = Math.exp(-1 / Math.max(1, sampleRate * 0.07));
  const slowMs = Math.max(400, p.releaseMs);
  const relSlow = Math.exp(-1 / Math.max(1, (slowMs / 1000) * sampleRate));
  const optThreshold = p.thresholdDb + 2;
  const optRatio = 1 + Math.max(0, p.ratio - 1) * 0.45;
  const optKnee = Math.max(p.kneeDb, 8);
  const makeup = dbToGain(p.makeupDb);
  let power = 0;
  let env1 = 0;
  let optFast = 0;
  let optSlow = 0;
  let grSum = 0;
  for (let i = 0; i < n; i++) {
    const det = Math.max(Math.abs(l[i] ?? 0), Math.abs(r[i] ?? 0));
    power += rmsC * (det * det - power);
    const rms = Math.sqrt(Math.max(0, power));
    const c1 = rms > env1 ? atk1 : rel1;
    env1 = c1 * env1 + (1 - c1) * rms;
    const gr1 = gainReductionDb(20 * Math.log10(env1 + 1e-12), p.thresholdDb, p.ratio, p.kneeDb);
    const g1 = dbToGain(-gr1);
    const post = rms * g1;
    const cFast = post > optFast ? atk2 : relFast;
    optFast = cFast * optFast + (1 - cFast) * post;
    const cSlow = post > optSlow ? atk2 : relSlow;
    optSlow = cSlow * optSlow + (1 - cSlow) * post;
    const optEnv = Math.max(optFast, optSlow);
    const gr2 = gainReductionDb(20 * Math.log10(optEnv + 1e-12), optThreshold, optRatio, optKnee);
    const g2 = g1 * dbToGain(-gr2);
    const g = g1 * (1 - o) + g2 * o;
    grSum += -20 * Math.log10(Math.max(1e-12, g));
    const a = g * makeup;
    l[i] = (l[i] ?? 0) * a;
    r[i] = (r[i] ?? 0) * a;
  }
  return n ? grSum / n : 0;
}

function runTransient(x: Buf, sampleRate: number, attack: number, sustain: number): void {
  const fastA = Math.exp(-1 / (sampleRate * 0.0008));
  const fastR = Math.exp(-1 / (sampleRate * 0.03));
  const slowA = Math.exp(-1 / (sampleRate * 0.025));
  const slowR = Math.exp(-1 / (sampleRate * 0.25));
  let fast = 0;
  let slow = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i] ?? 0);
    fast = a > fast ? fastA * fast + (1 - fastA) * a : fastR * fast + (1 - fastR) * a;
    slow = a > slow ? slowA * slow + (1 - slowA) * a : slowR * slow + (1 - slowR) * a;
    const trans = Math.max(0, fast - slow) / (fast + 1e-9);
    const body = slow / (fast + 1e-9);
    const g = 1 + attack * trans * 1.4 + sustain * Math.min(1, body) * 0.85;
    x[i] = (x[i] ?? 0) * Math.max(0, g);
  }
}

function runCarve(l: Buf, r: Buf, sampleRate: number, depth: number, focusHz: number): void {
  const freq = Math.max(80, Math.min(sampleRate * 0.45, focusHz));
  const c = designBiquad("bandpass", freq, 1.15, 0, sampleRate);
  const midB = biq(c);
  const sideB = biq(c);
  const atk = Math.exp(-1 / Math.max(1, sampleRate * 0.004));
  const rel = Math.exp(-1 / Math.max(1, sampleRate * 0.085));
  const d = Math.max(0, Math.min(1, depth));
  let env = 0;
  const n = Math.min(l.length, r.length);
  for (let i = 0; i < n; i++) {
    const lv = l[i] ?? 0;
    const rv = r[i] ?? 0;
    const mid = (lv + rv) * 0.5;
    const side = (lv - rv) * 0.5;
    const mb = stepBiq(midB, mid);
    const sb = stepBiq(sideB, side);
    const det = Math.abs(mb);
    const k = det > env ? atk : rel;
    env = k * env + (1 - k) * det;
    const db = 20 * Math.log10(env + 1e-12);
    const sense = Math.max(0, Math.min(1, (db + 40) / 22));
    const g = 1 - d * sense;
    const sideOut = side + (g - 1) * sb;
    l[i] = mid + sideOut;
    r[i] = mid - sideOut;
  }
}

export type ChainStream = {
  push(l: number, r: number): { l: number; r: number } | null;
  flush(): { l: number; r: number } | null;
  glueReduction: () => number;
  limiterReduction: () => number;
  latencySamples: number;
  notes: string[];
};

/**
 * Sample-by-sample master. Disabled stages are skipped.
 * Output is aligned with the input. `push` may return null until delay lines fill;
 * `flush` until null to finish. Scratch is filter state, not a copy of the song.
 * Linear-phase EQ and linear-phase multiband need a second copy, so this path stays minimum-phase.
 */
export function createChain(sampleRate: number, params: ChainParams): ChainStream {
  const notes: string[] = [];
  const gain = dbToGain(params.inputGainDb);
  const active = params.bands.filter(bandIsActive);
  const eqL = active.map((b) => biq(coeff(b, sampleRate, 1)));
  const eqR = active.map((b) => biq(coeff(b, sampleRate, 1)));
  if (active.length > 0 && params.eqMode === "linear") {
    notes.push("This file is mastered in place. EQ is minimum-phase here, because linear-phase EQ needs a second copy of the song.");
  }

  const dyn = makeDyn(sampleRate, params.dynamicEq.enabled ? params.dynamicEq : null);
  const deess = makeDyn(sampleRate, params.deEss.enabled ? params.deEss : null);
  if (params.deEss.enabled) {
    notes.push("De-esser is split-band. It only turns down the sibilance band, and only while that band is loud.");
  }
  const multi = params.multiband.enabled ? makeMulti(sampleRate, params) : null;
  if (multi) {
    notes.push(
      "Multiband on a long file is minimum-phase Linkwitz–Riley so the bands do not need their own copy of the song. The sum stays close to flat. It is not the linear-phase split used on short files.",
    );
  }
  const glue = params.glue.enabled ? makeGlue(sampleRate, params) : null;
  if (glue) {
    notes.push(
      "Glue is two stages in series. The first is a fast RMS VCA on your threshold, ratio, attack and release. The second is a slower optical-style leveler. Optical is how much of that second stage you hear.",
    );
  }
  const trL = params.transient.enabled && (Math.abs(params.transient.attack) > 0.001 || Math.abs(params.transient.sustain) > 0.001)
    ? makeTransient(sampleRate, params.transient.attack, params.transient.sustain)
    : null;
  const trR = trL ? makeTransient(sampleRate, params.transient.attack, params.transient.sustain) : null;

  let satL: AlignedSat | null = null;
  let satR: AlignedSat | null = null;
  if (params.saturation.enabled && params.saturation.mix > 0.001) {
    const s = params.saturation;
    const opts = { sampleRate, memory: s.memory, lowColor: s.lowColor, highColor: s.highColor, tubeTapeMix: s.tubeTapeMix };
    satL = openAlignedSat(sampleRate, s.mode, s.driveDb, s.mix, opts);
    satR = openAlignedSat(sampleRate, s.mode, s.driveDb, s.mix, opts);
    notes.push(
      s.mode === "tube"
        ? "Tube is an 8× oversampled asymmetric exponential plus a hysteresis play operator. Even harmonics. It is not a valve."
        : s.mode === "hybrid"
          ? "Hybrid crossfades the tube curve into tanh at 8×, then the downsampler throws away harmonics above Nyquist."
          : "Tape is an 8× oversampled tanh plus a hysteresis play operator. Odd harmonics, unity small-signal gain. It is not a tape machine.",
    );
  }
  const width = Math.abs(params.width - 1) > 0.001 ? params.width : 1;
  const carve = params.carve > 0.001 ? makeCarve(sampleRate, params.carve, params.carveHz) : null;
  if (carve) {
    notes.push(
      `Center carve ducks the side band around ${Math.round(params.carveHz)} Hz while the center of that band is loud. It does not pull a vocal out of other centered sounds.`,
    );
  }
  let limiter: LimitStream | null = null;
  let latencySamples = 0;
  if (params.limiter.enabled) {
    limiter = openLimitStream(sampleRate, params.limiter.ceilingDb, params.limiter.releaseMs, params.limiter.lookaheadMs);
    latencySamples = Math.round((params.limiter.lookaheadMs / 1000) * sampleRate);
  }

  let satDone = false;
  const afterSat = (l: number, r: number): { l: number; r: number } | null => {
    if (width !== 1) {
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5 * width;
      l = mid + side;
      r = mid - side;
    }
    if (carve) {
      const y = carve(l, r);
      l = y.l;
      r = y.r;
    }
    if (!limiter) return { l, r };
    return limiter.push(l, r);
  };

  const preSat = (l0: number, r0: number): { l: number; r: number } => {
    let l = l0 * gain;
    let r = r0 * gain;
    for (let b = 0; b < eqL.length; b++) {
      l = stepBiq(eqL[b] ?? eqL[0]!, l);
      r = stepBiq(eqR[b] ?? eqR[0]!, r);
    }
    l = dyn(l, 0);
    r = dyn(r, 1);
    l = deess(l, 0);
    r = deess(r, 1);
    if (multi) {
      const y = multi(l, r);
      l = y.l;
      r = y.r;
    }
    if (glue) {
      const y = glue(l, r);
      l = y.l;
      r = y.r;
    }
    if (trL && trR) {
      l = trL(l);
      r = trR(r);
    }
    return { l, r };
  };

  return {
    latencySamples,
    notes,
    glueReduction: () => glue?.reduction() ?? 0,
    limiterReduction: () => limiter?.maxReduction() ?? 0,
    push(l0, r0) {
      const pre = preSat(l0, r0);
      if (!satL || !satR) return afterSat(pre.l, pre.r);
      const sl = satL.push(pre.l);
      const sr = satR.push(pre.r);
      if (sl === null || sr === null) return null;
      return afterSat(sl, sr);
    },
    flush() {
      if (satL && satR && !satDone) {
        const sl = satL.flush();
        const sr = satR.flush();
        if (sl !== null && sr !== null) return afterSat(sl, sr);
        satDone = true;
      }
      return limiter ? limiter.flush() : null;
    },
  };
}

function makeDyn(
  sampleRate: number,
  d: { freq: number; q: number; thresholdDb: number; ratio: number; attackMs: number; releaseMs: number; maxCutDb: number } | null,
): (x: number, ch: 0 | 1) => number {
  if (!d) return (x) => x;
  const c = designBiquad("bandpass", d.freq, d.q, 0, sampleRate);
  const bands = [biq(c), biq(c)];
  const atk = Math.exp(-1 / Math.max(1, (d.attackMs / 1000) * sampleRate));
  const rel = Math.exp(-1 / Math.max(1, (d.releaseMs / 1000) * sampleRate));
  const floor = dbToGain(-Math.max(0, d.maxCutDb));
  const env = [0, 0];
  return (x, ch) => {
    let next = env[ch] ?? 0;
    const y = dynSample(x, bands[ch] ?? bands[0]!, atk, rel, floor, d, env[ch] ?? 0, (e) => {
      next = e;
    });
    env[ch] = next;
    return y;
  };
}

function makeMulti(sampleRate: number, params: ChainParams): (l: number, r: number) => { l: number; r: number } {
  const mb = params.multiband;
  const lowLP = [biq(butter(sampleRate, "lowpass", mb.lowHz)), biq(butter(sampleRate, "lowpass", mb.lowHz))];
  const lowHP = [biq(butter(sampleRate, "highpass", mb.lowHz)), biq(butter(sampleRate, "highpass", mb.lowHz))];
  const midLP = [biq(butter(sampleRate, "lowpass", mb.highHz)), biq(butter(sampleRate, "lowpass", mb.highHz))];
  const midHP = [biq(butter(sampleRate, "highpass", mb.highHz)), biq(butter(sampleRate, "highpass", mb.highHz))];
  const right = {
    lowLP: [biq(lowLP[0]!.c), biq(lowLP[1]!.c)],
    lowHP: [biq(lowHP[0]!.c), biq(lowHP[1]!.c)],
    midLP: [biq(midLP[0]!.c), biq(midLP[1]!.c)],
    midHP: [biq(midHP[0]!.c), biq(midHP[1]!.c)],
  };
  const cLow = openComp(sampleRate, mb.low, mb.low.attackMs, mb.low.releaseMs);
  const cMid = openComp(sampleRate, mb.mid, mb.mid.attackMs, mb.mid.releaseMs);
  const cHigh = openComp(sampleRate, mb.high, mb.high.attackMs, mb.high.releaseMs);
  return (l, r) => {
    const ls = split(l, lowLP, lowHP, midLP, midHP);
    const rs = split(r, right.lowLP, right.lowHP, right.midLP, right.midHP);
    const gL = compGain(cLow, Math.max(Math.abs(ls.low), Math.abs(rs.low)));
    const gM = compGain(cMid, Math.max(Math.abs(ls.mid), Math.abs(rs.mid)));
    const gH = compGain(cHigh, Math.max(Math.abs(ls.high), Math.abs(rs.high)));
    return { l: ls.low * gL + ls.mid * gM + ls.high * gH, r: rs.low * gL + rs.mid * gM + rs.high * gH };
  };
}

function makeGlue(sampleRate: number, params: ChainParams): ((l: number, r: number) => { l: number; r: number }) & { reduction: () => number } {
  const p = params.glue;
  const o = Math.max(0, Math.min(1, p.optical));
  const atk1 = Math.exp(-1 / Math.max(1, (p.attackMs / 1000) * sampleRate));
  const rel1 = Math.exp(-1 / Math.max(1, (p.releaseMs / 1000) * sampleRate));
  const rmsC = 1 - Math.exp(-1 / Math.max(1, sampleRate * 0.008));
  const atk2 = Math.exp(-1 / Math.max(1, sampleRate * 0.012));
  const relFast = Math.exp(-1 / Math.max(1, sampleRate * 0.07));
  const slowMs = Math.max(400, p.releaseMs);
  const relSlow = Math.exp(-1 / Math.max(1, (slowMs / 1000) * sampleRate));
  const optThreshold = p.thresholdDb + 2;
  const optRatio = 1 + Math.max(0, p.ratio - 1) * 0.45;
  const optKnee = Math.max(p.kneeDb, 8);
  const makeup = dbToGain(p.makeupDb);
  let power = 0;
  let env1 = 0;
  let optFast = 0;
  let optSlow = 0;
  let grSum = 0;
  let n = 0;
  const step = (l: number, r: number) => {
    const det = Math.max(Math.abs(l), Math.abs(r));
    power += rmsC * (det * det - power);
    const rms = Math.sqrt(Math.max(0, power));
    const c1 = rms > env1 ? atk1 : rel1;
    env1 = c1 * env1 + (1 - c1) * rms;
    const gr1 = gainReductionDb(20 * Math.log10(env1 + 1e-12), p.thresholdDb, p.ratio, p.kneeDb);
    const g1 = dbToGain(-gr1);
    const post = rms * g1;
    const cFast = post > optFast ? atk2 : relFast;
    optFast = cFast * optFast + (1 - cFast) * post;
    const cSlow = post > optSlow ? atk2 : relSlow;
    optSlow = cSlow * optSlow + (1 - cSlow) * post;
    const optEnv = Math.max(optFast, optSlow);
    const gr2 = gainReductionDb(20 * Math.log10(optEnv + 1e-12), optThreshold, optRatio, optKnee);
    const g2 = g1 * dbToGain(-gr2);
    const g = g1 * (1 - o) + g2 * o;
    grSum += -20 * Math.log10(Math.max(1e-12, g));
    n++;
    const a = g * makeup;
    return { l: l * a, r: r * a };
  };
  step.reduction = () => (n ? grSum / n : 0);
  return step;
}

function makeTransient(sampleRate: number, attack: number, sustain: number): (x: number) => number {
  const fastA = Math.exp(-1 / (sampleRate * 0.0008));
  const fastR = Math.exp(-1 / (sampleRate * 0.03));
  const slowA = Math.exp(-1 / (sampleRate * 0.025));
  const slowR = Math.exp(-1 / (sampleRate * 0.25));
  let fast = 0;
  let slow = 0;
  return (x) => {
    const a = Math.abs(x);
    fast = a > fast ? fastA * fast + (1 - fastA) * a : fastR * fast + (1 - fastR) * a;
    slow = a > slow ? slowA * slow + (1 - slowA) * a : slowR * slow + (1 - slowR) * a;
    const trans = Math.max(0, fast - slow) / (fast + 1e-9);
    const body = slow / (fast + 1e-9);
    const g = 1 + attack * trans * 1.4 + sustain * Math.min(1, body) * 0.85;
    return x * Math.max(0, g);
  };
}

function makeCarve(sampleRate: number, depth: number, focusHz: number): (l: number, r: number) => { l: number; r: number } {
  const freq = Math.max(80, Math.min(sampleRate * 0.45, focusHz));
  const c = designBiquad("bandpass", freq, 1.15, 0, sampleRate);
  const midB = biq(c);
  const sideB = biq(c);
  const atk = Math.exp(-1 / Math.max(1, sampleRate * 0.004));
  const rel = Math.exp(-1 / Math.max(1, sampleRate * 0.085));
  const d = Math.max(0, Math.min(1, depth));
  let env = 0;
  return (lv, rv) => {
    const mid = (lv + rv) * 0.5;
    const side = (lv - rv) * 0.5;
    const mb = stepBiq(midB, mid);
    const sb = stepBiq(sideB, side);
    const det = Math.abs(mb);
    const k = det > env ? atk : rel;
    env = k * env + (1 - k) * det;
    const db = 20 * Math.log10(env + 1e-12);
    const sense = Math.max(0, Math.min(1, (db + 40) / 22));
    const g = 1 - d * sense;
    const sideOut = side + (g - 1) * sb;
    return { l: mid + sideOut, r: mid - sideOut };
  };
}

function allocPair(n: number): { l: Float32Array; r: Float32Array } | null {
  try {
    return { l: new Float32Array(n), r: new Float32Array(n) };
  } catch {
    return null;
  }
}

/**
 * Master `input` without a second full-file copy when the browser cannot hold one.
 * When the pair fits, it is returned and the report is measured from it.
 * When it does not, the report is measured while the samples are thrown away.
 * Either way the original buffer is left untouched. Yields so playback can run.
 */
export async function renderPaced(
  inL: ArrayLike<number>,
  inR: ArrayLike<number>,
  sampleRate: number,
  params: ChainParams,
  cancelled: () => boolean,
): Promise<{ l: Float32Array | null; r: Float32Array | null; report: ProcessReport }> {
  const n = Math.min(inL.length, inR.length);
  let pair = allocPair(n);
  if (!pair) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (cancelled()) throw new Error("cancelled");
    pair = allocPair(n);
  }
  const chain = createChain(sampleRate, params);
  const kept = pair !== null;
  if (!kept) {
    chain.notes.push("The browser could not hold a second copy of the song. Playback and export render the master in sections. The original is unchanged.");
  }
  const outMeter = kept ? null : openLoudness(sampleRate, 2);
  const inMeter = kept ? null : openLoudness(sampleRate, 2);
  const outPeak = kept ? null : openStereoPeak();
  const inPeak = kept ? null : openStereoPeak();
  const frame = new Float64Array(2);
  let w = 0;
  const take = (y: { l: number; r: number } | null) => {
    if (!y) return;
    if (pair && w < n) {
      pair.l[w] = y.l;
      pair.r[w] = y.r;
      w++;
      return;
    }
    if (!pair) {
      frame[0] = y.l;
      frame[1] = y.r;
      outMeter?.push(frame);
      outPeak?.push(y.l, y.r);
      w++;
    }
  };
  for (let i = 0; i < n; i++) {
    const il = inL[i] ?? 0;
    const ir = inR[i] ?? 0;
    if (inMeter && inPeak) {
      frame[0] = il;
      frame[1] = ir;
      inMeter.push(frame);
      inPeak.push(il, ir);
    }
    take(chain.push(il, ir));
    if ((i & 4095) === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (cancelled()) throw new Error("cancelled");
    }
  }
  for (;;) {
    const y = chain.flush();
    if (!y) break;
    take(y);
  }
  if (pair) {
    const peakOut = measureTruePeak([pair.l, pair.r]);
    const loudOut = measureLoudness([pair.l, pair.r], sampleRate);
    const loudIn = measureLoudness([inL, inR], sampleRate);
    const peakIn = measureTruePeak([inL, inR]);
    if (chain.limiterReduction() < 0.05 && params.limiter.enabled) {
      chain.notes.push("Limiter is armed and did not reduce gain. The signal was already under the ceiling.");
    }
    return {
      l: pair.l,
      r: pair.r,
      report: {
        samplePeakInDb: peakIn.samplePeakDb,
        samplePeakOutDb: gainToDb(Math.max(peakAbs(pair.l), peakAbs(pair.r))),
        truePeakInDb: peakIn.truePeakDb,
        truePeakOutDb: peakOut.truePeakDb,
        integratedIn: loudIn.integrated,
        integratedOut: loudOut.integrated,
        limiterReductionDb: chain.limiterReduction(),
        glueReductionDb: chain.glueReduction(),
        latencySamples: chain.latencySamples,
        notes: chain.notes,
      },
    };
  }
  const peakOut = outPeak?.finish();
  const loudOut = outMeter?.finish();
  const loudIn = inMeter?.finish();
  const peakIn = inPeak?.finish();
  if (chain.limiterReduction() < 0.05 && params.limiter.enabled) {
    chain.notes.push("Limiter is armed and did not reduce gain. The signal was already under the ceiling.");
  }
  return {
    l: null,
    r: null,
    report: {
      samplePeakInDb: peakIn?.samplePeakDb ?? -Infinity,
      samplePeakOutDb: peakOut?.samplePeakDb ?? -Infinity,
      truePeakInDb: peakIn?.truePeakDb ?? -Infinity,
      truePeakOutDb: peakOut?.truePeakDb ?? -Infinity,
      integratedIn: loudIn?.integrated ?? -Infinity,
      integratedOut: loudOut?.integrated ?? -Infinity,
      limiterReductionDb: chain.limiterReduction(),
      glueReductionDb: chain.glueReduction(),
      latencySamples: chain.latencySamples,
      notes: chain.notes,
    },
  };
}

/** Sequential reader. Each `pull` continues where the last one stopped. Output length matches the input. */
export function openRenderer(
  inL: ArrayLike<number>,
  inR: ArrayLike<number>,
  sampleRate: number,
  params: ChainParams,
): { pull(dstL: Float32Array, dstR: Float32Array, count: number): number } {
  const chain = createChain(sampleRate, params);
  const n = Math.min(inL.length, inR.length);
  let i = 0;
  return {
    pull(dstL, dstR, count) {
      let w = 0;
      while (w < count) {
        const y = i < n ? chain.push(inL[i] ?? 0, inR[i++] ?? 0) : chain.flush();
        if (!y) {
          if (i >= n) break;
          continue;
        }
        dstL[w] = y.l;
        dstR[w] = y.r;
        w++;
      }
      return w;
    },
  };
}
