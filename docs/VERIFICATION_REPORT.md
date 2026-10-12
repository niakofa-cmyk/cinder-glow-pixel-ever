# Aurora functional verification

Verified on 2026-10-12 using Chromium/Playwright through Replit's development
proxy, plus the project's automated tests, type checking, lint, and production
build. This report covers the verified mastering fixes; browser automation and
local session persistence are documented separately as they are added.

## Real-browser results

- **Preview:** the proxied page loads successfully; the demo analysis and render
  complete and export controls become enabled.
- **Import:** a generated six-second, stereo, 48 kHz PCM WAV imports with exactly
  288,000 frames per channel. A same-rate reference populates tonal comparison.
- **Playback:** Original, Processed, and Reference each start a real Web Audio
  source containing nonzero samples. The AudioContext runs and its clock advances.
- **Monitoring:** full-range, mono, and small-speaker playback work; loudness
  matching can be toggled and restored.
- **Processing:** rapid input-gain changes settle on the last requested setting.
  Glue can be enabled and the chain reset.
- **Export:** 16-bit PCM, 24-bit PCM, and 32-bit float downloads contain valid
  RIFF/WAVE audio, two channels, 48 kHz, and exactly 288,000 frames. All samples
  are finite. With +12 dB input gain, exported RMS increases by approximately
  3.98107 times, as expected, without clipping this fixture.
- **EQ fidelity:** minimum-phase and linear-phase exports now have different
  samples while comparable RMS is preserved. Mid-only EQ preserves the side
  component and side-only EQ preserves the mid component, with maximum observed
  error below 2e-9 on the test fixture.
- **Errors and recovery:** a 44.1 kHz reference against a 48 kHz program displays
  an actionable mismatch and clears the busy state. Malformed audio displays
  WAV conversion guidance without replacing the current valid program. Loading
  valid audio afterward restores normal operation.
- **Other formats:** generated MP3 and FLAC files import and render successfully.
  PCM AIFF is not decoded in the tested Chromium browser; it displays conversion
  guidance. The UI now explains browser-dependent format support instead of
  promising universal AIFF support.
- **Mobile:** at 390 × 844, the document has no horizontal overflow and playback
  and all export controls remain within the viewport.
- **Runtime:** no uncaught page errors or failed application/worker requests
  occurred in the completed checks.

## Issues found and corrected

1. Preview host rejection: the development server now accepts Replit proxy hosts.
2. Rejected references left the reading indicator active: failure paths now clear it.
3. The low-memory path substituted minimum-phase/stereo EQ and minimum-phase
   crossovers for requested alternatives. Offline rendering now chooses the full
   chain for linear-phase EQ, mid/side EQ, and multiband, keeping the low-memory
   path for modes it implements faithfully. Four DSP regression tests cover
   this routing and the resulting audio.
4. Import guidance overstated browser-independent format support.

## Engineering checks

- 197 script tests and 94 TypeScript tests: **291 total**.
- Type checking, lint, and production build.
- The build reports dependency bundler warnings about `use client` directives;
  these are warnings, not build failures.

## Limits of this verification

This is functional and numerical verification, not a listening-panel evaluation
or a guarantee of professionally optimal mastering. It does not establish
compatibility with every browser, audio interface, speaker, codec, or mobile
device. Long-form/high-sample-rate memory and performance limits remain to be
benchmarked. Full-chain modes allocate more memory and must report allocation
failures rather than silently change the selected processing. Sessions are
in-memory; persistence across reloads was not verified or added.
