import { useQuery } from "@tanstack/react-query";

import { ApiError, browse } from "~/api/client";
import { DirectoryList } from "./DirectoryList";
import { Button } from "~/components/ui/button";

export function browseQueryKey(path: string) {
  return ["browse", path] as const;
}

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
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  if (query.isError) {
    return (
      <div className="grid h-64 place-items-center">
        <div className="text-center">
          <p role="alert" className="text-destructive text-sm">
            {browseErrorMessage(query.error, path)}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const listing = query.data;
  return <DirectoryList entries={listing.entries} path={listing.path} />;
}
