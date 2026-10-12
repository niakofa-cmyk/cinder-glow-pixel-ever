import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { RealtimeEngine } from "../../src/dsp/rt/engine.ts";
import { changedParams, syntheticLoop } from "./scenarios.mjs";
import { distribution } from "./stats.mjs";

const memory = () => {
  const { rss, heapUsed, external, arrayBuffers } = process.memoryUsage();
  return { rss, heapUsed, external, arrayBuffers };
};
const hash = fixture => createHash("sha256").update(new Uint8Array(fixture.l.buffer))
  .update(new Uint8Array(fixture.r.buffer)).digest("hex");

/**
 * Measures Node engine calls, not AudioWorklet deadlines or audible dropouts.
 * Harness input copying, validation and memory sampling are outside process timers.
 */
export function runTrial({ sampleRate, block, seconds, warmup, params, changeEvery = null }) {
  const fixture = syntheticLoop(sampleRate), originalHash = hash(fixture);
  const setupStart = performance.now();
  const engine = new RealtimeEngine(sampleRate, block);
  engine.setParams(params, true);
  engine.setSource("processed", true);
  engine.setMonitor("full", true);
  const setupMs = performance.now() - setupStart;
  const initialLatency = engine.latency;
  const inputL = new Float64Array(block), inputR = new Float64Array(block);
  const outL = new Float64Array(block), outR = new Float64Array(block);
  const zero = new Float64Array(block);
  const warmupFrames = Math.max(Math.ceil(warmup * sampleRate), initialLatency + block);
  let cursor = 0;
  const fill = n => {
    for (let i = 0; i < n; i++) {
      inputL[i] = fixture.l[(cursor + i) % sampleRate];
      inputR[i] = fixture.r[(cursor + i) % sampleRate];
    }
  };
  const validate = n => {
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i]))
        throw new Error("Benchmark encountered non-finite output.");
      if (inputL[i] !== fixture.l[(cursor + i) % sampleRate] || inputR[i] !== fixture.r[(cursor + i) % sampleRate])
        throw new Error("Engine modified benchmark source input.");
    }
  };
  for (let pos = 0; pos < warmupFrames; pos += block) {
    const n = Math.min(block, warmupFrames - pos);
    fill(n); engine.process(inputL, inputR, zero, zero, n, outL, outR); validate(n);
    cursor += n;
  }
  if (globalThis.gc) globalThis.gc(); // Never force GC inside the timed processing loop.
  const totalFrames = Math.ceil(seconds * sampleRate);
  const timings = new Float64Array(Math.ceil(totalFrames / block));
  const updates = [], meterTimings = [];
  const samples = [{ audioSeconds: 0, ...memory() }];
  const cpuStart = process.cpuUsage(), wallStart = performance.now();
  let blockIndex = 0, budgetExceedances = 0, outputEnergy = 0;
  let nextUpdate = changeEvery == null ? Infinity : Math.ceil(changeEvery * sampleRate);
  let nextMemory = Math.max(block, Math.ceil(sampleRate * Math.min(30, seconds)));
  let nextMeter = 0;
  let recovered = false;
  for (let pos = 0; pos < totalFrames; pos += block) {
    const n = Math.min(block, totalFrames - pos);
    if (pos >= nextUpdate) {
      const start = performance.now();
      engine.setParams(changedParams(updates.length));
      updates.push(performance.now() - start);
      nextUpdate = pos + Math.ceil(changeEvery * sampleRate);
      if (engine.latency !== initialLatency) throw new Error("Engine latency changed during parameter stress.");
    }
    fill(n);
    const start = performance.now();
    engine.process(inputL, inputR, zero, zero, n, outL, outR);
    const elapsed = performance.now() - start;
    timings[blockIndex++] = elapsed;
    if (elapsed > block / sampleRate * 1000) budgetExceedances++;
    validate(n);
    for (let i = 0; i < n; i++) outputEnergy += outL[i] ** 2 + outR[i] ** 2;
    cursor += n;
    if (pos >= nextMeter) {
      const start = performance.now();
      const meter = engine.meters();
      meterTimings.push(performance.now() - start);
      recovered ||= meter.recovered;
      nextMeter = pos + Math.ceil(sampleRate / 20);
    }
    if (pos + n >= nextMemory) {
      samples.push({ audioSeconds: (pos + n) / sampleRate, ...memory() });
      nextMemory = pos + n + Math.ceil(sampleRate * 30);
    }
  }
  const wallMsWithHarness = performance.now() - wallStart;
  const cpu = process.cpuUsage(cpuStart);
  recovered ||= engine.meters().recovered;
  if (recovered) throw new Error("Engine recovered a non-finite value during the benchmark.");
  if (!(outputEnergy > 0) || !Number.isFinite(outputEnergy)) throw new Error("Benchmark output is silent or invalid.");
  if (hash(fixture) !== originalHash) throw new Error("Synthetic source changed during benchmark.");
  const beforeFinalGc = memory();
  if (globalThis.gc) globalThis.gc();
  const end = memory(), startMemory = samples[0];
  const processTiming = distribution([...timings]);
  return {
    sampleRate, block, frames: totalFrames, audioSeconds: totalFrames / sampleRate,
    actualWarmupSeconds: warmupFrames / sampleRate, setupMs, latencySamples: initialLatency,
    processTiming, meterTiming: distribution(meterTimings),
    updateTiming: updates.length ? distribution(updates) : null, parameterUpdates: updates.length,
    realtimeFactor: totalFrames / sampleRate * 1000 / processTiming.totalMs,
    nominalBlockBudgetMs: block / sampleRate * 1000,
    engineOnlyBudgetExceedances: budgetExceedances,
    wallMsWithHarness, cpuMsWithHarness: (cpu.user + cpu.system) / 1000,
    outputRms: Math.sqrt(outputEnergy / (totalFrames * 2)),
    correctness: { finiteOutput: true, sourceUnchanged: true, recovered: false, latencyConstant: true },
    memory: {
      forcedGcAvailable: Boolean(globalThis.gc), samples, beforeFinalGc, end,
      deltaBytes: Object.fromEntries(Object.keys(end).map(key => [key, end[key] - startMemory[key]])),
      sampledPeakBytes: Object.fromEntries(Object.keys(end).map(key =>
        [key, Math.max(beforeFinalGc[key], end[key], ...samples.map(s => s[key]))])),
    },
  };
}
