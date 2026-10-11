import type { BiquadCoeffs, BiquadType } from "./types.ts";

/** RBJ Audio EQ Cookbook biquads. Coefficients are normalized so a0 = 1. */
export function designBiquad(
  type: BiquadType,
  freq: number,
  q: number,
  gainDb: number,
  sampleRate: number,
): BiquadCoeffs {
  const nyquist = sampleRate * 0.5;
  const f0 = Math.min(Math.max(10, freq), nyquist * 0.98);
  const Q = Math.max(0.05, q);
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Q);

  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;

  switch (type) {
    case "lowpass": {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
    case "highpass": {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
    case "bandpass": {
      // Constant 0 dB peak gain.
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
    case "notch": {
      b0 = 1;
      b1 = -2 * cos;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
    case "peaking": {
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    }
    case "lowshelf": {
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos + twoSqrtAAlpha);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - twoSqrtAAlpha);
      a0 = A + 1 + (A - 1) * cos + twoSqrtAAlpha;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - twoSqrtAAlpha;
      break;
    }
    case "highshelf": {
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + twoSqrtAAlpha);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - twoSqrtAAlpha);
      a0 = A + 1 - (A - 1) * cos + twoSqrtAAlpha;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - twoSqrtAAlpha;
      break;
    }
    default: {
      const _never: never = type;
      throw new Error(`Unknown filter ${_never}`);
    }
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

/** Transposed direct form II, in place. Returns nothing; state is local (offline). */
export function processBiquadInPlace(x: Float64Array, c: BiquadCoeffs): void {
  let s1 = 0;
  let s2 = 0;
  const { b0, b1, b2, a1, a2 } = c;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i] ?? 0;
    const y0 = b0 * x0 + s1;
    s1 = b1 * x0 - a1 * y0 + s2;
    s2 = b2 * x0 - a2 * y0;
    x[i] = y0;
  }
}

export function processBiquadChainInPlace(x: Float64Array, chain: BiquadCoeffs[]): void {
  for (const c of chain) processBiquadInPlace(x, c);
}

/** Magnitude of H(e^jw) at `freq` Hz. */
export function biquadMagnitudeDb(c: BiquadCoeffs, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const br = c.b0 + c.b1 * cw + c.b2 * c2;
  const bi = -(c.b1 * sw + c.b2 * s2);
  const ar = 1 + c.a1 * cw + c.a2 * c2;
  const ai = -(c.a1 * sw + c.a2 * s2);
  const den = ar * ar + ai * ai;
  const hr = (br * ar + bi * ai) / den;
  const hi = (bi * ar - br * ai) / den;
  return 20 * Math.log10(Math.max(1e-12, Math.hypot(hr, hi)));
}

/**
 * Forward-backward filtering. Zero phase. Magnitude is |H|^2, so callers that
 * want a target curve must design H at half the desired decibel gain.
 * Mirror-padded to keep the edges from ringing into the file.
 */
export function filtfiltInPlace(x: Float64Array, chain: BiquadCoeffs[]): void {
  if (chain.length === 0 || x.length < 8) return;
  const pad = Math.min(4096, Math.floor(x.length / 2) - 1);
  if (pad < 2) {
    processBiquadChainInPlace(x, chain);
    reverseInPlace(x);
    processBiquadChainInPlace(x, chain);
    reverseInPlace(x);
    return;
  }
  const ext = new Float64Array(x.length + pad * 2);
  const x0 = x[0] ?? 0;
  const xN = x[x.length - 1] ?? 0;
  for (let i = 0; i < pad; i++) {
    ext[pad - 1 - i] = 2 * x0 - (x[i + 1] ?? x0);
    ext[pad + x.length + i] = 2 * xN - (x[x.length - 2 - i] ?? xN);
  }
  ext.set(x, pad);
  processBiquadChainInPlace(ext, chain);
  reverseInPlace(ext);
  processBiquadChainInPlace(ext, chain);
  reverseInPlace(ext);
  x.set(ext.subarray(pad, pad + x.length));
}

export function reverseInPlace(x: Float64Array): void {
  let i = 0;
  let j = x.length - 1;
  while (i < j) {
    const a = x[i] ?? 0;
    x[i] = x[j] ?? 0;
    x[j] = a;
    i++;
    j--;
  }
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(1e-12, Math.abs(gain)));
}

export function applyGainInPlace(x: Float64Array, gain: number): void {
  if (gain === 1) return;
  for (let i = 0; i < x.length; i++) x[i] = (x[i] ?? 0) * gain;
}
