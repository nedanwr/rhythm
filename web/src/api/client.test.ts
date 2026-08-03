import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, browse, fetchRoots, streamUrl } from "./client";

function mockFetch(response: Response | Error) {
  const fn = vi.fn(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response)
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const listing = {
  rootId: "default",
  root: "Music",
  path: "Artist",
  parent: "",
  entries: [
    { name: "Album", path: "Artist/Album", isDir: true },
    {
      name: "01.flac",
      path: "Artist/01.flac",
      isDir: false,
      id: "default:QXJ0aXN0LzAxLmZsYWM",
      ext: "flac",
      size: 1234,
      modTime: "2026-01-01T00:00:00Z"
    }
  ]
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browse", () => {
  it("requests the root listing without query parameters", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ ...listing, path: "", parent: null })
    );
    const result = await browse("");
    expect(fetchMock).toHaveBeenCalledWith("/api/browse", expect.anything());
    expect(result.path).toBe("");
    expect(result.parent).toBeNull();
  });

  it("encodes the path and root", async () => {
    const fetchMock = mockFetch(jsonResponse(listing));
    await browse("Ólafur/re:member", { root: "default" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/browse?path=%C3%93lafur%2Fre%3Amember&root=default",
      expect.anything()
    );
  });

  it("surfaces the server's own error message", async () => {
    mockFetch(jsonResponse({ error: "not a directory" }, 400));
    await expect(browse("track.flac")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "not a directory"
    });
  });

  it("reports an unreachable server rather than throwing a network error", async () => {
    mockFetch(new TypeError("Failed to fetch"));
    const error = await browse("").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });

  // Parsing at the boundary exists so drift fails here rather than as
  // `undefined` deep inside a component.
  it("rejects a response whose shape does not match the contract", async () => {
    mockFetch(jsonResponse({ rootId: "default", entries: "nope" }));
    await expect(browse("")).rejects.toThrow(/unexpected response shape/);
  });

  it("rejects a non-JSON body", async () => {
    mockFetch(new Response("<!doctype html>", { status: 200 }));
    await expect(browse("")).rejects.toThrow(/malformed response/);
  });
});

describe("fetchRoots", () => {
  it("parses the library list", async () => {
    mockFetch(
      jsonResponse({
        libraries: [
          {
            id: "default",
            name: "Music",
            roots: [{ id: "default", name: "Music", path: "/music" }]
          }
        ]
      })
    );
    const result = await fetchRoots();
    expect(result.libraries[0]?.roots[0]?.id).toBe("default");
  });
});

describe("streamUrl", () => {
  it("escapes the id so a root-qualified id survives the URL", () => {
    expect(streamUrl("default:QWxidW0vMDEuZmxhYw")).toBe(
      "/api/stream/default%3AQWxidW0vMDEuZmxhYw"
    );
  });
});
