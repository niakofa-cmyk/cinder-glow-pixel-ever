import assert from "node:assert/strict";
import { it } from "node:test";
import { analyze } from "./analyze.ts";

for (const rate of [44100, 48000, 88200, 96000, 176400, 192000]) {
  it(`stereo spectral analysis does not ignore right-only audio at ${rate} Hz`, () => {
    const signal = new Float32Array(8192), silence = new Float32Array(8192);
    for (let i = 0; i < signal.length; i++) signal[i] = 0.2 * Math.sin(2 * Math.PI * 1000 * i / rate);
    const left = analyze(signal, silence, rate), right = analyze(silence, signal, rate);
    let error = 0;
    for (let i = 0; i < left.spectrumDb.length; i++) error = Math.max(error, Math.abs(left.spectrumDb[i]! - right.spectrumDb[i]!));
    assert.ok(error < 1e-9);
    assert.ok(right.resonances.some(r => Math.abs(r.freq - 1000) < 200));
    assert.ok(right.spectrumDb.some(x => x > -40));
  });
}
it("power averaging preserves anti-phase spectrum rather than mono-cancelling it", () => {
  const signal = new Float32Array(16000), inverse = new Float32Array(16000);
  for (let i = 0; i < signal.length; i++) { signal[i] = 0.2 * Math.sin(2 * Math.PI * 500 * i / 48000); inverse[i] = -signal[i]!; }
  const mono = analyze(signal, signal, 48000), anti = analyze(signal, inverse, 48000);
  for (let i = 0; i < mono.spectrumDb.length; i++) assert.ok(Math.abs(mono.spectrumDb[i]! - anti.spectrumDb[i]!) < 1e-8);
  assert.ok(anti.correlation < -0.99);
});
it("right-channel bass contributes to tonal measurements", () => {
  const left = new Float32Array(48000), right = new Float32Array(48000);
  for (let i = 0; i < left.length; i++) {
    left[i] = 0.1 * Math.sin(2 * Math.PI * 5000 * i / 48000);
    right[i] = 0.2 * Math.sin(2 * Math.PI * 50 * i / 48000);
  }
  assert.ok(analyze(left, right, 48000).subEnergyRatio > 0.65);
});
