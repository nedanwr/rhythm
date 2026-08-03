import { useQuery } from "@tanstack/react-query";
import { PanelLeftClose } from "lucide-react";

import { fetchRoots } from "~/api/client";
import { FolderTree } from "./FolderTree";
import { Button } from "~/components/ui/button";

/** Displays folders only; artist and album views require indexed metadata. */
export function Sidebar({
  selectedPath,
  onCollapse
}: {
  selectedPath: string;
  onCollapse: () => void;
}) {
  const roots = useQuery({
    queryKey: ["roots"],
    queryFn: ({ signal }) => fetchRoots({ signal })
  });

  const rootName = roots.data?.libraries[0]?.roots[0]?.name ?? "Music";

  return (
    <aside className="border-sidebar-border bg-sidebar relative z-30 flex min-h-0 w-62 shrink-0 flex-col border-r pb-3 max-md:hidden">
      <div className="flex h-16 shrink-0 items-center justify-between px-5">
        <span className="text-sidebar-foreground flex items-end gap-3 text-[17px] font-semibold">
          <span className="flex h-7 items-end gap-0.75" aria-hidden="true">
            <i className="bg-primary h-3 w-1.25" />
            <i className="bg-primary h-6 w-1.25" />
            <i className="bg-primary h-4 w-1.25" />
          </span>
          <span>Rhythm</span>
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          onClick={onCollapse}
        >
          <PanelLeftClose className="size-4" />
        </Button>
      </div>

      <nav
        aria-label="Library folders"
        className="scrollbar min-h-0 flex-1 overflow-y-auto px-3"
      >
        <p className="text-faint mb-2 px-3 text-[10px] font-medium tracking-[.16em] uppercase">
          Library
        </p>
        {roots.isError ? (
          <p role="alert" className="text-destructive px-3 text-xs">
            Could not reach the Rhythm server.
          </p>
        ) : (
          <FolderTree rootName={rootName} selectedPath={selectedPath} />
        )}
      </nav>
    </aside>
  );
}
