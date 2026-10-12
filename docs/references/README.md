# Preserved user references

These texts are preserved verbatim; they are product specifications, not proof
that every proposed feature is implemented.

- [Master prompt / product vision](audio-product-vision.txt)
- [DSP engineering requirements](audio-dsp-engineering-requirements.txt)
- [Browser PWA architecture contract](browser-pwa-architecture-contract.txt)
- [Cinder Glow repository audit and roadmap](cinder-glow-repository-audit-roadmap.txt)
- [AudioWorklet, Wasm and SIMD engineering notes](audio-performance-engineering-notes.txt)

## Performance notes intake verification — 2026-10-12

Preserved unchanged, 2,132 bytes, SHA-256:

```text
499ed0b2b8378a35df191d0a1017fd21ee5c46677a98a224e3d4f3f81d2f0081
```

Current source assessment:

- `src/dsp/rt/worklet.ts` already registers an AudioWorklet processor; the client
  loads it for live preview. The processor reuses allocated channel buffers.
  This does not prove the entire callback is allocation-free or meets every
  hardware deadline.
- `engine/aurora_node.cpp` is a small biquad/waveshaper demonstration with a
  test-style `main`, not the complete mastering chain. No active Wasm/Emscripten
  integration was found in the inspected DSP/engine/build sources.
- SIMD lane counts do not establish a 75% CPU saving or four complete DSP
  samples per clock. Stateful filters, transcendental operations, precision,
  memory transfers and browser/device behavior must be measured.
- JavaScript buffers do not automatically become raw pointers into Wasm
  memory. A zero-copy design requires compatible views backed by the module's
  linear memory and an explicit ownership/lifetime contract.

Recommended next step: reproducible profiling of the existing chain before an
isolated Wasm/SIMD experiment, with numerical fidelity and live/export parity
gates. Preserve the current TypeScript engine until measured evidence justifies
an alternative; do not substitute the demonstration for production DSP.

## Repository audit intake verification — 2026-10-12

The supplied audit/roadmap is preserved unchanged, 13,119 bytes, SHA-256:

```text
9941c2788f37e2c742708063ea9f61937775355ba5c70baaf9241209f36d508f
```

The preserved source explicitly says its author could not inspect individual
source files. Its repository-layout observations and six-commit count are
historical observations, not a current verification result. Its suggestions to
connect GitHub or upload another ZIP are not necessary for this workspace.
See the [current code assessment, implemented changes and development prompt](../REPOSITORY_AUDIT_AND_SONIC_REVIEW.md).

## Master prompt intake verification — 2026-10-12

The resubmitted master prompt matches the already preserved product vision
byte-for-byte. Both files contain 56,496 bytes and have SHA-256:

```text
c2764018c1ca7b4b3efcea4f8eb0374b455fa3f5a2a8176e11589e6682f0de0d
```

No duplicate or rewritten reference was substituted. The engineering assessment,
implemented improvements, known limits and next stages are tracked in
[Master prompt implementation](../MASTER_PROMPT_IMPLEMENTATION.md) and the
[project roadmap](../PROJECT_REFERENCE_AND_ROADMAP.md).
