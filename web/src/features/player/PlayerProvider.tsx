import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { ReactNode } from "react";

import { streamUrl } from "~/api/client";
import type { Track } from "~/api/schemas";

export type PlayerStatus = "idle" | "playing" | "paused";

export interface PlayerState {
  queue: readonly Track[];
  index: number;
  current: Track | null;
  /** Folder the queue was played from. */
  currentPath: string | null;
  status: PlayerStatus;
  /** Seconds, or 0 until metadata loads. */
  duration: number;
  volume: number;
  error: string | null;

  /** Replaces the queue, starting at `startIndex`. */
  play: (
    tracks: readonly Track[],
    startIndex: number,
    fromPath: string
  ) => void;
  /** Plays an existing queue entry. */
  playAt: (index: number) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  /** Queues a track directly after the current one. */
  playNext: (track: Track) => void;
  /** Appends to the end of the queue. */
  addToQueue: (track: Track) => void;
  removeAt: (index: number) => void;
  reorder: (from: number, to: number) => void;
  clearQueue: () => void;

  /** Current position in seconds, read directly from the audio element. */
  getPosition: () => number;
  /** End of the buffered range containing the playhead, in seconds. */
  getBuffered: () => number;
}

const PlayerContext = createContext<PlayerState | null>(null);

// jsdom does not define the MediaError global.
export const MEDIA_ERR = {
  ABORTED: 1,
  NETWORK: 2,
  DECODE: 3,
  SRC_NOT_SUPPORTED: 4
} as const;

// Chrome uses SRC_NOT_SUPPORTED for unsupported codecs and corrupt files.
export function playbackErrorMessage(
  code: number | undefined,
  name?: string,
  ext?: string
): string {
  const subject = name ? `“${name}”` : "this track";
  switch (code) {
    case MEDIA_ERR.NETWORK:
      return `Lost the connection to the Rhythm server while playing ${subject}.`;
    case MEDIA_ERR.DECODE:
      return `${subject} could not be decoded. The file may be damaged.`;
    default:
      return (
        `Rhythm could not play ${subject}. The file may be damaged, or ` +
        `${ext ? `.${ext}` : "its format"} may need a decoder that arrives with the audio engine.`
      );
  }
}

