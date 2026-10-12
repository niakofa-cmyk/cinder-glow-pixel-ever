import { renderChain } from "./chain.ts";
import { renderClip } from "./render-clip.ts";
import type { ChainParams, Clip, ProcessReport } from "./types.ts";

export type OfflineRender = Clip & { report: ProcessReport };

/**
 * Use the lower-memory path only for modes it implements faithfully.
 * Never silently replace linear-phase, mid/side EQ, or multiband processing.
 * Allocation failures propagate to the worker's actionable error response.
 */
export function renderOffline(audio: Clip, params: ChainParams): OfflineRender {
  if (params.eqMode === "linear" || params.eqTarget !== "stereo" || params.multiband.enabled) {
    const result = renderChain(
      { l: new Float64Array(audio.l), r: new Float64Array(audio.r), sampleRate: audio.sampleRate },
      params,
    );
    return {
      l: new Float32Array(result.l),
      r: new Float32Array(result.r),
      sampleRate: result.sampleRate,
      report: result.report,
    };
  }

  const l = new Float32Array(audio.l.length);
  const r = new Float32Array(audio.r.length);
  const report = renderClip(audio.l, audio.r, audio.sampleRate, params, l, r);
  return { l, r, sampleRate: audio.sampleRate, report };
}
