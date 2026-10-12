import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { cpus, availableParallelism, platform, release, arch } from "node:os";
import { parseOptions, outputPath } from "./benchmark/config.mjs";
import { scenarioParams } from "./benchmark/scenarios.mjs";
import { runTrial } from "./benchmark/engine.mjs";
import { summarizeTrials } from "./benchmark/stats.mjs";

const options = parseOptions(process.argv.slice(2));
const report = {
  version: 1, generatedAt: new Date().toISOString(),
  environment: { node: process.version, v8: process.versions.v8, platform: platform(),
    osRelease: release(), arch: arch(), cpuModel: cpus()[0]?.model ?? "unknown",
    availableParallelism: availableParallelism(), forcedGcAvailable: Boolean(globalThis.gc) },
  configuration: options,
  fixture: { kind: "seeded, repeated one-second stereo tones/noise/transients", seed: 0x41555241 },
  limitations: [
    "Node measurements are not browser AudioWorklet timing, actual underruns or device certification.",
    "Processing timers exclude harness copying/validation; CPU and whole-run wall time include the harness.",
    "Budget exceedances compare engine-only calls with nominal block duration, not real audio callbacks.",
    "Memory is process-wide and sampled; deltas do not establish a leak or prove zero allocations.",
    "Ablation deltas are comparative hints, not isolated stage CPU attribution; JIT, GC and scheduling affect results.",
    "Virtual audio time runs faster or slower than wall time. Repeated synthetic material is not representative music.",
    "This does not benchmark worker startup/cancellation or UI responsiveness. Those have separate browser tests.",
  ],
  cases: [], soak: [], comparisons: [],
};
for (const sampleRate of options.rates) {
  for (const id of options.scenarios) {
    const params = scenarioParams(id), trials = [];
    for (let repeat = 0; repeat < options.repeats; repeat++) {
      console.log(`Measuring ${sampleRate} Hz / ${id} / trial ${repeat + 1}…`);
      trials.push(runTrial({ sampleRate, block: options.block, seconds: options.duration, warmup: options.warmup, params }));
    }
    const summary = summarizeTrials(trials);
    report.cases.push({ sampleRate, id, params, trials, summary });
    console.log(`  median ${summary.medianRealtimeFactor.toFixed(2)}× engine-only real-time factor`);
  }
  if (options.soak) {
    console.log(`Stressing ${sampleRate} Hz / ${options.soak}s virtual audio / setting changes…`);
    report.soak.push(runTrial({ sampleRate, block: options.block, seconds: options.soak,
      warmup: options.warmup, params: scenarioParams("full-linear"), changeEvery: options.changeEvery }));
  }
  const baseline = report.cases.find(c => c.sampleRate === sampleRate && c.id === "full-linear");
  if (baseline) for (const other of report.cases.filter(c => c.sampleRate === sampleRate && c.id !== "full-linear")) {
    const delta = baseline.summary.medianEngineMs - other.summary.medianEngineMs;
    report.comparisons.push({ sampleRate, baseline: baseline.id, scenario: other.id,
      medianEngineMsDelta: delta, relativeReductionPct: delta / baseline.summary.medianEngineMs * 100 });
  }
}
report.configuration.output = options.output ?? outputPath(resolve("generated-artifacts/benchmarks",
  `engine-${report.generatedAt.replace(/[:.]/g, "-")}.json`));
await mkdir(dirname(report.configuration.output), { recursive: true });
await writeFile(report.configuration.output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(`Benchmark report: ${report.configuration.output}`);
