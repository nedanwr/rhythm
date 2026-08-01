import { createStore, type StoreApi } from "zustand/vanilla";

import type { Track } from "~/api/schemas";
import * as queue from "~/engine/queue";
import type { QueueState } from "~/engine/queue";

/** Per-player Zustand store delegating transitions to the pure queue module. */

export interface QueueActions {
  /** Replaces the queue, starting at `startIndex`. */
  play(tracks: readonly Track[], startIndex: number, fromPath: string): void;
  /** Selects an existing entry. Out-of-range targets are ignored. */
  playAt(index: number): void;
  next(): void;
  previous(): void;
  /** Queues a track directly after the current one. */
  insertNext(track: Track): void;
  /** Appends to the end of the queue. */
  append(track: Track): void;
  removeAt(index: number): void;
  reorder(from: number, to: number): void;
  clear(): void;
  /** Advances only when `trackId` is still the expected successor. */
  advanceTo(trackId: string): void;
  /** Steps forward if anything follows. Used when a track ended unscheduled. */
  advanceIfPossible(): void;
}

export type QueueSlice = QueueState<Track> & QueueActions;

export type QueueStore = StoreApi<QueueSlice>;

export function createQueueStore(initial?: QueueState<Track>): QueueStore {
  return createStore<QueueSlice>()((set) => ({
    ...(initial ?? queue.emptyQueue<Track>()),

    play: (tracks, startIndex, fromPath) =>
      set((state) => queue.play(state, tracks, startIndex, fromPath)),
    playAt: (index) => set((state) => queue.playAt(state, index)),
    next: () => set((state) => queue.next(state)),
    previous: () => set((state) => queue.previous(state)),
    insertNext: (track) => set((state) => queue.insertNext(state, track)),
    append: (track) => set((state) => queue.append(state, track)),
    removeAt: (index) => set((state) => queue.removeAt(state, index)),
    reorder: (from, to) => set((state) => queue.reorder(state, from, to)),
    clear: () => set(() => queue.clear<Track>()),

    advanceTo: (trackId) =>
      set((state) =>
        queue.peekNext(state)?.id === trackId ? queue.next(state) : state
      ),
    advanceIfPossible: () => set((state) => queue.next(state))
  }));
}

/** Shared selectors keep subscription behavior consistent across consumers. */
export const selectItems = (state: QueueSlice): readonly Track[] => state.items;
export const selectIndex = (state: QueueSlice): number => state.index;
export const selectPath = (state: QueueSlice): string | null => state.path;
export const selectCurrent = (state: QueueSlice): Track | null =>
  queue.current(state);
export const selectCurrentId = (state: QueueSlice): string | null =>
  queue.current(state)?.id ?? null;
export const selectUpcoming = (state: QueueSlice): Track | null =>
  queue.peekNext(state);
export const selectUpcomingId = (state: QueueSlice): string | null =>
  queue.peekNext(state)?.id ?? null;
export const selectHasNext = (state: QueueSlice): boolean =>
  queue.hasNext(state);
export const selectHasPrevious = (state: QueueSlice): boolean =>
  queue.hasPrevious(state);
export const selectCount = (state: QueueSlice): number => state.items.length;
