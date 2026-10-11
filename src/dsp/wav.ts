function readStr(view: DataView, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

/**
 * PCM and float WAV, including files with JUNK/LIST chunks and extensible fmt.
 * Returns null when the file is not a WAV this parser understands, so the
 * caller can fall back to the browser decoder for MP3, FLAC, and the rest.
 * Sample rate is the rate in the file — nothing is resampled.
 */
export function decodeWavPcm(bytes: Uint8Array): { l: Float32Array; r: Float32Array; sampleRate: number } | null {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = readStr(view, 0, 4);
  if ((tag !== "RIFF" && tag !== "RF64") || readStr(view, 8, 4) !== "WAVE") return null;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitDepth = 0;
  let blockAlign = 0;
  let dataOffset = -1;
  let dataBytes = 0;
  let dataSize64 = 0;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = readStr(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start > bytes.byteLength) break;
    if (id === "fmt " && size >= 16) {
      audioFormat = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      blockAlign = view.getUint16(start + 12, true);
      bitDepth = view.getUint16(start + 14, true);
      if (audioFormat === 0xfffe && size >= 40 && start + 26 <= bytes.byteLength) {
        audioFormat = view.getUint16(start + 24, true);
      }
    } else if (id === "ds64" && size >= 16 && start + 16 <= bytes.byteLength) {
      dataSize64 = Number(view.getBigUint64(start + 8, true));
    } else if (id === "data") {
      dataOffset = start;
      const declared = size === 0xffffffff && dataSize64 > 0 ? dataSize64 : size;
      dataBytes = Math.min(declared, bytes.byteLength - start);
      break;
    }
    const step = size + (size % 2);
    offset = start + step;
    if (step < 0) break;
  }
  if (dataOffset < 0 || channels < 1 || channels > 8 || sampleRate < 1000 || sampleRate > 384000) return null;
  const bytesPerSample = bitDepth === 24 ? 3 : bitDepth / 8;
  if (![1, 3].includes(audioFormat) || ![8, 16, 24, 32].includes(bitDepth)) return null;
  if (audioFormat === 3 && bitDepth !== 32) return null;
  const stride = blockAlign > 0 ? blockAlign : channels * bytesPerSample;
  if (stride < channels * bytesPerSample) return null;
  const frames = Math.floor(dataBytes / stride);
  if (frames < 1) return null;
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  const sample = (pos: number): number | null => {
    if (pos + bytesPerSample > bytes.byteLength) return null;
    if (audioFormat === 3) return view.getFloat32(pos, true);
    if (bitDepth === 16) return view.getInt16(pos, true) / 32768;
    if (bitDepth === 8) return (view.getUint8(pos) - 128) / 128;
    if (bitDepth === 32) return view.getInt32(pos, true) / 2147483648;
    const b0 = view.getUint8(pos);
    const b1 = view.getUint8(pos + 1);
    const b2 = view.getUint8(pos + 2);
    let v = b0 | (b1 << 8) | (b2 << 16);
    if (v & 0x800000) v -= 0x1000000;
    return v / 8388608;
  };
  for (let i = 0; i < frames; i++) {
    const base = dataOffset + i * stride;
    const left = sample(base);
    const right = channels > 1 ? sample(base + bytesPerSample) : left;
    if (left === null || right === null) return null;
    l[i] = left;
    r[i] = right;
  }
  return { l, r, sampleRate };
}

function writeStr(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

/**
 * PCM 16, PCM 24, or IEEE float 32. Little-endian RIFF.
 * Integer paths assume the caller already dithered, and recover the integer
 * code from multiples of 1/2^(bits-1). Float 32 is written without clipping.
 */
export function encodeWav(channels: Float64Array[], sampleRate: number, bitDepth: 16 | 24 | 32): Uint8Array {
  const chs = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = bitDepth === 32 ? 4 : bitDepth === 24 ? 3 : 2;
  const blockAlign = chs * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  view.setUint16(22, chs, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  const fullScale = bitDepth === 16 ? 32768 : 8388608;
  const maxCode = fullScale - 1;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < chs; c++) {
      const sample = channels[c]?.[i] ?? 0;
      if (bitDepth === 32) {
        view.setFloat32(offset, sample, true);
        offset += 4;
      } else if (bitDepth === 16) {
        let code = Math.round(sample * fullScale);
        if (code > maxCode) code = maxCode;
        if (code < -fullScale) code = -fullScale;
        view.setInt16(offset, code, true);
        offset += 2;
      } else {
        let code = Math.round(sample * fullScale);
        if (code > maxCode) code = maxCode;
        if (code < -fullScale) code = -fullScale;
        view.setUint8(offset, code & 0xff);
        view.setUint8(offset + 1, (code >> 8) & 0xff);
        view.setUint8(offset + 2, (code >> 16) & 0xff);
        offset += 3;
      }
    }
  }
  return new Uint8Array(buffer);
}

/** Dither (16/24) or write float32 straight from the clip. No second full-length buffer. */
export function encodeClipWav(channels: ArrayLike<number>[], sampleRate: number, bitDepth: 16 | 24 | 32): Uint8Array {
  const chs = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = bitDepth === 32 ? 4 : bitDepth === 24 ? 3 : 2;
  const blockAlign = chs * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  view.setUint16(22, chs, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  const steps = bitDepth === 16 ? 32768 : 8388608;
  const lsb = 1 / steps;
  const maxCode = steps - 1;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < chs; c++) {
      const sample = channels[c]?.[i] ?? 0;
      if (bitDepth === 32) {
        view.setFloat32(offset, sample, true);
        offset += 4;
      } else {
        const tpdf = (Math.random() + Math.random() - 1) * lsb;
        let code = Math.round((sample + tpdf) * steps);
        if (code > maxCode) code = maxCode;
        if (code < -steps) code = -steps;
        if (bitDepth === 16) {
          view.setInt16(offset, code, true);
          offset += 2;
        } else {
          view.setUint8(offset, code & 0xff);
          view.setUint8(offset + 1, (code >> 8) & 0xff);
          view.setUint8(offset + 2, (code >> 16) & 0xff);
          offset += 3;
        }
      }
    }
  }
  return new Uint8Array(buffer);
}

export function decodeWavHeader(bytes: Uint8Array): {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitDepth: number;
  dataBytes: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitDepth: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
  };
}