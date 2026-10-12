import assert from "node:assert/strict";
import { it } from "node:test";
import { compressSerialStereo } from "../dynamics.ts";
import { carveCenter } from "../imaging.ts";
import { neutralParams } from "../presets.ts";
import { SerialGlueStage, CenterCarveStage } from "./analog-imaging.ts";
import { bounceThroughEngine, RealtimeEngine } from "./engine.ts";
import type { Stereo } from "../types.ts";

const sr = 48000;
function fixture(): Stereo {
  const l = new Float64Array(sr), r = new Float64Array(sr);
  for (let i = 0; i < sr; i++) {
    const mid = 0.3 * Math.sin(2 * Math.PI * 2000 * i / sr) * (i < sr / 2 ? 1 : 0.1);
    const side = 0.12 * Math.sin(2 * Math.PI * 2200 * i / sr);
    l[i] = mid + side; r[i] = mid - side;
  }
  return { l, r, sampleRate: sr };
}
function error(a: Float64Array, b: Float64Array): number {
  let e = 0; for (let i = 0; i < a.length; i++) e = Math.max(e, Math.abs(a[i]! - b[i]!)); return e;
}
for (const size of [1, 37, 128, 1024]) {
  it(`serial optical glue matches the established offline model in ${size}-sample blocks`, () => {
    const x = fixture(), p = { ...neutralParams().glue, enabled: true, optical: 0.8, thresholdDb: -25, ratio: 3 };
    const expected = compressSerialStereo(x.l, x.r, sr, p, p.optical);
    const l = x.l.slice(), r = x.r.slice(), stage = new SerialGlueStage(sr, p);
    for (let i = 0; i < l.length; i += size) stage.process(l.subarray(i), r.subarray(i), Math.min(size, l.length - i));
    assert.ok(error(l, expected.audioL) < 1e-12); assert.ok(error(r, expected.audioR) < 1e-12);
    assert.ok(stage.reductionDb > 0);
  });
  it(`center carve matches offline and preserves mid in ${size}-sample blocks`, () => {
    const x = fixture(), expected = carveCenter(x.l, x.r, sr, 0.8, 2000);
    const l = x.l.slice(), r = x.r.slice(), stage = new CenterCarveStage(sr);
    stage.set(0.8, 2000, true);
    for (let i = 0; i < l.length; i += size) stage.process(l.subarray(i), r.subarray(i), Math.min(size, l.length - i));
    assert.ok(error(l, expected.l) < 1e-12); assert.ok(error(r, expected.r) < 1e-12);
    for (let i = 0; i < l.length; i++) assert.ok(Math.abs(l[i]! + r[i]! - x.l[i]! - x.r[i]!) < 1e-15);
    assert.ok(error(l, x.l) > 0.01);
  });
}
it("carve bypass is exact; silent center cannot duck side-only material", () => {
  const x = fixture(), stage = new CenterCarveStage(sr);
  const l = x.l.slice(), r = x.r.slice(); stage.process(l, r, l.length);
  assert.deepEqual(l, x.l); assert.deepEqual(r, x.r);
  r.set(l.map(v => -v)); stage.set(1, 2000, true);
  const before = l.slice(); stage.process(l, r, l.length); assert.deepEqual(l, before);
});
it("live coefficient/depth and optical ramps remain finite, block independent, and resettable", () => {
  function run(size: number) {
    const x = fixture(), stage = new CenterCarveStage(sr);
    stage.set(0.2, 2000, true); stage.set(1, 8000);
    for (let i = 0; i < x.l.length; i += size) stage.process(x.l.subarray(i), x.r.subarray(i), Math.min(size, x.l.length - i));
    assert.ok(x.l.every(Number.isFinite)); stage.reset(); return x.l;
  }
  assert.ok(error(run(37), run(128)) < 1e-12);
  const x = fixture(), p = neutralParams().glue, stage = new SerialGlueStage(sr, p);
  stage.set({ ...p, optical: 1, thresholdDb: -30 }); stage.process(x.l, x.r, x.l.length);
  assert.ok(x.l.every(Number.isFinite)); stage.reset(); assert.equal(stage.reductionDb, 0);
});
it("engine prints combined optical and carve without changing source or latency", () => {
  const x = fixture(), original = x.l.slice(), p = neutralParams();
  p.bands = []; p.limiter.enabled = false;
  const dry = bounceThroughEngine(x, p, 128);
  p.glue = { ...p.glue, enabled: true, optical: 0.8, thresholdDb: -25, ratio: 3 };
  p.carve = 0.8; p.carveHz = 2000;
  const a = bounceThroughEngine(x, p, 37), b = bounceThroughEngine(x, p, 128);
  const engine = new RealtimeEngine(sr), latency = engine.latency;
  engine.setParams(p, true); assert.equal(engine.latency, latency);
  assert.ok(error(a.l, dry.l) > 0.01);
  assert.ok(error(a.l, b.l) < 1e-9); assert.deepEqual(x.l, original);
});
