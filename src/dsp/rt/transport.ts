/**
 * Sample-accurate transport for the worklet. Owns the program and reference
 * buffers, the play position and the loop region. Pure and allocation-free in
 * `pull`, so it runs the same in a worklet and in a Node test.
 */
export type Slot = "program" | "reference";

export type Pulled = {
  /** Frames written from the program (including the zero-fill used to flush the engine tail). */
  fed: number;
  /** True on the block that finishes the flush. */
  ended: boolean;
};

export class Transport {
  readonly sampleRate: number;
  private prog: { l: Float32Array; r: Float32Array } | null = null;
  private ref: { l: Float32Array; r: Float32Array } | null = null;
  private pos = 0;
  private isPlaying = false;
  private loopStart = -1;
  private loopEnd = -1;
  private latency = 0;
  private flushLeft = -1;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  load(slot: Slot, l: Float32Array, r: Float32Array): void {
    if (slot === "program") {
      this.prog = { l, r };
      this.pos = 0;
      this.flushLeft = -1;
      this.loopStart = this.loopEnd = -1;
    } else {
      this.ref = { l, r };
    }
  }

  setLatency(frames: number): void {
    this.latency = Math.max(0, frames | 0);
  }

  get length(): number {
    return this.prog?.l.length ?? 0;
  }

  get position(): number {
    return this.pos;
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  get hasReference(): boolean {
    return this.ref !== null;
  }

  play(): void {
    if (!this.prog) return;
    if (this.flushLeft === 0 || this.pos >= this.length) {
      this.pos = this.loopStart >= 0 ? this.loopStart : 0;
    }
    this.flushLeft = -1;
    this.isPlaying = true;
  }

  pause(): void {
    this.isPlaying = false;
  }

  /** Seconds in, clamped to the file. */
  seek(seconds: number): void {
    const frame = Math.max(0, Math.min(this.length, Math.round(seconds * this.sampleRate)));
    this.pos = frame;
    this.flushLeft = -1;
  }

  /** Loop region in frames, or clears it with (-1, -1). */
  setLoop(startFrame: number, endFrame: number): void {
    if (startFrame < 0 || endFrame <= startFrame) {
      this.loopStart = this.loopEnd = -1;
      return;
    }
    this.loopStart = Math.max(0, startFrame);
    this.loopEnd = Math.min(this.length, endFrame);
  }

  /**
   * Fill n frames of program (and reference, if loaded). Past the end the
   * program is zero-filled for `latency` frames so the engine can flush, then
   * playback stops.
   */
  pull(n: number, l: Float64Array, r: Float64Array, refL: Float64Array | null, refR: Float64Array | null): Pulled {
    const p = this.prog;
    if (!p || !this.isPlaying) {
      l.fill(0, 0, n);
      r.fill(0, 0, n);
      refL?.fill(0, 0, n);
      refR?.fill(0, 0, n);
      return { fed: 0, ended: false };
    }
    const len = p.l.length;
    let fed = 0;
    let ended = false;
    for (let i = 0; i < n; i++) {
      if (this.loopStart >= 0 && this.pos >= this.loopEnd) this.pos = this.loopStart;
      if (this.pos < len) {
        l[i] = p.l[this.pos] as number;
        r[i] = p.r[this.pos] as number;
        if (refL && refR) {
          const q = this.ref;
          const inRef = q !== null && this.pos < q.l.length;
          refL[i] = inRef && q ? (q.l[this.pos] as number) : 0;
          refR[i] = inRef && q ? (q.r[this.pos] as number) : 0;
        }
        this.pos++;
        fed++;
      } else {
        if (this.flushLeft < 0) this.flushLeft = this.latency;
        l[i] = 0;
        r[i] = 0;
        if (refL && refR) {
          refL[i] = 0;
          refR[i] = 0;
        }
        if (this.flushLeft > 0) {
          this.flushLeft--;
          fed++;
        }
        if (this.flushLeft === 0 && !ended) {
          ended = true;
          this.isPlaying = false;
        }
      }
    }
    return { fed, ended };
  }
}
