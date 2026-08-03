import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";

import { streamUrl } from "~/api/client";
import type { Track } from "~/api/schemas";
import * as queue from "~/engine/queue";
import type { EngineTrack, RhythmEngine } from "~/engine/types";
import { WebAudioEngine } from "~/engine/webAudioEngine";
import {
  createQueueStore,
  selectCurrent,
  selectCurrentId,
  selectHasNext,
  selectUpcomingId,
  type QueueStore
} from "~/stores/queueStore";
import {
  ActionsContext,
  EngineContext,
  QueueStoreContext,
  selectDuration,
  selectStatus,
  useEngine,
  useEngineState,
  usePlayerActions,
  useQueue,
  type PlayerActions
} from "./context";
import { useKeyboardControls } from "./useKeyboardControls";
import { useMediaSession } from "./useMediaSession";

/** Owns the engine and queue store and coordinates their state. */

/** Restart the current track rather than stepping back after this point. */
const RESTART_THRESHOLD_SECONDS = 3;
const SEEK_STEP_SECONDS = 5;

function toEngineTrack(track: Track): EngineTrack {
  return { id: track.id, name: track.name, ext: track.ext };
}

export function PlayerProvider({
  children,
  engine: injected,
  store: injectedStore
}: {
  children: ReactNode;
  /** Test seam: supply a fake engine instead of the Web Audio one. */
  engine?: RhythmEngine;
  /** Test seam: supply a pre-seeded store. */
  store?: QueueStore;
}) {
  const createEngine = useCallback(
    (): RhythmEngine => injected ?? new WebAudioEngine({ streamUrl }),
    [injected]
  );

  // StrictMode replays effect cleanup on the same mount. State lets cleanup
  // replace the disposed engine before effects are set up again.
  const [engine, setEngine] = useState<RhythmEngine>(createEngine);

  useEffect(() => {
    return () => {
      void engine.dispose();
      setEngine((live) => (live === engine ? createEngine() : live));
    };
  }, [engine, createEngine]);

  // Each provider owns its queue to prevent cross-player state leakage.
  const [store] = useState<QueueStore>(
    () => injectedStore ?? createQueueStore()
  );

  return (
    <EngineContext.Provider value={engine}>
      <QueueStoreContext.Provider value={store}>
        <PlayerWiring engine={engine} store={store}>
          {children}
        </PlayerWiring>
      </QueueStoreContext.Provider>
    </EngineContext.Provider>
  );
}

/** Isolates coordination subscriptions from the child application tree. */
function PlayerWiring({
  children,
  engine,
  store
}: {
  children: ReactNode;
  engine: RhythmEngine;
  store: QueueStore;
}) {
  const actions = useMemo<PlayerActions>(() => {
    const state = () => store.getState();
    return {
      play: (tracks, startIndex, fromPath) =>
        state().play(tracks, startIndex, fromPath),
      playAt: (index) => state().playAt(index),
      toggle: () => {
        const status = engine.getSnapshot().status;
        if (status === "playing" || status === "loading") engine.pause();
        else void engine.play();
      },
      next: () => state().next(),
      previous: () => {
        if (engine.getPosition() > RESTART_THRESHOLD_SECONDS) {
          engine.seek(0);
          return;
        }
        if (queue.hasPrevious(state())) state().previous();
        else engine.seek(0);
      },
      seek: (seconds) => engine.seek(seconds),
      setVolume: (volume) => engine.setVolume(volume),
      setCrossfade: (seconds) => engine.setCrossfade(seconds),
      setDsp: (settings) => engine.setDsp(settings),
      playNext: (track) => state().insertNext(track),
      addToQueue: (track) => state().append(track),
      removeAt: (index) => state().removeAt(index),
      reorder: (from, to) => state().reorder(from, to),
      clearQueue: () => state().clear(),
      getPosition: () => engine.getPosition(),
      getBuffered: () => engine.getLoaded()
    };
  }, [engine, store]);

  // Id-only subscriptions avoid reloads when queue edits preserve the tracks.
  const currentId = useStore(store, selectCurrentId);
  const upcomingId = useStore(store, selectUpcomingId);

  // Do not reload a successor that the engine has already started gaplessly.
  useEffect(() => {
    const track = queue.current(store.getState());
    if (!track) {
      engine.stop();
      return;
    }
    if (engine.getSnapshot().trackId === track.id) return;
    void engine.load(toEngineTrack(track));
  }, [engine, store, currentId]);

  useEffect(() => {
    const upcoming = queue.peekNext(store.getState());
    engine.setNext(upcoming ? toEngineTrack(upcoming) : null);
  }, [engine, store, upcomingId]);

  useEffect(() => {
    return engine.on("advanced", (trackId) =>
      store.getState().advanceTo(trackId)
    );
  }, [engine, store]);

  // Fall back to a normal load when the successor was not ready at the boundary.
  useEffect(() => {
    return engine.on("ended", () => store.getState().advanceIfPossible());
  }, [engine, store]);

  return (
    <ActionsContext.Provider value={actions}>
      <PlayerIntegrations />
      {children}
    </ActionsContext.Provider>
  );
}

/** Isolates keyboard and MediaSession subscriptions from the application tree. */
function PlayerIntegrations() {
  const engine = useEngine();
  const actions = usePlayerActions();
  const current = useQueue(selectCurrent);
  const hasNext = useQueue(selectHasNext);
  const status = useEngineState(selectStatus);
  const duration = useEngineState(selectDuration);

  useMediaSession({
    track: current,
    status,
    duration,
    hasNext,
    hasPrevious: current !== null,
    getPosition: actions.getPosition,
    onPlay: () => void engine.play(),
    onPause: () => engine.pause(),
    onNext: actions.next,
    onPrevious: actions.previous,
    onSeek: actions.seek
  });

  useKeyboardControls({
    enabled: current !== null,
    onToggle: actions.toggle,
    onSeekBy: (delta) => engine.seek(engine.getPosition() + delta),
    onVolumeBy: (delta) =>
      engine.setVolume(engine.getSnapshot().volume + delta),
    seekStep: SEEK_STEP_SECONDS
  });

  return null;
}
