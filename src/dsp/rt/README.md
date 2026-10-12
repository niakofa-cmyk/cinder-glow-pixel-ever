# Aurora real-time engine

`engine.ts` is the live-preview DSP; `worklet.ts` is its AudioWorklet shell; `transport.ts` owns position and tail flushing; `client.ts` is the main-thread handle. **Shared-engine WAV** in the Live preview panel prints this DSP through a background worker. The footer's **Offline WAV** buttons retain the established renderer. See `docs/REALTIME_ENGINE_INTEGRATION.md`.

Shared prints use fixed current settings, processed program audio, full-range stereo monitoring, no loudness-match gain, and Float32 output with DSP latency removed. They do not record edits, looping, seeking or pauses. Compare fresh playback at the same fixed settings; use 32-float for sample comparisons. Integer formats add dither/quantization and reject output at/above 0 dBFS. Unsupported DSP fails explicitly.

## Guarantees (each has a test)
- Block-size invariance: 37, 128 and 1024-sample blocks give the same samples (< 1e-9).
- Shared-module parity: minimum-phase EQ, dynamic EQ, de-esser and width match the established offline path (< 1e-7); enhanced 8× tape/tube/hybrid saturation matches after alignment (< 1e-6). This does not establish full-chain parity with that offline renderer. Shared-engine export uses the live DSP instead.
- True-peak limiter holds the ceiling at every lookahead (1 to 10 ms), including a 11 kHz inter-sample case.
- Fixed latency (2686 samples at 48 kHz = 56 ms: 2048 for the linear-phase FIR, 128 hop, 494 limiter, 16 oversampler), whatever is on or off. Original, processed and reference stay sample-aligned; module toggles never shift the timeline.
- BS.1770 loudness: −23.0 LUFS on the EBU 3341 tone; integrated within 0.15 LU of the offline meter.
- Pause fades over exactly four quanta and resumes on the next sample; the end of file flushes the engine tail.
- NaN/Inf input is sanitised and the engine clears its own state.
- No per-sample allocation. Moving an EQ or crossover knob redesigns filters each block, which allocates a few small objects. Full chain measured at about 12% of one core (about 8× real time) in Node.

## Known limits
- Optical glue now runs the same RMS VCA → two-speed optical-memory topology as the established offline model; center carve preserves mid while center energy ducks its side band. Both are stateful, sample-ramped and add no latency. These are analog-inspired models, not circuit emulation or vocal isolation.
- Linear-phase EQ is a 4096-tap FIR (about 11.7 Hz resolution at 48 kHz), so very low corners such as a 28 Hz high-pass are only approximated. Set `LIN_TAPS` in `linear-eq.ts` to trade resolution for latency. It matches the offline forward-backward mode to about −35 dB error on noise, and is symmetric about its delay (no phase shift).
- Minimum/linear switching is a 15 ms crossfade between two aligned signals, after one warm-up hop.
- Saturation shares the application's enhanced 8× tape/tube/hybrid processor, including memory and color controls. Updates warm the new stream and crossfade over 12 ms. These are analog-inspired DSP models, not verified circuit replicas.
- Existing EQ parameters glide at block rate (about 25 ms). Optical blend, glue threshold/ratio/makeup and carve depth/frequency use 25 ms sample-counted ramps. Carve coefficients update numerically during frequency movement without allocating audio buffers.
- Not yet measured on a real device or in Safari/Firefox. Run it and listen.

See `docs/LIVE_GLUE_CARVE_AND_BROWSER_VERIFICATION.md` for numerical tests,
the browser matrix and currently blocked Firefox/WebKit checks.
