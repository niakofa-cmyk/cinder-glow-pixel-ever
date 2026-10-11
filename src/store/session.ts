import { analyze, spectralDelta } from "@/dsp/analyze";
import { matchGainDb } from "@/dsp/chain";
import { calibrationTone, makeDemo } from "@/dsp/demo";
import { neutralParams } from "@/dsp/presets";
import { renderClip } from "@/dsp/render-clip";
import { applyPatch, suggest } from "@/dsp/suggest";
import type { Analysis, ChainParams, Clip, Finding, ProcessReport } from "@/dsp/types";
import { create } from "zustand";

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
  loadDemo: () => void;
  loadCalibration: () => void;
  loadProgram: (name: string, audio: Clip) => void;
  loadReference: (name: string, audio: Clip) => void;
  setParams: (params: ChainParams) => void;
  patchParams: (patch: Partial<ChainParams>) => void;
  setSource: (source: SourceChoice) => void;
  setMonitor: (monitor: MonitorChoice) => void;
  setMatch: (on: boolean) => void;
  setTarget: (lufs: number) => void;
  setModule: (id: string) => void;
};

let job = 0;

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

/** Analyze, then master, without cloning the song into a worker. */
function master(id: number, clip: Clip, params: ChainParams, alsoAnalyze: boolean) {
  setTimeout(() => {
    if (id !== job) return;
    try {
      if (alsoAnalyze) {
        const ref = useSession.getState().reference;
        const analysis = analyze(clip.l, clip.r, clip.sampleRate);
        const refAnalysis = ref && ref.sampleRate === clip.sampleRate ? analyze(ref.l, ref.r, ref.sampleRate) : null;
        if (id !== job) return;
        useSession.setState({
          analysis,
          refAnalysis,
          findings: suggest(analysis, useSession.getState().targetLufs),
          busy: "Rendering. Original can play.",
        });
      }
    } catch (error) {
      if (id !== job) return;
      useSession.setState({ busy: null, error: memoryMessage(error) });
      return;
    }
    setTimeout(() => {
      if (id !== job) return;
      try {
        const outL = new Float32Array(clip.l.length);
        const outR = new Float32Array(clip.r.length);
        const report = renderClip(clip.l, clip.r, clip.sampleRate, params, outL, outR);
        if (id !== job) return;
        useSession.setState({
          rendered: { l: outL, r: outR, sampleRate: clip.sampleRate },
          report,
          busy: null,
          error: null,
        });
      } catch (error) {
        if (id !== job) return;
        useSession.setState({ busy: null, error: memoryMessage(error) });
      }
    }, 0);
  }, 0);
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
  busy: null,
  error: null,
  source: "processed",
  monitor: "full",
  matchLoudness: true,
  targetLufs: -14,
  moduleId: "eq",

  loadDemo: () => {
    const id = ++job;
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
    const id = ++job;
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
    const id = ++job;
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
      set({ error: "Load a program before a reference." });
      return;
    }
    if (audio.sampleRate !== program.sampleRate) {
      set({
        error: `Reference is ${audio.sampleRate} Hz and the program is ${program.sampleRate} Hz. Balance comparison needs the same rate.`,
      });
      return;
    }
    const id = ++job;
    set({
      reference: audio,
      referenceName: name,
      refAnalysis: null,
      busy: "Measuring the reference. It can play.",
      error: null,
    });
    setTimeout(() => {
      if (id !== job) return;
      try {
        const refAnalysis = analyze(audio.l, audio.r, audio.sampleRate);
        if (id !== job) return;
        set({ refAnalysis, busy: null });
      } catch (error) {
        set({ busy: null, error: memoryMessage(error) });
      }
    }, 0);
  },

  setParams: (params) => {
    set({ params });
    const id = ++job;
    const program = get().program;
    if (!program) return;
    set({ params, busy: "Rendering. Original can play.", rendered: null });
    setTimeout(() => {
      if (id !== job) return;
      const state = get();
      if (!state.program) return;
      master(id, state.program, params, !state.analysis);
    }, 40);
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
