/**
 * Hybrid saturation with an 8× linear-phase anti-alias filter.
 *
 * The static curves are original: symmetric tanh (odd harmonics) and an
 * asymmetric exponential (even harmonics). They are not a tape transport or a
 * triode. Memory, when asked for, is a Preisach play operator on the magnetized
 * value plus a slow bias state — a first-order hysteresis model, solved one
 * sample at a time at the oversampled rate. Harmonics above the original
 * Nyquist are removed before decimation.
 *
 * The FIR is 129 taps so the cascade delay is an integer number of base-rate
 * samples (16). Dry and wet stay aligned. Kernel design is a Kaiser window,
 * not a hand-copied coefficient list.
 */

export type SaturationMode = "tape" | "tube" | "hybrid";

export type SaturationOptions = {
  sampleRate?: number;
  /** 0 is the static curve. 1 leans on the hysteresis state. */
  memory?: number;
  /** −1..1. Positive pushes lows into the clip. */
  lowColor?: number;
  /** −1..1. Positive pushes highs into the clip. */
  highColor?: number;
  /** Hybrid only. 0 is tube, 1 is tape. */
  tubeTapeMix?: number;
  /** Linear trim after the dry/wet mix. */
  outputGain?: number;
};

const OS = 8;
const TAPS = 129;
const MID = (TAPS - 1) >> 1;
/** Two centered delays of MID high-rate samples. 128 / 8 = 16. */
const BASE_DELAY = (2 * MID) / OS;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const half = x * 0.5;
  for (let k = 1; k < 40; k++) {
    term *= (half * half) / (k * k);
    sum += term;
    if (term < sum * 1e-14) break;
  }
  return sum;
}

/** Lowpass in cycles per high-rate sample. Sum is normalized to 1. */
function designKaiserLowpass(cutoffCycles: number, taps: number, beta: number): Float64Array {
  const h = new Float64Array(taps);
  const mid = (taps - 1) / 2;
  const i0b = besselI0(beta);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const n = i - mid;
    const sinc = n === 0 ? 2 * cutoffCycles : Math.sin(2 * Math.PI * cutoffCycles * n) / (Math.PI * n);
    const r = mid === 0 ? 0 : n / mid;
    const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b;
    const v = sinc * w;
    h[i] = v;
    sum += v;
  }
  const inv = sum === 0 ? 1 : 1 / sum;
  for (let i = 0; i < taps; i++) h[i] = (h[i] ?? 0) * inv;
  return h;
}

type Kernel = { h: Float64Array; branches: Float64Array[] };

let kernelCache: Kernel | null = null;

function kernel(): Kernel {
  if (kernelCache) return kernelCache;
  // Cutoff sits just under the original Nyquist (1/16 cycle at 8×) so the
  // transition can start attenuating before the first image.
  const h = designKaiserLowpass(0.055, TAPS, 8.6);
  const branches: Float64Array[] = [];
  for (let p = 0; p < OS; p++) {
    const n = Math.ceil((TAPS - p) / OS);
    const b = new Float64Array(n);
    for (let t = 0; t < n; t++) b[t] = h[p + t * OS] ?? 0;
    branches.push(b);
  }
  kernelCache = { h, branches };
  return kernelCache;
}

/** Symmetric tanh. Unity small-signal gain. Odd harmonics. */
export function tapeSample(x: number, drive: number): number {
  const g = Math.max(0.01, drive);
  return Math.tanh(g * x) / g;
}

/**
 * Asymmetric soft clip. Positive side saturates as tanh; the negative side
 * is softer, which produces even harmonics (a tube-like spectrum, not a
 * triode model).
 */
