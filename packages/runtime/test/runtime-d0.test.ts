import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type ClaudeScript, claudeResultLine, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { loadHarness } from "@humanharness/harness-sdk";
import type { Event } from "../src/events";
import { createRuntime } from "../src/runtime";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-d0-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../fake-agent/fixtures/notes-harness/harness.config.ts");

/** The slice of isomorphic-git this test reads the history with. */
interface GitRead {
  log(o: { fs: typeof fs; gitdir: string }): Promise<{ oid: string; commit: { message: string } }[]>;
  TREE(o: { ref: string }): unknown;
  walk(o: {
    fs: typeof fs;
    gitdir: string;
    trees: unknown[];
    map: (p: string, entries: ({ type(): Promise<string>; content(): Promise<Uint8Array | undefined> } | null)[]) => Promise<undefined>;
  }): Promise<unknown>;
}
// The runtime package doesn't depend on isomorphic-git: borrow the workspace package's copy, the one History writes with.
const gitEntry = createRequire(path.resolve(here, "../../workspace/package.json")).resolve("isomorphic-git");
const git = ((await import(pathToFileURL(gitEntry).href)) as { default: GitRead }).default;

/** Each commit, oldest first: its whole message and its tree as path → content. */
async function commits(gitdir: string): Promise<{ message: string; tree: Record<string, string> }[]> {
  const log = await git.log({ fs, gitdir });
  const out: { message: string; tree: Record<string, string> }[] = [];
  for (const e of log.reverse()) {
    const tree: Record<string, string> = {};
    await git.walk({
      fs,
      gitdir,
      trees: [git.TREE({ ref: e.oid })],
      map: async (p, [t]) => {
        if (p !== "." && t && (await t.type()) === "blob") tree[p] = Buffer.from((await t.content()) ?? []).toString("utf8");
        return undefined;
      },
    });
    out.push({ message: e.commit.message.trim(), tree });
  }
  return out;
}

