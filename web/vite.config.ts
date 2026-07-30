import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// In development Vite proxies /api to a locally running `rhythm`, so client
// code is identical whether it is served from Vite or from the Go binary.
const apiTarget = process.env.RHYTHM_DEV_SERVER ?? "http://127.0.0.1:4533";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true }
    }
  },
  build: {
    // Copied into the Go binary's embedded FS by `make web`.
    outDir: "dist",
    emptyOutDir: true
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"]
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src")
    }
  }
});
