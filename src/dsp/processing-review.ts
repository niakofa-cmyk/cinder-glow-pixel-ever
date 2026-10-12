/** A technical comparison, never a score or a verdict about musical quality. */
export type ReviewMeasurements = {
  integratedLufs: number | null;
  truePeakDb: number | null;
  samplePeakDb: number | null;
  crestDb: number | null;
  correlation: number | null;
  rmsDb: number | null;
};

export type ReviewCheck = {
  id: string;
  title: string;
  level: "attention" | "info" | "unavailable";
  evidence: string;
};

export type ProcessingReview = {
  version: 1;
  status: "attention" | "no-new-flags" | "unavailable";
  criteria: {
    targetLufs: number;
    ceilingDb: number;
    peakToleranceDb: number;
    crestDropDb: number;
    correlationDrop: number;
    lowCorrelation: number;
    loudnessDistanceIncreaseLu: number;
  };
  checks: ReviewCheck[];
  limitations: string[];
};

const available = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);
const fmt = (n: number, digits = 1) => n.toFixed(digits);

export function reviewProcessing(
  original: ReviewMeasurements | null,
  output: ReviewMeasurements,
  options: { targetLufs: number; ceilingDb: number },
): ProcessingReview {
  if (!available(options.targetLufs) || !available(options.ceilingDb))
    throw new Error("Processing review needs finite loudness and peak guidelines.");
  const criteria = {
    ...options, peakToleranceDb: 0.15, crestDropDb: 3,
    correlationDrop: 0.1, lowCorrelation: 0.2, loudnessDistanceIncreaseLu: 1,
  };
  const checks: ReviewCheck[] = [];
  const add = (id: string, title: string, level: ReviewCheck["level"], evidence: string) =>
    checks.push({ id, title, level, evidence });
  const missing = (id: string, title: string) =>
    add(id, title, "unavailable", "A required source or export measurement is unavailable; this check cannot make a comparison.");

  if (available(output.samplePeakDb)) {
    add("full-scale", "Sample headroom", output.samplePeakDb >= 0 ? "attention" : "info",
      `Encoded sample peak ${fmt(output.samplePeakDb)} dBFS. ${
        output.samplePeakDb >= 0 ? "At or above full scale: reduce gain before fixed-point or lossy conversion." : "Below full scale; this alone does not rule out inter-sample peaks."
      }`);
  } else missing("full-scale", "Sample headroom");

  if (available(output.truePeakDb)) {
    const exceeds = output.truePeakDb > criteria.ceilingDb + criteria.peakToleranceDb;
    add("peak-guideline", "True-peak guideline", exceeds ? "attention" : "info",
      `Encoded true peak ${fmt(output.truePeakDb)} dBTP; selected ceiling ${fmt(criteria.ceilingDb)} dBTP ${
        exceeds ? "is exceeded. Check gain and limiter settings." : "is not exceeded beyond the review tolerance."
      } Measurement tolerance ${criteria.peakToleranceDb} dB, not independent certification.`);
  } else missing("peak-guideline", "True-peak guideline");

  if (available(original?.truePeakDb) && available(output.truePeakDb)) {
    const change = output.truePeakDb - original.truePeakDb;
    add("peak-change", "Peak change", change > 0.3 && output.truePeakDb > criteria.ceilingDb + criteria.peakToleranceDb ? "attention" : "info",
      `True peak changed ${fmt(change)} dB from the original. ${
        change > 0.3 ? "More peak level is not evidence of better sound." : "Compare transient character by listening."
      }`);
  } else missing("peak-change", "Peak change");

  if (available(original?.crestDb) && available(output.crestDb)) {
    const drop = original.crestDb - output.crestDb;
    add("crest-change", "Dynamics tradeoff", drop >= criteria.crestDropDb ? "attention" : "info",
      `Crest factor ${fmt(original.crestDb)} → ${fmt(output.crestDb)} dB (${fmt(drop)} dB reduction). ${
        drop >= criteria.crestDropDb ? "Noticeable reduction: audition transients at matched loudness; compression may be intentional." : "No large crest reduction flagged; crest is not a complete dynamics measure."
      }`);
  } else missing("crest-change", "Dynamics tradeoff");

  if (available(original?.correlation) && available(output.correlation)) {
    const drop = original.correlation - output.correlation;
    const risk = output.correlation < 0 || (output.correlation < criteria.lowCorrelation && drop >= criteria.correlationDrop);
    add("stereo-change", "Mono compatibility", risk ? "attention" : "info",
      `Stereo correlation ${fmt(original.correlation, 3)} → ${fmt(output.correlation, 3)}. ${
        risk ? "Low or negative output correlation: check mono for disappearing material." : "No additional correlation risk flagged."
      } Whole-track correlation can hide section-specific cancellation; always audition mono.`);
  } else missing("stereo-change", "Mono compatibility");

  if (available(original?.integratedLufs) && available(output.integratedLufs)) {
    const before = Math.abs(original.integratedLufs - criteria.targetLufs);
    const after = Math.abs(output.integratedLufs - criteria.targetLufs);
    add("loudness-target", "Loudness guideline", after - before > criteria.loudnessDistanceIncreaseLu ? "attention" : "info",
      `Integrated ${fmt(original.integratedLufs)} → ${fmt(output.integratedLufs)} LUFS; distance from ${fmt(criteria.targetLufs)} LUFS ${
        after < before ? "decreased" : after > before ? "increased" : "is unchanged"
      } (${fmt(before)} → ${fmt(after)} LU). A guideline is optional; closer or louder is not necessarily better.`);
  } else missing("loudness-target", "Loudness guideline");

  return {
    version: 1,
    status: checks.some(c => c.level === "attention") ? "attention"
      : checks.some(c => c.level === "unavailable") ? "unavailable" : "no-new-flags",
    criteria,
    checks,
    limitations: [
      "Deterministic measurement rules, not a trained AI model, artistic rating or certification.",
      "Source analysis compared with the actual encoded WAV; audition at matched loudness before deciding.",
      "These whole-track metrics cannot identify individual vocals, instruments, masking or section-specific problems.",
      "A flagged tradeoff may be intentional. No settings are automatically changed and no export is blocked.",
    ],
  };
}
