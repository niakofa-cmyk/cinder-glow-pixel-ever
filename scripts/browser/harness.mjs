import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { wavInfo } from "./fixtures.mjs";

export async function state(page) {
  return page.evaluate(async () => {
    const { useSession } = await import("/src/store/session.ts");
    const s = useSession.getState();
    return {
      programName: s.programName, referenceName: s.referenceName,
      frames: s.program?.l.length, referenceFrames: s.reference?.l.length, sampleRate: s.program?.sampleRate,
      renderedFrames: s.rendered?.l.length, lufs: s.analysis?.integratedLufs,
      params: s.params, report: s.report, refAnalyzed: !!s.refAnalysis,
      busy: s.busy, error: s.error, source: s.source, monitor: s.monitor,
      matchLoudness: s.matchLoudness, targetLufs: s.targetLufs, moduleId: s.moduleId,
      savedAt: s.savedAt, storageBusy: s.storageBusy, storageError: s.storageError,
      storageNotice: s.storageNotice,
    };
  });
}

export async function poll(fn, message, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return;
    } catch (error) {
      // The dev proxy/HMR can navigate while the first readiness query runs.
      // Retry only that transient loss; genuine evaluation errors must surface.
      if (!/Execution context was destroyed|Cannot find context with specified id/.test(String(error))) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

export async function ready(page, name, predicate = () => true) {
  await poll(async () => {
    const s = await state(page);
    return !s.busy && !s.storageBusy && !s.error && s.renderedFrames > 0 &&
      Number.isFinite(s.lufs) && (!name || s.programName === name) && predicate(s) &&
      await page.getByRole("button", { name: "24-bit WAV", exact: true }).isEnabled();
  }, `Render did not settle for ${name ?? "current program"}`);
}

export async function exported(page, label = "32-float") {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: label, exact: true }).click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  return wavInfo(await readFile(await download.path()));
}

export async function importProgram(page, path, name) {
  await page.locator('input[type="file"]').nth(0).setInputFiles(path);
  await ready(page, name);
}

export async function confirmClick(page, name, accept = true) {
  const dialog = page.waitForEvent("dialog");
  const clicking = page.getByRole("button", { name, exact: true }).click();
  const opened = await dialog;
  assert.equal(opened.type(), "confirm");
  await (accept ? opened.accept() : opened.dismiss());
  await clicking;
}

export async function storageDone(page) {
  await poll(async () => !(await state(page)).storageBusy, "Storage operation did not finish");
}

export function audioInstrumentation() {
  window.__heldSharedExports = [];
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      this.addEventListener("message", event => {
        if (event.data?.op === "shared-export" && window.__holdSharedExports) {
          event.stopImmediatePropagation();
          window.__heldSharedExports.push({ worker: this, message: event.data });
        }
      });
    }
  };
  window.__audioContexts = [];
  window.__audioStarts = [];
  window.__audioFilters = [];
  window.__workletFrames = [];
  const Worklet = window.AudioWorkletNode;
  if (Worklet) {
    window.AudioWorkletNode = class extends Worklet {
      constructor(ctx, name, options) {
        super(ctx, name, options);
        const splitter = ctx.createChannelSplitter(2);
        const left = ctx.createAnalyser();
        const right = ctx.createAnalyser();
        left.fftSize = right.fftSize = 32768;
        this.connect(splitter);
        splitter.connect(left, 0); splitter.connect(right, 1);
        window.__workletCapture = { left, right };
        this.port.addEventListener("message", event => {
          if (event.data.type === "meters") window.__workletFrames.push(event.data);
        });
      }
    };
  }
  const Native = window.AudioContext;
  window.AudioContext = class extends Native {
    constructor(...args) {
      super(...args); window.__audioContexts.push(this);
    }
    createGain() {
      const gain = super.createGain(); window.__audioGain = gain; return gain;
    }
    createBiquadFilter() {
      const filter = super.createBiquadFilter(); window.__audioFilters.push(filter); return filter;
    }
    createBufferSource() {
      const source = super.createBufferSource();
      const start = source.start.bind(source);
      source.start = (...args) => {
        const l = source.buffer.getChannelData(0);
        const r = source.buffer.getChannelData(1);
        let peak = 0, monoError = 0;
        for (let i = 0; i < l.length; i++) {
          peak = Math.max(peak, Math.abs(l[i])); monoError = Math.max(monoError, Math.abs(l[i] - r[i]));
        }
        window.__audioStarts.push({ peak, monoError, frames: l.length, rate: source.buffer.sampleRate, gain: window.__audioGain.gain.value });
        return start(...args);
      };
      return source;
    }
  };
}
