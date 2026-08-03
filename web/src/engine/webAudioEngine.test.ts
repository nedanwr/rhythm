import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EQ_BAND_COUNT, EQ_BAND_LIMIT_DB } from "./dsp";
import { dbToGain } from "./scheduler";
import {
  fakeBuffer,
  FakeAudioContext,
  type FakeBufferSource
} from "./testing/fakeAudioContext";
import { WebAudioEngine } from "./webAudioEngine";
import {
  DEFAULT_DSP,
  type DspSettings,
  type EngineTrack,
  type EqBandGainsDb
} from "./types";

const curve: EqBandGainsDb = [6, 4.5, 3, 0, 0, 0, -1.5, -3, -3, -6];

function engagedDsp(changes?: Partial<DspSettings>): DspSettings {
  return { ...DEFAULT_DSP, bypass: false, ...changes };
}

const t1: EngineTrack = { id: "root:1", name: "01 Intro.flac", ext: "flac" };
const t2: EngineTrack = { id: "root:2", name: "02 Groove.flac", ext: "flac" };
const t3: EngineTrack = { id: "root:3", name: "03 Outro.flac", ext: "flac" };

interface Harness {
  context: FakeAudioContext;
  engine: WebAudioEngine;
  fetchMock: ReturnType<typeof vi.fn>;
}

function okResponse(bytes = 1024): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (name === "Content-Length" ? String(bytes) : null)
    },
    body: null,
    arrayBuffer: async () => new ArrayBuffer(bytes)
  } as unknown as Response;
}

let harness: Harness;

function setup(durations: number[]): Harness {
  const context = new FakeAudioContext();
  for (const duration of durations) {
    context.decodeResults.push(fakeBuffer(duration));
  }
  const fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal("fetch", fetchMock);
  const engine = new WebAudioEngine({
    createContext: () => context.asAudioContext(),
    streamUrl: (id) => `/api/stream/${id}`
  });
  harness = { context, engine, fetchMock };
  return harness;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function sources(context: FakeAudioContext): FakeBufferSource[] {
  return [...context.scheduled].sort(
    (a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0)
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await harness?.engine.dispose();
});

describe("loading and playing", () => {
  it("fetches, decodes and starts a track", async () => {
    const { engine, context, fetchMock } = setup([180]);
    await engine.load(t1);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stream/root:1",
      expect.anything()
    );
    const snapshot = engine.getSnapshot();
    expect(snapshot.status).toBe("playing");
    expect(snapshot.trackId).toBe("root:1");
    expect(snapshot.duration).toBe(180);
    expect(snapshot.error).toBeNull();
    expect(context.state).toBe("running");
    expect(sources(context)).toHaveLength(1);
  });

  it("starts at an offset when asked to resume mid-track", async () => {
    const { engine, context } = setup([180]);
    await engine.load(t1, { startAt: 42 });
    expect(sources(context)[0]!.startOffset).toBe(42);
    expect(engine.getPosition()).toBe(42);
  });

  it("clamps a resume offset past the end of the track", async () => {
    const { engine, context } = setup([180]);
    await engine.load(t1, { startAt: 9999 });
    expect(sources(context)[0]!.startOffset).toBe(180);
  });

  it("notifies subscribers as the state moves", async () => {
    const { engine } = setup([180]);
    const listener = vi.fn();
    engine.subscribe(listener);
    await engine.load(t1);
    expect(listener).toHaveBeenCalled();
  });
});

