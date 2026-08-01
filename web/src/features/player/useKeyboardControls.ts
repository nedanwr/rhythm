import { useEffect, useRef } from "react";

/** Global playback shortcuts that yield to controls using the same keys. */

export interface KeyboardControlsOptions {
  readonly enabled: boolean;
  readonly onToggle: () => void;
  readonly onSeekBy: (deltaSeconds: number) => void;
  readonly onVolumeBy: (delta: number) => void;
  readonly seekStep: number;
}

const VOLUME_STEP = 0.05;

/** Whether the event target owns the given key. */
export function ownsKeyboard(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // Check the attribute because isContentEditable is unreliable in jsdom.
  if (target.isContentEditable) return true;
  const editable = target.getAttribute("contenteditable");
  if (editable !== null && editable !== "false") return true;
  const role = target.getAttribute("role");
  if (role === "textbox") return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
    return true;
  }
  if (role === "slider") return true;
  const isSpace = key === " " || key === "Spacebar";
  return isSpace && ["BUTTON", "A", "SUMMARY"].includes(target.tagName);
}

export function useKeyboardControls(options: KeyboardControlsOptions): void {
  // Keep one listener while using the latest callbacks.
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = latest.current;
      if (!current.enabled) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (ownsKeyboard(event.target, event.key)) return;

      switch (event.key) {
        case " ":
        case "Spacebar":
          event.preventDefault();
          current.onToggle();
          return;
        case "ArrowRight":
          event.preventDefault();
          current.onSeekBy(current.seekStep);
          return;
        case "ArrowLeft":
          event.preventDefault();
          current.onSeekBy(-current.seekStep);
          return;
        case "ArrowUp":
          event.preventDefault();
          current.onVolumeBy(VOLUME_STEP);
          return;
        case "ArrowDown":
          event.preventDefault();
          current.onVolumeBy(-VOLUME_STEP);
          return;
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
