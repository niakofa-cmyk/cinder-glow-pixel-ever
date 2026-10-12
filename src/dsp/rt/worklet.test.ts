import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { makeDemo } from "../demo.ts";
import { neutralParams } from "../presets.ts";
import { bounceThroughEngine, RealtimeEngine } from "./engine.ts";
import type { FromWorklet, ToWorklet } from "./protocol.ts";
import { renderSharedClip } from "./render.ts";

const SR = 48000;
const Q = 128;

it("unsupported messages stop playback without crashing, and valid controls recover", () => {
  assert.ok(Ctor);
  const w = new Ctor();
  const send = (data: ToWorklet) => w.port.onmessage?.({ data });
  const params = neutralParams();
  params.carve = 0.2;
  send({ type: "params", params });
  send({ type: "play" });
  assert.ok(w.port.messages.some(m => m.type === "error" && /offline renderer/.test(m.message)));
  assert.ok(w.port.messages.some(m => m.type === "error" && /Restore supported/.test(m.message)));
  params.carve = 0;
  params.limiter.enabled = false;
  send({ type: "params", params });
  send({ type: "load", slot: "program", sampleRate: SR,
    l: new Float32Array(8192).fill(0.1), r: new Float32Array(8192).fill(0.1) });
  send({ type: "play" });
  const output = [[new Float32Array(Q), new Float32Array(Q)]];
  for (let block = 0; block < 40; block++) assert.equal(w.process([], output), true);
  assert.ok(output[0]![0]!.some(x => x > 0.09), "valid controls did not resume actual audio");
});

type Proc = {
  port: { onmessage: ((e: { data: ToWorklet }) => void) | null; messages: FromWorklet[] };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};
let Ctor: (new () => Proc) | null = null;

for (const rate of [48000, 44100]) {
  for (const mode of ["minimum", "linear"] as const) {
    for (const target of ["stereo", "mid", "side"] as const) {
      it(`shared print matches cold-start worklet samples: ${rate}/${mode}/${target}`, () => {
        assert.ok(Ctor);
        (globalThis as unknown as { sampleRate: number }).sampleRate = rate;
        try {
          const n = rate;
          const input = { l: new Float32Array(n), r: new Float32Array(n), sampleRate: rate };
          for (let i = 0; i < n; i++) {
            input.l[i] = 0.12 * Math.sin(2 * Math.PI * 220 * i / rate) + 0.02 * Math.sin(2 * Math.PI * 7000 * i / rate);
            input.r[i] = 0.1 * Math.sin(2 * Math.PI * 330 * i / rate) + 0.03 * Math.sin(2 * Math.PI * 5000 * i / rate);
          }
          const params = neutralParams();
          params.eqMode = mode; params.eqTarget = target; params.inputGainDb = 3;
          params.bands = params.bands.map(b => b.id === "low" ? { ...b, gainDb: 4 } : b);
          params.saturation = { ...params.saturation, enabled: true, mode: "hybrid",
            driveDb: 6, mix: 0.4, memory: 0.6, lowColor: 0.2, highColor: -0.2 };
          params.multiband.enabled = true;
          params.dynamicEq.enabled = true; params.deEss.enabled = true;
          params.glue.enabled = true; params.glue.optical = 0;
          params.transient = { enabled: true, attack: 0.2, sustain: -0.1 };
          params.width = 1.2; params.limiter.enabled = true;
          const w = new Ctor();
          const send = (data: ToWorklet) => w.port.onmessage?.({ data });
          // This is the application's actual load → params → play ordering.
          send({ type: "load", slot: "program", l: input.l, r: input.r, sampleRate: rate });
          send({ type: "params", params });
          send({ type: "source", source: "processed" });
          send({ type: "monitor", mode: "full" }); send({ type: "match", db: 0 });
          send({ type: "play" });
          const ready = w.port.messages.find(m => m.type === "ready");
          assert.ok(ready?.type === "ready");
          const frames = Math.ceil((n + ready.latencySamples) / Q) * Q;
          const l = new Float32Array(frames), r = new Float32Array(frames);
          const output = [[new Float32Array(Q), new Float32Array(Q)]];
          for (let pos = 0; pos < frames; pos += Q) {
            assert.equal(w.process([], output), true);
            l.set(output[0]![0]!, pos); r.set(output[0]![1]!, pos);
          }
          const printed = renderSharedClip(input, params);
          assert.equal(printed.l.length, n); assert.equal(printed.sampleRate, rate);
          assert.ok(printed.l.some(sample => Math.abs(sample) > 0.01), "Shared processing unexpectedly produced silence");
          let error = 0;
          for (let i = 0; i < n; i++) error = Math.max(error,
            Math.abs(printed.l[i]! - l[i + ready.latencySamples]!),
            Math.abs(printed.r[i]! - r[i + ready.latencySamples]!));
          assert.ok(error < 2e-7, `aligned sample difference ${error}`);
          assert.ok(w.port.messages.some(m => m.type === "ended"));
          assert.ok(!w.port.messages.some(m => m.type === "error"));
        } finally {
          (globalThis as unknown as { sampleRate: number }).sampleRate = SR;
        }
      });
    }
  }
}

before(async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.sampleRate = SR;
  g.AudioWorkletProcessor = class {
    port = {
      onmessage: null as ((e: { data: ToWorklet }) => void) | null,
      messages: [] as FromWorklet[],
      postMessage(m: FromWorklet) {
        this.messages.push(m);
      },
    };
  };
  g.registerProcessor = (_name: string, c: new () => Proc) => {
    Ctor = c;
  };
  await import("./worklet.ts");
});

