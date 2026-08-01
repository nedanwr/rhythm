/** Framework-independent playback engine contract. */

/** The minimum an engine needs to know about a track to play it. */
export interface EngineTrack {
  /** Root-qualified file id, as used by `/api/stream/{id}`. */
  readonly id: string;
  /** Display name used in error messages. */
  readonly name: string;
  /** Lowercase extension without the dot, when known. */
  readonly ext?: string | undefined;
}

export type EngineStatus =
  "idle" | "loading" | "playing" | "paused" | "stalled";

/** Why a track could not be played. */
export type EngineErrorKind =
  /** The bytes could not be fetched from the server. */
  | "network"
  /** The bytes arrived but no available decoder understood them. */
  | "decode"
  /** The codec is known and deliberately unsupported in this engine tier. */
  | "unsupported"
  /** The browser refused to start audio without a user gesture. */
  | "blocked";

export interface EngineError {
  readonly kind: EngineErrorKind;
  /** A listener-facing message, never a raw exception string. */
  readonly message: string;
  readonly trackId: string | null;
}

/** DSP settings shared by engine implementations. */
export interface DspSettings {
  /** When true, the insert chain is removed from the signal path. */
  readonly bypass: boolean;
  /** Preamp in dB, applied only when the chain is engaged. */
  readonly preampDb: number;
}

export const DEFAULT_DSP: DspSettings = {
  bypass: true,
  preampDb: 0
};

/** An effects insert whose input and output may be the same node. */
export interface Insert {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** Called when the insert is removed from the chain. */
  dispose(): void;
}

export type InsertFactory = (context: BaseAudioContext) => Insert;

/** Immutable engine state. Position is read separately at frame rate. */
export interface EngineSnapshot {
  readonly status: EngineStatus;
  /** The track currently loaded, playing or paused. */
  readonly trackId: string | null;
  /** Seconds, or 0 before the buffer is decoded. */
  readonly duration: number;
  /** 0–1, master output level. */
  readonly volume: number;
  readonly error: EngineError | null;
  /** Crossfade length in seconds; 0 means gapless butt-joins. */
  readonly crossfadeSeconds: number;
  readonly dsp: DspSettings;
}

export interface EngineEvents {
  /** The current track ended without a scheduled successor. */
  ended: (trackId: string) => void;
  /** Playback crossed into a preloaded track; the queue must update its cursor. */
  advanced: (trackId: string) => void;
}

export interface RhythmEngine {
  /**
   * Loads a track and begins playing it. Any current playback is replaced.
   * Resolves after playback starts or the failure is recorded in the snapshot.
   */
  load(track: EngineTrack, options?: { startAt?: number }): Promise<void>;
  /**
   * Declares what plays after the current track, so it can be fetched and
   * decoded ahead of the boundary. Passing null cancels any pending prefetch.
   */
  setNext(track: EngineTrack | null): void;
  /** Resumes, or restarts the loaded track if it had ended. */
  play(): Promise<void>;
  pause(): void;
  /** Absolute position in seconds, clamped into the track. */
  seek(seconds: number): void;
  /** Master output level, 0–1, applied after every insert. */
  setVolume(volume: number): void;
  setCrossfade(seconds: number): void;
  setDsp(settings: DspSettings): void;
  /** Replaces the insert chain. Existing inserts are disposed. */
  setInserts(factories: readonly InsertFactory[]): void;
  /** Unloads everything and returns to idle. */
  stop(): void;

  /** Current playhead in seconds; safe to call every animation frame. */
  getPosition(): number;
  /**
   * Loaded extent in seconds. The current implementation reports 0 until the
   * whole file is decoded, then reports its duration.
   */
  getLoaded(): number;

  getSnapshot(): EngineSnapshot;
  subscribe(listener: () => void): () => void;
  on<K extends keyof EngineEvents>(
    event: K,
    listener: EngineEvents[K]
  ): () => void;

  /** Releases the audio context, buffers, sources and pending fetches. */
  dispose(): Promise<void>;
}
