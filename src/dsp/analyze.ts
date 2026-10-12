import { gainToDb } from "./biquad.ts";
import { thirdOctaveFromSpectrum, welchSpectrumDb } from "./fft.ts";
import { measureLoudness } from "./lufs.ts";
import { bandEnergyRatio, countClipped, mean, peakAbs, rms, sideEnergyRatio, stereoCorrelation } from "./meters.ts";
import { measureTruePeak } from "./truepeak.ts";
import type { Analysis, Resonance, ThirdOctave } from "./types.ts";

function bandDb(thirds: ThirdOctave[], lo: number, hi: number): number {
  const slice = thirds.filter((t) => t.freq >= lo && t.freq <= hi);
  if (slice.length === 0) return -120;
  const power = slice.reduce((s, t) => s + Math.pow(10, t.db / 10), 0) / slice.length;
  return 10 * Math.log10(Math.max(1e-12, power));
}

function findResonances(thirds: ThirdOctave[]): Resonance[] {
  const found: Resonance[] = [];
  for (let i = 2; i < thirds.length - 2; i++) {
    const level = thirds[i]?.db ?? -120;
    const neighbors = [
      thirds[i - 2]?.db ?? level,
      thirds[i - 1]?.db ?? level,
      thirds[i + 1]?.db ?? level,
      thirds[i + 2]?.db ?? level,
    ];
    const floor = neighbors.reduce((s, v) => s + v, 0) / neighbors.length;
    const excess = level - floor;
    if (excess >= 4.5 && level > -48) {
      found.push({ freq: thirds[i]?.freq ?? 0, excessDb: excess, levelDb: level });
    }
  }
  return found.sort((a, b) => b.excessDb - a.excessDb).slice(0, 6);
}

/** Full Phase-1 measurement. Mono files should pass the same buffer as L and R. */
export function analyze(l: ArrayLike<number>, r: ArrayLike<number>, sampleRate: number): Analysis {
  const loud = measureLoudness([l, r], sampleRate);
  const peaks = measureTruePeak([l, r]);
  const spec = welchSpectrumDb(l, sampleRate, 8192, 4096);
  // Average channel power, not waveforms: mono summing would hide anti-phase
  // material, and inspecting only L would miss right-channel problems.
  if (l !== r) {
    const right = welchSpectrumDb(r, sampleRate, 8192, 4096);
    for (let i = 0; i < spec.db.length; i++) {
      // Welch floors amplitude at 1e-12, therefore power at 1e-24.
      spec.db[i] = 10 * Math.log10(Math.max(1e-24,
        (10 ** (spec.db[i]! / 10) + 10 ** (right.db[i]! / 10)) / 2));
    }
  }
  const thirds = thirdOctaveFromSpectrum(spec.db, spec.binHz, sampleRate);
  const rmsVal = Math.sqrt(0.5 * (rms(l) ** 2 + rms(r) ** 2));
  const peak = Math.max(peakAbs(l), peakAbs(r));
  return {
    sampleRate,
    durationSec: l.length / sampleRate,
    channels: 2,
    integratedLufs: loud.integrated,
    shortTermMaxLufs: loud.shortTermMax,
    momentaryMaxLufs: loud.momentaryMax,
    loudnessRange: loud.range,
    samplePeakDb: peaks.samplePeakDb,
    truePeakDb: peaks.truePeakDb,
    crestDb: gainToDb(peak / Math.max(1e-12, rmsVal)),
    rmsDb: gainToDb(rmsVal),
    correlation: stereoCorrelation(l, r),
    dcL: mean(l),
    dcR: mean(r),
    clippedSamples: countClipped(l) + countClipped(r),
    sideEnergyRatio: sideEnergyRatio(l, r),
    subEnergyRatio: bandEnergyRatio(spec.db, spec.binHz, 20, 80),
    presenceDb: bandDb(thirds, 2000, 5000),
    sibilanceDb: bandDb(thirds, 5000, 10000),
    thirds,
    resonances: findResonances(thirds),
    spectrumDb: spec.db,
    spectrumFreq0: spec.binHz,
    spectrumBinHz: spec.binHz,
  };
}

/** Shape comparison. Each curve is centered on its own mean so level doesn't masquerade as tone. */
export function spectralDelta(
  program: ThirdOctave[],
  reference: ThirdOctave[],
): { freq: number; deltaDb: number; programDb: number; referenceDb: number }[] {
  const n = Math.min(program.length, reference.length);
  const p = program.slice(0, n);
  const r = reference.slice(0, n);
  const meanP = p.reduce((s, b) => s + b.db, 0) / Math.max(1, n);
  const meanR = r.reduce((s, b) => s + b.db, 0) / Math.max(1, n);
  return p.map((band, i) => {
    const ref = r[i];
    const pDb = band.db - meanP;
    const rDb = (ref?.db ?? band.db) - meanR;
    return {
      freq: band.freq,
      deltaDb: pDb - rDb,
      programDb: pDb,
      referenceDb: rDb,
    };
  });
}
