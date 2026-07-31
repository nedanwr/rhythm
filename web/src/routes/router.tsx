import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouter,
  useRouterState
} from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, PanelLeftOpen } from "lucide-react";

import { fetchRoots } from "~/api/client";
import { Button } from "~/components/ui/button";
import { Breadcrumbs } from "~/features/browse/Breadcrumbs";
import { BrowsePage } from "~/features/browse/BrowsePage";
import { Sidebar } from "~/features/browse/Sidebar";
import { PlayerBar } from "~/features/player/PlayerBar";
import { PlayerProvider } from "~/features/player/PlayerProvider";
import { QueueDrawer } from "~/features/player/QueueDrawer";

/**
 * Library path from a splat URL. Segments decode one at a time — folder
 * names contain "%" and "#", and decoding whole would fake a separator.
 */
export function pathFromLocation(pathname: string): string {
  if (!pathname.startsWith("/browse")) return "";
  const rest = pathname.slice("/browse".length).replace(/^\//, "");
  if (!rest) return "";
  return rest
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        // Not worth throwing over; the server 404s it and the UI says so.
        return segment;
      }
    })
    .join("/");
}

/**
 * Routes in code, not by file convention. Barely one route, but it keeps
 * deep links and the SPA fallback honest. The provider wraps the root layout
 * so playback survives navigation.
 */
function RootLayout() {
  const router = useRouter();
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  });
  const selectedPath = pathFromLocation(pathname);

  const [queueOpen, setQueueOpen] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Same key as the sidebar's query, so no extra request.
  const roots = useQuery({
    queryKey: ["roots"],
    queryFn: ({ signal }) => fetchRoots({ signal })
  });
  const rootName = roots.data?.libraries[0]?.roots[0]?.name ?? "Music";

  return (
    <PlayerProvider>
      <div className="bg-background flex h-dvh flex-col">
        {/* Clips the off-canvas drawer; otherwise its width extends the
            document and narrow viewports scroll sideways into nothing. */}
        <div
          ref={paneRef}
          className="relative flex min-h-0 flex-1 overflow-hidden"
        >
          {!sidebarCollapsed && (
            <Sidebar
              selectedPath={selectedPath}
              onCollapse={() => setSidebarCollapsed(true)}
            />
          )}

          <main className="bg-main flex min-w-0 flex-1 flex-col">
            <header className="border-border bg-main/95 flex h-16 shrink-0 items-center gap-2 border-b px-6 backdrop-blur-sm max-sm:px-3">
              {sidebarCollapsed && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Expand sidebar"
                  title="Expand sidebar"
                  onClick={() => setSidebarCollapsed(false)}
                >
                  <PanelLeftOpen className="size-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back"
                onClick={() => router.history.back()}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Forward"
                onClick={() => router.history.forward()}
              >
                <ChevronRight className="size-4" />
              </Button>
              <div className="ml-2 min-w-0 flex-1">
                <Breadcrumbs rootName={rootName} path={selectedPath} />
              </div>
            </header>

            <div className="scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-6 max-sm:px-3">
              <Outlet />
            </div>
          </main>

          <QueueDrawer
            open={queueOpen}
            onClose={() => setQueueOpen(false)}
            container={paneRef}
          />
        </div>

        <PlayerBar onToggleQueue={() => setQueueOpen((open) => !open)} />
      </div>
    </PlayerProvider>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <BrowsePage path="" />
});

// Splat, so /browse/Artist/Album is a real, refreshable address.
const browseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/browse/$",
  component: BrowseSplat
});

function BrowseSplat() {
  const { _splat } = browseRoute.useParams();
  return <BrowsePage path={_splat ?? ""} />;
}

const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  component: () => (
    <p className="text-muted-foreground text-sm">That page does not exist.</p>
  )
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  browseRoute,
  notFoundRoute
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
