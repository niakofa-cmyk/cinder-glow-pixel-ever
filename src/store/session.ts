import { spectralDelta } from "@/dsp/analyze";
import { matchGainDb } from "@/dsp/chain";
import { calibrationTone, makeDemo } from "@/dsp/demo";
import type { OfflineCommand, OfflineResponse } from "@/dsp/offline.worker";
import { neutralParams } from "@/dsp/presets";
import { applyPatch, suggest } from "@/dsp/suggest";
import type { Analysis, ChainParams, Clip, Finding, ProcessReport } from "@/dsp/types";
import { create } from "zustand";
import type { ExportEngine, ExportQuality } from "../dsp/export-quality.ts";
import { ParameterHistory } from "./parameter-history.ts";
import type { SessionSnapshot } from "./session-snapshot";
import { readLocalSession, removeLocalSession, storageMessage, writeLocalSession } from "./session-storage";

export type SourceChoice = "original" | "processed" | "reference";
export type MonitorChoice = "full" | "mono" | "small";

type Session = {
  program: Clip | null;
  reference: Clip | null;
  programName: string;
  referenceName: string;
  analysis: Analysis | null;
  refAnalysis: Analysis | null;
  params: ChainParams;
  rendered: Clip | null;
  report: ProcessReport | null;
  findings: Finding[];
  busy: string | null;
  error: string | null;
  source: SourceChoice;
  monitor: MonitorChoice;
  matchLoudness: boolean;
  targetLufs: number;
  moduleId: string;
  undoCount: number;
  redoCount: number;
  savedAt: number | null;
  storageBusy: boolean;
  storageError: string | null;
  storageNotice: string | null;
  initialize: () => Promise<void>;
  saveLocal: () => Promise<void>;
  restoreLocal: () => Promise<void>;
  deleteLocal: () => Promise<void>;
  loadDemo: () => void;
  loadCalibration: () => void;
  loadProgram: (name: string, audio: Clip) => void;
  loadReference: (name: string, audio: Clip) => void;
  setParams: (params: ChainParams, recordHistory?: boolean) => void;
  undoParams: () => void;
  redoParams: () => void;
  patchParams: (patch: Partial<ChainParams>) => void;
  setSource: (source: SourceChoice) => void;
  setMonitor: (monitor: MonitorChoice) => void;
  setMatch: (on: boolean) => void;
  setTarget: (lufs: number) => void;
  setModule: (id: string) => void;
};

let job = 0;
const parameterHistory = new ParameterHistory();
function clearParameterHistory() {
  parameterHistory.clear();
  useSession.setState({ undoCount: 0, redoCount: 0 });
}
let requestId = 0;
let offlineWorker: Worker | null = null;
let storageJob = 0;
const pending = new Map<
  number,
  { resolve: (response: OfflineResponse) => void; reject: (error: Error) => void }
>();

function toClip(l: ArrayLike<number>, r: ArrayLike<number>, sampleRate: number): Clip {
  const outL = new Float32Array(l.length);
  const outR = new Float32Array(r.length);
  for (let i = 0; i < outL.length; i++) outL[i] = l[i] ?? 0;
  for (let i = 0; i < outR.length; i++) outR[i] = r[i] ?? 0;
  return { l: outL, r: outR, sampleRate };
}

function memoryMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (/array buffer allocation failed|out of memory/i.test(raw)) {
    return "This file is too big to master in this browser. The original still plays.";
  }
  return raw || "Could not measure that file. The original still plays.";
}

function settlePending(error: Error) {
  for (const task of pending.values()) task.reject(error);
  pending.clear();
}

function terminateOfflineWorker(reason: string) {
  offlineWorker?.terminate();
  offlineWorker = null;
  settlePending(new Error(reason));
}

function getOfflineWorker(): Worker {
  if (typeof Worker === "undefined") {
    throw new Error("This browser does not support background audio processing.");
  }
  if (offlineWorker) return offlineWorker;

  const worker = new Worker(new URL("../dsp/offline.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<OfflineResponse>) => {
    const response = event.data;
    const task = pending.get(response.id);
    if (!task) return;
    pending.delete(response.id);
    if (response.op === "error") task.reject(new Error(response.message));
    else task.resolve(response);
  };
  worker.onerror = () => {
    terminateOfflineWorker("Background audio processing stopped unexpectedly.");
  };
  worker.onmessageerror = () => {
    terminateOfflineWorker("The audio-processing worker returned unreadable data.");
  };
  offlineWorker = worker;
  return worker;
}

function runOffline(command: OfflineCommand, transfer: Transferable[]): Promise<OfflineResponse> {
  const worker = getOfflineWorker();
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      worker.postMessage({ ...command, id }, transfer);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error("Audio processing could not start."));
    }
  });
}

