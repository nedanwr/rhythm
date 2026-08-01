import { useEffect, useRef, useState } from "react";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "~/lib/utils";

function Slider({ className, ...props }: SliderPrimitive.Root.Props) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "group data-horizontal:w-full data-vertical:h-full",
        className
      )}
      {...props}
    />
  );
}

function SliderControl({ className, ...props }: SliderPrimitive.Control.Props) {
  return (
    <SliderPrimitive.Control
      data-slot="slider-control"
      className={cn(
        "relative flex w-full cursor-pointer touch-none items-center select-none data-disabled:cursor-default data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col",
        className
      )}
      {...props}
    />
  );
}

function SliderTrack({ className, ...props }: SliderPrimitive.Track.Props) {
  return (
    <SliderPrimitive.Track
      data-slot="slider-track"
      className={cn(
        "bg-progress relative grow overflow-hidden rounded-full select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1",
        className
      )}
      {...props}
    />
  );
}

function SliderIndicator({
  className,
  ...props
}: SliderPrimitive.Indicator.Props) {
  return (
    <SliderPrimitive.Indicator
      data-slot="slider-indicator"
      className={cn(
        "bg-primary relative select-none data-horizontal:h-full data-vertical:w-full",
        className
      )}
      {...props}
    />
  );
}

function SliderThumb({
  className,
  onFocus,
  onBlur,
  ...props
}: SliderPrimitive.Thumb.Props) {
  // Base UI pointer-focuses a nested range input, which Chrome may still
  // match as :focus-visible. Track pointer input to expose keyboard focus only.
  const [focusVisible, setFocusVisible] = useState(false);
  const lastPointerDown = useRef(0);

  useEffect(() => {
    const onPointerDown = () => {
      lastPointerDown.current = performance.now();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  return (
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      // Focus from Base UI's nested range input bubbles to the thumb.
      onFocus={(event) => {
        const fromPointer = performance.now() - lastPointerDown.current < 300;
        setFocusVisible(!fromPointer && event.target.matches(":focus-visible"));
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocusVisible(false);
        onBlur?.(event);
      }}
      data-focus-visible={focusVisible || undefined}
      className={cn(
        "bg-primary relative block size-2.75 shrink-0 rounded-full opacity-0 shadow-sm transition-opacity select-none",
        "group-hover:opacity-100 data-dragging:opacity-100 data-focus-visible:opacity-100",
        // Increase the touch target without changing the visible thumb size.
        "after:absolute after:-inset-2",
        "data-disabled:pointer-events-none data-disabled:opacity-0",
        className
      )}
      {...props}
    />
  );
}

function SliderValue({ className, ...props }: SliderPrimitive.Value.Props) {
  return (
    <SliderPrimitive.Value
      data-slot="slider-value"
      className={cn("text-muted-foreground text-xs tabular-nums", className)}
      {...props}
    />
  );
}

export {
  Slider,
  SliderControl,
  SliderTrack,
  SliderIndicator,
  SliderThumb,
  SliderValue
};
