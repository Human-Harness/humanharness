import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The root config only includes package folders: the repo scripts are tested here (`pnpm test` runs both).
export default defineConfig({
  test: { root: fileURLToPath(new URL("..", import.meta.url)), include: ["scripts/*.test.ts"] },
});