describe("gapless transitions", () => {
  it("schedules the next track to start exactly when the current one ends", async () => {
    const { engine, context } = setup([180, 200]);
    await engine.load(t1);
    engine.setNext(t2);
    await flush();

    const [first, second] = sources(context);
    expect(second).toBeDefined();
    expect(second!.startedAt).toBe(first!.endsAt);
    expect(second!.startedAt).toBe(180);
    expect(second!.startOffset).toBe(0);
  });

  it("promotes the pre-scheduled track when the boundary passes", async () => {
    const { engine, context } = setup([180, 200]);
    const advanced = vi.fn();
    engine.on("advanced", advanced);

    await engine.load(t1);
    engine.setNext(t2);
    await flush();
    context.advanceTo(180);

    expect(advanced).toHaveBeenCalledWith("root:2");
    expect(engine.getSnapshot().trackId).toBe("root:2");
    expect(engine.getSnapshot().duration).toBe(200);
    expect(engine.getSnapshot().status).toBe("playing");
  });

  it("reports the end of the queue instead of advancing into nothing", async () => {
    const { engine, context } = setup([180]);
    const ended = vi.fn();
    const advanced = vi.fn();
    engine.on("ended", ended);
    engine.on("advanced", advanced);

    await engine.load(t1);
    context.advanceTo(180);

    expect(ended).toHaveBeenCalledWith("root:1");
    expect(advanced).not.toHaveBeenCalled();
    expect(engine.getSnapshot().status).toBe("idle");
  });

  it("re-arms on the new track when the queue changes after arming", async () => {
    const { engine, context } = setup([180, 200, 150]);
    await engine.load(t1);
    engine.setNext(t2);
    await flush();
    engine.setNext(t3);
    await flush();

    const live = sources(context);
    expect(live).toHaveLength(2);
    expect(live[1]!.buffer?.duration).toBe(150);
    expect(live[1]!.startedAt).toBe(180);

    context.advanceTo(180);
    expect(engine.getSnapshot().trackId).toBe("root:3");
  });

  it("cancels a scheduled transition when the next track is withdrawn", async () => {
    const { engine, context } = setup([180, 200]);
    const ended = vi.fn();
    engine.on("ended", ended);

    await engine.load(t1);
    engine.setNext(t2);
    await flush();
    engine.setNext(null);
    await flush();

    expect(sources(context)).toHaveLength(1);
    context.advanceTo(180);
    expect(ended).toHaveBeenCalledWith("root:1");
  });

  it("ignores a repeated setNext for the track already prepared", async () => {
    const { engine, fetchMock } = setup([180, 200]);
    await engine.load(t1);
    engine.setNext(t2);
    await flush();
    engine.setNext(t2);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forgets the queued next track when a different one is loaded", async () => {
    const { engine, context } = setup([180, 200, 150]);
    await engine.load(t1);
    engine.setNext(t2);
    await flush();
    expect(sources(context)).toHaveLength(2);

    await engine.load(t3);
    await flush();
    expect(sources(context)).toHaveLength(1);
    expect(sources(context)[0]!.buffer?.duration).toBe(150);

    context.advanceTo(context.currentTime + 150);
    expect(engine.getSnapshot().status).toBe("idle");
  });

  it("does not fail the current track when the next one cannot load", async () => {
    const { engine, fetchMock } = setup([180]);
    await engine.load(t1);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => null }
    } as unknown as Response);
    engine.setNext(t2);
    await flush();

    expect(engine.getSnapshot().error).toBeNull();
    expect(engine.getSnapshot().status).toBe("playing");
  });
});

describe("crossfade", () => {
  it("is off by default", async () => {
    const { engine } = setup([180, 200]);
    expect(engine.getSnapshot().crossfadeSeconds).toBe(0);
    await engine.load(t1);
    engine.setNext(t2);
    await flush();
    expect(engine.getSnapshot().crossfadeSeconds).toBe(0);
  });

  it("starts the next track early and ramps both sources equal-power", async () => {
    const { engine, context } = setup([180, 200]);
    engine.setCrossfade(6);
    await engine.load(t1);
    engine.setNext(t2);
    await flush();

    const [first, second] = sources(context);
    expect(second!.startedAt).toBe(174);

    const fadeOut = fadeOf(first!)!.gain.calls.at(-1)!;
    const fadeIn = fadeOf(second!)!.gain.calls.at(-1)!;
    expect(fadeOut.kind).toBe("setValueCurveAtTime");
    expect(fadeOut.time).toBe(174);
    expect(fadeOut.duration).toBe(6);
    expect(fadeIn.time).toBe(174);
    expect(fadeIn.duration).toBe(6);
    expect(fadeOut.curve!.at(0)).toBeCloseTo(1, 6);
    expect(fadeOut.curve!.at(-1)).toBeCloseTo(0, 6);
    expect(fadeIn.curve!.at(0)).toBeCloseTo(0, 6);
    expect(fadeIn.curve!.at(-1)).toBeCloseTo(1, 6);
  });

  it("re-plans an already-armed transition when the setting changes", async () => {
    const { engine, context } = setup([180, 200]);
    await engine.load(t1);
    engine.setNext(t2);
    await flush();
    expect(sources(context)[1]!.startedAt).toBe(180);

    engine.setCrossfade(10);
    expect(sources(context)).toHaveLength(2);
    expect(sources(context)[1]!.startedAt).toBe(170);
  });

  it("rejects a nonsensical crossfade length rather than mis-scheduling", async () => {
    const { engine } = setup([180]);
    engine.setCrossfade(Number.NaN);
    engine.setCrossfade(-4);
    expect(engine.getSnapshot().crossfadeSeconds).toBe(0);
  });
});

