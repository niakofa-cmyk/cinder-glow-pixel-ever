/** In-place radix-2 Cooley–Tukey. `re` and `im` length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0;
      const ti = im[i] ?? 0;
      re[i] = re[j] ?? 0;
      im[i] = im[j] ?? 0;
      re[j] = tr;
      im[j] = ti;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j] ?? 0;
        const uIm = im[i + j] ?? 0;
        const vRe = re[i + j + half] ?? 0;
        const vIm = im[i + j + half] ?? 0;
        const tRe = vRe * wRe - vIm * wIm;
        const tIm = vRe * wIm + vIm * wRe;
        re[i + j] = uRe + tRe;
        im[i + j] = uIm + tIm;
        re[i + j + half] = uRe - tRe;
        im[i + j + half] = uIm - tIm;
        const nextRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = (re[i] ?? 0) / n;
      im[i] = (im[i] ?? 0) / n;
    }
  }
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** One-sided amplitude spectrum in dBFS, Hann window, coherent-gain corrected. */
export function amplitudeSpectrumDb(
  x: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
): { db: Float64Array; binHz: number } {
  const n = fftSize;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const use = Math.min(n, x.length);
  let winSum = 0;
  for (let i = 0; i < use; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, use - 1)));
    winSum += w;
    re[i] = (x[i] ?? 0) * w;
  }
  fft(re, im, false);
  const bins = n / 2;
  const db = new Float64Array(bins);
  const norm = Math.max(1e-20, winSum);
  for (let k = 0; k < bins; k++) {
    const mag = Math.hypot(re[k] ?? 0, im[k] ?? 0);
    const amp = (k === 0 ? 1 : 2) * (mag / norm);
    db[k] = 20 * Math.log10(Math.max(1e-12, amp));
  }
  return { db, binHz: sampleRate / n };
}

/**
 * Welch-averaged amplitude spectrum. Returns dBFS per bin.
 * `binHz` is sampleRate / fftSize.
 */
export function welchSpectrumDb(
  x: ArrayLike<number>,
  sampleRate: number,
  fftSize = 8192,
  hop = 4096,
): { db: Float64Array; binHz: number } {
  if (x.length < 32) {
    return amplitudeSpectrumDb(x, sampleRate, nextPow2(Math.max(32, x.length)));
  }
  const size = nextPow2(fftSize);
  const bins = size / 2;
  const acc = new Float64Array(bins);
  let frames = 0;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const window = new Float64Array(size);
  let winSum = 0;
  for (let i = 0; i < size; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    window[i] = w;
    winSum += w;
  }
  const step = Math.max(1, hop);
  for (let start = 0; start + size <= x.length; start += step) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < size; i++) re[i] = (x[start + i] ?? 0) * (window[i] ?? 0);
    fft(re, im, false);
    for (let k = 0; k < bins; k++) {
      const mag = Math.hypot(re[k] ?? 0, im[k] ?? 0);
      const amp = (k === 0 ? 1 : 2) * (mag / winSum);
      acc[k] = (acc[k] ?? 0) + amp * amp;
    }
    frames++;
    if (frames > 80) break;
  }
  if (frames === 0) return amplitudeSpectrumDb(x, sampleRate, size);
  const db = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    const meanPower = (acc[k] ?? 0) / frames;
    db[k] = 20 * Math.log10(Math.max(1e-12, Math.sqrt(meanPower)));
  }
  return { db, binHz: sampleRate / size };
}

/** ISO preferred 1/3-octave centers from ~20 Hz to ~20 kHz. */
export function thirdOctaveCenters(): number[] {
  const centers: number[] = [];
  for (let k = -16; k <= 14; k++) {
    const f = 1000 * Math.pow(2, k / 3);
    if (f >= 20 && f <= 20000) centers.push(f);
  }
  return centers;
}

export function thirdOctaveFromSpectrum(
  db: Float64Array,
  binHz: number,
  sampleRate: number,
): { freq: number; db: number }[] {
  const nyquist = sampleRate * 0.5;
  const centers = thirdOctaveCenters().filter((f) => f * Math.pow(2, -1 / 6) < nyquist);
  return centers.map((freq) => {
    const lo = freq * Math.pow(2, -1 / 6);
    const hi = freq * Math.pow(2, 1 / 6);
    const i0 = Math.max(1, Math.floor(lo / binHz));
    const i1 = Math.min(db.length - 1, Math.ceil(hi / binHz));
    let power = 0;
    let count = 0;
    for (let i = i0; i <= i1; i++) {
      const d = db[i] ?? -120;
      power += Math.pow(10, d / 10);
      count++;
    }
    const mean = count > 0 ? power / count : 1e-12;
    return { freq, db: 10 * Math.log10(Math.max(1e-12, mean)) };
  });
}
