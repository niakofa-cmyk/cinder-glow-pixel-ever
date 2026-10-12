import type { ChainParams } from "../types.ts";
import type { EngineSource, MeterFrame, MonitorMode } from "./engine.ts";

/** Main thread → worklet. */
export type ToWorklet =
  | { type: "load"; slot: "program" | "reference"; l: Float32Array; r: Float32Array; sampleRate: number }
  | { type: "params"; params: ChainParams }
  | { type: "source"; source: EngineSource }
  | { type: "monitor"; mode: MonitorMode }
  | { type: "match"; db: number }
  | { type: "clear-reference" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; seconds: number }
  | { type: "loop"; start: number; end: number }
  | { type: "reset-meters" };

/** Worklet → main thread. */
export type FromWorklet =
  | { type: "ready"; latencySamples: number }
  | { type: "meters"; frame: number; length: number; playing: boolean; meters: MeterFrame; scope: Float32Array }
  | { type: "ended" }
  | { type: "error"; message: string };

export const PROCESSOR_NAME = "aurora-master";
