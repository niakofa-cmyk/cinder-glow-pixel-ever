/**
 * AudioWorklet entry. Thin on purpose: all DSP lives in engine.ts and all
 * position logic in transport.ts, both of which are tested in Node.
 */
import { RealtimeEngine } from "./engine.ts";
import { PROCESSOR_NAME, type FromWorklet, type ToWorklet } from "./protocol.ts";
import { Transport } from "./transport.ts";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const QUANTUM = 128;
const METER_EVERY = 1 / 30;

class AuroraMaster extends AudioWorkletProcessor {
  private readonly engine = new RealtimeEngine(sampleRate, QUANTUM);
  private readonly transport = new Transport(sampleRate);
  private readonly inL = new Float64Array(QUANTUM);
  private readonly inR = new Float64Array(QUANTUM);
  private readonly refL = new Float64Array(QUANTUM);
  private readonly refR = new Float64Array(QUANTUM);
  private readonly outL = new Float64Array(QUANTUM);
  private readonly outR = new Float64Array(QUANTUM);
  private readonly scope = new Float32Array(2048);
  private pausing = false;
  private sinceMeter = 0;
  private metersOwed = false;
  private controlsBlocked = false;
  private parameterKey: string | null = null;

  constructor() {
    super();
    this.transport.setLatency(this.engine.latency);
    this.port.onmessage = (event: MessageEvent<ToWorklet>) => {
      try { this.onMessage(event.data); }
      catch (error) {
        if (event.data.type === "params") this.controlsBlocked = true;
        this.transport.pause();
        this.engine.silence();
        this.pausing = false;
        this.send({ type: "error", message: error instanceof Error ? error.message : "Live processing failed." });
      }
    };
    this.send({ type: "ready", latencySamples: this.engine.latency });
  }

  private send(message: FromWorklet, transfer: Transferable[] = []): void {
    this.port.postMessage(message, transfer);
  }

  private onMessage(m: ToWorklet): void {
    switch (m.type) {
      case "load": {
        if (m.sampleRate !== sampleRate) {
          this.send({ type: "error", message: `Audio is ${m.sampleRate} Hz but the engine runs at ${sampleRate} Hz.` });
          return;
        }
        this.transport.load(m.slot, m.l, m.r);
        if (m.slot === "program") {
          this.parameterKey = null;
          this.pausing = false;
          this.transport.pause();
          this.engine.reset();
          this.engine.resetMeters();
          this.engine.silence();
          this.metersOwed = true;
        }
        return;
      }
      case "clear-reference":
        this.transport.load("reference", new Float32Array(0), new Float32Array(0));
        this.engine.reset();
        this.metersOwed = true;
        return;
      case "params":
        {
          const key = JSON.stringify(m.params);
          // Cold-start settings must match a static print; live edits still glide.
          // An unchanged resume must not reset stateful saturation.
          this.engine.setParams(m.params, !this.transport.playing && key !== this.parameterKey);
          this.parameterKey = key;
        }
        this.controlsBlocked = false;
        return;
      case "source":
        this.engine.setSource(m.source);
        return;
      case "monitor":
        this.engine.setMonitor(m.mode);
        return;
      case "match":
        this.engine.setMatchGainDb(m.db);
        return;
      case "play":
        if (this.controlsBlocked) throw new Error("Restore supported controls or use rendered playback.");
        this.pausing = false;
        this.transport.play();
        this.engine.fadeMaster(1);
        return;
      case "pause":
        // Keep feeding audio through a short fade so the stop does not click.
        // The last stretch stays inside the engine and resumes seamlessly.
        if (this.transport.playing) {
          this.pausing = true;
          // Exactly four render quanta, so the fade ends on a block edge and no audio is
          // consumed at zero gain. Resuming then continues from the very next sample.
          this.engine.fadeMaster(0, ((4 * QUANTUM) / sampleRate) * 1000);
        }
        return;
      case "seek": {
        this.transport.seek(m.seconds);
        this.engine.reset();
        if (this.transport.playing) this.engine.fadeIn();
        else this.engine.silence();
        this.metersOwed = true;
        return;
      }
      case "loop":
        this.transport.setLoop(m.start, m.end);
        return;
      case "reset-meters":
        this.engine.resetMeters();
        return;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const left = out?.[0];
    if (!out || !left) return true;
    const right = out[1] ?? left;
    const n = left.length;
    const t = this.transport;
    const e = this.engine;

    if (this.pausing && e.masterSettledSilent) {
      t.pause();
      this.pausing = false;
      this.metersOwed = true;
    }

    if (t.playing) {
      const withRef = t.hasReference;
      const pulled = t.pull(n, this.inL, this.inR, withRef ? this.refL : null, withRef ? this.refR : null);
      e.process(this.inL, this.inR, withRef ? this.refL : null, withRef ? this.refR : null, n, this.outL, this.outR);
      for (let i = 0; i < n; i++) {
        left[i] = this.outL[i] as number;
        right[i] = this.outR[i] as number;
      }
      if (pulled.ended) {
        e.reset();
        e.silence();
        this.send({ type: "ended" });
        this.metersOwed = true;
      }
    } else {
      left.fill(0);
      if (right !== left) right.fill(0);
    }

    this.sinceMeter += n / sampleRate;
    if ((t.playing && this.sinceMeter >= METER_EVERY) || this.metersOwed) {
      this.sinceMeter = 0;
      this.metersOwed = false;
      e.scopeInto(this.scope);
      const scope = this.scope.slice();
      this.send(
        { type: "meters", frame: t.position, length: t.length, playing: t.playing, meters: e.meters(), scope },
        [scope.buffer],
      );
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, AuroraMaster);