describe("D0: one runtime, today's commits and prompts (parallel spec D7)", () => {
  it("ok, stopped, crashed, modifying, deleting and empty turns commit exactly as before", async () => {
    const base = fs.mkdtempSync(path.join(root, "t-"));
    const folder = path.join(base, "Work");
    const gitdir = path.join(base, "history.git");
    const prompts = path.join(base, "prompts.jsonl");
    const script: ClaudeScript = {
      steps: [...claudeTextLines("Nothing to do."), claudeResultLine(true)],
      turns: [
        { match: "^write a", steps: [{ write: { path: "a.md", content: "A" } }, ...claudeTextLines("Wrote a."), claudeResultLine(true)] },
        { match: "^slow", steps: [{ write: { path: "s.md", content: "S" } }, { sleep: 5000 }, claudeResultLine(true)] },
        { match: "^crash", steps: [{ write: { path: "b.md", content: "B" } }, { signal: "SIGKILL" }] },
        { match: "^edit a", steps: [{ write: { path: "a.md", content: "A2" } }, claudeResultLine(true)] },
        // fake-claude has no delete step: the test deletes s.md while this turn sleeps (see `during` below).
        { match: "^drop s", steps: [{ sleep: 2000 }, claudeResultLine(true)] },
      ],
    };
    const rt = await createRuntime({
      harness: await loadHarness(FIXTURE),
      engine: getEngine("claude"),
      folder,
      gitdir,
      language: "en",
      command: fakeClaudeCommand(),
      env: { HH_FAKE_SCRIPT: writeScript(base, script), HH_FAKE_PROMPTS: prompts },
    });
    const trailer = { task: "t1", action: "intro" };
    /** How many runs fake-claude has recorded (it records the prompt before running its steps). */
    const started = () => (fs.existsSync(prompts) ? fs.readFileSync(prompts, "utf8").trim().split("\n").length : 0);
    /**
     * Runs one turn; `during` acts once, mid-turn, as soon as `when` holds (polled, not on a timer: a loaded machine
     * starts fake-claude late).
     */
    const run = async (m: string, during?: { when: () => boolean; act: (turn: { cancel(): void }) => void }) => {
      const events: Event[] = [];
      const turn = rt.send(m, (e) => events.push(e), { trailer });
      let poll: NodeJS.Timeout | undefined;
      if (during) {
        poll = setInterval(() => {
          if (!during.when()) return;
          clearInterval(poll);
          during.act(turn);
        }, 20);
      }
      await turn.done;
      clearInterval(poll);
      return events.at(-1);
    };
    const inFolder = (f: string) => path.join(folder, f);
    expect(await run("write a")).toEqual({ type: "done", ok: true });
    expect(await run("slow", { when: () => fs.existsSync(inFolder("s.md")), act: (t) => t.cancel() })).toMatchObject({ type: "done", ok: false, error: { code: "cancelled" } });
    // The person's own edit between turns: the next turn snapshots it first.
    fs.writeFileSync(path.join(folder, "mine.md"), "M");
    expect(await run("crash")).toMatchObject({ type: "done", ok: false, error: { code: "agent-crashed" } });
    // A turn that modifies a tracked file, then one during which a tracked file is deleted.
    expect(await run("edit a")).toEqual({ type: "done", ok: true });
    expect(await run("drop s", { when: () => started() === 5, act: () => fs.unlinkSync(inFolder("s.md")) })).toEqual({ type: "done", ok: true });
    // The person modifies a tracked file; the last turn snapshots it first and, changing nothing itself, adds no Turn commit.
    fs.writeFileSync(inFolder("a.md"), "A3");
    expect(await run("nothing")).toEqual({ type: "done", ok: true });
    await rt.close();
    const T = "\n\nTask: t1\nAction: intro";
    const README = "This folder is used by the Human Harness test harness.\n";
    // Pinned from a run of today's code (864c498, before part 1 changed the runtime). The crashed turn (its write is
    // undone, so the tree equals the snapshot it started from) and a turn with no change commit nothing; the person's
    // edits land in a "Before message" commit of the next turn.
    expect(await commits(gitdir)).toEqual([
      { message: "Start", tree: { "README.md": README } },
      { message: `Turn: write a${T}`, tree: { "README.md": README, "a.md": "A" } },
      { message: `Stopped: slow${T}`, tree: { "README.md": README, "a.md": "A", "s.md": "S" } },
      { message: `Before message${T}`, tree: { "README.md": README, "a.md": "A", "mine.md": "M", "s.md": "S" } },
      { message: `Turn: edit a${T}`, tree: { "README.md": README, "a.md": "A2", "mine.md": "M", "s.md": "S" } },
      { message: `Turn: drop s${T}`, tree: { "README.md": README, "a.md": "A2", "mine.md": "M" } },
      { message: `Before message${T}`, tree: { "README.md": README, "a.md": "A3", "mine.md": "M" } },
    ]);
    expect(fs.existsSync(path.join(folder, "b.md"))).toBe(false);
    expect(fs.readFileSync(path.join(folder, "mine.md"), "utf8")).toBe("M");
    expect(fs.readFileSync(path.join(folder, "a.md"), "utf8")).toBe("A3");
    expect(fs.existsSync(path.join(folder, "s.md"))).toBe(false);
    const sent = fs
      .readFileSync(prompts, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { argv: string[]; prompt: string });
    expect(sent.map((s) => s.prompt)).toEqual(["write a", "slow", "crash", "edit a", "drop s", "nothing"]);
    // Each run's argv with the machine-specific MCP config reduced to its servers and their env names.
    const shape = (argv: string[]) =>
      argv.map((a, i) => {
        if (argv[i - 1] !== "--mcp-config") return a;
        const { mcpServers } = JSON.parse(a) as { mcpServers: Record<string, { type: string; env: Record<string, string> }> };
        return Object.entries(mcpServers).map(([name, spec]) => `${name}:${spec.type}:${Object.keys(spec.env).join(",")}`);
      });
    const session = sent[0].argv[sent[0].argv.indexOf("--session-id") + 1];
    const flags = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--setting-sources",
      "project",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      "Read,Glob,Grep,TodoWrite,Edit(./**),Write(./**),MultiEdit(./**),mcp__ui",
      "--disallowedTools",
      "AskUserQuestion,Bash,WebSearch,WebFetch,Edit(.claude/**),Write(.claude/**),MultiEdit(.claude/**)",
      "--strict-mcp-config",
      "--mcp-config",
      ["ui:stdio:HH_HARNESS,HH_BRIDGE,HH_BRIDGE_TOKEN"],
    ];
    expect(sent.map((s) => shape(s.argv))).toEqual([
      [...flags, "--session-id", session],
      [...flags, "--resume", session],
      [...flags, "--resume", session],
      [...flags, "--resume", session],
      [...flags, "--resume", session],
      [...flags, "--resume", session],
    ]);
  });
});
