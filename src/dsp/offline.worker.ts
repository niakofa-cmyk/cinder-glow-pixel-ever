import { analyze } from "./analyze.ts";
import { renderChain } from "./chain.ts";
import { suggest } from "./suggest.ts";
import type { Analysis, ChainParams, Finding, ProcessReport, Stereo } from "./types.ts";

type FullRequest = {
  id: number;
  op: "full";
  audio: Stereo;
  reference: Stereo | null;
  params: ChainParams;
  targetLufs: number;
};

type RenderRequest = {
  id: number;
  op: "render";
  audio: Stereo;
  params: ChainParams;
};

type AnalyzeRequest = {
  id: number;
  op: "analyze";
  audio: Stereo;
};

export type OfflineRequest = FullRequest | RenderRequest | AnalyzeRequest;

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
      const rendered = renderChain(msg.audio, msg.params);
      scope.postMessage(
        { id: msg.id, op: "render" as const, l: rendered.l, r: rendered.r, sampleRate: rendered.sampleRate, report: rendered.report },
        [rendered.l.buffer, rendered.r.buffer],
      );
      return;
    }
    const analysis = analyze(msg.audio.l, msg.audio.r, msg.audio.sampleRate);
    const refAnalysis = msg.reference ? analyze(msg.reference.l, msg.reference.r, msg.reference.sampleRate) : null;
    const findings = suggest(analysis, msg.targetLufs);
    const rendered = renderChain(msg.audio, msg.params);
    const result: FullResult = {
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
    scope.postMessage(result, [rendered.l.buffer, rendered.r.buffer]);
  } catch (error) {
    scope.postMessage({
      id: msg.id,
      op: "error" as const,
      message: error instanceof Error ? error.message : "The file could not be measured.",
    });
  }
};

type FullResult = {
  id: number;
  op: "full";
  analysis: Analysis;
  refAnalysis: Analysis | null;
  findings: Finding[];
  l: Float64Array;
  r: Float64Array;
  sampleRate: number;
  report: ProcessReport;
};
