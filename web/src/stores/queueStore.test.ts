import { describe, expect, it, vi } from "vitest";

import type { Track } from "~/api/schemas";
import {
  createQueueStore,
  selectCount,
  selectCurrent,
  selectCurrentId,
  selectHasNext,
  selectHasPrevious,
  selectIndex,
  selectItems,
  selectPath,
  selectUpcoming
} from "./queueStore";

const track = (n: number): Track => ({
  name: `${n}.flac`,
  path: `${n}.flac`,
  isDir: false,
  id: `default:t${n}`,
  ext: "flac",
  size: 1
});
const three = [track(1), track(2), track(3)];

describe("delegation to the pure queue module", () => {
  it("applies a transition and keeps its actions", () => {
    const store = createQueueStore();
    store.getState().play(three, 1, "Artist");

    const state = store.getState();
    expect(selectItems(state).map((t) => t.id)).toEqual([
      "default:t1",
      "default:t2",
      "default:t3"
    ]);
    expect(selectIndex(state)).toBe(1);
    expect(selectPath(state)).toBe("Artist");
    expect(typeof state.play).toBe("function");
    expect(typeof state.removeAt).toBe("function");
  });

  it("carries every queue action through to the module", () => {
    const store = createQueueStore();
    const s = () => store.getState();

    s().play(three, 0, "Artist");
    s().insertNext(track(9));
    expect(selectItems(s()).map((t) => t.id)).toEqual([
      "default:t1",
      "default:t9",
      "default:t2",
      "default:t3"
    ]);

    s().append(track(8));
    expect(selectItems(s()).at(-1)?.id).toBe("default:t8");

    s().next();
    expect(selectCurrentId(s())).toBe("default:t9");

    s().previous();
    expect(selectCurrentId(s())).toBe("default:t1");

    s().reorder(0, 2);
    expect(selectCurrentId(s())).toBe("default:t1");
    expect(selectIndex(s())).toBe(2);

    s().removeAt(0);
    expect(selectIndex(s())).toBe(1);

    s().playAt(0);
    expect(selectIndex(s())).toBe(0);

    s().clear();
    expect(selectCount(s())).toBe(0);
    expect(selectIndex(s())).toBe(-1);
    expect(selectPath(s())).toBeNull();
  });

  it("does not notify subscribers when a transition changes nothing", () => {
    const store = createQueueStore();
    store.getState().play(three, 0, "Artist");

    const listener = vi.fn();
    store.subscribe(listener);

    store.getState().playAt(42);
    store.getState().playAt(-1);
    store.getState().playAt(0);
    store.getState().removeAt(7);
    store.getState().reorder(0, 9);
    store.getState().previous();
    expect(listener).not.toHaveBeenCalled();

    store.getState().next();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("advancing behind the engine", () => {
  it("steps forward when the engine reports the track it expected", () => {
    const store = createQueueStore();
    store.getState().play(three, 0, "Artist");
    store.getState().advanceTo("default:t2");
    expect(selectIndex(store.getState())).toBe(1);
  });

  it("ignores an advance for a track the queue was not expecting", () => {
    const store = createQueueStore();
    store.getState().play(three, 0, "Artist");
    store.getState().advanceTo("default:stale");
    expect(selectIndex(store.getState())).toBe(0);
  });

  it("steps forward unconditionally when a track ended unscheduled", () => {
    const store = createQueueStore();
    store.getState().play(three, 0, "Artist");
    store.getState().advanceIfPossible();
    expect(selectCurrentId(store.getState())).toBe("default:t2");
  });

  it("stays put at the end of the queue", () => {
    const store = createQueueStore();
    store.getState().play(three, 2, "Artist");
    store.getState().advanceIfPossible();
    expect(selectIndex(store.getState())).toBe(2);
  });
});

describe("isolation", () => {
  it("gives every store its own queue", () => {
    const a = createQueueStore();
    const b = createQueueStore();

    a.getState().play(three, 1, "A");

    expect(selectCount(b.getState())).toBe(0);
    expect(selectIndex(b.getState())).toBe(-1);
    expect(selectCurrent(b.getState())).toBeNull();
  });

  it("notifies only its own subscribers", () => {
    const a = createQueueStore();
    const b = createQueueStore();
    const listener = vi.fn();
    b.subscribe(listener);

    a.getState().play(three, 0, "A");
    expect(listener).not.toHaveBeenCalled();
  });

  it("can be seeded, for a test that needs a queue already in place", () => {
    const store = createQueueStore({ items: three, index: 2, path: "Album" });
    expect(selectCurrentId(store.getState())).toBe("default:t3");
    expect(selectPath(store.getState())).toBe("Album");
  });
});

describe("selectors", () => {
  it("report what the UI needs without exposing the whole queue", () => {
    const store = createQueueStore();
    store.getState().play(three, 1, "Artist");
    const state = store.getState();

    expect(selectCurrent(state)?.id).toBe("default:t2");
    expect(selectUpcoming(state)?.id).toBe("default:t3");
    expect(selectHasNext(state)).toBe(true);
    expect(selectHasPrevious(state)).toBe(true);
    expect(selectCount(state)).toBe(3);
  });

  it("return stable primitives so a subscription does not fire spuriously", () => {
    const store = createQueueStore();
    store.getState().play(three, 0, "Artist");
    const first = store.getState();
    store.getState().append(track(4));
    const second = store.getState();

    expect(selectCurrentId(first)).toBe(selectCurrentId(second));
    expect(selectItems(first)).not.toBe(selectItems(second));
  });
});
