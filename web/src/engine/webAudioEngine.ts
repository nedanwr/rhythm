import { BufferCache } from "./buffers";
import { dspEquals, normalizeDsp } from "./dsp";
import { PlaybackGraph } from "./graph";
import { isAbort, LoadError, loadTrack } from "./load";
import { equalPowerCurve, planTransition, positionAt } from "./scheduler";
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
} from "./types";

/**
 * Schedules decoded buffers against the audio clock for gapless transitions.
 * Pausing suspends the context so already-scheduled transitions remain valid.
 */

export interface WebAudioEngineOptions {
  /** Builds the audio context. Injected so tests can supply a fake. */
  readonly createContext?: () => AudioContext;
  /** Maps a track id to the URL its bytes come from. */
  readonly streamUrl: (id: string) => string;
}

/** One playing or scheduled source, with the gain used to fade it. */
interface Voice {
  readonly track: EngineTrack;
  readonly buffer: AudioBuffer;
  readonly source: AudioBufferSourceNode;
  readonly fade: GainNode;
  /** Context time the source was started at. */
  readonly startedAt: number;
  /** Offset into the buffer that `startedAt` corresponds to. */
  readonly offset: number;
}

interface Prepared {
  readonly track: EngineTrack;
  readonly buffer: AudioBuffer;
}

export class WebAudioEngine implements RhythmEngine {
  private readonly options: WebAudioEngineOptions;
  private context: AudioContext | null = null;
  private graph: PlaybackGraph | null = null;
  private readonly cache = new BufferCache();

  private currentVoice: Voice | null = null;
  /** The next track, decoded and waiting to be scheduled. */
  private prepared: Prepared | null = null;
  /** The next track's source, already scheduled on the audio clock. */
  private scheduledVoice: Voice | null = null;
  /** What `setNext` last asked for, whether or not it has loaded. */
  private nextTrack: EngineTrack | null = null;

  private currentLoad: AbortController | null = null;
  private nextLoad: AbortController | null = null;
  /** Rejects stale results when loads overlap. */
  private loadGeneration = 0;

  private status: EngineStatus = "idle";
  private track: EngineTrack | null = null;
  private duration = 0;
  private volume = 1;
  private error: EngineError | null = null;
  private crossfadeSeconds = 0;
  private dsp: DspSettings = DEFAULT_DSP;
  private inserts: readonly InsertFactory[] = [];

  private loadedBytes = 0;
  private totalBytes: number | null = null;
  /** Pause pressed while a track was still downloading; honored on arrival. */
  private pauseWhenReady = false;

  private snapshot: EngineSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly handlers: {
    [K in keyof EngineEvents]: Set<EngineEvents[K]>;
  } = { ended: new Set(), advanced: new Set() };

  private disposed = false;

  constructor(options: WebAudioEngineOptions) {
    this.options = options;
    this.snapshot = this.buildSnapshot();
  }

