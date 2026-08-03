import { Link } from "@tanstack/react-router";
import { Folder, Music2, Play, Volume2 } from "lucide-react";

import type { Entry, Track } from "~/api/schemas";
import { isTrack } from "~/api/schemas";
import { formatSize } from "~/lib/format";
import { cn } from "~/lib/utils";
import {
  selectStatus,
  useEngineState,
  usePlayerActions,
  useQueue
} from "~/features/player/context";
import { selectCurrent } from "~/stores/queueStore";
import { CoverArt } from "~/components/CoverArt";
import { TrackMenu } from "~/features/player/TrackMenu";

export function DirectoryList({
  entries,
  path
}: {
  entries: Entry[];
  path: string;
}) {
  const current = useQueue(selectCurrent);
  const status = useEngineState(selectStatus);
  const { play } = usePlayerActions();

  const folders = entries.filter((entry) => entry.isDir);
  const tracks = entries.filter(isTrack);

  if (entries.length === 0) {
    return (
      <div className="text-muted-foreground grid h-64 place-items-center text-sm">
        <div className="text-center">
          <Music2 className="text-faint mx-auto mb-3 size-7" />
          <p>
            Nothing here. This folder has no subfolders and no audio files
            Rhythm recognises.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-12">
      {folders.length > 0 && (
        <ul className="mb-8 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
          {folders.map((folder) => (
            <li key={folder.path}>
              <Link
                to="/browse/$"
                params={{ _splat: folder.path }}
                className="border-border bg-card hover:bg-row-hover flex items-center gap-3 rounded-md border px-3 py-3 text-sm transition-colors"
              >
                <Folder className="text-primary size-4 shrink-0" />
                <span className="truncate" title={folder.name}>
                  {folder.name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {tracks.length > 0 && (
        <>
          <div className="border-border text-faint grid h-9 grid-cols-[40px_minmax(0,1fr)_80px_90px_36px] items-center gap-3 border-b text-[10px] font-medium tracking-[.12em] uppercase max-sm:grid-cols-[40px_minmax(0,1fr)_36px]">
            <span>#</span>
            <span>Title</span>
            <span className="max-sm:hidden">Format</span>
            <span className="text-right max-sm:hidden">Size</span>
            <span />
          </div>
          <ul>
            {tracks.map((track, position) => (
              <TrackRow
                key={track.path}
                track={track}
                position={position}
                isCurrent={current?.id === track.id}
                isPlaying={current?.id === track.id && status === "playing"}
                onPlay={() => play(tracks, position, path)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TrackRow({
  track,
  position,
  isCurrent,
  isPlaying,
  onPlay
}: {
  track: Track;
  position: number;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: () => void;
}) {
  return (
    <li
      className={cn(
        "group border-border/60 hover:bg-row-hover grid h-14 grid-cols-[40px_minmax(0,1fr)_80px_90px_36px] items-center gap-3 border-b text-xs transition-colors max-sm:grid-cols-[40px_minmax(0,1fr)_36px]",
        isCurrent && "bg-row-hover"
      )}
      aria-current={isCurrent ? "true" : undefined}
    >
      <span className="grid place-items-center">
        {isPlaying ? (
          <Volume2 className="text-primary size-3.5 group-hover:hidden" />
        ) : (
          <span
            className={cn(
              "text-muted-foreground font-mono text-[10px] tabular-nums group-hover:hidden",
              isCurrent && "text-primary"
            )}
          >
            {position + 1}
          </span>
        )}
        <button
          type="button"
          aria-label={`Play ${track.name}`}
          onClick={onPlay}
          className="text-primary hidden group-hover:block"
        >
          <Play className="size-3.5 fill-current" />
        </button>
      </span>

      <span className="flex min-w-0 items-center gap-3">
        <CoverArt
          trackId={track.id}
          size={64}
          className="size-9"
          markClassName="scale-[.55]"
        />
        <button
          type="button"
          onClick={onPlay}
          title={track.name}
          className={cn(
            "text-foreground min-w-0 truncate text-left",
            isCurrent && "text-primary"
          )}
        >
          {track.name}
        </button>
      </span>

      <span className="text-muted-foreground font-mono text-[10px] uppercase tabular-nums max-sm:hidden">
        {track.ext ?? ""}
      </span>
      <span className="text-muted-foreground text-right font-mono text-[10px] tabular-nums max-sm:hidden">
        {formatSize(track.size)}
      </span>
      <TrackMenu track={track} />
    </li>
  );
}
