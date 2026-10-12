/**
 * Real-time building blocks. Everything here is allocation-free once
 * constructed: process() never calls `new`, spreads, or builds closures.
 */

const DENORMAL = 1e-30;

/** Kills subnormals that would make recursive filters spike in CPU. */
export function flush(x: number): number {
  return x > -DENORMAL && x < DENORMAL ? 0 : x;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(g: number): number {
  return 20 * Math.log10(Math.max(1e-12, Math.abs(g)));
}

/** One-pole coefficient for a time constant in ms. */
export function pole(ms: number, sampleRate: number): number {
  return Math.exp(-1 / Math.max(1, (ms / 1000) * sampleRate));
}

/**
 * Block-rate parameter smoother. Call `step()` once per render block; the
 * returned value approaches the target with the given time constant. Used for
 * values that feed filter design, where per-sample redesign would be wasteful.
 */
export class BlockSmoother {
  value: number;
  target: number;
  private readonly coef: number;
  constructor(initial: number, timeMs: number, blockSeconds: number) {
    this.value = initial;
    this.target = initial;
    this.coef = Math.exp(-blockSeconds / Math.max(1e-4, timeMs / 1000));
  }
  /** Returns true while the value is still moving. */
  step(): boolean {
    const d = this.target - this.value;
    if (Math.abs(d) < 1e-9 * Math.max(1, Math.abs(this.target))) {
      this.value = this.target;
      return false;
    }
    this.value = this.target - d * this.coef;
    return true;
  }
  snap(v: number): void {
    this.value = v;
    this.target = v;
  }
}

/** Per-sample linear ramp between two gain values over a fixed length. */
export class GainRamp {
  value: number;
  private target: number;
  private step = 0;
  private left = 0;
  constructor(initial: number) {
    this.value = initial;
    this.target = initial;
  }
  setTarget(target: number, samples: number): void {
    if (target === this.target && this.left === 0) return;
    this.target = target;
    if (samples <= 1) {
      this.value = target;
      this.left = 0;
      this.step = 0;
      return;
    }
    this.left = samples;
    this.step = (target - this.value) / samples;
  }
  snap(v: number): void {
    this.value = v;
    this.target = v;
    this.left = 0;
    this.step = 0;
  }
  get settled(): boolean {
    return this.left === 0;
  }
  get goal(): number {
    return this.target;
  }
  next(): number {
    if (this.left > 0) {
      this.left--;
      this.value = this.left === 0 ? this.target : this.value + this.step;
    }
    return this.value;
  }
}

/** Integer delay for one channel. Delay 0 is a true pass-through. */
export class DelayLine {
  private buf: Float64Array;
  private pos = 0;
  private len: number;
  constructor(maxSamples: number) {
    this.len = Math.max(1, maxSamples + 1);
    this.buf = new Float64Array(this.len);
  }
  /** Writes x, returns the sample written `delay` samples ago. */
  tick(x: number, delay: number): number {
    this.buf[this.pos] = x;
    let r = this.pos - delay;
    if (r < 0) r += this.len;
    this.pos = this.pos + 1 === this.len ? 0 : this.pos + 1;
    return this.buf[r] ?? 0;
  }
  reset(): void {
    this.buf.fill(0);
    this.pos = 0;
  }
}

export type Block = { l: Float64Array; r: Float64Array };

export function makeBlock(n: number): Block {
  return { l: new Float64Array(n), r: new Float64Array(n) };
}
