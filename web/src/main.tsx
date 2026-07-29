import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./routes/router";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The filesystem changes underneath us and nothing tells us when, so
      // keep the window short.
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});

const container = document.getElementById("root");
if (!container) {
  throw new Error("index.html is missing #root");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
