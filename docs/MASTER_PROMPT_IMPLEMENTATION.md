# Master prompt: assessment and implementation

## Reference verification and scope

The latest supplied document is identical to the verbatim
[saved master prompt](references/audio-product-vision.txt). Integrity is recorded in
[the reference index](references/README.md). Its instruction to develop in
verifiable stages is followed; this is not a claim to have completed its entire
mixing/native/AI ecosystem.

The mission's safeguards are appropriate: preserve original audio, measure
real signals, make changes reversible, seek user approval, avoid inferring
instrument identity from a spectrum, distinguish analog-inspired processing
from measured circuit replicas, and never equate a single metric with beauty.
Specific claims of circuit fidelity, universal speaker translation, learned
intelligence or perceptual superiority are not established by this reference.

The application remains React/TanStack/TypeScript/Zustand, browser Web Audio/
AudioWorklet, pure DSP and worker-backed offline processing. No new dependency,
native platform, model provider, database or audio-upload service was introduced.

## Implemented development cycle

### 1. Correct stereo frequency analysis

Previously, `src/dsp/analyze.ts` used only the left channel for Welch spectrum,
third-octave tonal measurements and resonance candidates. This could miss
right-only energy and bias recommendations.

Analysis now averages **channel spectral power**, not the channel waveforms.
That preserves anti-phase energy while retaining correct mono compatibility
measurements separately. Swapping L/R must leave the measured tonal spectrum
unchanged. A shared mono buffer avoids the second FFT.

This is still averaged Welch/third-octave analysis, not instrument recognition,
source separation, an arrangement-aware masking map or a full perceptual model.
Resonance candidates remain contextual suggestions, not diagnoses.

### 2. Verify actual WAV samples before download

Both established offline and shared-engine exports now encode and verify in the
background worker. The established DSP renderer is not replaced. The shared
renderer retains its fixed processed/full-range contract and unsupported-feature
guards.

`src/dsp/export-quality.ts` checks the application's canonical RIFF/WAVE layout,
length, rate, channel count, bit depth, byte rate and block alignment. It reads
the **encoded payload** and verifies sample agreement within bit-depth tolerances.
Corruption, non-finite data and an unintended silent/mismatched payload fail
before download. Integer output at/above 0 dBFS fails with a useful suggestion;
float output can preserve values above unity, with explicit warnings.

Measurements include integrated/momentary/short-term loudness, loudness range,
sample/true peak, RMS, crest factor, stereo correlation, mono fold-down energy,
DC offset and full-scale sample count. Verification uses bounded streaming
meter state and direct payload reads, not a second full-length decoded buffer.
There remains one immutable source copy transferred to the worker.

The quality panel compares original decoded-working-audio measurements with
the actual exported file. Its downloadable JSON contains the selected engine,
format, settings, loudness guideline, measurements, encoding residual, warnings
and limitations. It contains no waveform buffers or uploaded audio.

Source/DSP changes cancel or invalidate an in-flight export. All export controls
share an in-flight lock. Regular exports additionally wait for the current
offline master, not stale audio. Errors do not replace source audio or the master.

Limitations:

- The payload verifier deliberately accepts only our encoder's canonical output,
  not arbitrary external WAV metadata layouts.
- Measurements use the app's BS.1770-style implementation and 4× FIR true-peak
  interpolation; they are not independent standards certification.
- Fewer than 400 ms, silence and gated-out content may yield unavailable
  loudness. JSON uses `null` for those values.
- Integer output includes dither/quantization. Float output may still overload
  a downstream player; technical warnings are not subjective verdicts.
- A transient quality report is cleared when source/DSP settings change.
  Download reports to retain them; they are not a new saved-session format.
- Audio remains decoded Float32 working PCM; original encoded file metadata/
  64-bit source precision preservation remains a separate improvement.
- Peak, mono and DC warnings require context and listening, not automatic fixes.

### 3. Reversible processing

`src/store/parameter-history.ts` provides 100 bounded processing snapshots,
including preset, reset and user-approved recommendation changes. It stores
parameters only, never audio buffers. Undo/redo uses the same worker and live DSP
update path, so reverting changes changes both actual playback and export.

Buttons and Ctrl/Command Z, Shift Z / Ctrl Y shortcuts are available. Text input
is excluded. No-op updates do not rerender or create history. New edits clear redo;
new program/demo/calibration and restored sessions clear old history.

History is session-local and is not persisted. Each accepted parameter update
is a history step; drag gesture grouping and named A/B snapshots remain future
work. Monitoring/source choice and target preferences are not processing history.

