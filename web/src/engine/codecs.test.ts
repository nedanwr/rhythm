import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearDecoders,
  describeDecodeFailure,
  formatLabel,
  hasDecoder,
  loadDecoder,
  normalizeExt,
  registerDecoder,
  tierForExtension
} from "./codecs";

afterEach(() => {
  clearDecoders();
});

describe("tierForExtension", () => {
  it("routes browser-native formats to the native tier", () => {
    for (const ext of ["flac", "mp3", "ogg", "opus", "wav", "aiff", "aif"]) {
      expect(tierForExtension(ext)).toBe("native");
    }
  });

  it("routes formats no browser decodes to their eventual tier", () => {
    expect(tierForExtension("dsf")).toBe("browser");
    expect(tierForExtension("dff")).toBe("browser");
    expect(tierForExtension("wma")).toBe("browser");
    expect(tierForExtension("dts")).toBe("server");
    expect(tierForExtension("thd")).toBe("server");
  });

  it("treats containers that hold several codecs as ambiguous", () => {
    expect(tierForExtension("m4a")).toBe("ambiguous");
    expect(tierForExtension("mka")).toBe("ambiguous");
  });

  it("tries native decode for anything it has never heard of", () => {
    expect(tierForExtension("xyz")).toBe("native");
    expect(tierForExtension(undefined)).toBe("native");
  });

  it("accepts extensions with or without a leading dot, in any case", () => {
    expect(normalizeExt(".FLAC")).toBe("flac");
    expect(tierForExtension(".DSF")).toBe("browser");
  });
});

describe("describeDecodeFailure", () => {
  it("calls a failed FLAC damaged, because that is what it means", () => {
    const message = describeDecodeFailure("track.flac", "flac");
    expect(message).toContain("track.flac");
    expect(message).toMatch(/damaged/i);
    expect(message).toContain("FLAC");
  });

  it("names the format when no browser could ever have decoded it", () => {
    const dsd = describeDecodeFailure("hires.dsf", "dsf");
    expect(dsd).toContain("DSD");
    expect(dsd).toMatch(/no browser can decode/i);
    expect(dsd).not.toMatch(/damaged/i);

    const dts = describeDecodeFailure("movie.dts", "dts");
    expect(dts).toContain("DTS");
    expect(dts).toMatch(/server/i);
  });

  it("admits the uncertainty for a multi-codec container", () => {
    const message = describeDecodeFailure("atmos.m4a", "m4a");
    expect(message).toMatch(/several\s+codecs/i);
    expect(message).not.toMatch(/damaged/i);
  });

  it("still says something useful with no name or extension", () => {
    const message = describeDecodeFailure(undefined, undefined);
    expect(message).toContain("This track");
    expect(message).toMatch(/damaged|not be supported/);
  });

  it("has a label for every format the browse whitelist can list", () => {
    // Kept in step with server/internal/library.AudioExtensions by hand; a
    // missing label degrades the message rather than breaking playback.
    for (const ext of [
      "flac",
      "mp3",
      "m4a",
      "ogg",
      "opus",
      "wav",
      "aiff",
      "aif",
      "dsf",
      "dff",
      "mka",
      "thd",
      "dts",
      "wma"
    ]) {
      expect(formatLabel(ext)).not.toBeNull();
    }
  });
});

describe("decoder registry", () => {
  it("has no decoders registered in this phase", () => {
    expect(hasDecoder("dsf")).toBe(false);
  });

  it("loads a registered decoder lazily, only when asked", () => {
    const load = vi.fn().mockResolvedValue({ decode: vi.fn() });
    registerDecoder("alac", load);
    expect(hasDecoder("alac")).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it("returns null for a format with no decoder", async () => {
    await expect(loadDecoder("dsf")).resolves.toBeNull();
  });
});