function copyForWorker(clip: Clip): Clip {
  return { l: new Float32Array(clip.l), r: new Float32Array(clip.r), sampleRate: clip.sampleRate };
}

/** Does not replace the established offline master or mutate/detach source audio. */
export async function renderSharedWav(clip: Clip, params: ChainParams, bits: 16 | 24 | 32): Promise<ArrayBuffer> {
  return (await renderVerifiedWav(clip, params, bits, "shared")).buffer;
}

export async function renderVerifiedWav(clip: Clip, params: ChainParams, bits: 16 | 24 | 32, engine: ExportEngine): Promise<{ buffer: ArrayBuffer; quality: ExportQuality }> {
  const audio = copyForWorker(clip);
  const command: OfflineCommand = engine === "shared"
    ? { op: "shared-export", audio, params, bits } : { op: "encode-export", audio, bits };
  const response = await runOffline(command,
    [audio.l.buffer as ArrayBuffer, audio.r.buffer as ArrayBuffer]);
  if (response.op !== "shared-export" && response.op !== "encode-export") throw new Error("Background export returned incomplete data.");
  return { buffer: response.buffer, quality: response.quality };
}

/** Keep analysis and offline rendering away from the browser's interactive thread. */
async function master(id: number, clip: Clip, params: ChainParams, alsoAnalyze: boolean) {
  try {
    const audio = copyForWorker(clip);
    let command: OfflineCommand;
    const transfer: Transferable[] = [audio.l.buffer, audio.r.buffer];

    if (alsoAnalyze) {
      const state = useSession.getState();
      const reference = state.reference?.sampleRate === clip.sampleRate ? copyForWorker(state.reference) : null;
      if (reference) transfer.push(reference.l.buffer, reference.r.buffer);
      command = {
        op: "full",
        audio,
        reference,
        params,
        targetLufs: state.targetLufs,
      };
    } else {
      command = { op: "render", audio, params };
    }

    const response = await runOffline(command, transfer);
    if (id !== job) return;

    if (alsoAnalyze) {
      if (response.op !== "full") throw new Error("The audio worker returned an incomplete analysis.");
      useSession.setState({
        analysis: response.analysis,
        refAnalysis: response.refAnalysis,
        findings: suggest(response.analysis, useSession.getState().targetLufs),
        rendered: { l: response.l, r: response.r, sampleRate: response.sampleRate },
        report: response.report,
        busy: null,
        error: null,
      });
    } else {
      if (response.op !== "render") throw new Error("The audio worker returned an incomplete render.");
      useSession.setState({
        rendered: { l: response.l, r: response.r, sampleRate: response.sampleRate },
        report: response.report,
        busy: null,
        error: null,
      });
    }
  } catch (error) {
    if (id !== job) return;
    useSession.setState({ busy: null, error: memoryMessage(error) });
  }
}

