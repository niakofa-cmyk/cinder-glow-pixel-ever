import { analyze } from "./analyze.ts";
import { renderOffline } from "./render-offline.ts";
import { suggest } from "./suggest.ts";
import type { Analysis, ChainParams, Clip, Finding, ProcessReport } from "./types.ts";

type FullRequest = {
  id: number;
  op: "full";
  audio: Clip;
  reference: Clip | null;
  params: ChainParams;
  targetLufs: number;
};

type RenderRequest = {
  id: number;
  op: "render";
  audio: Clip;
  params: ChainParams;
};

type AnalyzeRequest = {
  id: number;
  op: "analyze";
  audio: Clip;
};

export type OfflineRequest = FullRequest | RenderRequest | AnalyzeRequest;
type WithoutId<T> = T extends { id: number } ? Omit<T, "id"> : never;
export type OfflineCommand = WithoutId<OfflineRequest>;

export type OfflineResponse =
  | { id: number; op: "analyze"; analysis: Analysis }
  | {
      id: number;
      op: "render";
      l: Float32Array;
      r: Float32Array;
      sampleRate: number;
      report: ProcessReport;
    }
  | {
      id: number;
      op: "full";
      analysis: Analysis;
      refAnalysis: Analysis | null;
      findings: Finding[];
      l: Float32Array;
      r: Float32Array;
      sampleRate: number;
      report: ProcessReport;
    }
  | { id: number; op: "error"; message: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<OfflineRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<OfflineRequest>) => {
  const msg = event.data;
  try {
    if (msg.op === "analyze") {
      const analysis = analyze(msg.audio.l, msg.audio.r, msg.audio.sampleRate);
      const result = { id: msg.id, op: "analyze" as const, analysis };
      scope.postMessage(result);
      return;
    }
    if (msg.op === "render") {
      const rendered = renderOffline(msg.audio, msg.params);
      scope.postMessage(
        { id: msg.id, op: "render" as const, l: rendered.l, r: rendered.r, sampleRate: rendered.sampleRate, report: rendered.report },
        [rendered.l.buffer as ArrayBuffer, rendered.r.buffer as ArrayBuffer],
      );
      return;
    }
    const analysis = analyze(msg.audio.l, msg.audio.r, msg.audio.sampleRate);
    const refAnalysis = msg.reference ? analyze(msg.reference.l, msg.reference.r, msg.reference.sampleRate) : null;
    const findings = suggest(analysis, msg.targetLufs);
    const rendered = renderOffline(msg.audio, msg.params);
    const result: OfflineResponse = {
      id: msg.id,
      op: "full",
      analysis,
      refAnalysis,
      findings,
      l: rendered.l,
      r: rendered.r,
      sampleRate: rendered.sampleRate,
      report: rendered.report,
    };
    scope.postMessage(result, [rendered.l.buffer as ArrayBuffer, rendered.r.buffer as ArrayBuffer]);
  } catch (error) {
    scope.postMessage({
      id: msg.id,
      op: "error" as const,
      message: error instanceof Error ? error.message : "The file could not be measured.",
    });
  }
};
