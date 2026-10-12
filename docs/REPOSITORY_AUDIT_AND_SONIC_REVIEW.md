# Repository audit and measured sonic review

## Reference and scope

The supplied [Cinder Glow audit/roadmap](references/cinder-glow-repository-audit-roadmap.txt)
is preserved unchanged; byte comparison and SHA-256 match are recorded in the
[reference index](references/README.md). Its author explicitly could not inspect
source code. Repository directory names and historical commit counts do not
establish working capabilities. This assessment uses the current source and
tests, not those inferred capabilities.

This repository's studio is branded Aurora. This work preserves that identity,
architecture, source audio, processing semantics, privacy and public Git history.
It implements a bounded next stage of the roadmap, not every proposed system.

## 1. Implementation audit

| Roadmap requirement | Current evidence and status |
| --- | --- |
| Real audio import, EQ, dynamics, limiting and WAV export | Implemented in `src/components/studio/Studio.tsx`, `src/dsp/chain.ts`, `src/dsp/render-clip.ts` and `src/dsp/rt/`. Existing numerical/browser tests cover processing and exports. |
| Browser vs server vs native engine | Audio processing is local browser TypeScript/Web Worker/AudioWorklet. `engine/aurora_node.cpp` is a standalone demo/verification program, not a browser-linked native engine. `server/` does not establish a server-side audio service. |
| Source preservation and reversible edits | Copies before worker transfer, undo/redo, named A/B snapshots and local session storage are implemented. Export invalidation/cancellation prevents stale settings from silently printing. |
| Loudness and peak measurements | Integrated, momentary and short-term maxima, LRA and FIR true peak are implemented. Browser calibration export checks compare actual WAV measurements with FFmpeg; this is not full independent standards certification. |
| Stereo and tonal analysis | Both-channel power spectrum, correlation, mid/side energy and resonances are implemented. Mono audition and reference spectral comparison are available. Whole-track summaries can miss local problems. |
| Loudness-matched listening | Implemented audition setting and original/processed/reference choices. Shared print deliberately excludes audition gain, monitoring and transport automation. |
| Intelligence and recommendation provenance | `src/dsp/suggest.ts` uses deterministic measured rules, evidence, confidence, tradeoffs and user-approved parameter patches. No trained source classifier or LLM inference is used in this path. |
| Leaving healthy material alone | Existing listen-only “No obvious technical fault” finding; now exact/floored silence and unavailable loudness have explicit explanations instead of a generic no-fault statement. No mathematical rating of musical quality. |
| Testing recommendations after processing | Actual encoded WAV measurements and before/after tables already existed. **Added here:** reproducible technical tradeoff checks and explanations in UI and JSON. |
| Identifying vocal masking in specific choruses | Missing. A stereo master cannot reliably identify isolated guitars/vocals from these whole-track heuristics. Center carve/de-essing are signal operations, not semantic source identification. |
| Automated multitrack mixing | Missing. The current source/reference model is stereo mastering, not independent stem routing, stem automation or instrument-specific correction. |
| Trained Sonic Intelligence assistant | Future work. Requires labeled evaluation material, clear model/provenance boundaries, consent for any uploads and reversible user-approved edits. |
| Long-song, device and speaker quality | Import limit remains 12 minutes, not a measured worst-case hardware guarantee. Long-session/high-rate profiling and physical listening/Safari/iOS remain necessary. Filter monitors are not calibrated speaker equivalence. |

The app is a functional audio application with measurement-backed assistance.
It is not merely a visual prototype, but it does not yet deliver the complete
contextual, multitrack intelligence described as “Level 3” in the reference.

## 2. Code and architecture assessment

- `src/store/session.ts` owns worker jobs, settings, stale-result guards and
  reversible workflow. Preserve the distinction between queued startup
  cancellation and termination of active computation.
- `src/dsp/offline.worker.ts` handles analysis/render/export away from the UI.
  `src/dsp/rt/` owns real-time processing; keep shared-export parity explicit.
- `src/dsp/analyze.ts` and `suggest.ts` separate measurements from recommendations.
  They do not infer instrument identity, musical intent or section boundaries.
- `src/dsp/export-quality.ts` reads actual encoded samples and verifies headers,
  frame counts and encoding error. Reviews must use those measurements, not
  forecasts from settings or an unverified intermediate buffer.
- `src/components/studio/ExportQualityPanel.tsx` now integrates the review and
  downloads the same evidence. Existing before/after values are preserved.
- `scripts/browser/document-checks.mjs` verifies UI/report agreement and mobile
  fit in the maintained browser suite; `scripts/processing-review.test.mjs`
  covers rules, missing data and actual 16/24/32-bit payload measurements.
- The GitHub workflow runs core checks before Chromium/Firefox/WebKit checks.
  Passing CI is not a listening test or proof of performance on every device.
- No dependency, authentication, database or deployment-platform migration was
  needed. `npm audit --omit=dev --json` reported zero known advisories in
  production dependencies. This is a registry advisory check, not a fresh full
  source/dataflow security audit, a development-dependency audit or certification.

## 3. Implemented audio-engineering improvement

`src/dsp/processing-review.ts` produces a versioned deterministic review:

1. Full-scale sample headroom (including 32-float outputs above full scale).
2. True peak relative to the captured limiter ceiling, with an explicit
   0.15 dB review tolerance; a disabled limiter does not hide the guideline.
