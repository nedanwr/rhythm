import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";

import { browse } from "~/api/client";
import { browseQueryKey } from "./BrowsePage";
import { cn } from "~/lib/utils";

function TreeNode({
  name,
  path,
  depth,
  selectedPath
}: {
  name: string;
  path: string;
  depth: number;
  selectedPath: string;
}) {
  // Expand ancestors of the selected folder on direct navigation.
  const onSelectedTrail =
    path === "" || selectedPath === path || selectedPath.startsWith(`${path}/`);
  const [expanded, setExpanded] = useState(onSelectedTrail);

  // The main pane uses the same key, so an expanded folder shares its cache.
  const children = useQuery({
    queryKey: browseQueryKey(path),
    queryFn: ({ signal }) => browse(path, { signal }),
    enabled: expanded
  });

  const folders = (children.data?.entries ?? []).filter((entry) => entry.isDir);
  const isSelected = selectedPath === path;

  return (
    <li>
      <div
        className={cn(
          "group hover:bg-accent flex h-8 items-center gap-1 rounded-md pr-1 text-sm transition-colors",
          isSelected && "bg-accent text-accent-foreground"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
          onClick={() => setExpanded((open) => !open)}
          className="text-faint hover:text-foreground grid size-5 shrink-0 place-items-center rounded"
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform",
              expanded && "rotate-90"
            )}
          />
        </button>
        <Link
          to="/browse/$"
          params={{ _splat: path }}
          aria-current={isSelected ? "page" : undefined}
          className={cn(
            "text-muted-foreground group-hover:text-foreground flex min-w-0 flex-1 items-center gap-2 truncate py-1 text-left",
            isSelected && "text-accent-foreground"
          )}
          title={name}
        >
          {expanded ? (
            <FolderOpen className="text-faint size-4 shrink-0" />
          ) : (
            <Folder className="text-faint size-4 shrink-0" />
          )}
          <span className="truncate">{name}</span>
        </Link>
      </div>

      {expanded && (
        <>
          {children.isPending && (
            <p
              className="text-faint py-1 text-xs"
              style={{ paddingLeft: `${depth * 12 + 32}px` }}
            >
              Loading…
            </p>
          )}
          {children.isError && (
            <p
              role="alert"
              className="text-destructive py-1 text-xs"
              style={{ paddingLeft: `${depth * 12 + 32}px` }}
            >
              Could not read this folder.
            </p>
          )}
          {children.isSuccess && folders.length === 0 && (
            <p
              className="text-faint py-1 text-xs"
              style={{ paddingLeft: `${depth * 12 + 32}px` }}
            >
              No subfolders
            </p>
          )}
          {folders.length > 0 && (
            <ul>
              {folders.map((folder) => (
                <TreeNode
                  key={folder.path}
                  name={folder.name}
                  path={folder.path}
                  depth={depth + 1}
                  selectedPath={selectedPath}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

export function FolderTree({
  rootName,
  selectedPath
}: {
  rootName: string;
  selectedPath: string;
}) {
  return (
    <ul>
      <TreeNode name={rootName} path="" depth={0} selectedPath={selectedPath} />
    </ul>
  );
}
