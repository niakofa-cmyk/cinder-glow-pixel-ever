import assert from "node:assert/strict";
import { confirmClick, exported, importProgram, poll, ready, state, storageDone } from "./harness.mjs";

const snapshotFields = s => ({
  programName: s.programName, referenceName: s.referenceName, frames: s.frames,
  referenceFrames: s.referenceFrames, sampleRate: s.sampleRate, params: s.params,
  source: s.source, monitor: s.monitor, matchLoudness: s.matchLoudness,
  targetLufs: s.targetLufs, moduleId: s.moduleId,
});

export async function checkSessions(page, files, check) {
  await check("Save and refresh restore native-rate audio, reference, settings and exports", async () => {
    await importProgram(page, files.native, "native.wav");
    await page.locator('input[type="file"]').nth(1).setInputFiles(files["native-reference"]);
    await ready(page, "native.wav", s => s.referenceName === "native-reference.wav" && s.refAnalyzed);
    await page.getByRole("navigation", { name: "Signal chain" }).getByRole("button", { name: /Equalizer/ }).click();
    await page.getByRole("button", { name: "Linear phase", exact: true }).click();
    await ready(page, "native.wav", s => s.params.eqMode === "linear");
    await page.getByRole("button", { name: "Side", exact: true }).click();
    await ready(page, "native.wav", s => s.params.eqTarget === "side");
    await page.locator("button").filter({ hasText: /^Reference$/ }).click();
    await page.getByRole("button", { name: "Mono", exact: true }).click();
    if ((await state(page)).matchLoudness) await page.getByRole("button", { name: /Match loudness/ }).click();
    const before = snapshotFields(await state(page));
    const audio = await exported(page);
    await page.getByRole("button", { name: "Save session", exact: true }).click();
    await poll(async () => !!(await state(page)).savedAt, "Session was not saved");
    await storageDone(page);
    await page.reload();
    await ready(page, "native.wav");
    assert.deepEqual(snapshotFields(await state(page)), before);
    assert.deepEqual((await exported(page)).samples, audio.samples);
    assert.equal((await state(page)).sampleRate, 44100);
    return { frames: before.frames, sampleRate: 44100 };
  });
  await check("Manual restore and save overwrite confirmation", async () => {
    const saved = snapshotFields(await state(page));
    const savedAt = (await state(page)).savedAt;
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await ready(page, "native.wav", s => s.params.eqMode === "minimum");
    await confirmClick(page, "Save session", false);
    assert.equal((await state(page)).savedAt, savedAt);
    await confirmClick(page, "Restore session");
    await ready(page, "native.wav", s => s.params.eqMode === "linear");
    assert.deepEqual(snapshotFields(await state(page)), saved);
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await ready(page, "native.wav", s => s.params.eqMode === "minimum");
    await confirmClick(page, "Save session");
    await storageDone(page);
    assert.ok((await state(page)).savedAt > savedAt);
    await page.reload(); await ready(page, "native.wav");
    assert.equal((await state(page)).params.eqMode, "minimum");
  });
  await check("Quota errors keep previous save and allow recovery", async () => {
    const savedAt = (await state(page)).savedAt;
    await page.getByRole("navigation", { name: "Signal chain" }).getByRole("button", { name: /Input/ }).click();
    await page.getByRole("slider", { name: "Input gain", exact: true }).press("End");
    await ready(page, "native.wav", s => s.params.inputGainDb === 12);
    await page.evaluate(() => {
      window.__originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = () => { throw new DOMException("Full", "QuotaExceededError"); };
    });
    try {
      await confirmClick(page, "Save session"); await storageDone(page);
      assert.match((await state(page)).storageError, /storage is full.*previous saved session/i);
      assert.equal((await state(page)).savedAt, savedAt);
      assert.equal((await state(page)).params.inputGainDb, 12);
    } finally {
      await page.evaluate(() => { IDBObjectStore.prototype.put = window.__originalPut; });
    }
    await confirmClick(page, "Restore session");
    await ready(page, "native.wav", s => s.params.inputGainDb === 0);
    assert.equal((await state(page)).storageError, null);
  });
  await check("Deleting a saved session requires consent and leaves active audio intact", async () => {
    const before = snapshotFields(await state(page));
    await confirmClick(page, "Delete saved session", false);
    assert.ok((await state(page)).savedAt);
    await confirmClick(page, "Delete saved session");
    await storageDone(page);
    assert.equal((await state(page)).savedAt, null);
    assert.deepEqual(snapshotFields(await state(page)), before);
    assert.equal(await page.getByRole("button", { name: "Restore session", exact: true }).isDisabled(), true);
    await page.reload(); await ready(page, "House program");
  });
  await check("Incompatible saved data shows an error and can be deleted and replaced", async () => {
    await page.evaluate(() => new Promise((resolve, reject) => {
      const opening = indexedDB.open("aurora-local-sessions", 1);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result;
        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").put({ version: 99 }, "current");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }));
    await page.reload(); await ready(page, "House program");
    assert.match((await state(page)).storageError, /corrupt or incompatible.*Delete/);
    assert.ok(await page.getByRole("alert").isVisible());
    await confirmClick(page, "Delete saved session"); await storageDone(page);
    assert.equal((await state(page)).storageError, null);
    await page.getByRole("button", { name: "Save session", exact: true }).click();
    await poll(async () => !!(await state(page)).savedAt, "Could not save after removing corrupt data");
    await page.reload(); await ready(page, "House program");
    assert.equal((await state(page)).storageError, null);
  });
}
