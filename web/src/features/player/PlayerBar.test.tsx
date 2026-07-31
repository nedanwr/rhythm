import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Entry } from "~/api/schemas";
import { DirectoryList } from "~/features/browse/DirectoryList";
import { PlayerBar } from "./PlayerBar";
import { renderWithProviders } from "~/test/render";
import { MEDIA_ERR } from "./PlayerProvider";

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

const flac: Entry[] = [
  {
    name: "01 Track.flac",
    path: "01 Track.flac",
    isDir: false,
    id: "default:MDEgVHJhY2suZmxhYw",
    ext: "flac",
    size: 100
  }
];

function loadMetadata(seconds: number) {
  const audio = document.querySelector("audio") as HTMLAudioElement;
  Object.defineProperty(audio, "duration", {
    configurable: true,
    value: seconds
  });
  fireEvent.loadedMetadata(audio);
  return audio;
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

  it("reports a decode failure to the listener", async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <>
        <DirectoryList entries={undecodable} path="" />
        <PlayerBar onToggleQueue={() => {}} />
      </>
    );
    await user.click(screen.getByRole("button", { name: "atmos.m4a" }));

    const audio = document.querySelector("audio") as HTMLAudioElement;
    expect(audio).not.toBeNull();
    Object.defineProperty(audio, "error", {
      configurable: true,
      value: { code: MEDIA_ERR.SRC_NOT_SUPPORTED }
    });
    fireEvent.error(audio);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/atmos\.m4a/i);
    expect(alert).toHaveTextContent(/damaged/i);
  });

  it("reflects play and pause coming from the element", async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <>
        <DirectoryList entries={flac} path="" />
        <PlayerBar onToggleQueue={() => {}} />
      </>
    );
    await user.click(screen.getByRole("button", { name: "01 Track.flac" }));
    const audio = document.querySelector("audio") as HTMLAudioElement;

    fireEvent.play(audio);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();

    fireEvent.pause(audio);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("shows the duration once metadata arrives and seeks to a position", async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <>
        <DirectoryList entries={flac} path="" />
        <PlayerBar onToggleQueue={() => {}} />
      </>
    );
    await user.click(screen.getByRole("button", { name: "01 Track.flac" }));

    expect(screen.getAllByText("—:—").length).toBeGreaterThan(0);

    const audio = loadMetadata(200);
    expect(await screen.findByText("3:20")).toBeInTheDocument();

    const seek = screen.getByRole("slider", { name: "Seek" });
    expect(seek).toHaveAttribute("max", "200");
    fireEvent.change(seek, { target: { value: "50" } });
    fireEvent.blur(seek);
    expect(audio.currentTime).toBe(50);
  });

  it("changes volume on the element", async () => {
    await renderWithProviders(<PlayerBar onToggleQueue={() => {}} />);
    const audio = document.querySelector("audio") as HTMLAudioElement;
    const volume = screen.getByRole("slider", { name: "Volume" });

    fireEvent.change(volume, { target: { value: "0.25" } });
    expect(audio.volume).toBeCloseTo(0.25);
  });

  it("advances on ended and stops at the end of the queue", async () => {
    const user = userEvent.setup();
    const two: Entry[] = [
      ...flac,
      {
        name: "02 Track.flac",
        path: "02 Track.flac",
        isDir: false,
        id: "default:MDIgVHJhY2suZmxhYw",
        ext: "flac",
        size: 100
      }
    ];
    await renderWithProviders(
      <>
        <DirectoryList entries={two} path="" />
        <PlayerBar onToggleQueue={() => {}} />
      </>
    );
    await user.click(screen.getByRole("button", { name: "01 Track.flac" }));
    const audio = document.querySelector("audio") as HTMLAudioElement;

    fireEvent.ended(audio);
    await waitFor(() =>
      expect(audio).toHaveAttribute(
        "src",
        "/api/stream/default%3AMDIgVHJhY2suZmxhYw"
      )
    );

    fireEvent.ended(audio);
    expect(audio).toHaveAttribute(
      "src",
      "/api/stream/default%3AMDIgVHJhY2suZmxhYw"
    );
  });
});
