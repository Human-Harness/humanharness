// Test fixture for the user layer (minimal-core 0b2): the smallest harness, whose layout puts the user mod "hello"'s
// block in the root stack's header. It declares no mod: "hello" comes from the app's home folder.
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "usermod",
  name: "User Mod",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness User Mod" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  author: "Human Harness tests",
});
