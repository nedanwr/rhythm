import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Entry } from "~/api/schemas";
import { DirectoryList } from "./DirectoryList";
import { PlayerBar } from "~/features/player/PlayerBar";
import { FakeEngine } from "~/engine/testing/fakeEngine";
import { renderWithProviders } from "~/test/render";

const entries: Entry[] = [
  { name: "Album", path: "Artist/Album", isDir: true },
  {
    name: "01 Track.flac",
    path: "Artist/01 Track.flac",
    isDir: false,
    id: "default:QXJ0aXN0LzAxIFRyYWNrLmZsYWM",
    ext: "flac",
    size: 31_457_280
  },
  {
    name: "02 Track.flac",
    path: "Artist/02 Track.flac",
    isDir: false,
    id: "default:QXJ0aXN0LzAyIFRyYWNrLmZsYWM",
    ext: "flac",
    size: 1024
  }
];

describe("DirectoryList", () => {
  it("links directories to their own route and shows file details", async () => {
    await renderWithProviders(
      <DirectoryList entries={entries} path="Artist" />
    );

    const dir = screen.getByRole("link", { name: /Album/ });
    expect(dir).toHaveAttribute("href", "/browse/Artist/Album");

    expect(screen.getByText("30.0 MB")).toBeInTheDocument();
    expect(screen.getAllByText("flac")).toHaveLength(2);
  });

  it("explains an empty folder instead of showing nothing", async () => {
    await renderWithProviders(<DirectoryList entries={[]} path="Artist" />);
    expect(screen.getByText(/Nothing here/)).toBeInTheDocument();
  });

  it("plays the clicked track through the player", async () => {
    const user = userEvent.setup();
    const engine = new FakeEngine();
    await renderWithProviders(
      <>
        <DirectoryList entries={entries} path="Artist" />
        <PlayerBar onToggleQueue={() => {}} />
      </>,
      { engine }
    );

    expect(screen.getByText(/Choose a track to begin/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "01 Track.flac" }));

    expect(engine.loads.at(-1)?.track.id).toBe(
      "default:QXJ0aXN0LzAxIFRyYWNrLmZsYWM"
    );
    const rows = screen.getAllByRole("listitem");
    const current = rows.find(
      (row) => row.getAttribute("aria-current") === "true"
    );
    expect(current).toBeDefined();
    expect(
      within(current as HTMLElement).getByText("01 Track.flac")
    ).toBeInTheDocument();
  });

  it("queues the rest of the folder from the clicked track", async () => {
    const user = userEvent.setup();
    const engine = new FakeEngine();
    await renderWithProviders(
      <>
        <DirectoryList entries={entries} path="Artist" />
        <PlayerBar onToggleQueue={() => {}} />
      </>,
      { engine }
    );

    await user.click(screen.getByRole("button", { name: "01 Track.flac" }));
    expect(engine.nextCalls.at(-1)?.id).toBe(
      "default:QXJ0aXN0LzAyIFRyYWNrLmZsYWM"
    );
    const nextButton = screen.getByRole("button", { name: "Next track" });
    expect(nextButton).toBeEnabled();

    await user.click(nextButton);
    expect(engine.loads.at(-1)?.track.id).toBe(
      "default:QXJ0aXN0LzAyIFRyYWNrLmZsYWM"
    );
    expect(screen.getByRole("button", { name: "Next track" })).toBeDisabled();
  });

  it("offers per-track queue actions that reach the queue", async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <>
        <DirectoryList entries={entries} path="Artist" />
        <PlayerBar onToggleQueue={() => {}} />
      </>
    );

    await user.click(screen.getByRole("button", { name: "02 Track.flac" }));
    expect(screen.getByRole("button", { name: "Next track" })).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: "Actions for 01 Track.flac" })
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /Play next/ })
    );

    expect(screen.getByRole("button", { name: "Next track" })).toBeEnabled();
  });
});
