import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore
} from "react";
import { useStore } from "zustand";

import type { Track } from "~/api/schemas";
import type { EngineSnapshot, RhythmEngine } from "~/engine/types";
import type { QueueSlice, QueueStore } from "~/stores/queueStore";

/** Separate contexts let consumers subscribe only to the state they render. */

export const EngineContext = createContext<RhythmEngine | null>(null);
export const QueueStoreContext = createContext<QueueStore | null>(null);
export const ActionsContext = createContext<PlayerActions | null>(null);

/** Player commands with stable identity while the engine and store are active. */
export interface PlayerActions {
  play(tracks: readonly Track[], startIndex: number, fromPath: string): void;
  playAt(index: number): void;
  toggle(): void;
  next(): void;
  previous(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  setCrossfade(seconds: number): void;
  playNext(track: Track): void;
  addToQueue(track: Track): void;
  removeAt(index: number): void;
  reorder(from: number, to: number): void;
  clearQueue(): void;
  /** Current position in seconds, read straight from the audio clock. */
  getPosition(): number;
  /**
   * Loaded extent in seconds; currently 0 until decoding finishes, then the
   * full track duration.
   */
  getBuffered(): number;
}

function required<T>(value: T | null, what: string): T {
  if (value === null) {
    throw new Error(`${what} must be used inside a PlayerProvider`);
  }
  return value;
}

export function useEngine(): RhythmEngine {
  return required(useContext(EngineContext), "useEngine");
}

/** Returns commands without subscribing to engine or queue state. */
export function usePlayerActions(): PlayerActions {
  return required(useContext(ActionsContext), "usePlayerActions");
}

export function useQueueStoreApi(): QueueStore {
  return required(useContext(QueueStoreContext), "useQueueStoreApi");
}

/** Subscribes to one queue slice using Zustand's `Object.is` comparison. */
export function useQueue<T>(selector: (state: QueueSlice) => T): T {
  return useStore(useQueueStoreApi(), selector);
}

/**
 * Subscribes to immutable engine snapshots. Position is read imperatively so
 * frame-rate playhead updates do not trigger React renders.
 */
export function useEngineState<T>(
  selector: (snapshot: EngineSnapshot) => T
): T {
  const engine = useEngine();
  // Stable callbacks avoid resubscribing on every render.
  const subscribe = useCallback(
    (listener: () => void) => engine.subscribe(listener),
    [engine]
  );
  const getSnapshot = useCallback(() => engine.getSnapshot(), [engine]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return selector(snapshot);
}

export const selectStatus = (s: EngineSnapshot) => s.status;
export const selectDuration = (s: EngineSnapshot) => s.duration;
export const selectVolume = (s: EngineSnapshot) => s.volume;
export const selectErrorMessage = (s: EngineSnapshot) =>
  s.error?.message ?? null;
export const selectCrossfadeSeconds = (s: EngineSnapshot) => s.crossfadeSeconds;
export const selectEngineTrackId = (s: EngineSnapshot) => s.trackId;
