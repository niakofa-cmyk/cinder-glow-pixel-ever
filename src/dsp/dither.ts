/** Mulberry32. Tests pass a seed; export uses Math.random via `randomFloat`. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * TPDF dither then quantize to `bits`. Error is uncorrelated triangular noise
 * of width 1 LSB, which linearizes quiet signals instead of freezing them into
 * a staircase. 32-bit float export does not call this.
 */
export function quantizeWithDither(
  x: Float64Array,
  bits: 16 | 24,
  random: () => number = Math.random,
): Float64Array {
  const steps = bits === 16 ? 32768 : 8388608;
  const lsb = 1 / steps;
  const y = new Float64Array(x.length);
  const maxCode = steps - 1;
  for (let i = 0; i < x.length; i++) {
    const tpdf = (random() + random() - 1) * lsb;
    const dithered = (x[i] ?? 0) + tpdf;
    let code = Math.round(dithered * steps);
    if (code > maxCode) code = maxCode;
    if (code < -steps) code = -steps;
    y[i] = code / steps;
  }
  return y;
}
