import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Track } from "~/api/schemas";
import { FakeEngine } from "~/engine/testing/fakeEngine";
import {
  DEFAULT_DSP,
  type DspSettings,
  type EqBandGainsDb
} from "~/engine/types";
import {
  selectCurrent,
  selectIndex,
  selectItems,
  selectPath
} from "~/stores/queueStore";
import {
  selectCrossfadeSeconds,
  selectDsp,
  selectErrorMessage,
  selectStatus,
  selectVolume,
  useEngineState,
  usePlayerActions,
  useQueue,
  type PlayerActions
} from "./context";
import { PlayerProvider } from "./PlayerProvider";

const track = (n: number): Track => ({
  name: `${n}.flac`,
  path: `${n}.flac`,
  isDir: false,
  id: `default:t${n}`,
  ext: "flac",
  size: 1
});
const three = [track(1), track(2), track(3)];
const curve: EqBandGainsDb = [6, 4.5, 3, 0, 0, 0, -1.5, -3, -3, -6];

interface Seen {
  queue: readonly Track[];
  index: number;
  current: Track | null;
  currentPath: string | null;
  status: string;
  volume: number;
  error: string | null;
  crossfadeSeconds: number;
  dsp: DspSettings;
  actions: PlayerActions;
}

function mount(engine = new FakeEngine()) {
  const seen: { current: Seen | null } = { current: null };
  function Probe() {
    seen.current = {
      queue: useQueue(selectItems),
      index: useQueue(selectIndex),
      current: useQueue(selectCurrent),
      currentPath: useQueue(selectPath),
      status: useEngineState(selectStatus),
      volume: useEngineState(selectVolume),
      error: useEngineState(selectErrorMessage),
      crossfadeSeconds: useEngineState(selectCrossfadeSeconds),
      dsp: useEngineState(selectDsp),
      actions: usePlayerActions()
    };
    return null;
  }
  const result = render(
    <PlayerProvider engine={engine}>
      <Probe />
    </PlayerProvider>
  );
  const player = () => seen.current as Seen;
  return { engine, result, player, act: () => player().actions };
}

describe("driving the engine", () => {
  it("loads the selected track", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 1, "Artist"));
    expect(engine.loads.map((l) => l.track.id)).toEqual(["default:t2"]);
    expect(player().current?.id).toBe("default:t2");
    expect(player().currentPath).toBe("Artist");
  });

  it("hands the engine the following track to pre-decode", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 0, "Artist"));
    expect(engine.nextCalls.at(-1)?.id).toBe("default:t2");
  });

  it("withdraws the pre-decode at the end of the queue", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 2, "Artist"));
    expect(engine.nextCalls.at(-1)).toBeNull();
  });

  it("re-points the pre-decode when the queue is edited behind the playhead", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 0, "Artist"));
    act(() => player().actions.playNext(track(9)));
    expect(engine.nextCalls.at(-1)?.id).toBe("default:t9");
    expect(engine.loads).toHaveLength(1);
  });

  it("does not reload the current track when the queue is reordered around it", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 1, "Artist"));
    act(() => player().actions.reorder(0, 2));
    expect(player().current?.id).toBe("default:t2");
    expect(engine.loads).toHaveLength(1);
  });

  it("follows the engine across a gapless boundary without reloading", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 0, "Artist"));
    expect(engine.loads).toHaveLength(1);

    act(() => engine.advanceTo({ id: "default:t2", name: "2.flac" }));

    expect(player().index).toBe(1);
    expect(player().current?.id).toBe("default:t2");
    expect(engine.loads).toHaveLength(1);
    expect(engine.nextCalls.at(-1)?.id).toBe("default:t3");
  });

  it("ignores an advance that does not match what the queue expected", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 0, "Artist"));
    act(() => engine.advanceTo({ id: "default:stale", name: "stale.flac" }));
    expect(player().index).toBe(0);
  });

  it("moves on when a track ends with nothing scheduled behind it", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 0, "Artist"));
    act(() => engine.finish());

    expect(player().index).toBe(1);
    expect(engine.loads.map((l) => l.track.id)).toEqual([
      "default:t1",
      "default:t2"
    ]);
  });

  it("stays on the last track when the queue runs out, ready to replay it", () => {
    const { engine, player } = mount();
    act(() => player().actions.play([track(1)], 0, "Artist"));
    act(() => engine.finish());
    expect(player().status).toBe("idle");
    expect(player().current?.id).toBe("default:t1");

    act(() => player().actions.toggle());
    expect(engine.playCalls).toBe(1);
  });

  it("stops the engine when the queue is cleared", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 0, "Artist"));
    act(() => player().actions.clearQueue());
    expect(engine.stopCalls).toBeGreaterThan(0);
    expect(player().current).toBeNull();
  });
});

