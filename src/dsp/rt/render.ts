import type { RenderResult } from "../chain.ts";
import { gainToDb } from "../biquad.ts";
import { measureLoudness } from "../lufs.ts";
import { measureTruePeak } from "../truepeak.ts";
import type { ChainParams, Clip, Stereo } from "../types.ts";
import { RealtimeEngine } from "./engine.ts";

/** Static processed/full-range print, with the same Float32 output as the worklet. */
export function renderSharedClip(input: Clip | Stereo, params: ChainParams, block = 128): Clip {
  if (!Number.isInteger(block) || block < 1 || block > 4096) throw new Error("Invalid shared-render block size.");
  const engine = new RealtimeEngine(input.sampleRate, block);
  engine.setParams(params, true); // Also rejects unsupported features, without a fallback.
  engine.setSource("processed", true);
  engine.setMonitor("full", true);
  const total = input.l.length;
  const latency = engine.latency;
  const l = new Float32Array(total), r = new Float32Array(total);
  const inL = new Float64Array(block), inR = new Float64Array(block);
  const outL = new Float64Array(block), outR = new Float64Array(block);
  const zero = new Float64Array(block);
  for (let pos = 0; pos < total + latency; pos += block) {
    const n = Math.min(block, total + latency - pos);
    for (let i = 0; i < n; i++) {
      inL[i] = pos + i < total ? input.l[pos + i]! : 0;
      inR[i] = pos + i < total ? input.r[pos + i]! : 0;
    }
    engine.process(inL, inR, zero, zero, n, outL, outR);
    const start = Math.max(0, latency - pos);
    const end = Math.min(n, total + latency - pos);
    if (end > start) {
      l.set(outL.subarray(start, end), pos + start - latency);
      r.set(outR.subarray(start, end), pos + start - latency);
    }
  }
  if (engine.meters().recovered) throw new Error("Shared rendering encountered non-finite audio. Check the source and settings.");
  return { l, r, sampleRate: input.sampleRate };
}

/**
 * Print the master through the real-time engine, so the file is the same
 * signal path you listened to, including the true linear-phase EQ.
 */
export function renderMaster(input: Stereo, params: ChainParams, block = 4096): RenderResult {
  const sr = input.sampleRate;
  const engine = new RealtimeEngine(sr, block);
  engine.setParams(params, true);
  engine.setSource("processed", true);
  engine.setMonitor("full", true);
  const total = input.l.length;
  const lat = engine.latency;
  const outL = new Float64Array(total + lat);
  const outR = new Float64Array(total + lat);
  const zero = new Float64Array(block);
  const inL = new Float64Array(block);
  const inR = new Float64Array(block);
  let limiterMax = 0;
  let glueSum = 0;
  let blocks = 0;
  for (let pos = 0; pos < total + lat; pos += block) {
    const n = Math.min(block, total + lat - pos);
    for (let i = 0; i < n; i++) {
      inL[i] = pos + i < total ? (input.l[pos + i] as number) : 0;
      inR[i] = pos + i < total ? (input.r[pos + i] as number) : 0;
    }
    engine.process(inL.subarray(0, n), inR.subarray(0, n), zero.subarray(0, n), zero.subarray(0, n), n, outL.subarray(pos, pos + n), outR.subarray(pos, pos + n));
    const m = engine.meters();
    if (m.limiterReductionDb > limiterMax) limiterMax = m.limiterReductionDb;
    glueSum += m.glueReductionDb;
    blocks++;
  }
  const l = outL.slice(lat, lat + total);
  const r = outR.slice(lat, lat + total);
  const peakIn = measureTruePeak([input.l, input.r]);
  const peakOut = measureTruePeak([l, r]);
  const notes: string[] = [
    `Rendered through the real-time engine: the same code you heard. Latency of ${lat} samples is removed so the file lines up with the source.`,
  ];
  if (params.limiter.enabled && limiterMax < 0.05) {
    notes.push("Limiter is armed and did not reduce gain. The signal was already under the ceiling.");
  }
  if (params.saturation.enabled) {
    notes.push("Saturation uses the shared 8× analog-inspired tape/tube/hybrid model with memory and color controls, not a verified circuit replica.");
  }
  let samplePeakOut = 0;
  for (let i = 0; i < total; i++) {
    samplePeakOut = Math.max(samplePeakOut, Math.abs(l[i] as number), Math.abs(r[i] as number));
  }
  return {
    l,
    r,
    sampleRate: sr,
    report: {
      samplePeakInDb: peakIn.samplePeakDb,
      samplePeakOutDb: gainToDb(samplePeakOut),
      truePeakInDb: peakIn.truePeakDb,
      truePeakOutDb: peakOut.truePeakDb,
      integratedIn: measureLoudness([input.l, input.r], sr).integrated,
      integratedOut: measureLoudness([l, r], sr).integrated,
      limiterReductionDb: limiterMax,
      glueReductionDb: blocks ? glueSum / blocks : 0,
      latencySamples: 0,
      notes,
    },
  };
}
