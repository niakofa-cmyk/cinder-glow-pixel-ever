import { useMemo } from "react";
import type { Analysis } from "@/dsp/types";

const W = 1000;
const H = 360;

function spectrumPoints(spec: Analysis, w: number, h: number): string {
  const minF = Math.log(20);
  const maxF = Math.log(20000);
  const dbFloor = -72;
  const parts: string[] = [];
  const steps = 240;
  for (let i = 0; i < steps; i++) {
    const x = (i / (steps - 1)) * w;
    const freq = Math.exp(minF + (i / (steps - 1)) * (maxF - minF));
    const bin = Math.min(spec.spectrumDb.length - 1, Math.max(1, Math.round(freq / spec.spectrumBinHz)));
    const db = Math.max(dbFloor, Math.min(0, spec.spectrumDb[bin] ?? dbFloor));
    const y = 8 + ((0 - db) / (0 - dbFloor)) * (h - 28);
    parts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return parts.join(" ");
}

export function SpectrumPlot({
  analysis,
  reference,
}: {
  analysis: Analysis | null;
  reference: Analysis | null;
}) {
  const program = analysis ? spectrumPoints(analysis, W, H) : "";
  const refLine = reference ? spectrumPoints(reference, W, H) : "";
  const grid = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const minF = Math.log(20);
  const maxF = Math.log(20000);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full rounded-md bg-bg lg:h-48" role="img" aria-label="Spectrum of the program and reference">
      {grid.map((freq) => {
        const x = ((Math.log(freq) - minF) / (maxF - minF)) * W;
        const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
        return (
          <g key={freq} className="text-line">
            <line x1={x} y1={0} x2={x} y2={H} stroke="currentColor" strokeWidth="1" />
            <text x={x + 6} y={H - 8} className="fill-faint" fontSize="16" fontFamily="IBM Plex Mono, ui-monospace, monospace">
              {label}
            </text>
          </g>
        );
      })}
      {[-12, -24, -48].map((db) => {
        const y = 8 + ((0 - db) / 72) * (H - 28);
        return <line key={db} x1={0} y1={y} x2={W} y2={y} className="text-line" stroke="currentColor" strokeWidth="1" />;
      })}
      {refLine && (
        <polyline points={refLine} fill="none" className="text-fg" stroke="currentColor" strokeWidth="1.5" />
      )}
      {program && (
        <polyline points={program} fill="none" className="text-amber" stroke="currentColor" strokeWidth="2.5" />
      )}
    </svg>
  );
}

export function Waveform({ left, progress }: { left: ArrayLike<number> | null; progress: number }) {
  const shape = useMemo(() => {
    if (!left) return null;
    const buckets = 400;
    const min = new Float64Array(buckets);
    const max = new Float64Array(buckets);
    const n = left.length;
    for (let b = 0; b < buckets; b++) {
      const a = Math.floor((b * n) / buckets);
      const c = Math.max(a + 1, Math.floor(((b + 1) * n) / buckets));
      let lo = 0;
      let hi = 0;
      for (let i = a; i < c && i < n; i++) {
        const v = left[i] ?? 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[b] = lo;
      max[b] = hi;
    }
    return { min, max };
  }, [left]);

  const points = useMemo(() => {
    if (!shape) return "";
    const top: string[] = [];
    const bottom: string[] = [];
    const mid = 50;
    for (let i = 0; i < shape.max.length; i++) {
      const x = (i / (shape.max.length - 1)) * 1000;
      top.push(`${x.toFixed(1)},${(mid - (shape.max[i] ?? 0) * 42).toFixed(1)}`);
      bottom.push(`${x.toFixed(1)},${(mid - (shape.min[i] ?? 0) * 42).toFixed(1)}`);
    }
    return `${top.join(" ")} ${bottom.reverse().join(" ")}`;
  }, [shape]);

  return (
    <svg viewBox="0 0 1000 100" className="h-16 w-full rounded-md bg-bg" aria-hidden="true">
      <line x1="0" y1="50" x2="1000" y2="50" className="text-line" stroke="currentColor" strokeWidth="1" />
      {points && <polygon points={points} className="fill-amber text-amber" opacity="0.9" />}
      {progress > 0 && (
        <line x1={progress * 1000} y1="0" x2={progress * 1000} y2="100" className="text-fg" stroke="currentColor" strokeWidth="2" />
      )}
    </svg>
  );
}

export function EqCurve({ points }: { points: { freq: number; db: number }[] }) {
  const minF = Math.log(20);
  const maxF = Math.log(20000);
  const line = points
    .map((p) => {
      const x = ((Math.log(p.freq) - minF) / (maxF - minF)) * 1000;
      const y = 60 - (Math.max(-18, Math.min(18, p.db)) / 18) * 48;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 1000 120" className="h-24 w-full rounded-md bg-bg" role="img" aria-label="Realized equalizer magnitude">
      <line x1="0" y1="60" x2="1000" y2="60" className="text-line" stroke="currentColor" strokeWidth="1" />
      {line && <polyline points={line} fill="none" className="text-amber" stroke="currentColor" strokeWidth="2.5" />}
    </svg>
  );
}
