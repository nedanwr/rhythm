import { describe, expect, it } from "vitest";

import { BufferCache, estimateBytes, MAX_RETAINED_BUFFERS } from "./buffers";
import { fakeBuffer } from "./testing/fakeAudioContext";

describe("estimateBytes", () => {
  it("sizes decoded PCM at four bytes per sample per channel", () => {
    const buffer = fakeBuffer({ duration: 1, channels: 2, sampleRate: 48000 });
    expect(estimateBytes(buffer)).toBe(48000 * 2 * 4);
  });

  it("shows why holding a whole album decoded is not an option", () => {
    const hour = fakeBuffer({ duration: 3600, channels: 2, sampleRate: 44100 });
    expect(estimateBytes(hour) / 1e6).toBeGreaterThan(500);
  });
});

describe("BufferCache", () => {
  it("keeps only the current and next tracks", () => {
    const cache = new BufferCache();
    cache.set("a", fakeBuffer(10));
    cache.set("b", fakeBuffer(10));
    cache.set("c", fakeBuffer(10));

    cache.retain(["b", "c"]);

    expect(cache.size).toBe(MAX_RETAINED_BUFFERS);
    expect(cache.has("a")).toBe(false);
    expect(cache.get("b")).not.toBeNull();
    expect(cache.get("c")).not.toBeNull();
  });

  it("accepts a missing next track without keeping anything extra", () => {
    const cache = new BufferCache();
    cache.set("a", fakeBuffer(10));
    cache.set("b", fakeBuffer(10));
    cache.retain(["a", null]);
    expect(cache.size).toBe(1);
    expect(cache.has("a")).toBe(true);
  });

  it("frees everything on clear", () => {
    const cache = new BufferCache();
    cache.set("a", fakeBuffer({ duration: 60, channels: 2 }));
    expect(cache.bytes).toBeGreaterThan(0);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });

  it("reports nothing for an unknown id rather than throwing", () => {
    expect(new BufferCache().get("missing")).toBeNull();
  });
});
