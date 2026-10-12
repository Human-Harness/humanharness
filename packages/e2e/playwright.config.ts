import { defineConfig } from "@playwright/test";

// One Electron app at a time: each test launches the built shell with its own folders.
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
