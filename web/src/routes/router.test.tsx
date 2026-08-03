import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pathFromLocation } from "./router";
import { renderApp } from "~/test/render";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const roots = {
  libraries: [
    {
      id: "default",
      name: "Music",
      roots: [{ id: "default", name: "Vinyl Rips", path: "/music" }]
    }
  ]
};

const listings: Record<string, unknown> = {
  "": {
    rootId: "default",
    root: "Vinyl Rips",
    path: "",
    parent: null,
    entries: [{ name: "Artist", path: "Artist", isDir: true }]
  },
  Artist: {
    rootId: "default",
    root: "Vinyl Rips",
    path: "Artist",
    parent: "",
    entries: [{ name: "Album", path: "Artist/Album", isDir: true }]
  },
  "Artist/Album": {
    rootId: "default",
    root: "Vinyl Rips",
    path: "Artist/Album",
    parent: "Artist",
    entries: [
      {
        name: "01 Track.flac",
        path: "Artist/Album/01 Track.flac",
        isDir: false,
        id: "default:track",
        ext: "flac",
        size: 100
      }
    ]
  }
};

/** Serves /api/roots and /api/browse from the fixtures above. */
function stubApi() {
  const fetchMock = vi.fn((input: string) => {
    const url = new URL(input, "http://localhost");
    if (url.pathname === "/api/roots") {
      return Promise.resolve(jsonResponse(roots));
    }
    if (url.pathname === "/api/browse") {
      const path = url.searchParams.get("path") ?? "";
      const listing = listings[path];
      return Promise.resolve(
        listing
          ? jsonResponse(listing)
          : jsonResponse({ error: "not found" }, 404)
      );
    }
    return Promise.resolve(jsonResponse({ error: "unknown endpoint" }, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pathFromLocation", () => {
  it("recovers the library path from a browse URL", () => {
    expect(pathFromLocation("/")).toBe("");
    expect(pathFromLocation("/browse")).toBe("");
    expect(pathFromLocation("/browse/")).toBe("");
    expect(pathFromLocation("/browse/Artist/Album")).toBe("Artist/Album");
  });

  // Real folder names contain these.
  it("decodes each segment separately", () => {
    expect(pathFromLocation("/browse/AC%2FDC")).toBe("AC/DC");
    expect(pathFromLocation("/browse/50%25%20off")).toBe("50% off");
    expect(pathFromLocation("/browse/%C3%93lafur/re%3Amember")).toBe(
      "Ólafur/re:member"
    );
    // A bad escape must not take the shell down.
    expect(pathFromLocation("/browse/100%")).toBe("100%");
  });
});

describe("root layout", () => {
  it("names the real root in the sidebar and the breadcrumbs", async () => {
    stubApi();
    await renderApp({ initialPath: "/browse/Artist/Album" });

    const crumbs = await screen.findByRole("navigation", {
      name: "Breadcrumb"
    });
    expect(
      within(crumbs).getByRole("link", { name: "Vinyl Rips" })
    ).toHaveAttribute("href", "/");
    expect(
      within(crumbs).getByRole("link", { name: "Artist" })
    ).toHaveAttribute("href", "/browse/Artist");
    // The current folder is marked as the page and carries no destination,
    // so there is nothing to click back to.
    const current = within(crumbs).getByText("Album");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveAttribute("aria-disabled", "true");
    expect(current).not.toHaveAttribute("href");
  });

  // No walking the library up front.
  it("loads folder children only when a node is expanded", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    await renderApp();

    const tree = await screen.findByRole("navigation", {
      name: "Library folders"
    });
    await within(tree).findByRole("link", { name: /Vinyl Rips/ });

    const browsed = () =>
      fetchMock.mock.calls
        .map(([input]) => String(input))
        .filter((url) => url.startsWith("/api/browse"));

    // Root is open so it fetches; "Artist" is not.
    await waitFor(() => expect(browsed().length).toBeGreaterThan(0));
    expect(browsed().some((url) => url.includes("Artist"))).toBe(false);

    await user.click(
      await within(tree).findByRole("button", { name: "Expand Artist" })
    );
    await waitFor(() =>
      expect(browsed().some((url) => url.includes("path=Artist"))).toBe(true)
    );
    expect(
      await within(tree).findByRole("link", { name: /Album/ })
    ).toBeInTheDocument();
  });

  it("navigates from the sidebar into the main pane", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderApp();

    const tree = await screen.findByRole("navigation", {
      name: "Library folders"
    });
    await user.click(await within(tree).findByRole("link", { name: /Artist/ }));

    // Main pane and crumbs both follow.
    const crumbs = await screen.findByRole("navigation", {
      name: "Breadcrumb"
    });
    await waitFor(() =>
      expect(within(crumbs).getByText("Artist")).toHaveAttribute(
        "aria-current",
        "page"
      )
    );
  });

  it("opens and closes the queue drawer from the player bar", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderApp();

    // Closed means out of the a11y tree.
    expect(screen.queryByRole("complementary", { name: "Queue" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Toggle queue" }));
    await waitFor(() =>
      expect(
        screen.getByRole("complementary", { name: "Queue" })
      ).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Close queue" }));
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Queue" })).toBeNull()
    );
  });

  // Unclipped, the off-canvas drawer widens the document and narrow
  // viewports scroll sideways into nothing.
  it("clips the off-canvas queue drawer", async () => {
    stubApi();
    const user = userEvent.setup();
    const { container } = await renderApp();

    await user.click(screen.getByRole("button", { name: "Toggle queue" }));
    const drawer = await screen.findByRole("complementary", { name: "Queue" });
    const pane = drawer.closest(".overflow-hidden");

    expect(container).toContainElement(drawer);
    expect(pane).not.toBeNull();
    expect(pane).toHaveClass("relative");
  });

  it("collapses and restores the sidebar", async () => {
    stubApi();
    const user = userEvent.setup();
    await renderApp();

    await screen.findByRole("navigation", { name: "Library folders" });
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(
      screen.queryByRole("navigation", { name: "Library folders" })
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(
      await screen.findByRole("navigation", { name: "Library folders" })
    ).toBeInTheDocument();
  });
});
