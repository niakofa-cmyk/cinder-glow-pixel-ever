import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { neutralParams } from "../dsp/presets.ts";
import { parseSnapshot, type SessionSnapshot } from "./session-snapshot.ts";

function snapshot(): SessionSnapshot {
  return {
    version: 1, savedAt: Date.now(),
    program: { l: new Float32Array(16).fill(0.1), r: new Float32Array(16).fill(0.2), sampleRate: 44100 },
    reference: null, programName: "native-rate.wav", referenceName: "",
    params: neutralParams(), source: "processed", monitor: "full", matchLoudness: true,
    targetLufs: -14, moduleId: "eq",
  };
}

describe("saved session validation", () => {
  it("preserves native sample rate, audio and selected processing", () => {
    const s = snapshot(); s.params.eqMode = "linear"; s.params.eqTarget = "side";
    const parsed = parseSnapshot(structuredClone(s));
    assert.equal(parsed.program.sampleRate, 44100);
    assert.deepEqual(parsed.program.l, s.program.l);
    assert.equal(parsed.params.eqTarget, "side");
    assert.equal(parsed.params.eqMode, "linear");
  });
  it("rejects unsupported versions with actionable guidance", () => {
    assert.throws(() => parseSnapshot({ ...snapshot(), version: 99 }), /corrupt or incompatible.*Delete/);
  });
  it("rejects nonfinite audio and mismatched channel lengths", () => {
    const s = snapshot(); s.program.l[0] = NaN;
    assert.throws(() => parseSnapshot(s), /corrupt/);
    s.program.l[0] = 0; s.program.r = new Float32Array(8);
    assert.throws(() => parseSnapshot(s), /corrupt/);
  });
  it("rejects nonfinite or unsafe processing values", () => {
    const s = snapshot(); s.params.inputGainDb = Infinity;
    assert.throws(() => parseSnapshot(s), /corrupt/);
    s.params.inputGainDb = 1000;
    assert.throws(() => parseSnapshot(s), /corrupt/);
  });
  it("rejects references at a different sample rate", () => {
    const s = snapshot(); s.reference = { ...s.program, sampleRate: 48000 };
    assert.throws(() => parseSnapshot(s), /corrupt/);
  });
  it("rejects duplicate bands and reversed crossover frequencies", () => {
    const s = snapshot(); s.params.bands.push({ ...s.params.bands[0]! });
    assert.throws(() => parseSnapshot(s), /corrupt/);
    s.params = neutralParams(); s.params.multiband.lowHz = 10000;
    assert.throws(() => parseSnapshot(s), /corrupt/);
  });
  it("keeps older sessions compatible and round-trips optional snapshot settings", () => {
    assert.equal(parseSnapshot(snapshot()).processingBank, undefined);
    const s = snapshot();
    s.processingBank = { entries: [{ id: "a", name: "Baseline", params: neutralParams() }], aId: "a", bId: null };
    const parsed = parseSnapshot(structuredClone(s));
    assert.deepEqual(parsed.processingBank, s.processingBank);
  });
  it("rejects corrupt snapshot slots, names, settings and excessive banks", () => {
    const s = snapshot();
    s.processingBank = { entries: [{ id: "a", name: "Baseline", params: neutralParams() }], aId: "missing", bId: null };
    assert.throws(() => parseSnapshot(s), /corrupt/);
    s.processingBank.aId = "a"; s.processingBank.bId = "a";
    assert.throws(() => parseSnapshot(s), /corrupt/);
    s.processingBank.bId = null;
    s.processingBank.entries.push({ id: "b", name: " baseline ", params: neutralParams() });
    assert.throws(() => parseSnapshot(s), /corrupt/);
    s.processingBank.entries.pop(); s.processingBank.entries[0]!.params.width = NaN;
    assert.throws(() => parseSnapshot(s), /corrupt/);
    s.processingBank.entries = Array.from({ length: 9 }, (_, i) => ({ id: `${i}`, name: `Take ${i}`, params: neutralParams() }));
    assert.throws(() => parseSnapshot(s), /corrupt/);
  });
});