describe("transport", () => {
  it("suspends the context on pause and freezes the playhead", async () => {
    const { engine, context } = setup([180]);
    await engine.load(t1);
    context.advanceTo(30);
    expect(engine.getPosition()).toBe(30);

    engine.pause();
    await flush();
    expect(engine.getSnapshot().status).toBe("paused");
    expect(context.state).toBe("suspended");
    expect(engine.getPosition()).toBe(30);
  });

  it("resumes from where it paused", async () => {
    const { engine, context } = setup([180]);
    await engine.load(t1);
    context.advanceTo(30);
    engine.pause();
    await flush();
    await engine.play();
    expect(context.state).toBe("running");
    expect(engine.getSnapshot().status).toBe("playing");
    expect(engine.getPosition()).toBe(30);
  });

  it("restarts the track when play is pressed after the queue ran out", async () => {
    const { engine, context } = setup([180, 180]);
    await engine.load(t1);
    context.advanceTo(180);
    expect(engine.getSnapshot().status).toBe("idle");

    await engine.play();
    expect(engine.getSnapshot().status).toBe("playing");
    expect(engine.getPosition()).toBe(0);
  });

  it("seeks by restarting the source at the new offset", async () => {
    const { engine, context } = setup([180]);
    await engine.load(t1);
    context.advanceTo(20);
    engine.seek(90);
    await flush();

    const live = sources(context);
    expect(live).toHaveLength(1);
    expect(live[0]!.startOffset).toBe(90);
    expect(engine.getPosition()).toBe(90);
  });

  it("re-schedules the next track after a seek", async () => {
    const { engine, context } = setup([180, 200]);
    await engine.load(t1);
    engine.setNext(t2);
    await flush();
    context.advanceTo(20);
    engine.seek(150);
    await flush();

    const live = sources(context);
    expect(live).toHaveLength(2);
    expect(live[1]!.startedAt).toBe(50);
  });

  it("clamps a seek to the track and ignores a nonsense one", async () => {
    const { engine, context } = setup([180]);
    await engine.load(t1);
    engine.seek(9999);
    await flush();
    expect(sources(context)[0]!.startOffset).toBe(180);

    engine.seek(Number.NaN);
    await flush();
    expect(sources(context)[0]!.startOffset).toBe(180);
  });

  it("honors pause pressed while the track is still downloading", async () => {
    const { engine, context, fetchMock } = setup([180]);
    let release = (_: Response) => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      })
    );

    const loading = engine.load(t1);
    await flush();
    expect(engine.getSnapshot().status).toBe("loading");

    engine.pause();
    expect(engine.getSnapshot().status).toBe("paused");

    release(okResponse());
    await loading;

    expect(engine.getSnapshot().status).toBe("paused");
    expect(context.state).toBe("suspended");
    expect(engine.getPosition()).toBe(0);
  });

  it("retracts a pending pause without refetching the track", async () => {
    const { engine, fetchMock } = setup([180]);
    let release = (_: Response) => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      })
    );

    const loading = engine.load(t1);
    await flush();
    engine.pause();
    await engine.play();
    expect(engine.getSnapshot().status).toBe("loading");

    release(okResponse());
    await loading;

    expect(engine.getSnapshot().status).toBe("playing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stays paused when seeking while paused", async () => {
    const { engine, context } = setup([180]);
    await engine.load(t1);
    engine.pause();
    await flush();
    engine.seek(60);
    await flush();
    expect(engine.getSnapshot().status).toBe("paused");
    expect(context.state).toBe("suspended");
  });

  it("does not mistake its own teardown for a track boundary", async () => {
    const { engine, context } = setup([180]);
    const ended = vi.fn();
    engine.on("ended", ended);
    await engine.load(t1);
    engine.seek(60);
    await flush();
    expect(ended).not.toHaveBeenCalled();
    expect(engine.getSnapshot().status).toBe("playing");
    void context;
  });
});