export function tubeSample(x: number, drive: number): number {
  const g = Math.max(0.01, drive);
  const s = g * x;
  const y = s >= 0 ? Math.tanh(s) : 0.62 * Math.tanh(s / 0.62);
  return y / g;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

type Prepared = {
  drive: number;
  tubeAmt: number;
  memory: number;
  lowColor: number;
  highColor: number;
  outputGain: number;
  mix: number;
  lowA: number;
  highA: number;
  kBias: number;
  playWidth: number;
};

function prepare(mode: SaturationMode, driveDb: number, mix: number, osRate: number, options: SaturationOptions): Prepared {
  const memory = clamp01(options.memory ?? 0);
  const tubeTape = clamp01(options.tubeTapeMix ?? 0.5);
  const tubeAmt = mode === "tube" ? 1 : mode === "hybrid" ? 1 - tubeTape : 0;
  return {
    drive: Math.max(0.01, Math.pow(10, driveDb / 20)),
    tubeAmt,
    memory,
    lowColor: Math.max(-1, Math.min(1, options.lowColor ?? 0)),
    highColor: Math.max(-1, Math.min(1, options.highColor ?? 0)),
    outputGain: Number.isFinite(options.outputGain) ? (options.outputGain as number) : 1,
    mix: clamp01(mix),
    lowA: Math.exp((-2 * Math.PI * 180) / osRate),
    highA: Math.exp((-2 * Math.PI * 5200) / osRate),
    kBias: 1 - Math.exp((-2 * Math.PI * 8) / osRate),
    // Width is in the pre-normalized shaper domain, so it scales with drive.
    playWidth: (0.012 + 0.16 * memory) * Math.max(1, Math.pow(10, driveDb / 20)),
  };
}

type NlState = { lp: number; hp: number; flux: number; bias: number; primed: boolean };

function shape(u: number, st: NlState, p: Prepared): number {
  let x = u;
  if (p.lowColor !== 0 || p.highColor !== 0) {
    if (!st.primed) {
      st.lp = u;
      st.hp = u;
      st.primed = true;
    }
    st.lp = p.lowA * st.lp + (1 - p.lowA) * x;
    st.hp = p.highA * st.hp + (1 - p.highA) * x;
    x = x + p.lowColor * st.lp * 0.7 + p.highColor * (x - st.hp) * 0.7;
  }
  const s = p.drive * (p.memory > 0 ? x + st.bias * 0.35 * p.memory : x);
  const tape = Math.tanh(s);
  const tube = s >= 0 ? 1 - Math.exp(-Math.min(60, s)) : -0.72 * (1 - Math.exp(Math.max(-60, s / 0.72)));
  let y = tape * (1 - p.tubeAmt) + tube * p.tubeAmt;
  if (p.memory > 0) {
    const width = p.playWidth;
    if (y > st.flux + width) st.flux = y - width;
    else if (y < st.flux - width) st.flux = y + width;
    y = y * (1 - p.memory) + st.flux * p.memory;
    st.bias += p.kBias * (y - st.bias);
  }
  return y / p.drive;
}

type SatStream = {
  p: Prepared;
  h: Float64Array;
  branches: Float64Array[];
  ring: Float64Array;
  nl: NlState;
  count: number;
  i: number;
  hist: Float64Array;
};

function createSatStream(sampleRate: number, mode: SaturationMode, driveDb: number, mix: number, options: SaturationOptions): SatStream {
  const sr = sampleRate > 0 ? sampleRate : 48000;
  const { h, branches } = kernel();
  return {
    p: prepare(mode, driveDb, mix, sr * OS, options),
    h,
    branches,
    ring: new Float64Array(TAPS),
    nl: { lp: 0, hp: 0, flux: 0, bias: 0, primed: false },
    count: 0,
    i: 0,
    hist: new Float64Array(24),
  };
}

function satPushWet(s: SatStream, x: number): number | null {
  const i = s.i;
  s.hist[i % s.hist.length] = x;
  const branches = s.branches;
  for (let phase = 0; phase < OS; phase++) {
    const b = branches[phase];
    const taps = b?.length ?? 0;
    let acc = 0;
    for (let t = 0; t < taps; t++) {
      const j = i - t;
      if (j < 0) break;
      acc += (b?.[t] ?? 0) * (s.hist[j % s.hist.length] ?? 0);
    }
    s.ring[s.count % TAPS] = shape(acc * OS, s.nl, s.p);
    s.count++;
  }
  let wet: number | null = null;
  if (i >= BASE_DELAY) {
    const newest = i * OS;
    let acc = 0;
    for (let k = 0; k < TAPS; k++) {
      const idx = newest - k;
      if (idx < 0) break;
      acc += (s.h[k] ?? 0) * (s.ring[idx % TAPS] ?? 0);
    }
    wet = acc;
  }
  s.i++;
  return wet;
}

export type AlignedSat = {
  push(x: number): number | null;
  flush(): number | null;
};

/** Delay-compensated saturation. `flush` is called BASE_DELAY times at the end of the file. */
export function openAlignedSat(
  sampleRate: number,
  mode: SaturationMode,
  driveDb: number,
  mix: number,
  options: SaturationOptions = {},
): AlignedSat {
  const stream = createSatStream(sampleRate, mode, driveDb, mix, options);
  const m = stream.p.mix;
  const g = stream.p.outputGain;
  if (m <= 0) {
    return {
      push: (x) => x * g,
      flush: () => null,
    };
  }
  const dryMix = 1 - m;
  const delay = new Float64Array(BASE_DELAY);
  let pos = 0;
  let filled = 0;
  let flushed = 0;
  const take = (sample: number): number | null => {
    const wet = satPushWet(stream, sample);
    if (filled < BASE_DELAY) {
      delay[filled++] = sample;
      return null;
    }
    const dry = delay[pos] ?? 0;
    delay[pos] = sample;
    pos = (pos + 1) % BASE_DELAY;
    if (wet === null) return null;
    return (dry * dryMix + wet * m) * g;
  };
  return {
    push: (x) => take(x),
    flush: () => {
      if (flushed >= BASE_DELAY) return null;
      flushed++;
      return take(0);
    },
  };
}

/**
 * In-place saturation. Scratch is the 129-tap ring, not a copy of the file.
 * Dry and wet stay aligned by the same 16-sample cascade delay as the block processor.
 */
export function saturateInPlace(
  x: { [index: number]: number; length: number },
  sampleRate: number,
  mode: SaturationMode,
  driveDb: number,
  mix: number,
  options: SaturationOptions = {},
): void {
  const sat = openAlignedSat(sampleRate, mode, driveDb, mix, options);
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const y = sat.push(x[i] ?? 0);
    if (y !== null) x[i - BASE_DELAY] = y;
  }
  for (let k = 0; k < BASE_DELAY; k++) {
    const y = sat.flush();
    const idx = n - BASE_DELAY + k;
    if (y !== null && idx >= 0 && idx < n) x[idx] = y;
  }
}

/**
 * Block processor. State is per call — offline renders do not leak across files.
 * `process` returns a buffer the same length as the input, delay-compensated.
 */
export class AnalogSaturationProcessor {
  process(x: Float64Array, sampleRate: number, mode: SaturationMode, driveDb: number, mix: number, options: SaturationOptions = {}): Float64Array {
    const y = new Float64Array(x);
    saturateInPlace(y, sampleRate, mode, driveDb, mix, options);
    return y;
  }
}

export function saturateChannel(
  x: Float64Array,
  mode: SaturationMode,
  driveDb: number,
  mix: number,
  options: SaturationOptions = {},
): Float64Array {
  return new AnalogSaturationProcessor().process(x, options.sampleRate ?? 48000, mode, driveDb, mix, options);
}

/** Naive (no oversampling) tanh, exported so tests can show the alias it creates. */
export function tapeNaive(x: Float64Array, driveDb: number): Float64Array {
  const drive = Math.pow(10, driveDb / 20);
  const y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = tapeSample(x[i] ?? 0, drive);
  return y;
}
