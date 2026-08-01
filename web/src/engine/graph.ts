import {
  DEFAULT_DSP,
  type DspSettings,
  type Insert,
  type InsertFactory
} from "./types";
import { dbToGain } from "./scheduler";

/**
 * Signal path: sources → mix bus → [preamp → inserts] → master → destination.
 * Bypass removes the bracketed chain; master gain always remains last.
 */
export class PlaybackGraph {
  readonly context: BaseAudioContext;

  private readonly destination: AudioNode;
  /** Stable connection point for every source. */
  private readonly mixBus: GainNode;
  private readonly preamp: GainNode;
  private readonly master: GainNode;
  private inserts: Insert[] = [];
  private dsp: DspSettings = DEFAULT_DSP;

  constructor(context: BaseAudioContext, destination?: AudioNode) {
    this.context = context;
    this.destination = destination ?? context.destination;
    this.mixBus = context.createGain();
    this.preamp = context.createGain();
    this.master = context.createGain();
    this.master.connect(this.destination);
    this.rebuild();
  }

  /** Where per-source fade gains connect. */
  get input(): AudioNode {
    return this.mixBus;
  }

  setVolume(volume: number): void {
    const clamped = Math.min(Math.max(volume, 0), 1);
    // Ramping avoids clicks from discontinuous gain changes.
    this.master.gain.setTargetAtTime(clamped, this.context.currentTime, 0.015);
  }

  setDsp(settings: DspSettings): void {
    this.dsp = settings;
    this.rebuild();
  }

  /** Replaces the insert chain, disposing whatever was there. */
  setInserts(factories: readonly InsertFactory[]): void {
    for (const insert of this.inserts) {
      insert.input.disconnect();
      insert.output.disconnect();
      insert.dispose();
    }
    this.inserts = factories.map((factory) => factory(this.context));
    this.rebuild();
  }

  private rebuild(): void {
    this.mixBus.disconnect();
    this.preamp.disconnect();
    for (const insert of this.inserts) insert.output.disconnect();

    if (this.dsp.bypass) {
      this.mixBus.connect(this.master);
      return;
    }

    this.preamp.gain.value = dbToGain(this.dsp.preampDb);
    this.mixBus.connect(this.preamp);

    let tail: AudioNode = this.preamp;
    for (const insert of this.inserts) {
      tail.connect(insert.input);
      tail = insert.output;
    }
    tail.connect(this.master);
  }

  dispose(): void {
    this.setInserts([]);
    this.mixBus.disconnect();
    this.preamp.disconnect();
    this.master.disconnect();
  }
}
