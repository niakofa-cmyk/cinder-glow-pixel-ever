import { gainToDb } from "./biquad.ts";

/**
 * 4× windowed-sinc interpolation. Phase 0 is an integer delay (identity),
 * so sample-peak and true-peak agree on signals that already peak on a sample.
 * Radius 16 → 32 taps. Accurate enough for inter-sample peaks within ~0.2 dB.
 */
const RADIUS = 16;
const PHASES = 4;

function sincWindow(x: number): number {
  if (Math.abs(x) < 1e-9) return 1;
  if (Math.abs(x) >= RADIUS) return 0;
  const sinc = Math.sin(Math.PI * x) / (Math.PI * x);
  const w = 0.42 - 0.5 * Math.cos((Math.PI * (x + RADIUS)) / RADIUS) + 0.08 * Math.cos((2 * Math.PI * (x + RADIUS)) / RADIUS);
  return sinc * w;
}

let kernels: Float64Array[] | null = null;

function interpKernels(): Float64Array[] {
  if (kernels) return kernels;
  kernels = [];
  for (let p = 0; p < PHASES; p++) {
    const d = p / PHASES;
    const k = new Float64Array(RADIUS * 2);
    for (let i = 0; i < RADIUS * 2; i++) {
      const tap = i - RADIUS; // -16..15
      k[i] = sincWindow(tap - d);
    }
    // Renormalize so a constant interpolates to itself.
    let sum = 0;
    for (let i = 0; i < k.length; i++) sum += k[i] ?? 0;
    if (Math.abs(sum) > 1e-9) {
      for (let i = 0; i < k.length; i++) k[i] = (k[i] ?? 0) / sum;
    }
    kernels.push(k);
  }
  return kernels;
}

function interpAt(x: ArrayLike<number>, index: number, phase: number): number {
  const k = interpKernels()[phase];
  if (!k) return 0;
  let acc = 0;
  for (let i = 0; i < k.length; i++) {
    // tap = i - RADIUS, we want sample (index + tap) when phase offset is inside the kernel as (tap - d).
    // y = sum_tap x[index + tap] * sinc((tap) - d) with tap from -RADIUS .. RADIUS-1
    // i = tap + RADIUS, sample index = index + (i - RADIUS)
    const sampleIndex = index + (i - RADIUS);
    if (sampleIndex >= 0 && sampleIndex < x.length) acc += (x[sampleIndex] ?? 0) * (k[i] ?? 0);
  }
  return acc;
}

export type PeakReading = { samplePeak: number; truePeak: number; samplePeakDb: number; truePeakDb: number };

/**
 * True peak via 4× oversampling. Interpolation runs only on the shoulder of
 * local peaks. A band-limited inter-sample peak cannot hide more than about
 * 3 dB above its neighboring samples, and it cannot win from a quiet valley.
 */
export function measureTruePeak(channels: ArrayLike<number>[]): PeakReading {
  let samplePeak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i] ?? 0);
      if (a > samplePeak) samplePeak = a;
    }
  }
  let truePeak = samplePeak;
  const floor = samplePeak * Math.pow(10, -3.2 / 20);
  for (const ch of channels) {
    const n = ch.length;
    for (let i = 0; i < n - 1; i++) {
      const a = Math.abs(ch[i] ?? 0);
      const b = Math.abs(ch[i + 1] ?? 0);
      const m = a > b ? a : b;
      if (m < floor || m * 1.445 < truePeak) continue;
      // The inter-sample maximum sits on the shoulder of a local peak.
      // Plateaus (equal neighbors) still get measured — that is the
      // quarter-Nyquist case, where the peak is between samples.
      if (a >= b) {
        const prev = i > 0 ? Math.abs(ch[i - 1] ?? 0) : -1;
        if (a < prev) continue;
      } else {
        const next = i + 2 < n ? Math.abs(ch[i + 2] ?? 0) : -1;
        if (b < next) continue;
      }
      for (let p = 1; p < PHASES; p++) {
        const y = Math.abs(interpAt(ch, i, p));
        if (y > truePeak) truePeak = y;
      }
    }
  }
  return {
    samplePeak,
    truePeak,
    samplePeakDb: gainToDb(samplePeak),
    truePeakDb: gainToDb(truePeak),
  };
}

