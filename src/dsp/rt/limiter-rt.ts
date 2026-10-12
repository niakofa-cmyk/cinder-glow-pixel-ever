import { interpKernels } from "../truepeak.ts";
import { DelayLine, dbToGain, flush, pole } from "./util.ts";

const WIN = 32; // taps of the 4× interpolator
const DETECT_DELAY = 15; // the interpolator needs 15 samples of "future"
const MAX_LOOKAHEAD_MS = 10;

/** Sliding window of the last 32 samples, laid out contiguously oldest to newest. */
class Window32 {
  private readonly buf = new Float64Array(WIN * 2);
  private w = 0;
  push(x: number): void {
    this.buf[this.w] = x;
    this.buf[this.w + WIN] = x;
    this.w = this.w + 1 === WIN ? 0 : this.w + 1;
  }
  /** Offset of the oldest sample in `buf`. */
  get start(): number {
    return this.w;
  }
  get data(): Float64Array {
    return this.buf;
  }
  reset(): void {
    this.buf.fill(0);
    this.w = 0;
  }
}

/**
 * Peak of the continuous waveform around the sample 15 steps back, measured
 * with the same 4× kernel as the offline true-peak meter. Phase 0 is the
 * sample itself; phases 1 to 3 sit between it and the next sample.
 */
export function windowTruePeak(win: Window32, phases: Float64Array[]): number {
  const d = win.data;
  const s = win.start;
  const a = Math.abs(d[s + 16] as number);
  const b = Math.abs(d[s + 17] as number);
  let peak = a > b ? a : b;
  for (let p = 1; p < 4; p++) {
    const k = phases[p] as Float64Array;
    let acc = 0;
    for (let i = 0; i < WIN; i++) acc += (d[s + i] as number) * (k[i] as number);
    const v = acc < 0 ? -acc : acc;
    if (v > peak) peak = v;
  }
  return peak;
}

export { Window32 };

/**
 * Streaming true-peak lookahead limiter.
 *
 * Gain for each sample is the smallest gain any peak in its lookahead window
 * demands (running minimum), smoothed by a boxcar of the same length. That
 * ordering is what guarantees the gain has already fallen when the peak
 * arrives, with no overshoot and no step. A one-pole release then lets the
 * gain recover slowly. Latency is fixed at construction for the longest
 * lookahead; shorter settings delay the gain, not the audio, so changing the
 * lookahead never shifts the timeline.
 */
export class StreamLimiter {
  readonly latency: number;
  private readonly maxL: number;
  private L: number;
  private readonly phases: Float64Array[];
  private readonly win = [new Window32(), new Window32()];
  private readonly audio: DelayLine[];
  private readonly audioDelay: number;

  // Running minimum over the last L detector values (monotonic deque).
  private readonly dqIdx: Float64Array;
  private readonly dqVal: Float64Array;
  private head = 0;
  private tail = 0;
  private counter = 0;
  private prevD = 1;

  // Boxcar over the last L minima.
  private readonly box: Float64Array;
  private boxPos = 0;
  private boxSum = 0;
  private sinceResum = 0;

  // Release stage and gain delay (aligns gain to audio when L < maxL).
  private rs = 1;
  private rel: number;
  private readonly gainRing: Float64Array;
  private gainPos = 0;

  private ceiling: number;
  /** Largest gain reduction in the last block, positive dB. */
  reductionDb = 0;

