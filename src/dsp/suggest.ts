import { neutralParams } from "./presets.ts";
import type { Analysis, ChainParams, Finding } from "./types.ts";

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

/**
 * Evidence-backed notes. Nothing here is applied until the user auditions it.
 * Suggestions prefer a small cut or a dynamic move over a permanent boost.
 */
export function suggest(analysis: Analysis, targetLufs = -14): Finding[] {
  const base = neutralParams();
  const findings: Finding[] = [];

  // The analyzer floors gain-to-dB at 1e-12 (-240 dB), including exact silence.
  if (analysis.rmsDb <= -240 && analysis.samplePeakDb <= -240) {
    return [{
      id: "silent",
      title: "No measurable signal to assess",
      evidence: "RMS and sample peak are at the analyzer's -240 dB floor. Loudness and stereo interpretation are unavailable.",
      action: "Check the imported file and source selection before adding processing.",
      sideEffect: "No processing proposed. EQ, width and limiting cannot create a missing recording.",
      confidence: "high",
      patch: null,
    }];
  }
  if (!Number.isFinite(analysis.integratedLufs)) {
    findings.push({
      id: "loudness-unavailable",
      title: "Integrated loudness is unavailable",
      evidence: "The loudness gate did not yield a finite reading. Short or very quiet recordings can fall below the measurement gate.",
      action: "Check the source and audition it. Do not infer a required gain increase from an unavailable reading.",
      sideEffect: "Other measured findings may still apply; no loudness adjustment is proposed.",
      confidence: "high",
      patch: null,
    });
  }

  if (analysis.clippedSamples > 0) {
    findings.push({
      id: "clip",
      title: "The file is already clipped",
      evidence: `${analysis.clippedSamples} samples at or above full scale. Sample peak ${fmt(analysis.samplePeakDb)} dBFS, true peak ${fmt(analysis.truePeakDb)} dBTP.`,
      action: "Fix this in the mix. A limiter cannot restore flattened peaks.",
      sideEffect: "No processing suggestion. Reconstruction would be a guess.",
      confidence: "high",
      patch: null,
    });
  }

  if (Math.abs(analysis.dcL) > 0.002 || Math.abs(analysis.dcR) > 0.002) {
    const bands = base.bands.map((b) => (b.id === "hp" ? { ...b, enabled: true, freq: 18, q: 0.707 } : b));
    findings.push({
      id: "dc",
      title: "DC offset",
      evidence: `Left mean ${analysis.dcL.toExponential(2)}, right mean ${analysis.dcR.toExponential(2)}.`,
      action: "Audition a gentle 18 Hz high-pass. It removes the offset without a loud tonal change.",
      sideEffect: "A high-pass this low can soften the very deepest sub hit.",
      confidence: "high",
      patch: { bands },
    });
  }

  const loudGap = targetLufs - analysis.integratedLufs;
  if (Number.isFinite(analysis.integratedLufs) && loudGap > 1.5) {
    findings.push({
      id: "quiet",
      title: "Quieter than the streaming target",
      evidence: `Integrated loudness is ${fmt(analysis.integratedLufs)} LUFS. The selected target is ${fmt(targetLufs, 0)} LUFS, about ${fmt(loudGap)} LU lower. True peak is ${fmt(analysis.truePeakDb)} dBTP.`,
      action:
        loudGap > 8
          ? "Do not make up this entire gap with the limiter. Raise the mix level, then limit the last 3–6 dB."
          : "A few dB of input gain into the −1 dBTP limiter will close most of the gap. Listen for dulling of transients.",
      sideEffect: "More limiting lowers crest factor. Punch goes before loudness does.",
      confidence: loudGap > 8 ? "high" : "medium",
      patch:
        loudGap > 8
          ? { inputGainDb: 4 }
          : { inputGainDb: Math.min(6, Math.max(0, loudGap - 0.5)) },
    });
  } else if (Number.isFinite(analysis.integratedLufs) && analysis.integratedLufs > targetLufs + 1) {
    findings.push({
      id: "hot",
      title: "Hotter than the streaming target",
      evidence: `Integrated loudness is ${fmt(analysis.integratedLufs)} LUFS against a ${fmt(targetLufs, 0)} LUFS target. Crest factor is ${fmt(analysis.crestDb)} dB.`,
      action: "Turn the input down. Streaming encoders will turn it down anyway, often with their own limiter.",
      sideEffect: "None beyond level. You keep the dynamics you already printed.",
      confidence: "high",
      patch: { inputGainDb: Math.max(-12, targetLufs - analysis.integratedLufs) },
    });
  }

  if (analysis.truePeakDb > -0.3) {
    findings.push({
      id: "tp",
      title: "True peak is high",
      evidence: `True peak ${fmt(analysis.truePeakDb)} dBTP, sample peak ${fmt(analysis.samplePeakDb)} dBFS. The gap is inter-sample overshoot.`,
      action: "Leave the limiter ceiling at −1.0 dBTP or lower before a lossy encode.",
      sideEffect: "Lookahead limiting can soften the initial transient if it is working hard.",
      confidence: "high",
      patch: { limiter: { ...base.limiter, enabled: true, ceilingDb: -1 } },
    });
  }

  if (analysis.correlation < 0.2) {
    findings.push({
      id: "phase",
      title: "Stereo correlation is low",
      evidence: `Correlation ${fmt(analysis.correlation, 2)}. Side energy is ${fmt(analysis.sideEnergyRatio * 100, 0)}% of the mid/side total.`,
      action: "Hit Mono in the transport and listen. Narrow the width if the chorus or vocal thins out.",
      sideEffect: "Width below 1.0 pulls the side toward the center. It does not remix individual instruments.",
      confidence: analysis.correlation < 0 ? "high" : "medium",
      patch: { width: 0.7 },
    });
  }

  if (analysis.subEnergyRatio > 0.35) {
    findings.push({
      id: "sub",
      title: "A lot of energy sits below 80 Hz",
      evidence: `${fmt(analysis.subEnergyRatio * 100, 0)}% of the measured spectral power is between 20 and 80 Hz. Small speakers will not reproduce it.`,
      action: "Use the small-speaker monitor. If the bass part vanishes, the part is living only in the sub — check the octave above, not just the level.",
      sideEffect: "This is a monitoring check, not a cut. A high-pass is a separate decision.",
      confidence: "medium",
      patch: null,
    });
  }

  const ess = analysis.sibilanceDb - analysis.presenceDb;
  if (ess > 3) {
    findings.push({
      id: "ess",
      title: "Sibilance band outweighs presence",
      evidence: `5–10 kHz averages ${fmt(analysis.sibilanceDb)} dB, presence (2–5 kHz) averages ${fmt(analysis.presenceDb)} dB, a ${fmt(ess)} dB tilt toward the ess band.`,
      action: "Audition the split-band de-esser before adding a high shelf. Brightness that comes from 7–9 kHz is often harshness, not clarity.",
      sideEffect: "Too much de-essing dulls consonants and cymbals together, because this stage does not know which is which.",
      confidence: "medium",
      patch: {
        deEss: { ...base.deEss, enabled: true, thresholdDb: -32, maxCutDb: 3, freq: 7500 },
      },
    });
  }

  const top = analysis.resonances[0];
  if (top && top.excessDb >= 6) {
    const bands = base.bands.map((b) =>
      b.id === "mud" || b.id === "presence"
        ? b.id === "mud"
          ? { ...b, type: "peaking" as const, freq: Math.round(top.freq), gainDb: -Math.min(3, top.excessDb / 2), q: 2.2, enabled: true }
          : b
        : b,
    );
    findings.push({
      id: "resonance",
      title: `Narrow rise near ${Math.round(top.freq)} Hz`,
      evidence: `That third is ${fmt(top.excessDb)} dB above its neighbors, at ${fmt(top.levelDb)} dB. A resonance can be a snare, a voice, or a problem. The measurement cannot tell.`,
      action: `Audition a −${fmt(Math.min(3, top.excessDb / 2))} dB bell, Q 2.2, and bypass it. Keep it only if the note stops honking and the instrument still sounds like itself.`,
      sideEffect: "A static cut is always on, including in sections where the resonance is not.",
      confidence: "low",
      patch: { bands },
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "clear",
      title: "No obvious technical fault",
      evidence: `Integrated ${fmt(analysis.integratedLufs)} LUFS, true peak ${fmt(analysis.truePeakDb)} dBTP, correlation ${fmt(analysis.correlation, 2)}, crest ${fmt(analysis.crestDb)} dB.`,
      action: "If you still dislike it, the reason is musical. Compare against your reference at matched loudness before adding processing.",
      sideEffect: "None.",
      confidence: "medium",
      patch: null,
    });
  }

  return findings;
}

export function applyPatch(current: ChainParams, patch: Partial<ChainParams>): ChainParams {
  return {
    ...current,
    ...patch,
    bands: patch.bands ?? current.bands,
    dynamicEq: patch.dynamicEq ?? current.dynamicEq,
    deEss: patch.deEss ?? current.deEss,
    multiband: patch.multiband ?? current.multiband,
    glue: patch.glue ?? current.glue,
    transient: patch.transient ?? current.transient,
    saturation: patch.saturation ?? current.saturation,
    limiter: patch.limiter ?? current.limiter,
  };
}