describe("transport", () => {
  it("pauses what is playing and resumes what is paused", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 0, "Artist"));
    expect(player().status).toBe("playing");

    act(() => player().actions.toggle());
    expect(engine.pauseCalls).toBe(1);
    expect(player().status).toBe("paused");

    act(() => player().actions.toggle());
    expect(engine.playCalls).toBe(1);
    expect(player().status).toBe("playing");
  });

  it("pauses rather than restarting when pressed during a load", () => {
    const engine = new FakeEngine();
    engine.deferLoads = true;
    const { player } = mount(engine);
    act(() => player().actions.play(three, 0, "Artist"));
    expect(player().status).toBe("loading");

    act(() => player().actions.toggle());
    expect(engine.pauseCalls).toBe(1);
    expect(engine.loads).toHaveLength(1);
  });

  it("restarts the track when previous is pressed part-way in", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 1, "Artist"));
    engine.position = 30;

    act(() => player().actions.previous());
    expect(engine.seeks).toEqual([0]);
    expect(player().index).toBe(1);
  });

  it("steps back when previous is pressed near the start", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 1, "Artist"));
    engine.position = 1;

    act(() => player().actions.previous());
    expect(player().index).toBe(0);
    expect(engine.loads.map((l) => l.track.id)).toEqual([
      "default:t2",
      "default:t1"
    ]);
  });

  it("restarts the first track rather than falling off the front", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 0, "Artist"));
    engine.position = 1;
    act(() => player().actions.previous());
    expect(player().index).toBe(0);
    expect(engine.seeks).toEqual([0]);
  });

  it("passes seek and volume straight through", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 0, "Artist"));
    act(() => player().actions.seek(42));
    act(() => player().actions.setVolume(0.3));
    expect(engine.seeks).toEqual([42]);
    expect(player().volume).toBe(0.3);
  });

  it("reads position and download progress from the engine", () => {
    const { engine, player } = mount();
    act(() => player().actions.play(three, 0, "Artist"));
    engine.position = 12.5;
    engine.loadedSeconds = 90;
    expect(player().actions.getPosition()).toBe(12.5);
    expect(player().actions.getBuffered()).toBe(90);
  });
});

describe("errors", () => {
  it("surfaces the engine's message and does not look like it is playing", () => {
    const engine = new FakeEngine();
    engine.deferLoads = true;
    engine.failNextLoad = {
      kind: "unsupported",
      message: "“hires.dsf” is DSD, which no browser can decode.",
      trackId: "default:t1"
    };
    const { player } = mount(engine);
    act(() => player().actions.play(three, 0, "Artist"));
    act(() => engine.settleLoad());

    expect(player().error).toContain("DSD");
    expect(player().status).toBe("idle");
  });
});

describe("crossfade", () => {
  it("is off by default and settable through the engine", () => {
    const { player } = mount();
    expect(player().crossfadeSeconds).toBe(0);
    act(() => player().actions.setCrossfade(6));
    expect(player().crossfadeSeconds).toBe(6);
  });
});

describe("DSP settings", () => {
  it("start bypassed and flat", () => {
    const { player } = mount();
    expect(player().dsp).toEqual(DEFAULT_DSP);
    expect(player().dsp.bypass).toBe(true);
  });

  it("reach the engine and come back on the snapshot", () => {
    const { engine, player } = mount();
    const engaged: DspSettings = {
      bypass: false,
      preampDb: -6,
      bandGainsDb: curve
    };

    act(() => player().actions.setDsp(engaged));

    expect(engine.dspCalls.at(-1)).toEqual(engaged);
    expect(player().dsp.bypass).toBe(false);
    expect(player().dsp.preampDb).toBe(-6);
    expect(player().dsp.bandGainsDb).toEqual(curve);
  });

  it("keep a stable identity so consumers do not re-render on unrelated state", () => {
    const { player } = mount();
    act(() => player().actions.setDsp({ ...DEFAULT_DSP, bandGainsDb: curve }));
    const applied = player().dsp;
    act(() => player().actions.setVolume(0.3));
    expect(player().dsp).toBe(applied);
  });
});

