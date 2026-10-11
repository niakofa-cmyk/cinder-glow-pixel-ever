import type { ChainParams, DynamicsBand, EqBand } from "./types.ts";

export function neutralDynamics(partial: Partial<DynamicsBand> = {}): DynamicsBand {
  return {
    thresholdDb: -18,
    ratio: 1.5,
    attackMs: 20,
    releaseMs: 120,
    kneeDb: 6,
    makeupDb: 0,
    ...partial,
  };
}

export function defaultBands(): EqBand[] {
  return [
    { id: "hp", type: "highpass", freq: 28, gainDb: 0, q: 0.707, enabled: false },
    { id: "low", type: "lowshelf", freq: 120, gainDb: 0, q: 0.7, enabled: true },
    { id: "mud", type: "peaking", freq: 320, gainDb: 0, q: 1.1, enabled: true },
    { id: "presence", type: "peaking", freq: 3200, gainDb: 0, q: 1, enabled: true },
    { id: "air", type: "highshelf", freq: 10000, gainDb: 0, q: 0.7, enabled: true },
  ];
}

export function neutralParams(): ChainParams {
  return {
    inputGainDb: 0,
    eqMode: "minimum",
    eqTarget: "stereo",
    bands: defaultBands(),
    dynamicEq: {
      enabled: false,
      freq: 3500,
      q: 1.4,
      thresholdDb: -24,
      ratio: 2,
      attackMs: 12,
      releaseMs: 90,
      maxCutDb: 3,
    },
    deEss: {
      enabled: false,
      freq: 7200,
      q: 1.3,
      thresholdDb: -28,
      ratio: 3,
      attackMs: 1,
      releaseMs: 40,
      maxCutDb: 4,
    },
    multiband: {
      enabled: false,
      lowHz: 140,
      highHz: 4500,
      low: neutralDynamics({ thresholdDb: -20, ratio: 1.6, attackMs: 25, releaseMs: 140 }),
      mid: neutralDynamics({ thresholdDb: -18, ratio: 1.5, attackMs: 15, releaseMs: 100 }),
      high: neutralDynamics({ thresholdDb: -22, ratio: 1.4, attackMs: 8, releaseMs: 80 }),
    },
    glue: { enabled: false, optical: 0.55, ...neutralDynamics({ thresholdDb: -16, ratio: 1.4, attackMs: 30, releaseMs: 150, kneeDb: 8 }) },
    transient: { enabled: false, attack: 0, sustain: 0 },
    saturation: { enabled: false, mode: "tape", driveDb: 4, mix: 0.35, memory: 0.4, lowColor: 0, highColor: 0, tubeTapeMix: 0.65 },
    width: 1,
    carve: 0,
    carveHz: 2800,
    limiter: { enabled: true, ceilingDb: -1, releaseMs: 80, lookaheadMs: 5 },
  };
}

export type Preset = { id: string; name: string; detail: string; params: ChainParams };

export function presets(): Preset[] {
  const neutral = neutralParams();
  const streaming = neutralParams();
  streaming.bands = defaultBands().map((b) => (b.id === "hp" ? { ...b, enabled: true, freq: 26 } : b));
  streaming.glue = { ...streaming.glue, enabled: true, thresholdDb: -14, ratio: 1.3, makeupDb: 0 };
  streaming.limiter = { ...streaming.limiter, enabled: true, ceilingDb: -1 };

  const warmth = neutralParams();
  warmth.bands = defaultBands().map((b) => {
    if (b.id === "low") return { ...b, gainDb: 1.2 };
    if (b.id === "air") return { ...b, gainDb: -0.6 };
    if (b.id === "mud") return { ...b, gainDb: -0.8, freq: 280 };
    return b;
  });
  warmth.saturation = { enabled: true, mode: "hybrid", driveDb: 6, mix: 0.34, memory: 0.55, lowColor: 0.2, highColor: -0.05, tubeTapeMix: 0.72 };
  warmth.glue = { ...warmth.glue, enabled: true, thresholdDb: -16, ratio: 1.5, makeupDb: 0.5, optical: 0.6 };

  const vocal = neutralParams();
  vocal.bands = defaultBands().map((b) => {
    if (b.id === "presence") return { ...b, gainDb: 1.4, freq: 3400, q: 1.1 };
    if (b.id === "mud") return { ...b, gainDb: -1.2, freq: 300, q: 1 };
    return b;
  });
  vocal.deEss = { ...vocal.deEss, enabled: true, thresholdDb: -30, maxCutDb: 3 };
  vocal.dynamicEq = { ...vocal.dynamicEq, enabled: true, freq: 3800, maxCutDb: 2.5, thresholdDb: -26 };
  vocal.carve = 0.4;
  vocal.carveHz = 3200;

  const punch = neutralParams();
  punch.transient = { enabled: true, attack: 0.35, sustain: -0.15 };
  punch.multiband = {
    ...punch.multiband,
    enabled: true,
    low: { ...punch.multiband.low, thresholdDb: -22, ratio: 2, attackMs: 30 },
  };

  return [
    { id: "neutral", name: "Neutral", detail: "Safety limiter only. Nothing is colored.", params: neutral },
    {
      id: "streaming",
      name: "Streaming start",
      detail: "High-pass and a light glue stage. You still set the loudness.",
      params: streaming,
    },
    {
      id: "warmth",
      name: "Gentle warmth",
      detail: "Small low shelf, a hybrid tape curve with a little hysteresis, less air. Not a hardware clone.",
      params: warmth,
    },
    {
      id: "vocal",
      name: "Vocal clarity",
      detail: "Modest presence, a mud cut, de-ess, a dynamic 3.8 kHz restraint, and a side carve around the vocal.",
      params: vocal,
    },
    {
      id: "punch",
      name: "Transient punch",
      detail: "More attack, slightly less sustain, light low-band control.",
      params: punch,
    },
  ];
}
