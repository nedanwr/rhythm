import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet
} from "@tanstack/react-router";
import { PlayerBar } from "../components/PlayerBar";
import { PlayerProvider } from "../player/PlayerProvider";
import { BrowsePage } from "./BrowsePage";

/**
 * Routes are defined in code rather than by file convention. There is barely
 * one route so far, but having the router in place keeps deep links and the
 * server's SPA fallback honest.
 */
function RootLayout() {
  return (
    <PlayerProvider>
      <div className="app">
        <header className="app__header">
          <h1 className="app__title">Rhythm</h1>
        </header>
        <Outlet />
        <PlayerBar />
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

// A splat route keeps the URL shaped like the library, so /browse/Artist/Album
// is a real, refreshable address.
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
    <main className="pane">
      <p className="status">That page does not exist.</p>
    </main>
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
