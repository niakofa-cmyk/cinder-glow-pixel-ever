import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyze } from "./analyze.ts";
import { dbToGain, designBiquad, filtfiltInPlace, processBiquadInPlace, biquadMagnitudeDb } from "./biquad.ts";
import { renderChain } from "./chain.ts";
import { splitLinkwitzRiley4, splitThreeBand } from "./crossover.ts";
import { calibrationTone } from "./demo.ts";
import { quantizeWithDither, mulberry32 } from "./dither.ts";
import { compressSerialStereo, compressStereo, dynamicBandCut, gainReductionDb, shapeTransients } from "./dynamics.ts";
import { applyEqStereo, eqCurveDb } from "./eq.ts";
import { amplitudeSpectrumDb } from "./fft.ts";
import { applyWidth, carveCenter } from "./imaging.ts";
import { kWeightingCoeffs } from "./kweight.ts";
import { limitStereo } from "./limiter.ts";
import { measureLoudness } from "./lufs.ts";
import { stereoCorrelation } from "./meters.ts";
import { neutralParams } from "./presets.ts";
import { renderClip } from "./render-clip.ts";
import { saturateChannel, tapeNaive } from "./saturation.ts";
import { measureTruePeak } from "./truepeak.ts";
import { decodeWavHeader, decodeWavPcm, encodeWav } from "./wav.ts";

const SR = 48000;

function sine(freq: number, seconds: number, amp: number, phase = 0): Float64Array {
  const n = Math.round(SR * seconds);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = Math.sin((2 * Math.PI * freq * i) / SR + phase) * amp;
  return y;
}

function rmsRange(x: ArrayLike<number>, from: number, to: number): number {
  let s = 0;
  const a = Math.max(0, from);
  const b = Math.min(x.length, to);
  for (let i = a; i < b; i++) s += (x[i] ?? 0) ** 2;
  return Math.sqrt(s / Math.max(1, b - a));
}

function decodeAdd(mid: Float64Array, side: Float64Array): { l: Float64Array; r: Float64Array } {
  const l = new Float64Array(mid.length);
  const r = new Float64Array(mid.length);
  for (let i = 0; i < mid.length; i++) {
    l[i] = (mid[i] ?? 0) + (side[i] ?? 0);
    r[i] = (mid[i] ?? 0) - (side[i] ?? 0);
  }
  return { l, r };
}

function sideEnergy(l: Float64Array, r: Float64Array, from: number, to: number): number {
  let s = 0;
  const a = Math.max(0, from);
  const b = Math.min(l.length, r.length, to);
  for (let i = a; i < b; i++) {
    const side = ((l[i] ?? 0) - (r[i] ?? 0)) * 0.5;
    s += side * side;
  }
  return s / Math.max(1, b - a);
}

