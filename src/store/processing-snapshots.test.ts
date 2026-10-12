import assert from "node:assert/strict";
import { it } from "node:test";
import { neutralParams } from "../dsp/presets.ts";
import { emptyProcessingBank, captureProcessingSnapshot, getProcessingSnapshot, renameProcessingSnapshot,
  deleteProcessingSnapshot, assignProcessingSlot } from "./processing-snapshots.ts";

it("captures deep validated settings, assigns A/B and recalls private copies", () => {
  const params = neutralParams(), originalGain = params.bands[0]!.gainDb;
  let bank = captureProcessingSnapshot(emptyProcessingBank(), " Clean ", params, "a");
  params.bands[0]!.gainDb = 9;
  assert.equal(bank.entries[0]!.params.bands[0]!.gainDb, originalGain);
  bank = captureProcessingSnapshot(bank, "Warm", params, "b");
  assert.equal(bank.aId, "a"); assert.equal(bank.bId, "b");
  const recalled = getProcessingSnapshot(bank, "b"); recalled.params.bands[0]!.gainDb = 1;
  assert.equal(bank.entries[1]!.params.bands[0]!.gainDb, 9);
  assert.equal(bank.entries[0]!.name, "Clean");
});
it("renaming and deleting change metadata only and clear deleted slot assignments", () => {
  const params = neutralParams();
  let bank = captureProcessingSnapshot(emptyProcessingBank(), "Dry", params, "a");
  bank = captureProcessingSnapshot(bank, "Warm", { ...params, inputGainDb: 6 }, "b");
  const renamed = renameProcessingSnapshot(bank, "a", "Baseline");
  assert.equal(bank.entries[0]!.name, "Dry");
  assert.deepEqual(renamed.entries[0]!.params, bank.entries[0]!.params);
  const deleted = deleteProcessingSnapshot(renamed, "a");
  assert.equal(deleted.aId, null); assert.equal(deleted.bId, "b");
  assert.deepEqual(params, neutralParams());
});
it("rejects duplicate names/IDs, unsafe settings and empty or long names", () => {
  const params = neutralParams(), bank = captureProcessingSnapshot(emptyProcessingBank(), "Clean", params, "a");
  assert.throws(() => captureProcessingSnapshot(bank, " clean ", params, "b"), /already exists/);
  assert.throws(() => captureProcessingSnapshot(bank, "Warm", params, "a"), /ID/);
  assert.throws(() => captureProcessingSnapshot(bank, " ", params, "b"), /name/);
  assert.throws(() => captureProcessingSnapshot(bank, "x".repeat(81), params, "b"), /name/);
  assert.throws(() => captureProcessingSnapshot(bank, "Warm", { ...params, inputGainDb: Infinity }, "b"), /invalid/);
  assert.equal(bank.entries.length, 1);
});
it("bounds metadata to eight snapshots without silently overwriting", () => {
  let bank = emptyProcessingBank();
  for (let i = 0; i < 8; i++) bank = captureProcessingSnapshot(bank, `Take ${i}`, neutralParams(), `${i}`);
  assert.throws(() => captureProcessingSnapshot(bank, "Ninth", neutralParams(), "9"), /Eight/);
  assert.equal(bank.entries.length, 8);
});
it("slot assignment validates existence and requires distinct snapshot IDs", () => {
  let bank = captureProcessingSnapshot(emptyProcessingBank(), "A", neutralParams(), "a");
  bank = captureProcessingSnapshot(bank, "B", neutralParams(), "b");
  assert.throws(() => assignProcessingSlot(bank, "b", "a"), /different/);
  assert.throws(() => assignProcessingSlot(bank, "a", "missing"), /no longer exists/);
  bank = assignProcessingSlot(bank, "a", null);
  bank = assignProcessingSlot(bank, "b", "a");
  assert.equal(bank.aId, null); assert.equal(bank.bId, "a");
});
