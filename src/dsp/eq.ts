import {
  biquadMagnitudeDb,
  designBiquad,
  filtfiltInPlace,
  processBiquadChainInPlace,
} from "./biquad.ts";
import { decodeMidSide, encodeMidSide } from "./imaging.ts";
import type { BiquadCoeffs, EqBand } from "./types.ts";

export function bandIsActive(band: EqBand): boolean {
  if (!band.enabled) return false;
  if (band.type === "lowpass" || band.type === "highpass" || band.type === "notch" || band.type === "bandpass") {
    return true;
  }
  return Math.abs(band.gainDb) >= 0.05;
}

function coeffsFor(band: EqBand, sampleRate: number, gainScale: number): BiquadCoeffs {
  return designBiquad(band.type, band.freq, band.q, band.gainDb * gainScale, sampleRate);
}

/** Minimum-phase cascade, in place. Linear-phase uses forward-backward at half gain. */
export function applyEqChannel(x: Float64Array, bands: EqBand[], sampleRate: number, mode: "minimum" | "linear"): void {
  const active = bands.filter(bandIsActive);
  if (active.length === 0) return;
  if (mode === "linear") {
    const chain = active.map((b) => coeffsFor(b, sampleRate, 0.5));
    filtfiltInPlace(x, chain);
    return;
  }
  processBiquadChainInPlace(
    x,
    active.map((b) => coeffsFor(b, sampleRate, 1)),
  );
}

export function applyEqStereo(
  l: Float64Array,
  r: Float64Array,
  bands: EqBand[],
  sampleRate: number,
  mode: "minimum" | "linear",
  target: "stereo" | "mid" | "side",
): { l: Float64Array; r: Float64Array } {
  if (target === "stereo") {
    const outL = new Float64Array(l);
    const outR = new Float64Array(r);
    applyEqChannel(outL, bands, sampleRate, mode);
    applyEqChannel(outR, bands, sampleRate, mode);
    return { l: outL, r: outR };
  }
  const ms = encodeMidSide(l, r);
  if (target === "mid") applyEqChannel(ms.mid, bands, sampleRate, mode);
  else applyEqChannel(ms.side, bands, sampleRate, mode);
  return decodeMidSide(ms.mid, ms.side);
}

/** Realized magnitude in dB. Linear-phase plots |H_half|² so the curve matches what filtfilt does. */
export function eqCurveDb(
  bands: EqBand[],
  sampleRate: number,
  mode: "minimum" | "linear",
  points = 240,
): { freq: number; db: number }[] {
  const active = bands.filter(bandIsActive);
  const out: { freq: number; db: number }[] = [];
  const nyquist = sampleRate * 0.45;
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const freq = 20 * Math.pow(nyquist / 20, t);
    let db = 0;
    if (mode === "minimum") {
      for (const b of active) db += biquadMagnitudeDb(coeffsFor(b, sampleRate, 1), freq, sampleRate);
    } else {
      for (const b of active) db += 2 * biquadMagnitudeDb(coeffsFor(b, sampleRate, 0.5), freq, sampleRate);
    }
    out.push({ freq, db });
  }
  return out;
}
