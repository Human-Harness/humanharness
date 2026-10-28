import { describe, expect, it } from "vitest";
import { claudeArgs } from "../src/claude-cli";

const permissions = { edit: "folder" as const, exec: false, web: false };
const uiServer = { name: "ui", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } };

describe("D0 (hatches): no linked folders, no change", () => {
  it("claudeArgs without a scope, or with an empty one, is the golden argv", () => {
    const o = { session: { id: "abc", started: false }, mcp: [uiServer], permissions, references: ["/r"] };
    const golden = claudeArgs(o);
    expect(claudeArgs({ ...o, scope: undefined })).toEqual(golden);
    expect(claudeArgs({ ...o, scope: { linked: [] } })).toEqual(golden);
    expect(claudeArgs({ ...o, references: [], scope: { linked: [] } })).not.toContain("--settings");
  });
});
