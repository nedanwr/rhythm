import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider
} from "@tanstack/react-router";
import { render, waitFor } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { PlayerProvider } from "~/features/player/PlayerProvider";
import type { RhythmEngine } from "~/engine/types";
import { FakeEngine } from "~/engine/testing/fakeEngine";
import { routeTree } from "~/routes/router";

/** Waits for router idle; portal-only renders may leave the container empty. */
async function settle(router: { state: { status: string } }): Promise<void> {
  await waitFor(() => {
    if (router.state.status !== "idle") {
      throw new Error(`router is ${router.state.status}, not idle`);
    }
  });
}

/** Optional engine override for component renders. */
export interface EngineOption {
  engine?: RhythmEngine;
}

/**
 * Mounts the real route tree — shell, sidebar, player bar and routing.
 * Use `renderWithProviders` instead for a single component.
 */
export async function renderApp(options?: {
  initialPath?: string;
}): Promise<RenderResult & { queryClient: QueryClient }> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } }
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [options?.initialPath ?? "/"]
    })
  });
  await router.load();

  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  );
  await settle(router);
  return { ...result, queryClient };
}

/**
 * Renders inside the providers a component really runs under: a router (so
 * <Link> works), Query, and the player context. Retries are off so an error
 * assertion does not wait on a backoff.
 */
export async function renderWithProviders(
  ui: ReactNode,
  options?: { initialPath?: string } & EngineOption
): Promise<RenderResult & { queryClient: QueryClient; engine: RhythmEngine }> {
  const engine = options?.engine ?? new FakeEngine();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } }
  });

  const rootRoute = createRootRoute({
    component: () => (
      <PlayerProvider engine={engine}>
        <Outlet />
      </PlayerProvider>
    )
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <>{ui}</>
  });
  // Mirrors the app's splat route so <Link to="/browse/$"> resolves here too.
  const browseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/browse/$",
    component: () => <>{ui}</>
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, browseRoute]),
    history: createMemoryHistory({
      initialEntries: [options?.initialPath ?? "/"]
    })
  });

  // The router resolves its first match asynchronously; without this we would
  // assert against an empty container.
  await router.load();

  const result = render(
    <QueryClientProvider client={queryClient}>
      {/* The app registers its router type globally; this is another instance
          of the same shape. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  );
  await settle(router);
  return { ...result, queryClient, engine };
}