## Verification

Maintained tests cover:

- Right-only/swap-invariant spectra at 44.1, 48, 88.2, 96, 176.4 and 192 kHz;
  anti-phase energy preservation and right-channel bass contributions.
- All three WAV formats at those six rates; independently reopened PCM/float
  measurement comparisons, corrupt headers/payloads, non-finite samples,
  clipping, silence, short content, mono cancellation and JSON-safe reports.
- History replay, deep-copy isolation, bounded storage, redo invalidation,
  no-op edits and clear.
- Actual browser WAV samples before/after undo, keyboard redo, report download,
  export cancellation/retry, and comparison with FFmpeg EBU R128 analysis of
  the downloaded calibration file.
- Existing shared-engine phase/channel/format parity, real worklet output,
  sessions, mobile access, error recovery and no audio uploads.

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` and
`npm run test:browser -- --chromium=<installed-browser> --url=<preview-url>`.
Headless/synthetic tests do not prove preferred sound, physical hardware behavior
or complete browser portability.

### Completed verification — 2026-10-12

- **374 automated tests passed**: 197 script tests, 132 core/quality/history tests,
  and 45 real-time/worklet tests.
- Type checking, ESLint and the production build passed.
- **23 full browser checks passed** through the actual proxied preview, including
  real AudioWorklet output, both export routes, sessions and mobile controls.
- Undo restored the baseline exported Float32 samples with **zero maximum error**.
- On the downloaded 24-bit calibration WAV, the app measured **−23.0366 LUFS**
  versus FFmpeg **−23.0 LUFS**; true peak **−23.0000 dBTP** versus FFmpeg
  **−23.0 dBFS true peak**. This is one controlled fixture, not broad certification.
- Six shared-engine phase/channel combinations in three formats retained the
  existing parity checks; maximum integer decoding residual was **0.00004556**.
- No uncaught browser errors, failed requests or audio uploads occurred in the
  completed run. Initial browser fixture-label/HMR interruptions were corrected;
  reported results refer to the final clean run.

Generated evidence is intentionally excluded from Git under `generated-artifacts/`.
Physical devices, subjective listening and Safari/Firefox remain unverified.

## Complete reference coverage and remaining work

| Reference sections | Current coverage | Still incomplete |
|---|---|---|
| 1–2 DSP/analysis | Stereo processing, native-rate PCM import, real/live/offline DSP, stereo Welch/thirds | Resampler workflow, multichannel, multiresolution/harmonic/flux/noise estimation |
| 3–4 sources/masking | Completed stereo-mix analysis and evidence-based findings | Stems, track routing, separation, temporal source competition, musical priorities |
| 5–7 EQ/dynamics/analog | EQ modes/targets, dynamics, limiter, 8× optional analog-inspired saturation | More topology/detector models, validated circuit/IR models, broader live coverage |
| 8 vocals | De-esser/dynamic EQ and reversible suggestions | Source-aware vocal detection, denoising, pitch, phrase automation |
| 9–10 stereo/space | Stereo/mid-side/mono tools and actual mono-loss warnings | Multitrack phase alignment, spatial/reverb/delay engine, calibrated profiles |
| 11–12 mastering/perception | References, loudness-matched audition, chain controls, actual encoded QC | Multiple references, contextual goals, candidate optimization; no universal beauty score |
| 13–15 validation/UX/automation | Matched audition, live meters, export QC, undo/redo, local sessions | Blind comparisons, named A/B snapshots, editable automation, consented feedback |
| 16–18 architecture/tests | Typed modular DSP, workers, maintained numerical/browser tests | Wider browsers/devices, native integration, measured long-session budgets |
| 19–20 staged delivery | Working browser foundation and explicit technical limitations | Representative music, qualified listening, independent certification |
| Additional sonic intelligence | Measured facts and heuristic proposals, user-controlled application | Learned context, iterative draft mixes and calibrated translation laboratory |

## Next priorities

1. Persist named processing A/B snapshots and group parameter drags into single
   undo transactions without changing DSP or source buffers.
2. Profile long/high-rate files and verification runtime/memory before changing
   supported limits; verify Safari/Firefox, interruptions and real devices.
3. Extend supported live optical/center processing only after golden signal tests.
4. Add multitrack/stem routing as a distinct milestone before source-aware masking.
5. Introduce contextual learned recommendations only with model/license/privacy
   review, confidence calibration, controlled listening and explicit approval.
