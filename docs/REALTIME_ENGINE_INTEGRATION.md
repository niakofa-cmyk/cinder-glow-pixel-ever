# Real-time engine integration

## Supplied references

Reviewed the pasted AudioWorklet description, the `aurora-realtime-engine` unified patch,
and its ZIP source snapshot. The ZIP supplied additive real-time DSP modules and a
live-meter component. Existing Studio, store, saturation, and true-peak files were
compared rather than replaced.

The pasted note describes a roughly 10.6 ms engine without real-time linear-phase EQ.
The actual source is newer: it includes a 4096-tap partitioned FIR EQ with fixed
alignment latency. At 48 kHz the browser reports **2686 samples / 55.96 ms of DSP
latency**. Audio-device and browser buffering add further latency.

The supplied CPU/faster-rendering figures are not established benchmarks for this
integration and should not be repeated as measured results.

## What was integrated

- Opt-in **Live preview** using an AudioWorklet, without main-thread audio processing.
- Immediate parameter updates; original/processed/reference selection and monitor modes.
- Live loudness, true-peak, gain-reduction, correlation, and spectrum displays.
- Pause/resume, an accessible seek control, latency display, and meter reset.
- Streaming limiter, transport, FIR linear-phase EQ, and block-oriented DSP.
- Existing enhanced **8× saturation**, including tape/tube/hybrid, memory and color.
  Saturator updates warm the new aligned stream and crossfade rather than resetting
  the audible processor in place.
- Both crossover and EQ smoothers advance all changed parameters in the same block;
  the supplied short-circuit expressions postponed later parameter updates.
- Removed references are cleared from the worklet, and processor failures surface
  visibly. Unsupported controls pause rather than silently disappear.

## Preserved behavior and fidelity limits

Local IndexedDB Save/Restore/Delete, native-rate WAV imports, background worker
analysis/rendering, immutable Float32 source clips, and existing WAV exports remain.
**Rendered playback is the default and is the exact audition path for offline exports.**

Live preview and export are intentionally distinct:

| Feature | Live preview | Rendered playback / export |
| --- | --- | --- |
| Minimum-phase EQ and channel selection | Streaming | Established offline path |
| Linear-phase EQ | Finite 4096-tap FIR approximation | Existing forward/backward processing |
| Multiband crossovers | Causal streaming crossovers | Existing offline crossovers |
| Saturation | Shared enhanced 8× model | Shared enhanced 8× model |
| Optical glue / center carve | Pauses with an explanation | Supported |
| More than 16 EQ bands | Explicitly rejected | Existing offline support |

Capability checks are shared by the UI and engine. No silent fallback to a different
DSP mode is permitted. Live preview is transient, not a saved-session sound setting.
Do not claim live/export sample equality for the entire chain.

## Verification

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and
`npm run test:browser`. `npm run test:realtime` isolates the streaming tests.
Use `--live-only` with the browser runner to diagnose the live checks without
repeating the entire suite.

Streaming tests cover shared-module numerical parity, all saturation modes, limiter
ceiling at multiple lookaheads, BS.1770 measurements, source alignment/crossfades,
block invariance, non-finite recovery, FIR behavior, transport and worklet messages.
Browser checks read **actual AudioWorklet output samples through analysers**, not
only UI labels. They exercise gain changes during playback, mono output, live meter
packets, pause/seek/resume, and unsupported-control handling through the real UI.
The regular import/export and session regression checks still run in CI.

Headless Chromium verifies operation, not perceived quality, hardware latency,
dropout-free playback on every device, or Safari/Firefox support.

## Future work

1. Implement streaming optical glue and center carve, with independent signal tests.
2. Reconcile FIR/crossover semantics before making a shared-engine export option
   available. Require golden-output, channel/phase, ceiling and tail-length tests;
   do not replace the proven default offline renderer based on UI parity.
3. Test headphones, speakers, mobile devices, Safari and Firefox; measure end-to-end
   latency and underruns at representative rates and clip lengths.
4. Profile CPU and allocation costs with realistic active chains before claiming
   performance gains, and validate loudness/true-peak against independent tools.
5. Conduct level-matched listening comparisons; measurements alone cannot establish
   that the result sounds more musical.
