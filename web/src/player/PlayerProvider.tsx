import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState
} from "react";
import type { ReactNode } from "react";
import type { Track } from "../api/schemas";

/**
 * Which track is loaded, and where it was played from.
 *
 * Deliberately thin: a queue store outside React replaces this later, so
 * nothing above it should depend on more than "what is current".
 */
export interface PlayerState {
  current: Track | null;
  /** The listing path the current track was played from, for context. */
  currentPath: string | null;
  play: (track: Track, fromPath: string) => void;
}

const PlayerContext = createContext<PlayerState | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Track | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);

  const play = useCallback((track: Track, fromPath: string) => {
    setCurrent(track);
    setCurrentPath(fromPath);
  }, []);

  const value = useMemo<PlayerState>(
    () => ({ current, currentPath, play }),
    [current, currentPath, play]
  );

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerState {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error("usePlayer must be used inside a PlayerProvider");
  }
  return context;
}
