import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderChain } from "../chain.ts";
import { calibrationTone, makeDemo } from "../demo.ts";
import { measureLoudness } from "../lufs.ts";
import { defaultBands, neutralParams } from "../presets.ts";
import { measureTruePeak } from "../truepeak.ts";
import type { ChainParams, Stereo } from "../types.ts";
import { bounceThroughEngine, RealtimeEngine } from "./engine.ts";
import { Transport } from "./transport.ts";

const SR = 48000;

function stereoSine(freq: number, seconds: number, ampDb: number, sr = SR): Stereo {
  const n = Math.round(sr * seconds);
  const a = Math.pow(10, ampDb / 20);
  const l = new Float64Array(n);
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = a * Math.sin((2 * Math.PI * freq * i) / sr);
    r[i] = l[i] as number;
  }
  return { l, r, sampleRate: sr };
}

function maxDiff(a: Float64Array, b: Float64Array, from = 0, to = Math.min(a.length, b.length)): number {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs((a[i] as number) - (b[i] as number)));
  return m;
}

function everythingOn(): ChainParams {
  const p = neutralParams();
  p.inputGainDb = 1.5;
  p.bands = defaultBands().map((b) => ({ ...b, gainDb: b.id === "hp" ? 0 : b.id === "mud" ? -2 : 1.5, enabled: true }));
  p.dynamicEq.enabled = true;
  p.deEss.enabled = true;
  p.multiband.enabled = true;
  p.glue.enabled = true;
  p.glue.optical = 0;
  p.transient = { enabled: true, attack: 0.3, sustain: -0.1 };
  p.saturation = { ...p.saturation, enabled: true, mode: "tube", driveDb: 6, mix: 0.4 };
  p.width = 1.2;
  p.limiter = { enabled: true, ceilingDb: -1, releaseMs: 80, lookaheadMs: 5 };
  return p;
}

function runBlocks(input: Stereo, params: ChainParams, block: number): Stereo {
  return bounceThroughEngine(input, params, block);
}

describe("block-size invariance", () => {
  it("gives the same samples whatever the render quantum", () => {
    const demo = makeDemo(SR).program;
    const clip: Stereo = { l: demo.l.slice(0, SR * 3), r: demo.r.slice(0, SR * 3), sampleRate: SR };
    const p = everythingOn();
    const a = runBlocks(clip, p, 128);
    const b = runBlocks(clip, p, 37);
    const c = runBlocks(clip, p, 1024);
    assert.ok(maxDiff(a.l, b.l) < 1e-9, `128 vs 37: ${maxDiff(a.l, b.l)}`);
    assert.ok(maxDiff(a.r, c.r) < 1e-9, `128 vs 1024: ${maxDiff(a.r, c.r)}`);
  });
});

describe("parity with the offline renderer", () => {
  it("rejects unsupported controls instead of silently dropping them", () => {
    const p = neutralParams();
    const e = new RealtimeEngine(SR, 128);
    p.carve = 0.2;
    assert.throws(() => e.setParams(p), /offline renderer/);
    p.carve = 0; p.glue.enabled = true; p.glue.optical = 0.5;
    assert.throws(() => e.setParams(p), /offline renderer/);
  });
  it("matches shared minimum-phase EQ, dynamic EQ, de-ess and width", () => {
    const demo = makeDemo(SR).program;
    const clip: Stereo = { l: demo.l.slice(0, SR * 4), r: demo.r.slice(0, SR * 4), sampleRate: SR };
    const p = everythingOn();
    p.saturation.enabled = false;
    p.limiter.enabled = false;
    p.multiband.enabled = false;
    p.glue.enabled = false;
    p.transient.enabled = false;
    const off = renderChain(clip, p);
    const rt = runBlocks(clip, p, 512);
    const d = Math.max(maxDiff(off.l, rt.l), maxDiff(off.r, rt.r));
    assert.ok(d < 1e-7, `max difference ${d}`);
  });

  it("matches the enhanced 8× saturation once the latency is removed", () => {
    const demo = makeDemo(SR).program;
    const clip: Stereo = { l: demo.l.slice(0, SR * 2), r: demo.r.slice(0, SR * 2), sampleRate: SR };
    for (const mode of ["tape", "tube", "hybrid"] as const) {
      const p = neutralParams();
      p.saturation = { ...p.saturation, enabled: true, mode, driveDb: 9, mix: 0.7,
        memory: 0.65, lowColor: 0.3, highColor: -0.2, tubeTapeMix: 0.7 };
      p.limiter.enabled = false;
      const off = renderChain(clip, p);
      const rt = runBlocks(clip, p, 256);
      const d = maxDiff(off.l, rt.l, 200, clip.l.length - 200);
      assert.ok(d < 1e-6, `${mode}: ${d}`);
    }
  });
});

