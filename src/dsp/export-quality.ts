import { openLoudness } from "./lufs.ts";
import { openStereoPeak } from "./truepeak.ts";
import { encodeClipWav } from "./wav.ts";
import type { Clip } from "./types.ts";

export type ExportEngine = "offline" | "shared";
export type ExportQuality = {
  version: 1;
  engine: ExportEngine;
  format: { sampleRate: number; bitDepth: 16 | 24 | 32; channels: 2; frames: number; durationSec: number; bytes: number };
  measurements: {
    samplePeakDb: number | null; truePeakDb: number | null; integratedLufs: number | null;
    momentaryMaxLufs: number | null; shortTermMaxLufs: number | null; loudnessRange: number;
    rmsDb: number | null; crestDb: number | null; correlation: number;
    monoLossDb: number | null; dcL: number; dcR: number; clippedSamples: number;
  };
  maxEncodingError: number;
  warnings: string[];
  limitations: string[];
};

const finite = (x: number): number | null => Number.isFinite(x) ? x : null;
const db = (x: number): number => x > 0 ? 20 * Math.log10(x) : -Infinity;

/** Verify OUR encoder's canonical 44-byte stereo RIFF layout, not arbitrary imported WAVs.
 * Reads the encoded payload directly; no second full-length decoded audio allocation.
 */
export function verifyEncodedWav(bytes: Uint8Array, expected: Clip, bits: 16 | 24 | 32, engine: ExportEngine): ExportQuality {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number, value: string) => [...value].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  const frames = expected.l.length, dataSize = frames * 2 * (bits / 8);
  if (!frames || frames !== expected.r.length || bytes.byteLength !== 44 + dataSize || !tag(0, "RIFF") || !tag(8, "WAVE")
    || !tag(12, "fmt ") || !tag(36, "data") || view.getUint32(4, true) !== bytes.byteLength - 8
    || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== (bits === 32 ? 3 : 1)
    || view.getUint16(22, true) !== 2 || view.getUint32(24, true) !== expected.sampleRate
    || view.getUint32(28, true) !== expected.sampleRate * 2 * bits / 8
    || view.getUint16(32, true) !== 2 * bits / 8 || view.getUint16(34, true) !== bits
    || view.getUint32(40, true) !== dataSize) throw new Error("WAV verification failed: header, rate, format or frame count mismatch.");
  const loudness = openLoudness(expected.sampleRate, 2), peak = openStereoPeak();
  const frame = new Float64Array(2);
  const read = (offset: number): number => {
    if (bits === 32) return view.getFloat32(offset, true);
    if (bits === 16) return view.getInt16(offset, true) / 32768;
    const raw = bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
    return ((raw << 8) >> 8) / 8388608;
  };
  let sqL = 0, sqR = 0, cross = 0, midSq = 0, sumL = 0, sumR = 0, clipped = 0, maxError = 0;
  for (let i = 0; i < frames; i++) {
    const offset = 44 + i * 2 * bits / 8;
    const l = read(offset), r = read(offset + bits / 8);
    if (!Number.isFinite(l) || !Number.isFinite(r)) throw new Error("WAV verification failed: non-finite samples.");
    const error = Math.max(Math.abs(l - expected.l[i]!), Math.abs(r - expected.r[i]!));
    const tolerance = bits === 32 ? Math.max(1e-7, Math.abs(l) * 1.2e-7, Math.abs(r) * 1.2e-7) : 3 / 2 ** (bits - 1);
    if (!Number.isFinite(error) || error > tolerance) throw new Error("WAV verification failed: encoded samples do not match the requested audio.");
    maxError = Math.max(maxError, error);
    sqL += l * l; sqR += r * r; cross += l * r; midSq += ((l + r) * 0.5) ** 2;
    sumL += l; sumR += r;
    if (Math.abs(l) >= 1) clipped++;
    if (Math.abs(r) >= 1) clipped++;
    frame[0] = l; frame[1] = r; loudness.push(frame); peak.push(l, r);
  }
  const levels = loudness.finish(), peaks = peak.finish();
  const power = (sqL + sqR) / (2 * frames), rmsDb = db(Math.sqrt(power));
  const correlation = sqL && sqR ? Math.max(-1, Math.min(1, cross / Math.sqrt(sqL * sqR))) : 0;
  const monoLossDb = power > 0 ? db(Math.sqrt(midSq / frames / power)) : -Infinity;
  const warnings: string[] = [];
  if (clipped) warnings.push(`${clipped} samples reach or exceed 0 dBFS; float playback may clip.`);
  if (peaks.truePeakDb > 0) warnings.push("Measured intersample peak exceeds 0 dBTP.");
  if (rmsDb < -90) warnings.push("Export is silent or near-silent. Confirm this is intentional.");
  if (frames < expected.sampleRate * 0.4) warnings.push("Audio is shorter than the 400 ms loudness window; integrated loudness is unavailable.");
  if (rmsDb > -90 && (correlation < 0 || (power > 0 && monoLossDb < -6))) warnings.push("Mono fold-down loses substantial energy. Audition mono before release.");
  if (Math.abs(sumL / frames) > 0.001 || Math.abs(sumR / frames) > 0.001) warnings.push("Measurable DC offset remains in the exported file.");
  return {
    version: 1, engine,
    format: { sampleRate: expected.sampleRate, bitDepth: bits, channels: 2, frames,
      durationSec: frames / expected.sampleRate, bytes: bytes.byteLength },
    measurements: { samplePeakDb: finite(peaks.samplePeakDb), truePeakDb: finite(peaks.truePeakDb),
      integratedLufs: finite(levels.integrated), momentaryMaxLufs: finite(levels.momentaryMax),
      shortTermMaxLufs: finite(levels.shortTermMax), loudnessRange: levels.range, rmsDb: finite(rmsDb),
      crestDb: finite(peaks.samplePeakDb - rmsDb), correlation, monoLossDb: finite(monoLossDb),
      dcL: sumL / frames, dcR: sumR / frames, clippedSamples: clipped },
    maxEncodingError: maxError, warnings,
    limitations: ["Loudness uses the application's BS.1770-style implementation; true peak uses 4× FIR interpolation, not independent certification.",
      "Metrics do not establish subjective sound quality, instrument identity or translation to unknown speakers.",
      "Source measurements refer to decoded Float32 working audio. Integer output includes quantization/dither."],
  };
}

export function encodeVerifiedWav(clip: Clip, bits: 16 | 24 | 32, engine: ExportEngine) {
  if (![16, 24, 32].includes(bits) || !clip.l.length || clip.l.length !== clip.r.length
    || !Number.isInteger(clip.sampleRate) || clip.sampleRate < 8000 || clip.sampleRate > 192000)
    throw new Error("Cannot export invalid channel lengths, bit depth or sample rate.");
  for (let i = 0; i < clip.l.length; i++) {
    const l = clip.l[i]!, r = clip.r[i]!;
    if (!Number.isFinite(l) || !Number.isFinite(r)) throw new Error("Cannot export non-finite audio.");
    if (bits !== 32 && (Math.abs(l) >= 1 || Math.abs(r) >= 1))
      throw new Error("Output reaches 0 dBFS. Enable the limiter, reduce gain, or choose 32-float to avoid PCM clipping.");
  }
  const bytes = encodeClipWav([clip.l, clip.r], clip.sampleRate, bits);
  return { buffer: bytes.buffer as ArrayBuffer, quality: verifyEncodedWav(bytes, clip, bits, engine) };
}
