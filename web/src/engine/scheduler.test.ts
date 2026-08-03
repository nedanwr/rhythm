import { describe, expect, it } from "vitest";

import {
  dbToGain,
  equalPowerCurve,
  planTransition,
  positionAt
} from "./scheduler";

const base = {
  startedAt: 10,
  offset: 0,
  duration: 180,
  nextDuration: 200,
  crossfadeSeconds: 0,
  now: 10
};

describe("planTransition", () => {
  it("butt-joins the next track with no gap when crossfade is off", () => {
    const plan = planTransition(base);
    expect(plan.endAt).toBe(190);
    expect(plan.startNextAt).toBe(190);
    expect(plan.overlap).toBe(0);
  });

  it("accounts for a track that started part-way through", () => {
    const plan = planTransition({ ...base, offset: 30, now: 10 });
    expect(plan.endAt).toBe(160);
    expect(plan.startNextAt).toBe(160);
  });

  it("opens the crossfade window early by the requested length", () => {
    const plan = planTransition({ ...base, crossfadeSeconds: 6 });
    expect(plan.overlap).toBe(6);
    expect(plan.startNextAt).toBe(184);
    expect(plan.endAt).toBe(190);
  });

  it("never fades for longer than the audio that is left", () => {
    const plan = planTransition({ ...base, crossfadeSeconds: 6, now: 188 });
    expect(plan.overlap).toBe(2);
    expect(plan.startNextAt).toBe(188);
  });

  it("never swallows more than half of a short interlude", () => {
    const plan = planTransition({
      ...base,
      duration: 8,
      nextDuration: 200,
      crossfadeSeconds: 10
    });
    expect(plan.overlap).toBe(4);
  });

  it("never swallows more than half of the incoming track", () => {
    const plan = planTransition({
      ...base,
      nextDuration: 5,
      crossfadeSeconds: 10
    });
    expect(plan.overlap).toBe(2.5);
  });

  it("starts immediately when the decode landed after the boundary passed", () => {
    const plan = planTransition({ ...base, now: 195 });
    expect(plan.startNextAt).toBe(195);
    expect(plan.overlap).toBe(0);
  });

  it("plans against an undecoded next track without a length constraint", () => {
    const plan = planTransition({
      ...base,
      nextDuration: null,
      crossfadeSeconds: 6
    });
    expect(plan.overlap).toBe(6);
  });

  it("treats a negative crossfade as off", () => {
    expect(planTransition({ ...base, crossfadeSeconds: -5 }).overlap).toBe(0);
  });
});

describe("equalPowerCurve", () => {
  it("runs from silence to unity and back", () => {
    const fadeIn = equalPowerCurve("in");
    const fadeOut = equalPowerCurve("out");
    expect(fadeIn[0]).toBeCloseTo(0, 6);
    expect(fadeIn[fadeIn.length - 1]).toBeCloseTo(1, 6);
    expect(fadeOut[0]).toBeCloseTo(1, 6);
    expect(fadeOut[fadeOut.length - 1]).toBeCloseTo(0, 6);
  });

  it("holds constant power through the blend", () => {
    const fadeIn = equalPowerCurve("in", 33);
    const fadeOut = equalPowerCurve("out", 33);
    for (let i = 0; i < fadeIn.length; i += 1) {
      const power = fadeIn[i]! ** 2 + fadeOut[i]! ** 2;
      expect(power).toBeCloseTo(1, 6);
    }
  });

  it("refuses to produce a degenerate one-point curve", () => {
    expect(equalPowerCurve("in", 1).length).toBe(2);
  });
});

describe("positionAt", () => {
  it("advances with the clock from the starting offset", () => {
    expect(positionAt(15, 10, 30, 180)).toBe(35);
  });

  it("never reports past the end of the track", () => {
    expect(positionAt(500, 10, 0, 180)).toBe(180);
  });

  it("reports zero before the clock reaches the start time", () => {
    expect(positionAt(5, 10, 0, 180)).toBe(0);
  });

  it("reports zero for an unmeasured track", () => {
    expect(positionAt(15, 10, 0, 0)).toBe(0);
  });
});

describe("dbToGain", () => {
  it("maps 0 dB to unity and -6 dB to about half amplitude", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 6);
  });
});
