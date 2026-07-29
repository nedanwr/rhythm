import { useEffect, useRef, useState } from "react";
import { streamUrl } from "../api/client";
import { usePlayer } from "../player/PlayerProvider";

/**
 * A plain `<audio>` element pointed at /api/stream. It proves the byte path
 * works — ranges, content types, seeking — and gets replaced by the Web Audio
 * engine. Nothing else in the app talks to it.
 */
export function PlayerBar() {
  const { current, currentPath } = usePlayer();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);

  const src = current ? streamUrl(current.id) : null;

  useEffect(() => {
    setError(null);
    const audio = audioRef.current;
    if (!audio || !src) return;
    // Changing `src` alone does not restart a loaded element, and autoplay is
    // permitted here because a click selected the track.
    audio.load();
    void audio.play().catch(() => {
      // A rejected play() is usually an autoplay policy or an undecodable
      // format; the `error` event below carries the real reason when there is
      // one, so this only needs to not become an unhandled rejection.
    });
  }, [src]);

  if (!current || !src) {
    return (
      <footer className="player player--empty">
        <p className="player__hint">Select a track to play it.</p>
      </footer>
    );
  }

  return (
    <footer className="player">
      <div className="player__meta">
        <span className="player__title" title={current.path}>
          {current.name}
        </span>
        {currentPath ? (
          <span className="player__from">{currentPath || "/"}</span>
        ) : null}
      </div>
      <audio
        ref={audioRef}
        className="player__audio"
        src={src}
        controls
        preload="auto"
        onError={() =>
          setError(
            `Your browser could not play this file (.${current.ext ?? "unknown"}). ` +
              `Formats without a browser decoder arrive in a later phase.`
          )
        }
      />
      {error ? (
        <p role="alert" className="player__error">
          {error}
        </p>
      ) : null}
    </footer>
  );
}
