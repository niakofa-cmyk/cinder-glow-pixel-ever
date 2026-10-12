import { useEffect, useRef, useState } from "react";
import { RealtimeMaster } from "@/dsp/rt/client";
import type { MeterFrame } from "@/dsp/rt/engine";
import { realtimeLimitations } from "@/dsp/rt/capabilities";
import type { Clip } from "@/dsp/types";
import { playbackGainDb, useSession } from "@/store/session";

export function useRealtimePreview(enabled: boolean) {
  const session = useSession();
  const masterRef = useRef<RealtimeMaster | null>(null);
  const loaded = useRef<{ program: Clip | null; reference: Clip | null }>({ program: null, reference: null });
  const epoch = useRef(0);
  const starting = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [live, setLive] = useState<MeterFrame | null>(null);
  const [scope, setScope] = useState<Float32Array | null>(null);
  const [latencyMs, setLatencyMs] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsupported = realtimeLimitations(session.params).join(", ");

  const sync = (master: RealtimeMaster) => {
    const s = useSession.getState();
    if (s.program && loaded.current.program !== s.program) {
      master.pause();
      master.load("program", s.program);
      loaded.current.program = s.program;
      setProgress(0);
      setPlaying(false);
    }
    if (loaded.current.reference !== s.reference) {
      if (s.reference) master.load("reference", s.reference);
      else master.clearReference();
      loaded.current.reference = s.reference;
    }
    master.setParams(s.params);
    master.setSource(s.source);
    master.setMonitor(s.monitor);
    master.setMatchGainDb(playbackGainDb(s));
  };

  useEffect(() => {
    if (!enabled) {
      epoch.current++;
      const master = masterRef.current;
      masterRef.current = null;
      loaded.current = { program: null, reference: null };
      void master?.dispose();
      setPlaying(false);
      setInitialized(false);
      setLive(null);
      setScope(null);
      setError(null);
      return;
    }
    const master = masterRef.current;
    if (!master) return;
    if (master.sampleRate !== session.program?.sampleRate) {
      epoch.current++;
      masterRef.current = null;
      loaded.current = { program: null, reference: null };
      void master.dispose();
      setPlaying(false);
      setInitialized(false);
      setLive(null);
      setProgress(0);
      return;
    }
    if (unsupported) {
      master.pause();
      setPlaying(false);
      return;
    }
    sync(master);
    // Only controls/audio and gain measurements must be pushed; meter updates are local state.
  }, [enabled, unsupported, session.program, session.reference, session.params, session.source, session.monitor,
    session.matchLoudness, session.analysis, session.report, session.refAnalysis]);

  useEffect(() => () => {
    epoch.current++;
    void masterRef.current?.dispose();
    masterRef.current = null;
  }, []);

  const play = async () => {
    if (!enabled || starting.current || unsupported) return;
    const s = useSession.getState();
    if (!s.program) return;
    if (s.source === "reference" && !s.reference) {
      setError("Add a reference track or select Original or Processed.");
      return;
    }
    const id = epoch.current;
    starting.current = true;
    setError(null);
    let master = masterRef.current;
    try {
      if (!master) {
        if (typeof AudioWorkletNode === "undefined") throw new Error("AudioWorklet is unavailable. Use rendered playback in this browser.");
        // Capture the rate, not the full session snapshot and its large audio buffers.
        const sampleRate = s.program.sampleRate;
        master = new RealtimeMaster(sampleRate, {
          onMeters: frame => {
            if (epoch.current !== id) return;
            setLive(frame.meters); setScope(frame.scope);
            setProgress(frame.length ? frame.position / frame.length : 0);
            setPlaying(frame.playing);
            setLatencyMs(frame.meters.latencySamples / sampleRate * 1000);
          },
          onEnded: () => { if (epoch.current === id) { setPlaying(false); setProgress(1); } },
          onError: message => { if (epoch.current === id) { setError(message); setPlaying(false); } },
        });
        masterRef.current = master;
      }
      await master.start();
      if (id !== epoch.current) { await master.dispose(); return; }
      const limitations = realtimeLimitations(useSession.getState().params);
      if (limitations.length) {
        master.pause();
        setPlaying(false);
        setError(`Use rendered playback for ${limitations.join(", ")}.`);
        return;
      }
      sync(master);
      setInitialized(true);
      master.play();
      setPlaying(true);
    } catch (cause) {
      if (id === epoch.current) {
        masterRef.current = null;
        loaded.current = { program: null, reference: null };
        setError(cause instanceof Error ? cause.message : "Live preview could not start. Use rendered playback.");
        setPlaying(false);
        setInitialized(false);
      }
      await master?.dispose().catch(() => {});
    } finally { starting.current = false; }
  };
  const pause = () => { masterRef.current?.pause(); setPlaying(false); };
  const seek = (seconds: number) => {
    if (!initialized) return;
    masterRef.current?.seek(seconds);
    const duration = session.program ? session.program.l.length / session.program.sampleRate : 0;
    setProgress(duration ? Math.max(0, Math.min(1, seconds / duration)) : 0);
  };
  return {
    playing, progress, live, scope, latencyMs, initialized, error, unsupported, play, pause, seek,
    resetMeters: () => masterRef.current?.resetMeters(),
  };
}
