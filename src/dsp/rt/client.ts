import type { ChainParams, Clip, Stereo } from "../types.ts";
import type { EngineSource, MeterFrame, MonitorMode } from "./engine.ts";
import { PROCESSOR_NAME, type FromWorklet, type ToWorklet } from "./protocol.ts";
// Vite bundles the worklet and its imports into one script and returns its URL.
import workletUrl from "./worklet.ts?worker&url";

export type MasterEvents = {
  onMeters?: (frame: { position: number; length: number; playing: boolean; meters: MeterFrame; scope: Float32Array }) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
};

function toFloat32(x: ArrayLike<number>): Float32Array {
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] as number;
  return y;
}

/** Main-thread handle on the real-time engine running in an AudioWorklet. */
export class RealtimeMaster {
  readonly sampleRate: number;
  latencySamples = 0;
  private readonly ctx: AudioContext;
  private node: AudioWorkletNode | null = null;
  private readonly events: MasterEvents;
  private ready: Promise<void> | null = null;

  constructor(sampleRate: number, events: MasterEvents = {}) {
    this.sampleRate = sampleRate;
    this.events = events;
    this.ctx = new AudioContext({ sampleRate, latencyHint: "interactive" });
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  async start(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.ctx.audioWorklet.addModule(workletUrl);
        const node = new AudioWorkletNode(this.ctx, PROCESSOR_NAME, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        node.port.onmessage = (event: MessageEvent<FromWorklet>) => {
          const m = event.data;
          if (m.type === "ready") this.latencySamples = m.latencySamples;
          else if (m.type === "meters") {
            this.events.onMeters?.({ position: m.frame, length: m.length, playing: m.playing, meters: m.meters, scope: m.scope });
          } else if (m.type === "ended") this.events.onEnded?.();
          else if (m.type === "error") this.events.onError?.(m.message);
        };
        node.connect(this.ctx.destination);
        node.onprocessorerror = () => this.events.onError?.("The live audio processor stopped. Switch to rendered playback or restart live preview.");
        this.node = node;
      })();
    }
    await this.ready;
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  private post(message: ToWorklet, transfer: Transferable[] = []): void {
    this.node?.port.postMessage(message, transfer);
  }

  load(slot: "program" | "reference", audio: Clip | Stereo): void {
    const l = toFloat32(audio.l);
    const r = toFloat32(audio.r);
    this.post({ type: "load", slot, l, r, sampleRate: audio.sampleRate }, [l.buffer, r.buffer]);
  }
  clearReference(): void {
    this.post({ type: "clear-reference" });
  }

  setParams(params: ChainParams): void {
    this.post({ type: "params", params });
  }
  setSource(source: EngineSource): void {
    this.post({ type: "source", source });
  }
  setMonitor(mode: MonitorMode): void {
    this.post({ type: "monitor", mode });
  }
  setMatchGainDb(db: number): void {
    this.post({ type: "match", db });
  }
  play(): void {
    this.post({ type: "play" });
  }
  pause(): void {
    this.post({ type: "pause" });
  }
  seek(seconds: number): void {
    this.post({ type: "seek", seconds });
  }
  setLoop(startFrame: number, endFrame: number): void {
    this.post({ type: "loop", start: startFrame, end: endFrame });
  }
  resetMeters(): void {
    this.post({ type: "reset-meters" });
  }

  get latencyMs(): number {
    return (this.latencySamples / this.sampleRate) * 1000;
  }

  async dispose(): Promise<void> {
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.port.close();
      this.node.disconnect();
    }
    this.node = null;
    if (this.ctx.state !== "closed") await this.ctx.close();
  }
}
