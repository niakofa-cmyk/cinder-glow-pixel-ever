import { z } from "zod";
import type { ChainParams, Clip } from "../dsp/types.ts";
import type { ProcessingBank } from "./processing-snapshots.ts";

const number = (min: number, max: number) => z.number().finite().min(min).max(max);
const frequency = number(10, 192000);
const dynamics = z.object({
  thresholdDb: number(-96, 24), ratio: number(1, 30),
  attackMs: number(0.01, 5000), releaseMs: number(0.01, 20000),
  kneeDb: number(0, 48), makeupDb: number(-48, 48),
});
const dynamicBand = z.object({
  enabled: z.boolean(), freq: frequency, q: number(0.1, 32),
  thresholdDb: number(-96, 24), ratio: number(1, 30),
  attackMs: number(0.01, 5000), releaseMs: number(0.01, 20000),
  maxCutDb: number(0, 48),
});
const paramsSchema: z.ZodType<ChainParams> = z.object({
  inputGainDb: number(-24, 24),
  eqMode: z.enum(["minimum", "linear"]), eqTarget: z.enum(["stereo", "mid", "side"]),
  bands: z.array(z.object({
    id: z.string().min(1).max(64),
    type: z.enum(["peaking", "lowshelf", "highshelf", "lowpass", "highpass", "bandpass", "notch"]),
    freq: frequency, gainDb: number(-24, 24), q: number(0.1, 32), enabled: z.boolean(),
  })).max(64).refine(bands => new Set(bands.map(b => b.id)).size === bands.length),
  dynamicEq: dynamicBand, deEss: dynamicBand,
  multiband: z.object({
    enabled: z.boolean(), lowHz: frequency, highHz: frequency,
    low: dynamics, mid: dynamics, high: dynamics,
  }).refine(band => band.lowHz < band.highHz),
  glue: dynamics.extend({ enabled: z.boolean(), optical: number(0, 1) }),
  transient: z.object({ enabled: z.boolean(), attack: number(-1, 1), sustain: number(-1, 1) }),
  saturation: z.object({
    enabled: z.boolean(), mode: z.enum(["tape", "tube", "hybrid"]),
    driveDb: number(-48, 48), mix: number(0, 1), memory: number(0, 1),
    lowColor: number(-1, 1), highColor: number(-1, 1), tubeTapeMix: number(0, 1),
  }),
  width: number(0, 4), carve: number(0, 1), carveHz: frequency,
  limiter: z.object({
    enabled: z.boolean(), ceilingDb: number(-48, 0),
    releaseMs: number(0.01, 20000), lookaheadMs: number(0, 100),
  }),
});

export function parseChainParams(value: unknown): ChainParams {
  const result = paramsSchema.safeParse(value);
  if (!result.success) throw new Error("Processing settings are invalid or unsupported.");
  return result.data;
}
const processingBankSchema: z.ZodType<ProcessingBank> = z.object({
  entries: z.array(z.object({ id: z.string().min(1).max(64), name: z.string().trim().min(1).max(80), params: paramsSchema })).max(8),
  aId: z.string().min(1).max(64).nullable(), bId: z.string().min(1).max(64).nullable(),
}).refine(bank => {
  const ids = bank.entries.map(s => s.id), names = bank.entries.map(s => s.name.toLowerCase());
  return new Set(ids).size === ids.length && new Set(names).size === names.length
    && (!bank.aId || ids.includes(bank.aId)) && (!bank.bId || ids.includes(bank.bId))
    && (!bank.aId || bank.aId !== bank.bId);
});

function isClip(value: unknown): value is Clip {
  if (!value || typeof value !== "object") return false;
  const clip = value as Clip;
  if (!Number.isInteger(clip.sampleRate) || clip.sampleRate < 8000 || clip.sampleRate > 384000) return false;
  if (!(clip.l instanceof Float32Array) || !(clip.r instanceof Float32Array)) return false;
  if (clip.l.length < 8 || clip.l.length !== clip.r.length || clip.l.length > clip.sampleRate * 720) return false;
  for (let i = 0; i < clip.l.length; i++) {
    if (!Number.isFinite(clip.l[i]) || !Number.isFinite(clip.r[i])) return false;
  }
  return true;
}

const snapshotSchema = z.object({
  version: z.literal(1), savedAt: z.number().int().positive(),
  program: z.custom<Clip>(isClip), reference: z.custom<Clip>(isClip).nullable(),
  programName: z.string().min(1).max(512), referenceName: z.string().max(512),
  params: paramsSchema,
  processingBank: processingBankSchema.optional(),
  source: z.enum(["original", "processed", "reference"]),
  monitor: z.enum(["full", "mono", "small"]), matchLoudness: z.boolean(),
  targetLufs: number(-36, -5),
  moduleId: z.enum(["map", "input", "eq", "dynamic", "deess", "multiband", "glue", "transient", "saturation", "image", "limiter"]),
}).refine(s => !s.reference || s.reference.sampleRate === s.program.sampleRate);

export type SessionSnapshot = z.infer<typeof snapshotSchema>;

export function parseSnapshot(value: unknown): SessionSnapshot {
  const result = snapshotSchema.safeParse(value);
  if (!result.success) {
    throw new Error("The saved session is corrupt or incompatible. Delete it and save a new session.");
  }
  return result.data;
}