describe("biquad EQ", () => {
  it("peaks at +6 dB at the center frequency and is flat an octave down at high Q", () => {
    const c = designBiquad("peaking", 1000, 2, 6, SR);
    const center = biquadMagnitudeDb(c, 1000, SR);
    const away = biquadMagnitudeDb(c, 200, SR);
    assert.ok(Math.abs(center - 6) < 0.05, `center ${center}`);
    assert.ok(Math.abs(away) < 0.4, `away ${away}`);
  });

  it("raises a 1 kHz sine by 6 dB in minimum phase", () => {
    const x = sine(1000, 0.5, 0.1);
    const y = new Float64Array(x);
    processBiquadInPlace(y, designBiquad("peaking", 1000, 1, 6, SR));
    const inR = rmsRange(x, 8000, x.length);
    const outR = rmsRange(y, 8000, y.length);
    const db = 20 * Math.log10(outR / inR);
    assert.ok(Math.abs(db - 6) < 0.3, `got ${db}`);
  });

  it("linear-phase mode matches the requested center gain and stays near zero phase", () => {
    const dry = sine(1000, 0.5, 0.1);
    const bands = [{ id: "p", type: "peaking" as const, freq: 1000, gainDb: 6, q: 1, enabled: true }];
    const wet = applyEqStereo(dry, dry, bands, SR, "linear", "stereo");
    const db = 20 * Math.log10(rmsRange(wet.l, 8000, dry.length) / rmsRange(dry, 8000, dry.length));
    assert.ok(Math.abs(db - 6) < 0.4, `got ${db}`);
    const curve = eqCurveDb(bands, SR, "linear");
    const near = curve.reduce((best, p) => (Math.abs(p.freq - 1000) < Math.abs(best.freq - 1000) ? p : best));
    assert.ok(Math.abs(near.db - 6) < 0.2, `curve ${near.db}`);
  });

  it("a 0 dB peaking filtfilt is transparent", () => {
    const x = sine(440, 0.2, 0.2);
    const y = new Float64Array(x);
    filtfiltInPlace(y, [designBiquad("peaking", 1000, 1, 0, SR)]);
    let err = 0;
    for (let i = 1000; i < y.length - 1000; i++) err = Math.max(err, Math.abs((y[i] ?? 0) - (x[i] ?? 0)));
    assert.ok(err < 1e-6, `err ${err}`);
  });

  it("high-pass removes DC", () => {
    const x = new Float64Array(4000);
    x.fill(0.2);
    processBiquadInPlace(x, designBiquad("highpass", 40, 0.707, 0, SR));
    assert.ok(Math.abs(x[x.length - 1] ?? 1) < 0.01);
  });

  it("mid EQ changes a mono signal and side EQ does not", () => {
    const x = sine(1000, 0.3, 0.2);
    const bands = [{ id: "p", type: "peaking" as const, freq: 1000, gainDb: 6, q: 1, enabled: true }];
    const mid = applyEqStereo(x, x, bands, SR, "minimum", "mid");
    const side = applyEqStereo(x, x, bands, SR, "minimum", "side");
    const midDb = 20 * Math.log10(rmsRange(mid.l, 4000, x.length) / rmsRange(x, 4000, x.length));
    let sideErr = 0;
    for (let i = 2000; i < x.length; i++) sideErr = Math.max(sideErr, Math.abs((side.l[i] ?? 0) - (x[i] ?? 0)));
    assert.ok(midDb > 4, `mid ${midDb}`);
    assert.ok(sideErr < 1e-8, `side ${sideErr}`);
  });
});

describe("K-weighting and LUFS", () => {
  it("matches the published 48 kHz shelf within a tight tolerance", () => {
    const { shelf, highpass } = kWeightingCoeffs(48000);
    assert.ok(Math.abs(shelf.b0 - 1.53512485958697) < 2e-3, `b0 ${shelf.b0}`);
    assert.ok(Math.abs(shelf.a1 - -1.69065929318241) < 2e-3, `a1 ${shelf.a1}`);
    assert.ok(Math.abs(highpass.b1 - -1.99004745483398) < 5e-3 || Math.abs(highpass.a1 - -1.99004745483398) < 5e-3);
  });

  it("reads a −23 dBFS stereo 1 kHz sine as −23 LUFS", () => {
    const tone = calibrationTone(SR, 2);
    const loud = measureLoudness([tone.l, tone.r], SR);
    assert.ok(Math.abs(loud.integrated - -23) < 0.15, `got ${loud.integrated}`);
    assert.ok(loud.range < 0.5, `lra ${loud.range}`);
  });
});

