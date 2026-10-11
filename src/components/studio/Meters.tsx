import { STREAMING_TARGETS, type Analysis, type ProcessReport } from "@/dsp/types";

function fmt(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function Readout({ label, value, unit, hot = false }: { label: string; value: string; unit: string; hot?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-line py-2">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-xl tabular-nums ${hot ? "text-clip" : "text-fg"}`}>
        {value}
        <span className="ml-1 text-xs text-muted">{unit}</span>
      </span>
    </div>
  );
}

export function Meters({
  analysis,
  report,
  targetLufs,
  onTarget,
}: {
  analysis: Analysis | null;
  report: ProcessReport | null;
  targetLufs: number;
  onTarget: (lufs: number) => void;
}) {
  const outHot = (report?.truePeakOutDb ?? -99) > -0.2;
  return (
    <section className="rounded-lg border border-line bg-surface p-4" aria-label="Meters">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Meters</h2>
        <span className="font-mono text-xs text-muted">BS.1770 · 4× peak</span>
      </div>
      <label className="mb-3 flex flex-col gap-1 text-xs text-muted">
        Loudness target
        <select
          className="h-11 rounded-md border border-line bg-bg px-2 text-sm text-fg"
          value={targetLufs}
          onChange={(event) => onTarget(Number(event.target.value))}
        >
          {STREAMING_TARGETS.map((target) => (
            <option key={target.id} value={target.lufs}>
              {target.name} · {target.lufs} LUFS / {target.truePeak} dBTP
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="font-mono text-xs text-amber">In</p>
          <Readout label="LUFS I" value={fmt(analysis?.integratedLufs ?? NaN)} unit="" />
          <Readout label="True peak" value={fmt(analysis?.truePeakDb ?? NaN)} unit="dBTP" hot={(analysis?.truePeakDb ?? -99) > -0.2} />
          <Readout label="Crest" value={fmt(analysis?.crestDb ?? NaN)} unit="dB" />
        </div>
        <div>
          <p className="font-mono text-xs text-amber">Out</p>
          <Readout label="LUFS I" value={fmt(report?.integratedOut ?? NaN)} unit="" />
          <Readout label="True peak" value={fmt(report?.truePeakOutDb ?? NaN)} unit="dBTP" hot={outHot} />
          <Readout label="Limiting" value={fmt(report?.limiterReductionDb ?? NaN)} unit="dB" />
        </div>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-muted">
          <span>Correlation</span>
          <span className="font-mono tabular-nums text-fg">{fmt(analysis?.correlation ?? NaN, 2)}</span>
        </div>
        <div className="relative h-3 rounded-full bg-bg">
          <div className="absolute top-0 left-1/2 h-full w-px bg-line" />
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber"
            style={{ left: `${(((analysis?.correlation ?? 0) + 1) / 2) * 100}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between font-mono text-xs text-faint">
          <span>−1</span>
          <span>0</span>
          <span>+1</span>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted">Short-term max</dt>
          <dd className="font-mono tabular-nums">{fmt(analysis?.shortTermMaxLufs ?? NaN)} LUFS</dd>
        </div>
        <div>
          <dt className="text-muted">Loudness range</dt>
          <dd className="font-mono tabular-nums">{fmt(analysis?.loudnessRange ?? NaN)} LU</dd>
        </div>
        <div>
          <dt className="text-muted">Sample peak</dt>
          <dd className="font-mono tabular-nums">{fmt(analysis?.samplePeakDb ?? NaN)} dBFS</dd>
        </div>
        <div>
          <dt className="text-muted">Side energy</dt>
          <dd className="font-mono tabular-nums">{fmt((analysis?.sideEnergyRatio ?? 0) * 100, 0)}%</dd>
        </div>
      </dl>
    </section>
  );
}
