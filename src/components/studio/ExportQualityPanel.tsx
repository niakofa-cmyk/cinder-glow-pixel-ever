import type { ExportQuality } from "@/dsp/export-quality";
import type { Analysis, ChainParams } from "@/dsp/types";
import { reviewProcessing } from "@/dsp/processing-review";

export type ExportAudit = {
  fileName: string;
  quality: ExportQuality;
  params: ChainParams;
  targetLufs: number;
  original: Pick<Analysis, "integratedLufs" | "truePeakDb" | "samplePeakDb" | "crestDb" | "correlation" | "rmsDb"> | null;
};
const fmt = (x: number | null | undefined, decimals = 1) => x != null && Number.isFinite(x) ? x.toFixed(decimals) : "—";

export function ExportQualityPanel({ audit, busy, error }: { audit: ExportAudit | null; busy: boolean; error: string | null }) {
  const processingReview = audit
    ? reviewProcessing(audit.original, audit.quality.measurements, {
        targetLufs: audit.targetLufs,
        ceilingDb: audit.params.limiter.ceilingDb,
      })
    : null;
  const download = () => {
    if (!audit) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...audit, processingReview }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = audit.fileName.replace(/\.wav$/, "-quality.json");
    link.click(); URL.revokeObjectURL(url);
  };
  return <section aria-label="Verified export quality" className="rounded-lg border border-line bg-surface p-4">
    <h2 className="text-sm font-medium">Export quality control</h2>
    {busy && <p role="status" className="mt-2 text-sm text-amber">Encoding and verifying WAV samples in the background…</p>}
    {error && <p role="alert" className="mt-2 text-sm text-amber">{error}</p>}
    {!audit && !busy && <p className="mt-2 text-sm text-muted">Export a WAV to check its actual encoded samples, file integrity, loudness, peaks and mono compatibility. Measurements are not a sound-quality score.</p>}
    {audit && <>
      <p className="mt-2 text-sm text-muted">{audit.fileName} · {audit.quality.engine} engine · {audit.quality.format.sampleRate.toLocaleString()} Hz · {audit.quality.format.bitDepth === 32 ? "32-float" : `${audit.quality.format.bitDepth}-bit`} · {audit.quality.format.frames.toLocaleString()} frames</p>
      <p className="mt-1 text-xs text-muted">Selected loudness guideline at export: {fmt(audit.targetLufs)} LUFS. It is not a universal requirement.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left text-xs text-muted">Measured before processing and after WAV encoding; no claim of artistic improvement.</caption>
          <thead><tr><th>Measurement</th><th>Original</th><th>Exported WAV</th></tr></thead>
          <tbody>
            {([
              ["Integrated loudness (LUFS)", audit.original?.integratedLufs, audit.quality.measurements.integratedLufs],
              ["True peak (dBTP)", audit.original?.truePeakDb, audit.quality.measurements.truePeakDb],
              ["Sample peak (dBFS)", audit.original?.samplePeakDb, audit.quality.measurements.samplePeakDb],
              ["RMS (dBFS)", audit.original?.rmsDb, audit.quality.measurements.rmsDb],
              ["Crest factor (dB)", audit.original?.crestDb, audit.quality.measurements.crestDb],
              ["Stereo correlation", audit.original?.correlation, audit.quality.measurements.correlation],
            ] as const).map(([label, before, after]) => <tr key={label} className="border-t border-line"><th className="py-2 font-normal">{label}</th><td className="font-mono">{fmt(before, label === "Stereo correlation" ? 3 : 1)}</td><td className="font-mono">{fmt(after, label === "Stereo correlation" ? 3 : 1)}</td></tr>)}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Mono fold-down change: {fmt(audit.quality.measurements.monoLossDb)} dB. Samples at/above 0 dBFS: {audit.quality.measurements.clippedSamples}. Maximum encoding error: {audit.quality.maxEncodingError.toExponential(2)}.</p>
      <ul className="mt-2 text-sm text-amber">{audit.quality.warnings.map(w => <li key={w}>{w}</li>)}</ul>
      <p className="mt-2 text-xs text-muted">Decoded Float32 source; BS.1770-style loudness and 4× FIR true peak, not independent certification. Short or silent audio may have unavailable values. Compare by listening at matched loudness.</p>
      <div aria-label="Processing tradeoff review" className="mt-4 rounded-md border border-line bg-bg p-3">
        <h3 className="text-sm font-medium">Processing tradeoff review</h3>
        {processingReview && <>
          <p className="mt-1 text-sm text-muted" role="status">
            {processingReview.status === "attention"
              ? "Measured tradeoffs need listening"
              : processingReview.status === "unavailable"
                ? "Some comparisons are unavailable"
                : "No additional measured tradeoffs flagged"}
          </p>
          <ul className="mt-3 space-y-3">
            {processingReview.checks.map(check => (
              <li key={check.id} className="border-t border-line pt-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h4 className="text-sm font-medium">{check.title}</h4>
                  <span className={`text-xs ${check.level === "attention" ? "text-amber" : "text-muted"}`}>
                    {check.level === "attention" ? "Attention" : check.level === "unavailable" ? "Unavailable" : "Informational"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">{check.evidence}</p>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-line pt-2">
            <h4 className="text-xs font-medium text-muted">Limitations</h4>
            <ul className="mt-1 space-y-1 text-xs text-muted">
              {processingReview.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}
            </ul>
          </div>
        </>}
        {!processingReview && <p className="mt-1 text-sm text-muted">A measured review will appear after export verification.</p>}
      </div>
      <button type="button" onClick={download} className="mt-3 h-11 rounded-md bg-bg px-3 text-sm">Download quality report</button>
    </>}
  </section>;
}