describe("spectrum, correlation, true peak", () => {
  it("puts a bin-centered sine in that FFT bin", () => {
    const n = 8192;
    const bin = 170;
    const freq = (bin * SR) / n;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * freq * i) / SR) * 0.5;
    const spec = amplitudeSpectrumDb(x, SR, n);
    let maxBin = 0;
    let maxDb = -Infinity;
    for (let i = 1; i < spec.db.length; i++) {
      if ((spec.db[i] ?? -999) > maxDb) {
        maxDb = spec.db[i] ?? -999;
        maxBin = i;
      }
    }
    assert.equal(maxBin, bin);
    assert.ok(Math.abs(maxDb - 20 * Math.log10(0.5)) < 0.4, `db ${maxDb}`);
  });

  it("correlation is +1, −1, and near 0 for the textbook cases", () => {
    const a = sine(440, 0.2, 0.5);
    const inv = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) inv[i] = -(a[i] ?? 0);
    const noise = new Float64Array(a.length);
    let s = 1;
    for (let i = 0; i < noise.length; i++) {
      s = (Math.imul(1664525, s) + 1013904223) | 0;
      noise[i] = (s >>> 0) / 4294967296 * 2 - 1;
    }
    assert.ok(stereoCorrelation(a, a) > 0.999);
    assert.ok(stereoCorrelation(a, inv) < -0.999);
    assert.ok(Math.abs(stereoCorrelation(a, noise)) < 0.15);
  });

  it("reports about +3 dBTP on a quarter-Nyquist sine that peaks between samples", () => {
    const x = sine(SR / 4, 0.25, 1, Math.PI / 4);
    const peak = measureTruePeak([x]);
    assert.ok(Math.abs(peak.samplePeakDb - -3.01) < 0.15, `sample ${peak.samplePeakDb}`);
    assert.ok(Math.abs(peak.truePeakDb - 0) < 0.35, `true ${peak.truePeakDb}`);
  });

  it("crest factor of a sine is 3.01 dB", () => {
    const x = sine(1000, 0.5, 0.5);
    const report = analyze(x, x, SR);
    assert.ok(Math.abs(report.crestDb - 3.01) < 0.2, `crest ${report.crestDb}`);
  });
});

describe("dynamics", () => {
  it("soft knee is continuous at both edges", () => {
    const threshold = -20;
    const ratio = 4;
    const knee = 6;
    const below = gainReductionDb(threshold - knee / 2, threshold, ratio, knee);
    const above = gainReductionDb(threshold + knee / 2 + 0.001, threshold, ratio, knee);
    const aboveLinear = (1 - 1 / ratio) * (knee / 2 + 0.001);
    assert.equal(below, 0);
    assert.ok(Math.abs(above - aboveLinear) < 0.02, `${above} vs ${aboveLinear}`);
  });

  it("applies about 10 dB of reduction at 0 dBFS, −20 dB threshold, ratio 2", () => {
    const n = Math.round(SR * 0.4);
    const l = new Float64Array(n);
    l.fill(1);
    const r = new Float64Array(l);
    const y = compressStereo(l, r, SR, {
      thresholdDb: -20,
      ratio: 2,
      attackMs: 5,
      releaseMs: 50,
      kneeDb: 0,
      makeupDb: 0,
    });
    const tail = rmsRange(y.audioL, Math.round(n * 0.75), n);
    const db = 20 * Math.log10(tail);
    assert.ok(Math.abs(db - -10) < 1, `got ${db}`);
  });

  it("dynamic EQ cuts the target sine and leaves a distant sine alone", () => {
    const hot = sine(3000, 0.4, 0.5);
    const bass = sine(100, 0.4, 0.5);
    const cut = dynamicBandCut(hot, SR, 3000, 2, -40, 8, 1, 20, 12);
    const kept = dynamicBandCut(bass, SR, 7000, 1.4, -30, 4, 1, 30, 6);
    const cutDb = 20 * Math.log10(rmsRange(cut, 8000, hot.length) / rmsRange(hot, 8000, hot.length));
    const keptDb = 20 * Math.log10(rmsRange(kept, 4000, bass.length) / rmsRange(bass, 4000, bass.length));
    assert.ok(cutDb < -6, `cut ${cutDb}`);
    assert.ok(Math.abs(keptDb) < 0.6, `kept ${keptDb}`);
  });

  it("positive attack makes a click louder and negative sustain makes a tone quieter", () => {
    const click = new Float64Array(2000);
    click[400] = 1;
    const shaped = shapeTransients(click, SR, 1, 0);
    assert.ok(Math.abs(shaped[400] ?? 0) > 1.4, `click ${shaped[400]}`);

    const tone = sine(220, 0.6, 0.4);
    const body = shapeTransients(tone, SR, 0, -0.6);
    const dry = rmsRange(tone, 20000, tone.length);
    const wet = rmsRange(body, 20000, body.length);
    assert.ok(wet / dry < 0.8, `ratio ${wet / dry}`);
  });
});

