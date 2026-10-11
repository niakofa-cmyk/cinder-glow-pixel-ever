/** Playback clip. Float32 is exact for 24-bit audio and half the memory of the Float64 DSP path. */
export type Clip = {
  l: Float32Array;
  r: Float32Array;
  sampleRate: number;
};

/** Planar stereo at the file's native sample rate. Internal processing is Float64. */
export type Stereo = {
  l: Float64Array;
  r: Float64Array;
  sampleRate: number;
};

export type BiquadType =
  | "peaking"
  | "lowshelf"
  | "highshelf"
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "notch";

export type BiquadCoeffs = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

export type EqBand = {
  id: string;
  type: BiquadType;
  freq: number;
  gainDb: number;
  q: number;
  enabled: boolean;
};

export type DynamicsBand = {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  makeupDb: number;
};

export type ChainParams = {
  inputGainDb: number;
  eqMode: "minimum" | "linear";
  eqTarget: "stereo" | "mid" | "side";
  bands: EqBand[];
  dynamicEq: {
    enabled: boolean;
    freq: number;
    q: number;
    thresholdDb: number;
    ratio: number;
    attackMs: number;
    releaseMs: number;
    maxCutDb: number;
  };
  deEss: {
    enabled: boolean;
    freq: number;
    q: number;
    thresholdDb: number;
    ratio: number;
    attackMs: number;
    releaseMs: number;
    maxCutDb: number;
  };
  multiband: {
    enabled: boolean;
    lowHz: number;
    highHz: number;
    low: DynamicsBand;
    mid: DynamicsBand;
    high: DynamicsBand;
  };
  glue: { enabled: boolean; optical: number } & DynamicsBand;
  transient: { enabled: boolean; attack: number; sustain: number };
  saturation: {
    enabled: boolean;
    mode: "tape" | "tube" | "hybrid";
    driveDb: number;
    mix: number;
    /** 0 is the static curve. 1 leans on the hysteresis play operator. */
    memory: number;
    /** −1..1 pre-emphasis into the clipper. */
    lowColor: number;
    highColor: number;
    /** Hybrid blend. 0 tube, 1 tape. */
    tubeTapeMix: number;
  };
  width: number;
  /** 0 bypasses the side-band duck. 1 ducks the focus band fully when center is loud. */
  carve: number;
  carveHz: number;
  limiter: {
    enabled: boolean;
    ceilingDb: number;
    releaseMs: number;
    lookaheadMs: number;
  };
};

export type ThirdOctave = { freq: number; db: number };

export type Resonance = {
  freq: number;
  excessDb: number;
  levelDb: number;
};

export type Analysis = {
  sampleRate: number;
  durationSec: number;
  channels: number;
  integratedLufs: number;
  shortTermMaxLufs: number;
  momentaryMaxLufs: number;
  loudnessRange: number;
  samplePeakDb: number;
  truePeakDb: number;
  crestDb: number;
  rmsDb: number;
  correlation: number;
  dcL: number;
  dcR: number;
  clippedSamples: number;
  sideEnergyRatio: number;
  subEnergyRatio: number;
  presenceDb: number;
  sibilanceDb: number;
  thirds: ThirdOctave[];
  resonances: Resonance[];
  spectrumDb: Float64Array;
  spectrumFreq0: number;
  spectrumBinHz: number;
};

export type Finding = {
  id: string;
  title: string;
  evidence: string;
  action: string;
  sideEffect: string;
  confidence: "low" | "medium" | "high";
  /** Partial parameter patch the user can audition. Empty if listen-only. */
  patch: Partial<ChainParams> | null;
};

export type ProcessReport = {
  samplePeakInDb: number;
  samplePeakOutDb: number;
  truePeakInDb: number;
  truePeakOutDb: number;
  integratedIn: number;
  integratedOut: number;
  limiterReductionDb: number;
  glueReductionDb: number;
  latencySamples: number;
  notes: string[];
};

export const STREAMING_TARGETS: { id: string; name: string; lufs: number; truePeak: number }[] = [
  { id: "spotify", name: "Spotify / YouTube", lufs: -14, truePeak: -1 },
  { id: "apple", name: "Apple Music", lufs: -16, truePeak: -1 },
  { id: "amazon", name: "Amazon Music", lufs: -14, truePeak: -2 },
  { id: "ebu", name: "EBU R 128 broadcast", lufs: -23, truePeak: -1 },
  { id: "hot", name: "Hot / club (optional)", lufs: -9, truePeak: -1 },
];
