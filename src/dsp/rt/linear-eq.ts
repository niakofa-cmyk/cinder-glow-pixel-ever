import { designBiquad } from "../biquad.ts";
import { fft } from "../fft.ts";
import { MAX_BANDS, type BandSnap, type EqStage } from "./stages.ts";
import { DelayLine } from "./util.ts";

/** FIR length. Longer resolves lower frequencies and adds latency (TAPS/2). */
export const LIN_TAPS = 4096;
/** Hop (partition) size, in samples. */
export const LIN_P = 128;
const K = LIN_TAPS / LIN_P;
const F = LIN_P * 2;
const H = LIN_P + 1; // bins kept (Hermitian half)

/** Group delay of the FIR plus one hop of buffering. */
export const LINEAR_EQ_LATENCY = LIN_TAPS / 2 + LIN_P;

type Spectra = { re: Float64Array[]; im: Float64Array[] };

function makeSpectra(): Spectra {
  const re: Float64Array[] = [];
  const im: Float64Array[] = [];
  for (let j = 0; j < K; j++) {
    re.push(new Float64Array(H));
    im.push(new Float64Array(H));
  }
  return { re, im };
}

/**
 * Designs the zero-phase FIR whose magnitude is the product of the active
 * bands, using the same definition as the offline linear mode: each band is
 * a half-gain biquad run forward and backward, so its squared magnitude is
 * what the curve on screen shows.
 */
class FirDesigner {
  private readonly bins = LIN_TAPS / 2 + 1;
  private readonly c1 = new Float64Array(this.bins);
  private readonly s1 = new Float64Array(this.bins);
  private readonly c2 = new Float64Array(this.bins);
  private readonly s2 = new Float64Array(this.bins);
  private readonly amp = new Float64Array(this.bins);
  private readonly re = new Float64Array(LIN_TAPS);
  private readonly im = new Float64Array(LIN_TAPS);
  private readonly win = new Float64Array(LIN_TAPS);
  private readonly pr = new Float64Array(F);
  private readonly pi = new Float64Array(F);
  private readonly sampleRate: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    for (let k = 0; k < this.bins; k++) {
      const w = (2 * Math.PI * k) / LIN_TAPS;
      this.c1[k] = Math.cos(w);
      this.s1[k] = Math.sin(w);
      this.c2[k] = Math.cos(2 * w);
      this.s2[k] = Math.sin(2 * w);
    }
    for (let n = 0; n < LIN_TAPS; n++) this.win[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / LIN_TAPS));
  }

  design(bands: BandSnap[], count: number, out: Spectra): void {
    const bins = this.bins;
    const { amp, c1, s1, c2, s2 } = this;
    amp.fill(1);
    for (let b = 0; b < count; b++) {
      const band = bands[b] as BandSnap;
      const c = designBiquad(band.type, band.freq, band.q, band.gainDb * 0.5, this.sampleRate);
      for (let k = 0; k < bins; k++) {
        const br = c.b0 + c.b1 * (c1[k] as number) + c.b2 * (c2[k] as number);
        const bi = -(c.b1 * (s1[k] as number) + c.b2 * (s2[k] as number));
        const ar = 1 + c.a1 * (c1[k] as number) + c.a2 * (c2[k] as number);
        const ai = -(c.a1 * (s1[k] as number) + c.a2 * (s2[k] as number));
        // |H|² of the half-gain section is the realised magnitude of forward-backward filtering.
        amp[k] = (amp[k] as number) * ((br * br + bi * bi) / (ar * ar + ai * ai));
      }
    }
    const { re, im } = this;
    im.fill(0);
    for (let k = 0; k < bins; k++) {
      re[k] = amp[k] as number;
      if (k > 0 && k < bins - 1) re[LIN_TAPS - k] = amp[k] as number;
    }
    fft(re, im, true); // zero-phase impulse response, centred on index 0
    const h = this.re;
    const half = LIN_TAPS / 2;
    // Rotate so the centre sits at TAPS/2, then window to tame truncation ripple.
    const tmp = this.im;
    for (let n = 0; n < LIN_TAPS; n++) tmp[n] = (h[(n - half + LIN_TAPS) % LIN_TAPS] as number) * (this.win[n] as number);
    for (let j = 0; j < K; j++) {
      this.pr.fill(0);
      this.pi.fill(0);
      for (let i = 0; i < LIN_P; i++) this.pr[i] = tmp[j * LIN_P + i] as number;
      fft(this.pr, this.pi, false);
      const or = out.re[j] as Float64Array;
      const oi = out.im[j] as Float64Array;
      for (let k = 0; k < H; k++) {
        or[k] = this.pr[k] as number;
        oi[k] = this.pi[k] as number;
      }
    }
  }
}

