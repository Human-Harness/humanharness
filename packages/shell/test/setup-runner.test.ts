import { describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import type { SetupOutput } from "@humanharness/ui/client";
import { type RunningSetup, runSetupProcess, setupCommand, stopSetupProcess } from "../src/main/setup-runner";

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

  it("drops output printed after it was cancelled", async () => {
    const out: SetupOutput[] = [];
    const running = runSetupProcess(
      node(`process.on("SIGTERM",()=>{console.log("late https://example.com/late");process.exit(0)});console.log("ready");setInterval(()=>{},1000)`),
      (o) => {
        out.push(o);
        if (o.kind === "line" && o.text === "ready") running.cancel();
      },
    );
    expect(await running.exit).toBeNull();
    expect(out).toEqual([{ kind: "line", text: "ready" }]);
  });

  it("reports a program that can't start", async () => {
    const { lines, code } = await collect({ command: ["/nonexistent/hh-cli"], env: {} });
    expect(code).toBeNull();
    expect(lines.length).toBeGreaterThan(0);
  });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitFor = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  return check();
};
// A process that starts a grandchild sharing its output pipes, prints the grandchild's pid, then runs `after`.
const withGrandchild = (after: string) =>
  node(
    `const {spawn}=require("node:child_process");` +
      `const g=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});` +
      `console.log("grandchild:"+g.pid);${after}`,
  );

describe("runSetupProcess process tree", () => {
  it("cancel stops the grandchildren too", async () => {
    let pid = 0;
    const running = runSetupProcess(withGrandchild("setInterval(()=>{},1000)"), (o) => {
      if (o.kind === "line" && o.text.startsWith("grandchild:")) {
        pid = Number(o.text.slice(11));
        running.cancel();
      }
    });
    expect(await running.exit).toBeNull();
    expect(pid).toBeGreaterThan(0);
    expect(await waitFor(() => !alive(pid))).toBe(true);
  });

  it("ends when the process exits, even if a grandchild still holds its output", async () => {
    let pid = 0;
    const running = runSetupProcess(withGrandchild("setTimeout(()=>process.exit(0),100)"), (o) => {
      if (o.kind === "line" && o.text.startsWith("grandchild:")) pid = Number(o.text.slice(11));
    });
    expect(await running.exit).toBe(0);
    if (pid && alive(pid)) process.kill(pid, "SIGKILL");
  });

  it("escalates to SIGKILL when the process ignores SIGTERM", async () => {
    const running = runSetupProcess(node(`process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000)`), (o) => {
      if (o.kind === "line" && o.text === "ready") running.cancel();
    });
    expect(await running.exit).toBeNull();
  }, 8000);

  it("stopSetupProcess waits a short grace period, then kills the whole group", async () => {
    let pid = 0;
    let ready!: () => void;
    const started = new Promise<void>((r) => (ready = r));
    const running = runSetupProcess(withGrandchild(`process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000)`), (o) => {
      if (o.kind === "line" && o.text.startsWith("grandchild:")) pid = Number(o.text.slice(11));
      if (o.kind === "line" && o.text === "ready") ready();
    });
    await started;
    const t0 = Date.now();
    await stopSetupProcess(running, 200);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(await running.exit).toBeNull();
    expect(await waitFor(() => !alive(pid))).toBe(true);
  });

  it("gives up after the timeout", async () => {
    const running = runSetupProcess(node("setInterval(()=>{},1000)"), () => {}, { timeoutMs: 200 });
    expect(await running.exit).toBeNull();
  });
});

describe("runSetupProcess web addresses", () => {
  it("drops punctuation that ends the sentence", async () => {
    const { out } = await collect(node(`console.log("Visit (https://claude.ai/oauth/x?a=1).")`));
    expect(out.filter((o) => o.kind === "url")).toEqual([{ kind: "url", url: "https://claude.ai/oauth/x?a=1" }]);
  });

  it("strips terminal hyperlinks ended by ESC \\ and takes their target", async () => {
    const e = "\\u001b";
    const { out } = await collect(
      node(`console.log("Open ${e}]8;;https://claude.ai/oauth/y${e}\\\\sign-in page${e}]8;;${e}\\\\ now")`),
    );
    expect(out).toEqual([
      { kind: "line", text: "Open sign-in page now" },
      { kind: "url", url: "https://claude.ai/oauth/y" },
    ]);
  });
});
