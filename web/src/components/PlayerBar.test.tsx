import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Entry } from "../api/schemas";
import { DirectoryList } from "./DirectoryList";
import { PlayerBar } from "./PlayerBar";
import { renderWithProviders } from "../test/render";

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

describe("PlayerBar", () => {
  it("starts empty with a hint rather than a dead control", async () => {
    await renderWithProviders(<PlayerBar />);
    expect(screen.getByText(/Select a track to play/)).toBeInTheDocument();
    expect(document.querySelector("audio")).toBeNull();
  });

  // A file the browser cannot decode has to say so, rather than go quiet in a
  // way that reads as a broken app.
  it("reports a decode failure to the listener", async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <>
        <DirectoryList entries={undecodable} path="" />
        <PlayerBar />
      </>
    );
    await user.click(screen.getByRole("button", { name: /atmos\.m4a/ }));

    const audio = document.querySelector("audio");
    expect(audio).not.toBeNull();
    fireEvent.error(audio as HTMLAudioElement);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not play this file \(\.m4a\)/i);
  });
});