/** Uniformly partitioned overlap-save convolver for one channel. */
class Convolver {
  private readonly fr: Float64Array[] = [];
  private readonly fi: Float64Array[] = [];
  private head = 0;
  private readonly prev = new Float64Array(LIN_P);
  private readonly inHop = new Float64Array(LIN_P);
  readonly outHop = new Float64Array(LIN_P);
  private readonly alt = new Float64Array(LIN_P);
  private pos = 0;
  private readonly re = new Float64Array(F);
  private readonly im = new Float64Array(F);

  constructor() {
    for (let j = 0; j < K; j++) {
      this.fr.push(new Float64Array(H));
      this.fi.push(new Float64Array(H));
    }
  }

  reset(): void {
    for (let j = 0; j < K; j++) {
      (this.fr[j] as Float64Array).fill(0);
      (this.fi[j] as Float64Array).fill(0);
    }
    this.prev.fill(0);
    this.inHop.fill(0);
    this.outHop.fill(0);
    this.head = 0;
    this.pos = 0;
  }

  /** Sum of H_j · X_(n-j) into re/im, mirrored to a full spectrum, then back to time. */
  private filter(spec: Spectra, dst: Float64Array): void {
    const { re, im } = this;
    re.fill(0, 0, H);
    im.fill(0, 0, H);
    for (let j = 0; j < K; j++) {
      const idx = (this.head - j + K) % K;
      const xr = this.fr[idx] as Float64Array;
      const xi = this.fi[idx] as Float64Array;
      const hr = spec.re[j] as Float64Array;
      const hi = spec.im[j] as Float64Array;
      for (let k = 0; k < H; k++) {
        const a = xr[k] as number;
        const b = xi[k] as number;
        const c = hr[k] as number;
        const d = hi[k] as number;
        re[k] = (re[k] as number) + a * c - b * d;
        im[k] = (im[k] as number) + a * d + b * c;
      }
    }
    for (let k = 1; k < LIN_P; k++) {
      re[F - k] = re[k] as number;
      im[F - k] = -(im[k] as number);
    }
    fft(re, im, true);
    for (let i = 0; i < LIN_P; i++) dst[i] = re[LIN_P + i] as number;
  }

  /**
   * One hop. Always updates the input history so a later switch to this path
   * is seamless; only does the multiply-accumulate when `want` is set.
   */
  private hop(want: boolean, cur: Spectra, old: Spectra | null): void {
    const { re, im } = this;
    for (let i = 0; i < LIN_P; i++) {
      re[i] = this.prev[i] as number;
      re[LIN_P + i] = this.inHop[i] as number;
      this.prev[i] = this.inHop[i] as number;
    }
    im.fill(0);
    fft(re, im, false);
    this.head = (this.head + 1) % K;
    const sr = this.fr[this.head] as Float64Array;
    const si = this.fi[this.head] as Float64Array;
    for (let k = 0; k < H; k++) {
      sr[k] = re[k] as number;
      si[k] = im[k] as number;
    }
    if (!want) {
      this.outHop.fill(0);
      return;
    }
    this.filter(cur, this.outHop);
    if (old) {
      this.filter(old, this.alt);
      for (let i = 0; i < LIN_P; i++) {
        const t = (i + 1) / LIN_P;
        this.outHop[i] = (this.alt[i] as number) * (1 - t) + (this.outHop[i] as number) * t;
      }
    }
  }

