import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/api/client";
import { BrowsePage, browseErrorMessage } from "./BrowsePage";
import { renderWithProviders } from "~/test/render";
import { crumbsFor } from "./Breadcrumbs";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const listing = {
  rootId: "default",
  root: "Music",
  path: "Artist/Album",
  parent: "Artist",
  entries: [
    {
      name: "01 Track.flac",
      path: "Artist/Album/01 Track.flac",
      isDir: false,
      id: "default:x",
      ext: "flac",
      size: 100
    }
  ]
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("crumbsFor", () => {
  it("builds cumulative paths", () => {
    expect(crumbsFor("")).toEqual([]);
    expect(crumbsFor("Artist/Album")).toEqual([
      { name: "Artist", path: "Artist" },
      { name: "Album", path: "Artist/Album" }
    ]);
  });
});

describe("browseErrorMessage", () => {
  it("names the folder for a 404 and keeps the server's wording otherwise", () => {
    expect(
      browseErrorMessage(new ApiError(404, "not found"), "Artist/Album")
    ).toContain("Artist/Album");
    expect(browseErrorMessage(new ApiError(404, "not found"), "")).toMatch(
      /no longer in your library/
    );
    expect(browseErrorMessage(new ApiError(400, "not a directory"), "x")).toBe(
      "not a directory"
    );
    expect(
      browseErrorMessage(new ApiError(500, "internal error"), "x")
    ).toMatch(/could not read/);
    expect(
      browseErrorMessage(
        new ApiError(0, "Could not reach the Rhythm server."),
        "x"
      )
    ).toBe("Could not reach the Rhythm server.");
    expect(browseErrorMessage(new Error("boom"), "x")).toBe(
      "Something went wrong."
    );
  });
});

describe("BrowsePage", () => {
  it("renders the folder's tracks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(listing)))
    );
    await renderWithProviders(<BrowsePage path="Artist/Album" />, {
      initialPath: "/browse/Artist/Album"
    });

    expect(
      await screen.findByRole("button", { name: "01 Track.flac" })
    ).toBeVisible();
  });

  it("shows the server's error and can retry", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404))
      .mockResolvedValueOnce(jsonResponse(listing));
    vi.stubGlobal("fetch", fetchMock);

    await renderWithProviders(<BrowsePage path="Artist/Album" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no longer in your library"
    );
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "01 Track.flac" })
      ).toBeVisible()
    );
  });

  it("requests the root listing for the index route", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ ...listing, path: "", parent: null, entries: [] })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderWithProviders(<BrowsePage path="" />);
    await screen.findByText(/Nothing here/);
    expect(fetchMock).toHaveBeenCalledWith("/api/browse", expect.anything());
  });
});
