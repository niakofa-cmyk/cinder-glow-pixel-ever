import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeVerifiedWav, verifyEncodedWav } from "./export-quality.ts";
import { decodeWavPcm } from "./wav.ts";
import { measureTruePeak } from "./truepeak.ts";
import { measureLoudness } from "./lufs.ts";
import type { Clip } from "./types.ts";

function tone(rate = 48000, seconds = 0.45): Clip {
  const l = new Float32Array(Math.round(rate * seconds)), r = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) { l[i] = 0.1 * Math.sin(2 * Math.PI * 1000 * i / rate); r[i] = l[i]! * 0.8; }
  return { l, r, sampleRate: rate };
}
for (const rate of [44100, 48000, 88200, 96000, 176400, 192000]) {
  for (const bits of [16, 24, 32] as const) {
    it(`verifies actual ${bits}-bit/${rate} Hz payload and matches reopened measurements`, () => {
      const clip = tone(rate), { buffer, quality } = encodeVerifiedWav(clip, bits, "offline");
      const decoded = decodeWavPcm(new Uint8Array(buffer))!;
      const peak = measureTruePeak([decoded.l, decoded.r]);
      const loud = measureLoudness([decoded.l, decoded.r], rate);
      assert.equal(quality.format.frames, clip.l.length);
      assert.equal(quality.format.sampleRate, rate); assert.equal(quality.format.bitDepth, bits);
      assert.ok(Math.abs(quality.measurements.truePeakDb! - peak.truePeakDb) < 1e-6);
      assert.ok(Math.abs(quality.measurements.integratedLufs! - loud.integrated) < 1e-6);
      assert.equal(quality.measurements.clippedSamples, 0);
      assert.ok(quality.measurements.correlation > 0.99);
      assert.ok(quality.maxEncodingError < (bits === 32 ? 1e-7 : 3 / 2 ** (bits - 1)));
    });
  }
}
it("rejects malformed headers, corrupted payload and unintended silence", () => {
  const clip = tone(), { buffer } = encodeVerifiedWav(clip, 32, "offline");
  const badHeader = new Uint8Array(buffer.slice(0)); badHeader[24] ^= 1;
  assert.throws(() => verifyEncodedWav(badHeader, clip, 32, "offline"), /header/);
  const nan = new Uint8Array(buffer.slice(0)); new DataView(nan.buffer).setFloat32(52, NaN, true);
  assert.throws(() => verifyEncodedWav(nan, clip, 32, "offline"), /non-finite/);
  const silent = new Uint8Array(buffer.slice(0)); silent.fill(0, 44);
  assert.throws(() => verifyEncodedWav(silent, clip, 32, "offline"), /samples do not match/);
});
it("rejects unsafe integer output while reporting float overs and mono cancellation", () => {
  const clip = tone(); clip.r = clip.l.map(x => -x);
  const anti = encodeVerifiedWav(clip, 24, "shared").quality;
  assert.ok(anti.measurements.correlation < -0.99);
  assert.ok(anti.warnings.some(w => /Mono fold-down/.test(w)));
  clip.l.fill(1.3); clip.r.fill(1.3);
  assert.throws(() => encodeVerifiedWav(clip, 16, "offline"), /0 dBFS/);
  const floating = encodeVerifiedWav(clip, 32, "offline").quality;
  assert.ok(floating.warnings.some(w => /0 dBFS/.test(w)));
  assert.ok(floating.warnings.some(w => /DC offset/.test(w)));
});
it("silent/short audio yields explicit warnings and JSON-safe unavailable loudness", () => {
  const clip = tone(48000, 0.1); clip.l.fill(0); clip.r.fill(0);
  const quality = encodeVerifiedWav(clip, 32, "offline").quality;
  assert.equal(quality.measurements.integratedLufs, null);
  assert.equal(quality.measurements.rmsDb, null);
  assert.ok(quality.warnings.some(w => /near-silent/.test(w)));
  assert.ok(quality.warnings.some(w => /400 ms/.test(w)));
  assert.equal(JSON.parse(JSON.stringify(quality)).measurements.integratedLufs, null);
});