export const useSession = create<Session>((set, get) => ({
  program: null,
  reference: null,
  programName: "",
  referenceName: "",
  analysis: null,
  refAnalysis: null,
  params: neutralParams(),
  rendered: null,
  report: null,
  findings: [],
  undoCount: 0,
  redoCount: 0,
  busy: null,
  error: null,
  source: "processed",
  monitor: "full",
  matchLoudness: true,
  targetLufs: -14,
  moduleId: "eq",
  savedAt: null,
  storageBusy: false,
  storageError: null,
  storageNotice: null,

  initialize: async () => {
    if (get().program) return;
    const id = ++storageJob;
    const startingJob = job;
    set({ storageBusy: true, storageError: null });
    try {
      const snapshot = await readLocalSession();
      if (id !== storageJob) return;
      set({ savedAt: snapshot?.savedAt ?? null });
      if (startingJob !== job) return;
      if (snapshot) {
        restoreSnapshot(snapshot);
      } else {
        get().loadDemo();
      }
    } catch (error) {
      if (id !== storageJob) return;
      set({ storageError: storageMessage(error) });
      if (startingJob === job && !get().program) get().loadDemo();
    } finally {
      if (id === storageJob) set({ storageBusy: false });
    }
  },

  saveLocal: async () => {
    const state = get();
    if (state.storageBusy || state.busy || !state.program) return;
    const id = ++storageJob;
    const snapshot: SessionSnapshot = {
      version: 1, savedAt: Date.now(), program: state.program, reference: state.reference,
      programName: state.programName, referenceName: state.referenceName,
      params: state.params, source: state.source, monitor: state.monitor,
      matchLoudness: state.matchLoudness, targetLufs: state.targetLufs,
      moduleId: state.moduleId as SessionSnapshot["moduleId"],
    };
    set({ storageBusy: true, storageError: null, storageNotice: null });
    try {
      await writeLocalSession(snapshot);
      if (id === storageJob) set({ savedAt: snapshot.savedAt, storageNotice: "Session saved in this browser. Save again after making changes." });
    } catch (error) {
      if (id === storageJob) set({ storageError: storageMessage(error) });
    } finally {
      if (id === storageJob) set({ storageBusy: false });
    }
  },

  restoreLocal: async () => {
    if (get().storageBusy) return;
    const id = ++storageJob;
    const startingJob = job;
    set({ storageBusy: true, storageError: null, storageNotice: null });
    try {
      const snapshot = await readLocalSession();
      if (id !== storageJob) return;
      if (startingJob !== job) {
        set({ storageNotice: "Restore skipped because your current audio changed." });
      } else if (snapshot) {
        restoreSnapshot(snapshot);
      } else {
        set({ savedAt: null, storageNotice: "No saved session in this browser." });
      }
    } catch (error) {
      if (id === storageJob) set({ storageError: storageMessage(error) });
    } finally {
      if (id === storageJob) set({ storageBusy: false });
    }
  },

  deleteLocal: async () => {
    if (get().storageBusy) return;
    const id = ++storageJob;
    set({ storageBusy: true, storageError: null, storageNotice: null });
    try {
      await removeLocalSession();
      if (id === storageJob) set({ savedAt: null, storageNotice: "Saved session deleted. Your current audio is still open." });
    } catch (error) {
      if (id === storageJob) set({ storageError: storageMessage(error) });
    } finally {
      if (id === storageJob) set({ storageBusy: false });
    }
  },

  loadDemo: () => {
    clearParameterHistory();
    const id = ++job;
    terminateOfflineWorker("Processing was replaced by a new program.");
    set({ busy: "Measuring the house program", error: null });
    setTimeout(() => {
      if (id !== job) return;
      try {
        const demo = makeDemo();
        const program = toClip(demo.program.l, demo.program.r, demo.program.sampleRate);
        const reference = toClip(demo.reference.l, demo.reference.r, demo.reference.sampleRate);
        const { params } = get();
        set({
          program,
          reference,
          programName: "House program",
          referenceName: "Cleaner print",
          analysis: null,
          refAnalysis: null,
          findings: [],
          rendered: null,
          report: null,
          busy: "Measuring. Original can play.",
        });
        master(id, program, params, true);
      } catch (error) {
        set({ busy: null, error: error instanceof Error ? error.message : "Could not build the program" });
      }
    }, 30);
  },

  loadCalibration: () => {
    clearParameterHistory();
    const id = ++job;
    terminateOfflineWorker("Processing was replaced by a calibration tone.");
    set({ busy: "Measuring the alignment tone", error: null });
    setTimeout(() => {
      if (id !== job) return;
      try {
        const made = calibrationTone();
        const clip = toClip(made.l, made.r, made.sampleRate);
        const { params } = get();
        set({
          program: clip,
          reference: null,
          programName: "1 kHz, −23 dBFS",
          referenceName: "",
          analysis: null,
          refAnalysis: null,
          findings: [],
          rendered: null,
          report: null,
          busy: "Measuring. Original can play.",
        });
        master(id, clip, params, true);
      } catch (error) {
        set({ busy: null, error: error instanceof Error ? error.message : "Could not build the tone" });
      }
    }, 30);
  },

  loadProgram: (name, audio) => {
    clearParameterHistory();
    const id = ++job;
    terminateOfflineWorker("Processing was replaced by a new program.");
    const previousRef = get().reference;
    const sameRate = previousRef && previousRef.sampleRate === audio.sampleRate ? previousRef : null;
    const rateError =
      previousRef && !sameRate
        ? `Reference is ${previousRef.sampleRate} Hz and this file is ${audio.sampleRate} Hz, so the balance view was cleared.`
        : null;
    const { params } = get();
    set({
      busy: "Measuring. Original can play.",
      error: rateError,
      programName: name,
      program: audio,
      reference: sameRate,
      referenceName: sameRate ? get().referenceName : "",
      analysis: null,
      refAnalysis: sameRate ? get().refAnalysis : null,
      findings: [],
      rendered: null,
      report: null,
    });
    master(id, audio, params, true);
  },

  loadReference: (name, audio) => {
    const program = get().program;
    if (!program) {
      set({ busy: null, error: "Load a program before a reference." });
      return;
    }
    if (audio.sampleRate !== program.sampleRate) {
      set({
        busy: null,
        error: `Reference is ${audio.sampleRate} Hz and the program is ${program.sampleRate} Hz. Balance comparison needs the same rate.`,
      });
      return;
    }
    const id = ++job;
    terminateOfflineWorker("Processing was replaced by a new reference.");
    set({
      reference: audio,
      referenceName: name,
      refAnalysis: null,
      busy: "Measuring the reference and refreshing the master.",
      error: null,
    });
    master(id, program, get().params, true);
  },

  setParams: (params, recordHistory = true) => {
    const current = get().params;
    if (JSON.stringify(current) === JSON.stringify(params)) return;
    if (recordHistory) parameterHistory.record(current, params);
    const id = ++job;
    terminateOfflineWorker("Processing was superseded by a newer setting.");
    const program = get().program;
    set({
      params,
      undoCount: parameterHistory.undoCount,
      redoCount: parameterHistory.redoCount,
      busy: program ? "Rendering. Original can play." : null,
      rendered: program ? null : get().rendered,
      error: null,
    });
    if (!program) return;
    setTimeout(() => {
      if (id !== job) return;
      const state = get();
      if (!state.program) return;
      master(id, state.program, params, !state.analysis);
    }, 40);
  },

  undoParams: () => {
    const next = parameterHistory.undo(get().params);
    if (next) get().setParams(next, false);
  },
  redoParams: () => {
    const next = parameterHistory.redo(get().params);
    if (next) get().setParams(next, false);
  },
  patchParams: (patch) => {
    const next = applyPatch(get().params, patch);
    get().setParams(next);
  },

  setSource: (source) => set({ source }),
  setMonitor: (monitor) => set({ monitor }),
  setMatch: (matchLoudness) => set({ matchLoudness }),
  setTarget: (targetLufs) => {
    const analysis = get().analysis;
    set({
      targetLufs,
      findings: analysis ? suggest(analysis, targetLufs) : [],
    });
  },
  setModule: (moduleId) => set({ moduleId }),
}));

