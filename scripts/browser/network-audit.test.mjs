import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { attachNetworkAudit } from "./network-audit.mjs";

const request = error => ({
  url: () => "https://example.test/src/dsp/fft.ts",
  resourceType: () => "script", failure: () => ({ errorText: error }),
});
function pageFixture() {
  const page = new EventEmitter(), frame = {};
  page.mainFrame = () => frame;
  page.reload = async () => {};
  return page;
}
test("network audit retains failures outside navigation with exact reasons", () => {
  const page = pageFixture(), audit = attachNetworkAudit(page, () => "Playback");
  const req = request("Connection refused");
  page.emit("request", req); page.emit("requestfailed", req);
  assert.equal(audit.failedRequests[0].errorText, "Connection refused");
  assert.equal(audit.failedRequests[0].navigationId, null);
  assert.equal(audit.failedRequests[0].check, "Playback");
});
test("network audit links reload cancellations to their navigation and generation", async () => {
  const page = pageFixture(), req = request("Load request cancelled");
  page.reload = async () => {
    page.emit("requestfailed", req);
    page.emit("framenavigated", page.mainFrame());
  };
  const audit = attachNetworkAudit(page);
  page.emit("request", req); await page.reload();
  assert.equal(audit.failedRequests.length, 1); // Still fatal, not silently filtered.
  assert.equal(audit.failedRequests[0].navigationId, 1);
  assert.ok(audit.navigations[0].finishedAt >= audit.navigations[0].startedAt);
  const later = request("Load failed"); page.emit("request", later); page.emit("requestfailed", later);
  assert.equal(audit.failedRequests[1].generation, 1);
  assert.equal(audit.failedRequests[1].navigationId, null);
});
