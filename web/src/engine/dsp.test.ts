import { describe, expect, it } from "vitest";

import {
  bandGainsEqual,
  dspEquals,
  EQ_BAND_COUNT,
  EQ_BAND_LIMIT_DB,
  flatBandGains,
  normalizeDsp,
  PREAMP_MAX_DB,
  PREAMP_MIN_DB
} from "./dsp";
import {
  DEFAULT_DSP,
  EQ_BAND_FREQUENCIES_HZ,
  type DspSettings,
  type EqBandGainsDb
} from "./types";

const curve: EqBandGainsDb = [6, 4.5, 3, 0, 0, 0, -1.5, -3, -3, -6];

function settings(changes?: Partial<DspSettings>): DspSettings {
  return { ...DEFAULT_DSP, ...changes };
}

describe("band table", () => {
  it("describes ten ISO octave bands in ascending order", () => {
    expect(EQ_BAND_COUNT).toBe(10);
    expect(EQ_BAND_FREQUENCIES_HZ).toEqual([
      31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000
    ]);
    const ascending = [...EQ_BAND_FREQUENCIES_HZ].every(
      (hz, band) => band === 0 || hz > EQ_BAND_FREQUENCIES_HZ[band - 1]!
    );
    expect(ascending).toBe(true);
  });

  it("defaults to a flat curve with one gain per band", () => {
    expect(DEFAULT_DSP.bandGainsDb).toHaveLength(EQ_BAND_COUNT);
    expect(DEFAULT_DSP.bandGainsDb.every((gain) => gain === 0)).toBe(true);
    expect(DEFAULT_DSP.bypass).toBe(true);
    expect(DEFAULT_DSP.preampDb).toBe(0);
  });

  it("hands out a copy of the flat curve, not the shared default", () => {
    const flat = flatBandGains();
    expect(flat).toEqual(DEFAULT_DSP.bandGainsDb);
    expect(flat).not.toBe(DEFAULT_DSP.bandGainsDb);
  });
});

describe("equality", () => {
  it("compares curves by value", () => {
    expect(bandGainsEqual(curve, [...curve])).toBe(true);
    expect(bandGainsEqual(curve, flatBandGains())).toBe(false);
    expect(
      bandGainsEqual(curve, [6, 4.5, 3, 0, 0, 0, -1.5, -3, -3, -5.9])
    ).toBe(false);
  });

  it("treats a rebuilt but identical settings object as unchanged", () => {
    const a = settings({ bypass: false, preampDb: -6, bandGainsDb: curve });
    const b = settings({
      bypass: false,
      preampDb: -6,
      bandGainsDb: [...curve]
    });
    expect(a).not.toBe(b);
    expect(dspEquals(a, b)).toBe(true);
  });

  it("notices a change in any part of the surface", () => {
    const base = settings({ bypass: false, preampDb: -6, bandGainsDb: curve });
    expect(dspEquals(base, { ...base, bypass: true })).toBe(false);
    expect(dspEquals(base, { ...base, preampDb: -5 })).toBe(false);
    expect(dspEquals(base, { ...base, bandGainsDb: flatBandGains() })).toBe(
      false
    );
  });
});

describe("normalizeDsp", () => {
  it("leaves in-range settings alone, identity included", () => {
    const engaged = settings({
      bypass: false,
      preampDb: -6,
      bandGainsDb: curve
    });
    expect(normalizeDsp(engaged)).toBe(engaged);
  });

  it("clamps band gains to the supported range", () => {
    const shouted: EqBandGainsDb = [99, -99, 0, 0, 0, 0, 0, 0, 0, 0];
    const result = normalizeDsp(settings({ bandGainsDb: shouted }));
    expect(result.bandGainsDb[0]).toBe(EQ_BAND_LIMIT_DB);
    expect(result.bandGainsDb[1]).toBe(-EQ_BAND_LIMIT_DB);
  });

  it("clamps the preamp, which may cut deeper than it boosts", () => {
    expect(normalizeDsp(settings({ preampDb: 40 })).preampDb).toBe(
      PREAMP_MAX_DB
    );
    expect(normalizeDsp(settings({ preampDb: -40 })).preampDb).toBe(
      PREAMP_MIN_DB
    );
    expect(PREAMP_MIN_DB).toBeLessThanOrEqual(-EQ_BAND_LIMIT_DB);
  });

  it("collapses non-finite gains to neutral rather than passing them on", () => {
    const broken: EqBandGainsDb = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ];
    const result = normalizeDsp(
      settings({ preampDb: Number.NaN, bandGainsDb: broken })
    );
    expect(result.preampDb).toBe(0);
    expect(result.bandGainsDb.slice(0, 3)).toEqual([0, 0, 0]);
    expect(result.bandGainsDb.every(Number.isFinite)).toBe(true);
  });

  it("preserves bypass, which has no range to clamp", () => {
    expect(normalizeDsp(settings({ bypass: false, preampDb: 99 })).bypass).toBe(
      false
    );
  });

  it("does not mutate the settings it was given", () => {
    const original = settings({ preampDb: 99, bandGainsDb: [...curve] });
    normalizeDsp(original);
    expect(original.preampDb).toBe(99);
    expect(original.bandGainsDb).toEqual(curve);
  });
});