function restoreSnapshot(snapshot: SessionSnapshot) {
  clearParameterHistory();
  const id = ++job;
  terminateOfflineWorker("Processing was replaced by a restored session.");
  useSession.setState({
    program: snapshot.program, reference: snapshot.reference,
    programName: snapshot.programName, referenceName: snapshot.referenceName,
    params: snapshot.params, source: snapshot.source, monitor: snapshot.monitor,
    matchLoudness: snapshot.matchLoudness, targetLufs: snapshot.targetLufs,
    moduleId: snapshot.moduleId, savedAt: snapshot.savedAt,
    analysis: null, refAnalysis: null, rendered: null, report: null, findings: [],
    busy: "Restoring and measuring your saved session.", error: null,
    storageNotice: "Saved session restored from this browser. Unsaved changes are not restored.",
  });
  void master(id, snapshot.program, snapshot.params, true);
}

export function playbackGainDb(state: {
  matchLoudness: boolean;
  source: SourceChoice;
  analysis: Analysis | null;
  report: ProcessReport | null;
  refAnalysis: Analysis | null;
}): number {
  if (!state.matchLoudness || !state.analysis) return 0;
  const target = state.analysis.integratedLufs;
  if (state.source === "processed" && state.report) return matchGainDb(state.report.integratedOut, target);
  if (state.source === "reference" && state.refAnalysis) return matchGainDb(state.refAnalysis.integratedLufs, target);
  return 0;
}

export function balanceOf(state: { analysis: Analysis | null; refAnalysis: Analysis | null }) {
  if (!state.analysis || !state.refAnalysis) return [];
  return spectralDelta(state.analysis.thirds, state.refAnalysis.thirds);
}
