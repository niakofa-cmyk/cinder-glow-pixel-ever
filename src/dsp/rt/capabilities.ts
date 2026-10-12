import type { ChainParams } from "../types.ts";

/** Features that must never be silently discarded by the preview engine. */
export function realtimeLimitations(params: ChainParams): string[] {
  return [
    params.bands.length > 16 ? "more than 16 EQ bands" : "",
  ].filter(Boolean);
}
