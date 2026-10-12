import assert from "node:assert/strict";
import { poll, ready, state } from "./harness.mjs";

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

export async function checkRealtime(page, check) {
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
    await slider.press("Home"); await slider.press("PageUp"); await slider.press("PageUp");
    await poll(() => page.evaluate(() => {
      const f = window.__workletFrames.at(-1); return !f.playing && f.frame > 48000;
    }), "Seek did not reach the worklet");
    const cursor = await page.evaluate(() => window.__workletFrames.at(-1).frame);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await poll(() => page.evaluate(cursor => {
      const f = window.__workletFrames.at(-1); return f.playing && f.frame > cursor;
    }, cursor), "Resume reset transport");
  });
  await check("Unsupported live controls pause explicitly and rendered mode remains usable", async () => {
    await page.getByRole("navigation", { name: "Signal chain" }).getByRole("button", { name: /Glue/ }).click();
    await page.getByRole("button", { name: "Glue off", exact: true }).click();
    await poll(() => page.getByRole("alert").filter({ hasText: /optical glue/ }).isVisible(), "Unsupported optical model was silently ignored");
    assert.equal(await page.getByRole("button", { name: "Play", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Live preview", exact: true }).click();
    await page.getByRole("button", { name: "Reset", exact: true }).click(); await ready(page);
    await page.getByRole("button", { name: "Full range", exact: true }).click();
    if (!(await state(page)).matchLoudness) await page.getByRole("button", { name: /Match loudness/ }).click();
    assert.equal(await page.getByRole("button", { name: "Play", exact: true }).isEnabled(), true);
  });
}
