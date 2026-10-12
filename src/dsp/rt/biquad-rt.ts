import { flush } from "./util.ts";
import type { BiquadCoeffs } from "../types.ts";

/** Transposed direct form II with persistent state. Matches the offline filter sample for sample. */
export class StreamBiquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  private s1 = 0;
  private s2 = 0;

  set(c: BiquadCoeffs): void {
    this.b0 = c.b0;
    this.b1 = c.b1;
    this.b2 = c.b2;
    this.a1 = c.a1;
    this.a2 = c.a2;
  }

  reset(): void {
    this.s1 = 0;
    this.s2 = 0;
  }

  tick(x: number): number {
    const y = this.b0 * x + this.s1;
    this.s1 = this.b1 * x - this.a1 * y + this.s2;
    this.s2 = this.b2 * x - this.a2 * y;
    return y;
  }

  /** In place over the first n samples. Flushes denormals once per block. */
  block(x: Float64Array, n: number): void {
    let s1 = this.s1;
    let s2 = this.s2;
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = 0; i < n; i++) {
      const x0 = x[i] as number;
      const y0 = b0 * x0 + s1;
      s1 = b1 * x0 - a1 * y0 + s2;
      s2 = b2 * x0 - a2 * y0;
      x[i] = y0;
    }
    this.s1 = flush(s1);
    this.s2 = flush(s2);
  }

  get finite(): boolean {
    return Number.isFinite(this.s1) && Number.isFinite(this.s2);
  }
}
