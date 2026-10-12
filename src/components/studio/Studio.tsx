import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Download, Pause, Play, Upload } from "lucide-react";
import { neutralParams, presets } from "@/dsp/presets";
import { encodeClipWav, decodeWavPcm } from "@/dsp/wav";
import type { Clip } from "@/dsp/types";
import { balanceOf, playbackGainDb, useSession, type MonitorChoice, type SourceChoice } from "@/store/session";
import { SpectrumPlot, Waveform } from "./Displays";
import { Meters } from "./Meters";
import { ModulePanel } from "./ModulePanel";
import { SessionPanel } from "./SessionPanel";
import { LiveMeters } from "./LiveMeters";
import { useRealtimePreview } from "@/hooks/useRealtimePreview";
import { renderSharedWav } from "@/store/session";

const MODULES: { id: string; name: string }[] = [
  { id: "map", name: "Signal chain" },
  { id: "input", name: "Input" },
  { id: "eq", name: "Equalizer" },
  { id: "dynamic", name: "Dynamic EQ" },
  { id: "deess", name: "De-esser" },
  { id: "multiband", name: "Multiband" },
  { id: "glue", name: "Glue" },
  { id: "transient", name: "Transients" },
  { id: "saturation", name: "Saturation" },
  { id: "image", name: "Stereo" },
  { id: "limiter", name: "Limiter" },
];

const MAX_SECONDS = 12 * 60;

async function decodeWithBrowser(bytes: Uint8Array): Promise<Clip> {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const ctx = new OfflineAudioContext(2, 64, 48000);
  const audio = await ctx.decodeAudioData(copy);
  const ch0 = audio.getChannelData(0);
  const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : ch0;
  return {
    l: new Float32Array(ch0),
    r: ch1 === ch0 ? new Float32Array(ch0) : new Float32Array(ch1),
    sampleRate: audio.sampleRate,
  };
}

async function decodeFile(file: File): Promise<Clip> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const wav = decodeWavPcm(bytes);
  if (wav) return wav;
  try {
    return await decodeWithBrowser(bytes);
  } catch {
    throw new Error("This browser could not decode that file. Export a 16-bit, 24-bit, or 32-bit WAV and load that.");
  }
}

