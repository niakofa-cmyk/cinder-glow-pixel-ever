import type { ChainParams } from "../dsp/types.ts";

const copy = (params: ChainParams): ChainParams => JSON.parse(JSON.stringify(params)) as ChainParams;

/** Bounded processing-only history. Audio buffers are never retained here. */
export class ParameterHistory {
  private past: ChainParams[] = [];
  private future: ChainParams[] = [];
  private gesture: { token: number; start: ChainParams; latest: ChainParams } | null = null;
  private token = 0;
  private readonly limit: number;
  constructor(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("History limit must be positive.");
    this.limit = limit;
  }
  private get gestureChanged() {
    return !!this.gesture && JSON.stringify(this.gesture.start) !== JSON.stringify(this.gesture.latest);
  }
  get undoCount() { return this.past.length + (this.gestureChanged ? 1 : 0); }
  get redoCount() { return this.gestureChanged ? 0 : this.future.length; }
  beginGesture(current: ChainParams): number {
    this.endGesture(current);
    const token = ++this.token;
    this.gesture = { token, start: copy(current), latest: copy(current) };
    return token;
  }
  endGesture(current: ChainParams, token?: number): boolean {
    if (!this.gesture || (token !== undefined && token !== this.gesture.token)) return false;
    const start = this.gesture.start;
    this.gesture = null;
    return this.record(start, current);
  }
  record(current: ChainParams, next: ChainParams): boolean {
    if (JSON.stringify(current) === JSON.stringify(next)) return false;
    if (this.gesture) {
      this.gesture.latest = copy(next);
      return true;
    }
    this.past.push(copy(current));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    return true;
  }
  undo(current: ChainParams): ChainParams | null {
    this.endGesture(current);
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(copy(current));
    return copy(previous);
  }
  redo(current: ChainParams): ChainParams | null {
    this.endGesture(current);
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(copy(current));
    return copy(next);
  }
  clear() { this.past = []; this.future = []; this.gesture = null; }
}
