import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests for pure/DOM helpers under src/lib. Component and end-to-end
// coverage lives in the Playwright suite (`npm run test:ui`), so this config
// deliberately stays minimal: jsdom for DOM APIs, no React plugin.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
