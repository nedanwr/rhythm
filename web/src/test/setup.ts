import "@testing-library/jest-dom/vitest";

import { FakeAudioContext } from "~/engine/testing/fakeAudioContext";

// jsdom has no layout, so scrolling is a no-op rather than an error.
Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: () => {}
});

// jsdom has no Web Audio implementation.
Object.defineProperty(globalThis, "AudioContext", {
  configurable: true,
  writable: true,
  value: FakeAudioContext
});

// jsdom has no MediaSession implementation.
if (!("mediaSession" in navigator)) {
  Object.defineProperty(navigator, "mediaSession", {
    configurable: true,
    writable: true,
    value: {
      metadata: null,
      playbackState: "none",
      setActionHandler: () => {},
      setPositionState: () => {}
    }
  });
}

if (!("MediaMetadata" in globalThis)) {
  Object.defineProperty(globalThis, "MediaMetadata", {
    configurable: true,
    writable: true,
    value: class {
      title: string;
      artwork: unknown;
      constructor(init: { title?: string; artwork?: unknown }) {
        this.title = init.title ?? "";
        this.artwork = init.artwork ?? [];
      }
    }
  });
}