export function Studio() {
  const session = useSession();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [realtime, setRealtime] = useState(false);
  const rt = useRealtimePreview(realtime);
  const activePlaying = realtime ? rt.playing : playing;
  const activeProgress = realtime ? rt.progress : progress;
  const [sharedExportBusy, setSharedExportBusy] = useState(false);
  const [sharedExportError, setSharedExportError] = useState<string | null>(null);
  const sharedExportLock = useRef(false);
  const sharedExportEpoch = useRef(0);
  useEffect(() => () => { sharedExportEpoch.current++; }, []);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const rafRef = useRef(0);
  const startedRef = useRef(0);

  useEffect(() => {
    void session.initialize();
    return () => {
      sourceRef.current?.stop();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // Mount only. The store action is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = () => {
    rt.pause();
    sourceRef.current?.stop();
    sourceRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  };

  const play = async () => {
    if (realtime) { await rt.play(); return; }
    const program = session.program;
    if (!program) return;
    let audio: Clip | null = program;
    if (session.source === "processed" && session.rendered) audio = session.rendered;
    if (session.source === "reference") audio = session.reference;
    if (!audio) return;
    stop();
    try {
      const ctx =
        ctxRef.current && ctxRef.current.sampleRate === audio.sampleRate
          ? ctxRef.current
          : new AudioContext({ sampleRate: audio.sampleRate });
      if (ctxRef.current && ctxRef.current !== ctx) void ctxRef.current.close();
      ctxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const buffer = ctx.createBuffer(2, audio.l.length, audio.sampleRate);
      const outL = buffer.getChannelData(0);
      const outR = buffer.getChannelData(1);
      if (session.monitor === "mono") {
        for (let i = 0; i < outL.length; i++) {
          const mid = ((audio.l[i] ?? 0) + (audio.r[i] ?? 0)) * 0.5;
          outL[i] = mid;
          outR[i] = mid;
        }
      } else {
        outL.set(audio.l);
        outR.set(audio.r);
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      const match = playbackGainDb(session);
      gain.gain.value = Math.pow(10, match / 20);
      source.connect(gain);
      if (session.monitor === "small") {
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 180;
        hp.Q.value = 0.7;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 5500;
        lp.Q.value = 0.7;
        gain.connect(hp);
        hp.connect(lp);
        lp.connect(ctx.destination);
      } else {
        gain.connect(ctx.destination);
      }
      source.onended = () => {
        setPlaying(false);
        setProgress(0);
      };
      source.start();
      sourceRef.current = source;
      startedRef.current = ctx.currentTime;
      setPlaying(true);
      const duration = buffer.duration;
      const tick = () => {
        const elapsed = (ctx.currentTime - startedRef.current) / duration;
        setProgress(Math.max(0, Math.min(1, elapsed)));
        if (elapsed < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (error) {
      setPlaying(false);
      useSession.setState({ error: error instanceof Error ? error.message : "Playback failed" });
    }
  };

  const playingRef = useRef(false);
  playingRef.current = activePlaying;
  const playRef = useRef(play);
  const stopRef = useRef(stop);
  playRef.current = play;
  stopRef.current = stop;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.target !== document.body) return;
      event.preventDefault();
      if (playingRef.current) stopRef.current();
      else void playRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const balance = balanceOf(session);
  const match = playbackGainDb(session);
  const rate = session.program?.sampleRate ?? 48000;
  const presetList = presets();

  const primeAudio = () => {
    const ctx = ctxRef.current ?? new AudioContext();
    ctxRef.current = ctx;
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  };

  const takeFile = async (file: File | undefined, kind: "program" | "reference") => {
    if (!file) return;
    useSession.setState({ busy: `Reading ${file.name}`, error: null });
    try {
      const audio = await decodeFile(file);
      if (audio.l.length < 8) throw new Error("That file has no audio samples.");
      if (audio.l.length / audio.sampleRate > MAX_SECONDS) {
        throw new Error("That file is longer than 12 minutes. Bounce a shorter version and load that.");
      }
      if (kind === "program") session.loadProgram(file.name, audio);
      else session.loadReference(file.name, audio);
    } catch (error) {
      useSession.setState({
        busy: null,
        error: error instanceof Error ? error.message : "That file could not be decoded. Export a WAV and try again.",
      });
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>, kind: "program" | "reference") => {
    const file = event.target.files?.[0];
    event.target.value = "";
    void takeFile(file, kind);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    primeAudio();
    const file = event.dataTransfer.files?.[0];
    void takeFile(file, "program");
  };

  const exportWav = (bits: 16 | 24 | 32) => {
    const rendered = session.rendered;
    if (!rendered) return;
    const bytes = encodeClipWav([rendered.l, rendered.r], rendered.sampleRate, bits);
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    const blob = new Blob([copy], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = bits === 32 ? "aurora-master-32f.wav" : `aurora-master-${bits}.wav`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportShared = async (bits: 16 | 24 | 32) => {
    const snapshot = useSession.getState();
    if (!snapshot.program || sharedExportLock.current) return;
    const id = sharedExportEpoch.current;
    const settings = JSON.stringify(snapshot.params);
    sharedExportLock.current = true;
    setSharedExportBusy(true);
    setSharedExportError(null);
    try {
      const params = JSON.parse(settings) as typeof snapshot.params;
      const buffer = await renderSharedWav(snapshot.program, params, bits);
      if (id !== sharedExportEpoch.current) return;
      const current = useSession.getState();
      if (current.program !== snapshot.program || JSON.stringify(current.params) !== settings) {
        throw new Error("Audio or settings changed during shared export. Export again to print the current settings.");
      }
      const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = bits === 32 ? "aurora-live-master-32f.wav" : `aurora-live-master-${bits}.wav`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (id === sharedExportEpoch.current) {
        const current = useSession.getState();
        const message = error instanceof Error ? error.message : "Shared export failed.";
        const changed = current.program !== snapshot.program || JSON.stringify(current.params) !== settings
          || /Processing was (?:replaced|superseded)/.test(message);
        setSharedExportError(changed
          ? "Audio or settings changed during shared export. Export again to print the current settings."
          : message);
      }
    } finally {
      sharedExportLock.current = false;
      if (id === sharedExportEpoch.current) setSharedExportBusy(false);
    }
  };

  return (
    <div
      className="flex h-dvh flex-col bg-bg text-fg"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <header className="shrink-0 border-b border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-3 px-4 py-4">
          <div>
            <p className="font-mono text-xs tracking-widest text-amber">AURORA</p>
            <h1 className="text-2xl font-medium text-balance">Mastering console</h1>
          </div>
          <p className="max-w-md text-sm text-pretty text-muted">
            Phase 1 measures the file, then runs a reversible chain. Louder is not treated as better.
          </p>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <SessionPanel onRestore={stop} />
        <section aria-label="Playback engine" className="rounded-md border border-line p-3">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" aria-pressed={realtime} className={`h-11 rounded-md px-3 text-sm ${realtime ? "bg-amber text-ink" : "bg-surface"}`}
              onClick={() => { stop(); setRealtime(!realtime); }}>Live preview</button>
            <p className="text-xs text-muted">{realtime ? "AudioWorklet: controls update during playback." : "Rendered playback: exact offline master."}</p>
          </div>
          {realtime && <>
            <p className="mt-2 text-xs text-muted">Live preview uses FIR linear-phase EQ and causal multiband crossovers. Shared-engine exports below use the same DSP; the footer's offline exports use the established renderer. Live latency is {rt.latencyMs.toFixed(1)} ms.</p>
            <div role="group" aria-label="Shared-engine WAV export" className="mt-3 rounded-md border border-line p-3">
              <p className="text-sm font-medium">Shared-engine WAV</p>
              <p className="mt-1 text-xs text-muted">Prints the program with current fixed settings, with DSP latency removed. Compare using Processed, Full range and Match loudness off. Reference/original selection, monitor effects, pauses, seeks and automation are not printed. 16/24-bit adds dither; 32-float preserves sample values.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {([24, 32, 16] as const).map(bits => <button key={bits} type="button"
                  className="h-11 rounded-md bg-bg px-3 text-sm disabled:opacity-40"
                  disabled={!session.program || !!rt.unsupported || sharedExportBusy}
                  onClick={() => void exportShared(bits)}>
                  {bits === 32 ? "Live-engine 32-float" : `Live-engine ${bits}-bit WAV`}
                </button>)}
              </div>
              {sharedExportBusy && <p role="status" className="mt-2 text-xs text-amber">Rendering shared-engine WAV in the background…</p>}
              {sharedExportError && <p role="alert" className="mt-2 text-sm text-amber">{sharedExportError}</p>}
            </div>
            {rt.unsupported && <p role="alert" className="mt-2 text-sm text-amber">Use rendered playback for {rt.unsupported}. Live playback is paused rather than ignoring these controls.</p>}
            {rt.error && <p role="alert" className="mt-2 text-sm text-amber">{rt.error}</p>}
            <label className="mt-3 flex items-center gap-3 text-xs text-muted">
              Seek
              <input type="range" aria-label="Seek position" className="min-w-0 flex-1 accent-amber" min={0}
                max={session.program ? session.program.l.length / session.program.sampleRate : 0} step={0.01}
                value={activeProgress * (session.program ? session.program.l.length / session.program.sampleRate : 0)}
                disabled={!rt.initialized} onChange={event => rt.seek(Number(event.target.value))} />
            </label>
          </>}
        </section>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="h-11 rounded-md bg-surface px-3 text-sm" onClick={() => session.loadDemo()}>
            House program
          </button>
          <button type="button" className="h-11 rounded-md bg-surface px-3 text-sm" onClick={() => session.loadCalibration()}>
            −23 LUFS tone
          </button>
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md bg-surface px-3 text-sm" onPointerDown={() => primeAudio()}>
            <Upload className="size-4" aria-hidden="true" />
            Program
            <input className="sr-only" type="file" accept="audio/*,.wav,.wave,.aif,.aiff,.mp3,.flac,.ogg,.m4a,.aac,.caf" onChange={(event) => onFileChange(event, "program")} />
          </label>
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md bg-surface px-3 text-sm" onPointerDown={() => primeAudio()}>
            <Upload className="size-4" aria-hidden="true" />
            Reference
            <input className="sr-only" type="file" accept="audio/*,.wav,.wave,.aif,.aiff,.mp3,.flac,.ogg,.m4a,.aac,.caf" onChange={(event) => onFileChange(event, "reference")} />
          </label>
          <span className="font-mono text-xs text-muted">
            {session.programName || "No program"}
            {session.referenceName ? ` · ref ${session.referenceName}` : ""}
            {session.program ? ` · ${(rate / 1000).toFixed(1)} kHz` : ""}
          </span>
          {session.busy && <span className="font-mono text-xs text-amber">{session.busy}</span>}
          <span className="text-xs text-muted">WAV recommended. MP3, FLAC, and other formats depend on browser support. Drop a file anywhere on the console.</span>
        </div>

        {session.error && (
          <p className="rounded-md border border-clip px-3 py-2 text-sm text-clip" role="alert">
            {session.error}
          </p>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_20rem]">
          <nav className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="Signal chain">
            {MODULES.map((mod, index) => (
              <button
                key={mod.id}
                type="button"
                onClick={() => session.setModule(mod.id)}
                className={`h-11 shrink-0 rounded-md px-3 text-left text-sm lg:w-full ${session.moduleId === mod.id ? "bg-amber text-ink" : "bg-surface text-fg"}`}
              >
                <span className="mr-2 font-mono text-xs opacity-70">{String(index).padStart(2, "0")}</span>
                {mod.name}
              </button>
            ))}
          </nav>

          <section className="flex min-w-0 flex-col gap-3" aria-label="Analysis">
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-medium">Spectrum</h2>
                <p className="font-mono text-xs text-muted">Amber program · bone reference</p>
              </div>
              <SpectrumPlot analysis={session.analysis} reference={session.refAnalysis} />
              <div className="mt-3">
              <Waveform
                left={
                  session.source === "processed"
                    ? (session.rendered?.l ?? session.program?.l ?? null)
                    : session.source === "reference"
                      ? (session.reference?.l ?? null)
                      : (session.program?.l ?? null)
                }
                progress={activeProgress}
              />
              </div>
            </div>
            {balance.length > 0 && (
              <div className="rounded-lg border border-line bg-surface p-3">
                <h2 className="text-sm font-medium">Tonal balance against the reference</h2>
                <p className="mt-1 text-xs text-pretty text-muted">
                  Each third-octave is centered on its own average, so a louder file does not look brighter. Positive means the program has more energy there than the reference.
                </p>
                <div className="mt-3 flex flex-col gap-1">
                  {balance.filter((_, i) => i % 2 === 0).map((band) => (
                    <BalanceRow key={band.freq} freq={band.freq} delta={band.deltaDb} />
                  ))}
                </div>
              </div>
            )}
          </section>

          <div className="flex flex-col gap-4">
          <Meters
            analysis={session.analysis}
            report={session.report}
            targetLufs={session.targetLufs}
            onTarget={session.setTarget}
          />
          {realtime && <LiveMeters live={rt.live} scope={rt.scope} sampleRate={session.program?.sampleRate ?? 48000}
            latencyMs={rt.latencyMs} active={rt.playing} onResetHold={rt.resetMeters} />}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {presetList.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.detail}
              onClick={() => session.setParams(preset.params)}
              className="h-11 rounded-md bg-surface px-3 text-sm"
            >
              {preset.name}
            </button>
          ))}
          <button type="button" className="h-11 rounded-md bg-surface px-3 text-sm" onClick={() => session.setParams(neutralParams())}>
            Reset
          </button>
        </div>

        <ModulePanel moduleId={session.moduleId} params={session.params} sampleRate={rate} onChange={session.setParams} />

        <section className="rounded-lg border border-line bg-surface p-4" aria-label="Findings">
          <h2 className="text-sm font-medium">What the measurements support</h2>
          <p className="mt-1 text-sm text-pretty text-muted">
            Nothing here is applied until you audition it. A resonance can be the instrument. Compare at matched loudness.
          </p>
          <ul className="mt-4 flex flex-col gap-4">
            {session.findings.map((finding) => (
              <li key={finding.id} className="border-t border-line pt-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-medium">{finding.title}</h3>
                  <span className="font-mono text-xs text-muted">{finding.confidence} confidence</span>
                </div>
                <p className="mt-1 text-sm text-pretty text-muted">{finding.evidence}</p>
                <p className="mt-1 text-sm text-pretty">{finding.action}</p>
                <p className="mt-1 text-xs text-pretty text-faint">Tradeoff: {finding.sideEffect}</p>
                {finding.patch && (
                  <button type="button" className="mt-2 h-11 rounded-md bg-amber px-3 text-sm text-ink" onClick={() => session.patchParams(finding.patch ?? {})}>
                    Audition this
                  </button>
                )}
              </li>
            ))}
            {session.findings.length === 0 && <li className="text-sm text-muted">Measurements appear once the program is in.</li>}
          </ul>
        </section>

        {session.report && session.report.notes.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-pretty text-muted">
            {session.report.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </main>

      <div className="shrink-0 border-t border-line bg-surface px-4 py-3">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (activePlaying ? stop() : void play())}
            disabled={!session.program || (realtime && !!rt.unsupported)}
            className="inline-flex h-11 items-center gap-2 rounded-md bg-amber px-4 text-sm font-medium text-ink disabled:opacity-40"
          >
            {activePlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
            {activePlaying ? (realtime ? "Pause" : "Stop") : "Play"}
          </button>
          <Choice
            value={session.source}
            options={[
              ["original", "Original"],
              ["processed", "Processed"],
              ["reference", "Reference"],
            ]}
            onChange={(value) => session.setSource(value as SourceChoice)}
          />
          <Choice
            value={session.monitor}
            options={[
              ["full", "Full range"],
              ["mono", "Mono"],
              ["small", "Small speaker"],
            ]}
            onChange={(value) => session.setMonitor(value as MonitorChoice)}
          />
          <button
            type="button"
            aria-pressed={session.matchLoudness}
            onClick={() => session.setMatch(!session.matchLoudness)}
            className={`h-11 rounded-md px-3 text-sm ${session.matchLoudness ? "bg-amber text-ink" : "bg-bg text-fg"}`}
          >
            Match loudness{session.matchLoudness && Math.abs(match) >= 0.05 ? ` ${match > 0 ? "+" : ""}${match.toFixed(1)} dB` : ""}
          </button>
          <span className="text-xs text-muted">Offline WAV</span>
          <button type="button" className="inline-flex h-11 items-center gap-2 rounded-md bg-bg px-3 text-sm disabled:opacity-40" disabled={!session.rendered} onClick={() => exportWav(24)}>
            <Download className="size-4" aria-hidden="true" />
            24-bit WAV
          </button>
          <button type="button" className="h-11 rounded-md bg-bg px-3 text-sm disabled:opacity-40" disabled={!session.rendered} onClick={() => exportWav(32)}>
            32-float
          </button>
          <button type="button" className="h-11 rounded-md bg-bg px-3 text-sm disabled:opacity-40" disabled={!session.rendered} onClick={() => exportWav(16)}>
            16-bit
          </button>
        </div>
        {session.source === "processed" && session.program && !session.rendered && (
          <p className="mx-auto mt-2 max-w-7xl text-xs text-muted">Play is the original until the master finishes rendering. Export stays off until then.</p>
        )}
        {session.monitor !== "full" && (
          <p className="mx-auto mt-2 max-w-7xl text-xs text-muted">
            {session.monitor === "mono"
              ? "Mono fold is monitoring only. The export stays stereo."
              : "Small-speaker mode is a 180 Hz high-pass and a 5.5 kHz low-pass. It is not a model of a particular speaker, and it is not printed into the export."}
          </p>
        )}
      </div>
    </div>
  );
}

function Choice({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex rounded-md bg-bg p-1">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`h-11 rounded px-3 text-sm ${value === id ? "bg-amber text-ink" : "text-fg"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function BalanceRow({ freq, delta }: { freq: number; delta: number }) {
  const clamped = Math.max(-9, Math.min(9, delta));
  const width = (Math.abs(clamped) / 9) * 50;
  const label = freq >= 1000 ? `${(freq / 1000).toFixed(freq >= 10000 ? 0 : 1)}k` : `${Math.round(freq)}`;
  return (
    <div className="grid grid-cols-[3rem_1fr_3.5rem] items-center gap-2">
      <span className="font-mono text-xs text-muted">{label}</span>
      <div className="relative h-2 rounded-full bg-bg">
        <div className="absolute top-0 left-1/2 h-full w-px bg-line" />
        <div
          className="absolute top-0 h-full bg-amber"
          style={{
            width: `${width}%`,
            left: clamped >= 0 ? "50%" : `${50 - width}%`,
          }}
        />
      </div>
      <span className="text-right font-mono text-xs tabular-nums text-fg">
        {delta > 0 ? "+" : ""}
        {delta.toFixed(1)}
      </span>
    </div>
  );
}
