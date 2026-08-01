import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Entry } from "~/api/schemas";
import { DirectoryList } from "~/features/browse/DirectoryList";
import { PlayerBar } from "./PlayerBar";
import { QueueDrawer } from "./QueueDrawer";
import { FakeEngine } from "~/engine/testing/fakeEngine";
import { renderWithProviders } from "~/test/render";

const entries: Entry[] = ["A", "B", "C"].map((name, i) => ({
  name: `${name}.flac`,
  path: `${name}.flac`,
  isDir: false,
  id: `default:track-${i}`,
  ext: "flac",
  size: 100
}));

async function renderQueue() {
  const user = userEvent.setup();
  const engine = new FakeEngine();
  await renderWithProviders(
    <>
      <DirectoryList entries={entries} path="Artist" />
      <QueueDrawer open onClose={() => {}} />
      <PlayerBar onToggleQueue={() => {}} />
    </>,
    { engine }
  );
  return { user, engine };
}

function queueRows() {
  return within(
    screen.getByRole("complementary", { name: "Queue" })
  ).getAllByRole("listitem");
}

describe("QueueDrawer", () => {
  it("starts empty and says so", async () => {
    await renderWithProviders(<QueueDrawer open onClose={() => {}} />);
    expect(screen.getByText(/Queue is empty/)).toBeInTheDocument();
    expect(screen.getByText(/0/)).toBeInTheDocument();
  });

  it("lists the queue and marks what is playing", async () => {
    const { user } = await renderQueue();
    await user.click(screen.getByRole("button", { name: "A.flac" }));

    const rows = queueRows();
    expect(rows).toHaveLength(3);
    expect(
      within(rows[0] as HTMLElement).getByText("Playing now")
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText("Up next")
    ).toBeInTheDocument();
  });

  it("plays a queue entry when its row is clicked", async () => {
    const { user, engine } = await renderQueue();
    await user.click(screen.getByRole("button", { name: "A.flac" }));

    const rows = queueRows();
    await user.click(
      within(rows[2] as HTMLElement).getByRole("button", {
        name: "Play C.flac"
      })
    );

    expect(engine.loads.at(-1)?.track.id).toBe("default:track-2");
  });

  it("reorders without disturbing the current track", async () => {
    const { user, engine } = await renderQueue();
    await user.click(screen.getByRole("button", { name: "B.flac" }));
    const loadsBefore = engine.loads.length;

    await user.click(screen.getByRole("button", { name: "Move C.flac up" }));

    const rows = queueRows();
    expect(
      within(rows[1] as HTMLElement).getByText(/C\.flac/)
    ).toBeInTheDocument();
    expect(
      within(rows[2] as HTMLElement).getByText(/B\.flac/)
    ).toBeInTheDocument();
    expect(engine.loads).toHaveLength(loadsBefore);
    expect(engine.loads.at(-1)?.track.id).toBe("default:track-1");
    expect(
      within(rows[2] as HTMLElement).getByText("Playing now")
    ).toBeInTheDocument();
  });

  it("keeps the current track when an earlier entry is removed", async () => {
    const { user, engine } = await renderQueue();
    await user.click(screen.getByRole("button", { name: "B.flac" }));
    const loadsBefore = engine.loads.length;

    await user.click(
      screen.getByRole("button", { name: "Remove A.flac from queue" })
    );

    expect(queueRows()).toHaveLength(2);
    expect(engine.loads).toHaveLength(loadsBefore);
    expect(engine.loads.at(-1)?.track.id).toBe("default:track-1");
  });

  it("clears the queue", async () => {
    const { user } = await renderQueue();
    await user.click(screen.getByRole("button", { name: "A.flac" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByText(/Queue is empty/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing playing/)).toBeInTheDocument();
  });

  it("is inert while closed", async () => {
    const { container } = await renderWithProviders(
      <QueueDrawer open={false} onClose={() => {}} />
    );
    expect(screen.queryByRole("complementary", { name: "Queue" })).toBeNull();

    const drawer = container.querySelector("aside");
    expect(drawer).toHaveAttribute("inert");
    expect(drawer).toHaveAttribute("aria-hidden", "true");
  });
});
