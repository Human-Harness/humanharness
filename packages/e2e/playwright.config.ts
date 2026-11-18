import { defineConfig } from "@playwright/test";

// One Electron app at a time: each test launches the built shell with its own folders.
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  timeout: 120_000,
  // Stops a run that hangs before the CI job cap kills it silently: Playwright then reports which specs were still running.
  globalTimeout: 20 * 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
