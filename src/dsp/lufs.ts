import { kWeightingCoeffs } from "./kweight.ts";
import type { BiquadCoeffs } from "./types.ts";

const ABSOLUTE_GATE = -70;
const RELATIVE_GATE_OFFSET = 10;

export type LoudnessResult = {
  integrated: number;
  shortTermMax: number;
  momentaryMax: number;
  range: number;
};

type Samples = ArrayLike<number>;

function blockLoudness(z: number): number {
  if (z <= 1e-20) return -Infinity;
  return -0.691 + 10 * Math.log10(z);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return -Infinity;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const t = idx - lo;
  return (sorted[lo] ?? 0) * (1 - t) + (sorted[hi] ?? 0) * t;
}

type KState = { shelf: BiquadCoeffs; highpass: BiquadCoeffs; s1: number; s2: number; t1: number; t2: number };

function makeKState(sampleRate: number): KState {
  const { shelf, highpass } = kWeightingCoeffs(sampleRate);
  return { shelf, highpass, s1: 0, s2: 0, t1: 0, t2: 0 };
}

/** Same transposed DF2 cascade as `applyKWeightingInPlace`, one sample at a time. */
function kStep(st: KState, x0: number): number {
  const shelf = st.shelf;
  const yShelf = shelf.b0 * x0 + st.s1;
  st.s1 = shelf.b1 * x0 - shelf.a1 * yShelf + st.s2;
  st.s2 = shelf.b2 * x0 - shelf.a2 * yShelf;
  const hp = st.highpass;
  const y = hp.b0 * yShelf + st.t1;
  st.t1 = hp.b1 * yShelf - hp.a1 * y + st.t2;
  st.t2 = hp.b2 * yShelf - hp.a2 * y;
  return y;
}

function maxFinite(values: number[]): number {
  let m = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? -Infinity;
    if (v > m) m = v;
  }
  return m;
}

export type LoudnessMeter = {
  push(frame: ArrayLike<number>): void;
  finish(): LoudnessResult;
};

/** One 3-second ring. Push every sample, then finish. */
export function openLoudness(sampleRate: number, channels: number): LoudnessMeter {
  const states = Array.from({ length: Math.max(1, channels) }, () => makeKState(sampleRate));
  const block = Math.max(1, Math.round(0.4 * sampleRate));
  const hop = Math.max(1, Math.round(0.1 * sampleRate));
  const stBlock = Math.max(block, Math.round(3 * sampleRate));
  const ring = new Float64Array(stBlock);
  let sumAll = 0;
  let sumMom = 0;
  let i = 0;
  const momentary: number[] = [];
  const shortTerm: number[] = [];
  return {
    push(frame) {
      let sq = 0;
      for (let c = 0; c < states.length; c++) {
        const y = kStep(states[c] ?? makeKState(sampleRate), frame[c] ?? 0);
        sq += y * y;
      }
      const slot = i % stBlock;
      if (i >= stBlock) sumAll -= ring[slot] ?? 0;
      if (i >= block) sumMom -= ring[(i - block) % stBlock] ?? 0;
      ring[slot] = sq;
      sumAll += sq;
      sumMom += sq;
      if (i + 1 >= block && (i + 1 - block) % hop === 0) momentary.push(blockLoudness(sumMom / block));
      if (i + 1 >= stBlock && (i + 1 - stBlock) % hop === 0) shortTerm.push(blockLoudness(sumAll / stBlock));
      i++;
    },
    finish() {
      const integrated = gatedIntegrated(momentary);
      const momentaryMax = momentary.length ? maxFinite(momentary) : -Infinity;
      const shortTermMax = shortTerm.length ? maxFinite(shortTerm) : momentaryMax;
      const range = loudnessRange(shortTerm.length >= 2 ? shortTerm : momentary);
      return {
        integrated,
        shortTermMax: Number.isFinite(shortTermMax) ? shortTermMax : -Infinity,
        momentaryMax: Number.isFinite(momentaryMax) ? momentaryMax : -Infinity,
        range,
      };
    },
  };
}

/**
 * Integrated, short-term, momentary loudness and a Tech 3342-style loudness range.
 * Stereo weights are 1.0 / 1.0. Mono is a single channel.
 * A 1 kHz stereo sine at −23 dBFS reads −23.0 LUFS (EBU Tech 3341).
 * Memory is one 3-second ring, not a second copy of the file.
 */
export function measureLoudness(channels: Samples[], sampleRate: number): LoudnessResult {
  const n = channels[0]?.length ?? 0;
  const meter = openLoudness(sampleRate, channels.length);
  const frame = new Float64Array(channels.length);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels.length; c++) frame[c] = channels[c]?.[i] ?? 0;
    meter.push(frame);
  }
  return meter.finish();
}

function gatedIntegrated(blocks: number[]): number {
  const finite = blocks.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return -Infinity;
  const abs = finite.filter((v) => v > ABSOLUTE_GATE);
  if (abs.length === 0) return -Infinity;
  const absPower = abs.reduce((s, v) => s + Math.pow(10, (v + 0.691) / 10), 0) / abs.length;
  const absLoud = blockLoudness(absPower);
  const relThreshold = absLoud - RELATIVE_GATE_OFFSET;
  const rel = abs.filter((v) => v > relThreshold);
  if (rel.length === 0) return absLoud;
  const relPower = rel.reduce((s, v) => s + Math.pow(10, (v + 0.691) / 10), 0) / rel.length;
  return blockLoudness(relPower);
}

/** EBU Tech 3342: LRA = 95th − 10th percentile of gated short-term loudness. */
function loudnessRange(shortTerm: number[]): number {
  const finite = shortTerm.filter((v) => Number.isFinite(v) && v > ABSOLUTE_GATE);
  if (finite.length < 2) return 0;
  const power = finite.reduce((s, v) => s + Math.pow(10, (v + 0.691) / 10), 0) / finite.length;
  const integrated = blockLoudness(power);
  const gate = integrated - 20;
  const gated = finite.filter((v) => v >= gate).sort((a, b) => a - b);
  if (gated.length < 2) return 0;
  return Math.max(0, percentile(gated, 0.95) - percentile(gated, 0.1));
}
