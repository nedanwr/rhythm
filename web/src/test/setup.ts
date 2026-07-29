import "@testing-library/jest-dom/vitest";

// jsdom has no layout, so scrolling is a no-op rather than an error.
Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: () => {}
});

// jsdom has no media pipeline; load() and play() report "not implemented".
// Stubbing them keeps these tests on what the app controls: which source is
// loaded and what the UI says. Real playback is checked in a real browser.
Object.defineProperty(HTMLMediaElement.prototype, "load", {
  configurable: true,
  value: () => {}
});
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: () => Promise.resolve()
});
