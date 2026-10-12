# Named processing snapshots and grouped undo

## Workflow

1. Enter a name in **Named snapshots & A/B**, then **Capture snapshot**.
2. Adjust processing and capture another version. The first two captures are
   assigned to A and B; selectors can change or clear those assignments.
3. **Recall A/B** or a row's **Recall** restores the complete processing settings
   through the established worker/live update paths and selects Processed.
4. Compare with the same monitor setting; use **Match loudness** for audition.
   Export remains the raw processed master, not monitor or loudness-match audio.
5. **Save session** to retain snapshots after refresh. Capturing alone does not
   persist them. Saved sessions remain one local, browser/device-specific record.

This is settings recall, not instantaneous, blind or sample-aligned A/B.
The existing renderer/crossfade behavior and unsupported-live guards still apply.
“Matches controls” indicates parameter equality, not proof that rendering finished.
Wait for the current render before evaluating/exporting the established master.

## Data and safety

- Eight snapshots maximum; names are trimmed, unique ignoring case, 1–80 characters.
- Snapshots contain IDs, names and validated deep copies of processing parameters.
  They contain no audio buffers, transport, monitor, source or target preferences.
- A and B must reference distinct existing IDs. Equal settings under different
  names are allowed; the software does not claim these will sound different.
- Capture, rename, assign and delete affect metadata only. Recalls create ordinary
  undoable DSP changes. Delete requires confirmation and leaves current audio and
  processing untouched; deleting an assigned entry clears that slot.
- New program/demo/calibration audio clears the bank. New references do not.
  Restoring a saved session restores its own bank.
- The optional bank field extends existing version-1 session data. Old sessions
  without it remain compatible; invalid banks fail validation before restore.
  Older application versions can omit the extra field when resaving.
- Undo history remains in-memory only. Named snapshots persist with an explicit
  session save; this is not a multi-project or cloud preset library.

## Grouped gestures

Native module sliders begin a history transaction on pointer/keyboard adjustment.
Values continue through the DSP update path during movement. Pointer release,
cancel, lost capture, key release, blur or unmount finishes the transaction.
One continuous drag or repeated held navigation key produces one undo step.

Net-zero gestures create no step and preserve redo. New nonzero edits invalidate
redo; undo/redo commits pending gestures first. Monotonic ownership tokens prevent
late events from an old slider/source from closing a newer gesture.
Presets, recommendations and snapshot recalls remain independent transactions.

## Compatibility correction

Verified WAV exports now accept the existing validated 8–384 kHz session range,
rather than incorrectly imposing a new 192 kHz cap. Native-rate 384 kHz encoding/
decoding is unit tested. This does not claim native 384 kHz device/browser playback.

## Verification

Pure tests cover deep-copy isolation, metadata-only operations, invalid settings,
bounded capacity, duplicate names/IDs, slot references, legacy session acceptance,
corrupt bank rejection, transaction ownership, net-zero gestures and interrupted
undo. Browser tests compare actual exported PCM on A/B recall and undo, hash both
original source channels, exercise real pointer/held-key grouping, refresh saved
snapshots, rename, cancel/confirm deletion, and check 80-character names on mobile.
Live A/B recall is also measured from actual AudioWorklet output after sufficient
processed frames—not inferred from control state or a fixed wall-clock delay.

Commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`,
`npm run test:browser`. The browser harness also offers `--snapshots-only`.

Further work: blind/level-locked comparisons, standalone preset exchange, multiple
project slots, long-file memory profiling and additional browsers/physical devices.

## Completed verification — 2026-10-12

- **386 automated tests passed**: 197 script, 144 core/workflow/quality and 45
  real-time/worklet tests.
- Strict type checking, lint and production build passed.
- **27 full browser checks passed** through the development proxy, including
  established export/phase/session behavior and the new snapshot workflows.
- Snapshot recalls and undo restored the baseline Float32 WAV samples with
  **zero maximum sample error**; both original channels retained their hashes.
- For a captured **+8.3 dB** setting, real worklet output RMS ratio was
  **2.60003**, versus expected **2.60016**. This is a controlled fixture, not
  subjective listening or independent device certification.
- Saved bank contents/assignments survived refresh; deletion cancel/confirm left
  the active processed audio unchanged. Long names and A/B buttons fit mobile.
- No uncaught browser errors, failed requests or audio uploads in the final run.

Generated evidence remains excluded from Git under `generated-artifacts/`.
