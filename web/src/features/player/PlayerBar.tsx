import { useEffect, useState } from "react";
import {
  ListMusic,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX
} from "lucide-react";

import { formatTime } from "~/lib/format";
import { cn } from "~/lib/utils";
import { usePlayer } from "./PlayerProvider";
import { CoverArt } from "~/components/CoverArt";
import { Button } from "~/components/ui/button";
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack
} from "~/components/ui/slider";
import { SeekBar } from "./SeekBar";

/** Polls media position locally to avoid updating every context consumer. */
export function PlayerBar({ onToggleQueue }: { onToggleQueue: () => void }) {
  const {
    current,
    currentPath,
    queue,
    index,
    status,
    duration,
    volume,
    error,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    getPosition,
    getBuffered
  } = usePlayer();

  const [position, setPosition] = useState(0);
  const [buffered, setBuffered] = useState(0);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setPosition(getPosition());
      setBuffered(getBuffered());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getPosition, getBuffered]);

  const hasNext = index >= 0 && index < queue.length - 1;
  const isPlaying = status === "playing";

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <footer className="border-border bg-player relative z-40 h-22 shrink-0 border-t">
      {/* Keep the queue button visible at every breakpoint. */}
      <div className="grid h-full grid-cols-[minmax(160px,1fr)_minmax(240px,1.6fr)_minmax(160px,1fr)] items-center gap-6 px-4 max-md:grid-cols-[1fr_1.6fr_auto] max-sm:grid-cols-[1fr_auto] max-sm:gap-2 max-sm:px-3">
        <div className="flex min-w-0 items-center gap-3 max-sm:hidden">
          <CoverArt
            trackId={current?.id ?? null}
            size={160}
            className="size-14"
          />
          <span className="min-w-0">
            <span className="text-foreground block truncate text-[13px] font-medium">
              {current?.name ?? "Nothing playing"}
            </span>
            <span
              className={cn(
                "mt-1 block truncate text-[11px]",
                error ? "text-destructive" : "text-muted-foreground"
              )}
              title={error ?? currentPath ?? undefined}
              role={error ? "alert" : undefined}
            >
              {error ??
                (current
                  ? currentPath || "Library"
                  : "Choose a track to begin")}
            </span>
          </span>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous track"
              // Previous restarts the first track, so it remains enabled.
              disabled={!current}
              onClick={previous}
            >
              <SkipBack className="size-4 fill-current" />
            </Button>
            <Button
              aria-label={isPlaying ? "Pause" : "Play"}
              disabled={!current}
              onClick={toggle}
              className="bg-player-control text-background hover:bg-player-control/90 size-9 rounded-full p-0"
            >
              {isPlaying ? (
                <Pause className="size-4 fill-current" />
              ) : (
                <Play className="size-4 fill-current" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next track"
              disabled={!hasNext}
              onClick={next}
            >
              <SkipForward className="size-4 fill-current" />
            </Button>
          </div>

          <div className="mx-auto flex w-[95%] items-center gap-3">
            <span className="text-muted-foreground w-9 text-right font-mono text-[10px] tabular-nums">
              {formatTime(position)}
            </span>
            <SeekBar
              position={position}
              buffered={buffered}
              duration={duration}
              disabled={!current || duration === 0}
              onSeek={seek}
            />
            <span className="text-muted-foreground w-9 font-mono text-[10px] tabular-nums">
              {duration > 0 ? formatTime(duration) : "—:—"}
            </span>
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-1">
          {/* Mobile platforms use system volume controls. */}
          <span className="flex items-center gap-1 max-md:hidden">
            <VolumeIcon className="text-muted-foreground ml-1 size-4 shrink-0" />
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onValueChange={(next) => setVolume(next as number)}
              className="h-4 w-20 shrink-0"
            >
              <SliderControl>
                <SliderTrack>
                  <SliderIndicator />
                </SliderTrack>
                <SliderThumb
                  aria-label="Volume"
                  aria-valuetext={`${Math.round(volume * 100)}%`}
                />
              </SliderControl>
            </Slider>
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle queue"
            onClick={onToggleQueue}
          >
            <ListMusic className="size-4.5" />
          </Button>
        </div>
      </div>
    </footer>
  );
}