function make(): { p: Proc; send: (m: ToWorklet) => void; run: (quanta: number) => { l: Float32Array; r: Float32Array } } {
  assert.ok(Ctor, "processor registered");
  const p = new (Ctor as new () => Proc)();
  const send = (m: ToWorklet) => p.port.onmessage?.({ data: m });
  const run = (quanta: number) => {
    const l = new Float32Array(quanta * Q);
    const r = new Float32Array(quanta * Q);
    for (let k = 0; k < quanta; k++) {
      const out = [new Float32Array(Q), new Float32Array(Q)];
      p.process([], [out]);
      l.set(out[0] as Float32Array, k * Q);
      r.set(out[1] as Float32Array, k * Q);
    }
    return { l, r };
  };
  return { p, send, run };
}

function program(seconds: number) {
  const d = makeDemo(SR).program;
  const n = Math.round(seconds * SR);
  return { l: Float32Array.from(d.l.subarray(0, n)), r: Float32Array.from(d.r.subarray(0, n)) };
}

describe("worklet", () => {
  it("plays the program and matches the offline bounce of the same engine", () => {
    const { send, run } = make();
    const prog = program(1);
    send({ type: "load", slot: "program", l: prog.l, r: prog.r, sampleRate: SR });
    send({ type: "params", params: neutralParams() });
    send({ type: "play" });
    const out = run(Math.ceil(SR / Q) + 8);
    const ref = bounceThroughEngine(
      { l: Float64Array.from(prog.l), r: Float64Array.from(prog.r), sampleRate: SR },
      neutralParams(),
      Q,
    );
    // Skip the start-up fade, compare the steady part.
    const lat = new RealtimeEngine(SR, Q).latency;
    let worst = 0;
    for (let i = 2000; i < SR - 2000; i++) worst = Math.max(worst, Math.abs((out.l[i + lat] as number) - (ref.l[i] as number)));
    assert.ok(worst < 1e-5, `worst ${worst}`);
  });

  it("pauses and resumes without losing or repeating a sample", () => {
    const prog = program(2);
    // Reference: one uninterrupted run.
    const a = make();
    a.send({ type: "load", slot: "program", l: prog.l, r: prog.r, sampleRate: SR });
    a.send({ type: "play" });
    const whole = a.run(300);

    const b = make();
    b.send({ type: "load", slot: "program", l: prog.l, r: prog.r, sampleRate: SR });
    b.send({ type: "play" });
    const first = b.run(100);
    b.send({ type: "pause" });
    const fade = b.run(4);
    const silence = b.run(20);
    b.send({ type: "play" });
    const rest = b.run(150);

    for (const v of silence.l) assert.equal(v, 0);
    // Stitch what was heard: 100 quanta, 4 fade quanta, then the resumed audio.
    const heard = new Float32Array((100 + 4 + 150) * Q);
    heard.set(first.l, 0);
    heard.set(fade.l, 100 * Q);
    heard.set(rest.l, 104 * Q);
    // Before the fade and after the fade-in (10 ms ≈ 480 samples) the stream is identical to the uninterrupted one.
    let worstBefore = 0;
    for (let i = 3000; i < 100 * Q; i++) worstBefore = Math.max(worstBefore, Math.abs((heard[i] as number) - (whole.l[i] as number)));
    let worstAfter = 0;
    for (let i = 104 * Q + 600; i < heard.length; i++) worstAfter = Math.max(worstAfter, Math.abs((heard[i] as number) - (whole.l[i] as number)));
    assert.ok(worstBefore < 1e-6, `before pause ${worstBefore}`);
    assert.ok(worstAfter < 1e-6, `after resume ${worstAfter}`);
    // The fade really fades: it is monotone toward zero and lands on zero at the block edge.
    let loud = 0;
    let quiet = 0;
    for (let i = 100 * Q; i < 100 * Q + 64; i++) loud = Math.max(loud, Math.abs(heard[i] as number));
    for (let i = 104 * Q - 8; i < 104 * Q; i++) quiet = Math.max(quiet, Math.abs(heard[i] as number));
    assert.ok(quiet < loud * 0.05, `fade did not reach silence: ${loud} -> ${quiet}`);
  });

  it("flushes the limiter tail at the end of the file and reports it once", () => {
    const { p, send, run } = make();
    const prog = program(0.5);
    send({ type: "load", slot: "program", l: prog.l, r: prog.r, sampleRate: SR });
    send({ type: "play" });
    const lat = new RealtimeEngine(SR, Q).latency;
    const out = run(Math.ceil((0.5 * SR + lat) / Q) + 6);
    const ended = p.port.messages.filter((m) => m.type === "ended");
    assert.equal(ended.length, 1);
    // The final program samples must have come out, not been cut off by the latency.
    let tail = 0;
    for (let i = 24000 + lat - 110; i < 24000 + lat; i++) tail = Math.max(tail, Math.abs(out.l[i] as number));
    assert.ok(tail > 1e-4, `tail energy ${tail}`);
    for (const v of out.l) assert.ok(Number.isFinite(v));
  });

  it("seeks, stays finite, and emits meters", () => {
    const { p, send, run } = make();
    const prog = program(2);
    send({ type: "load", slot: "program", l: prog.l, r: prog.r, sampleRate: SR });
    send({ type: "play" });
    run(50);
    send({ type: "seek", seconds: 1.2 });
    const out = run(80);
    for (const v of out.l) assert.ok(Number.isFinite(v));
    const meters = p.port.messages.filter((m) => m.type === "meters");
    assert.ok(meters.length > 5, `${meters.length} meter frames`);
    const last = meters[meters.length - 1];
    assert.ok(last && last.type === "meters" && last.frame > 1.2 * SR);
  });
});
