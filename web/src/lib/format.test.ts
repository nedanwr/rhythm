import { describe, expect, it } from "vitest";
import { formatSize, formatTime, pluralize } from "./format";

describe("formatSize", () => {
  it("scales units and never invents a number", () => {
    expect(formatSize(undefined)).toBe("");
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(31_457_280)).toBe("30.0 MB");
    // Better empty than "NaN B" in a row.
    expect(formatSize(Number.NaN)).toBe("");
    expect(formatSize(-1)).toBe("");
  });
});

describe("formatTime", () => {
  it("renders m:ss and pads seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(9)).toBe("0:09");
    expect(formatTime(61)).toBe("1:01");
    expect(formatTime(3599)).toBe("59:59");
    expect(formatTime(3600)).toBe("60:00");
  });

  // Unknown must not read as a zero-length track.
  it("marks an unknown duration rather than showing 0:00", () => {
    expect(formatTime(undefined)).toBe("—:—");
    expect(formatTime(Number.NaN)).toBe("—:—");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("—:—");
    expect(formatTime(-5)).toBe("—:—");
  });
});

describe("pluralize", () => {
  it("treats zero as plural, matching English", () => {
    expect(pluralize(0, "track")).toBe("0 tracks");
    expect(pluralize(1, "track")).toBe("1 track");
    expect(pluralize(2, "track")).toBe("2 tracks");
    expect(pluralize(1, "entry", "entries")).toBe("1 entry");
    expect(pluralize(3, "entry", "entries")).toBe("3 entries");
  });
});
