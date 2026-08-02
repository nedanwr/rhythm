import { describe, expect, it } from "vitest";

import { PlaybackGraph } from "./graph";
import { dbToGain } from "./scheduler";
import { FakeAudioContext, FakeGainNode } from "./testing/fakeAudioContext";
import {
  DEFAULT_DSP,
  type DspSettings,
  type EqBandGainsDb,
  type Insert,
  type InsertFactory
} from "./types";

function engaged(changes?: Partial<DspSettings>): DspSettings {
  return { ...DEFAULT_DSP, bypass: false, ...changes };
}

const curve: EqBandGainsDb = [6, 4.5, 3, 0, 0, 0, -1.5, -3, -3, -6];

function spyInsert(): { factory: InsertFactory; disposed: () => boolean } {
  let disposed = false;
  const factory: InsertFactory = (context) => {
    const input = context.createGain();
    const output = context.createGain();
    input.connect(output);
    return {
      input,
      output,
      dispose: () => {
        disposed = true;
      }
    } satisfies Insert;
  };
  return { factory, disposed: () => disposed };
}

function build() {
  const context = new FakeAudioContext();
  const graph = new PlaybackGraph(context as unknown as BaseAudioContext);
  return { context, graph };
}

const asFake = (node: AudioNode) => node as unknown as FakeGainNode;

function signalPath(graph: PlaybackGraph): FakeGainNode[] {
  const destination = (graph.context as unknown as FakeAudioContext)
    .destination as unknown as FakeGainNode;
  const path: FakeGainNode[] = [];
  let node: FakeGainNode | undefined = asFake(graph.input);
  const seen = new Set<FakeGainNode>();
  while (node && node !== destination && !seen.has(node)) {
    seen.add(node);
    path.push(node);
    node = [...node.outputs][0] as FakeGainNode | undefined;
  }
  return node === destination ? path : [];
}

describe("PlaybackGraph", () => {
  it("reaches the destination with nothing configured", () => {
    const { graph } = build();
    // mix bus → master
    expect(signalPath(graph)).toHaveLength(2);
  });

  it("leaves inserts out of the path entirely while bypassed", () => {
    const { graph } = build();
    const insert = spyInsert();
    graph.setInserts([insert.factory]);

    expect(signalPath(graph)).toHaveLength(2);
  });

  it("routes through preamp and every insert once engaged", () => {
    const { graph } = build();
    graph.setInserts([spyInsert().factory, spyInsert().factory]);
    graph.setDsp(engaged());

    // mix bus → preamp → in/out ×2 → master
    expect(signalPath(graph)).toHaveLength(7);
  });

  it("puts master gain last, after the inserts", () => {
    const { graph } = build();
    graph.setInserts([spyInsert().factory]);
    graph.setDsp(engaged());
    graph.setVolume(0.25);

    const path = signalPath(graph);
    const last = path[path.length - 1]!;
    expect(last.gain.calls.at(-1)?.target).toBe(0.25);
  });

  it("returns to the bypassed path when the chain is disengaged again", () => {
    const { graph } = build();
    graph.setInserts([spyInsert().factory]);
    graph.setDsp(engaged());
    // mix bus → preamp → in → out → master
    expect(signalPath(graph)).toHaveLength(5);
    graph.setDsp(DEFAULT_DSP);
    expect(signalPath(graph)).toHaveLength(2);
  });

  it("applies the preamp in dB", () => {
    const { graph } = build();
    graph.setDsp(engaged({ preampDb: -6 }));
    const preamp = signalPath(graph)[1]!;
    expect(preamp.gain.value).toBeCloseTo(dbToGain(-6), 6);
  });

  it("starts flat and bypassed", () => {
    const { graph } = build();
    expect(graph.dsp).toEqual(DEFAULT_DSP);
    expect(graph.dsp.bandGainsDb.every((gain) => gain === 0)).toBe(true);
  });

  it("holds the band gains for the inserts that will read them", () => {
    const { graph } = build();
    graph.setDsp(engaged({ preampDb: -6, bandGainsDb: curve }));

    expect(graph.dsp.bandGainsDb).toEqual(curve);
    expect(graph.dsp.preampDb).toBe(-6);
    expect(graph.dsp.bypass).toBe(false);
    expect(signalPath(graph)).toHaveLength(3);
  });

  it("keeps band gains while bypassed, so re-engaging restores the curve", () => {
    const { graph } = build();
    graph.setDsp(engaged({ bandGainsDb: curve }));
    graph.setDsp({ ...engaged({ bandGainsDb: curve }), bypass: true });

    expect(signalPath(graph)).toHaveLength(2);
    expect(graph.dsp.bandGainsDb).toEqual(curve);
  });

  it("ramps the preamp instead of reconnecting a live chain", () => {
    const { graph } = build();
    graph.setInserts([spyInsert().factory]);
    graph.setDsp(engaged({ preampDb: -6 }));
    const before = signalPath(graph);
    const preamp = before[1]!;
    const callsBefore = preamp.gain.calls.length;

    graph.setDsp(engaged({ preampDb: -3, bandGainsDb: curve }));

    expect(signalPath(graph)).toEqual(before);
    expect(preamp.gain.calls.slice(callsBefore)).toEqual([
      expect.objectContaining({ kind: "setTargetAtTime" })
    ]);
    expect(preamp.gain.value).toBeCloseTo(dbToGain(-3), 6);
  });

  it("disposes the inserts it replaces", () => {
    const { graph } = build();
    const first = spyInsert();
    graph.setInserts([first.factory]);
    expect(first.disposed()).toBe(false);
    graph.setInserts([]);
    expect(first.disposed()).toBe(true);
  });

  it("ramps volume rather than stepping it, and clamps to 0–1", () => {
    const { graph } = build();
    graph.setVolume(0.5);
    graph.setVolume(4);
    graph.setVolume(-1);

    const master = signalPath(graph)[1]!;
    expect(master.gain.calls.every((c) => c.kind === "setTargetAtTime")).toBe(
      true
    );
    expect(master.gain.calls.map((c) => c.target)).toEqual([0.5, 1, 0]);
  });

  it("detaches everything on dispose", () => {
    const { graph } = build();
    const insert = spyInsert();
    graph.setInserts([insert.factory]);
    graph.dispose();
    expect(insert.disposed()).toBe(true);
    expect(signalPath(graph)).toHaveLength(0);
  });
});
