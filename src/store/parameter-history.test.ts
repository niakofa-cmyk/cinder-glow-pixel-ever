import assert from "node:assert/strict";
import { it } from "node:test";
import { neutralParams } from "../dsp/presets.ts";
import { ParameterHistory } from "./parameter-history.ts";

it("processing edits, presets and recommendations can undo and redo", () => {
  const history = new ParameterHistory(), a = neutralParams();
  const b = { ...a, inputGainDb: 6 }, c = { ...b, width: 1.3 };
  history.record(a, b); history.record(b, c);
  assert.deepEqual(history.undo(c), b);
  assert.deepEqual(history.undo(b), a);
  assert.equal(history.undo(a), null);
  assert.deepEqual(history.redo(a), b); assert.deepEqual(history.redo(b), c);
  assert.equal(history.redo(c), null);
});
it("history isolates nested parameters and does not record no-op edits", () => {
  const history = new ParameterHistory(), a = neutralParams(), b = { ...a, inputGainDb: 3 };
  assert.equal(history.record(a, structuredClone(a)), false);
  history.record(a, b);
  const oldGain = a.bands[0]!.gainDb; a.bands[0]!.gainDb = 11;
  const restored = history.undo(b)!;
  assert.equal(restored.bands[0]!.gainDb, oldGain);
  restored.saturation.memory = 0.9;
  assert.equal(history.redo(restored)!.saturation.memory, b.saturation.memory);
});
it("new edits invalidate redo and history is bounded and clearable", () => {
  const history = new ParameterHistory(2), a = neutralParams();
  const b = { ...a, inputGainDb: 1 }, c = { ...a, inputGainDb: 2 }, d = { ...a, inputGainDb: 3 };
  history.record(a, b); history.record(b, c); history.record(c, d);
  assert.equal(history.undoCount, 2);
  assert.deepEqual(history.undo(d), c); assert.deepEqual(history.undo(c), b);
  assert.equal(history.undo(b), null);
  history.record(b, d); assert.equal(history.redo(d), null);
  history.clear(); assert.equal(history.undoCount, 0); assert.equal(history.redoCount, 0);
});

it("a continuous gesture is one undo step while intermediate settings stay live", () => {
  const history = new ParameterHistory(), a = neutralParams();
  const token = history.beginGesture(a);
  let current = a;
  for (let gain = 1; gain <= 10; gain++) {
    const next = { ...a, inputGainDb: gain };
    history.record(current, next); current = next;
    assert.equal(history.undoCount, 1);
  }
  history.endGesture(current, token);
  assert.deepEqual(history.undo(current), a);
  assert.deepEqual(history.redo(a), current);
});
it("net-zero gestures preserve redo and create no undo step", () => {
  const history = new ParameterHistory(), a = neutralParams(), b = { ...a, inputGainDb: 3 };
  history.record(a, b); history.undo(b);
  const token = history.beginGesture(a);
  history.record(a, b); assert.equal(history.redoCount, 0);
  history.record(b, a); history.endGesture(a, token);
  assert.equal(history.undoCount, 0); assert.equal(history.redoCount, 1);
  assert.deepEqual(history.redo(a), b);
});
it("undo during a gesture commits it first and stale end events cannot close a newer gesture", () => {
  const history = new ParameterHistory(), a = neutralParams(), b = { ...a, inputGainDb: 2 };
  const old = history.beginGesture(a); history.record(a, b);
  assert.deepEqual(history.undo(b), a);
  const next = history.beginGesture(a); history.record(a, b);
  assert.equal(history.endGesture(b, old), false);
  assert.equal(history.endGesture(b, next), true);
  assert.deepEqual(history.undo(b), a);
});
it("clear discards an active gesture and its late pointer event", () => {
  const history = new ParameterHistory(), a = neutralParams();
  const old = history.beginGesture(a); history.record(a, { ...a, inputGainDb: 5 });
  history.clear();
  assert.equal(history.endGesture(a, old), false); assert.equal(history.undoCount, 0);
});
