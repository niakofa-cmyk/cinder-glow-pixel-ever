# Repeatable engine performance benchmark

## Run it

```sh
npm run bench:engine
```

Requires the project's Node 24 runtime, with no new dependencies or native
compiler. The command enables explicit garbage collection for comparable
before/after memory snapshots. It does not modify the app's DSP.

Default configuration:

- 48 and 96 kHz stereo; 128-frame blocks, matching the current worklet quantum.
- Six static scenarios, three trials of five virtual audio seconds each.
- One requested second of warmup for each fresh engine. Warmup is at least the
  engine latency plus one block; the actual value is recorded.
- Five virtual minutes per sample rate of sustained full-chain processing,
  changing phase, EQ target/curve, gain, width, carve focus and saturation mode
  about every five virtual seconds.
- A seeded, repeated one-second synthetic stereo signal with tones, noise,
  side information and transient pulses. No private recordings are accessed.

The soak is simulated audio time, not a five-minute wait or a real sound device.
This benchmark is a local development tool, not a browser playback benchmark.

### Short run / custom configuration

```sh
npm run bench:engine -- --rates=48000 --duration=2 --repeats=2 --soak=30
npm run bench:engine -- --rates=44100,48000,96000 --soak=600
npm run bench:engine -- --scenarios=full-linear --duration=10 --soak=0
```

Available `--name=value` options: `rates`, `duration`, `warmup`, `repeats`,
`block`, `soak`, `change-every`, `scenarios`, `output`. Unknown, duplicate,
non-finite and out-of-range options fail explicitly. Limits cap rates at four
distinct values between 8 and 192 kHz, static trials at 60 seconds, soak at one
virtual hour and repeats at ten. Custom block sizes are not claims about the
actual worklet quantum.

An output override must name a new `.json` file under
`generated-artifacts/benchmarks/`. Existing files are not overwritten. Reports
and CPU profiles are excluded from Git and publishing by the existing ignore
rules; documentation contains the summarized results.

## What is measured

`scripts/benchmark-engine.mjs` orchestrates these focused modules:

- `benchmark/scenarios.mjs`: deterministic signal, full chain and ablations.
- `benchmark/config.mjs`: validated options and output boundaries.
- `benchmark/engine.mjs`: direct engine timing, source integrity and stress.
- `benchmark/stats.mjs`: interpolated percentiles and trial summaries.

Each static case records exact DSP parameters, sample rate, block size, latency,
setup time, processed frames, actual warmup and independent trial results.
Cold engine construction/initial settings are timed separately from processing.

For `RealtimeEngine.process()` calls the report includes total measured wall
time, p50/p95/p99/max block times and the virtual-audio/processing-time factor.
Quantiles use linear interpolation between sorted timing samples. The summary's
p99 field is a **median of trial p99 values**, not a pooled percentile.

Meter snapshots are called about 20 times per virtual second and timed
separately; parameter changes are also timed separately. Engine-only calls
above the nominal `block / sampleRate` duration are counted, but they are **not
actual dropped callbacks or audible underruns**. Input copying, validation,
meter calls and setting changes are outside the process timer. Whole-loop CPU
and wall measurements include this harness overhead.

Memory samples include RSS, heap used, external memory and array buffers.
Snapshots occur about every 30 virtual seconds and at the end. Forced GC, when
available, runs before the measured loop and after it, never inside that loop.
Both the pre-GC end and post-GC end are recorded. These are process-wide,
sampled observations, not continuous allocation traces or proof of a leak.
The harness itself holds preallocated timing samples proportional to configured
duration and block count; those buffers are present at the initial snapshot.

Correctness checks fail on non-finite output, unexpected recovered samples,
modified input, silent output or changing engine latency during setting stress.
The fixture is hashed before and after; block input is checked exactly.
This complements, but does not replace, the existing sample-level parity and
browser/worker cancellation tests.

## Comparing costs without overclaiming

The full-linear chain is the baseline for:

- Neutral settings.
- Full chain with minimum-phase EQ.
- Full linear chain with saturation disabled.
- Full linear chain with multiband disabled.
- Full linear chain with optical amount and center carve set to zero; the
  underlying glue compressor remains enabled.

JSON stores signed median time differences and relative reductions. Negative
results are retained rather than hidden. Ablation differences are hypotheses
about optimization targets, not exact CPU attribution to a module. Stage
smoothing, shared overhead, compiler optimization and scheduling can affect them.

Do not interpret a Node timing factor as measured AudioWorklet CPU utilization,
native latency, a guaranteed deadline, circuit fidelity or universal SIMD gains.
These results do not benchmark offline worker startup, transport or UI response.
Run browser checks and physical-device tests independently.

### Optional sampled CPU profile

```sh
mkdir -p generated-artifacts/benchmarks
node --expose-gc --cpu-prof --cpu-prof-dir=generated-artifacts/benchmarks \
  scripts/benchmark-engine.mjs --rates=48000 --duration=10 --soak=30
```

Inspect the generated `.cpuprofile` in a compatible CPU-profile viewer. The
profile includes orchestration, warmup and validation too; inspect call stacks,
not just top-level percentages. Compare multiple runs on the same runtime and
host, without concurrent builds or tests. No timing-based CI pass/fail threshold
is added by this benchmark. The existing suite's earlier CPU smoke test remains
unchanged.

## Validation and next steps

Seven regression tests cover option validation, output boundaries, quantiles,
scenario isolation, reproducible fixtures, real-engine stress and complete CLI
JSON output. The full suite passed 423 tests (223 script, 144 core/workflow, 56
real-time); type checking, lint and production build also passed. The running
studio preview was checked after the package-script update.

Record baseline results below after a full run. Use evidence to choose a narrow
optimization, then preserve source audio, phase/channel behavior, latency and
actual shared-export parity. Wasm/SIMD remains an experiment until a compatible
kernel demonstrates both numerical fidelity and a worthwhile measured benefit.
