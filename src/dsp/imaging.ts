import { designBiquad, processBiquadInPlace } from "./biquad.ts";

/** Mid/side width. `width` 1 is unity, 0 is mono, >1 widens the side. */
export function applyWidth(l: Float64Array, r: Float64Array, width: number): { l: Float64Array; r: Float64Array } {
  const outL = new Float64Array(l.length);
  const outR = new Float64Array(r.length);
  const n = Math.min(l.length, r.length);
  const w = width;
  for (let i = 0; i < n; i++) {
    const mid = ((l[i] ?? 0) + (r[i] ?? 0)) * 0.5;
    const side = ((l[i] ?? 0) - (r[i] ?? 0)) * 0.5 * w;
    outL[i] = mid + side;
    outR[i] = mid - side;
  }
  return { l: outL, r: outR };
}

export function encodeMidSide(l: Float64Array, r: Float64Array): { mid: Float64Array; side: Float64Array } {
  const n = Math.min(l.length, r.length);
  const mid = new Float64Array(n);
  const side = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    mid[i] = ((l[i] ?? 0) + (r[i] ?? 0)) * 0.5;
    side[i] = ((l[i] ?? 0) - (r[i] ?? 0)) * 0.5;
  }
  return { mid, side };
}

export function decodeMidSide(mid: Float64Array, side: Float64Array): { l: Float64Array; r: Float64Array } {
  const n = Math.min(mid.length, side.length);
  const l = new Float64Array(n);
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = (mid[i] ?? 0) + (side[i] ?? 0);
    r[i] = (mid[i] ?? 0) - (side[i] ?? 0);
  }
  return { l, r };
}

/** (L+R)/2 on both channels. Equal-power mono fold of a centered source keeps its level. */
export function foldMono(l: Float64Array, r: Float64Array): { l: Float64Array; r: Float64Array } {
  const n = Math.min(l.length, r.length);
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const m = ((l[i] ?? 0) + (r[i] ?? 0)) * 0.5;
    a[i] = m;
    b[i] = m;
  }
  return { l: a, r: b };
}

/**
 * Dynamic mid/side carve.
 * When the center is loud inside `focusHz`, only the side component of that
 * band is turned down. Wide guitars and cymbals move aside for a centered
 * vocal. Centered instruments in the same band are not separated from the vocal —
 * they live in mid, and mid is left alone. `depth` 0 is bit-transparent.
 */
export function carveCenter(
  l: Float64Array,
  r: Float64Array,
  sampleRate: number,
  depth: number,
  focusHz: number,
): { l: Float64Array; r: Float64Array } {
  const n = Math.min(l.length, r.length);
  const outL = new Float64Array(l.length);
  const outR = new Float64Array(r.length);
  if (n === 0 || depth <= 1e-6) {
    outL.set(l);
    outR.set(r);
    return { l: outL, r: outR };
  }
  const { mid, side } = encodeMidSide(l, r);
  const midBand = new Float64Array(mid);
  const sideBand = new Float64Array(side);
  const freq = Math.max(80, Math.min(sampleRate * 0.45, focusHz));
  const coeff = designBiquad("bandpass", freq, 1.15, 0, sampleRate);
  processBiquadInPlace(midBand, coeff);
  processBiquadInPlace(sideBand, coeff);
  const atk = Math.exp(-1 / Math.max(1, sampleRate * 0.004));
  const rel = Math.exp(-1 / Math.max(1, sampleRate * 0.085));
  const d = Math.max(0, Math.min(1, depth));
  let env = 0;
  for (let i = 0; i < n; i++) {
    const det = Math.abs(midBand[i] ?? 0);
    const c = det > env ? atk : rel;
    env = c * env + (1 - c) * det;
    const db = 20 * Math.log10(env + 1e-12);
    const sense = Math.max(0, Math.min(1, (db + 40) / 22));
    const g = 1 - d * sense;
    const sideOut = (side[i] ?? 0) + (g - 1) * (sideBand[i] ?? 0);
    const m = mid[i] ?? 0;
    outL[i] = m + sideOut;
    outR[i] = m - sideOut;
  }
  if (l.length > n) outL.set(l.subarray(n), n);
  if (r.length > n) outR.set(r.subarray(n), n);
  return { l: outL, r: outR };
}
