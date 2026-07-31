import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  MEDIA_ERR,
  playbackErrorMessage,
  PlayerProvider,
  usePlayer,
  type PlayerState
} from "./PlayerProvider";

// jsdom cannot construct TimeRanges.
function timeRanges(ranges: [number, number][]): TimeRanges {
  return {
    length: ranges.length,
    start: (i: number) => ranges[i]![0],
    end: (i: number) => ranges[i]![1]
  } as TimeRanges;
}

function mountPlayer() {
  const seen: { current: PlayerState | null } = { current: null };
  function Probe() {
    seen.current = usePlayer();
    return null;
  }
  render(
    <PlayerProvider>
      <Probe />
    </PlayerProvider>
  );
  const audio = document.querySelector("audio") as HTMLAudioElement;
  return { player: () => seen.current as PlayerState, audio };
}

function setBuffered(
  audio: HTMLAudioElement,
  ranges: [number, number][],
  position: number
) {
  Object.defineProperty(audio, "buffered", {
    configurable: true,
    value: timeRanges(ranges)
  });
  Object.defineProperty(audio, "currentTime", {
    configurable: true,
    writable: true,
    value: position
  });
}

describe("getBuffered", () => {
  it("reports how far the leading range has downloaded", () => {
    const { player, audio } = mountPlayer();
    setBuffered(audio, [[0, 42]], 10);
    expect(player().getBuffered()).toBe(42);
  });

  it("uses the range containing the playhead after a forward seek", () => {
    const { player, audio } = mountPlayer();
    setBuffered(
      audio,
      [
        [0, 39],
        [250, 289]
      ],
      252
    );
    expect(player().getBuffered()).toBe(289);
  });

  it("reports nothing when the playhead sits in an unbuffered gap", () => {
    const { player, audio } = mountPlayer();
    setBuffered(
      audio,
      [
        [0, 39],
        [250, 289]
      ],
      120
    );
    expect(player().getBuffered()).toBe(0);
  });

  it("has nothing buffered before anything loads", () => {
    const { player, audio } = mountPlayer();
    setBuffered(audio, [], 0);
    expect(player().getBuffered()).toBe(0);
  });
});

describe("playbackErrorMessage", () => {
  it("names both possibilities when the browser cannot tell them apart", () => {
    const message = playbackErrorMessage(
      MEDIA_ERR.SRC_NOT_SUPPORTED,
      "broken.flac",
      "flac"
    );
    expect(message).toContain("broken.flac");
    expect(message).toMatch(/damaged/);
    expect(message).toMatch(/\.flac/);
    expect(message).not.toMatch(/could not play \.flac files/);
  });

  it("distinguishes a dropped connection from a bad file", () => {
    expect(playbackErrorMessage(MEDIA_ERR.NETWORK, "a.flac", "flac")).toMatch(
      /connection/i
    );
    expect(playbackErrorMessage(MEDIA_ERR.DECODE, "a.flac", "flac")).toMatch(
      /damaged/i
    );
  });

  it("still says something useful with no track details", () => {
    const message = playbackErrorMessage(undefined);
    expect(message).toContain("this track");
    expect(message).toContain("its format");
  });
});

describe("playback errors", () => {
  const track = {
    name: "broken.flac",
    path: "broken.flac",
    isDir: false as const,
    id: "default:broken",
    ext: "flac",
    size: 1
  };

  function failWith(audio: HTMLAudioElement, code: number) {
    Object.defineProperty(audio, "error", {
      configurable: true,
      value: { code }
    });
    fireEvent.error(audio);
  }

  it("reports a real decode failure", () => {
    const { player, audio } = mountPlayer();
    act(() => player().play([track], 0, ""));
    act(() => failWith(audio, MEDIA_ERR.SRC_NOT_SUPPORTED));
    expect(player().error).toContain("broken.flac");
    expect(player().status).toBe("paused");
  });

  it("stays quiet when a load is aborted by switching tracks", () => {
    const { player, audio } = mountPlayer();
    act(() => player().play([track], 0, ""));
    act(() => failWith(audio, MEDIA_ERR.ABORTED));
    expect(player().error).toBeNull();
  });
});

describe("queue editing", () => {
  const track = (n: number) => ({
    name: `${n}.flac`,
    path: `${n}.flac`,
    isDir: false as const,
    id: `default:t${n}`,
    ext: "flac",
    size: 1
  });
  const three = [track(1), track(2), track(3)];

  it("follows the playing track when an earlier entry moves past it", () => {
    const { player } = mountPlayer();
    act(() => player().play(three, 1, "Artist"));
    expect(player().current?.id).toBe("default:t2");

    act(() => player().reorder(0, 2));
    expect(player().index).toBe(0);
    expect(player().current?.id).toBe("default:t2");
  });

  it("keeps playing the same track when a later entry is removed", () => {
    const { player } = mountPlayer();
    act(() => player().play(three, 1, "Artist"));
    act(() => player().removeAt(2));
    expect(player().index).toBe(1);
    expect(player().current?.id).toBe("default:t2");
  });

  it("moves to the entry that slides into place when the current one goes", () => {
    const { player } = mountPlayer();
    act(() => player().play(three, 1, "Artist"));
    act(() => player().removeAt(1));
    expect(player().current?.id).toBe("default:t3");
  });

  it("stops when the last remaining entry is removed", () => {
    const { player } = mountPlayer();
    act(() => player().play([track(1)], 0, "Artist"));
    act(() => player().removeAt(0));
    expect(player().index).toBe(-1);
    expect(player().current).toBeNull();
    expect(player().currentPath).toBeNull();
  });

  it("starts playing when queueing onto an empty queue", () => {
    const { player } = mountPlayer();
    act(() => player().playNext(track(9)));
    expect(player().current?.id).toBe("default:t9");

    const { player: other } = mountPlayer();
    act(() => other().addToQueue(track(8)));
    expect(other().current?.id).toBe("default:t8");
  });

  it("inserts directly after the current track", () => {
    const { player } = mountPlayer();
    act(() => player().play(three, 0, "Artist"));
    act(() => player().playNext(track(9)));
    expect(player().queue.map((t) => t.id)).toEqual([
      "default:t1",
      "default:t9",
      "default:t2",
      "default:t3"
    ]);
    expect(player().current?.id).toBe("default:t1");
  });

  it("ignores out-of-range edits rather than corrupting the queue", () => {
    const { player } = mountPlayer();
    act(() => player().play(three, 0, "Artist"));
    act(() => player().reorder(0, 9));
    act(() => player().reorder(-1, 1));
    act(() => player().removeAt(7));
    act(() => player().playAt(42));
    expect(player().queue).toHaveLength(3);
    expect(player().index).toBe(0);
  });
});
