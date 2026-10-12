import assert from "node:assert/strict";
import { it } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { parseOptions, outputPath } from "./benchmark/config.mjs";
import { scenarioParams, changedParams, syntheticLoop, SCENARIOS } from "./benchmark/scenarios.mjs";
import { runTrial } from "./benchmark/engine.mjs";
import { distribution, summarizeTrials } from "./benchmark/stats.mjs";

it("benchmark defaults use live-sized blocks, repeat trials and a five-minute virtual soak", () => {
  const options = parseOptions([]);
  assert.equal(options.block, 128);
  assert.equal(options.repeats, 3);
  assert.equal(options.soak, 300);
  assert.deepEqual(options.rates, [48000, 96000]);
  assert.deepEqual(options.scenarios, SCENARIOS);
});
it("benchmark options are explicit, bounded and reject malformed or unknown values", () => {
  for (const args of [
    ["--duration=NaN"], ["--duration=0"], ["--repeats=1.5"], ["--warmup=-1"],
    ["--block=0"], ["--soak=3601"], ["--rates=0"], ["--rates=48000,48000"],
    ["--rates=44100.5"], ["--scenarios=unknown"], ["--scenarios=neutral,neutral"],
    ["--unknown=1"], ["--constructor=1"], ["--duration=1", "--duration=2"], ["--soak="],
  ]) assert.throws(() => parseOptions(args));
  const parsed = parseOptions(["--soak=0", "--rates=44100", "--scenarios=full-linear"]);
  assert.equal(parsed.soak, 0); assert.deepEqual(parsed.rates, [44100]);
});
it("generated reports cannot overwrite source files or escape the ignored benchmark directory", () => {
  assert.equal(outputPath("generated-artifacts/benchmarks/check.json"), resolve("generated-artifacts/benchmarks/check.json"));
  for (const path of ["src/dsp/test.json", "generated-artifacts/benchmarks/../test.json",
    "generated-artifacts/benchmarks", "generated-artifacts/benchmarks/test.txt"])
    assert.throws(() => outputPath(path));
});
it("timing distributions use declared interpolated quantiles and preserve outliers", () => {
  const result = distribution([4, 1, 2, 100, 3]);
  assert.equal(result.totalMs, 110); assert.equal(result.p50Ms, 3); assert.equal(result.maxMs, 100);
  assert.ok(Math.abs(result.p95Ms - 80.8) < 1e-9);
  assert.throws(() => distribution([])); assert.throws(() => distribution([NaN]));
  assert.throws(() => distribution([-1]));
  const summary = summarizeTrials([
    { processTiming: { totalMs: 10, p99Ms: 2 }, realtimeFactor: 100 },
    { processTiming: { totalMs: 20, p99Ms: 4 }, realtimeFactor: 50 },
    { processTiming: { totalMs: 30, p99Ms: 6 }, realtimeFactor: 33 },
  ]);
  assert.equal(summary.medianEngineMs, 20);
  assert.equal(summary.medianRealtimeFactor, 50);
  assert.equal(summary.medianOfTrialP99BlockMs, 4);
});
it("synthetic input and ablation settings are repeatable, fresh and differ only as declared", () => {
  const a = syntheticLoop(8000), b = syntheticLoop(8000);
  assert.deepEqual(a.l, b.l); assert.deepEqual(a.r, b.r);
  assert.notDeepEqual(a.l, a.r);
  assert.ok(a.l.every(x => Number.isFinite(x) && Math.abs(x) < 1));
  const full = scenarioParams("full-linear");
  const without = scenarioParams("linear-without-saturation");
  assert.deepEqual({ ...without, saturation: full.saturation }, full);
  without.saturation.memory = 0;
  assert.notEqual(scenarioParams("full-linear").saturation.memory, 0);
  assert.throws(() => scenarioParams("made-up"));
  assert.equal(changedParams(0).eqMode, "linear");
  assert.equal(changedParams(1).eqMode, "minimum");
  assert.equal(changedParams(2).eqTarget, "side");
});
it("actual engine benchmark stays finite, preserves source and samples memory without timing gates", () => {
  const result = runTrial({ sampleRate: 48000, block: 128, seconds: 0.3, warmup: 0.1,
    params: scenarioParams("full-linear"), changeEvery: 0.08 });
  assert.deepEqual(result.correctness, { finiteOutput: true, sourceUnchanged: true, recovered: false, latencyConstant: true });
  assert.equal(result.frames, 14400); assert.equal(result.processTiming.count, 113);
  assert.equal(result.parameterUpdates, 3);
  assert.equal(result.updateTiming.count, 3);
  assert.ok(result.outputRms > 0 && Number.isFinite(result.realtimeFactor));
  assert.ok(result.memory.samples.length >= 2);
  assert.equal(result.memory.samples.at(-1).audioSeconds, result.audioSeconds);
  assert.ok(result.processTiming.maxMs >= result.processTiming.p99Ms);
  assert.ok(Number.isInteger(result.engineOnlyBudgetExceedances));
});
it("CLI writes a versioned complete report and permits explicitly skipping the soak", () => {
  const path = `generated-artifacts/benchmarks/test-${process.pid}.json`;
  try {
    const command = spawnSync(process.execPath, ["scripts/benchmark-engine.mjs",
      "--duration=0.06", "--warmup=0.1", "--repeats=1", "--rates=48000",
      "--scenarios=neutral,full-linear", "--soak=0", `--output=${path}`],
    { encoding: "utf8", timeout: 30000 });
    assert.equal(command.status, 0, command.stderr);
    const report = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(report.version, 1); assert.equal(report.cases.length, 2);
    assert.equal(report.soak.length, 0); assert.equal(report.comparisons.length, 1);
    assert.equal(report.cases[1].params.eqMode, "linear");
    assert.match(report.limitations.join(" "), /not browser AudioWorklet/);
    assert.equal(report.configuration.output, resolve(path));
    assert.equal(report.environment.node, process.version);
  } finally { rmSync(path, { force: true }); }
});