describe("oversampler latency", () => {
  it("is 16 samples and unity-gain for a small signal", () => {
    const x = stereoSine(1000, 0.5, -40);
    const p = neutralParams();
    p.saturation = { ...p.saturation, enabled: true, mode: "tape", driveDb: 0, mix: 1 };
    p.saturation.memory = 0;
    p.saturation.lowColor = 0;
    p.saturation.highColor = 0;
    p.limiter.enabled = false;
    const e = new RealtimeEngine(SR, 256);
    e.setParams(p, true);
    e.setSource("processed", true);
    const out = new Float64Array(x.l.length);
    const outR = new Float64Array(x.l.length);
    const z = new Float64Array(x.l.length);
    e.process(x.l, x.r, z, z, x.l.length, out, outR);
    // Total latency is oversampler + limiter. Remove it and compare.
    const lat = e.latency;
    let worst = 0;
    for (let i = 2000; i < x.l.length - lat; i++) worst = Math.max(worst, Math.abs((out[i + lat] as number) - (x.l[i] as number)));
    assert.ok(worst < 2e-4, `worst ${worst}`);
  });
});

describe("limiter", () => {
  it("keeps the 4× true peak at or under the ceiling", () => {
    const demo = makeDemo(SR).program;
    const clip: Stereo = { l: demo.l.slice(0, SR * 6), r: demo.r.slice(0, SR * 6), sampleRate: SR };
    const p = neutralParams();
    p.inputGainDb = 12;
    p.limiter = { enabled: true, ceilingDb: -1, releaseMs: 80, lookaheadMs: 5 };
    const out = runBlocks(clip, p, 128);
    const tp = measureTruePeak([out.l, out.r]).truePeakDb;
    assert.ok(tp <= -0.95, `true peak ${tp.toFixed(3)} dBTP`);
    assert.ok(tp > -1.6, `limiter is working too hard: ${tp.toFixed(3)} dBTP`);
  });

  it("holds the ceiling for every lookahead setting", () => {
    const x = stereoSine(11000, 1.5, -1.0); // inter-sample peaks on a high tone
    for (const look of [1, 2.5, 5, 10]) {
      const p = neutralParams();
      p.inputGainDb = 6;
      p.limiter = { enabled: true, ceilingDb: -1, releaseMs: 50, lookaheadMs: look };
      const out = runBlocks(x, p, 128);
      const tp = measureTruePeak([out.l, out.r]).truePeakDb;
      assert.ok(tp <= -0.9, `look ${look} ms: ${tp.toFixed(3)} dBTP`);
    }
  });

  it("passes a signal under the ceiling unchanged apart from the delay", () => {
    const x = stereoSine(440, 0.5, -12);
    const p = neutralParams();
    const e = new RealtimeEngine(SR, 128);
    e.setParams(p, true);
    const lat = e.latency;
    const out = bounceThroughEngine(x, p, 128);
    assert.ok(maxDiff(out.l, x.l) < 1e-9, `${maxDiff(out.l, x.l)}`);
    assert.ok(lat > 0);
  });

  it("changes gain smoothly instead of stepping", () => {
    const x = stereoSine(200, 1, -30);
    // A loud burst in the middle.
    for (let i = Math.round(SR * 0.4); i < Math.round(SR * 0.45); i++) {
      x.l[i] = (x.l[i] as number) * 80;
      x.r[i] = x.l[i] as number;
    }
    const p = neutralParams();
    p.limiter = { enabled: true, ceilingDb: -3, releaseMs: 120, lookaheadMs: 5 };
    const out = bounceThroughEngine(x, p, 128);
    let worst = 0;
    let prev = 1;
    let prevAt = 999;
    for (let i = 1000; i < x.l.length - 1000; i++) {
      const xi = x.l[i] as number;
      if (Math.abs(xi) < 0.01) continue; // the ratio is meaningless near a zero crossing
      const g = (out.l[i] as number) / xi;
      worst = Math.max(worst, Math.abs(g - prev) / (i - prevAt));
      prev = g;
      prevAt = i;
    }
    // A 5 ms lookahead spreads an 11 dB fall over 240 samples: about 0.003 per sample.
    assert.ok(worst < 0.006, `largest per-sample gain step ${worst}`);
  });
});