describe("failures", () => {
  it("names the format when the browser was never going to decode it", async () => {
    const { engine, context } = setup([]);
    context.decodeError = new Error("Unable to decode audio data");
    await engine.load({ id: "root:9", name: "hires.dsf", ext: "dsf" });

    const { error, status } = engine.getSnapshot();
    expect(error?.kind).toBe("unsupported");
    expect(error?.message).toContain("DSD");
    expect(error?.trackId).toBe("root:9");
    expect(status).toBe("idle");
  });

  it("calls a failed FLAC damaged", async () => {
    const { engine, context } = setup([]);
    context.decodeError = new Error("Unable to decode audio data");
    await engine.load(t1);
    expect(engine.getSnapshot().error?.kind).toBe("decode");
    expect(engine.getSnapshot().error?.message).toMatch(/damaged/i);
  });

  it("distinguishes a missing file from a dropped server", async () => {
    const { engine, fetchMock } = setup([]);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => null }
    } as unknown as Response);
    await engine.load(t1);
    expect(engine.getSnapshot().error?.kind).toBe("network");
    expect(engine.getSnapshot().error?.message).toMatch(/no longer/i);

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await engine.load(t2);
    expect(engine.getSnapshot().error?.message).toMatch(/could not reach/i);
  });

  it("clears a previous error when the next track plays", async () => {
    const { engine, context } = setup([]);
    context.decodeError = new Error("nope");
    await engine.load(t1);
    expect(engine.getSnapshot().error).not.toBeNull();

    context.decodeError = null;
    context.decodeResults.push(fakeBuffer(120));
    await engine.load(t2);
    expect(engine.getSnapshot().error).toBeNull();
    expect(engine.getSnapshot().status).toBe("playing");
  });

  it("ignores a load that was superseded before it finished", async () => {
    const { engine, context } = setup([180, 90]);
    const first = engine.load(t1);
    const second = engine.load(t2);
    await Promise.all([first, second]);
    await flush();

    expect(engine.getSnapshot().trackId).toBe("root:2");
    expect(sources(context)).toHaveLength(1);
  });
});

describe("memory discipline", () => {
  it("never holds more than the current and next decoded buffers", async () => {
    const { engine, context } = setup([180, 200, 150, 120]);
    await engine.load(t1);
    engine.setNext(t2);
    await flush();
    context.advanceTo(180);
    engine.setNext(t3);
    await flush();
    context.advanceTo(380);
    await flush();

    expect(engine.decodedBufferCount).toBeLessThanOrEqual(2);
  });

  it("releases everything on stop", async () => {
    const { engine, context } = setup([180, 200]);
    await engine.load(t1);
    engine.setNext(t2);
    await flush();

    engine.stop();
    expect(engine.decodedBufferCount).toBe(0);
    expect(engine.getSnapshot().trackId).toBeNull();
    expect(engine.getSnapshot().status).toBe("idle");
    expect(sources(context)).toHaveLength(0);
  });

  it("closes the context and drops its sources on dispose", async () => {
    const { engine, context } = setup([180]);
    await engine.load(t1);
    await engine.dispose();
    expect(context.state).toBe("closed");
    expect(engine.decodedBufferCount).toBe(0);
  });

  it("abandons a load that was in flight when it was disposed", async () => {
    const { engine, context, fetchMock } = setup([180]);
    let release = (_: Response) => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      })
    );

    const loading = engine.load(t1);
    await flush();
    await engine.dispose();
    release(okResponse());

    await expect(loading).resolves.toBeUndefined();
    expect(context.state).toBe("closed");
  });

  it("does nothing further once disposed", async () => {
    const { engine } = setup([180]);
    await engine.dispose();
    await engine.load(t1);
    expect(engine.getSnapshot().trackId).toBeNull();
  });
});

