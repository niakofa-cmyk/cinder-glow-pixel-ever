export function distribution(values) {
  if (!values.length || values.some(x => !Number.isFinite(x) || x < 0))
    throw new Error("Timing samples must be nonempty, finite and nonnegative.");
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => {
    const position = (sorted.length - 1) * p;
    const lo = Math.floor(position), fraction = position - lo;
    return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * fraction;
  };
  return { count: values.length, totalMs: values.reduce((a, b) => a + b, 0),
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), maxMs: sorted.at(-1) };
}

export function summarizeTrials(trials) {
  const times = distribution(trials.map(t => t.processTiming.totalMs));
  return {
    medianEngineMs: times.p50Ms, minEngineMs: Math.min(...trials.map(t => t.processTiming.totalMs)),
    maxEngineMs: times.maxMs,
    medianRealtimeFactor: distribution(trials.map(t => t.realtimeFactor)).p50Ms,
    medianOfTrialP99BlockMs: distribution(trials.map(t => t.processTiming.p99Ms)).p50Ms,
  };
}