describe("crossovers", () => {
  it("Linkwitz-Riley 4 sums flat", () => {
    for (const freq of [80, 1000, 8000]) {
      const x = sine(freq, 0.35, 0.4);
      const split = splitLinkwitzRiley4(x, 1000, SR);
      const sum = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) sum[i] = (split.low[i] ?? 0) + (split.high[i] ?? 0);
      const db = 20 * Math.log10(rmsRange(sum, 6000, x.length) / rmsRange(x, 6000, x.length));
      assert.ok(Math.abs(db) < 0.4, `${freq} Hz → ${db} dB`);
    }
  });

  it("three-band unity reconstruction stays flat", () => {
    for (const freq of [60, 400, 2000, 9000]) {
      const x = sine(freq, 0.4, 0.3);
      const b = splitThreeBand(x, 150, 4000, SR);
      const sum = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) sum[i] = (b.low[i] ?? 0) + (b.mid[i] ?? 0) + (b.high[i] ?? 0);
      const db = 20 * Math.log10(rmsRange(sum, 8000, x.length) / rmsRange(x, 8000, x.length));
      assert.ok(Math.abs(db) < 0.5, `${freq} Hz → ${db} dB`);
    }
  });

  it("linear-phase split stays in phase with the source", () => {
    const x = sine(1000, 0.4, 0.4);
    const split = splitLinkwitzRiley4(x, 1000, SR);
    const sum = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) sum[i] = (split.low[i] ?? 0) + (split.high[i] ?? 0);
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 8000; i < x.length - 1000; i++) {
      const a = x[i] ?? 0;
      const b = sum[i] ?? 0;
      ab += a * b;
      aa += a * a;
      bb += b * b;
    }
    const corr = ab / Math.sqrt(aa * bb);
    assert.ok(corr > 0.98, `corr ${corr}`);
  });
});

describe("saturation", () => {
  it("8× oversampling suppresses the alias that naive tanh creates", () => {
    const freq = 15000;
    const n = 8192;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * freq * i) / SR) * 0.8;
    const naive = tapeNaive(x, 18);
    const over = saturateChannel(x, "tape", 18, 1, { memory: 0, sampleRate: SR });
    const nSpec = amplitudeSpectrumDb(naive, SR, n);
    const oSpec = amplitudeSpectrumDb(over, SR, n);
    const aliasBin = Math.round(3000 / nSpec.binHz);
    const naiveAlias = nSpec.db[aliasBin] ?? -120;
    const overAlias = oSpec.db[aliasBin] ?? -120;
    assert.ok(overAlias < naiveAlias - 15, `naive ${naiveAlias} over ${overAlias}`);
  });

  it("keeps a quiet 1 kHz sine near unity at 0 dB drive", () => {
    const x = sine(1000, 0.25, 0.05);
    const y = saturateChannel(x, "tape", 0, 1, { memory: 0, sampleRate: SR });
    const db = 20 * Math.log10(rmsRange(y, 4000, x.length - 500) / rmsRange(x, 4000, x.length - 500));
    assert.ok(Math.abs(db) < 0.35, `moved ${db}`);
  });

  it("hysteresis does not explode a driven sine", () => {
    const x = sine(220, 0.2, 0.7);
    const y = saturateChannel(x, "hybrid", 12, 1, { memory: 0.8, tubeTapeMix: 0.4, lowColor: 0.3, highColor: 0.2, sampleRate: SR });
    let peak = 0;
    let finite = true;
    for (let i = 0; i < y.length; i++) {
      const s = y[i] ?? 0;
      if (!Number.isFinite(s)) finite = false;
      peak = Math.max(peak, Math.abs(s));
    }
    assert.ok(finite);
    assert.ok(peak < 2, `peak ${peak}`);
    assert.ok(peak > 0.05, `silent ${peak}`);
  });
});

