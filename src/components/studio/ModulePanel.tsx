import { eqCurveDb } from "@/dsp/eq";
import { bandIsActive } from "@/dsp/eq";
import type { ChainParams, EqBand } from "@/dsp/types";
import { EqCurve } from "./Displays";

function Knob({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const shown = Number.isInteger(step) ? value.toFixed(0) : value.toFixed(step < 0.1 ? 2 : 1);
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="flex items-baseline justify-between gap-3 text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-fg">
          {shown}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`h-11 rounded-md px-3 text-sm ${on ? "bg-amber text-ink" : "bg-bg text-fg"}`}
    >
      {label}
    </button>
  );
}

const MATH: Record<string, string> = {
  map: "Analysis taps the input. It does not sit in the processing path, so bypassing a module never changes a measurement of the source.",
  input: "Output = input × 10^(dB/20). This is the only place a streaming loudness gap should be closed before the limiter.",
  eq: "Minimum phase: RBJ cookbook biquads, direct form II transposed. Linear phase: the same filters forward and back at half the knob gain, so you hear the curve on screen, with no phase shift and some pre-ring.",
  dynamic: "A 0 dB bandpass is attenuated only while its own envelope is over the threshold, then mixed back. Material outside the band is untouched.",
  deess: "Same split-band cut, aimed at 5–9 kHz. It cannot tell a vocal ess from a cymbal.",
  multiband: "Linear-phase Linkwitz–Riley 4. One Butterworth section run forward and back, so the magnitude is 24 dB/octave and the phase is zero. The three bands sum flat without an extra allpass.",
  glue: "Serial glue. Stage 1 is a fast RMS VCA on these knobs. Stage 2 is a slower optical-style leveler with a softer ratio and a two-speed release. Optical is the blend. Not an SSL, not an LA-2A.",
  transient: "Fast envelope minus slow envelope marks the attack. Attack scales that difference. Sustain scales the slow body. Zero and zero is a bypass.",
  saturation: "8× Kaiser anti-alias around a waveshaper. Tape is tanh (odd harmonics). Tube is an asymmetric exponential (even harmonics). Hybrid crossfades them. Memory is a hysteresis play operator plus a slow bias. Not a tape machine or a valve.",
  image: "Width scales the side only. Width 0 is mono. Width 1 is bypass. Carve ducks the side band around the focus frequency while the center of that band is loud. It does not separate a vocal from other centered sounds.",
  limiter: "Lookahead true-peak limiter. The detector is a 4× sinc peak. Gain falls immediately and releases with a one-pole. A signal under the ceiling is bit-identical.",
};

