import { useMemo } from "react";
import { amplitudeSpectrumDb } from "@/dsp/fft";
import type { MeterFrame } from "@/dsp/rt/engine";

function fmt(v: number, digits = 1): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function Row({ label, value, unit, hot = false }: { label: string; value: string; unit: string; hot?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-line py-1.5">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-base tabular-nums ${hot ? "text-clip" : "text-fg"}`}>
        {value}
        <span className="ml-1 text-xs text-muted">{unit}</span>
      </span>
    </div>
  );
}

function ReductionBar({ label, db }: { label: string; db: number }) {
  const width = Math.min(100, (Math.max(0, db) / 12) * 100);
  return (
    <div className="grid grid-cols-[4.5rem_1fr_3.2rem] items-center gap-2">
      <span className="text-xs text-muted">{label}</span>
      <div className="h-2 rounded-full bg-bg" role="meter" aria-label={`${label} gain reduction`} aria-valuemin={0} aria-valuemax={12} aria-valuenow={Math.max(0, db)}>
        <div className="h-full rounded-full bg-amber" style={{ width: `${width}%` }} />
      </div>
      <span className="text-right font-mono text-xs tabular-nums">{fmt(-Math.max(0, db))}</span>
    </div>
  );
}

function LiveSpectrum({ scope, sampleRate }: { scope: Float32Array; sampleRate: number }) {
  const bars = useMemo(() => {
    const x = Float64Array.from(scope);
    const { db, binHz } = amplitudeSpectrumDb(x, sampleRate, 2048);
    const count = 64;
    const out: number[] = [];
    const lo = Math.log(30);
    const hi = Math.log(Math.min(20000, sampleRate * 0.45));
    for (let b = 0; b < count; b++) {
      const f0 = Math.exp(lo + ((hi - lo) * b) / count);
      const f1 = Math.exp(lo + ((hi - lo) * (b + 1)) / count);
      const i0 = Math.max(1, Math.floor(f0 / binHz));
      const i1 = Math.max(i0 + 1, Math.ceil(f1 / binHz));
      let m = -120;
      for (let i = i0; i < i1 && i < db.length; i++) m = Math.max(m, db[i] as number);
      out.push(m);
    }
    return out;
  }, [scope, sampleRate]);
  return (
    <svg viewBox="0 0 64 24" className="h-16 w-full" role="img" aria-label="Live output spectrum">
      {bars.map((m, i) => {
        const h = Math.max(0, Math.min(24, ((m + 90) / 90) * 24));
        return <rect key={i} x={i + 0.1} y={24 - h} width={0.8} height={h} className="fill-amber" />;
      })}
    </svg>
  );
}

export function LiveMeters({
  live,
  scope,
  sampleRate,
  latencyMs,
  active,
  onResetHold,
}: {
  live: MeterFrame | null;
  scope: Float32Array | null;
  sampleRate: number;
  latencyMs: number;
  active: boolean;
  onResetHold: () => void;
}) {
  const tpHot = (live?.outTruePeakHoldDb ?? -99) > -0.1;
  return (
    <section className="rounded-lg border border-line bg-surface p-4" aria-label="Live meters">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Live output</h2>
        <button type="button" onClick={onResetHold} className="h-9 rounded-md bg-bg px-3 text-xs">
          Reset holds
        </button>
      </div>
      {!live ? (
        <p className="text-sm text-muted">Press Play. These read the engine as it runs, not the offline render.</p>
      ) : (
        <>
          {scope && active && <LiveSpectrum scope={scope} sampleRate={sampleRate} />}
          <Row label="Momentary" value={fmt(live.outMomentary)} unit="LUFS" />
          <Row label="Short-term" value={fmt(live.outShortTerm)} unit="LUFS" />
          <Row label="Integrated" value={fmt(live.outIntegrated)} unit="LUFS" />
          <Row label="Range" value={fmt(live.outRange)} unit="LU" />
          <Row label="True peak hold" value={fmt(live.outTruePeakHoldDb, 2)} unit="dBTP" hot={tpHot} />
          <div className="mt-3 flex flex-col gap-2">
            <ReductionBar label="Limiter" db={live.limiterReductionDb} />
            <ReductionBar label="Glue" db={live.glueReductionDb} />
            <ReductionBar label="Low band" db={live.bandReductionDb[0]} />
            <ReductionBar label="Mid band" db={live.bandReductionDb[1]} />
            <ReductionBar label="High band" db={live.bandReductionDb[2]} />
            <ReductionBar label="Dynamic EQ" db={live.dynEqReductionDb} />
            <ReductionBar label="De-ess" db={live.deEssReductionDb} />
          </div>
          <div className="mt-3 grid grid-cols-[4.5rem_1fr_3.2rem] items-center gap-2">
            <span className="text-xs text-muted">Phase</span>
            <div className="relative h-2 rounded-full bg-bg" role="meter" aria-label="Stereo correlation" aria-valuemin={-1} aria-valuemax={1} aria-valuenow={live.correlation}>
              <div className="absolute top-0 left-1/2 h-full w-px bg-line" />
              <div
                className={`absolute top-0 h-full ${live.correlation < 0 ? "bg-clip" : "bg-amber"}`}
                style={{
                  width: `${Math.abs(live.correlation) * 50}%`,
                  left: live.correlation >= 0 ? "50%" : `${50 + live.correlation * 50}%`,
                }}
              />
            </div>
            <span className="text-right font-mono text-xs tabular-nums">{fmt(live.correlation, 2)}</span>
          </div>
          <p className="mt-3 text-xs text-pretty text-muted">
            Engine latency {fmt(latencyMs)} ms. It is fixed, so switching modules or sources never shifts the timeline.
            {live.recovered ? " The engine just recovered from a bad sample and cleared its state." : ""}
          </p>
        </>
      )}
    </section>
  );
}