describe("loudness meter", () => {
  it("reads −23 LUFS for the EBU Tech 3341 alignment tone", () => {
    const tone = calibrationTone(SR, 12);
    const e = new RealtimeEngine(SR, 128);
    e.setParams(neutralParams(), true);
    const z = new Float64Array(tone.l.length);
    const o = new Float64Array(tone.l.length);
    e.process(tone.l, tone.r, z, z, tone.l.length, o, new Float64Array(tone.l.length));
    const m = e.meters();
    assert.ok(Math.abs(m.inMomentary - -23) < 0.1, `momentary ${m.inMomentary}`);
    assert.ok(Math.abs(m.inIntegrated - -23) < 0.1, `integrated ${m.inIntegrated}`);
  });

  it("agrees with the offline BS.1770 measurement on program material", () => {
    const demo = makeDemo(SR).program;
    const e = new RealtimeEngine(SR, 128);
    e.setParams(neutralParams(), true);
    const n = demo.l.length;
    const z = new Float64Array(n);
    e.process(demo.l, demo.r, z, z, n, new Float64Array(n), new Float64Array(n));
    const m = e.meters();
    const off = measureLoudness([demo.l, demo.r], SR);
    assert.ok(Math.abs(m.inIntegrated - off.integrated) < 0.15, `rt ${m.inIntegrated} vs offline ${off.integrated}`);
  });
});

describe("source switching and monitoring", () => {
  it("keeps original and processed sample-aligned when the chain is neutral", () => {
    const demo = makeDemo(SR).program;
    const n = SR * 2;
    const run = (src: "original" | "processed") => {
      const e = new RealtimeEngine(SR, 128);
      e.setParams(neutralParams(), true);
      e.setSource(src, true);
      const z = new Float64Array(n);
      const ol = new Float64Array(n);
      e.process(demo.l.slice(0, n), demo.r.slice(0, n), z, z, n, ol, new Float64Array(n));
      return ol;
    };
    const a = run("original");
    const b = run("processed");
    assert.ok(maxDiff(a, b) < 1e-9, `${maxDiff(a, b)}`);
  });

  it("crossfades without a step when the source changes", () => {
    const x = stereoSine(300, 1, -10);
    const e = new RealtimeEngine(SR, 128);
    const p = neutralParams();
    p.inputGainDb = -6;
    e.setParams(p, true);
    e.setSource("original", true);
    const n = 128;
    const z = new Float64Array(n);
    const out = new Float64Array(SR);
    const tmp = new Float64Array(n);
    for (let pos = 0; pos + n <= SR; pos += n) {
      if (pos === 128 * 100) e.setSource("processed");
      e.process(x.l.subarray(pos, pos + n), x.r.subarray(pos, pos + n), z, z, n, out.subarray(pos, pos + n), tmp);
    }
    let worst = 0;
    for (let i = 2000; i < SR - 1; i++) worst = Math.max(worst, Math.abs((out[i + 1] as number) - (out[i] as number)));
    // A 300 Hz sine at −10 dBFS moves at most 2π·300/48000·0.316 ≈ 0.0124 per sample.
    assert.ok(worst < 0.02, `largest step ${worst}`);
  });

  it("folds to mono on request", () => {
    const l = new Float64Array(SR / 2);
    const r = new Float64Array(SR / 2);
    for (let i = 0; i < l.length; i++) {
      l[i] = 0.3 * Math.sin((2 * Math.PI * 500 * i) / SR);
      r[i] = -(l[i] as number);
    }
    const e = new RealtimeEngine(SR, 128);
    e.setParams(neutralParams(), true);
    e.setMonitor("mono", true);
    const z = new Float64Array(l.length);
    const ol = new Float64Array(l.length);
    const or = new Float64Array(l.length);
    e.process(l, r, z, z, l.length, ol, or);
    let peak = 0;
    for (let i = 5000; i < l.length; i++) peak = Math.max(peak, Math.abs(ol[i] as number));
    assert.ok(peak < 1e-9, `out-of-phase content survived the fold: ${peak}`);
  });
});

