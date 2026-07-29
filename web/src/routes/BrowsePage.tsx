import { useQuery } from "@tanstack/react-query";
import { ApiError, browse } from "../api/client";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { DirectoryList } from "../components/DirectoryList";

/** Query key for one listing, so navigating back is instant. */
export function browseQueryKey(path: string) {
  return ["browse", path] as const;
}

/**
 * Turns a failed browse into something actionable. The server's wording is
 * correct but terse, and it deliberately says nothing about the filesystem, so
 * the context — which folder, and whether it's the folder or the server — is
 * added here.
 */
export function browseErrorMessage(error: unknown, path: string): string {
  if (!(error instanceof ApiError)) return "Something went wrong.";
  if (error.status === 0) return error.message;
  if (error.status === 404) {
    return path
      ? `“${path}” is no longer in your library.`
      : "That folder is no longer in your library.";
  }
  if (error.status >= 500) {
    return "The Rhythm server could not read that folder.";
  }
  return error.message;
}

export function BrowsePage({ path }: { path: string }) {
  const query = useQuery({
    queryKey: browseQueryKey(path),
    queryFn: ({ signal }) => browse(path, { signal })
  });

  if (query.isPending) {
    return (
      <main className="pane">
        <p className="status">Loading…</p>
      </main>
    );
  }

  if (query.isError) {
    return (
      <main className="pane">
        <p role="alert" className="status status--error">
          {browseErrorMessage(query.error, path)}
        </p>
        <button
          type="button"
          className="retry"
          onClick={() => void query.refetch()}
        >
          Try again
        </button>
      </main>
    );
  }

  const listing = query.data;
  return (
    <main className="pane">
      <Breadcrumbs rootName={listing.root} path={listing.path} />
      <DirectoryList entries={listing.entries} path={listing.path} />
    </main>
  );
}
