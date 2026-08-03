import { dspEquals, normalizeDsp } from "../dsp";
import {
  DEFAULT_DSP,
  type DspSettings,
  type EngineError,
  type EngineEvents,
  type EngineSnapshot,
  type EngineStatus,
  type EngineTrack,
  type InsertFactory,
  type RhythmEngine
} from "../types";

/** Scriptable engine test double that records commands and exposes state. */
export class FakeEngine implements RhythmEngine {
  readonly loads: { track: EngineTrack; startAt: number }[] = [];
  readonly nextCalls: (EngineTrack | null)[] = [];
  readonly seeks: number[] = [];
  /** Normalized `setDsp` calls, including no-ops. */
  readonly dspCalls: DspSettings[] = [];
  playCalls = 0;
  pauseCalls = 0;
  stopCalls = 0;
  disposeCalls = 0;
  inserts: readonly InsertFactory[] = [];

  position = 0;
  loadedSeconds = 0;
  loadDuration = 180;
  failNextLoad: EngineError | null = null;
  deferLoads = false;

  private pendingTrack: EngineTrack | null = null;
  private snapshot: EngineSnapshot = {
    status: "idle",
    trackId: null,
    duration: 0,
    volume: 1,
    error: null,
    crossfadeSeconds: 0,
    dsp: DEFAULT_DSP
  };
  private readonly listeners = new Set<() => void>();
  private readonly handlers: {
    [K in keyof EngineEvents]: Set<EngineEvents[K]>;
  } = { ended: new Set(), advanced: new Set() };

  getSnapshot(): EngineSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  on<K extends keyof EngineEvents>(
    event: K,
    listener: EngineEvents[K]
  ): () => void {
    this.handlers[event].add(listener);
    return () => {
      this.handlers[event].delete(listener);
    };
  }

  private patch(changes: Partial<EngineSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    for (const listener of [...this.listeners]) listener();
  }

  async load(
    track: EngineTrack,
    options?: { startAt?: number }
  ): Promise<void> {
    this.loads.push({ track, startAt: options?.startAt ?? 0 });
    this.pendingTrack = track;
    this.patch({
      status: "loading",
      trackId: track.id,
      duration: 0,
      error: null
    });
    if (!this.deferLoads) this.settleLoad();
  }

  /** Completes a deferred load, or fails it if `failNextLoad` is set. */
  settleLoad(): void {
    const track = this.pendingTrack;
    if (!track) return;
    this.pendingTrack = null;
    if (this.failNextLoad) {
      const error = this.failNextLoad;
      this.failNextLoad = null;
      this.patch({ status: "idle", duration: 0, error });
      return;
    }
    this.patch({ status: "playing", duration: this.loadDuration, error: null });
  }

  /** Simulates the engine reaching a boundary with a track queued behind it. */
  advanceTo(track: EngineTrack, duration = this.loadDuration): void {
    this.position = 0;
    this.patch({ status: "playing", trackId: track.id, duration, error: null });
    for (const handler of [...this.handlers.advanced]) handler(track.id);
  }

  /** Simulates the queue running out. */
  finish(): void {
    const trackId = this.snapshot.trackId;
    this.patch({ status: "idle" });
    if (trackId) for (const h of [...this.handlers.ended]) h(trackId);
  }

  setStatus(status: EngineStatus): void {
    this.patch({ status });
  }

  setNext(track: EngineTrack | null): void {
    this.nextCalls.push(track);
  }

  async play(): Promise<void> {
    this.playCalls += 1;
    if (this.snapshot.trackId) this.patch({ status: "playing" });
  }

  pause(): void {
    this.pauseCalls += 1;
    this.patch({ status: "paused" });
  }

  seek(seconds: number): void {
    this.seeks.push(seconds);
    this.position = seconds;
  }

  setVolume(volume: number): void {
    this.patch({ volume: Math.min(Math.max(volume, 0), 1) });
  }

  setCrossfade(seconds: number): void {
    this.patch({ crossfadeSeconds: seconds });
  }

  setDsp(dsp: DspSettings): void {
    const next = normalizeDsp(dsp);
    this.dspCalls.push(next);
    if (dspEquals(next, this.snapshot.dsp)) return;
    this.patch({ dsp: next });
  }

  setInserts(factories: readonly InsertFactory[]): void {
    this.inserts = factories;
  }

  stop(): void {
    this.stopCalls += 1;
    this.pendingTrack = null;
    this.patch({ status: "idle", trackId: null, duration: 0 });
  }

  getPosition(): number {
    return this.position;
  }

  getLoaded(): number {
    return this.loadedSeconds;
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
    this.listeners.clear();
  }
}
