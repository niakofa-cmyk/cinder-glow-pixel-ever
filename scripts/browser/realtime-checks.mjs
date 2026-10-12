import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderSharedClip } from "../../src/dsp/rt/render.ts";
import { decodeWavPcm } from "../../src/dsp/wav.ts";
import { exported, importProgram, poll, ready, state } from "./harness.mjs";

async function signal(page) {
  return page.evaluate(() => {
    const capture = window.__workletCapture;
    const l = new Float32Array(32768), r = new Float32Array(32768);
    capture.left.getFloatTimeDomainData(l); capture.right.getFloatTimeDomainData(r);
    let energy = 0, difference = 0;
    for (let i = 0; i < l.length; i++) {
      energy += l[i] * l[i]; difference = Math.max(difference, Math.abs(l[i] - r[i]));
    }
    return { rms: Math.sqrt(energy / l.length), difference };
  });
}

export async function checkRealtime(page, files, check) {
  await importProgram(page, files.program, "program.wav");
  await check("AudioWorklet produces real output, live meters and parameter updates", async () => {
    await page.getByRole("button", { name: "Reset", exact: true }).click(); await ready(page);
    await page.getByRole("button", { name: "Processed", exact: true }).click();
    await page.getByRole("button", { name: "Full range", exact: true }).click();
    if ((await state(page)).matchLoudness) await page.getByRole("button", { name: /Match loudness/ }).click();
    await page.getByRole("button", { name: "Live preview", exact: true }).click();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await poll(() => page.evaluate(() => window.__workletFrames.some(f => f.playing && f.frame > 48000)), "No live worklet playback");
    const before = await signal(page);
    assert.ok(before.rms > 0.02, `No actual output samples: ${before.rms}`);
    await page.getByRole("navigation", { name: "Signal chain" }).getByRole("button", { name: /Input/ }).click();
    await page.getByRole("slider", { name: "Input gain", exact: true }).press("End");
    await poll(async () => (await signal(page)).rms > before.rms * 3.5, "Live gain did not reach the actual audio");
    const after = await signal(page);
    assert.ok(after.rms < before.rms * 4.5);
    await page.getByRole("button", { name: "Mono", exact: true }).click();
    await poll(async () => (await signal(page)).difference < 1e-7, "Mono monitor did not fold actual output", 10000);
    assert.ok(await page.getByRole("region", { name: "Live meters" }).isVisible());
    const latest = await page.evaluate(() => window.__workletFrames.at(-1));
    assert.ok(Number.isFinite(latest.meters.outMomentary));
    assert.ok(latest.meters.latencySamples > 2000);
    return { dryRms: before.rms, processedRms: after.rms, latencySamples: latest.meters.latencySamples };
  });
  await check("Live pause/resume and seek preserve transport position", async () => {
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await poll(() => page.evaluate(() => window.__workletFrames.at(-1)?.playing === false), "Pause was not acknowledged");
    const slider = page.getByRole("slider", { name: "Seek position", exact: true });
    await slider.press("Home");
    await poll(() => page.evaluate(() => window.__workletFrames.at(-1)?.frame === 0), "Seek home was not acknowledged");
    await slider.press("PageUp");
    await poll(async () =>
      await page.evaluate(() => window.__workletFrames.at(-1)?.frame >= 48000) && Number(await slider.inputValue()) >= 1,
    "First coarse seek was not acknowledged");
    await slider.press("PageUp");
    await poll(() => page.evaluate(() => {
      const f = window.__workletFrames.at(-1); return !f.playing && f.frame > 48000;
    }), "Seek did not reach the worklet");
    const cursor = await page.evaluate(() => window.__workletFrames.at(-1).frame);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await poll(() => page.evaluate(cursor => {
      const f = window.__workletFrames.at(-1); return f.playing && f.frame > cursor;
    }, cursor), "Resume reset transport");
  });
  await check("Shared WAV exports match live-engine DSP in every phase/channel mode and format", async () => {
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Reset", exact: true }).click(); await ready(page);
    await page.getByRole("button", { name: "Full range", exact: true }).click();
    await page.getByRole("navigation", { name: "Signal chain" }).getByRole("button", { name: /Equalizer/ }).click();
    await page.getByRole("slider", { name: "Gain", exact: true }).first().press("End"); await ready(page);
    const input = decodeWavPcm(await readFile(files.program)); assert.ok(input);
    let maximumError = 0;
    for (const phase of ["Minimum phase", "Linear phase"]) {
      await page.getByRole("button", { name: phase, exact: true }).click();
      for (const target of ["Stereo", "Mid", "Side"]) {
        await page.getByRole("button", { name: target, exact: true }).click(); await ready(page);
        const expected = renderSharedClip(input, (await state(page)).params);
        for (const bits of [32, 24, 16]) {
          const out = await exported(page, bits === 32 ? "Live-engine 32-float" : `Live-engine ${bits}-bit WAV`);
          assert.equal(out.frames, input.l.length); assert.equal(out.rate, input.sampleRate);
          assert.equal(out.channels, 2);
          assert.ok(out.samples.some(sample => Math.abs(sample) > 0.01), "Shared WAV unexpectedly contains silence");
          let error = 0;
          for (let i = 0; i < out.frames; i++) error = Math.max(error,
            Math.abs(out.samples[i * 2] - expected.l[i]), Math.abs(out.samples[i * 2 + 1] - expected.r[i]));
          const tolerance = bits === 32 ? 2e-7 : 3 / 2 ** (bits - 1) + 2e-7;
          assert.ok(error < tolerance, `${phase}/${target}/${bits}: ${error}`);
          maximumError = Math.max(maximumError, error);
        }
      }
    }
    assert.equal((await state(page)).frames, input.l.length, "Source audio was detached");
    return { formats: 3, phaseChannelCombinations: 6, maximumError };
  });
  await check("Changing settings during shared export prevents a stale download and allows retry", async () => {
    let downloads = 0;
    const onDownload = () => downloads++;
    page.on("download", onDownload);
    try {
      await page.evaluate(() => { window.__holdSharedExports = true; });
      await page.getByRole("button", { name: "Live-engine 32-float", exact: true }).click();
      await poll(() => page.evaluate(() => window.__heldSharedExports.length > 0), "No shared worker response");
      assert.equal(await page.getByRole("button", { name: "Live-engine 24-bit WAV", exact: true }).isDisabled(), true);
      const before = JSON.stringify((await state(page)).params);
      await page.getByRole("slider", { name: "Gain", exact: true }).first().press("Home");
      await poll(async () => JSON.stringify((await state(page)).params) !== before, "The deferred knob edit did not reach the store");
      await page.evaluate(() => {
        window.__holdSharedExports = false;
        for (const held of window.__heldSharedExports.splice(0))
          held.worker.dispatchEvent(new MessageEvent("message", { data: held.message }));
      });
      const warning = page.locator('[role="alert"]').filter({ hasText: /changed during shared export/ });
      await poll(async () => await warning.count() === 1, "Stale settings were exported");
      await warning.scrollIntoViewIfNeeded(); assert.equal(await warning.isVisible(), true);
      assert.equal(downloads, 0);
      await ready(page);
      const retry = await exported(page, "Live-engine 32-float");
      assert.equal(retry.frames, (await state(page)).frames);
    } finally {
      page.off("download", onDownload);
      await page.evaluate(() => { window.__holdSharedExports = false; });
    }
  });
  await check("Optical glue and center carve reach live output and all shared WAV formats", async () => {
    await page.getByRole("button", { name: "Reset", exact: true }).click(); await ready(page);
    await page.getByRole("navigation", { name: "Signal chain" }).getByRole("button", { name: /Glue/ }).click();
    await page.getByRole("button", { name: "Glue off", exact: true }).click();
    await page.getByRole("slider", { name: "Threshold", exact: true }).press("Home");
    await page.getByRole("slider", { name: "Optical", exact: true }).press("End");
    await page.getByRole("navigation", { name: "Signal chain" }).getByRole("button", { name: /Stereo/ }).click();
    await page.getByRole("slider", { name: "Center carve", exact: true }).press("End"); await ready(page);
    const s = await state(page);
    assert.equal(s.params.glue.optical, 1); assert.equal(s.params.carve, 1);
    const input = decodeWavPcm(new Uint8Array(await readFile(files.program)));
    const expected = renderSharedClip(input, s.params);
    for (const [name, bits] of [["Live-engine 32-float", 32], ["Live-engine 24-bit WAV", 24], ["Live-engine 16-bit WAV", 16]]) {
      const actual = await exported(page, name);
      let error = 0;
      for (let i = 0; i < expected.l.length; i++) error = Math.max(error,
        Math.abs(actual.samples[i * 2] - expected.l[i]), Math.abs(actual.samples[i * 2 + 1] - expected.r[i]));
      assert.ok(error <= (bits === 32 ? 0 : 3 / 2 ** (bits - 1)), `${bits}: ${error}`);
    }
    await page.getByRole("slider", { name: "Seek position", exact: true }).press("Home");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await poll(() => page.evaluate(() => {
      const frame = window.__workletFrames.at(-1);
      return frame?.playing && frame.frame > 60000 && frame.meters.glueReductionDb > 1;
    }), "Serial glue was not measured in live DSP");
    const actual = await signal(page);
    assert.ok(actual.rms > 0.001 && actual.rms < 0.03, `Unexpected glued output ${actual.rms}`);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await poll(() => page.evaluate(() => !window.__workletFrames.at(-1)?.playing), "Glue audition did not pause");
    return { optical: 1, carve: 1, formats: 3, liveRms: actual.rms };
  });
  await check("Unsupported live controls pause explicitly and rendered mode remains usable", async () => {
    await page.evaluate(async () => {
      const { useSession } = await import("/src/store/session.ts");
      const s = useSession.getState();
      s.setParams({ ...s.params, bands: Array.from({ length: 17 }, (_, i) => ({ ...s.params.bands[0], id: `extra-${i}` })) });
    });
    await poll(() => page.getByRole("alert").filter({ hasText: /16 EQ bands/ }).isVisible(), "Unsupported band count was silently ignored");
    assert.equal(await page.getByRole("button", { name: "Play", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Live-engine 32-float", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Live preview", exact: true }).click();
    await page.getByRole("button", { name: "Reset", exact: true }).click(); await ready(page);
    await page.getByRole("button", { name: "Full range", exact: true }).click();
    if (!(await state(page)).matchLoudness) await page.getByRole("button", { name: /Match loudness/ }).click();
    assert.equal(await page.getByRole("button", { name: "Play", exact: true }).isEnabled(), true);
  });
}
