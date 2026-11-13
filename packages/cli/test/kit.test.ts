import fs from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../src/cli";
import { appShot, appStatus, checkMod, cloneLayout, cloneMod } from "../src/kit";
import { tempRoot } from "./helpers";

let root: string;
let cleanup: () => void;
let home: string;
let server: Server | undefined;

beforeEach(() => {
  ({ root, cleanup } = tempRoot("hh-kit-"));
  home = path.join(root, "app");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, ".layers.json"), "{}\n");
});
afterEach(async () => {
  if (server) await new Promise((r) => server?.close(r));
  server = undefined;
  cleanup();
});

function write(dir: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
}
const json = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;

describe("checkMod", { timeout: 120_000 }, () => {
  it("returns each check by name, ok and detail", async () => {
    write(path.join(home, "mods", "hello"), {
      "mod.json": json({ id: "hello", name: "Hello", version: "0.1.0", apiVersion: 1, main: "main.ts" }),
      "main.ts": `import { defineMod } from "@humanharness/mod-sdk";\nexport default defineMod({ id: "hello", main(ctx) { ctx.ipc("ping", () => "pong"); } });\n`,
    });
    const r = await checkMod(home, "mods/hello");
    expect(r).toEqual({
      ok: true,
      checks: [
        { name: "mod.json", ok: true },
        { name: "main", ok: true, detail: "bundled" },
        { name: "main", ok: true, detail: "ran (ipc ping)" },
      ],
    });
  });

  it("fails a folder without mod.json", async () => {
    const r = await checkMod(home, "nowhere");
    expect(r.ok).toBe(false);
    expect(r.checks).toHaveLength(1);
    expect(r.checks[0]).toMatchObject({ name: "mod.json", ok: false });
  });
});

describe("cloneMod and cloneLayout", () => {
  beforeEach(() => {
    write(path.join(home, "core", "mods", "home"), {
      "mod.json": json({ id: "home", name: "Home", version: "0.1.0", apiVersion: 1, ui: "ui.js" }),
      "src/ui.tsx": `import { defineMod } from "@humanharness/mod-sdk";\nexport default defineMod({ id: "home", ui(ctx) {} });\n`,
    });
    write(home, { "core/layouts/main.json": json({ from: "core" }) });
  });

  it("clones a mod and returns its id, path and origin", async () => {
    expect(await cloneMod(home, "home", "my-home")).toEqual({ id: "my-home", path: path.join(home, "mods", "my-home"), clonedFrom: { id: "home", version: "0.1.0" }, source: path.join("core", "mods", "home") });
    expect(await cloneMod(home, "home")).toMatchObject({ id: "home", path: path.join(home, "mods", "home") });
    await expect(cloneMod(home, "nope")).rejects.toThrow(new CliError("No mod nope in core/mods or harness/mods"));
  });

  it("clones a layout and returns its name and path", async () => {
    expect(await cloneLayout(home, "main", "mine")).toEqual({ name: "mine", path: path.join(home, "layouts", "mine.json"), source: path.join("core", "layouts", "main.json") });
    await expect(cloneLayout(home, "main", "mine")).rejects.toThrow("already exists");
  });
});

describe("appStatus and appShot", () => {
  const TOKEN = "t".repeat(64);
  const STATUS = { mods: [], problems: [], layout: { name: "main", source: "core", problems: [] } };

  async function fakeApp() {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += String(c)));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url === "/status") res.end(JSON.stringify(STATUS));
        else res.end(JSON.stringify({ path: (JSON.parse(body || "{}") as { path?: string }).path ?? "/default.png" }));
      });
    });
    await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    fs.writeFileSync(path.join(home, ".control.json"), JSON.stringify({ port, token: TOKEN, pid: process.pid }));
  }

  it("returns the running app's status and shot path", async () => {
    await fakeApp();
    expect(await appStatus(home)).toEqual(STATUS);
    expect(await appShot(home)).toEqual({ path: "/default.png" });
    expect(await appShot(home, "out/a.png")).toEqual({ path: path.join(home, "out", "a.png") });
  });

  it("throws that the app isn't running", async () => {
    await expect(appStatus(home)).rejects.toThrow(new CliError("The app isn't running"));
    await expect(appShot(home)).rejects.toThrow(CliError);
  });
});
