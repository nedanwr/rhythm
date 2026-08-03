import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Entry } from "~/api/schemas";
import { FakeEngine } from "~/engine/testing/fakeEngine";
import { DirectoryList } from "~/features/browse/DirectoryList";
import { PlayerBar } from "./PlayerBar";
import { renderWithProviders } from "~/test/render";

const flac: Entry[] = [
  {
    name: "01 Track.flac",
    path: "01 Track.flac",
    isDir: false,
    id: "default:MDEgVHJhY2suZmxhYw",
    ext: "flac",
    size: 100
  },
  {
    name: "02 Track.flac",
    path: "02 Track.flac",
    isDir: false,
    id: "default:MDIgVHJhY2suZmxhYw",
    ext: "flac",
    size: 100
  }
];

const undecodable: Entry[] = [
  {
    name: "atmos.m4a",
    path: "atmos.m4a",
    isDir: false,
    id: "default:YXRtb3MubTRh",
    ext: "m4a",
    size: 100
  }
];

async function renderBar(entries: Entry[], engine = new FakeEngine()) {
  const user = userEvent.setup();
  await renderWithProviders(
    <>
      <DirectoryList entries={entries} path="" />
      <PlayerBar onToggleQueue={() => {}} />
    </>,
    { engine }
  );
  return { user, engine };
}

describe("PlayerBar", () => {
  it("starts idle with the controls disabled rather than inert", async () => {
    await renderWithProviders(<PlayerBar onToggleQueue={() => {}} />);
    expect(screen.getByText(/Nothing playing/)).toBeInTheDocument();
    expect(screen.getByText(/Choose a track to begin/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next track" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Previous track" })
    ).toBeDisabled();
  });

  it("reports a playback failure to the listener", async () => {
    const engine = new FakeEngine();
    engine.deferLoads = true;
    engine.failNextLoad = {
      kind: "unsupported",
      message:
        "“atmos.m4a” could not be decoded. MPEG-4 audio files can hold " +
        "several codecs, and this one needs a decoder Rhythm does not have yet.",
      trackId: "default:YXRtb3MubTRh"
    };
    const { user } = await renderBar(undecodable, engine);
    await user.click(screen.getByRole("button", { name: "atmos.m4a" }));
    act(() => engine.settleLoad());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/atmos\.m4a/i);
    expect(alert).toHaveTextContent(/several codecs/i);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("shows pause while playing and play while paused", async () => {
    const { user, engine } = await renderBar(flac);
    await user.click(screen.getByRole("button", { name: "01 Track.flac" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();

    act(() => engine.pause());
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("offers pause, not play, while a track is still loading", async () => {
    const engine = new FakeEngine();
    engine.deferLoads = true;
    const { user } = await renderBar(flac, engine);
    await user.click(screen.getByRole("button", { name: "01 Track.flac" }));

    const button = screen.getByRole("button", { name: "Pause" });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(engine.pauseCalls).toBe(1);
  });

  it("shows the duration the engine reports and seeks to a position", async () => {
    const engine = new FakeEngine();
    engine.deferLoads = true;
    engine.loadDuration = 200;
    const { user } = await renderBar(flac, engine);

    await user.click(screen.getByRole("button", { name: "01 Track.flac" }));
    expect(screen.getAllByText("—:—").length).toBeGreaterThan(0);

    act(() => engine.settleLoad());
    expect(await screen.findByText("3:20")).toBeInTheDocument();

    const seek = screen.getByRole("slider", { name: "Seek" });
    expect(seek).toHaveAttribute("max", "200");
    fireEvent.change(seek, { target: { value: "50" } });
    fireEvent.blur(seek);
    expect(engine.seeks).toContain(50);
  });

  it("changes the engine's volume", async () => {
    const engine = new FakeEngine();
    await renderWithProviders(<PlayerBar onToggleQueue={() => {}} />, {
      engine
    });
    const volume = screen.getByRole("slider", { name: "Volume" });
    fireEvent.change(volume, { target: { value: "0.25" } });
    expect(engine.getSnapshot().volume).toBeCloseTo(0.25);
  });

  it("skips forward and stops offering it at the end of the queue", async () => {
    const { user, engine } = await renderBar(flac);
    await user.click(screen.getByRole("button", { name: "01 Track.flac" }));

    const skip = screen.getByRole("button", { name: "Next track" });
    expect(skip).toBeEnabled();
    await user.click(skip);
    expect(engine.loads.map((l) => l.track.id)).toEqual([
      "default:MDEgVHJhY2suZmxhYw",
      "default:MDIgVHJhY2suZmxhYw"
    ]);
    expect(screen.getByRole("button", { name: "Next track" })).toBeDisabled();
  });

  it("follows a gapless advance the engine made on its own", async () => {
    const { user, engine } = await renderBar(flac);
    await user.click(screen.getByRole("button", { name: "01 Track.flac" }));

    act(() =>
      engine.advanceTo({
        id: "default:MDIgVHJhY2suZmxhYw",
        name: "02 Track.flac"
      })
    );

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText("02 Track.flac")).toBeInTheDocument();
    expect(engine.loads).toHaveLength(1);
  });
});