// Previous restarts after this point instead of selecting the prior track.
const RESTART_THRESHOLD_SECONDS = 3;

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueue] = useState<readonly Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const current = index >= 0 ? (queue[index] ?? null) : null;
  const src = current ? streamUrl(current.id) : null;

  // Event listeners are registered once and need the latest queue state.
  // Related updates stay outside state updaters, which React may invoke twice.
  const queueRef = useRef(queue);
  const indexRef = useRef(index);
  const currentRef = useRef(current);
  queueRef.current = queue;
  indexRef.current = index;
  currentRef.current = current;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    setDuration(0);
    if (!src) {
      audio.removeAttribute("src");
      audio.load();
      setStatus("idle");
      return;
    }
    audio.src = src;
    audio.load();
    void audio.play().catch(() => {
      // Autoplay blocks and interrupted loads reject play(). Decode failures
      // are handled by the error event.
    });
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setStatus("playing");
    const onPause = () => {
      // The ended event also emits pause.
      if (!audio.ended) setStatus("paused");
    };
    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onEnded = () => {
      const nextIndex = indexRef.current + 1;
      if (indexRef.current < 0 || nextIndex >= queueRef.current.length) {
        setStatus("idle");
        return;
      }
      setIndex(nextIndex);
    };
    const onError = () => {
      const track = currentRef.current;
      const code = audio.error?.code;
      // Replacing the source can abort the previous load.
      if (code === MEDIA_ERR.ABORTED) return;
      setError(playbackErrorMessage(code, track?.name, track?.ext));
      setStatus("paused");
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

  const play = useCallback(
    (tracks: readonly Track[], startIndex: number, fromPath: string) => {
      if (tracks.length === 0) return;
      setQueue([...tracks]);
      setCurrentPath(fromPath);
      setIndex(Math.min(Math.max(startIndex, 0), tracks.length - 1));
    },
    []
  );

  const playAt = useCallback((target: number) => {
    if (target < 0 || target >= queueRef.current.length) return;
    setIndex(target);
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentRef.current) return;
    if (audio.paused) {
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, []);

  const next = useCallback(() => {
    const nextIndex = indexRef.current + 1;
    if (indexRef.current < 0 || nextIndex >= queueRef.current.length) return;
    setIndex(nextIndex);
  }, []);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > RESTART_THRESHOLD_SECONDS) {
      audio.currentTime = 0;
      return;
    }
    if (indexRef.current > 0) setIndex(indexRef.current - 1);
    else if (audio) audio.currentTime = 0;
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(seconds)) return;
    const limit = Number.isFinite(audio.duration) ? audio.duration : 0;
    audio.currentTime = Math.min(Math.max(seconds, 0), limit);
  }, []);

  const setVolume = useCallback((next: number) => {
    if (!Number.isFinite(next)) return;
    const clamped = Math.min(Math.max(next, 0), 1);
    const audio = audioRef.current;
    if (audio) audio.volume = clamped;
    setVolumeState(clamped);
  }, []);

  const playNext = useCallback((track: Track) => {
    const existing = queueRef.current;
    if (existing.length === 0 || indexRef.current < 0) {
      setQueue([track]);
      setIndex(0);
      return;
    }
    const copy = [...existing];
    copy.splice(indexRef.current + 1, 0, track);
    setQueue(copy);
  }, []);

  const addToQueue = useCallback((track: Track) => {
    const existing = queueRef.current;
    if (existing.length === 0 || indexRef.current < 0) {
      setQueue([track]);
      setIndex(0);
      return;
    }
    setQueue([...existing, track]);
  }, []);

  const removeAt = useCallback((target: number) => {
    const existing = queueRef.current;
    if (target < 0 || target >= existing.length) return;
    const copy = [...existing];
    copy.splice(target, 1);
    const currentIndex = indexRef.current;

    // Preserve the current track when removal shifts queue indices.
    let nextIndex = currentIndex;
    if (copy.length === 0) {
      nextIndex = -1;
    } else if (target < currentIndex) {
      nextIndex = currentIndex - 1;
    } else if (target === currentIndex) {
      nextIndex = Math.min(currentIndex, copy.length - 1);
    }
    setQueue(copy);
    setIndex(nextIndex);
    if (nextIndex === -1) setCurrentPath(null);
  }, []);

  const reorder = useCallback((from: number, to: number) => {
    const existing = queueRef.current;
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= existing.length ||
      to >= existing.length
    ) {
      return;
    }
    const copy = [...existing];
    const [moved] = copy.splice(from, 1);
    if (moved === undefined) return;
    copy.splice(to, 0, moved);

    // Preserve the current track when reordering shifts queue indices.
    const currentIndex = indexRef.current;
    let nextIndex = currentIndex;
    if (currentIndex === from) nextIndex = to;
    else if (from < currentIndex && to >= currentIndex)
      nextIndex = currentIndex - 1;
    else if (from > currentIndex && to <= currentIndex)
      nextIndex = currentIndex + 1;

    setQueue(copy);
    setIndex(nextIndex);
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setIndex(-1);
    setCurrentPath(null);
  }, []);

  const getPosition = useCallback(() => audioRef.current?.currentTime ?? 0, []);

  const getBuffered = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return 0;
    const ranges = audio.buffered;
    // Earlier buffered ranges can remain after seeking.
    const position = audio.currentTime;
    for (let i = 0; i < ranges.length; i += 1) {
      if (ranges.start(i) <= position + 0.5 && ranges.end(i) >= position) {
        return ranges.end(i);
      }
    }
    return 0;
  }, []);

  const value = useMemo<PlayerState>(
    () => ({
      queue,
      index,
      current,
      currentPath,
      status,
      duration,
      volume,
      error,
      play,
      playAt,
      toggle,
      next,
      previous,
      seek,
      setVolume,
      playNext,
      addToQueue,
      removeAt,
      reorder,
      clearQueue,
      getPosition,
      getBuffered
    }),
    [
      queue,
      index,
      current,
      currentPath,
      status,
      duration,
      volume,
      error,
      play,
      playAt,
      toggle,
      next,
      previous,
      seek,
      setVolume,
      playNext,
      addToQueue,
      removeAt,
      reorder,
      clearQueue,
      getPosition,
      getBuffered
    ]
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {/* Keep audio mounted independently of the player controls. */}
      <audio ref={audioRef} preload="auto" hidden data-testid="player-audio" />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerState {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error("usePlayer must be used inside a PlayerProvider");
  }
  return context;
}
