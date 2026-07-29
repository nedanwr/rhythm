import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Entry } from "../api/schemas";
import { DirectoryList, formatSize } from "./DirectoryList";
import { PlayerBar } from "./PlayerBar";
import { renderWithProviders } from "../test/render";

const entries: Entry[] = [
  { name: "Album", path: "Artist/Album", isDir: true },
  {
    name: "01 Track.flac",
    path: "Artist/01 Track.flac",
    isDir: false,
    id: "default:QXJ0aXN0LzAxIFRyYWNrLmZsYWM",
    ext: "flac",
    size: 31_457_280
  }
];

describe("formatSize", () => {
  it("scales units and never invents a number", () => {
    expect(formatSize(undefined)).toBe("");
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(31_457_280)).toBe("30.0 MB");
  });
});

describe("DirectoryList", () => {
  it("links directories to their own route and shows file details", async () => {
    await renderWithProviders(
      <DirectoryList entries={entries} path="Artist" />
    );

    const dir = screen.getByRole("link", { name: /Album/ });
    expect(dir).toHaveAttribute("href", "/browse/Artist/Album");

    const track = screen.getByRole("button", { name: /01 Track\.flac/ });
    expect(track).toHaveTextContent("flac");
    expect(track).toHaveTextContent("30.0 MB");
  });

  it("explains an empty folder instead of showing nothing", async () => {
    await renderWithProviders(<DirectoryList entries={[]} path="Artist" />);
    expect(screen.getByText(/Nothing here/)).toBeInTheDocument();
  });

  // The click has to reach the player; an inert row is the failure that matters.
  it("plays the clicked track through the player", async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <>
        <DirectoryList entries={entries} path="Artist" />
        <PlayerBar />
      </>
    );

    expect(screen.getByText(/Select a track to play/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /01 Track\.flac/ }));

    const audio = document.querySelector("audio");
    expect(audio).toHaveAttribute(
      "src",
      "/api/stream/default%3AQXJ0aXN0LzAxIFRyYWNrLmZsYWM"
    );
    expect(
      screen.getByRole("button", { name: /01 Track\.flac/ })
    ).toHaveAttribute("aria-current", "true");
  });
});
