import { describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import type { SetupOutput } from "@humanharness/ui/client";
import { type RunningSetup, runSetupProcess, setupCommand } from "../src/main/setup-runner";

const node = (script: string) => ({ command: [process.execPath, "-e", script], env: {} });

async function collect(cmd: { command: string[]; env: Record<string, string> }, act?: (r: RunningSetup) => void) {
  const out: SetupOutput[] = [];
  const running = runSetupProcess(cmd, (o) => out.push(o));
  act?.(running);
  const code = await running.exit;
  return { out, code, lines: out.filter((o) => o.kind === "line").map((o) => (o as { text: string }).text) };
}

describe("setupCommand", () => {
  const cli = { command: ["/Users/me/.local/bin/claude"], env: { PATH: "/usr/bin" }, bundled: false };

  it("installs with the official command through bash and the login PATH", () => {
    expect(setupCommand(getEngine("claude"), "install", null, "/usr/bin:/bin")).toEqual({
      command: ["/bin/bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"],
      env: { PATH: "/usr/bin:/bin" },
    });
  });

  it("signs in, updates and signs out through the CLI itself", () => {
    expect(setupCommand(getEngine("claude"), "login", cli, "/usr/bin")).toEqual({ command: ["/Users/me/.local/bin/claude", "auth", "login"], env: { PATH: "/usr/bin" } });
    expect(setupCommand(getEngine("claude"), "update", cli, "/usr/bin")?.command).toEqual(["/Users/me/.local/bin/claude", "update"]);
    expect(setupCommand(getEngine("claude"), "logout", cli, "/usr/bin")?.command).toEqual(["/Users/me/.local/bin/claude", "auth", "logout"]);
    expect(setupCommand(getEngine("codex"), "login", { ...cli, command: ["/App/Electron", "/app/codex.js"] }, "/usr/bin")?.command).toEqual([
      "/App/Electron",
      "/app/codex.js",
      "login",
    ]);
  });

  it("has nothing to run when the engine has no such step or no CLI", () => {
    expect(setupCommand(getEngine("codex"), "update", cli, "/usr/bin")).toBeNull();
    expect(setupCommand(getEngine("kimi"), "install", null, "/usr/bin")).toBeNull();
    expect(setupCommand(getEngine("claude"), "login", null, "/usr/bin")).toBeNull();
  });
});

describe("runSetupProcess", () => {
  it("streams stdout and stderr lines without terminal colours, and the exit code", async () => {
    const { lines, code } = await collect(node(`const e=String.fromCharCode(27);console.log(e+"[32mhello"+e+"[0m");console.error("warn");process.exit(3)`));
    expect(lines.sort()).toEqual(["hello", "warn"]);
    expect(code).toBe(3);
  });

  it("reports the first web address once", async () => {
    const { out } = await collect(node(`console.log("Open https://claude.ai/oauth/authorize?code=1 to sign in");console.log("or https://example.com/x")`));
    expect(out.filter((o) => o.kind === "url")).toEqual([{ kind: "url", url: "https://claude.ai/oauth/authorize?code=1" }]);
  });

  it("passes a typed line to the process", async () => {
    const { lines, code } = await collect(node(`process.stdin.once("data",(d)=>{console.log("got:"+String(d).trim());process.exit(0)})`), (r) => r.write("abc"));
    expect(lines).toContain("got:abc");
    expect(code).toBe(0);
  });

  it("can be cancelled", async () => {
    const { code } = await collect(node("setInterval(()=>{},1000)"), (r) => setTimeout(() => r.cancel(), 100));
    expect(code).toBeNull();
  });

  it("reports a program that can't start", async () => {
    const { lines, code } = await collect({ command: ["/nonexistent/hh-cli"], env: {} });
    expect(code).toBeNull();
    expect(lines.length).toBeGreaterThan(0);
  });
});
