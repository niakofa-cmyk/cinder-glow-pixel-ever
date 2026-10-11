import { processBiquadInPlace } from "./biquad.ts";
import type { BiquadCoeffs } from "./types.ts";

/**
 * K-weighting (ITU-R BS.1770): a high shelf (~+4 dB, 1.7 kHz) followed by an
 * RLB high-pass (~38 Hz). Coefficient design matches libebur128, which is
 * built to hit the EBU Tech 3341 1 kHz / -23 LUFS alignment tone.
 */
export function kWeightingCoeffs(sampleRate: number): { shelf: BiquadCoeffs; highpass: BiquadCoeffs } {
  const db = 3.999843853973347;
  let f0 = 1681.974450955533;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, db / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: BiquadCoeffs = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };

  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highpass: BiquadCoeffs = {
    b0: 1 / a0,
    b1: -2 / a0,
    b2: 1 / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  return { shelf, highpass };
}

export function applyKWeightingInPlace(x: Float64Array, sampleRate: number): void {
  const { shelf, highpass } = kWeightingCoeffs(sampleRate);
  processBiquadInPlace(x, shelf);
  processBiquadInPlace(x, highpass);
}