3. Peak change from the original, highlighting increased peak risk.
4. Crest-factor reduction of at least 3 dB as an intentional-or-unintentional
   dynamics tradeoff, not an automatic failure.
5. Negative output correlation, or a drop of at least 0.1 into correlation
   below 0.2, as a reason to audition mono.
6. An increase greater than 1 LU in distance from the optional selected loudness
   guideline; moving closer is described, not rated as an artistic improvement.

Each check includes readable evidence. JSON includes thresholds and captured
guidelines so another developer can reproduce the decision. These thresholds
are practical review rules, not claimed psychoacoustic or platform standards.

Missing/non-finite values become unavailable checks, not zero or a false green
result. Attention takes precedence when an available measurement raises a flag;
otherwise incomplete comparison is marked unavailable. No-new-flags means only
that these checks raised no additional flags. It does not certify sound quality.

The review never applies settings, prevents an export or chooses an artistic
result. Audition original/processed at matched loudness, and keep intentional
tradeoffs when they serve the music. Original clipping is not repaired merely
because export peaks fall below a ceiling.

Silence handling accounts for the analyzer's finite -240 dB floor. Below-gate
loudness is explained independently of other measurable findings. The audio
algorithms, linear-EQ latency, sample-rate policy and two export paths are unchanged.

## 4. Prioritized future improvements

| Priority | Work | Dependency / benefit / difficulty |
| --- | --- | --- |
| Next | Long-session CPU/memory, high-rate and repeated-setting benchmarks; engine/device health diagnostics | Builds on current worker/RT engines. Establish bounded behavior before higher import limits; medium difficulty, environment-dependent timing. |
| Next | Section-aware measured analysis with timeline evidence | Requires worker progress/cancellation and tests for window alignment/gating. Reveals local dynamics, stereo and tonal problems; medium/high difficulty. |
| Then | Auditionable alternatives with matched-level comparison and review per candidate | Reuse named snapshots and current review. Do not replace existing customized bands unintentionally; medium difficulty. |
| Then | Trusted reference fixtures and controlled physical-device/listening validation | Requires rights-cleared material, reference tools and real hardware. Establish objective tolerances and subjective preferences separately. |
| Later | Stem-aware routing and masking analysis | New multitrack data model, synchronized playback, independent routing, persistence and export semantics first; high difficulty. |
| Later | Validated trained classifiers or assistant models | Depends on appropriate recordings/labels, section/stem context and evaluation. Report uncertainty and require consent before external audio processing. |
| Separate milestone | Native engine/plugin or calibrated device integration | Packaging, licensing, platform support and numerical parity decisions first. Do not silently replace the browser engine. |

Future quality work should measure regressions without a universal “best sound”
score. Dependency/security review and production operational checks are distinct
workstreams; do not infer them from successful DSP tests.

## 5. Repository-specific development prompt

> Improve the existing Aurora studio in cinder-glow-pixel-ever incrementally.
> Read docs/PROJECT_REFERENCE_AND_ROADMAP.md, docs/references/README.md and the
> relevant implementation/verification documents first. Inspect actual source
> before treating a roadmap capability as implemented.
>
> Preserve native-rate source audio, copied worker transfers, startup readiness,
> active-job cancellation, stale-result rejection, undo/redo, named snapshots and
> local-session recovery. Preserve the explicit established and shared export
> choices. Any new live DSP mode must be verified against the actual shared print
> at aligned samples and fixed settings, including mid/side and phase modes.
>
> Keep deterministic signal processing and measured evidence separate from
> model-based interpretation. Extend src/dsp/analyze.ts, suggest.ts and
> processing-review.ts only with documented assumptions and unavailable-value
> handling. Never describe correlation, loudness or spectral balance as proof of
> musical quality, and never claim instrument identity from a generic band.
>
> Every recommendation needs evidence, confidence, an explicit tradeoff and a
> reversible, user-approved audition. Do not overwrite unrelated custom settings.
> Use actual encoded measurements from export-quality.ts for output checks.
> Preserve review provenance in UI and downloadable JSON. Never upload private
> recordings or train on them without informed authorization.
>
> Verify source preservation, settings-to-output behavior, numerical boundaries,
> supported WAV formats, error/retry paths, missing data and mobile accessibility.
> Run npm test, npm run typecheck, npm run lint, npm run build and the maintained
> browser suite. Keep network/console/audio-upload audits strict. Store generated
> evidence outside Git, document limitations and avoid hardware claims without
> physical-device testing. Publish only scoped changes on fresh remote history;
> do not force-push workspace checkpoints over public main.

## Verification

- Full automated test suite: 416 tests (216 script, 144 core/workflow, 56 RT).
- Type checking, lint and production build passed.
- Chromium through the actual Replit proxy: all 28 checks passed, including
  review/report agreement, phone layout, actual encoded measurements, existing
  live/export mode parity and no uncaught errors/failed requests/audio uploads.
- Hosted Chromium, Firefox and WebKit each passed all 28 checks, including the
  named accessible review region, report evidence agreement, phone layout and
  strict console/network/audio-upload audit.
  [Passing hosted run](https://github.com/niakofa-cmyk/cinder-glow-pixel-ever/actions/runs/38301345353).
- Production dependency advisory check reported zero known vulnerabilities;
  source/dataflow scans and development dependencies were not included.
- No physical listening, Apple device certification, representative musical
  classifier evaluation or long-session hardware performance claim is made.
