import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export function fixture(rate = 48000, gain = 1) {
  const n = rate * 6;
  const bytes = Buffer.alloc(44 + n * 4);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const hit = 0.015 * Math.exp(-(t % 1) * 100) * Math.sin(2 * Math.PI * 2200 * t);
    const l = gain * (0.05 * Math.sin(2 * Math.PI * 440 * t) + 0.018 * Math.sin(2 * Math.PI * 110 * t) + hit);
    const r = gain * (0.045 * Math.sin(2 * Math.PI * 440 * t + 0.15) + 0.012 * Math.sin(2 * Math.PI * 880 * t) + hit);
    bytes.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    bytes.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  return bytes;
}

export async function makeFixtures(dir) {
  const files = {};
  for (const [name, rate, gain] of [
    ["program", 48000, 1], ["reference", 48000, 0.7],
    ["native", 44100, 1], ["native-reference", 44100, 0.7],
  ]) {
    files[name] = join(dir, `${name}.wav`);
    await writeFile(files[name], fixture(rate, gain));
  }
  files.invalid = join(dir, "invalid.wav");
  await writeFile(files.invalid, "not audio");
  for (const [extension, codec] of [["mp3", "libmp3lame"], ["flac", "flac"], ["aiff", "pcm_s16be"]]) {
    files[extension] = join(dir, `program.${extension}`);
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", files.program, "-c:a", codec, files[extension]]);
  }
  return files;
}

export function wavInfo(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
  let format, channels, rate, bits, offset, length;
  for (let p = 12; p + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", p, p + 4);
    const size = bytes.readUInt32LE(p + 4);
    assert.ok(p + 8 + size <= bytes.length);
    if (id === "fmt ") {
      format = bytes.readUInt16LE(p + 8); channels = bytes.readUInt16LE(p + 10);
      rate = bytes.readUInt32LE(p + 12); bits = bytes.readUInt16LE(p + 22);
    }
    if (id === "data") { offset = p + 8; length = size; }
    p += 8 + size + (size % 2);
  }
  assert.ok(offset && length);
  assert.ok([16, 24, 32].includes(bits)); assert.ok([1, 3].includes(format));
  const samples = new Float64Array(length / (bits / 8));
  let sum = 0, peak = 0;
  for (let p = offset, i = 0; p < offset + length; p += bits / 8, i++) {
    const x = format === 3 ? bytes.readFloatLE(p)
      : bits === 24 ? bytes.readIntLE(p, 3) / 8388608 : bytes.readInt16LE(p) / 32768;
    assert.ok(Number.isFinite(x));
    samples[i] = x; sum += x * x; peak = Math.max(peak, Math.abs(x));
  }
  return { format, channels, rate, bits, frames: samples.length / channels, rms: Math.sqrt(sum / samples.length), peak, samples };
}
