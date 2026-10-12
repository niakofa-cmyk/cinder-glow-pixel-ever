import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkerStartup } from "../src/store/worker-startup.ts";

test("worker startup waits for all modules before sending transferable jobs", () => {
  const startup = new WorkerStartup(), sent = [];
  startup.enqueue(() => sent.push(1));
  assert.deepEqual(sent, []); assert.equal(startup.ready, false);
  startup.markReady();
  assert.deepEqual(sent, [1]); assert.equal(startup.ready, true);
});
test("superseded startup jobs never run; the latest job uses the same startup", () => {
  const startup = new WorkerStartup(), sent = [];
  startup.enqueue(() => sent.push("stale"));
  startup.cancelQueued();
  startup.enqueue(() => sent.push("latest"));
  startup.markReady(); startup.markReady();
  assert.deepEqual(sent, ["latest"]);
});
test("ready workers send immediately and queued cancellation cannot replay jobs", () => {
  const startup = new WorkerStartup(), sent = [];
  startup.markReady();
  startup.enqueue(() => sent.push(1));
  startup.cancelQueued(); startup.markReady();
  assert.deepEqual(sent, [1]);
});
