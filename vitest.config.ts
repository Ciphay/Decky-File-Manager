import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const mock = (file: string) => fileURLToPath(new URL(`./tests/frontend/mocks/${file}`, import.meta.url));

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@decky/api": mock("decky-api.ts"),
      "@decky/ui": mock("decky-ui.tsx"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/frontend/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/frontend/setup.ts"],
    restoreMocks: false,
  },
});