describe("automation", () => {
  it("moves gain without zipper noise", () => {
    const x = stereoSine(1000, 2, -12);
    const e = new RealtimeEngine(SR, 128);
    const p = neutralParams();
    e.setParams(p, true);
    e.setSource("processed", true);
    const n = 128;
    const z = new Float64Array(n);
    const out = new Float64Array(x.l.length);
    const tmp = new Float64Array(n);
    for (let pos = 0; pos + n <= x.l.length; pos += n) {
      if (pos === 128 * 200) {
        const q = neutralParams();
        q.inputGainDb = -18;
        e.setParams(q);
      }
      e.process(x.l.subarray(pos, pos + n), x.r.subarray(pos, pos + n), z, z, n, out.subarray(pos, pos + n), tmp);
    }
    const lat = e.latency;
    const gains: number[] = [];
    for (let i = 20000; i < x.l.length - 1; i++) {
      const xi = x.l[i - lat] as number;
      if (Math.abs(xi) > 0.15) gains.push((out[i] as number) / xi);
    }
    let worst = 0;
    for (let i = 1; i < gains.length; i++) worst = Math.max(worst, Math.abs((gains[i] as number) - (gains[i - 1] as number)));
    assert.ok(worst < 0.06, `largest jump between neighbouring peaks ${worst}`);
    assert.ok(Math.abs((gains[gains.length - 1] as number) - Math.pow(10, -18 / 20)) < 0.01);
  });
});

describe("robustness", () => {
  it("recovers from NaN and infinity without poisoning later audio", () => {
    const x = stereoSine(440, 1, -12);
    const e = new RealtimeEngine(SR, 128);
    e.setParams(everythingOn(), true);
    const n = 128;
    const z = new Float64Array(n);
    const ol = new Float64Array(n);
    const or = new Float64Array(n);
    let sawRecovery = false;
    let lastPeak = 0;
    for (let pos = 0; pos + n <= x.l.length; pos += n) {
      const l = x.l.slice(pos, pos + n);
      if (pos === 128 * 50) {
        l[10] = Number.NaN;
        l[11] = Number.POSITIVE_INFINITY;
      }
      e.process(l, x.r.subarray(pos, pos + n), z, z, n, ol, or);
      for (let i = 0; i < n; i++) assert.ok(Number.isFinite(ol[i] as number) && Number.isFinite(or[i] as number));
      if (e.meters().recovered) sawRecovery = true;
      lastPeak = Math.max(...Array.from(ol, Math.abs));
    }
    assert.ok(sawRecovery);
    assert.ok(lastPeak > 0.05, "audio did not come back");
  });
});

