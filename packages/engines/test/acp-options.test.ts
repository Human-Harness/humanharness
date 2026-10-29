import { describe, expect, it } from "vitest";
import { OPENCODE_ENV, getEngine } from "../src";
import { acpFields } from "../src/acp/options";

describe("acpFields", () => {
  it("gives OpenCode its modes and the config-option profile", () => {
    const engineEnv = { ...OPENCODE_ENV };
    expect(acpFields(getEngine("opencode"), "folder")).toEqual({ sessionMode: "build", minAdapterVersion: undefined, profileMethod: "config-option", engineEnv });
    expect(acpFields(getEngine("opencode"), "none")).toEqual({ sessionMode: "plan", minAdapterVersion: undefined, profileMethod: "config-option", engineEnv });
  });

  it("gives Codex and Claude no engine environment (D0)", () => {
    for (const id of ["codex", "claude"]) for (const edit of ["folder", "none"] as const) expect(acpFields(getEngine(id), edit)).not.toHaveProperty("engineEnv");
  });

  it("gives Codex what it had, and Claude nothing (D0)", () => {
    expect(acpFields(getEngine("codex"), "folder")).toEqual({ sessionMode: "workspace-write", minAdapterVersion: "2.2.2", profileMethod: undefined });
    expect(acpFields(getEngine("codex"), "none")).toEqual({ sessionMode: "read-only", minAdapterVersion: "2.2.2", profileMethod: undefined });
    expect(acpFields(getEngine("claude"), "folder")).toEqual({ sessionMode: undefined, minAdapterVersion: undefined, profileMethod: undefined });
    expect(acpFields(getEngine("claude"), "none")).toEqual({ sessionMode: undefined, minAdapterVersion: undefined, profileMethod: undefined });
  });
});
