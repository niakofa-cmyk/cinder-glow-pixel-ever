import assert from "node:assert/strict";
import { confirmClick, exported, importProgram, poll, ready, state, storageDone } from "./harness.mjs";

async function capture(page, name) {
  await page.getByRole("textbox", { name: "Snapshot name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Capture snapshot", exact: true }).click();
}
async function sourceHash(page) {
  return page.evaluate(async () => {
    const { useSession } = await import("/src/store/session.ts");
    const p = useSession.getState().program;
    const hash = async a => [...new Uint8Array(await crypto.subtle.digest("SHA-256", a.buffer))].map(x => x.toString(16).padStart(2, "0")).join("");
    return [p.sampleRate, p.l.length, await hash(p.l), await hash(p.r)];
  });
}
function maximumDifference(a, b) {
  assert.equal(a.length, b.length);
  let error = 0;
  for (let i = 0; i < a.length; i++) error = Math.max(error, Math.abs(a[i] - b[i]));
  return error;
}

export async function checkSnapshots(page, files, check) {
  await check("Named A/B snapshots recall exact exported settings and preserve original audio", async () => {
    await importProgram(page, files.program, "program.wav");
    await page.getByRole("button", { name: "Reset", exact: true }).click(); await ready(page);
    const original = await sourceHash(page), initialHistory = (await state(page)).undoCount;
    await capture(page, "Baseline");
    const baseline = await exported(page);
    await page.getByRole("navigation", { name: "Signal chain" }).getByRole("button", { name: /Input/ }).click();
    const slider = page.getByRole("slider", { name: "Input gain", exact: true });
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.84, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up(); await ready(page);
    const liftedState = await state(page);
    assert.ok(liftedState.params.inputGainDb > 5);
    assert.equal(liftedState.undoCount, initialHistory + 1, "Pointer drag was not grouped");
    await capture(page, "Lifted");
    const lifted = await exported(page);
    await page.getByRole("button", { name: "Original", exact: true }).click();
    await page.getByRole("button", { name: "Recall A", exact: true }).click(); await ready(page);
    assert.equal((await state(page)).source, "processed");
    assert.equal(maximumDifference((await exported(page)).samples, baseline.samples), 0);
    await page.getByRole("button", { name: "Recall B", exact: true }).click(); await ready(page);
    assert.equal(maximumDifference((await exported(page)).samples, lifted.samples), 0);
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(page);
    assert.equal(maximumDifference((await exported(page)).samples, baseline.samples), 0);
    await slider.focus();
    const count = (await state(page)).undoCount;
    for (let i = 0; i < 6; i++) await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight"); await ready(page);
    assert.equal((await state(page)).undoCount, count + 1, "Held keyboard adjustment was not grouped");
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(page);
    assert.equal((await state(page)).params.inputGainDb, 0);
    assert.deepEqual(await sourceHash(page), original);
    return { liftedGainDb: liftedState.params.inputGainDb, maximumSnapshotRecallError: 0 };
  });
  await check("Snapshot A/B recall reaches real AudioWorklet output", async () => {
    await page.getByRole("button", { name: "Full range", exact: true }).click();
    if ((await state(page)).matchLoudness) await page.getByRole("button", { name: "Match loudness", exact: true }).click();
    await page.getByRole("button", { name: "Live preview", exact: true }).click();
    async function sample(slot) {
      await page.getByRole("button", { name: `Recall ${slot}`, exact: true }).click(); await ready(page);
      await page.getByRole("slider", { name: "Seek position", exact: true }).press("Home");
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await poll(() => page.evaluate(() => {
        const frame = window.__workletFrames.at(-1);
        return frame?.playing && frame.frame > 60000;
      }), "No real worklet samples after snapshot recall");
      const rms = await page.evaluate(() => {
        const samples = new Float32Array(32768);
        window.__workletCapture.left.getFloatTimeDomainData(samples);
        return Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
      });
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await poll(() => page.evaluate(() => window.__workletFrames.at(-1)?.playing === false), "Snapshot playback did not pause");
      return rms;
    }
    const a = await sample("A"), b = await sample("B");
    assert.ok(a > 0.005 && b > a * 2, `Snapshot output mismatch: A=${a}, B=${b}`);
    const expected = 10 ** ((await state(page)).params.inputGainDb / 20);
    assert.ok(Math.abs(b / a - expected) < 0.4);
    await page.getByRole("button", { name: "Live preview", exact: true }).click();
    return { baselineRms: a, liftedRms: b, measuredRatio: b / a, expectedRatio: expected };
  });
  await check("Named snapshots persist, rename safely and require deletion consent", async () => {
    await page.getByRole("button", { name: "Rename snapshot Lifted", exact: true }).click();
    await page.getByRole("textbox", { name: "Snapshot name", exact: true }).fill("Lifted print");
    await page.getByRole("button", { name: "Save snapshot name", exact: true }).click();
    const bank = (await state(page)).processingBank;
    if ((await state(page)).savedAt) await confirmClick(page, "Save session");
    else await page.getByRole("button", { name: "Save session", exact: true }).click();
    await storageDone(page);
    assert.ok((await state(page)).savedAt);
    await page.reload(); await ready(page, "program.wav");
    assert.deepEqual((await state(page)).processingBank, bank);
    assert.equal((await state(page)).undoCount, 0);
    await page.getByRole("button", { name: "Recall B", exact: true }).click(); await ready(page);
    const current = (await state(page)).params, before = await exported(page);
    await confirmClick(page, "Delete snapshot Lifted print", false);
    assert.equal((await state(page)).processingBank.entries.length, 2);
    await confirmClick(page, "Delete snapshot Lifted print", true);
    assert.equal((await state(page)).processingBank.bId, null);
    assert.deepEqual((await state(page)).params, current);
    assert.equal(maximumDifference((await exported(page)).samples, before.samples), 0);
    await confirmClick(page, "Delete saved session"); await storageDone(page);
  });
  await check("Snapshot names and A/B controls fit mobile and new sources clear snapshots", async () => {
    await capture(page, "L".repeat(80));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("region", { name: "Processing snapshots", exact: true }).scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    for (const name of ["Capture snapshot", "Recall A", "Recall B"]) {
      const button = page.getByRole("button", { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 391);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await importProgram(page, files.program, "program.wav");
    await poll(async () => (await state(page)).processingBank.entries.length === 0, "New source kept old snapshots");
    assert.equal((await state(page)).processingBank.aId, null);
    assert.equal((await state(page)).processingBank.bId, null);
  });
}