describe("cpu", () => {
  it("runs the full chain far faster than real time", () => {
    const demo = makeDemo(SR).program;
    const p = everythingOn();
    const e = new RealtimeEngine(SR, 128);
    e.setParams(p, true);
    const n = 128;
    const z = new Float64Array(n);
    const ol = new Float64Array(n);
    const or = new Float64Array(n);
    const total = Math.min(demo.l.length, SR * 10);
    // Warm the JIT.
    for (let pos = 0; pos + n <= SR; pos += n) e.process(demo.l.subarray(pos, pos + n), demo.r.subarray(pos, pos + n), z, z, n, ol, or);
    const t0 = process.hrtime.bigint();
    for (let pos = 0; pos + n <= total; pos += n) e.process(demo.l.subarray(pos, pos + n), demo.r.subarray(pos, pos + n), z, z, n, ol, or);
    const sec = Number(process.hrtime.bigint() - t0) / 1e9;
    const load = sec / (total / SR);
    console.log(`      full chain CPU load: ${(load * 100).toFixed(1)}% of one core (${(1 / load).toFixed(1)}× real time)`);
    assert.ok(load < 0.35, `load ${(load * 100).toFixed(1)}%`);
  });
});

describe("transport", () => {
  function ramp(n: number): { l: Float32Array; r: Float32Array } {
    const l = new Float32Array(n);
    for (let i = 0; i < n; i++) l[i] = i / n;
    return { l, r: l.slice() };
  }

  it("plays through, flushes the engine tail, then reports the end", () => {
    const t = new Transport(SR);
    t.load("program", ramp(1000).l, ramp(1000).r);
    t.setLatency(100);
    t.play();
    const l = new Float64Array(128);
    const r = new Float64Array(128);
    let frames = 0;
    let ended = false;
    for (let k = 0; k < 20 && !ended; k++) {
      const pulled = t.pull(128, l, r, null, null);
      frames += pulled.fed;
      if (pulled.ended) ended = true;
    }
    assert.equal(frames, 1000 + 100);
    assert.ok(ended);
  });

  it("loops without a gap and seeks within bounds", () => {
    const t = new Transport(SR);
    t.load("program", ramp(300).l, ramp(300).r);
    t.setLatency(0);
    t.setLoop(100, 200);
    t.seek(0.0);
    t.play();
    const l = new Float64Array(128);
    const r = new Float64Array(128);
    for (let k = 0; k < 6; k++) t.pull(128, l, r, null, null);
    assert.ok(t.position >= 100 && t.position < 200, `position ${t.position}`);
    t.seek(10);
    assert.ok(t.position <= 300);
  });
});

describe("renderMaster", () => {
  it("prints through the engine, lines up with the source, and holds the ceiling", async () => {
    const { renderMaster } = await import("./render.ts");
    const demo = makeDemo(SR).program;
    const clip: Stereo = { l: demo.l.slice(0, SR * 3), r: demo.r.slice(0, SR * 3), sampleRate: SR };
    const p = neutralParams();
    p.inputGainDb = 10;
    const out = renderMaster(clip, p);
    assert.equal(out.l.length, clip.l.length);
    assert.ok(out.report.truePeakOutDb <= -0.95, `${out.report.truePeakOutDb}`);
    assert.ok(out.report.limiterReductionDb > 0.5);
  });
});

