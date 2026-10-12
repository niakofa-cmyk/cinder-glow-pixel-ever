# Aurora Audio: Project Reference and Future Work

This document is the project’s durable index for its product mission, source
references, current technical boundaries, and proposed engineering roadmap.
Keep the full reference documents in [`references/`](./references/).

## Product mission

Aurora is an interactive, browser-based audio engineering studio intended to
help people analyze, mix, and master music with clear measurements and
reversible, auditionable processing. It should preserve the musical character
of a performance while helping users reason about tonal balance, dynamics,
masking, stereo coherence, and playback translation.

The product should favor trustworthy audio behavior over marketing claims:

- Controls and visualizations must be connected to real signal processing or
  measured audio data.
- Recommendations should explain the evidence, possible benefit, and tradeoff;
  users retain control and can compare changes.
- Loudness, spectral balance, and width are useful measurements, not universal
  definitions of quality.
- Analog-inspired processing is optional and must be described honestly.
- Preserve source audio and make processing reversible where practical.
- Protect private audio; do not upload recordings or use them for model training
  without the user’s informed authorization.

## Reference documents

These are the supplied source documents. They are preserved verbatim:

1. [Product vision and comprehensive master prompt](./references/audio-product-vision.txt)
2. [DSP and engineering requirements](./references/audio-dsp-engineering-requirements.txt)
3. [Browser PWA architecture contract](./references/browser-pwa-architecture-contract.txt)

The master prompt was resubmitted and verified byte-for-byte on 2026-10-12.
See the [reference integrity index](references/README.md) and
[assessment, completed improvements and remaining scope](MASTER_PROMPT_IMPLEMENTATION.md).

The repository also contains the original product-vision attachment at
[`attachments/pasted-text.txt`](../attachments/pasted-text.txt). The copies in
`docs/references/` make all three current user-provided references easy to find
alongside this roadmap.

## Current implementation boundaries

The app is a client-side PWA with a React/TanStack interface, browser audio
playback, TypeScript DSP and WAV export. Its current foundation includes EQ,
dynamics, saturation, stereo processing, loudness and true-peak analysis,
reference comparison, and worker-backed offline analysis and rendering. Audio
buffers are copied before transfer so source audio remains available for
playback.

The supplied architecture document describes an intended native C++ DSP core,
but the checked-in C++ file is currently a standalone verification/demo program;
it is not connected to the browser app or packaged as a native audio engine.
The browser app should therefore not claim native device integration,
zero-latency professional monitoring, a plugin host, or a guarantee that a mix
will sound identical on unknown speakers and rooms.

Linear-phase processing also has real tradeoffs such as latency and
pre-ringing. Any mode or monitor simulation should document what it actually
does, rather than promising phase-perfect or physical-speaker equivalence.

## Future work

This is a prioritized roadmap, not a claim that these items are already
implemented.

### 1. Complete worker-based offline rendering UX

Local save/restore/delete and maintained browser/CI regression checks have now
been implemented. See [Session and browser checks](SESSION_AND_BROWSER_CHECKS.md)
for controls, privacy/storage limits, commands, coverage, and remaining work.

- **Implemented:** analysis and rendering run through the offline Web Worker;
  source buffers are copied before transfer, and obsolete worker results are
  ignored when newer work replaces them.
- Keep the lower-memory render path where it preserves the requested processing.
  Linear-phase EQ, mid/side EQ, and multiband rendering use the full chain rather
  than substituting different processing. These modes require additional memory;
  allocation failures are reported explicitly while the original remains available.
- Add clear progress, cancellation, and recovery states for long renders.

### 2. Strengthen DSP and export verification

- Expand tests for silence, near-silence, DC offset, unequal channel lengths,
  extreme sample rates, high peaks, limiter behavior, and multiband processing.
- Validate exported WAV headers, encoding, true peak, and sample counts after
  each supported export format.
- **Implemented:** both export paths verify the actual encoded payload before
  download and expose measured before/after quality reports. Stereo spectral
  analysis now includes both channels without mono cancellation.
- Compare browser-rendered measurements with trusted reference implementations
  and document tolerances.
- Profile memory and runtime using long-form and high-sample-rate material
  before raising import limits.

### 3. Improve everyday studio workflow

- **Implemented:** waveform seeking and transport position controls.
- **Implemented:** versioned local project/session save, restore and confirmed
  deletion. Migrations for future session formats remain future work.
- **Implemented:** bounded processing undo/redo, buttons and keyboard shortcuts.
  Named snapshots and drag-gesture grouping remain future work.
- Explain sample-rate conversion and unsupported formats before import/export.
- Keep source, reference, and processed playback states explicit.

### 4. Validate playback translation responsibly

- Add calibrated user-supplied monitor profiles and clearly labeled
  headphone/speaker simulations only when their models are documented.
- Keep mono, correlation, and frequency-dependent stereo checks available.
- Validate translation with listening tests on real playback systems; do not
  treat a filter preset as a physical speaker model.

### 5. Evolve the real-time engine deliberately

- **Implemented:** opt-in AudioWorklet preview and explicit shared-engine WAV
  exports alongside the established renderer. See
  [real-time integration](REALTIME_ENGINE_INTEGRATION.md) for limitations.
  Further callback profiling and allocation reduction remain ongoing work.
- Treat native C++/JUCE or Rust audio-device support as a separate platform
  milestone, with packaging, latency, and licensing decisions documented first.
- Share DSP behavior across engines only after numerical and listening tests
  establish parity.

### 6. Add contextual AI only after measurement is dependable

- Tie recommendations to measured evidence and confidence.
- Generate auditionable alternatives and compare them at matched loudness.
- Keep automated edits reversible and user-approved.
- Evaluate with representative recordings and qualified listening tests before
  describing an automated result as an improvement.

## Development practice

For each future change, record the user-visible behavior, DSP assumptions,
tests run, known limitations, and follow-up work here or in the relevant
technical document. Keep the app runnable, preserve existing project behavior,
and verify the built output as well as the development preview.
