import type { Stereo } from "./types.ts";

function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(1664525, a) + 1013904223) >>> 0;
    return a / 4294967296 * 2 - 1;
  };
}

/**
 * Eight-second program and a cleaner print of the same arrangement.
 * The reference is synthetic. It exists so spectral balance has a known target,
 * not because it is a commercial master.
 */
export function makeDemo(sampleRate = 48000): { program: Stereo; reference: Stereo } {
  const n = Math.round(sampleRate * 8);
  const pl = new Float64Array(n);
  const pr = new Float64Array(n);
  const rl = new Float64Array(n);
  const rr = new Float64Array(n);
  const nz = noise(0x41555241);
  const twoPi = Math.PI * 2;

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const beat = t % 0.5;
    const kickEnv = beat < 0.45 ? Math.exp(-beat * 9) : 0;
    const kick = Math.sin(twoPi * (48 + 70 * Math.exp(-beat * 14)) * t) * kickEnv * 0.85;

    const bass = Math.sin(twoPi * 55 * t) * 0.34 + Math.sin(twoPi * 110 * t) * 0.08;
    const mud = Math.sin(twoPi * 240 * t) * 0.16 + Math.sin(twoPi * 480 * t) * 0.05;

    const chord =
      (Math.sin(twoPi * 196 * t) + Math.sin(twoPi * 247 * t) + Math.sin(twoPi * 294 * t)) * 0.045;

    const phrase = t % 2;
    const singing = phrase > 0.15 && phrase < 1.7 ? 1 : 0;
    const vocal =
      singing *
      (Math.sin(twoPi * 185 * t) * 0.12 +
        Math.sin(twoPi * 370 * t) * 0.06 +
        Math.sin(twoPi * 3100 * t) * 0.035);

    const essGate = phrase > 1.15 && phrase < 1.45 ? Math.sin(((phrase - 1.15) / 0.3) * Math.PI) : 0;
    const white = nz();
    const ess = white * essGate * 0.22;

    const hatBeat = t % 0.25;
    const hatEnv = hatBeat < 0.04 ? Math.exp(-hatBeat * 80) : 0;
    const hatL = white * hatEnv * 0.08;
    const hatR = white * hatEnv * 0.42;
    const wide = Math.sin(twoPi * 2470 * t) * 0.05 * Math.sin(twoPi * 0.5 * t);

    const programMono = kick + bass + mud + chord + vocal + ess * 0.85;
    pl[i] = programMono + hatL - wide;
    pr[i] = programMono + hatR + wide + ess * 0.15;

    const refMud = mud * 0.35;
    const refEss = ess * 0.25;
    const refVocal = vocal * 1.12;
    const refMono = kick * 0.95 + bass * 0.9 + refMud + chord * 0.85 + refVocal + refEss;
    rl[i] = refMono + hatL * 0.5 - wide * 0.35;
    rr[i] = refMono + hatR * 0.55 + wide * 0.35;
  }

  normalize(pl, pr, 0.7);
  normalize(rl, rr, 0.7);
  return {
    program: { l: pl, r: pr, sampleRate },
    reference: { l: rl, r: rr, sampleRate },
  };
}

function normalize(l: Float64Array, r: Float64Array, peak: number) {
  let m = 1e-9;
  for (let i = 0; i < l.length; i++) {
    m = Math.max(m, Math.abs(l[i] ?? 0), Math.abs(r[i] ?? 0));
  }
  const g = peak / m;
  for (let i = 0; i < l.length; i++) {
    l[i] = (l[i] ?? 0) * g;
    r[i] = (r[i] ?? 0) * g;
  }
}

/** EBU-style alignment tone: stereo 1 kHz at −23 dBFS. Integrated loudness should read −23 LUFS. */
export function calibrationTone(sampleRate = 48000, seconds = 2): Stereo {
  const n = Math.round(sampleRate * seconds);
  const amp = Math.pow(10, -23 / 20);
  const l = new Float64Array(n);
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * amp;
    l[i] = s;
    r[i] = s;
  }
  return { l, r, sampleRate };
}
