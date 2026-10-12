import { gainReductionDb } from "../dynamics.ts";
import type { ChainParams } from "../types.ts";
import { StreamBiquad } from "./biquad-rt.ts";
import { GainRamp, dbToGain } from "./util.ts";

/** Stateful version of the established RMS VCA → optical-memory glue.
 * Parameter ramps are sample-based, independent of host block boundaries.
 * No allocation or new latency in process().
 */
export class SerialGlueStage {
  private readonly sr: number;
  private power = 0;
  private env = 0;
  private fast = 0;
  private slow = 0;
  private readonly threshold = new GainRamp(0);
  private readonly ratio = new GainRamp(1);
  private readonly makeup = new GainRamp(0);
  private readonly optical = new GainRamp(0);
  private attack = 0;
  private release = 0;
  private slowRelease = 0;
  private knee = 0;
  private readonly rmsC: number;
  private readonly optAttack: number;
  private readonly fastRelease: number;
  reductionDb = 0;
  constructor(sr: number, p: ChainParams["glue"]) {
    this.sr = sr;
    this.rmsC = 1 - Math.exp(-1 / Math.max(1, sr * 0.008));
    this.optAttack = Math.exp(-1 / Math.max(1, sr * 0.012));
    this.fastRelease = Math.exp(-1 / Math.max(1, sr * 0.07));
    this.set(p, true);
  }
  set(p: ChainParams["glue"], immediate = false): void {
    const n = Math.max(1, Math.round(this.sr * 0.025));
    const set = (r: GainRamp, v: number) => immediate ? r.snap(v) : r.setTarget(v, n);
    set(this.threshold, p.thresholdDb); set(this.ratio, p.ratio);
    set(this.makeup, p.makeupDb); set(this.optical, Math.max(0, Math.min(1, p.optical)));
    this.attack = Math.exp(-1 / Math.max(1, p.attackMs * this.sr / 1000));
    this.release = Math.exp(-1 / Math.max(1, p.releaseMs * this.sr / 1000));
    this.slowRelease = Math.exp(-1 / Math.max(1, Math.max(400, p.releaseMs) * this.sr / 1000));
    this.knee = p.kneeDb;
  }
  reset(): void { this.power = this.env = this.fast = this.slow = this.reductionDb = 0; }
  process(l: Float64Array, r: Float64Array, n: number): void {
    this.reductionDb = 0;
    for (let i = 0; i < n; i++) {
      const det = Math.max(Math.abs(l[i]!), Math.abs(r[i]!));
      this.power += this.rmsC * (det * det - this.power);
      const rms = Math.sqrt(Math.max(0, this.power));
      const c = rms > this.env ? this.attack : this.release;
      this.env = c * this.env + (1 - c) * rms;
      const threshold = this.threshold.next(), ratio = this.ratio.next();
      const gr1 = gainReductionDb(20 * Math.log10(this.env + 1e-12), threshold, ratio, this.knee);
      const g1 = dbToGain(-gr1), post = rms * g1;
      const cf = post > this.fast ? this.optAttack : this.fastRelease;
      const cs = post > this.slow ? this.optAttack : this.slowRelease;
      this.fast = cf * this.fast + (1 - cf) * post;
      this.slow = cs * this.slow + (1 - cs) * post;
      const gr2 = gainReductionDb(20 * Math.log10(Math.max(this.fast, this.slow) + 1e-12),
        threshold + 2, 1 + Math.max(0, ratio - 1) * 0.45, Math.max(this.knee, 8));
      const o = this.optical.next(), g = g1 * (1 - o) + g1 * dbToGain(-gr2) * o;
      this.reductionDb = Math.max(this.reductionDb, -20 * Math.log10(Math.max(1e-12, g)));
      const gain = g * dbToGain(this.makeup.next());
      l[i] = l[i]! * gain; r[i] = r[i]! * gain;
    }
  }
}

/** Center-detected side-band duck, not vocal isolation. Mid is preserved.
 * Frequency coefficients glide without allocating inside the audio callback.
 */
export class CenterCarveStage {
  private readonly sr: number;
  private readonly mid = new StreamBiquad();
  private readonly side = new StreamBiquad();
  private readonly filters = [this.mid, this.side];
  private readonly depth = new GainRamp(0);
  private readonly frequency = new GainRamp(2500);
  private env = 0;
  private lastFrequency = -1;
  private readonly attack: number;
  private readonly release: number;
  constructor(sr: number) {
    this.sr = sr;
    this.attack = Math.exp(-1 / Math.max(1, sr * 0.004));
    this.release = Math.exp(-1 / Math.max(1, sr * 0.085));
  }
  set(depth: number, hz: number, immediate = false): void {
    const d = Math.max(0, Math.min(1, depth)), f = Math.max(80, Math.min(this.sr * 0.45, hz));
    if (d > 0 && this.depth.settled && this.depth.value === 0) this.reset();
    const n = Math.max(1, Math.round(this.sr * 0.025));
    if (immediate) { this.depth.snap(d); this.frequency.snap(f); }
    else { this.depth.setTarget(d, n); this.frequency.setTarget(f, n); }
  }
  reset(): void { this.mid.reset(); this.side.reset(); this.env = 0; }
  private tune(f: number): void {
    if (f === this.lastFrequency) return;
    this.lastFrequency = f;
    const w = 2 * Math.PI * f / this.sr, alpha = Math.sin(w) / (2 * 1.15), a0 = 1 + alpha;
    // Constant 0 dB peak bandpass; matches designBiquad("bandpass", ..., 1.15).
    for (const filter of this.filters) {
      filter.b0 = alpha / a0; filter.b1 = 0; filter.b2 = -alpha / a0;
      filter.a1 = -2 * Math.cos(w) / a0; filter.a2 = (1 - alpha) / a0;
    }
  }
  process(l: Float64Array, r: Float64Array, n: number): void {
    if (this.depth.settled && this.depth.value === 0) return;
    for (let i = 0; i < n; i++) {
      this.tune(this.frequency.next());
      const mid = (l[i]! + r[i]!) * 0.5, side = (l[i]! - r[i]!) * 0.5;
      const det = Math.abs(this.mid.tick(mid)), band = this.side.tick(side);
      const c = det > this.env ? this.attack : this.release;
      this.env = c * this.env + (1 - c) * det;
      const sense = Math.max(0, Math.min(1, (20 * Math.log10(this.env + 1e-12) + 40) / 22));
      const out = side - this.depth.next() * sense * band;
      l[i] = mid + out; r[i] = mid - out;
    }
  }
}