  private readonly sampleRate: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.maxL = Math.max(2, Math.round((MAX_LOOKAHEAD_MS / 1000) * sampleRate));
    this.L = Math.round(0.005 * sampleRate);
    this.latency = DETECT_DELAY + this.maxL - 1;
    this.phases = interpKernels();
    this.audio = [new DelayLine(this.latency), new DelayLine(this.latency)];
    this.audioDelay = this.latency;
    this.dqIdx = new Float64Array(this.maxL + 2);
    this.dqVal = new Float64Array(this.maxL + 2);
    this.box = new Float64Array(this.maxL);
    this.gainRing = new Float64Array(this.maxL + 1);
    this.ceiling = dbToGain(-1);
    this.rel = pole(80, sampleRate);
    this.clearGainState();
  }

  configure(ceilingDb: number, releaseMs: number, lookaheadMs: number): void {
    this.ceiling = dbToGain(Math.min(0, ceilingDb));
    this.rel = pole(Math.max(1, releaseMs), this.sampleRate);
    const L = Math.max(2, Math.min(this.maxL, Math.round((lookaheadMs / 1000) * this.sampleRate)));
    if (L !== this.L) {
      this.L = L;
      this.clearGainState();
    }
  }

  private clearGainState(): void {
    this.head = 0;
    this.tail = 0;
    this.counter = 0;
    this.prevD = 1;
    this.box.fill(1);
    this.boxPos = 0;
    this.boxSum = this.L;
    this.sinceResum = 0;
    this.rs = 1;
    this.gainRing.fill(1);
    this.gainPos = 0;
  }

  reset(): void {
    for (const w of this.win) w.reset();
    for (const a of this.audio) a.reset();
    this.clearGainState();
    this.reductionDb = 0;
  }

  /**
   * In place. `wet[i]` is 0..1 per sample (1 = limiting fully applied). The
   * audio is delayed by `latency` whether or not it is limited.
   */
  process(l: Float64Array, r: Float64Array, n: number, wet: Float64Array): void {
    const cap = this.dqIdx.length;
    const L = this.L;
    const extra = this.maxL - L;
    const gcap = this.gainRing.length;
    let maxGr = 0;
    const wl = this.win[0] as Window32;
    const wr = this.win[1] as Window32;
    const a0 = this.audio[0] as DelayLine;
    const a1 = this.audio[1] as DelayLine;
    for (let i = 0; i < n; i++) {
      const xl = l[i] as number;
      const xr = r[i] as number;
      wl.push(xl);
      wr.push(xr);
      const peak = Math.max(windowTruePeak(wl, this.phases), windowTruePeak(wr, this.phases));
      const d = peak > this.ceiling ? this.ceiling / peak : 1;
      // A sample must satisfy both intervals it borders.
      const dd = d < this.prevD ? d : this.prevD;
      this.prevD = d;

      // Monotonic deque: minimum of the last L values of dd.
      while (this.tail > this.head && (this.dqVal[(this.tail - 1) % cap] as number) >= dd) this.tail--;
      this.dqIdx[this.tail % cap] = this.counter;
      this.dqVal[this.tail % cap] = dd;
      this.tail++;
      while ((this.dqIdx[this.head % cap] as number) <= this.counter - L) this.head++;
      const m = this.dqVal[this.head % cap] as number;
      this.counter++;

      // Boxcar over the last L minima.
      const old = this.box[this.boxPos] as number;
      this.box[this.boxPos] = m;
      this.boxPos = this.boxPos + 1 === L ? 0 : this.boxPos + 1;
      this.boxSum += m - old;
      if (++this.sinceResum >= 4096) {
        let s = 0;
        for (let k = 0; k < L; k++) s += this.box[k] as number;
        this.boxSum = s;
        this.sinceResum = 0;
      }
      const g = Math.min(1, this.boxSum / L);

      // Release: gain may fall to g at once, rises only at the release rate.
      const up = this.rel * this.rs + (1 - this.rel);
      this.rs = flush(g < up ? g : up);

      // Delay the gain so it lines up with the delayed audio.
      this.gainRing[this.gainPos] = this.rs;
      let rd = this.gainPos - extra;
      if (rd < 0) rd += gcap;
      this.gainPos = this.gainPos + 1 === gcap ? 0 : this.gainPos + 1;
      const gain = this.gainRing[rd] as number;

      const w = wet[i] as number;
      const applied = 1 + w * (gain - 1);
      const gr = -20 * Math.log10(Math.max(1e-6, applied));
      if (gr > maxGr) maxGr = gr;
      l[i] = a0.tick(xl, this.audioDelay) * applied;
      r[i] = a1.tick(xr, this.audioDelay) * applied;
    }
    this.reductionDb = maxGr;
  }
}