describe("imaging, limiter, dither, wav, chain", () => {
  it("width 1 is transparent and width 0 is mono", () => {
    const l = sine(440, 0.1, 0.4);
    const r = sine(440, 0.1, 0.2, 1);
    const same = applyWidth(l, r, 1);
    let err = 0;
    for (let i = 0; i < l.length; i++) err = Math.max(err, Math.abs((same.l[i] ?? 0) - (l[i] ?? 0)));
    assert.ok(err < 1e-12);
    const mono = applyWidth(l, r, 0);
    let side = 0;
    for (let i = 0; i < l.length; i++) side = Math.max(side, Math.abs((mono.l[i] ?? 0) - (mono.r[i] ?? 0)));
    assert.ok(side < 1e-12);
  });

  it("center carve ducks a hot side band and leaves a low side band alone", () => {
    const n = Math.round(SR * 0.35);
    const mid = new Float64Array(n);
    const sideHi = new Float64Array(n);
    const sideLow = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      mid[i] = Math.sin((2 * Math.PI * 2500 * i) / SR) * 0.55;
      sideHi[i] = Math.sin((2 * Math.PI * 2500 * i) / SR) * 0.35;
      sideLow[i] = Math.sin((2 * Math.PI * 120 * i) / SR) * 0.35;
    }
    const wide = decodeAdd(mid, sideHi);
    const carved = carveCenter(wide.l, wide.r, SR, 1, 2500);
    const before = sideEnergy(wide.l, wide.r, 6000, n);
    const after = sideEnergy(carved.l, carved.r, 6000, n);
    assert.ok(after < before * 0.45, `side ${after} vs ${before}`);

    const bass = decodeAdd(mid, sideLow);
    const bassCarved = carveCenter(bass.l, bass.r, SR, 1, 2500);
    const bassBefore = sideEnergy(bass.l, bass.r, 8000, n);
    const bassAfter = sideEnergy(bassCarved.l, bassCarved.r, 8000, n);
    assert.ok(bassAfter > bassBefore * 0.7, `bass side ${bassAfter} vs ${bassBefore}`);
  });

  it("serial glue with optical at 0 still pulls a full-scale tone down", () => {
    const n = Math.round(SR * 0.4);
    const l = new Float64Array(n);
    l.fill(1);
    const y = compressSerialStereo(l, l, SR, {
      thresholdDb: -20,
      ratio: 2,
      attackMs: 5,
      releaseMs: 50,
      kneeDb: 0,
      makeupDb: 0,
    }, 0);
    const tail = rmsRange(y.audioL, Math.round(n * 0.75), n);
    const db = 20 * Math.log10(tail);
    assert.ok(Math.abs(db - -10) < 1.5, `got ${db}`);
    const deeper = compressSerialStereo(l, l, SR, {
      thresholdDb: -20,
      ratio: 2,
      attackMs: 5,
      releaseMs: 50,
      kneeDb: 0,
      makeupDb: 0,
    }, 1);
    const deepDb = 20 * Math.log10(rmsRange(deeper.audioL, Math.round(n * 0.75), n));
    assert.ok(deepDb < db - 0.4, `optical ${deepDb} vs vca ${db}`);
  });

  it("holds a hot signal to the ceiling and passes a quiet one unchanged", () => {
    const hot = sine(1000, 0.2, 1, Math.PI / 4);
    const limited = limitStereo(hot, hot, SR, -6, 40, 5);
    const tp = measureTruePeak([limited.l, limited.r]);
    assert.ok(tp.truePeakDb <= -5.6, `true peak ${tp.truePeakDb}`);
    const quiet = sine(1000, 0.1, 0.1);
    const passed = limitStereo(quiet, quiet, SR, -1, 50, 5);
    let err = 0;
    for (let i = 0; i < quiet.length; i++) err = Math.max(err, Math.abs((passed.l[i] ?? 0) - (quiet[i] ?? 0)));
    assert.ok(err < 1e-12, `err ${err}`);
  });

  it("dithered 16-bit audio stays inside the codes and is not truncated to zero", () => {
    const x = sine(440, 0.05, 0.0001);
    const y = quantizeWithDither(x, 16, mulberry32(1));
    let max = 0;
    let nonzero = 0;
    for (let i = 0; i < y.length; i++) {
      max = Math.max(max, Math.abs(y[i] ?? 0));
      if ((y[i] ?? 0) !== 0) nonzero++;
    }
    assert.ok(max < 0.01);
    assert.ok(nonzero > 10);
  });

  it("writes a stereo 24-bit WAV header the decoder can read back", () => {
    const l = sine(1000, 0.01, 0.25);
    const bytes = encodeWav([l, l], SR, 24);
    const header = decodeWavHeader(bytes);
    assert.equal(header.audioFormat, 1);
    assert.equal(header.channels, 2);
    assert.equal(header.sampleRate, SR);
    assert.equal(header.bitDepth, 24);
    assert.equal(header.dataBytes, l.length * 2 * 3);
    const decoded = decodeWavPcm(bytes);
    assert.ok(decoded);
    assert.equal(decoded?.sampleRate, SR);
    const db = 20 * Math.log10(rmsRange(decoded?.l ?? new Float64Array(), 100, l.length) / rmsRange(l, 100, l.length));
    assert.ok(Math.abs(db) < 0.05, `roundtrip ${db}`);
  });

  it("reads a WAV that has a JUNK chunk before the format", () => {
    const tone = sine(440, 0.02, -0.4);
    const raw = encodeWav([tone], SR, 16);
    const junk = new Uint8Array(8 + 4);
    junk.set([0x4a, 0x55, 0x4e, 0x4b, 4, 0, 0, 0, 1, 2, 3, 4]);
    const out = new Uint8Array(raw.length + junk.length);
    out.set(raw.subarray(0, 12));
    out.set(junk, 12);
    out.set(raw.subarray(12), 12 + junk.length);
    const view = new DataView(out.buffer);
    view.setUint32(4, out.length - 8, true);
    const decoded = decodeWavPcm(out);
    assert.equal(decoded?.sampleRate, SR);
    assert.ok(Math.abs((decoded?.l[10] ?? 0) - (tone[10] ?? 0)) < 1 / 32768);
  });

  it("neutral chain does not move a moderate sine", () => {
    const x = sine(1000, 0.3, dbToGain(-12));
    const rendered = renderChain({ l: x, r: x, sampleRate: SR }, neutralParams());
    const db = 20 * Math.log10(rmsRange(rendered.l, 4000, x.length) / rmsRange(x, 4000, x.length));
    assert.ok(Math.abs(db) < 0.15, `moved ${db}`);
    assert.ok(rendered.report.truePeakOutDb < -1);
  });

  it("the low-memory render path matches the full-precision chain for a gain-only master", () => {
    const x = sine(1000, 0.75, 0.25);
    const params = neutralParams();
    params.inputGainDb = -6;
    const expected = renderChain({ l: x, r: x, sampleRate: SR }, params);
    const outL = new Float32Array(x.length);
    const outR = new Float32Array(x.length);
    const report = renderClip(x, x, SR, params, outL, outR);

    let maxError = 0;
    for (let i = 0; i < x.length; i++) {
      maxError = Math.max(maxError, Math.abs((outL[i] ?? 0) - (expected.l[i] ?? 0)));
    }
    assert.ok(maxError < 1e-6, `maximum sample error ${maxError}`);
    assert.ok(Number.isFinite(report.integratedOut));
    assert.equal(outL.length, x.length);
    assert.equal(outR.length, x.length);
  });
});