  /** One sample in, one sample out, delayed by one hop. The hop work is done when the buffer fills. */
  tick(x: number, want: boolean, cur: Spectra, old: Spectra | null): number {
    const y = this.outHop[this.pos] as number;
    this.inHop[this.pos] = x;
    if (++this.pos === LIN_P) {
      this.pos = 0;
      this.hop(want, cur, old);
    }
    return y;
  }
}

/**
 * True linear-phase EQ: a 4096-tap zero-phase FIR run by partitioned FFT
 * convolution. Constant delay of LINEAR_EQ_LATENCY samples, no phase shift,
 * so it matches the offline linear mode. Curve changes are crossfaded over
 * one hop.
 */
export class LinearEqStage {
  private readonly designer: FirDesigner;
  private cur: Spectra = makeSpectra();
  private next: Spectra = makeSpectra();
  private old: Spectra = makeSpectra();
  private fading = false;
  private pending = false;
  private pendingSnap = false;
  private stale = true;
  private lastVersion = -1;
  private lastTarget: "stereo" | "mid" | "side" = "stereo";
  private readonly snap: BandSnap[] = [];
  private snapCount = 0;
  private readonly a = new Convolver();
  private readonly b = new Convolver();
  private readonly skip = [new DelayLine(LINEAR_EQ_LATENCY), new DelayLine(LINEAR_EQ_LATENCY)];
  private hopPos = 0;

  constructor(sampleRate: number) {
    this.designer = new FirDesigner(sampleRate);
    for (let i = 0; i < MAX_BANDS; i++) this.snap.push({ type: "peaking", freq: 1000, gainDb: 0, q: 1 });
    this.designer.design(this.snap, 0, this.cur); // flat: a pure delay
  }

  reset(): void {
    this.a.reset();
    this.b.reset();
    for (const d of this.skip) d.reset();
    this.hopPos = 0;
    this.fading = false;
  }

  /** Redesign when the min-phase stage says its curve moved, but only if the output is being used. */
  update(eq: EqStage, want: boolean): void {
    if (eq.targetChannel !== this.lastTarget) {
      this.lastTarget = eq.targetChannel;
      this.reset();
    }
    if (eq.version !== this.lastVersion) {
      this.lastVersion = eq.version;
      this.stale = true;
    }
    if (want && this.stale) {
      const wasHidden = !this.wasWanted;
      this.snapCount = eq.snapshot(this.snap);
      this.designer.design(this.snap, this.snapCount, this.next);
      this.pending = true;
      this.pendingSnap = wasHidden;
      this.stale = false;
    }
    this.wasWanted = want;
  }
  private wasWanted = false;

  process(inL: Float64Array, inR: Float64Array, outL: Float64Array, outR: Float64Array, n: number, want: boolean, target: "stereo" | "mid" | "side"): void {
    for (let i = 0; i < n; i++) {
      if (this.hopPos === 0 && this.pending) {
        // Swap in the new filter at a hop boundary.
        const t = this.old;
        if (this.pendingSnap) {
          this.old = this.cur;
          this.cur = this.next;
          this.fading = false;
        } else {
          this.old = this.cur;
          this.cur = this.next;
          this.fading = true;
        }
        this.next = t;
        this.pending = false;
      }
      const old = this.fading ? this.old : null;
      let l = inL[i] as number;
      let r = inR[i] as number;
      if (target === "stereo") {
        outL[i] = this.a.tick(l, want, this.cur, old);
        outR[i] = this.b.tick(r, want, this.cur, old);
      } else {
        const m = (l + r) * 0.5;
        const s = (l - r) * 0.5;
        let mo: number;
        let so: number;
        if (target === "mid") {
          mo = this.a.tick(m, want, this.cur, old);
          so = (this.skip[1] as DelayLine).tick(s, LINEAR_EQ_LATENCY);
        } else {
          mo = (this.skip[0] as DelayLine).tick(m, LINEAR_EQ_LATENCY);
          so = this.b.tick(s, want, this.cur, old);
        }
        l = mo + so;
        r = mo - so;
        outL[i] = l;
        outR[i] = r;
      }
      this.hopPos = this.hopPos + 1 === LIN_P ? 0 : this.hopPos + 1;
      if (this.hopPos === 0) this.fading = false;
    }
  }
}