describe("linear-phase EQ", () => {
  function noise(seconds: number, seed = 7): Stereo {
    const n = Math.round(SR * seconds);
    const l = new Float64Array(n);
    const r = new Float64Array(n);
    let s = seed;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296 - 0.5;
    };
    let a = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      // Pink-ish: two leaky integrators on white noise.
      a = 0.995 * a + rnd() * 0.1;
      b = 0.9 * b + rnd() * 0.2;
      l[i] = a + b;
      r[i] = 0.7 * (l[i] as number) + 0.3 * (rnd() * 0.2);
    }
    return { l, r, sampleRate: SR };
  }

  function params(): ChainParams {
    const p = neutralParams();
    p.eqMode = "linear";
    p.limiter.enabled = false;
    p.bands = defaultBands().map((b) => {
      if (b.id === "low") return { ...b, gainDb: 3 };
      if (b.id === "mud") return { ...b, gainDb: -3, freq: 400, q: 1.2 };
      if (b.id === "presence") return { ...b, gainDb: 4, freq: 3200 };
      if (b.id === "air") return { ...b, gainDb: 2.5 };
      return b;
    });
    return p;
  }

  it("matches the offline forward-backward linear mode", () => {
    const x = noise(3);
    const p = params();
    const off = renderChain(x, p);
    const rt = bounceThroughEngine(x, p, 512);
    let err = 0;
    let ref = 0;
    for (let i = 8000; i < x.l.length - 8000; i++) {
      const d = (off.l[i] as number) - (rt.l[i] as number);
      err += d * d;
      ref += (off.l[i] as number) ** 2;
    }
    const db = 10 * Math.log10(err / ref);
    assert.ok(db < -35, `error ${db.toFixed(1)} dB relative to the signal`);
  });

  it("has no phase shift: an impulse comes out symmetric about its delay", () => {
    const n = SR;
    const x: Stereo = { l: new Float64Array(n), r: new Float64Array(n), sampleRate: SR };
    x.l[20000] = 1;
    x.r[20000] = 1;
    const p = params();
    const e = new RealtimeEngine(SR, 512);
    e.setParams(p, true);
    const z = new Float64Array(n);
    const ol = new Float64Array(n + e.latency);
    const or = new Float64Array(n + e.latency);
    const pad = (a: Float64Array) => {
      const y = new Float64Array(n + e.latency);
      y.set(a);
      return y;
    };
    e.process(pad(x.l), pad(x.r), pad(z), pad(z), n + e.latency, ol, or);
    const c = 20000 + e.latency;
    let asym = 0;
    let energy = 0;
    for (let k = 1; k < 1500; k++) {
      asym = Math.max(asym, Math.abs((ol[c + k] as number) - (ol[c - k] as number)));
      energy = Math.max(energy, Math.abs(ol[c + k] as number));
    }
    assert.ok(asym < 1e-6, `asymmetry ${asym} (peak side lobe ${energy})`);
  });

  it("crossfades between minimum and linear without a click", () => {
    const x = stereoSine(500, 1.5, -12);
    const e = new RealtimeEngine(SR, 128);
    const p = params();
    p.eqMode = "minimum";
    e.setParams(p, true);
    const n = 128;
    const z = new Float64Array(n);
    const out = new Float64Array(x.l.length);
    const tmp = new Float64Array(n);
    for (let pos = 0; pos + n <= x.l.length; pos += n) {
      if (pos === 128 * 250) e.setParams({ ...p, eqMode: "linear" });
      e.process(x.l.subarray(pos, pos + n), x.r.subarray(pos, pos + n), z, z, n, out.subarray(pos, pos + n), tmp);
    }
    let worst = 0;
    const processed = Math.floor(x.l.length / n) * n;
    for (let i = e.latency + 2000; i < processed - 1; i++) worst = Math.max(worst, Math.abs((out[i + 1] as number) - (out[i] as number)));
    // 500 Hz at about −12 dBFS plus a few dB of EQ: the natural step is under 0.05.
    assert.ok(worst < 0.06, `largest step ${worst}`);
  });

  it("applies mid/side targets and stays block-size invariant", () => {
    const x = noise(2);
    const p = params();
    p.eqTarget = "side";
    const a = bounceThroughEngine(x, p, 128);
    const b = bounceThroughEngine(x, p, 1000);
    assert.ok(maxDiff(a.l, b.l) < 1e-9, `${maxDiff(a.l, b.l)}`);
    const plain = { ...p, eqTarget: "stereo" as const };
    const c = bounceThroughEngine(x, plain, 128);
    assert.ok(maxDiff(a.l, c.l) > 1e-3, "side-only EQ should differ from stereo EQ");
  });
});
