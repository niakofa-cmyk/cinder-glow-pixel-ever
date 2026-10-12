import assert from "node:assert/strict";
import { before, it } from "node:test";
import { neutralParams } from "../presets.ts";
import { decodeWavPcm } from "../wav.ts";
import type { Clip } from "../types.ts";
import type { OfflineRequest, OfflineResponse } from "../offline.worker.ts";
import { renderSharedClip } from "./render.ts";

const replies: OfflineResponse[] = [];
const scope = {
  onmessage: null as ((event: { data: OfflineRequest }) => void) | null,
  postMessage: (data: OfflineResponse, transfer?: Transferable[]) =>
    replies.push(structuredClone(data, { transfer })),
};
before(async () => {
  (globalThis as unknown as { self: typeof scope }).self = scope;
  await import("../offline.worker.ts");
});

function clip(): Clip {
  const l = new Float32Array(12000), r = new Float32Array(12000);
  for (let i = 0; i < l.length; i++) {
    l[i] = 0.12 * Math.sin(2 * Math.PI * 220 * i / 44100);
    r[i] = 0.09 * Math.sin(2 * Math.PI * 330 * i / 44100);
  }
  return { l, r, sampleRate: 44100 };
}

for (const bits of [16, 24, 32] as const) {
  it(`background shared export encodes ${bits}-bit WAV without changing source audio`, () => {
    const input = clip(), original = input.l.slice(), params = neutralParams();
    params.eqMode = "linear";
    params.glue = { ...params.glue, enabled: true, optical: 0.8, thresholdDb: -30 };
    params.carve = 0.7; params.carveHz = 1200;
    params.bands = params.bands.map(b => b.id === "low" ? { ...b, gainDb: 3 } : b);
    const expected = renderSharedClip(input, params);
    scope.onmessage?.({ data: { id: bits, op: "shared-export", audio: input, params, bits } });
    const reply = replies.pop();
    assert.ok(reply?.op === "shared-export");
    const view = new DataView(reply.buffer);
    assert.equal(view.getUint16(20, true), bits === 32 ? 3 : 1);
    assert.equal(view.getUint16(34, true), bits);
    const decoded = decodeWavPcm(new Uint8Array(reply.buffer));
    assert.ok(decoded);
    assert.equal(decoded.sampleRate, 44100);
    assert.equal(decoded.l.length, input.l.length);
    assert.ok(decoded.l.some(sample => Math.abs(sample) > 0.01), "Downloaded WAV unexpectedly contains silence");
    let error = 0;
    for (let i = 0; i < input.l.length; i++) error = Math.max(error,
      Math.abs(decoded.l[i]! - expected.l[i]!), Math.abs(decoded.r[i]! - expected.r[i]!));
    assert.ok(error <= (bits === 32 ? 0 : 3 / 2 ** (bits - 1)), `${bits}: ${error}`);
    assert.deepEqual(input.l, original);
    assert.equal(input.l.buffer.byteLength, 48000);
  });
}

it("shared exports reject unsupported DSP, non-finite audio and integer clipping", () => {
  const input = clip(), params = neutralParams();
  const supportedBands = params.bands;
  params.bands = Array.from({ length: 17 }, (_, i) => ({ ...supportedBands[0]!, id: `band-${i}` }));
  scope.onmessage?.({ data: { id: 1, op: "shared-export", audio: input, params, bits: 32 } });
  assert.match((replies.pop() as { message: string }).message, /offline renderer/);
  params.bands = supportedBands;
  input.l[1000] = NaN;
  scope.onmessage?.({ data: { id: 2, op: "shared-export", audio: input, params, bits: 32 } });
  assert.match((replies.pop() as { message: string }).message, /non-finite/);
  input.l.fill(0.7); input.r.fill(0.7);
  params.inputGainDb = 12; params.limiter.enabled = false;
  scope.onmessage?.({ data: { id: 3, op: "shared-export", audio: input, params, bits: 24 } });
  assert.match((replies.pop() as { message: string }).message, /0 dBFS/);
});