  private ensureContext(): { context: AudioContext; graph: PlaybackGraph } {
    if (this.context && this.graph) {
      return { context: this.context, graph: this.graph };
    }
    const create = this.options.createContext ?? (() => new AudioContext());
    const context = create();
    const graph = new PlaybackGraph(context);
    graph.setVolume(this.volume);
    graph.setDsp(this.dsp);
    graph.setInserts(this.inserts);
    this.context = context;
    this.graph = graph;
    return { context, graph };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.stop();
    this.graph?.dispose();
    this.graph = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // The context is already unusable if close fails.
      }
    }
    this.listeners.clear();
    this.handlers.ended.clear();
    this.handlers.advanced.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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

  getSnapshot(): EngineSnapshot {
    return this.snapshot;
  }

  private buildSnapshot(): EngineSnapshot {
    return {
      status: this.status,
      trackId: this.track?.id ?? null,
      duration: this.duration,
      volume: this.volume,
      error: this.error,
      crossfadeSeconds: this.crossfadeSeconds,
      dsp: this.dsp
    };
  }

  private emit(): void {
    const next = this.buildSnapshot();
    const previous = this.snapshot;
    if (
      next.status === previous.status &&
      next.trackId === previous.trackId &&
      next.duration === previous.duration &&
      next.volume === previous.volume &&
      next.error === previous.error &&
      next.crossfadeSeconds === previous.crossfadeSeconds &&
      dspEquals(next.dsp, previous.dsp)
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }

  private fire<K extends keyof EngineEvents>(
    event: K,
    ...args: Parameters<EngineEvents[K]>
  ): void {
    for (const handler of [...this.handlers[event]]) {
      (handler as (...a: Parameters<EngineEvents[K]>) => void)(...args);
    }
  }

  async load(
    track: EngineTrack,
    options?: { startAt?: number }
  ): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.loadGeneration;

    this.cancelCurrentLoad();
    this.teardownVoices();
    // A replacement load invalidates the old track's successor.
    this.cancelNextLoad();
    this.nextTrack = null;
    this.prepared = null;

    this.track = track;
    this.duration = 0;
    this.error = null;
    this.status = "loading";
    this.loadedBytes = 0;
    this.totalBytes = null;
    this.pauseWhenReady = false;
    this.emit();

    const { context, graph } = this.ensureContext();

    let buffer = this.cache.get(track.id);
    if (!buffer) {
      const controller = new AbortController();
      this.currentLoad = controller;
      try {
        buffer = await loadTrack({
          url: this.options.streamUrl(track.id),
          name: track.name,
          ext: track.ext,
          context,
          signal: controller.signal,
          onProgress: (loaded, total) => {
            if (generation !== this.loadGeneration) return;
            this.loadedBytes = loaded;
            this.totalBytes = total;
          }
        });
      } catch (cause) {
        if (generation !== this.loadGeneration || isAbort(cause)) return;
        this.failWith(cause, track);
        return;
      } finally {
        if (this.currentLoad === controller) this.currentLoad = null;
      }
      if (generation !== this.loadGeneration) return;
      this.cache.set(track.id, buffer);
    }

    // The provider may have disposed the engine while the load was in flight.
    if (this.disposed) return;

    this.duration = buffer.duration;
    this.currentVoice = this.startVoice(graph, track, buffer, {
      offset: clampOffset(options?.startAt ?? 0, buffer.duration),
      when: context.currentTime
    });
    this.retainBuffers();
    if (this.pauseWhenReady) {
      // Starting on a suspended context preserves a pause requested mid-load.
      this.pauseWhenReady = false;
      this.status = "paused";
      if (context.state !== "suspended") await context.suspend();
    } else {
      await this.resumeContext();
    }
    this.armTransition();
    this.emit();
  }

  setNext(track: EngineTrack | null): void {
    if (this.disposed) return;
    if (track && this.nextTrack && track.id === this.nextTrack.id) return;

    this.nextTrack = track;
    this.disarmTransition();
    this.cancelNextLoad();
    this.prepared = null;

    if (!track) {
      this.retainBuffers();
      return;
    }

    const cached = this.cache.get(track.id);
    if (cached) {
      this.prepared = { track, buffer: cached };
      this.armTransition();
      return;
    }
    void this.prefetch(track);
  }

  private async prefetch(track: EngineTrack): Promise<void> {
    const { context } = this.ensureContext();
    const controller = new AbortController();
    this.nextLoad = controller;
    try {
      const buffer = await loadTrack({
        url: this.options.streamUrl(track.id),
        name: track.name,
        ext: track.ext,
        context,
        signal: controller.signal
      });
      // Ignore a prefetch result after the requested successor changes.
      if (this.nextTrack?.id !== track.id) return;
      this.cache.set(track.id, buffer);
      this.prepared = { track, buffer };
      this.retainBuffers();
      this.armTransition();
    } catch (cause) {
      // Prefetch failures surface only if the track is later loaded directly.
      if (isAbort(cause)) return;
    } finally {
      if (this.nextLoad === controller) this.nextLoad = null;
    }
  }

  private failWith(cause: unknown, track: EngineTrack): void {
    const kind = cause instanceof LoadError ? cause.kind : "decode";
    const message =
      cause instanceof LoadError
        ? cause.message
        : `Rhythm could not play “${track.name}”.`;
    this.error = { kind, message, trackId: track.id };
    this.status = "idle";
    this.duration = 0;
    this.emit();
  }

  private startVoice(
    graph: PlaybackGraph,
    track: EngineTrack,
    buffer: AudioBuffer,
    at: { offset: number; when: number; fadeIn?: number }
  ): Voice {
    const context = graph.context;
    const fade = context.createGain();
    fade.connect(graph.input);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(fade);

    if (at.fadeIn && at.fadeIn > 0) {
      fade.gain.value = 0;
      fade.gain.setValueCurveAtTime(equalPowerCurve("in"), at.when, at.fadeIn);
    } else {
      fade.gain.value = 1;
    }

    source.start(at.when, at.offset);

    const voice: Voice = {
      track,
      buffer,
      source,
      fade,
      startedAt: at.when,
      offset: at.offset
    };
    source.onended = () => {
      try {
        source.disconnect();
        fade.disconnect();
      } catch {
        // Teardown may already have detached the nodes.
      }
      // Deliberately stopped sources also emit `ended`; only the active voice
      // represents a real track boundary.
      if (this.currentVoice === voice) this.handleBoundary(voice);
    };
    return voice;
  }

  /** Promotes an already-playing successor or reports the end of playback. */
  private handleBoundary(finished: Voice): void {
    this.currentVoice = null;

    const incoming = this.scheduledVoice;
    if (incoming) {
      this.scheduledVoice = null;
      this.prepared = null;
      this.nextTrack = null;
      this.currentVoice = incoming;
      this.track = incoming.track;
      this.duration = incoming.buffer.duration;
      this.status = "playing";
      this.retainBuffers();
      this.emit();
      this.fire("advanced", incoming.track.id);
      return;
    }

    this.status = "idle";
    this.emit();
    this.fire("ended", finished.track.id);
  }

  /**
   * Schedules the prepared next track to start exactly when the current buffer
   * runs out (or `crossfadeSeconds` before it, with equal-power ramps).
   */
  private armTransition(): void {
    const graph = this.graph;
    const context = this.context;
    const voice = this.currentVoice;
    const prepared = this.prepared;
    if (!graph || !context || !voice || !prepared) return;
    if (this.scheduledVoice) return;

    const plan = planTransition({
      startedAt: voice.startedAt,
      offset: voice.offset,
      duration: voice.buffer.duration,
      nextDuration: prepared.buffer.duration,
      crossfadeSeconds: this.crossfadeSeconds,
      now: context.currentTime
    });

    if (plan.overlap > 0) {
      voice.fade.gain.setValueCurveAtTime(
        equalPowerCurve("out"),
        plan.startNextAt,
        plan.overlap
      );
    }

    this.scheduledVoice = this.startVoice(
      graph,
      prepared.track,
      prepared.buffer,
      {
        offset: 0,
        when: plan.startNextAt,
        ...(plan.overlap > 0 ? { fadeIn: plan.overlap } : {})
      }
    );
  }

  /** Cancels a scheduled next source, e.g. because the queue changed. */
  private disarmTransition(): void {
    const scheduled = this.scheduledVoice;
    if (!scheduled) return;
    this.scheduledVoice = null;
    stopVoice(scheduled);

    // Disarming mid-fade must restore gain without introducing a click.
    const voice = this.currentVoice;
    const context = this.context;
    if (voice && context) {
      voice.fade.gain.cancelScheduledValues(context.currentTime);
      voice.fade.gain.setTargetAtTime(1, context.currentTime, 0.015);
    }
  }

  async play(): Promise<void> {
    if (this.disposed) return;
    if (!this.track) return;

    // Retract a pending pause without restarting the in-flight load.
    if (this.pauseWhenReady) {
      this.pauseWhenReady = false;
      this.status = "loading";
      this.emit();
      return;
    }

    if (!this.currentVoice) {
      await this.load(this.track);
      return;
    }
    await this.resumeContext();
    this.emit();
  }

  pause(): void {
    if (this.status === "loading") {
      this.pauseWhenReady = true;
      this.status = "paused";
      this.emit();
      return;
    }
    const context = this.context;
    if (!context || !this.currentVoice) return;
    if (context.state === "suspended") return;
    this.status = "paused";
    this.emit();
    void context.suspend();
  }

  private async resumeContext(): Promise<void> {
    const context = this.context;
    if (!context) return;
    try {
      if (context.state === "suspended") await context.resume();
    } catch {
      // The state check below records a blocked resume.
    }
    if (this.disposed) return;
    if (context.state === "running") {
      this.status = "playing";
      if (this.error?.kind === "blocked") this.error = null;
    } else {
      this.status = "paused";
      this.error = {
        kind: "blocked",
        message:
          "Your browser blocked audio until you interact with the page. " +
          "Press play again.",
        trackId: this.track?.id ?? null
      };
    }
    this.emit();
  }

  seek(seconds: number): void {
    const voice = this.currentVoice;
    const graph = this.graph;
    const context = this.context;
    if (!voice || !graph || !context || !Number.isFinite(seconds)) return;

    const offset = clampOffset(seconds, voice.buffer.duration);
    const wasPaused = context.state === "suspended";

    // Seeking invalidates the scheduled successor's timing.
    this.disarmTransition();
    stopVoice(voice);
    this.currentVoice = this.startVoice(graph, voice.track, voice.buffer, {
      offset,
      when: context.currentTime
    });
    this.armTransition();

    // A source started on a suspended context remains paused at the new offset.
    if (!wasPaused && this.status !== "playing") {
      this.status = "playing";
      this.emit();
    }
  }

  stop(): void {
    this.cancelCurrentLoad();
    this.cancelNextLoad();
    this.teardownVoices();
    this.cache.clear();
    this.nextTrack = null;
    this.prepared = null;
    this.track = null;
    this.duration = 0;
    this.status = "idle";
    this.loadedBytes = 0;
    this.totalBytes = null;
    this.emit();
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.min(Math.max(volume, 0), 1);
    this.graph?.setVolume(this.volume);
    this.emit();
  }

  setCrossfade(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.crossfadeSeconds = seconds;
    // An armed transition was calculated with the previous crossfade.
    this.disarmTransition();
    this.armTransition();
    this.emit();
  }

  setDsp(settings: DspSettings): void {
    const next = normalizeDsp(settings);
    // Skip graph updates and notifications for equivalent settings.
    if (dspEquals(next, this.dsp)) return;
    this.dsp = next;
    this.graph?.setDsp(next);
    this.emit();
  }

  setInserts(factories: readonly InsertFactory[]): void {
    this.inserts = factories;
    this.graph?.setInserts(factories);
  }

  getPosition(): number {
    const voice = this.currentVoice;
    const context = this.context;
    if (!voice || !context) return 0;
    return positionAt(
      context.currentTime,
      voice.startedAt,
      voice.offset,
      voice.buffer.duration
    );
  }

  getLoaded(): number {
    if (this.currentVoice) return this.duration;
    if (this.totalBytes === null || this.totalBytes <= 0) return 0;
    const fraction = Math.min(this.loadedBytes / this.totalBytes, 1);
    return this.duration * fraction;
  }

  /** Number of decoded buffers currently retained. */
  get decodedBufferCount(): number {
    return this.cache.size;
  }

  get graphDsp(): DspSettings | null {
    return this.graph?.dsp ?? null;
  }

  private retainBuffers(): void {
    this.cache.retain([
      this.currentVoice?.track.id ?? this.track?.id ?? null,
      this.scheduledVoice?.track.id ?? this.prepared?.track.id ?? null
    ]);
  }

  private teardownVoices(): void {
    if (this.currentVoice) stopVoice(this.currentVoice);
    if (this.scheduledVoice) stopVoice(this.scheduledVoice);
    this.currentVoice = null;
    this.scheduledVoice = null;
  }

  private cancelCurrentLoad(): void {
    this.currentLoad?.abort();
    this.currentLoad = null;
  }

  private cancelNextLoad(): void {
    this.nextLoad?.abort();
    this.nextLoad = null;
  }
}

function stopVoice(voice: Voice): void {
  try {
    voice.source.stop();
  } catch {
    // A voice may already have stopped at a boundary.
  }
  try {
    voice.source.disconnect();
    voice.fade.disconnect();
  } catch {
    // Teardown may already have detached the nodes.
  }
}

function clampOffset(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds) || duration <= 0) return 0;
  return Math.min(Math.max(seconds, 0), duration);
}
