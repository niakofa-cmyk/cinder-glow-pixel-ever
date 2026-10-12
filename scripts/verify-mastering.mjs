import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { fixture, makeFixtures, wavInfo } from "./browser/fixtures.mjs";
import { audioInstrumentation, exported, importProgram, poll, ready, state } from "./browser/harness.mjs";
import { checkSessions } from "./browser/session-checks.mjs";
import { checkRealtime } from "./browser/realtime-checks.mjs";
import { checkDocumentEnhancements } from "./browser/document-checks.mjs";
import { checkSnapshots } from "./browser/snapshot-checks.mjs";

const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const url = option("url", process.env.E2E_BASE_URL ?? "http://127.0.0.1:5000");
await mkdir("generated-artifacts/browser", { recursive: true });
const dir = await mkdtemp("generated-artifacts/browser/run-");
const files = await makeFixtures(dir);
const dry = wavInfo(fixture());
const engine = option("browser", "chromium");
if (!["chromium", "firefox", "webkit"].includes(engine)) throw new Error(`Unsupported browser: ${engine}`);
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  executablePath: engine === "chromium" ? option("chromium", process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) : undefined,
  headless: true, args: engine === "chromium" ? ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] : [],
  ...(engine === "firefox" ? { firefoxUserPrefs: { "media.autoplay.default": 0, "media.autoplay.block-webaudio": false } } : {}),
  ...(option("library-path") ? { env: { ...process.env, LD_LIBRARY_PATH: option("library-path") } } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
await context.addInitScript(audioInstrumentation);
const page = await context.newPage();
const errors = [], failedRequests = [], audioWrites = [], results = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
page.on("requestfailed", request => failedRequests.push(request.url()));
page.on("request", request => { if (["POST", "PUT", "PATCH"].includes(request.method())) audioWrites.push(request.url()); });
async function check(name, fn) {
  if (process.argv.includes("--snapshots-only") && ![
    "Preview and demo render",
    "Named A/B snapshots recall exact exported settings and preserve original audio",
    "Snapshot A/B recall reaches real AudioWorklet output",
    "Named snapshots persist, rename safely and require deletion consent",
    "Snapshot names and A/B controls fit mobile and new sources clear snapshots",
    "No uncaught errors, failed requests, or audio uploads",
  ].includes(name)) return;
  if (process.argv.includes("--document-only") && ![
    "Preview and demo render",
    "Processing undo and redo restore actual exported audio",
    "Changing settings cancels verified offline export and retry succeeds",
    "Encoded quality report agrees with independent FFmpeg loudness and peak checks",
    "No uncaught errors, failed requests, or audio uploads",
  ].includes(name)) return;
  if (process.argv.includes("--live-only") && ![
    "Preview and demo render", "WAV program and reference import",
    "Optical glue and center carve reach live output and all shared WAV formats",
    "AudioWorklet produces real output, live meters and parameter updates",
    "Live pause/resume and seek preserve transport position",
    "Shared WAV exports match live-engine DSP in every phase/channel mode and format",
    "Changing settings during shared export prevents a stale download and allows retry",
    "Unsupported live controls pause explicitly and rendered mode remains usable",
    "No uncaught errors, failed requests, or audio uploads",
  ].includes(name)) return;
  const started = Date.now();
  try {
    const details = await fn();
    results.push({ name, passed: true, ms: Date.now() - started, details });
    console.log(`PASS ${name}${details ? ` ${JSON.stringify(details)}` : ""}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.stack });
    await page.screenshot({ path: join(dir, `failure-${results.length}.png`) }).catch(() => {});
    throw error;
  }
}
async function play() {
  const before = await page.evaluate(() => window.__audioContexts.at(-1)?.currentTime ?? 0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await poll(() => page.evaluate(before => {
    const ctx = window.__audioContexts.at(-1);
    return ctx?.state === "running" && ctx.currentTime > before + 0.2;
  }, before), "AudioContext did not play", 10000);
  const last = await page.evaluate(() => window.__audioStarts.at(-1));
  assert.ok(last.peak > 0); assert.equal(last.frames, 288000); assert.equal(last.rate, 48000);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  return last;
}
try {
  await check("Preview and demo render", async () => {
    const response = await page.goto(url); assert.equal(response.status(), 200);
    await ready(page, "House program");
  });
  await check("WAV program and reference import", async () => {
    await importProgram(page, files.program, "program.wav");
    await page.locator('input[type="file"]').nth(1).setInputFiles(files.reference);
    await ready(page, "program.wav", s => s.referenceName === "reference.wav" && s.refAnalyzed);
    assert.equal((await state(page)).frames, 288000);
  });
  await check("Real original/processed/reference playback and monitor modes", async () => {
    for (const source of ["Original", "Processed", "Reference"]) {
      await page.locator("button").filter({ hasText: new RegExp(`^${source}$`) }).click();
      await play();
    }
    await page.getByRole("button", { name: "Mono", exact: true }).click();
    assert.equal((await play()).monoError, 0);
    await page.getByRole("button", { name: "Small speaker", exact: true }).click();
    await play();
    assert.deepEqual(await page.evaluate(() => window.__audioFilters.slice(-2).map(f => f.frequency.value)), [180, 5500]);
    await page.getByRole("button", { name: "Full range", exact: true }).click();
    const match = page.getByRole("button", { name: /Match loudness/ });
    await match.click(); assert.equal(await match.getAttribute("aria-pressed"), "false");
    assert.equal((await play()).gain, 1);
    await match.click(); assert.equal(await match.getAttribute("aria-pressed"), "true");
    assert.ok((await play()).gain > 1);
  });
  await check("Last input gain wins; all three exports contain processed samples", async () => {
    await page.getByRole("button", { name: "Reset", exact: true }).click(); await ready(page);
    await page.getByRole("navigation", { name: "Signal chain" }).getByRole("button", { name: /Glue/ }).click();
    await page.getByRole("button", { name: "Glue off", exact: true }).click();
    await ready(page, "program.wav", s => s.params.glue.enabled);
    await page.getByRole("button", { name: "Reset", exact: true }).click(); await ready(page);
    await page.getByRole("navigation", { name: "Signal chain" }).getByRole("button", { name: /Input/ }).click();
    const input = page.getByRole("slider", { name: "Input gain", exact: true });
    await input.press("End"); await input.press("Home"); await input.press("End");
    await ready(page, "program.wav", s => s.params.inputGainDb === 12);
    for (const [label, bits, format] of [["24-bit WAV", 24, 1], ["32-float", 32, 3], ["16-bit", 16, 1]]) {
      const out = await exported(page, label);
      assert.equal(out.bits, bits); assert.equal(out.format, format);
      assert.equal(out.frames, 288000); assert.equal(out.rate, 48000); assert.equal(out.channels, 2);
      assert.ok(Math.abs(out.rms / dry.rms - 10 ** (12 / 20)) < 0.002);
      assert.ok(out.peak < 1);
    }
  });
  await check("Exported phase and mid/side EQ follow selected controls", async () => {
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await ready(page, "program.wav", s => s.params.inputGainDb === 0);
    await page.getByRole("navigation", { name: "Signal chain" }).getByRole("button", { name: /Equalizer/ }).click();
    await page.getByRole("slider", { name: "Gain", exact: true }).first().press("End");
    await ready(page, "program.wav", s => s.params.bands.find(b => b.id === "low").gainDb === 12);
    const minimum = await exported(page);
    await page.getByRole("button", { name: "Linear phase", exact: true }).click();
    await ready(page, "program.wav", s => s.params.eqMode === "linear");
    const linear = await exported(page);
    let difference = 0;
    for (let i = 0; i < linear.samples.length; i++) difference = Math.max(difference, Math.abs(linear.samples[i] - minimum.samples[i]));
    assert.ok(difference > 0.001);
    for (const [label, target, sign] of [["Mid", "mid", -1], ["Side", "side", 1]]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await ready(page, "program.wav", s => s.params.eqTarget === target);
      const out = await exported(page);
      for (let i = 0; i < out.samples.length; i += 2) {
        const error = Math.abs((out.samples[i] + sign * out.samples[i + 1] - dry.samples[i] - sign * dry.samples[i + 1]) * 0.5);
        assert.ok(error < 1e-7);
      }
    }
    return { maximumPhaseDifference: difference };
  });
  await check("Bad audio and mismatched references fail clearly and recover", async () => {
    await page.locator('input[type="file"]').nth(1).setInputFiles(files.native);
    await poll(async () => !!(await state(page)).error, "No rate mismatch error");
    assert.match((await state(page)).error, /44100.*48000/);
    assert.equal((await state(page)).busy, null);
    await page.locator('input[type="file"]').nth(0).setInputFiles(files.invalid);
    await poll(async () => /decode/.test((await state(page)).error ?? ""), "No invalid audio guidance");
    assert.equal((await state(page)).programName, "program.wav");
    await importProgram(page, files.program, "program.wav");
  });
  await check("MP3/FLAC import; AIFF supported or explicitly rejected", async () => {
    for (const extension of ["mp3", "flac", "aiff"]) {
      await page.locator('input[type="file"]').nth(0).setInputFiles(files[extension]);
      await poll(async () => {
        const s = await state(page); return !s.busy && (s.error || s.programName === `program.${extension}`);
      }, `Codec ${extension} did not finish`);
      const s = await state(page);
      if (s.error) {
        assert.equal(extension, "aiff"); assert.match(s.error, /decode.*WAV/i);
      } else {
        await ready(page, `program.${extension}`); assert.ok(s.frames >= 288000);
      }
    }
    await importProgram(page, files.program, "program.wav");
    await page.getByRole("button", { name: "Reset", exact: true }).click(); await ready(page);
  });
  await checkDocumentEnhancements(page, files, check);
  await checkSnapshots(page, files, check);
  await checkRealtime(page, files, check);
  await checkSessions(page, files, check);
  await check("Storage unavailable still opens demo with an explicit error", async () => {
    const isolated = await browser.newContext();
    try {
      await isolated.addInitScript(() => {
        indexedDB.open = () => { throw new DOMException("Local storage access denied.", "SecurityError"); };
      });
      const privatePage = await isolated.newPage();
      await privatePage.goto(url); await ready(privatePage, "House program");
      assert.match((await state(privatePage)).storageError, /storage access denied/);
      assert.ok(await privatePage.getByRole("alert").isVisible());
    } finally { await isolated.close(); }
  });
  await check("Mobile playback, export and session controls are reachable", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    for (const name of ["Play", "24-bit WAV", "32-float", "16-bit", "Save session", "Restore session", "Delete saved session"]) {
      const button = page.getByRole("button", { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845);
    }
    await page.screenshot({ path: join(dir, "mobile.png") });
  });
  await check("No uncaught errors, failed requests, or audio uploads", async () => {
    assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []); assert.deepEqual(audioWrites, []);
  });
} finally {
  await writeFile(join(dir, "report.json"), JSON.stringify({ url, browser: engine, version: browser.version(), results, errors, failedRequests, audioWrites }, null, 2));
  await browser.close();
  console.log(`Browser evidence: ${dir}`);
}
