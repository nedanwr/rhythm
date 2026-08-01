import { describe, expect, it } from "vitest";

import {
  append,
  clear,
  current,
  emptyQueue,
  hasNext,
  hasPrevious,
  insertNext,
  next,
  peekNext,
  play,
  playAt,
  previous,
  removeAt,
  reorder,
  type QueueState
} from "./queue";

interface Item {
  id: string;
}

const item = (n: number): Item => ({ id: `t${n}` });
const ids = (state: QueueState<Item>) => state.items.map((i) => i.id);
const three = [item(1), item(2), item(3)];

function seeded(index: number): QueueState<Item> {
  return play(emptyQueue<Item>(), three, index, "Artist/Album");
}

describe("play", () => {
  it("replaces the queue and records where it came from", () => {
    const state = seeded(1);
    expect(ids(state)).toEqual(["t1", "t2", "t3"]);
    expect(state.index).toBe(1);
    expect(state.path).toBe("Artist/Album");
  });

  it("clamps a start index outside the list", () => {
    expect(play(emptyQueue<Item>(), three, 99, "x").index).toBe(2);
    expect(play(emptyQueue<Item>(), three, -5, "x").index).toBe(0);
  });

  it("ignores an empty track list rather than clearing the queue", () => {
    const state = seeded(1);
    expect(play(state, [], 0, "other")).toBe(state);
  });

  it("copies the input so a later mutation cannot reach the queue", () => {
    const source = [item(1), item(2)];
    const state = play(emptyQueue<Item>(), source, 0, "x");
    source.push(item(3));
    expect(ids(state)).toEqual(["t1", "t2"]);
  });
});

describe("cursor movement", () => {
  it("ignores out-of-range selections instead of clamping them", () => {
    const state = seeded(0);
    expect(playAt(state, 42)).toBe(state);
    expect(playAt(state, -1)).toBe(state);
  });

  it("stops at the ends of the queue", () => {
    const last = seeded(2);
    expect(hasNext(last)).toBe(false);
    expect(next(last)).toBe(last);

    const first = seeded(0);
    expect(hasPrevious(first)).toBe(false);
    expect(previous(first)).toBe(first);
  });

  it("reports the track to pre-decode, and nothing at the end", () => {
    expect(peekNext(seeded(0))?.id).toBe("t2");
    expect(peekNext(seeded(2))).toBeNull();
    expect(peekNext(emptyQueue<Item>())).toBeNull();
  });

  it("has no current track when nothing is selected", () => {
    expect(current(emptyQueue<Item>())).toBeNull();
  });
});

describe("insertion", () => {
  it("inserts directly after the cursor", () => {
    const state = insertNext(seeded(0), item(9));
    expect(ids(state)).toEqual(["t1", "t9", "t2", "t3"]);
    expect(state.index).toBe(0);
  });

  it("appends to the end", () => {
    const state = append(seeded(0), item(9));
    expect(ids(state)).toEqual(["t1", "t2", "t3", "t9"]);
  });

  it("starts playing when queueing onto an empty queue", () => {
    expect(insertNext(emptyQueue<Item>(), item(9)).index).toBe(0);
    expect(append(emptyQueue<Item>(), item(9)).index).toBe(0);
  });
});

describe("removeAt", () => {
  it("keeps the same track playing when a later entry goes", () => {
    const state = removeAt(seeded(1), 2);
    expect(state.index).toBe(1);
    expect(current(state)?.id).toBe("t2");
  });

  it("keeps the same track playing when an earlier entry goes", () => {
    const state = removeAt(seeded(1), 0);
    expect(state.index).toBe(0);
    expect(current(state)?.id).toBe("t2");
  });

  it("selects whatever slides into place when the current entry goes", () => {
    expect(current(removeAt(seeded(1), 1))?.id).toBe("t3");
  });

  it("steps back when the removed entry was last", () => {
    expect(current(removeAt(seeded(2), 2))?.id).toBe("t2");
  });

  it("clears the source path when the queue empties", () => {
    const one = play(emptyQueue<Item>(), [item(1)], 0, "Artist");
    const state = removeAt(one, 0);
    expect(state.index).toBe(-1);
    expect(state.path).toBeNull();
    expect(current(state)).toBeNull();
  });

  it("ignores out-of-range removals", () => {
    const state = seeded(0);
    expect(removeAt(state, 7)).toBe(state);
    expect(removeAt(state, -1)).toBe(state);
  });
});

describe("reorder", () => {
  it("follows the playing track when an earlier entry moves past it", () => {
    const state = reorder(seeded(1), 0, 2);
    expect(ids(state)).toEqual(["t2", "t3", "t1"]);
    expect(current(state)?.id).toBe("t2");
    expect(state.index).toBe(0);
  });

  it("follows the playing track when a later entry moves before it", () => {
    const state = reorder(seeded(1), 2, 0);
    expect(ids(state)).toEqual(["t3", "t1", "t2"]);
    expect(current(state)?.id).toBe("t2");
  });

  it("follows the playing track when it is the one moved", () => {
    const state = reorder(seeded(0), 0, 2);
    expect(state.index).toBe(2);
    expect(current(state)?.id).toBe("t1");
  });

  it("ignores no-op and out-of-range moves", () => {
    const state = seeded(0);
    expect(reorder(state, 1, 1)).toBe(state);
    expect(reorder(state, 0, 9)).toBe(state);
    expect(reorder(state, -1, 1)).toBe(state);
  });
});

describe("clear", () => {
  it("returns an empty queue", () => {
    const state = clear<Item>();
    expect(state.items).toHaveLength(0);
    expect(state.index).toBe(-1);
    expect(state.path).toBeNull();
  });
});
