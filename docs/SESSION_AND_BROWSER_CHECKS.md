# Local sessions and browser regression checks

## Session controls

Aurora keeps **one saved session per browser origin** in IndexedDB. Audio is
stored locally, not sent to a server. The save includes the program, optional
reference, their native sample rates, all processing settings, selected source
and monitor, loudness matching, loudness target, and selected module.

- **Save session:** save the current session. Replacing an existing save requires
  confirmation. Wait for processing to finish before saving.
- **Refresh/reopen:** automatically restore the last successful save and
  remeasure/rerender it using the current DSP implementation.
- **Restore session:** after confirmation, replace the open session with the
  saved version. Unsaved changes are discarded; playback is stopped.
- **Delete saved session:** after confirmation, remove the stored copy without
  closing or changing the current audio.

This is explicit saving, **not continuous autosave**. Changes made after saving
are not restored. It is not cloud backup or cross-device sync. Clearing browser
site data, changing the app's origin/URL, private browsing, or storage eviction
can make a save unavailable. Export important masters and retain source files.
Multiple tabs share the same save; the last successful save replaces it.

Stored data uses a versioned schema. Invalid versions, malformed/nonfinite audio,
unsafe processing settings, and incompatible reference sample rates are rejected
with recovery guidance. Database transactions must complete before success is
shown. Quota/storage failures leave active audio open; failed replacements do not
remove the previous save. If startup storage is unavailable or invalid, the demo
opens with a visible error rather than pretending restoration succeeded.

## Running checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

For the browser suite, install the Playwright Chromium browser and ensure
`ffmpeg` is available. Start the development app on port 5000, then run:

```sh
npm run dev -- --port 5000
# In another terminal:
npm run test:browser
```

The default browser-test URL is `http://127.0.0.1:5000`. To check Replit's actual
proxy and use its installed Chromium:

```sh
npm run test:browser -- \
  --url="https://$REPLIT_DEV_DOMAIN" \
  --chromium=/repl/tools/bin/chromium
```

Portable overrides are also supported through `E2E_BASE_URL` and
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Otherwise Playwright uses its installed
browser. Tests need no account credentials, API tokens, or real user audio.

## Coverage and verified results

The maintained browser suite has **15 checks** covering:

- Preview/demo startup, WAV program/reference import.
- Real AudioContext playback and clock advancement for each source.
- Mono sample folding, small-speaker filter frequencies, and actual gain
  behavior with loudness matching on/off.
- Rapid parameter changes and last-setting-wins rendering.
- Finite, correctly formatted 16/24-bit PCM and 32-bit float exports with
  expected frame count, channels, native rate, and numerical gain.
- Phase-sensitive export comparison and mid/side isolation.
- Invalid imports, sample-rate mismatch, recovery, MP3/FLAC and explicit
  unsupported-AIFF behavior.
- Save/reload of a native 44.1 kHz program and reference, settings, and
  byte-equivalent sample values in the rerendered float export.
- Manual restore, overwrite consent, delete consent, and unchanged active
  audio after deletion.
- Simulated quota denial with previous-save preservation; incompatible
  record deletion/replacement; unavailable storage with explicit error.
- Mobile session/playback/export controls, no uncaught browser errors,
  failed requests, or audio upload requests.

All 15 passed against Replit's proxy. Six additional snapshot-validation tests
bring the automated test total to **297** (197 script tests and 100 TypeScript
tests). These checks do not assess subjective mastering quality, every browser,
or long-file/high-sample-rate performance.

## GitHub automation

`.github/workflows/mastering-checks.yml` runs on pushes to `main` and pull
requests. It installs Chromium/codec tooling, runs the engineering checks,
starts the app, and runs the browser suite. No write permissions or credentials
are required by the workflow.

Reports, generated fixtures, server logs, and screenshots are written to
`generated-artifacts/`, which is excluded from Git and Replit publishing. GitHub
retains browser evidence for seven days. A failed check exits nonzero and saves
a failure screenshot.

## Remaining work

- Benchmark long sessions and high sample rates on memory-constrained devices.
- Test additional browser engines and actual audio interfaces.
- Consider user-named multiple saves, storage-usage reporting, and portable
  session archives. Keep cloud audio storage an explicit opt-in if introduced.
