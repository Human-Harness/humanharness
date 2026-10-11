import { describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type CommandDeps, cliCommand, engineCommand, loginShellPath, resolveBinary } from "../src/main/engine-command";

function deps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return {
    shell: "/bin/zsh",
    home: "/Users/me",
    run: async () => ({ stdout: "", code: 1 }),
    isExecutable: async () => false,
    electronPath: "/App/Electron",
    resolveModule: (id) => `/app/node_modules/${id}`,
    ...overrides,
  };
}

describe("loginShellPath", () => {
  it("asks the login shell for PATH", async () => {
    const d = deps({
      run: async (cmd, args) => {
        expect([cmd, ...args]).toEqual(["/bin/zsh", "-ilc", 'printf "%s" "$PATH"']);
        return { stdout: "/opt/homebrew/bin:/Users/me/.local/bin:/usr/bin", code: 0 };
      },
    });
    expect(await loginShellPath(d)).toBe("/opt/homebrew/bin:/Users/me/.local/bin:/usr/bin");
  });

  it("falls back to common locations when the shell fails", async () => {
    expect(await loginShellPath(deps())).toBe("/Users/me/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
  });
});

describe("resolveBinary", () => {
  it("returns the first executable match on PATH", async () => {
    const d = deps({ isExecutable: async (p) => p === "/Users/me/.local/bin/claude" });
    expect(await resolveBinary("claude", "/opt/homebrew/bin:/Users/me/.local/bin", d)).toBe("/Users/me/.local/bin/claude");
  });

  it("returns null when not found", async () => {
    expect(await resolveBinary("claude", "/usr/bin", deps())).toBeNull();
  });
});

describe("engineCommand", () => {
  it("runs Claude by absolute path with the login PATH", async () => {
    const d = deps({
      run: async () => ({ stdout: "/Users/me/.local/bin:/usr/bin", code: 0 }),
      isExecutable: async (p) => p === "/Users/me/.local/bin/claude",
    });
    expect(await engineCommand(getEngine("claude"), d)).toEqual({
      command: ["/Users/me/.local/bin/claude"],
      env: { PATH: "/Users/me/.local/bin:/usr/bin" },
    });
  });

  it("runs the bundled Codex adapter with Electron's Node", async () => {
    const d = deps({ run: async () => ({ stdout: "/usr/bin", code: 0 }) });
    expect(await engineCommand(getEngine("codex"), d)).toEqual({
      command: ["/App/Electron", "/app/node_modules/@agentclientprotocol/codex-acp/dist/index.js"],
      env: { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1" },
    });
  });

  it("reports a missing Claude as null so the runtime says engine-not-installed", async () => {
    expect(await engineCommand(getEngine("claude"), deps())).toBeNull();
  });
});

describe("resolveBinary fallbacks", () => {
  it("also looks in the folders official installers use, which a login PATH may miss", async () => {
    const d = deps({ isExecutable: async (p) => p === "/Users/me/.local/bin/claude" });
    expect(await resolveBinary("claude", "/usr/bin", d)).toBe("/Users/me/.local/bin/claude");
  });
});

describe("cliCommand", () => {
  it("runs the Codex CLI bundled with the adapter, under Electron's Node", async () => {
    const d = deps({
      resolveModule: (id, from) =>
        from ? `${from}>${id}` : `/app/node_modules/${id}`,
    });
    expect(await cliCommand(getEngine("codex"), d)).toEqual({
      command: ["/App/Electron", "/app/node_modules/@agentclientprotocol/codex-acp/dist/index.js>@openai/codex/bin/codex.js"],
      env: { PATH: "/Users/me/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", ELECTRON_RUN_AS_NODE: "1" },
      bundled: true,
    });
  });

  it("falls back to an installed codex when the bundle can't be found", async () => {
    const d = deps({
      resolveModule: () => {
        throw new Error("not found");
      },
      isExecutable: async (p) => p === "/opt/homebrew/bin/codex",
    });
    expect(await cliCommand(getEngine("codex"), d)).toMatchObject({ command: ["/opt/homebrew/bin/codex"], bundled: false });
  });

  it("finds Claude by absolute path, or returns null", async () => {
    const found = deps({ isExecutable: async (p) => p === "/Users/me/.local/bin/claude" });
    expect(await cliCommand(getEngine("claude"), found)).toMatchObject({ command: ["/Users/me/.local/bin/claude"], bundled: false });
    expect(await cliCommand(getEngine("claude"), deps())).toBeNull();
  });
});
