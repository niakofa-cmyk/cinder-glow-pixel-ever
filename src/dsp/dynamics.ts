import { dbToGain, designBiquad, processBiquadInPlace } from "./biquad.ts";
import type { DynamicsBand } from "./types.ts";

/** Gain-computer. Returns positive dB of attenuation. Soft knee is continuous. */
export function gainReductionDb(levelDb: number, thresholdDb: number, ratio: number, kneeDb: number): number {
  const r = Math.max(1, ratio);
  const slope = 1 - 1 / r;
  if (slope <= 0) return 0;
  if (kneeDb <= 0) {
    if (levelDb <= thresholdDb) return 0;
    return slope * (levelDb - thresholdDb);
  }
  const lower = thresholdDb - kneeDb / 2;
  const upper = thresholdDb + kneeDb / 2;
  if (levelDb < lower) return 0;
  if (levelDb > upper) return slope * (levelDb - thresholdDb);
  const x = levelDb - lower;
  return (slope * (x * x)) / (2 * kneeDb);
}

export type EnvelopeResult = { audioL: Float64Array; audioR: Float64Array; avgReductionDb: number };

/**
 * Stereo-linked feedforward compressor. Detector is the peak of |L| and |R|
 * with independent attack and release one-poles. Makeup is static gain.
 */
export function compressStereo(
  l: Float64Array,
  r: Float64Array,
  sampleRate: number,
  params: DynamicsBand,
): EnvelopeResult {
  const outL = new Float64Array(l.length);
  const outR = new Float64Array(r.length);
  const atk = Math.exp(-1 / Math.max(1, (params.attackMs / 1000) * sampleRate));
  const rel = Math.exp(-1 / Math.max(1, (params.releaseMs / 1000) * sampleRate));
  const makeup = dbToGain(params.makeupDb);
  let env = 0;
  let grSum = 0;
  const n = Math.min(l.length, r.length);
  for (let i = 0; i < n; i++) {
    const det = Math.max(Math.abs(l[i] ?? 0), Math.abs(r[i] ?? 0));
    const c = det > env ? atk : rel;
    env = c * env + (1 - c) * det;
    const levelDb = 20 * Math.log10(env + 1e-12);
    const gr = gainReductionDb(levelDb, params.thresholdDb, params.ratio, params.kneeDb);
    grSum += gr;
    const g = dbToGain(-gr) * makeup;
    outL[i] = (l[i] ?? 0) * g;
    outR[i] = (r[i] ?? 0) * g;
  }
  return { audioL: outL, audioR: outR, avgReductionDb: n ? grSum / n : 0 };
}

/**
 * Serial glue. Stage 1 is a fast RMS VCA using the knobs as set (the bus
 * compressor role). Stage 2 is an optical-style leveler on the post-VCA
 * level: slower attack, half the extra ratio, and a release that holds the
 * slower of a 70 ms and a program memory. `opticalMix` 0 is stage 1 only.
 * This is the topology, not a model of an SSL or an LA-2A.
 */
export function compressSerialStereo(
  l: Float64Array,
  r: Float64Array,
  sampleRate: number,
  params: DynamicsBand,
  opticalMix: number,
): EnvelopeResult {
  const n = Math.min(l.length, r.length);
  const outL = new Float64Array(l.length);
  const outR = new Float64Array(r.length);
  const o = Math.max(0, Math.min(1, opticalMix));
  const atk1 = Math.exp(-1 / Math.max(1, (params.attackMs / 1000) * sampleRate));
  const rel1 = Math.exp(-1 / Math.max(1, (params.releaseMs / 1000) * sampleRate));
  const rmsC = 1 - Math.exp(-1 / Math.max(1, sampleRate * 0.008));
  const atk2 = Math.exp(-1 / Math.max(1, sampleRate * 0.012));
  const relFast = Math.exp(-1 / Math.max(1, sampleRate * 0.07));
  const slowMs = Math.max(400, params.releaseMs);
  const relSlow = Math.exp(-1 / Math.max(1, (slowMs / 1000) * sampleRate));
  const optThreshold = params.thresholdDb + 2;
  const optRatio = 1 + Math.max(0, params.ratio - 1) * 0.45;
  const optKnee = Math.max(params.kneeDb, 8);
  const makeup = dbToGain(params.makeupDb);
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
    const gr1 = gainReductionDb(20 * Math.log10(env1 + 1e-12), params.thresholdDb, params.ratio, params.kneeDb);
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
    outL[i] = (l[i] ?? 0) * a;
    outR[i] = (r[i] ?? 0) * a;
  }
  return { audioL: outL, audioR: outR, avgReductionDb: n ? grSum / n : 0 };
}

/**
 * Split-band dynamic cut. A 0 dB bandpass is scaled down when its own
 * envelope exceeds the threshold, then mixed back. Broadband material outside
 * the band is unchanged. Used for dynamic EQ and de-essing.
 */
export function dynamicBandCut(
  x: Float64Array,
  sampleRate: number,
  freq: number,
  q: number,
  thresholdDb: number,
  ratio: number,
  attackMs: number,
  releaseMs: number,
  maxCutDb: number,
): Float64Array {
  const band = new Float64Array(x);
  processBiquadInPlace(band, designBiquad("bandpass", freq, q, 0, sampleRate));
  const atk = Math.exp(-1 / Math.max(1, (attackMs / 1000) * sampleRate));
  const rel = Math.exp(-1 / Math.max(1, (releaseMs / 1000) * sampleRate));
  const floor = dbToGain(-Math.max(0, maxCutDb));
  let env = 0;
  const y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const det = Math.abs(band[i] ?? 0);
    const c = det > env ? atk : rel;
    env = c * env + (1 - c) * det;
    const levelDb = 20 * Math.log10(env + 1e-12);
    const gr = gainReductionDb(levelDb, thresholdDb, ratio, 0);
    const depth = Math.max(floor, dbToGain(-gr));
    const g = Math.max(floor, depth);
    y[i] = (x[i] ?? 0) + (g - 1) * (band[i] ?? 0);
  }
  return y;
}

/**
 * Transient shaper.
 * `attack` and `sustain` are −1..+1.
 * A fast envelope over a slow one marks transients. Attack scales that
 * difference. Sustain scales the slow envelope relative to the dry peak,
 * so a steady tone moves and a click mostly follows `attack`.
 */
export function shapeTransients(
  x: Float64Array,
  sampleRate: number,
  attack: number,
  sustain: number,
): Float64Array {
  const y = new Float64Array(x.length);
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
    y[i] = (x[i] ?? 0) * Math.max(0, g);
  }
  return y;
}
