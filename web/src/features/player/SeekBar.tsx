import { useState } from "react";

import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack
} from "~/components/ui/slider";
import { formatTime } from "~/lib/format";

/** Slider with separate played and buffered ranges. */
export function SeekBar({
  position,
  buffered,
  duration,
  disabled,
  onSeek
}: {
  position: number;
  buffered: number;
  duration: number;
  disabled: boolean;
  onSeek: (seconds: number) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? position;

  const bufferedPct =
    duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;

  return (
    <Slider
      min={0}
      // Base UI requires max to be greater than min.
      max={duration > 0 ? duration : 1}
      step={0.5}
      value={shown}
      disabled={disabled}
      onValueChange={(next) => setDragging(next as number)}
      onValueCommitted={(next) => {
        onSeek(next as number);
        setDragging(null);
      }}
      className="h-4 flex-1"
    >
      <SliderControl>
        <SliderTrack>
          <span
            className="bg-buffered pointer-events-none absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${bufferedPct}%` }}
          />
          <SliderIndicator />
        </SliderTrack>
        <SliderThumb aria-label="Seek" aria-valuetext={formatTime(shown)} />
      </SliderControl>
    </Slider>
  );
}
