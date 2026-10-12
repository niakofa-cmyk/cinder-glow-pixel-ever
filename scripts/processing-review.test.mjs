import assert from "node:assert/strict";
import { it } from "node:test";
import { reviewProcessing } from "../src/dsp/processing-review.ts";
import { analyze } from "../src/dsp/analyze.ts";
import { encodeVerifiedWav } from "../src/dsp/export-quality.ts";
import { suggest } from "../src/dsp/suggest.ts";

const base = {
  integratedLufs: -14, truePeakDb: -2, samplePeakDb: -2.5,
  crestDb: 12, correlation: 0.8, rmsDb: -14.5,
};
const options = { targetLufs: -14, ceilingDb: -1 };
const check = (review, id) => review.checks.find(c => c.id === id);

it("unchanged complete measurements are not described as an artistic improvement", () => {
  const review = reviewProcessing(base, base, options);
  assert.equal(review.status, "no-new-flags");
  assert.equal(review.checks.length, 6);
  assert.match(review.limitations.join(" "), /not a trained AI model/);
  assert.equal(review.criteria.crestDropDb, 3);
  assert.deepEqual(reviewProcessing(base, base, options), review);
});
it("flags reduced crest factor without treating intentional compression as failure", () => {
  const review = reviewProcessing(base, { ...base, crestDb: 8 }, options);
  assert.equal(check(review, "crest-change").level, "attention");
  assert.match(check(review, "crest-change").evidence, /may be intentional/);
  assert.equal(review.status, "attention");
});
it("flags worsened low correlation and negative output correlation", () => {
  assert.equal(check(reviewProcessing(base, { ...base, correlation: 0.1 }, options), "stereo-change").level, "attention");
  assert.equal(check(reviewProcessing({ ...base, correlation: -0.5 }, { ...base, correlation: -0.3 }, options), "stereo-change").level, "attention");
  assert.equal(check(reviewProcessing(base, { ...base, correlation: 0.5 }, options), "stereo-change").level, "info");
});
it("flags full-scale samples and peak overshoot using the selected ceiling", () => {
  const out = { ...base, truePeakDb: -0.4, samplePeakDb: 0 };
  const review = reviewProcessing(base, out, options);
  assert.equal(check(review, "full-scale").level, "attention");
  assert.equal(check(review, "peak-guideline").level, "attention");
  assert.equal(check(review, "peak-change").level, "attention");
  assert.equal(check(reviewProcessing(base, { ...base, truePeakDb: -0.9 }, options), "peak-guideline").level, "info");
  assert.equal(check(reviewProcessing(base, base, { ...options, ceilingDb: -3 }), "peak-guideline").level, "attention");
});
it("reports movement toward the loudness guideline without claiming better sound", () => {
  const review = reviewProcessing({ ...base, integratedLufs: -19 }, base, options);
  assert.equal(check(review, "loudness-target").level, "info");
  assert.match(check(review, "loudness-target").evidence, /decreased/);
  assert.match(check(review, "loudness-target").evidence, /not necessarily better/);
});
it("flags moving farther from a chosen loudness guideline", () => {
  assert.equal(check(reviewProcessing(base, { ...base, integratedLufs: -9 }, options), "loudness-target").level, "attention");
  assert.equal(check(reviewProcessing(base, { ...base, integratedLufs: -14.8 }, options), "loudness-target").level, "info");
});
it("does not invent a successful comparison when source measurements are missing", () => {
  const review = reviewProcessing(null, base, options);
  assert.equal(review.status, "unavailable");
  assert.equal(check(review, "crest-change").level, "unavailable");
  assert.equal(check(review, "peak-guideline").level, "info");
});
it("handles silence and non-finite measurements without printing NaN or Infinity", () => {
  const out = Object.fromEntries(Object.keys(base).map(key => [key, key === "correlation" ? NaN : -Infinity]));
  const review = reviewProcessing(base, out, options);
  assert.equal(review.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(review), /NaN|Infinity/);
  assert.equal(review.checks.every(c => c.level === "unavailable"), true);
  assert.equal(check(reviewProcessing(base, { ...base, correlation: 0 }, options), "stereo-change").level, "attention");
});
it("rejects non-finite review guidelines", () => {
  assert.throws(() => reviewProcessing(base, base, { ...options, targetLufs: NaN }), /finite/);
  assert.throws(() => reviewProcessing(base, base, { ...options, ceilingDb: Infinity }), /finite/);
});
for (const bits of [16, 24, 32]) {
  it(`compares real source measurements against actual ${bits}-bit encoded samples`, () => {
    const sampleRate = 48000;
    const l = Float32Array.from({ length: sampleRate }, (_, i) => 0.15 * Math.sin(2 * Math.PI * 997 * i / sampleRate));
    const r = new Float32Array(l);
    const original = analyze(l, r, sampleRate);
    const gained = { l: l.map(x => x * 2), r: r.map(x => x * 2), sampleRate };
    const { quality } = encodeVerifiedWav(gained, bits, "shared");
    const review = reviewProcessing(original, quality.measurements, { targetLufs: original.integratedLufs, ceilingDb: -1 });
    assert.equal(check(review, "loudness-target").level, "attention");
    assert.equal(check(review, "crest-change").level, "info");
    assert.ok(Math.abs(quality.measurements.integratedLufs - original.integratedLufs - 6.0206) < 0.02);
    assert.match(check(review, "loudness-target").evidence, /increased/);
  });
}
it("silent source does not recommend narrowing or claim no technical fault", () => {
  const silent = new Float32Array(48000);
  const findings = suggest(analyze(silent, silent, 48000));
  assert.deepEqual(findings.map(f => f.id), ["silent"]);
  assert.equal(findings[0].patch, null);
});
it("below-gate audio explains missing loudness without recommending gain", () => {
  const quiet = Float32Array.from({ length: 48000 }, (_, i) => 1e-6 * Math.sin(2 * Math.PI * 440 * i / 48000));
  const findings = suggest(analyze(quiet, quiet, 48000));
  assert.ok(findings.some(f => f.id === "loudness-unavailable" && f.patch === null));
  assert.equal(findings.some(f => f.id === "quiet" || f.id === "clear"), false);
});
