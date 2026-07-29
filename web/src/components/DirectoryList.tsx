import { Link } from "@tanstack/react-router";
import type { Entry } from "../api/schemas";
import { isTrack } from "../api/schemas";
import { usePlayer } from "../player/PlayerProvider";

/** Human-readable file size. */
export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export function DirectoryList({
  entries,
  path
}: {
  entries: Entry[];
  path: string;
}) {
  const { current, play } = usePlayer();

  if (entries.length === 0) {
    return (
      <p className="empty">
        Nothing here. This folder has no subfolders and no audio files Rhythm
        recognises.
      </p>
    );
  }

  return (
    <ul className="listing">
      {entries.map((entry) => {
        if (entry.isDir) {
          return (
            <li key={entry.path} className="listing__row listing__row--dir">
              <Link
                className="listing__button"
                to="/browse/$"
                params={{ _splat: entry.path }}
              >
                <span className="listing__icon" aria-hidden="true">
                  ▸
                </span>
                <span className="listing__name">{entry.name}</span>
              </Link>
            </li>
          );
        }
        if (!isTrack(entry)) return null;
        const isCurrent = current?.id === entry.id;
        return (
          <li
            key={entry.path}
            className={`listing__row${isCurrent ? "listing__row--current" : ""}`}
          >
            <button
              type="button"
              className="listing__button"
              aria-current={isCurrent ? "true" : undefined}
              onClick={() => play(entry, path)}
            >
              <span className="listing__icon" aria-hidden="true">
                {isCurrent ? "▶" : "♪"}
              </span>
              <span className="listing__name">{entry.name}</span>
              <span className="listing__ext">{entry.ext}</span>
              <span className="listing__size">{formatSize(entry.size)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
