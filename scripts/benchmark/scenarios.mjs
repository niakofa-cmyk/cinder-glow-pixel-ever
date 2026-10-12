import { neutralParams } from "../../src/dsp/presets.ts";

export const SCENARIOS = [
  "neutral", "full-minimum", "full-linear",
  "linear-without-saturation", "linear-without-multiband", "linear-without-optical-carve",
];

export function scenarioParams(id) {
  if (!SCENARIOS.includes(id)) throw new Error(`Unknown benchmark scenario: ${id}`);
  const p = neutralParams();
  if (id === "neutral") return p;
  p.bands = p.bands.map(b => ({ ...b, enabled: true }));
  p.eqMode = id === "full-minimum" ? "minimum" : "linear";
  p.dynamicEq.enabled = true;
  p.deEss.enabled = true;
  p.multiband.enabled = id !== "linear-without-multiband";
  p.glue = { ...p.glue, enabled: true, optical: id === "linear-without-optical-carve" ? 0 : 0.8 };
  p.transient = { enabled: true, attack: 0.2, sustain: -0.15 };
  p.saturation = { ...p.saturation, enabled: id !== "linear-without-saturation",
    mode: "hybrid", driveDb: 6, mix: 0.5, memory: 0.65, lowColor: 0.2, highColor: -0.1 };
  p.width = 1.15;
  p.carve = id === "linear-without-optical-carve" ? 0 : 0.7;
  return p;
}

export function changedParams(index) {
  const p = scenarioParams("full-linear");
  p.eqMode = index % 2 ? "minimum" : "linear";
  p.eqTarget = ["stereo", "mid", "side"][index % 3];
  p.inputGainDb = [-2, 0, 2][index % 3];
  p.width = [0.75, 1, 1.3][index % 3];
  p.carveHz = [1200, 2800, 4000][index % 3];
  p.saturation.mode = ["tape", "tube", "hybrid"][index % 3];
  p.bands = p.bands.map(b => b.id === "presence" ? { ...b, gainDb: index % 2 ? 1.5 : -1.5 } : b);
  return p;
}

/** One repeatable second, not a representative music corpus. No growing song buffer. */
export function syntheticLoop(sampleRate, seed = 0x41555241) {
  const l = new Float64Array(sampleRate), r = new Float64Array(sampleRate);
  let random = seed >>> 0;
  for (let i = 0; i < sampleRate; i++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const noise = (random / 4294967296 - 0.5) * 0.04;
    const pulse = i % Math.round(sampleRate / 4) < sampleRate * 0.006 ? 0.12 : 0;
    const t = i / sampleRate;
    const mid = 0.24 * Math.sin(2 * Math.PI * 60 * t)
      + 0.12 * Math.sin(2 * Math.PI * 997 * t)
      + 0.05 * Math.sin(2 * Math.PI * Math.min(7500, sampleRate * 0.35) * t) + noise + pulse;
    const side = 0.08 * Math.sin(2 * Math.PI * 2300 * t);
    l[i] = mid + side;
    r[i] = mid - side;
  }
  return { l, r, seed };
}
