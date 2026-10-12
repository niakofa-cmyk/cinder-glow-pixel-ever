import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { exported, importProgram, poll, ready, state } from "./harness.mjs";

const rms = samples => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);

async function qualityReport(page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download quality report", exact: true }).click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  return JSON.parse(await readFile(await download.path(), "utf8"));
}

export async function checkDocumentEnhancements(page, files, check) {
  await check("Processing undo and redo restore actual exported audio", async () => {
    await importProgram(page, files.program, "program.wav");
    await page.getByRole("button", { name: "Reset", exact: true }).click(); await ready(page);
    await page.getByRole("navigation", { name: "Signal chain" }).getByRole("button", { name: /Input/ }).click();
    const baseline = await exported(page);
    await page.getByRole("slider", { name: "Input gain", exact: true }).press("End"); await ready(page);
    const boosted = await exported(page);
    assert.ok(rms(boosted.samples) / rms(baseline.samples) > 3.8);
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(page);
    const restored = await exported(page);
    let error = 0;
    for (let i = 0; i < restored.samples.length; i++) error = Math.max(error, Math.abs(restored.samples[i] - baseline.samples[i]));
    assert.ok(error < 1e-6);
    await page.keyboard.press("Control+Shift+z"); await ready(page);
    assert.equal((await state(page)).params.inputGainDb, 12);
    await exported(page);
    const audit = await qualityReport(page);
    assert.equal(audit.quality.engine, "offline");
    assert.equal(audit.quality.format.frames, boosted.frames);
    assert.equal(audit.params.inputGainDb, 12);
    assert.equal(audit.quality.measurements.clippedSamples, 0);
    assert.ok(audit.quality.measurements.integratedLufs > audit.original.integratedLufs + 11);
    assert.ok(!("spectrumDb" in audit.original));
    const review = audit.processingReview;
    assert.equal(review.version, 1);
    assert.equal(review.criteria.targetLufs, audit.targetLufs);
    assert.equal(review.criteria.ceilingDb, audit.params.limiter.ceilingDb);
    assert.equal(review.checks.length, 6);
    assert.match(review.limitations.join(" "), /not a trained AI model/);
    const reviewPanel = page.getByRole("region", { name: "Processing tradeoff review", exact: true });
    assert.equal(await reviewPanel.count(), 1);
    assert.equal(await reviewPanel.isVisible(), true);
    for (const item of review.checks) {
      assert.ok((await reviewPanel.textContent()).includes(item.evidence));
    }
    // Check the same measured review survives report download on a phone viewport.
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await reviewPanel.scrollIntoViewIfNeeded();
    assert.equal(await reviewPanel.isVisible(), true);
    await page.setViewportSize({ width: 1440, height: 960 });
    return { maximumRestoredError: error, undoCount: (await state(page)).undoCount };
  });
  await check("Changing settings cancels verified offline export and retry succeeds", async () => {
    let downloads = 0;
    const record = () => downloads++;
    page.on("download", record);
    try {
      await page.evaluate(() => { window.__holdSharedExports = true; });
      await page.getByRole("button", { name: "32-float", exact: true }).click();
      await poll(() => page.evaluate(() => window.__heldSharedExports.length > 0), "No encoded export response");
      await page.keyboard.press("Control+z");
      await poll(async () => (await state(page)).params.inputGainDb !== 12, "Undo did not update settings");
      await page.evaluate(() => {
        window.__holdSharedExports = false;
        for (const held of window.__heldSharedExports.splice(0))
          held.worker.dispatchEvent(new MessageEvent("message", { data: held.message }));
      });
      const warning = page.locator('[role="alert"]').filter({ hasText: /changed during export/ });
      await poll(async () => await warning.count() === 1, "Cancelled offline export did not explain retry");
      assert.equal(downloads, 0);
      await ready(page); await exported(page);
      assert.equal((await qualityReport(page)).params.inputGainDb, 0);
    } finally {
      page.off("download", record);
      await page.evaluate(() => { window.__holdSharedExports = false; });
    }
  });
  await check("Encoded quality report agrees with independent FFmpeg loudness and peak checks", async () => {
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.getByRole("button", { name: /23 LUFS tone/ }).click(); await ready(page);
    assert.equal((await state(page)).undoCount, 0, "Changing source retained processing history");
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "24-bit WAV", exact: true }).click();
    const wav = await pending; assert.equal(await wav.failure(), null);
    const audit = await qualityReport(page);
    const verification = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", await wav.path(), "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", timeout: 30000 });
    assert.equal(verification.status, 0, verification.stderr);
    const lufs = Number([...verification.stderr.matchAll(/\bI:\s*(-?[\d.]+) LUFS/g)].at(-1)?.[1]);
    const peak = Number([...verification.stderr.matchAll(/\bPeak:\s*(-?[\d.]+) dBFS/g)].at(-1)?.[1]);
    assert.ok(Number.isFinite(lufs) && Number.isFinite(peak), "FFmpeg did not measure the actual downloaded file");
    assert.ok(Math.abs(lufs - audit.quality.measurements.integratedLufs) < 0.5);
    assert.ok(Math.abs(peak - audit.quality.measurements.truePeakDb) < 0.3);
    assert.equal(audit.quality.format.bitDepth, 24);
    return { appLufs: audit.quality.measurements.integratedLufs, ffmpegLufs: lufs, appTruePeak: audit.quality.measurements.truePeakDb, ffmpegTruePeak: peak };
  });
}
