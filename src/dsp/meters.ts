/** Pearson correlation of the AC component of L and R. +1 identical, −1 inverted. */
export function stereoCorrelation(l: ArrayLike<number>, r: ArrayLike<number>): number {
  const n = Math.min(l.length, r.length);
  if (n === 0) return 1;
  let sumL = 0;
  let sumR = 0;
  for (let i = 0; i < n; i++) {
    sumL += l[i] ?? 0;
    sumR += r[i] ?? 0;
  }
  const meanL = sumL / n;
  const meanR = sumR / n;
  let num = 0;
  let denL = 0;
  let denR = 0;
  for (let i = 0; i < n; i++) {
    const a = (l[i] ?? 0) - meanL;
    const b = (r[i] ?? 0) - meanR;
    num += a * b;
    denL += a * a;
    denR += b * b;
  }
  const den = Math.sqrt(denL * denR);
  if (den < 1e-18) return 1;
  return Math.max(-1, Math.min(1, num / den));
}

export function rms(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] ?? 0;
    s += v * v;
  }
  return Math.sqrt(s / Math.max(1, x.length));
}

export function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] ?? 0;
  return s / Math.max(1, x.length);
}

export function peakAbs(x: ArrayLike<number>): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i] ?? 0);
    if (a > p) p = a;
  }
  return p;
}

export function countClipped(x: ArrayLike<number>, threshold = 0.999): number {
  let c = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i] ?? 0) >= threshold) c++;
  return c;
}

/** Fraction of spectral power between loHz and hiHz. */
export function bandEnergyRatio(db: Float64Array, binHz: number, loHz: number, hiHz: number): number {
  let band = 0;
  let total = 0;
  for (let i = 1; i < db.length; i++) {
    const f = i * binHz;
    const p = Math.pow(10, (db[i] ?? -120) / 10);
    total += p;
    if (f >= loHz && f < hiHz) band += p;
  }
  if (total <= 0) return 0;
  return band / total;
}

export function sideEnergyRatio(l: ArrayLike<number>, r: ArrayLike<number>): number {
  let midE = 0;
  let sideE = 0;
  const n = Math.min(l.length, r.length);
  for (let i = 0; i < n; i++) {
    const m = ((l[i] ?? 0) + (r[i] ?? 0)) * 0.5;
    const s = ((l[i] ?? 0) - (r[i] ?? 0)) * 0.5;
    midE += m * m;
    sideE += s * s;
  }
  const total = midE + sideE;
  if (total <= 1e-20) return 0;
  return sideE / total;
}
