import { dbToGain, gainToDb } from "./biquad.ts";
import { intervalTruePeak } from "./truepeak.ts";

export type LimitResult = {
  l: Float64Array;
  r: Float64Array;
  maxReductionDb: number;
};

const HIST = 32;
const TP_FUTURE = 15;
const TP_PAST = 16;

export type LimitStream = {
  push(l: number, r: number): { l: number; r: number } | null;
  flush(): { l: number; r: number } | null;
  maxReduction: () => number;
};

/**
 * Same gain law as `limitInto`, one stereo frame at a time.
 * Output is aligned with the input: `push` returns null until the lookahead
 * window exists, and `flush` finishes the tail. Scratch is the lookahead, not the file.
 */
export function openLimitStream(
  sampleRate: number,
  ceilingDb: number,
  releaseMs: number,
  lookaheadMs: number,
): LimitStream {
  const ceiling = dbToGain(ceilingDb);
  const look = Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate));
  const guard = ceiling * Math.pow(10, -3.2 / 20);
  const rel = Math.exp(-1 / Math.max(1, (releaseMs / 1000) * sampleRate));
  const ringSize = look + TP_FUTURE + TP_PAST + HIST + 8;
  const inL = new Float64Array(ringSize);
  const inR = new Float64Array(ringSize);
  const dRing = new Float64Array(look);
  const deque = new Int32Array(look);
  const winL = new Float64Array(HIST);
  const winR = new Float64Array(HIST);
  let head = 0;
  let tail = 0;
  let count = 0;
  let seen = 0;
  let desiredUntil = -1;
  let emitIndex = 0;
  let env = 1;
  let maxGr = 0;
  let finished = false;

  const sample = (ring: Float64Array, index: number): number => {
    if (index < 0 || index >= seen) return 0;
    return ring[index % ringSize] ?? 0;
  };

  const desiredAt = (i: number): number => {
    for (let t = 0; t < HIST; t++) {
      const s = i - TP_PAST + t;
      winL[t] = sample(inL, s);
      winR[t] = sample(inR, s);
    }
    const peak = Math.max(intervalTruePeak(winL, TP_PAST, guard), intervalTruePeak(winR, TP_PAST, guard));
    if (peak > ceiling && peak > 1e-12) return ceiling / peak;
    return 1;
  };

  const pushDesired = (i: number, d: number) => {
    dRing[i % look] = d;
    while (count > 0) {
      const back = deque[(tail - 1 + look) % look] ?? 0;
      if ((dRing[back % look] ?? 1) < d) break;
      tail = (tail - 1 + look) % look;
      count--;
    }
    deque[tail] = i;
    tail = (tail + 1) % look;
    count++;
    desiredUntil = i;
  };

  const popOlder = (minIndex: number) => {
    while (count > 0 && (deque[head] ?? 0) < minIndex) {
      head = (head + 1) % look;
      count--;
    }
  };

  const canEmit = (index: number): boolean => {
    if (index >= seen || count === 0) return false;
    if (!finished) return desiredUntil >= index + look - 1;
    return desiredUntil >= index;
  };

  const emitOne = (): { l: number; r: number } | null => {
    if (!canEmit(emitIndex)) return null;
    popOlder(emitIndex);
    const target = dRing[(deque[head] ?? 0) % look] ?? 1;
    if (target < env) env = target;
    else env = rel * env + (1 - rel) * target;
    const gr = -gainToDb(env);
    if (gr > maxGr) maxGr = gr;
    const y = { l: sample(inL, emitIndex) * env, r: sample(inR, emitIndex) * env };
    emitIndex++;
    return y;
  };

  return {
    push(l, r) {
      const j = seen;
      inL[j % ringSize] = l;
      inR[j % ringSize] = r;
      seen++;
      const k = j - TP_FUTURE;
      if (k >= 0) pushDesired(k, desiredAt(k));
      return emitOne();
    },
    flush() {
      if (!finished) {
        finished = true;
        for (let k = desiredUntil + 1; k < seen; k++) pushDesired(k, desiredAt(k));
      }
      return emitOne();
    },
    maxReduction: () => maxGr,
  };
}

/**
 * Linked true-peak lookahead limiter.
 * Gain at sample i is the release-smoothed minimum of the 4× peaks over the
 * lookahead window. The audio itself is not delayed. Samples already under
 * the ceiling pass through unchanged.
 * Scratch memory is the lookahead window, not a second copy of the file.
 * `dst` may alias `src`.
 */
export function limitInto(
  srcL: ArrayLike<number>,
  srcR: ArrayLike<number>,
  dstL: { [index: number]: number; length: number },
  dstR: { [index: number]: number; length: number },
  sampleRate: number,
  ceilingDb: number,
  releaseMs: number,
  lookaheadMs: number,
): number {
  const n = Math.min(srcL.length, srcR.length, dstL.length, dstR.length);
  const stream = openLimitStream(sampleRate, ceilingDb, releaseMs, lookaheadMs);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const y = stream.push(srcL[i] ?? 0, srcR[i] ?? 0);
    if (!y) continue;
    dstL[w] = y.l;
    dstR[w] = y.r;
    w++;
  }
  for (;;) {
    const y = stream.flush();
    if (!y || w >= n) break;
    dstL[w] = y.l;
    dstR[w] = y.r;
    w++;
  }
  return stream.maxReduction();
}

export function limitStereo(
  left: Float64Array,
  right: Float64Array,
  sampleRate: number,
  ceilingDb: number,
  releaseMs: number,
  lookaheadMs: number,
): LimitResult {
  const n = Math.min(left.length, right.length);
  const l = new Float64Array(n);
  const r = new Float64Array(n);
  const maxReductionDb = limitInto(left, right, l, r, sampleRate, ceilingDb, releaseMs, lookaheadMs);
  return { l, r, maxReductionDb };
}