export function ModulePanel({
  moduleId,
  params,
  sampleRate,
  onChange,
}: {
  moduleId: string;
  params: ChainParams;
  sampleRate: number;
  onChange: (params: ChainParams) => void;
}) {
  const set = (patch: Partial<ChainParams>) => onChange({ ...params, ...patch });
  const curve = moduleId === "eq" ? eqCurveDb(params.bands, sampleRate, params.eqMode) : [];

  return (
    <section className="rounded-lg border border-line bg-surface p-4" aria-label="Module controls">
      <p className="text-sm text-pretty text-muted">{MATH[moduleId]}</p>
      <div className="mt-4">
        {moduleId === "map" && <Map />}
        {moduleId === "input" && (
          <Knob label="Input gain" value={params.inputGainDb} min={-12} max={12} step={0.1} unit=" dB" onChange={(inputGainDb) => set({ inputGainDb })} />
        )}
        {moduleId === "eq" && (
          <EqControls params={params} curve={curve} onChange={onChange} />
        )}
        {moduleId === "dynamic" && (
          <DynCut
            enabled={params.dynamicEq.enabled}
            freq={params.dynamicEq.freq}
            q={params.dynamicEq.q}
            threshold={params.dynamicEq.thresholdDb}
            maxCut={params.dynamicEq.maxCutDb}
            onToggle={() => set({ dynamicEq: { ...params.dynamicEq, enabled: !params.dynamicEq.enabled } })}
            onFreq={(freq) => set({ dynamicEq: { ...params.dynamicEq, freq, enabled: true } })}
            onQ={(q) => set({ dynamicEq: { ...params.dynamicEq, q } })}
            onThreshold={(thresholdDb) => set({ dynamicEq: { ...params.dynamicEq, thresholdDb, enabled: true } })}
            onCut={(maxCutDb) => set({ dynamicEq: { ...params.dynamicEq, maxCutDb, enabled: true } })}
          />
        )}
        {moduleId === "deess" && (
          <DynCut
            enabled={params.deEss.enabled}
            freq={params.deEss.freq}
            q={params.deEss.q}
            threshold={params.deEss.thresholdDb}
            maxCut={params.deEss.maxCutDb}
            onToggle={() => set({ deEss: { ...params.deEss, enabled: !params.deEss.enabled } })}
            onFreq={(freq) => set({ deEss: { ...params.deEss, freq, enabled: true } })}
            onQ={(q) => set({ deEss: { ...params.deEss, q } })}
            onThreshold={(thresholdDb) => set({ deEss: { ...params.deEss, thresholdDb, enabled: true } })}
            onCut={(maxCutDb) => set({ deEss: { ...params.deEss, maxCutDb, enabled: true } })}
          />
        )}
        {moduleId === "multiband" && <Multiband params={params} onChange={onChange} />}
        {moduleId === "glue" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Toggle on={params.glue.enabled} label={params.glue.enabled ? "Glue on" : "Glue off"} onClick={() => set({ glue: { ...params.glue, enabled: !params.glue.enabled } })} />
            <Knob label="Threshold" value={params.glue.thresholdDb} min={-40} max={0} step={0.5} unit=" dB" onChange={(thresholdDb) => set({ glue: { ...params.glue, thresholdDb, enabled: true } })} />
            <Knob label="Ratio" value={params.glue.ratio} min={1} max={8} step={0.1} unit=":1" onChange={(ratio) => set({ glue: { ...params.glue, ratio, enabled: true } })} />
            <Knob label="Attack" value={params.glue.attackMs} min={1} max={80} step={1} unit=" ms" onChange={(attackMs) => set({ glue: { ...params.glue, attackMs } })} />
            <Knob label="Release" value={params.glue.releaseMs} min={20} max={400} step={1} unit=" ms" onChange={(releaseMs) => set({ glue: { ...params.glue, releaseMs } })} />
            <Knob label="Knee" value={params.glue.kneeDb} min={0} max={18} step={0.5} unit=" dB" onChange={(kneeDb) => set({ glue: { ...params.glue, kneeDb } })} />
            <Knob label="Makeup" value={params.glue.makeupDb} min={-3} max={6} step={0.1} unit=" dB" onChange={(makeupDb) => set({ glue: { ...params.glue, makeupDb } })} />
            <Knob label="Optical" value={params.glue.optical} min={0} max={1} step={0.01} unit="" onChange={(optical) => set({ glue: { ...params.glue, optical, enabled: true } })} />
          </div>
        )}
        {moduleId === "transient" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Toggle
              on={params.transient.enabled}
              label={params.transient.enabled ? "Shaper on" : "Shaper off"}
              onClick={() => set({ transient: { ...params.transient, enabled: !params.transient.enabled } })}
            />
            <Knob label="Attack" value={params.transient.attack} min={-1} max={1} step={0.01} unit="" onChange={(attack) => set({ transient: { ...params.transient, attack, enabled: true } })} />
            <Knob label="Sustain" value={params.transient.sustain} min={-1} max={1} step={0.01} unit="" onChange={(sustain) => set({ transient: { ...params.transient, sustain, enabled: true } })} />
          </div>
        )}
        {moduleId === "saturation" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Toggle
              on={params.saturation.enabled}
              label={params.saturation.enabled ? "Saturation on" : "Saturation off"}
              onClick={() => set({ saturation: { ...params.saturation, enabled: !params.saturation.enabled } })}
            />
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Toggle on={params.saturation.mode === "tape"} label="Tape" onClick={() => set({ saturation: { ...params.saturation, mode: "tape", enabled: true } })} />
              <Toggle on={params.saturation.mode === "tube"} label="Tube" onClick={() => set({ saturation: { ...params.saturation, mode: "tube", enabled: true } })} />
              <Toggle on={params.saturation.mode === "hybrid"} label="Hybrid" onClick={() => set({ saturation: { ...params.saturation, mode: "hybrid", enabled: true } })} />
            </div>
            <Knob label="Drive" value={params.saturation.driveDb} min={0} max={24} step={0.1} unit=" dB" onChange={(driveDb) => set({ saturation: { ...params.saturation, driveDb, enabled: true } })} />
            <Knob label="Mix" value={params.saturation.mix} min={0} max={1} step={0.01} unit="" onChange={(mix) => set({ saturation: { ...params.saturation, mix, enabled: true } })} />
            <Knob label="Memory" value={params.saturation.memory} min={0} max={1} step={0.01} unit="" onChange={(memory) => set({ saturation: { ...params.saturation, memory, enabled: true } })} />
            {params.saturation.mode === "hybrid" && (
              <Knob
                label="Tape amount"
                value={params.saturation.tubeTapeMix}
                min={0}
                max={1}
                step={0.01}
                unit=""
                onChange={(tubeTapeMix) => set({ saturation: { ...params.saturation, tubeTapeMix, enabled: true } })}
              />
            )}
            <Knob label="Low color" value={params.saturation.lowColor} min={-1} max={1} step={0.01} unit="" onChange={(lowColor) => set({ saturation: { ...params.saturation, lowColor, enabled: true } })} />
            <Knob label="High color" value={params.saturation.highColor} min={-1} max={1} step={0.01} unit="" onChange={(highColor) => set({ saturation: { ...params.saturation, highColor, enabled: true } })} />
          </div>
        )}
        {moduleId === "image" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Knob label="Side width" value={params.width} min={0} max={2} step={0.01} unit="×" onChange={(width) => set({ width })} />
            <Knob label="Center carve" value={params.carve} min={0} max={1} step={0.01} unit="" onChange={(carve) => set({ carve })} />
            <Knob label="Carve focus" value={params.carveHz} min={800} max={8000} step={10} unit=" Hz" onChange={(carveHz) => set({ carveHz })} />
          </div>
        )}
        {moduleId === "limiter" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Toggle
              on={params.limiter.enabled}
              label={params.limiter.enabled ? "Limiter on" : "Limiter off"}
              onClick={() => set({ limiter: { ...params.limiter, enabled: !params.limiter.enabled } })}
            />
            <Knob label="Ceiling" value={params.limiter.ceilingDb} min={-3} max={-0.1} step={0.1} unit=" dBTP" onChange={(ceilingDb) => set({ limiter: { ...params.limiter, ceilingDb, enabled: true } })} />
            <Knob label="Release" value={params.limiter.releaseMs} min={10} max={300} step={1} unit=" ms" onChange={(releaseMs) => set({ limiter: { ...params.limiter, releaseMs } })} />
            <Knob label="Lookahead" value={params.limiter.lookaheadMs} min={1} max={10} step={0.5} unit=" ms" onChange={(lookaheadMs) => set({ limiter: { ...params.limiter, lookaheadMs } })} />
          </div>
        )}
      </div>
    </section>
  );
}

