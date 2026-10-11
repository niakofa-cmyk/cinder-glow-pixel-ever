import { designBiquad, filtfiltInPlace, processBiquadInPlace } from "./biquad.ts";
import type { BiquadCoeffs } from "./types.ts";

/**
 * Linkwitz–Riley 4th-order magnitude is |H|² of one Butterworth 2nd-order
 * section (Q = 1/√2). Running that section forward and back makes the phase
 * zero, so band sums do not smear or cancel at the crossover. Short buffers
 * fall back to two cascaded minimum-phase sections — filtfilt needs room to pad.
 */
function butterworth2(kind: "lowpass" | "highpass", freq: number, sampleRate: number): BiquadCoeffs {
  return designBiquad(kind, freq, Math.SQRT1_2, 0, sampleRate);
}

function minimumPhaseLr4(x: Float64Array, section: BiquadCoeffs): void {
  processBiquadInPlace(x, section);
  processBiquadInPlace(x, section);
}

export function linkwitzRiley4InPlace(
  x: Float64Array,
  kind: "lowpass" | "highpass",
  freq: number,
  sampleRate: number,
): void {
  const section = butterworth2(kind, freq, sampleRate);
  if (x.length < 32) {
    minimumPhaseLr4(x, section);
    return;
  }
  filtfiltInPlace(x, [section]);
}

export function splitLinkwitzRiley4(
  x: Float64Array,
  freq: number,
  sampleRate: number,
): { low: Float64Array; high: Float64Array } {
  const low = new Float64Array(x);
  const high = new Float64Array(x);
  linkwitzRiley4InPlace(low, "lowpass", freq, sampleRate);
  linkwitzRiley4InPlace(high, "highpass", freq, sampleRate);
  return { low, high };
}

/** Zero-phase LR4 low+high is unity, not an allpass. The sum is the reconstruction. */
export function linkwitzRileyAllpass(x: Float64Array, freq: number, sampleRate: number): Float64Array {
  const { low, high } = splitLinkwitzRiley4(x, freq, sampleRate);
  const y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = (low[i] ?? 0) + (high[i] ?? 0);
  return y;
}

/**
 * Three-band split. Because every band is zero-phase, the low band does not
 * need the upper crossover's allpass — low + mid + high reconstructs flat.
 */
export function splitThreeBand(
  x: Float64Array,
  lowHz: number,
  highHz: number,
  sampleRate: number,
): { low: Float64Array; mid: Float64Array; high: Float64Array } {
  const first = splitLinkwitzRiley4(x, lowHz, sampleRate);
  const second = splitLinkwitzRiley4(first.high, highHz, sampleRate);
  return { low: first.low, mid: second.low, high: second.high };
}

export function sumBands(bands: Float64Array[]): Float64Array {
  const n = bands[0]?.length ?? 0;
  const y = new Float64Array(n);
  for (const b of bands) {
    for (let i = 0; i < n; i++) y[i] = (y[i] ?? 0) + (b[i] ?? 0);
  }
  return y;
}