describe("lifecycle", () => {
  it("disposes the engine when the provider unmounts", () => {
    const { engine, result } = mount();
    result.unmount();
    expect(engine.disposeCalls).toBe(1);
  });

  it("keeps the action bundle stable so dispatch-only consumers never re-render", () => {
    const { player } = mount();
    const first = player().actions;
    act(() => player().actions.play(three, 0, "Artist"));
    act(() => player().actions.setVolume(0.2));
    expect(player().actions).toBe(first);
  });

  it("still plays after an effect teardown and re-setup on the same mount", () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: { get: () => "8" },
          body: null,
          arrayBuffer: async () => new ArrayBuffer(8)
        }) as unknown as Response
    );
    vi.stubGlobal("fetch", fetchMock);

    const seen: { current: PlayerActions | null } = { current: null };
    function Probe() {
      seen.current = usePlayerActions();
      return null;
    }
    render(
      <StrictMode>
        <PlayerProvider>
          <Probe />
        </PlayerProvider>
      </StrictMode>
    );
    act(() => seen.current!.play(three, 0, "Artist"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stream/default%3At1",
      expect.anything()
    );
    vi.unstubAllGlobals();
  });

  it("re-renders only the components whose slice actually changed", () => {
    const renders = { items: 0, index: 0, volume: 0, actions: 0 };
    const engine = new FakeEngine();
    let actions: PlayerActions | null = null;

    function Items() {
      useQueue(selectItems);
      renders.items += 1;
      return null;
    }
    function Index() {
      useQueue(selectIndex);
      renders.index += 1;
      return null;
    }
    function Volume() {
      useEngineState(selectVolume);
      renders.volume += 1;
      return null;
    }
    function Dispatcher() {
      actions = usePlayerActions();
      renders.actions += 1;
      return null;
    }

    render(
      <PlayerProvider engine={engine}>
        <Items />
        <Index />
        <Volume />
        <Dispatcher />
      </PlayerProvider>
    );
    const baseline = { ...renders };

    act(() => actions!.setVolume(0.4));
    expect(renders.volume).toBe(baseline.volume + 1);
    expect(renders.items).toBe(baseline.items);
    expect(renders.index).toBe(baseline.index);

    act(() => actions!.play(three, 0, "Artist"));
    const afterPlay = { ...renders };
    act(() => actions!.addToQueue(track(4)));
    expect(renders.items).toBe(afterPlay.items + 1);
    expect(renders.index).toBe(afterPlay.index);

    expect(renders.actions).toBe(baseline.actions);
  });

  it("gives each provider its own queue", () => {
    const first = mount();
    const second = mount();
    act(() => first.player().actions.play(three, 1, "Artist"));

    expect(first.player().current?.id).toBe("default:t2");
    expect(second.player().current).toBeNull();
    expect(second.player().queue).toHaveLength(0);
  });
});

describe("queue editing", () => {
  it("follows the playing track when an earlier entry moves past it", () => {
    const { player } = mount();
    act(() => player().actions.play(three, 1, "Artist"));
    act(() => player().actions.reorder(0, 2));
    expect(player().index).toBe(0);
    expect(player().current?.id).toBe("default:t2");
  });

  it("keeps playing the same track when a later entry is removed", () => {
    const { player } = mount();
    act(() => player().actions.play(three, 1, "Artist"));
    act(() => player().actions.removeAt(2));
    expect(player().index).toBe(1);
    expect(player().current?.id).toBe("default:t2");
  });

  it("moves to the entry that slides into place when the current one goes", () => {
    const { player } = mount();
    act(() => player().actions.play(three, 1, "Artist"));
    act(() => player().actions.removeAt(1));
    expect(player().current?.id).toBe("default:t3");
  });

  it("stops when the last remaining entry is removed", () => {
    const { player } = mount();
    act(() => player().actions.play([track(1)], 0, "Artist"));
    act(() => player().actions.removeAt(0));
    expect(player().index).toBe(-1);
    expect(player().current).toBeNull();
    expect(player().currentPath).toBeNull();
  });

  it("starts playing when queueing onto an empty queue", () => {
    const { player } = mount();
    act(() => player().actions.playNext(track(9)));
    expect(player().current?.id).toBe("default:t9");

    const { player: other } = mount();
    act(() => other().actions.addToQueue(track(8)));
    expect(other().current?.id).toBe("default:t8");
  });

  it("inserts directly after the current track", () => {
    const { player } = mount();
    act(() => player().actions.play(three, 0, "Artist"));
    act(() => player().actions.playNext(track(9)));
    expect(player().queue.map((t) => t.id)).toEqual([
      "default:t1",
      "default:t9",
      "default:t2",
      "default:t3"
    ]);
    expect(player().current?.id).toBe("default:t1");
  });

  it("ignores out-of-range edits rather than corrupting the queue", () => {
    const { player } = mount();
    act(() => player().actions.play(three, 0, "Artist"));
    act(() => player().actions.reorder(0, 9));
    act(() => player().actions.reorder(-1, 1));
    act(() => player().actions.removeAt(7));
    act(() => player().actions.playAt(42));
    expect(player().queue).toHaveLength(3);
    expect(player().index).toBe(0);
  });
});
