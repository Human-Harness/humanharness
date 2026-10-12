import { defineConfig } from "@playwright/test";

// Manual run against the real engines, never part of CI (see README): HH_REAL_OUT=<folder> corepack pnpm --filter @humanharness/e2e real
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 900_000,
  expect: { timeout: 300_000 },
  workers: 1,
  reporter: "list",
});