describe("output settings", () => {
  it("clamps volume and reports it on the snapshot", async () => {
    const { engine } = setup([180]);
    await engine.load(t1);
    engine.setVolume(0.4);
    expect(engine.getSnapshot().volume).toBe(0.4);
    engine.setVolume(5);
    expect(engine.getSnapshot().volume).toBe(1);
    engine.setVolume(Number.NaN);
    expect(engine.getSnapshot().volume).toBe(1);
  });

  it("defaults to a bypassed, flat DSP chain", () => {
    const { engine } = setup([]);
    expect(engine.getSnapshot().dsp).toEqual(DEFAULT_DSP);
    expect(engine.getSnapshot().dsp.bypass).toBe(true);
    expect(engine.getSnapshot().dsp.preampDb).toBe(0);
    expect(engine.getSnapshot().dsp.bandGainsDb).toHaveLength(EQ_BAND_COUNT);
  });

  it("carries DSP settings onto a context created later", async () => {
    const { engine } = setup([180]);
    engine.setDsp(engagedDsp({ preampDb: -3, bandGainsDb: curve }));
    engine.setVolume(0.6);
    expect(engine.graphDsp).toBeNull();

    await engine.load(t1);

    expect(engine.getSnapshot().dsp.preampDb).toBe(-3);
    expect(engine.getSnapshot().dsp.bandGainsDb).toEqual(curve);
    expect(engine.getSnapshot().volume).toBe(0.6);
    expect(engine.graphDsp).toEqual(engine.getSnapshot().dsp);
  });

  it("hands new settings straight to a live graph", async () => {
    const { engine, context } = setup([180]);
    await engine.load(t1);
    engine.setDsp(engagedDsp({ preampDb: -6, bandGainsDb: curve }));

    expect(engine.graphDsp?.bypass).toBe(false);
    expect(engine.graphDsp?.bandGainsDb).toEqual(curve);
    // PlaybackGraph creates the mix bus, preamp, then master.
    const preamp = context.gains[1]!;
    expect(preamp.gain.value).toBeCloseTo(dbToGain(-6), 6);
  });

  it("clamps settings before they reach the graph", async () => {
    const { engine } = setup([180]);
    await engine.load(t1);
    engine.setDsp(
      engagedDsp({
        preampDb: Number.NaN,
        bandGainsDb: [99, -99, 0, 0, 0, 0, 0, 0, 0, 0]
      })
    );

    const dsp = engine.getSnapshot().dsp;
    expect(dsp.preampDb).toBe(0);
    expect(dsp.bandGainsDb[0]).toBe(EQ_BAND_LIMIT_DB);
    expect(dsp.bandGainsDb[1]).toBe(-EQ_BAND_LIMIT_DB);
    expect(engine.graphDsp).toEqual(dsp);
  });

  it("keeps DSP settings across a track change", async () => {
    const { engine } = setup([180, 200]);
    engine.setDsp(engagedDsp({ preampDb: -3, bandGainsDb: curve }));
    await engine.load(t1);
    await engine.load(t2);

    expect(engine.getSnapshot().dsp.bandGainsDb).toEqual(curve);
    expect(engine.graphDsp).toEqual(engine.getSnapshot().dsp);
  });

  it("ignores settings that did not change, down to the audio graph", async () => {
    const { engine, context } = setup([180]);
    engine.setDsp(engagedDsp({ preampDb: -3, bandGainsDb: curve }));
    await engine.load(t1);

    const listener = vi.fn();
    engine.subscribe(listener);
    const preamp = context.gains[1]!;
    const callsBefore = preamp.gain.calls.length;

    engine.setDsp(engagedDsp({ preampDb: -3, bandGainsDb: [...curve] }));
    expect(listener).not.toHaveBeenCalled();
    expect(preamp.gain.calls).toHaveLength(callsBefore);

    engine.setDsp(engagedDsp({ preampDb: -4, bandGainsDb: curve }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().dsp.preampDb).toBe(-4);
    expect(preamp.gain.calls).toHaveLength(callsBefore + 1);
  });

  it("returns to the untouched signal path when bypassed again", async () => {
    const { engine } = setup([180]);
    await engine.load(t1);
    engine.setDsp(engagedDsp({ preampDb: -6, bandGainsDb: curve }));
    engine.setDsp({ ...engagedDsp({ bandGainsDb: curve }), bypass: true });

    expect(engine.getSnapshot().dsp.bypass).toBe(true);
    expect(engine.graphDsp?.bandGainsDb).toEqual(curve);
  });
});

function fadeOf(source: FakeBufferSource) {
  return [...source.outputs][0] as
    | {
        gain: {
          calls: {
            kind: string;
            time: number;
            duration?: number;
            curve?: readonly number[];
          }[];
        };
      }
    | undefined;
}
