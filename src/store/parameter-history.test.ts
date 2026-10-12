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
