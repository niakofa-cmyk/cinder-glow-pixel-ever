import { applyGainInPlace, dbToGain, gainToDb } from "./biquad.ts";
import { splitThreeBand } from "./crossover.ts";
import { compressSerialStereo, compressStereo, dynamicBandCut, shapeTransients } from "./dynamics.ts";
import { applyEqStereo } from "./eq.ts";
import { applyWidth, carveCenter } from "./imaging.ts";
import { limitStereo } from "./limiter.ts";
import { measureLoudness } from "./lufs.ts";
import { peakAbs } from "./meters.ts";
import { saturateChannel } from "./saturation.ts";
import { measureTruePeak } from "./truepeak.ts";
import type { ChainParams, ProcessReport, Stereo } from "./types.ts";

export type RenderResult = Stereo & { report: ProcessReport };

function clone(x: Float64Array): Float64Array {
  return new Float64Array(x);
}

/**
 * Offline mastering chain. Disabled stages are skipped, not approximated.
 * Order: input gain → EQ → dynamic EQ → de-ess → multiband → glue →
 * transient → saturation → width → center carve → true-peak limiter.
 */
export function renderChain(input: Stereo, params: ChainParams): RenderResult {
  const notes: string[] = [];
  const sr = input.sampleRate;
  const peakIn = measureTruePeak([input.l, input.r]);
  const loudIn = measureLoudness([input.l, input.r], sr);

  let l = clone(input.l);
  let r = clone(input.r);
  applyGainInPlace(l, dbToGain(params.inputGainDb));
  applyGainInPlace(r, dbToGain(params.inputGainDb));

  const eq = applyEqStereo(l, r, params.bands, sr, params.eqMode, params.eqTarget);
  l = eq.l;
  r = eq.r;
  if (params.eqMode === "linear") {
    notes.push("Linear-phase EQ is forward-backward filtering at half the knob gain, so the curve you see is the curve you hear. It does not shift phase. Transients can pre-ring.");
  }

  if (params.dynamicEq.enabled) {
    const d = params.dynamicEq;
    l = dynamicBandCut(l, sr, d.freq, d.q, d.thresholdDb, d.ratio, d.attackMs, d.releaseMs, d.maxCutDb);
    r = dynamicBandCut(r, sr, d.freq, d.q, d.thresholdDb, d.ratio, d.attackMs, d.releaseMs, d.maxCutDb);
  }
  if (params.deEss.enabled) {
    const d = params.deEss;
    l = dynamicBandCut(l, sr, d.freq, d.q, d.thresholdDb, d.ratio, d.attackMs, d.releaseMs, d.maxCutDb);
    r = dynamicBandCut(r, sr, d.freq, d.q, d.thresholdDb, d.ratio, d.attackMs, d.releaseMs, d.maxCutDb);
    notes.push("De-esser is split-band. It only turns down the sibilance band, and only while that band is loud.");
  }

  if (params.multiband.enabled) {
    const mb = params.multiband;
    const leftBands = splitThreeBand(l, mb.lowHz, mb.highHz, sr);
    const rightBands = splitThreeBand(r, mb.lowHz, mb.highHz, sr);
    const low = compressStereo(leftBands.low, rightBands.low, sr, mb.low);
    const mid = compressStereo(leftBands.mid, rightBands.mid, sr, mb.mid);
    const high = compressStereo(leftBands.high, rightBands.high, sr, mb.high);
    l = new Float64Array(l.length);
    r = new Float64Array(r.length);
    for (let i = 0; i < l.length; i++) {
      l[i] = (low.audioL[i] ?? 0) + (mid.audioL[i] ?? 0) + (high.audioL[i] ?? 0);
      r[i] = (low.audioR[i] ?? 0) + (mid.audioR[i] ?? 0) + (high.audioR[i] ?? 0);
    }
    notes.push(
      `Multiband crossovers are linear-phase Linkwitz–Riley 4th-order at ${mb.lowHz} Hz and ${mb.highHz} Hz. Each split is one Butterworth section forward and back, so the sum is flat and in phase with the input.`,
    );
  }

  let glueReduction = 0;
  if (params.glue.enabled) {
    const g = compressSerialStereo(l, r, sr, params.glue, params.glue.optical);
    l = g.audioL;
    r = g.audioR;
    glueReduction = g.avgReductionDb;
    notes.push(
      "Glue is two stages in series. The first is a fast RMS VCA on your threshold, ratio, attack and release. The second is a slower optical-style leveler. Optical is how much of that second stage you hear.",
    );
  }

  if (params.transient.enabled && (Math.abs(params.transient.attack) > 0.001 || Math.abs(params.transient.sustain) > 0.001)) {
    l = shapeTransients(l, sr, params.transient.attack, params.transient.sustain);
    r = shapeTransients(r, sr, params.transient.attack, params.transient.sustain);
  }

  if (params.saturation.enabled && params.saturation.mix > 0.001) {
    const s = params.saturation;
    const opts = {
      sampleRate: sr,
      memory: s.memory,
      lowColor: s.lowColor,
      highColor: s.highColor,
      tubeTapeMix: s.tubeTapeMix,
    };
    l = saturateChannel(l, s.mode, s.driveDb, s.mix, opts);
    r = saturateChannel(r, s.mode, s.driveDb, s.mix, opts);
    notes.push(
      s.mode === "tube"
        ? "Tube is an 8× oversampled asymmetric exponential plus a hysteresis play operator. Even harmonics. It is not a valve."
        : s.mode === "hybrid"
          ? "Hybrid crossfades the tube curve into tanh at 8×, then the downsampler throws away harmonics above Nyquist."
          : "Tape is an 8× oversampled tanh plus a hysteresis play operator. Odd harmonics, unity small-signal gain. It is not a tape machine.",
    );
  }

  if (Math.abs(params.width - 1) > 0.001) {
    const w = applyWidth(l, r, params.width);
    l = w.l;
    r = w.r;
  }

  if (params.carve > 0.001) {
    const carved = carveCenter(l, r, sr, params.carve, params.carveHz);
    l = carved.l;
    r = carved.r;
    notes.push(
      `Center carve ducks the side band around ${Math.round(params.carveHz)} Hz while the center of that band is loud. It does not pull a vocal out of other centered sounds.`,
    );
  }

  let limiterReduction = 0;
  let latency = 0;
  if (params.limiter.enabled) {
    const lim = limitStereo(l, r, sr, params.limiter.ceilingDb, params.limiter.releaseMs, params.limiter.lookaheadMs);
    l = lim.l;
    r = lim.r;
    limiterReduction = lim.maxReductionDb;
    latency = Math.round((params.limiter.lookaheadMs / 1000) * sr);
    if (limiterReduction < 0.05) notes.push("Limiter is armed and did not reduce gain. The signal was already under the ceiling.");
  }

  const peakOut = measureTruePeak([l, r]);
  const loudOut = measureLoudness([l, r], sr);

  return {
    l,
    r,
    sampleRate: sr,
    report: {
      samplePeakInDb: peakIn.samplePeakDb,
      samplePeakOutDb: gainToDb(Math.max(peakAbs(l), peakAbs(r))),
      truePeakInDb: peakIn.truePeakDb,
      truePeakOutDb: peakOut.truePeakDb,
      integratedIn: loudIn.integrated,
      integratedOut: loudOut.integrated,
      limiterReductionDb: limiterReduction,
      glueReductionDb: glueReduction,
      latencySamples: latency,
      notes,
    },
  };
}

/** Playback-only gain so a louder master doesn't win the comparison. Capped at ±12 dB. */
export function matchGainDb(fromLufs: number, toLufs: number): number {
  if (!Number.isFinite(fromLufs) || !Number.isFinite(toLufs)) return 0;
  return Math.max(-12, Math.min(12, toLufs - fromLufs));
}
