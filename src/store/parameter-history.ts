import type { ChainParams } from "../dsp/types.ts";

const copy = (params: ChainParams): ChainParams => JSON.parse(JSON.stringify(params)) as ChainParams;

/** Bounded processing-only history. Audio buffers are never retained here. */
export class ParameterHistory {
  private past: ChainParams[] = [];
  private future: ChainParams[] = [];
  private readonly limit: number;
  constructor(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("History limit must be positive.");
    this.limit = limit;
  }
  get undoCount() { return this.past.length; }
  get redoCount() { return this.future.length; }
  record(current: ChainParams, next: ChainParams): boolean {
    if (JSON.stringify(current) === JSON.stringify(next)) return false;
    this.past.push(copy(current));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    return true;
  }
  undo(current: ChainParams): ChainParams | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(copy(current));
    return copy(previous);
  }
  redo(current: ChainParams): ChainParams | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(copy(current));
    return copy(next);
  }
  clear() { this.past = []; this.future = []; }
}