/** Streaming true peak. Scratch is a few dozen samples, not the file. */
export function openStereoPeak(): {
  push(l: number, r: number): void;
  finish(): PeakReading;
} {
  const ring = 64;
  const histL = new Float64Array(ring);
  const histR = new Float64Array(ring);
  const win = new Float64Array(32);
  let n = 0;
  let measured = -1;
  let samplePeak = 0;
  let truePeak = 0;

  const at = (hist: Float64Array, index: number): number => {
    if (index < 0 || index >= n) return 0;
    return hist[index % ring] ?? 0;
  };

  const measureThrough = (last: number) => {
    while (measured < last) {
      const i = measured + 1;
      for (let t = 0; t < 32; t++) win[t] = at(histL, i - 16 + t);
      const pl = intervalTruePeak(win, 16, 0);
      for (let t = 0; t < 32; t++) win[t] = at(histR, i - 16 + t);
      const pr = intervalTruePeak(win, 16, 0);
      if (pl > truePeak) truePeak = pl;
      if (pr > truePeak) truePeak = pr;
      measured = i;
    }
  };

  return {
    push(l, r) {
      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      if (al > samplePeak) samplePeak = al;
      if (ar > samplePeak) samplePeak = ar;
      histL[n % ring] = l;
      histR[n % ring] = r;
      n++;
      const latest = n - 16;
      if (latest >= 0) measureThrough(latest);
    },
    finish() {
      if (n >= 2) measureThrough(n - 2);
      if (truePeak < samplePeak) truePeak = samplePeak;
      return {
        samplePeak,
        truePeak,
        samplePeakDb: gainToDb(samplePeak),
        truePeakDb: gainToDb(truePeak),
      };
    },
  };
}

/** Local 4× peak between sample i and i+1. `guard` skips the kernel when both samples sit under it. */
export function intervalTruePeak(x: ArrayLike<number>, i: number, guard = 0): number {
  const n = x.length;
  const a = Math.abs(x[i] ?? 0);
  const b = i + 1 < n ? Math.abs(x[i + 1] ?? 0) : 0;
  let peak = a > b ? a : b;
  if (i + 1 >= n || (a < guard && b < guard)) return peak;
  for (let p = 1; p < PHASES; p++) {
    const y = Math.abs(interpAt(x, i, p));
    if (y > peak) peak = y;
  }
  return peak;
}

/** Local 4× peak between sample i and i+1, used by the true-peak limiter. */
export function localTruePeak(x: Float64Array, i: number): number {
  return intervalTruePeak(x, i, 0);
}

/**
 * Peak between sample i and i+1 for every i, written into `peaks`.
 * Samples more than ~3.2 dB under `guard` are stored as 0 — their
 * inter-sample peak cannot cross a ceiling that sits at `guard`.
 * The interior uses one tight pass over the three fractional phases.
 */
export function writeIntervalPeaks(x: Float64Array, peaks: Float64Array, guard: number): void {
  const n = Math.min(x.length, peaks.length);
  const ks = interpKernels();
  const k1 = ks[1];
  const k2 = ks[2];
  const k3 = ks[3];
  const last = n - 1;
  for (let i = 0; i < last; i++) {
    const a = x[i] ?? 0;
    const b = x[i + 1] ?? 0;
    const aa = a < 0 ? -a : a;
    const bb = b < 0 ? -b : b;
    if (aa < guard && bb < guard) {
      peaks[i] = 0;
      continue;
    }
    if (!k1 || !k2 || !k3 || i < RADIUS || i + RADIUS >= n) {
      peaks[i] = localTruePeak(x, i);
      continue;
    }
    let peak = aa > bb ? aa : bb;
    const base = i - RADIUS;
    let y1 = 0;
    let y2 = 0;
    let y3 = 0;
    for (let t = 0; t < k1.length; t++) {
      const s = x[base + t] ?? 0;
      y1 += s * (k1[t] ?? 0);
      y2 += s * (k2[t] ?? 0);
      y3 += s * (k3[t] ?? 0);
    }
    const p1 = y1 < 0 ? -y1 : y1;
    const p2 = y2 < 0 ? -y2 : y2;
    const p3 = y3 < 0 ? -y3 : y3;
    if (p1 > peak) peak = p1;
    if (p2 > peak) peak = p2;
    if (p3 > peak) peak = p3;
    peaks[i] = peak;
  }
  if (n > 0) peaks[last] = Math.abs(x[last] ?? 0);
}
