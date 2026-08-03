import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Breadcrumbs, crumbsFor } from "./Breadcrumbs";
import { renderWithProviders } from "~/test/render";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

const path = "Artist/Album/Disc 1";

describe("crumbsFor", () => {
  it("accumulates each segment into a full path", () => {
    expect(crumbsFor(path)).toEqual([
      { name: "Artist", path: "Artist" },
      { name: "Album", path: "Artist/Album" },
      { name: "Disc 1", path: "Artist/Album/Disc 1" }
    ]);
  });
});

describe("Breadcrumbs", () => {
  it("renders without a React DOM warning", async () => {
    await renderWithProviders(<Breadcrumbs rootName="Music" path={path} />, {
      initialPath: `/browse/${encodeURIComponent(path)}`
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("keeps separators as siblings rather than nested list items", async () => {
    await renderWithProviders(<Breadcrumbs rootName="Music" path={path} />);
    const list = screen
      .getByRole("navigation", { name: "Breadcrumb" })
      .querySelector("ol");

    expect(list).not.toBeNull();
    expect(list!.querySelectorAll("li li")).toHaveLength(0);
    expect([...list!.children].every((child) => child.tagName === "LI")).toBe(
      true
    );
    expect(
      [...list!.children].map((child) => child.getAttribute("data-slot"))
    ).toEqual([
      "breadcrumb-item",
      "breadcrumb-separator",
      "breadcrumb-item",
      "breadcrumb-separator",
      "breadcrumb-item",
      "breadcrumb-separator",
      "breadcrumb-item"
    ]);
  });

  it("links every ancestor and marks the last crumb as the current page", async () => {
    await renderWithProviders(<Breadcrumbs rootName="Music" path={path} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });

    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent)
    ).toEqual(["Music", "Artist", "Album", "Disc 1"]);
    expect(within(nav).getByText("Music")).toHaveAttribute("href", "/");
    expect(within(nav).getByText("Album")).toHaveAttribute(
      "href",
      "/browse/Artist/Album"
    );

    const current = within(nav).getByText("Disc 1");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).not.toHaveAttribute("href");

    expect(
      nav.querySelectorAll('[data-slot="breadcrumb-separator"]')
    ).toHaveLength(3);
    nav
      .querySelectorAll('[data-slot="breadcrumb-separator"]')
      .forEach((separator) =>
        expect(separator).toHaveAttribute("aria-hidden", "true")
      );
  });
});
