# Live optical glue, center carve and browser verification

## Completed DSP work

The existing Glue and Stereo controls now operate in real-time preview and the
explicit shared-engine WAV path, instead of being rejected. The default Offline
WAV path remains available and unchanged.

- Glue follows the established RMS VCA followed by an optical-style leveler. The
  optical detector has fast and slow release memory; blend 0 keeps just the RMS
  VCA and blend 1 uses the full serial chain. This also corrects the previous
  live VCA-only peak-detector approximation, so those older live prints can differ.
- Center carve filters mid and side around the focus frequency. Center energy
  reduces only the side band; the mid signal is retained. This is not stem/vocal
  extraction and does not distinguish a vocal from other centered instruments.
- State persists across blocks. Threshold, ratio, makeup, optical blend, carve
  depth and frequency changes glide over 25 ms of samples. Carve coefficient
  calculation adds no audio-buffer allocation in its process loop.
- Envelopes/filter states reset on appropriate bypass activation and engine seek/
  reset. Existing module crossfades remain in place.
- No new latency: the engine remains **2686 samples / 56 ms at 48 kHz**.
- More than 16 EQ bands is still explicitly unsupported in live/shared rendering;
  the UI pauses and offers the established offline path rather than dropping bands.

At fixed settings the isolated streaming stages match the established standalone
offline models to better than 1e-12 maximum sample difference on the fixtures.
That is not a claim that the entire default offline chain equals the shared
engine: their FIR/crossover choices retain previously documented differences.
Shared prints are static Processed/Full-range audio without loudness matching;
they do not record parameter automation, audition source, monitor or transport.

## Verification on 2026-10-12

**402 automated tests passed**: 202 script, 144 core/workflow/quality, 56 real-time.
Strict type checking, lint and production build passed.

New tests cover optical memory and carve parity in 1/37/128/1024-sample blocks,
mid preservation, side-only detection, exact zero-depth bypass, finite parameter
movement, block-independent ramps, reset, combined engine processing, original
buffer preservation and unchanged latency.

Existing cold-start worklet/shared-print comparisons at 44.1/48 kHz and all six
phase/channel combinations now include optical blend 0.8 and center carve 0.6.
Background WAV tests include both stages in all three bit depths.

| Browser | Result | Scope |
| --- | --- | --- |
| Chromium 152 | **28 full checks passed** | Real worklet samples/meters, transport, six phase/channel combinations × three formats, new optical/carve controls and WAV samples, stale-print prevention, snapshots, persistence, mobile controls and recovery |
| Hosted Playwright Chromium / Ubuntu | **28 full checks passed** | Same complete suite, including the new live models and matched prints |
| Hosted Firefox 157 / Ubuntu | **28 full checks passed** | Same complete suite; a software PulseAudio sink allows actual headless Web Audio processing |
| Hosted WebKit 27.2 / Ubuntu | **28 full checks passed** | Live models, transport, six phase/channel combinations × three formats, snapshots, storage-denial recovery, mobile controls and strict network audit passed |
| macOS Safari, iOS, physical devices | **Not tested** | Linux WebKit would not certify these devices even if its tests passed |

Chromium measured live gain reduction and nonzero compressed output. New-model
shared Float32 exports matched the engine fixture samples exactly; 16/24-bit
exports matched within quantization/dither tolerances. Source audio stayed intact.
No uncaught browser errors, failed requests or audio uploads in the completed
Chromium, Firefox and WebKit runs. No cancellation exceptions or failed-request
filters were introduced to make the audit pass.

Hosted evidence: [mastering checks](https://github.com/niakofa-cmyk/cinder-glow-pixel-ever/actions/runs/38294645436).
Generated local evidence is excluded from Git. Firefox/WebKit remained unusable
in the Nix container; their functional results above come from hosted Ubuntu,
not from those failed local runtime attempts.

Cross-browser checks exposed and drove fixes for WebKit native range dragging,
explicit one-second PageUp/PageDown seeking, Firefox native form-state
restoration before hydration, and portable storage-denial injection. Transport
tests wait for worklet acknowledgements before a dependent seek.

### Resolved WebKit source-module cancellations

The earlier failed-request audit was investigated rather than waived. New
diagnostics recorded exact error reasons, resource types, check names, request
generation and reload timing. The requests were XHR module loads with WebKit's
`Load request cancelled` error during processing changes, outside page reloads.
The store was terminating the offline worker while its static imports loaded.

The worker now sends a ready handshake only after all imports and its handler
are installed. Requests wait in a startup queue; superseding settings reject
and discard unstarted jobs while preserving module loading. Ready idle workers
are reused. Active computation still terminates on cancellation, and worker
errors force termination and reject pending work. Only the latest surviving
queued work runs; original audio buffers remain copied before transfer.

Regression tests cover deferred dispatch, superseded queued jobs, immediate
dispatch after readiness and prevention of replay. Browser tests still verify
stale-export cancellation and successful retry. The strict failed-request
assertion remains unchanged; the final WebKit report has zero failed requests.

## Reproducible checks and remaining work

```
npm test
npm run typecheck
npm run lint
npm run build
npm run test:browser -- --browser=chromium --chromium=/path/to/chromium --url=https://preview-host
npm run test:browser -- --browser=firefox --url=https://preview-host
npm run test:browser -- --browser=webkit --url=https://preview-host
```

`--live-only` focuses playback/shared-print tests. Reports include browser name
and version. `--library-path=...` optionally supplies runtime library directories
to the browser child only; no Nix paths are hardcoded into the application.
Playwright browsers and matching libraries must be provisioned on the test host.
Temporary browser patches here are test-runtime setup, not application code.

Next: test actual Safari/iOS and other devices, listen for
transition artifacts, measure underruns and device latency, and profile long
recordings and active-chain CPU.

The existing GitHub mastering workflow now has a hosted Ubuntu browser matrix
for Chromium, Firefox and WebKit, with matching Playwright dependencies installed
per job. Core checks run once before the matrix; browser failures do not cancel
the other engines, and each uploads separate fixture evidence. Hosted results
are recorded separately from local totals. Hosted CI uses
`--no-editor-extensions` to replace only the optional external editor script
with an empty response; application console errors remain checked. Synthetic
fixtures only are used; no user music is uploaded.