function DynCut({
  enabled,
  freq,
  q,
  threshold,
  maxCut,
  onToggle,
  onFreq,
  onQ,
  onThreshold,
  onCut,
}: {
  enabled: boolean;
  freq: number;
  q: number;
  threshold: number;
  maxCut: number;
  onToggle: () => void;
  onFreq: (v: number) => void;
  onQ: (v: number) => void;
  onThreshold: (v: number) => void;
  onCut: (v: number) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Toggle on={enabled} label={enabled ? "Engaged" : "Bypassed"} onClick={onToggle} />
      <Knob label="Frequency" value={freq} min={80} max={16000} step={10} unit=" Hz" onChange={onFreq} />
      <Knob label="Q" value={q} min={0.4} max={6} step={0.1} unit="" onChange={onQ} />
      <Knob label="Threshold" value={threshold} min={-48} max={0} step={0.5} unit=" dB" onChange={onThreshold} />
      <Knob label="Max cut" value={maxCut} min={0} max={12} step={0.1} unit=" dB" onChange={onCut} />
    </div>
  );
}

function EqControls({
  params,
  curve,
  onChange,
}: {
  params: ChainParams;
  curve: { freq: number; db: number }[];
  onChange: (params: ChainParams) => void;
}) {
  const update = (id: string, patch: Partial<EqBand>) => {
    onChange({
      ...params,
      bands: params.bands.map((band) => (band.id === id ? { ...band, ...patch } : band)),
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <EqCurve points={curve} />
      <div className="flex flex-wrap gap-2">
        <Toggle on={params.eqMode === "minimum"} label="Minimum phase" onClick={() => onChange({ ...params, eqMode: "minimum" })} />
        <Toggle on={params.eqMode === "linear"} label="Linear phase" onClick={() => onChange({ ...params, eqMode: "linear" })} />
        <Toggle on={params.eqTarget === "stereo"} label="Stereo" onClick={() => onChange({ ...params, eqTarget: "stereo" })} />
        <Toggle on={params.eqTarget === "mid"} label="Mid" onClick={() => onChange({ ...params, eqTarget: "mid" })} />
        <Toggle on={params.eqTarget === "side"} label="Side" onClick={() => onChange({ ...params, eqTarget: "side" })} />
      </div>
      <div className="flex flex-col gap-4">
        {params.bands.map((band) => (
          <div key={band.id} className="grid gap-3 border-t border-line pt-3 sm:grid-cols-4">
            <Toggle on={band.enabled && (bandIsActive(band) || band.type === "highpass")} label={bandLabel(band)} onClick={() => update(band.id, { enabled: !band.enabled })} />
            <Knob label="Freq" value={band.freq} min={20} max={18000} step={1} unit=" Hz" onChange={(freq) => update(band.id, { freq, enabled: true })} />
            {band.type !== "highpass" && band.type !== "lowpass" ? (
              <Knob label="Gain" value={band.gainDb} min={-12} max={12} step={0.1} unit=" dB" onChange={(gainDb) => update(band.id, { gainDb, enabled: true })} />
            ) : (
              <span className="self-end pb-3 text-xs text-faint">Slope follows Q</span>
            )}
            <Knob label="Q" value={band.q} min={0.3} max={8} step={0.1} unit="" onChange={(q) => update(band.id, { q })} />
          </div>
        ))}
      </div>
    </div>
  );
}

function bandLabel(band: EqBand): string {
  if (band.type === "highpass") return band.enabled ? "High-pass on" : "High-pass";
  if (band.type === "lowshelf") return "Low shelf";
  if (band.type === "highshelf") return "High shelf";
  if (band.id === "mud") return "Body";
  if (band.id === "presence") return "Presence";
  return band.type;
}

function Multiband({ params, onChange }: { params: ChainParams; onChange: (params: ChainParams) => void }) {
  const mb = params.multiband;
  const setBand = (key: "low" | "mid" | "high", thresholdDb: number, ratio: number) => {
    onChange({
      ...params,
      multiband: { ...mb, enabled: true, [key]: { ...mb[key], thresholdDb, ratio } },
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Toggle on={mb.enabled} label={mb.enabled ? "Multiband on" : "Multiband off"} onClick={() => onChange({ ...params, multiband: { ...mb, enabled: !mb.enabled } })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Knob label="Low crossover" value={mb.lowHz} min={60} max={400} step={1} unit=" Hz" onChange={(lowHz) => onChange({ ...params, multiband: { ...mb, lowHz: Math.min(lowHz, mb.highHz - 50) } })} />
        <Knob label="High crossover" value={mb.highHz} min={1000} max={12000} step={10} unit=" Hz" onChange={(highHz) => onChange({ ...params, multiband: { ...mb, highHz: Math.max(highHz, mb.lowHz + 50) } })} />
      </div>
      {(["low", "mid", "high"] as const).map((key) => (
        <div key={key} className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
          <Knob label={`${key} threshold`} value={mb[key].thresholdDb} min={-40} max={0} step={0.5} unit=" dB" onChange={(thresholdDb) => setBand(key, thresholdDb, mb[key].ratio)} />
          <Knob label={`${key} ratio`} value={mb[key].ratio} min={1} max={6} step={0.1} unit=":1" onChange={(ratio) => setBand(key, mb[key].thresholdDb, ratio)} />
        </div>
      ))}
    </div>
  );
}

function Map() {
  const rows = [
    ["1", "Input gain", "Live"],
    ["2", "EQ, minimum or linear phase, mid/side", "Live"],
    ["3", "Dynamic EQ", "Live"],
    ["4", "Split-band de-esser", "Live"],
    ["5", "3-band linear-phase Linkwitz–Riley", "Live"],
    ["6", "Serial VCA + optical glue", "Live"],
    ["7", "Transient shaper", "Live"],
    ["8", "8× hybrid tape / tube saturation", "Live"],
    ["9", "Width and center-side carve", "Live"],
    ["10", "True-peak lookahead limiter", "Live"],
    ["11", "TPDF dither on 16/24-bit export", "Live"],
    ["—", "Source separation, convolution, automatic master", "Not in this phase"],
  ];
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([n, name, state]) => (
        <div key={name} className="grid grid-cols-[2rem_1fr_auto] items-baseline gap-3 border-b border-line py-2 text-sm">
          <span className="font-mono text-xs text-amber">{n}</span>
          <span>{name}</span>
          <span className={`font-mono text-xs ${state === "Live" ? "text-muted" : "text-faint"}`}>{state}</span>
        </div>
      ))}
      <p className="pt-2 text-sm text-pretty text-muted">
        Internal math is 64-bit. Export is 32-bit float, or dithered 24- or 16-bit. The audible engine is this chain. A C++ node checks the cookbook biquad and a unity-gain tanh. Browser saturation is the 8× hybrid model, not that tanh. Nothing here is a plugin host.
      </p>
    </div>
  );
}
