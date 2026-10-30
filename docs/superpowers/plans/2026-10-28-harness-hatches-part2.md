# Harness hatches, part 2 (H2: the harness backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship delivery slice 4 of the harness hatches spec (§9): a harness may declare `backend: "backend/index.ts"`. Main launches it once per app start, after setup, as a child process on the same launcher as the harness's MCP servers. The harness UI talks to it with `client.backend.call(method, params)` (JSON-RPC 2.0 over stdio, 30 s timeout) and hears its notifications with `client.backend.on(event, cb)` (at most 200 per second). It restarts after a crash (3 times in 5 minutes), stops on quit and around a folder move or profile switch, and logs to `backend.log`. The demo harness gets an echo backend. Native modules (`node-pty`, the build check) wait for plan 4b. A harness without `backend` is byte for byte today's app.

**Architecture.**

*Manifest and protocol types.* `packages/harness-sdk/src/hatches.ts` (part 1) gains `backend` (a path in the harness folder, checked with `resolveInHarness` by `loadHarness`). `packages/harness-sdk/src/harness-backend.ts` holds the protocol's types and limits, type-only for backend authors (`BackendInit`, `BackendScope`), plus the constants main enforces.

*Main.* `packages/shell/src/main/backend/`:
- **`backend-protocol.ts`** (pure): newline-delimited JSON-RPC framing (`LineReader`, 1 MB per line), `classifyIncoming` (a response to one of our calls, a notification = an event, or anything else, refused), name checks, `EventLimiter` (200 per rolling second, drops counted and logged once per second).
- **`backend-log.ts`**: `backend.log` in the app's data folder, rotated at 5 MB to `backend.log.1`; never throws.
- **`backend-process.ts`**: one child process. Spawns `launcher.command [...launcher.args, entry]` with `cwd` = the harness folder and the app's environment plus `launcher.env`; sends `init`; `call(method, params)` with a 30 s timeout; events through the limiter; `stop()` = SIGTERM, then SIGKILL after 3 s; `exited` promise.
- **`backend-supervisor.ts`**: the lifecycle. States `stopped | starting | running | failed`. Restarts after an unexpected exit, at most 3 times in any 5 minutes, then `failed`. `restart()` (the person's "Restart") clears the count. `rebase(init)` (folder moved, profile switched) stops and starts with the new `init`. `scopesChanged(scopes)` notifies a running backend. `stop()` for quit and for a move's start.

*Window.* `client.backend` (`call`, `on`, `state`, `onState`, `restart`) through `hh:backendCall`, `hh:backendState`, `hh:backendRestart` and the pushes `hh:backendEvent`, `hh:backendStateChange`, registered only with `backend` (D0). A failed backend shows a card with "Restart" (`BackendCard`, mounted by `HarnessApp` only with `state.hatches.backend`).

*What it can't do (spec §4.2).* The backend can only answer our calls and send notifications. A request from it (anything with an `id` and a `method`) is answered with JSON-RPC error `-32601` "The app takes no requests from a backend" and logged. There is no channel to the history, notes, data, sessions or engines: those go through the harness UI and `client`. Its writes in the folder show as "Outside the app" like any outside change.

**Tech Stack:** TypeScript, Node `child_process` (Electron's Node via `ELECTRON_RUN_AS_NODE=1`, Node 24, ABI 149), JSON-RPC 2.0, React 19, Vitest, Playwright (mock mode).

**Spec:** `docs/superpowers/specs/2026-10-27-harness-hatches-design.md` §4 (4.1–4.3, 4.5), §6 S3, §7 H2 tests, §9 slice 4. §4.4 (native modules, `node-pty`, the build check, `--rebuild`, signing) is slice 6 and waits for plan 4b's packaging: **not in this plan**. **Base:** part 1's end on `feat/harness-hatches` (which includes origin/master b9529a5, merged into `feat/parallel-tasks` before part 1). **Branch:** `feat/harness-hatches` (continues).

---

## Conventions

As in part 1 (worktree, commands, install nothing, git rules, trailer, en.json only in the `"hatches"` block, hot files additive). Trailer:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv
```

Tests that spawn a backend use small `.mjs` fixtures under `packages/shell/test/fixtures/backends/` run with `{ command: process.execPath, args: [], env: {} }` as the launcher: no tsx, no Electron.

## D0 is a hard rule

A harness without `backend` runs no part-2 code:
- `defineHarness` output has no `backend` key;
- no process is spawned, no `backend.log` or `backend-data/` is created;
- no `hh:backend*` channel is registered and nothing is pushed on them;
- `AppState.hatches` is absent (or, with only part 1's hatches, has no `backend` key);
- no backend card, `client.backend` calls reject ("This harness has no backend");
- quit, folder move, profile switch and engine switch run exactly today's steps.

| D0 item | Pinned by |
|---|---|
| Manifest | `packages/harness-sdk/test/hatches.test.ts` "D0: no backend key without one" (Task 1) |
| No spawn, no files | `packages/shell/test/backend/backend-wiring.test.ts` "D0: a harness without backend never constructs a supervisor" (Task 6) |
| IPC | `packages/shell/test/hatches-surface.test.ts` "backend channels are registered only under hasBackend" (Task 6) |
| State | `hatchesState(plain)` stays undefined; with `linkedFolders` only, no `backend` key (Task 6) |
| UI | `packages/ui/test/backend-ui.test.tsx` "D0: no card and no listener without state.hatches.backend" (Task 7) |
| E2E | `packages/e2e/tests/history.spec.ts` (demo commits) unchanged after the demo gains a backend (Task 8) |

## Threat model (part 2)

The backend is the harness's own code, at the trust level of its MCP servers (spec §4.1). The boundaries protect the app and the person from a buggy or noisy backend, and keep the window → backend path narrow.

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| B1 | Process isolation | a separate child process, never `require`/`import` in main; `cwd` = harness folder; stdin/stdout are the protocol, stderr only to the log; `detached` on POSIX so stop kills its group | `backend-process.test.ts` "runs in its own process with the harness folder as cwd" (Task 4) |
| B2 | IPC boundary, window → backend | `hh:backendCall` goes through `handle()` (app page only, plugin frames refused, plugins B5); `method` matches `^[a-zA-Z][a-zA-Z0-9_.:-]{0,99}$`; `params` must survive `JSON.stringify` and be ≤ 1 MB; at most 64 calls in flight, then refused | `backend-ipc.test.ts` (Task 6) |
| B3 | IPC boundary, backend → app | only responses to our own ids and notifications; any request is answered `-32601` and logged; a response to an unknown id is dropped; a line over 1 MB or not JSON is dropped and logged; event names match `^[a-zA-Z][a-zA-Z0-9_.:-]{0,99}$`, payloads ≤ 64 KB | `backend-protocol.test.ts` (Task 2) |
| B4 | No core writes from the backend | no channel exists: the protocol has no method the app answers; `client.backend` has exactly `call`, `on`, `state`, `onState`, `restart` | `backend-protocol.test.ts` "refusal of history writes" + `backend-ui.test.tsx` key list (Tasks 2, 7) |
| B5 | A noisy backend can't freeze the window | `EventLimiter` 200 events per second, the rest dropped (count logged once per second); log rotated at 5 MB | `backend-protocol.test.ts`, `backend-log.test.ts` (Tasks 2, 3) |
| B6 | A crashing backend can't loop | 3 restarts in 5 minutes, then `failed` until the person's Restart | `backend-supervisor.test.ts` (Task 5) |
| B7 | No secrets reach it from the app | its env is `process.env` (the app's, as MCP servers get) plus `launcher.env`; `init` carries no credential, only folder, scopes, language, core version, data dir, mock; the app sets no engine auth variable (spec §4.5) | `backend-process.test.ts` "init has exactly these keys" (Task 4) |
| B8 | Quit never hangs | stop = SIGTERM, SIGKILL after 3 s; quit waits for the stop before the runtime closes | `backend-process.test.ts` "a backend that ignores SIGTERM is killed after 3 s" (Task 4) |
| B9 | The backend never reads `~/.claude` or `~/.codex` for the app | the app passes no engine path; `init.dataDir` is the app's `backend-data/` | source scan in `backend-wiring.test.ts` (Task 6) |

## Decisions this plan takes where the spec leaves room

1. **`client.backend.state`** is a method (`state(): Promise<BackendState>`) plus `onState(cb)`, not a property: values cross `contextBridge` by copy, so a live property can't be exposed. `BackendState = "starting" | "running" | "failed" | "stopped"`.
2. **The backend entry** may be `.ts`, `.mts`, `.js` or `.mjs`. In the app it runs on Electron's Node 24, which strips erasable TypeScript syntax itself; in development the dev launcher (tsx) runs it. A `.ts` backend may use only erasable syntax (no `enum`, no `namespace`, no parameter properties); `harness-backend.ts` says so. It can't import TypeScript from `node_modules` (Node refuses to strip types there), so the SDK file is types only, erased at load.
3. **`dataDir`** = `<userData>/backend-data/` (one per app; with profiles, `<userData>/backend-data/<profile>`, created on start).
4. **`init.folder`** is the base (the active profile's folder with profiles); `scopes` are the base's active (unarchived) scopes with their links (part 1's `linked`, or `[]`). A profile switch is a `rebase`.
5. **Start** = the first time the app is configured (folder set, setup done) in this process, after `jobsReady` (parallel part 3's "start" moment). It does not wait for an engine: the backend works without one.
6. **Harness update**: the app has no in-app harness update yet. `BackendSupervisor.stop()`/`start()` are the hooks; plan 4b's update path calls them (Open question 1). In development (`humanharness dev`), a rebuild of the harness restarts the app, which restarts the backend.
7. **Engine switch** keeps it running (spec §4.3): nothing in `dropRuntime` touches it.
8. **`call` errors** reach the window as a rejected promise whose message is the backend's JSON-RPC `error.message` (cut to 500 characters), or "The backend didn't answer in time" (timeout), or "The backend isn't running" (state not `running`).
9. **The card** says "The harness's helper stopped working." with "Restart"; while `starting` after a crash, nothing shows. `failed` also writes one line to the main log.
10. **Mock mode** (spec §4.3): the backend runs as usual with `init.mock: true`.
11. **Rate limit window**: a rolling one-second window counted per event; drops reported to the log once per second as "Dropped N backend events".

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/harness-sdk/src/hatches.ts` | Modify | `backend` key, `hasBackend`, `hatchProblems` check |
| `packages/harness-sdk/src/harness-backend.ts` | Create | protocol types and limits |
| `packages/harness-sdk/src/index.ts` | Modify | `backend` in the schema; `loadHarness` resolves it |
| `packages/shell/src/main/backend/backend-protocol.ts` | Create | framing, classify, names, limiter |
| `packages/shell/src/main/backend/backend-log.ts` | Create | rotated log |
| `packages/shell/src/main/backend/backend-process.ts` | Create | one child process |
| `packages/shell/src/main/backend/backend-supervisor.ts` | Create | lifecycle and restarts |
| `packages/shell/src/main/backend/backend-ipc.ts` | Create | `registerBackendIpc(handle, deps)` |
| `packages/shell/src/main/index.ts` | Modify | wiring: start, quit, move, profile switch, scope changes |
| `packages/shell/src/main/linked-ipc.ts` | Modify | `hatchesState` gains `backend: true` |
| `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts` | Modify | `client.backend` |
| `packages/ui/src/hatches/BackendCard.tsx`, `useBackend.ts` | Create | the failed card; a hook for harness UIs |
| `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/index.ts` | Modify | mount the card; export `useBackend` |
| `packages/shell/test/fixtures/backends/*.mjs` | Create | echo, crash, ignore-term, chatty, asks, slow |
| `harnesses/demo/backend/index.ts`, `harnesses/demo/harness.config.ts`, `harnesses/demo/ui/App.tsx` | Create/Modify | the echo backend and a small panel |
| `packages/e2e/tests/backend.spec.ts` | Create | mock-mode e2e |
| docs | Modify | `hatches.md` (H2 section), `manifest.md`, `authoring.md`, `history.md` (move step 2), the template/guide |

## Overlaps

- **Plugins' backends** (`plugin-host.ts`) are a different thing: sandboxed hidden windows for third-party code, pinned by hash. The harness backend is the harness's own Node process, as its MCP servers. Nothing is shared but `handle()` and the launcher; don't reuse `plugin-protocol.ts`.
- **Folder move** (`move-folder.ts`, `guardedMove` step 2): the backend stops where the runtime closes and starts again after the move ends, moved or not (`rebase`). **Profile switch** (`profile-switch.ts`): same, as `PluginsController.rebase`.
- **Quit** (`before-quit` in `index.ts`): the backend stops after plugins and before the runtime closes.
- **Part 1**: `scopesChanged` fires on scope create/rename/archive and on link/unlink (`linked-ipc`'s `changed()`).
- **The origin/master merge (in the base)**: `blocks/src/launch.ts` gained `translateServerSpec` and the `review` channel; `electronLauncher` is unchanged and is the backend's launcher. Language on demand reserves the MCP name `translate` (irrelevant here: the backend is no MCP server).

## Open questions (each with the default this plan takes)

1. Harness update: no in-app update exists; the supervisor's `stop`/`start` are the hooks for plan 4b (Decision 6).
2. Several windows (spec §10 Q2): one backend per app, as today's one window per data folder.
3. `client.backend.state` is a method (Decision 1).
4. A protocol helper for authors (`defineHarnessBackend`) would need a JS build of the SDK sub-path to run under Electron's Node; v1 ships types only and the demo shows the 30-line loop (Decision 2).
5. Native modules, the `humanharness build` check, `--rebuild`, `node-pty` packaging and Gatekeeper (spec §4.4, §10 Q4): plan 4b.

## Standing rules

As in part 1. English UI strings: "The harness's helper stopped working.", "Restart", "Restarting…".

## Self-review (done while writing)

- Spec coverage:
  - §4.1 manifest, launch, trust: Tasks 1, 4, 6.
  - §4.2 transport, `init`, `scopesChanged`, `call` 30 s, events 200/s, what it cannot do: Tasks 2, 4, 5, 6.
  - §4.3 crash restarts and `failed` + card, quit SIGTERM/SIGKILL 3 s, folder move, engine switch, harness update (hook), logs 5 MB, mock mode: Tasks 3, 4, 5, 6, 7.
  - §4.4: deferred (plan 4b), Open question 5.
  - §4.5 compliance: B7, B9.
  - §7 H2 tests: init, call timeout, events rate limit (Tasks 2, 4); restart and limit, stop on quit, restart after move (Tasks 5, 6); refusal of history writes (Task 2); native check deferred.
  - §7 E2E echo backend in the demo: Task 8.
- Types: `BackendInit`, `BackendScope`, limits (Task 1); `LineReader`, `classifyIncoming`, `EventLimiter`, `BACKEND_NAME` (Task 2); `BackendLog` (Task 3); `BackendProcess` (Task 4); `BackendSupervisor`, `BackendState` (Task 5); `BackendClient` (Task 6).

---

### Task 0: Base check

- [ ] **Step 1:** `git -C <worktree> branch --show-current` is `feat/harness-hatches`; `git -C <worktree> log --oneline -1` is part 1's last commit (its docs commit); `git -C <worktree> status --short` is empty.
- [ ] **Step 2:** `corepack pnpm typecheck`, `corepack pnpm test` green. Write the base line in `carry-notes.md` (SHA, test count). No commit.

---

### Task 1: `backend` in the manifest, and the protocol's types

**Files:**
- Create: `packages/harness-sdk/src/harness-backend.ts`
- Modify: `packages/harness-sdk/src/hatches.ts`, `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/hatches.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

```ts
describe("backend (hatches spec §4.1)", () => {
  it("D0: no backend key without one", () => {
    const h = defineHarness(base);
    expect("backend" in h).toBe(false);
    expect(hasBackend(h)).toBe(false);
  });
  it("takes a .ts, .mts, .js or .mjs path; no scopes needed", () => {
    for (const p of ["backend/index.ts", "backend/index.mts", "b.js", "b.mjs"]) expect(defineHarness({ ...base, backend: p }).backend).toBe(p);
  });
  it.each([["", undefined], ["backend/index.tsx", "backend"], ["/abs/x.ts", "relative"]])("refuses %j", (p, message) => {
    const run = () => defineHarness({ ...base, backend: p });
    if (message) expect(run).toThrow(message);
    else expect(run).toThrow();
  });
  it("loadHarness refuses a backend outside the harness folder", async () => {
    // write a temp harness.config.ts with backend: "../escape.ts" → loadHarness rejects /escapes the harness folder/
  });
  it("the limits main enforces", () => {
    expect(BACKEND_CALL_TIMEOUT_MS).toBe(30_000);
    expect(BACKEND_EVENTS_PER_SECOND).toBe(200);
    expect(BACKEND_RESTARTS).toEqual({ max: 3, windowMs: 5 * 60_000 });
    expect(BACKEND_STOP_GRACE_MS).toBe(3_000);
    expect(BACKEND_LOG_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});
```

(For the `loadHarness` case, follow how `harness.test.ts` writes a temporary manifest and loads it.)

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

`harness-backend.ts` (no runtime imports, so a backend can `import type` it):

```ts
/**
 * The harness backend's protocol (hatches spec §4.2): JSON-RPC 2.0, one JSON message per line on stdin/stdout.
 * Stdout carries protocol messages only; write logs to stderr (it goes to backend.log).
 *
 * A backend written in TypeScript runs on Electron's Node, which strips types itself: use erasable syntax only
 * (no enum, namespace or parameter properties), and import this file with `import type`.
 */

/** One scope as the backend sees it, with its linked folders (part 1). */
export interface BackendScope {
  id: string;
  title: string;
  linked: { key: string; path: string; mode: "read" | "write" }[];
}

/** The `init` notification's params, sent once at launch; `scopesChanged` carries the same shape. */
export interface BackendInit {
  /** The person's folder (with profiles, the active profile's). */
  folder: string;
  scopes: BackendScope[];
  /** The person's language, a BCP 47 tag. */
  language: string;
  coreVersion: string;
  /** A folder of the backend's own in the app's data folder, for caches. */
  dataDir: string;
  /** The app runs in mock mode (no engine): fake what the backend would do, if it wants. */
  mock: boolean;
}

export const BACKEND_CALL_TIMEOUT_MS = 30_000;
export const BACKEND_EVENTS_PER_SECOND = 200;
export const BACKEND_RESTARTS = { max: 3, windowMs: 5 * 60_000 } as const;
export const BACKEND_STOP_GRACE_MS = 3_000;
export const BACKEND_LOG_MAX_BYTES = 5 * 1024 * 1024;
/** A method or event name: what `client.backend.call` and `on` take. */
export const BACKEND_NAME = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,99}$/;
export const BACKEND_LINE_MAX = 1024 * 1024;
export const BACKEND_EVENT_MAX = 64 * 1024;
export const BACKEND_CALLS_IN_FLIGHT = 64;
```

`hatches.ts`: `export const backendSchema = z.string().min(1).regex(/^[^/\\][^:]*\.(ts|mts|js|mjs)$/, { message: "backend is a relative path to a .ts, .mts, .js or .mjs file" });` and `hasBackend = (h: { backend?: string }) => typeof h.backend === "string";`. `index.ts`: `/** The harness's own process for its UI (hatches spec §4). Absent: none (D0). */ backend: backendSchema.optional(),`; `export * from "./harness-backend";`; in `loadHarness`: `if (loaded.backend) resolveInHarness(loaded, loaded.backend);` with the other checks.

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/harness-sdk/test`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/harness-sdk/src/harness-backend.ts packages/harness-sdk/src/hatches.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/hatches.test.ts
git -C <worktree> commit -m "feat(sdk): backend in the manifest, and its protocol's types and limits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 2: The protocol, pure

**Files:**
- Create: `packages/shell/src/main/backend/backend-protocol.ts`
- Test: `packages/shell/test/backend/backend-protocol.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, expect, it } from "vitest";
import { EventLimiter, LineReader, classifyIncoming, encode, refusalFor } from "../../src/main/backend/backend-protocol";

describe("LineReader", () => {
  it("splits on newlines across chunks and keeps the tail", () => {
    const lines: string[] = [];
    const r = new LineReader((l) => lines.push(l), () => {});
    r.push(Buffer.from('{"a":1}\n{"b"'));
    r.push(Buffer.from(':2}\n'));
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });
  it("drops a line over 1 MB and reports it, then goes on (B3)", () => {
    const lines: string[] = [];
    const dropped: number[] = [];
    const r = new LineReader((l) => lines.push(l), (n) => dropped.push(n));
    r.push(Buffer.from("x".repeat(1024 * 1024 + 1)));
    r.push(Buffer.from('\n{"ok":true}\n'));
    expect(lines).toEqual(['{"ok":true}']);
    expect(dropped).toHaveLength(1);
  });
});

describe("classifyIncoming (B3, B4)", () => {
  const ours = new Set([1, 2]);
  it("a result or error for one of our ids is a response", () => {
    expect(classifyIncoming('{"jsonrpc":"2.0","id":1,"result":{"x":1}}', ours)).toEqual({ kind: "response", id: 1, result: { x: 1 } });
    expect(classifyIncoming('{"jsonrpc":"2.0","id":2,"error":{"code":-1,"message":"no"}}', ours)).toEqual({ kind: "response", id: 2, error: "no" });
  });
  it("a notification is an event when its name is valid and its params fit 64 KB", () => {
    expect(classifyIncoming('{"jsonrpc":"2.0","method":"tick","params":{"n":1}}', ours)).toEqual({ kind: "event", event: "tick", data: { n: 1 } });
    expect(classifyIncoming(`{"jsonrpc":"2.0","method":"tick","params":"${"x".repeat(65 * 1024)}"}`, ours).kind).toBe("invalid");
    expect(classifyIncoming('{"jsonrpc":"2.0","method":"bad name","params":1}', ours).kind).toBe("invalid");
  });
  it("refusal of history writes: any request from the backend is refused, whatever it names", () => {
    for (const method of ["history.save", "notes.write", "data.put", "session.new", "init"]) {
      const c = classifyIncoming(`{"jsonrpc":"2.0","id":"x","method":"${method}","params":{}}`, ours);
      expect(c).toEqual({ kind: "request", id: "x", method });
      expect(JSON.parse(refusalFor("x"))).toEqual({ jsonrpc: "2.0", id: "x", error: { code: -32601, message: "The app takes no requests from a backend" } });
    }
  });
  it("a response to an id we never sent, non-JSON and a non-object are invalid", () => {
    expect(classifyIncoming('{"jsonrpc":"2.0","id":9,"result":1}', ours).kind).toBe("invalid");
    expect(classifyIncoming("not json", ours).kind).toBe("invalid");
    expect(classifyIncoming("[1,2]", ours).kind).toBe("invalid");
    expect(classifyIncoming('{"jsonrpc":"2.0","id":{"__proto__":1},"result":1}', ours).kind).toBe("invalid");
  });
  it("cuts an error message to 500 characters", () => {
    const c = classifyIncoming(`{"jsonrpc":"2.0","id":1,"error":{"code":1,"message":"${"e".repeat(900)}"}}`, ours);
    expect(c.kind === "response" && c.error?.length).toBe(500);
  });
});

describe("encode", () => {
  it("one line of JSON-RPC 2.0", () => {
    expect(encode({ id: 3, method: "echo", params: { a: 1 } })).toBe('{"jsonrpc":"2.0","id":3,"method":"echo","params":{"a":1}}\n');
    expect(encode({ method: "init", params: {} })).toBe('{"jsonrpc":"2.0","method":"init","params":{}}\n');
  });
});

describe("EventLimiter (B5)", () => {
  it("lets 200 through in a second, drops the rest, and counts them", () => {
    let now = 0;
    const l = new EventLimiter(200, () => now);
    let passed = 0;
    for (let i = 0; i < 250; i++) if (l.take()) passed++;
    expect(passed).toBe(200);
    expect(l.flushDropped()).toBe(50);
    expect(l.flushDropped()).toBe(0);
    now = 1001;
    expect(l.take()).toBe(true);
  });
  it("is a rolling window, not a fixed one", () => {
    let now = 0;
    const l = new EventLimiter(2, () => now);
    l.take();
    now = 600;
    l.take();
    now = 1001;
    expect(l.take()).toBe(true); // the one at 0 left the window
    expect(l.take()).toBe(false); // 600 and 1001 are in it
  });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement** `backend-protocol.ts` with exactly these exports. Notes:
- `classifyIncoming(line, ours: ReadonlySet<number>)` returns `{ kind: "response"; id: number; result?: unknown; error?: string } | { kind: "event"; event: string; data: unknown } | { kind: "request"; id: string | number; method: string } | { kind: "invalid"; why: string }`. An id must be a finite integer (`Number.isInteger`) for a response and is looked up with `ours.has(id)`; for a request, a string ≤ 200 or an integer, echoed back in the refusal. A notification's `params` size is `JSON.stringify(params ?? null).length` ≤ `BACKEND_EVENT_MAX`. Parse with `JSON.parse` only; never `eval`, never build a regex from the input.
- `LineReader` keeps at most `BACKEND_LINE_MAX` bytes of tail; past that it discards until the next newline and calls `onDrop(bytes)` once for that line.
- `EventLimiter(perSecond, now)`: a queue of timestamps; `take()` drops timestamps ≤ `now() - 1000`, then admits when below the cap; `flushDropped()` returns and clears the count.

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/backend/backend-protocol.ts packages/shell/test/backend/backend-protocol.test.ts
git -C <worktree> commit -m "feat(shell): the harness backend's protocol: framing, refusals, rate limit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 3: `backend.log`, rotated at 5 MB

**Files:**
- Create: `packages/shell/src/main/backend/backend-log.ts`
- Test: `packages/shell/test/backend/backend-log.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
describe("BackendLog (spec §4.3)", () => {
  it("appends lines with a time prefix", async () => {
    // const log = new BackendLog(dir, { max: 1000, now: () => new Date("2026-10-28T10:00:00Z") }); await log.write("stderr", "hello\n")
    // file backend.log === "2026-10-28T10:00:00.000Z stderr hello\n"
  });
  it("rotates to backend.log.1 past the limit, keeping one old file", async () => {
    // max 100: write 3 lines of 60 bytes → backend.log.1 holds the older ones, backend.log the newest; a fourth rotation replaces .1
  });
  it("never throws: a folder it can't write is reported once to console.error", async () => {
    // dir is a file → write resolves; console.error spy called once across two writes
  });
  it("splits a chunk into lines and cuts a line at 8 KB", async () => {});
  it("writes are serialized: 50 concurrent writes keep every line whole", async () => {});
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `new BackendLog(dir, { max = BACKEND_LOG_MAX_BYTES, now = () => new Date() })`, `write(stream: "stderr" | "app", text: string): Promise<void>`: one promise chain; before each append, `stat` the file and, when `size + bytes > max`, `rename(backend.log, backend.log.1)` (replacing it). Open with `fs.appendFile`. A failure logs once ("Could not write backend.log") and resolves.

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/backend/backend-log.ts packages/shell/test/backend/backend-log.test.ts
git -C <worktree> commit -m "feat(shell): backend.log, rotated at 5 MB" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 4: One backend process

**Files:**
- Create: `packages/shell/src/main/backend/backend-process.ts`, `packages/shell/test/fixtures/backends/{echo,crash,ignore-term,chatty,asks,slow,cwd}.mjs`
- Test: `packages/shell/test/backend/backend-process.test.ts`

- [ ] **Step 1: The fixtures.** Each is plain Node, no imports beyond `node:` built-ins:
- `echo.mjs`: reads lines; on `init` stores params; on `{id, method:"echo", params}` answers `{id, result: params}`; on `method:"init?"` answers with the stored init; on `method:"stream"` sends `params.n` notifications `tick` `{ i }` then answers `{ sent: n }`; on `method:"fail"` answers an error `{ code: 1, message: "nope" }`.
- `crash.mjs`: exits with code 1 after 50 ms.
- `ignore-term.mjs`: `process.on("SIGTERM", () => {})`, stays alive.
- `chatty.mjs`: on init, sends 1000 `tick` notifications at once, then idles.
- `asks.mjs`: on init, sends a request `{ id: "x", method: "history.save", params: {} }` and writes whatever comes back to stderr.
- `slow.mjs`: never answers calls.
- `cwd.mjs`: on `whereami` answers `{ cwd: process.cwd(), env: Object.keys(process.env).filter(k => k.startsWith("HH_")) }`.

- [ ] **Step 2: Write the failing tests.**

```ts
const launcher = { command: process.execPath, args: [], env: { HH_LAUNCHER_MARK: "1" } };
const fixture = (n: string) => path.resolve(__dirname, "../fixtures/backends", `${n}.mjs`);
const init: BackendInit = { folder: "/w", scopes: [], language: "en", coreVersion: "0.1.0", dataDir: "/d", mock: false };

describe("BackendProcess (hatches spec §4.2, §4.3)", () => {
  it("sends init first; init has exactly these keys (B7)", async () => {
    // start echo; call("init?") → equals init; Object.keys sorted == ["coreVersion","dataDir","folder","language","mock","scopes"]
  });
  it("runs in its own process with the harness folder as cwd and the launcher's env (B1)", async () => {
    // start cwd.mjs with cwd: harnessDir → whereami.cwd === realpath(harnessDir); env includes HH_LAUNCHER_MARK; pid !== process.pid
  });
  it("call answers with the result; a backend error rejects with its message", async () => {});
  it("call times out after the timeout and rejects 'The backend didn't answer in time'", async () => {
    // slow.mjs with timeoutMs: 200
  });
  it("events stream through the limiter, in order", async () => {
    // stream n=5 → onEvent got tick {i:0..4} before the call resolved
  });
  it("events over 200 per second are dropped and counted (B5)", async () => {
    // chatty.mjs → after 300 ms, exactly 200 events; log got "Dropped 800 backend events"
  });
  it("a request from the backend is refused with -32601 and logged (B4)", async () => {
    // asks.mjs → its stderr (in the log) has -32601; log has "A backend asked the app for history.save; refused"
  });
  it("stderr goes to the log, stdout lines that aren't protocol are dropped and logged", async () => {});
  it("stop sends SIGTERM; a backend that ignores SIGTERM is killed after 3 s (B8)", async () => {
    // ignore-term.mjs with graceMs: 300 → stop() resolves within ~1 s; exited
  });
  it("an unexpected exit resolves `exited` with the code, and pending calls reject", async () => {
    // crash.mjs: exited → { code: 1, expected: false }
  });
  it("at most 64 calls in flight, the 65th rejects at once", async () => {
    // slow.mjs: 64 pending calls; the 65th rejects "Too many calls to the backend"
  });
});
```

- [ ] **Step 3: Run to see them fail.**

- [ ] **Step 4: Implement** `BackendProcess`:

```ts
export interface BackendProcessOptions {
  launcher: Launcher;
  /** The backend entry, absolute (resolveInHarness). */
  entry: string;
  /** The harness folder. */
  cwd: string;
  init: BackendInit;
  log: BackendLog;
  onEvent: (event: string, data: unknown) => void;
  timeoutMs?: number; // BACKEND_CALL_TIMEOUT_MS
  graceMs?: number; // BACKEND_STOP_GRACE_MS
  now?: () => number;
}

export class BackendProcess {
  /** Resolves once the process is gone: `expected` when stop() asked for it. */
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; expected: boolean }>;
  static async start(o: BackendProcessOptions): Promise<BackendProcess>;
  call(method: string, params: unknown): Promise<unknown>;
  notify(method: "scopesChanged", params: BackendInit): void;
  stop(): Promise<void>;
}
```

Spawn with `spawn(o.launcher.command, [...o.launcher.args, o.entry], { cwd: o.cwd, env: { ...process.env, ...o.launcher.env }, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" })`; resolve `start` on `spawn`, reject on `error`. Write `encode({ method: "init", params: init })` first. Ids are a counter from 1; pending calls in a `Map<number, { resolve, reject, timer }>`. `stop()`: mark expected, `process.kill(-pid, "SIGTERM")` (POSIX group; `child.kill()` on Windows), timer `graceMs` → `SIGKILL`; resolves on exit. On exit, every pending call rejects "The backend isn't running". Every log line through `o.log.write`.

- [ ] **Step 5: Run.** `corepack pnpm vitest run packages/shell/test/backend`. Expected: PASS.

- [ ] **Step 6: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/backend/backend-process.ts packages/shell/test/fixtures/backends packages/shell/test/backend/backend-process.test.ts
git -C <worktree> commit -m "feat(shell): run a harness backend as a child process over JSON-RPC" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 5: The supervisor: restarts, failed, rebase

**Files:**
- Create: `packages/shell/src/main/backend/backend-supervisor.ts`
- Test: `packages/shell/test/backend/backend-supervisor.test.ts`

- [ ] **Step 1: Write the failing tests** with an injected `startProcess` (a fake returning controllable `exited` promises) and a fake clock:

```ts
describe("BackendSupervisor (hatches spec §4.3, B6)", () => {
  it("start → starting → running; state changes are reported", async () => {});
  it("restarts after a crash, up to 3 times in 5 minutes, then failed", async () => {
    // four crashes at t=0,10s,20s,30s → three restarts, then state "failed"; no fourth start
  });
  it("crashes spread over more than 5 minutes keep restarting", async () => {
    // crashes at 0, 2min, 4min, 6min, 8min → still running
  });
  it("restart() from failed starts again and clears the count", async () => {});
  it("an expected exit (stop) is not a crash", async () => {});
  it("rebase(init) stops and starts with the new init; a call during it rejects 'The backend isn't running'", async () => {});
  it("stop() for quit: no restart afterwards, even if it crashes while stopping", async () => {});
  it("scopesChanged notifies a running backend, and is remembered for the next start", async () => {});
  it("call when not running rejects 'The backend isn't running'", async () => {});
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
export type BackendState = "stopped" | "starting" | "running" | "failed";

export class BackendSupervisor {
  constructor(private readonly d: {
    startProcess: (init: BackendInit, onEvent: (event: string, data: unknown) => void) => Promise<BackendProcess>;
    onEvent: (event: string, data: unknown) => void;
    onState: (s: BackendState) => void;
    now?: () => number;
  }) {}
  state(): BackendState;
  start(init: BackendInit): Promise<void>;
  restart(): Promise<void>;
  rebase(init: BackendInit): Promise<void>;
  scopesChanged(scopes: BackendScope[]): void;
  call(method: string, params: unknown): Promise<unknown>;
  stop(): Promise<void>;
}
```
Crash times in an array; prune those older than `BACKEND_RESTARTS.windowMs`; restart only while the array (after pushing this crash) has ≤ `max` entries. A start that throws (spawn error) counts as a crash. All transitions run on one promise chain so `rebase` and a crash restart never interleave.

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/backend/backend-supervisor.ts packages/shell/test/backend/backend-supervisor.test.ts
git -C <worktree> commit -m "feat(shell): the backend supervisor: restarts within limits, failed, rebase" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 6: Wiring in main, IPC and `client.backend`

**Files:**
- Create: `packages/shell/src/main/backend/backend-ipc.ts`
- Modify: `packages/shell/src/main/index.ts`, `packages/shell/src/main/linked-ipc.ts` (`hatchesState`), `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`
- Test: `packages/shell/test/backend/backend-ipc.test.ts`, `packages/shell/test/backend/backend-wiring.test.ts`, `packages/shell/test/hatches-surface.test.ts` (append), `packages/shell/test/preload.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

`backend-ipc.test.ts` (in-memory `handle` map, a fake supervisor):
```ts
  it("hh:backendCall forwards a valid method and params and answers the result", async () => {});
  it.each([["", "bad"], ["has space", "bad"], ["x".repeat(101), "bad"], [42, "bad"]])("refuses method %j (B2)", async () => {});
  it("refuses params that can't be serialised or exceed 1 MB (B2)", async () => {
    // a cyclic object → rejects; "x".repeat(1024*1024+1) → rejects "Too large"
  });
  it("hh:backendState answers the supervisor's state; hh:backendRestart restarts only from failed", async () => {});
```

`backend-wiring.test.ts`:
```ts
  it("D0: a harness without backend never constructs a supervisor", () => {
    // backendFor(defineHarness(plain), deps) === null and deps.startProcess never called
  });
  it("init for a base: folder, active scopes with links, language, coreVersion, dataDir under userData, mock", async () => {
    // backendInit({ base, scopes: ScopeStore list with one archived, config, userData, mock: true }) → archived left out; dataDir = <userData>/backend-data
  });
  it("never names an engine home (B9)", async () => {
    // source scan of backend/*.ts: no ".claude", ".codex", "homedir"
  });
```

`hatches-surface.test.ts`: `registerBackendIpc` is called only inside `if (hasBackend(harness))` in `index.ts`; `hatchesState(defineHarness({ ...plain, backend: "b.ts" }))` is `{ backend: true }`; with `linkedFolders` only it has no `backend` key.

`preload.test.ts`: `window.hh.backend.call("echo", { a: 1 })` invokes `hh:backendCall` with `("echo", { a: 1 })`; `on("tick", cb)` subscribes to `hh:backendEvent` and calls `cb` only for `{ event: "tick" }` payloads.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

`client.ts`:
```ts
export type BackendState = "stopped" | "starting" | "running" | "failed";
/** The harness's own backend (hatches spec §4). Harnesses without `backend`: every call rejects. */
export interface BackendClient {
  call(method: string, params?: unknown): Promise<unknown>;
  /** Listens to one event the backend sends; returns the unsubscribe. */
  on(event: string, listener: (data: unknown) => void): () => void;
  /** Decision 1: a method, since values cross the bridge by copy. */
  state(): Promise<BackendState>;
  onState(listener: (s: BackendState) => void): () => void;
  /** From `failed`: starts it again. */
  restart(): Promise<void>;
}
```
`HarnessClient.backend: BackendClient`; `HatchesState.backend?: true`. Preload: `call` → `hh:backendCall`; `on` subscribes once per listener to `hh:backendEvent` and filters by `event`; `state` → `hh:backendState`; `onState` → `hh:backendStateChange`; `restart` → `hh:backendRestart`. Fake client: `backendCalls` spy, `backendEmit(event, data)`, `backendStateSet(s)`.

`index.ts`, only `if (hasBackend(harness))`:
- `backend = new BackendSupervisor({ startProcess: (init, onEvent) => BackendProcess.start({ launcher: electronLauncher(process.execPath), entry: resolveInHarness(harness, harness.backend!), cwd: harness.root, init, log: backendLog, onEvent }), onEvent: (event, data) => sendToWindow("hh:backendEvent", { event, data }), onState: (s) => sendToWindow("hh:backendStateChange", s) })`, with `backendLog = new BackendLog(app.getPath("userData"))` (the dev app uses the same launcher as the MCP servers there; check `runtimeOptions`' `launcher` and use the same expression);
- **start**: in the same place `jobsReady()` runs after setup (the app is configured), `void backend.start(await backendInit()).catch(log)`; once per process;
- **quit**: in `before-quit`'s async block, after `pluginHost?.stopAll()` and before closing the runtime: `await backend?.stop().catch(log)`;
- **folder move**: where `guardedMove` closes the runtime (`closeRuntime` in its deps), also `await backend?.stop()`; when the move ends (moved or not, in its `finally`), `void backend?.start(await backendInit())`. **Profile switch**: same around the switch (`profile-switch.ts` deps or `index.ts` where `PluginsController.rebase` is called: `backend.rebase(await backendInit())`);
- **scopes**: in `scopesChanged()` (index.ts) add `backend?.scopesChanged((await backendInit()).scopes)`; part 1's `linked-ipc` `changed()` calls `scopesChanged()` already (check; else call it);
- `registerBackendIpc(handle, { supervisor: backend })`.

`backendInit()` (exported from `backend-ipc.ts` as a pure builder `backendInit({ base, scopes, language, coreVersion, userData, profile, mock })`): `dataDir` per Decision 3, created with `mkdir -p` by the caller.

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/shell/test/backend packages/shell/test/hatches-surface.test.ts packages/shell/test/ipc-surface.test.ts packages/shell/test/preload.test.ts packages/shell/test/move-folder.test.ts`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit.**

```bash
git -C <worktree> add packages/shell/src/main/backend/backend-ipc.ts packages/shell/src/main/index.ts packages/shell/src/main/linked-ipc.ts packages/shell/src/preload/index.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/shell/test/backend packages/shell/test/hatches-surface.test.ts packages/shell/test/preload.test.ts
git -C <worktree> commit -m "feat(shell): start the harness backend after setup; client.backend" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 7: The failed card and `useBackend`

**Files:**
- Create: `packages/ui/src/hatches/BackendCard.tsx`, `packages/ui/src/hatches/useBackend.ts`
- Modify: `packages/ui/src/HarnessApp.tsx` (mount the card only with `state.hatches?.backend`), `packages/ui/src/index.ts` (export `useBackend`), en.json `"hatches"`
- Test: `packages/ui/test/backend-ui.test.tsx`

- [ ] **Step 1: Write the failing tests.**

```tsx
describe("the backend in the window (hatches spec §4.3)", () => {
  it("D0: no card and no listener without state.hatches.backend", () => {
    // render HarnessApp with a plain state: fake.backendStateListeners.size === 0; no "The harness's helper stopped working."
  });
  it("failed shows the card; Restart calls restart and shows Restarting… until running", async () => {});
  it("starting and running show nothing", async () => {});
  it("useBackend gives state, call and on to a harness view", async () => {
    // a test component using useBackend(client): renders state, calls call("echo"), hears on("tick")
  });
  it("client.backend has exactly call, on, state, onState, restart (B4)", () => {
    expect(Object.keys(fakeClient().backend).sort()).toEqual(["call", "on", "onState", "restart", "state"]);
  });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** The card is a `role="alert"` region with the sentence and a "Restart" button; after a click the button is disabled with "Restarting…" until the state leaves `failed`. en.json: `"backendFailed": "The harness's helper stopped working."`, `"backendRestart": "Restart"`, `"backendRestarting": "Restarting…"`. `useBackend(client)` returns `{ state, call, on }` and keeps `state` fresh with `onState`.

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit.**

```bash
git -C <worktree> add packages/ui/src/hatches/BackendCard.tsx packages/ui/src/hatches/useBackend.ts packages/ui/src/HarnessApp.tsx packages/ui/src/index.ts packages/i18n/src/locales/en.json packages/ui/test/backend-ui.test.tsx
git -C <worktree> commit -m "feat(ui): a card when the harness backend fails, and useBackend" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 8: The demo's echo backend and the e2e

**Files:**
- Create: `harnesses/demo/backend/index.ts`, `packages/e2e/tests/backend.spec.ts`
- Modify: `harnesses/demo/harness.config.ts` (`backend: "./backend/index.ts"`), `harnesses/demo/ui/App.tsx` (a small "Backend" panel), `harnesses/demo/test/manifest.test.ts` (the backend resolves)
- Test: the e2e; `harnesses/demo/test/backend.test.ts` (runs the echo over stdio with tsx: `devLauncher`)

- [ ] **Step 1: The echo backend** (erasable TypeScript only, Decision 2; no imports but `node:readline` and `import type`):

```ts
import type { BackendInit } from "@humanharness/harness-sdk";
import { createInterface } from "node:readline";

// The demo's backend (hatches spec §4): answers `echo` and streams `tick` events, so the demo can show the protocol.
let init: BackendInit | null = null;
const send = (msg: object) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  let msg: { id?: number; method?: string; params?: unknown };
  try {
    msg = JSON.parse(line);
  } catch {
    process.stderr.write("A line that isn't JSON\n");
    return;
  }
  if (msg.method === "init" || msg.method === "scopesChanged") {
    init = msg.params as BackendInit;
    return;
  }
  if (msg.id === undefined) return;
  if (msg.method === "echo") return send({ id: msg.id, result: { echo: msg.params, mock: init?.mock ?? false } });
  if (msg.method === "stream") {
    const n = Math.min(Number((msg.params as { n?: unknown })?.n) || 3, 20);
    let i = 0;
    const timer = setInterval(() => {
      send({ method: "tick", params: { i } });
      if (++i >= n) {
        clearInterval(timer);
        send({ id: msg.id, result: { sent: n } });
      }
    }, 50);
    return;
  }
  send({ id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } });
});
```

The demo panel (in the side panel the demo's `App.tsx` already renders): an "Echo" button that calls `client.backend.call("echo", { text: "hello" })` and shows the answer, and a "Stream" button that calls `stream` with `n: 3` and lists the ticks it hears (`useBackend`). Labels in the demo's own `locales/en.json`.

- [ ] **Step 2: Write the e2e** (mock mode, `launchMock` from `helpers.ts`, the demo build):

```ts
test("the demo's echo backend answers and streams events in mock mode", async () => {
  // launchMock(s); Start Demo; open the side panel's Backend section; Echo → shows "hello" and "mock: true";
  // Stream → three ticks 0, 1, 2 in order, then "sent 3"
});

test("a backend killed from outside restarts; after three crashes the card offers Restart", async () => {
  // find the backend's pid: app.evaluate reads it from a test-only hook? Not available: instead kill by the entry path
  // with process.kill on pids whose command line names harnesses/demo/backend/index.ts (ps -o pid,command) — POSIX only, skip on win32.
  // kill once → Echo works again; kill 4 times quickly → "The harness's helper stopped working." → Restart → Echo works
});
```
If finding the pid from the test is brittle, keep only the first test and cover the restart in Task 5's unit tests; say so in the carry notes.

- [ ] **Step 3: Run.** `corepack pnpm app:build`, then `corepack pnpm --filter @humanharness/e2e exec playwright test tests/backend.spec.ts tests/history.spec.ts tests/mock.spec.ts`. Expected: PASS (history.spec unchanged).

- [ ] **Step 4: Full run.** `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm e2e`.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add harnesses/demo/backend harnesses/demo/harness.config.ts harnesses/demo/ui/App.tsx harnesses/demo/locales/en.json harnesses/demo/test packages/e2e/tests/backend.spec.ts
git -C <worktree> commit -m "feat(demo): an echo backend; e2e in mock mode" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 9: Docs

**Files:**
- Modify: `docs/architecture/hatches.md` (H2 section), `docs/architecture/manifest.md` (a `backend` row), `docs/architecture/authoring.md` (writing a backend: the protocol, erasable TS, stdout is protocol only, logs to stderr, `init.mock`), `docs/architecture/history.md` (move step 2: the backend stops with the runtime and starts after), `docs/architecture/mock-mode.md` (the backend runs; `init.mock`), the template/guide if they list manifest fields, `harnesses/demo/HARNESS.md` (the demo's backend)

- [ ] **Step 1: Write the H2 section** of `hatches.md` in the style of part 1's: what it is, launch and trust, the protocol (with a sample exchange), the lifecycle table (crash, quit, move, profile switch, engine switch, update), logs, mock mode, the D0 table, B1–B9 with tests, Decisions 1–11, Known gaps: native modules and packaging (plan 4b, spec §4.4), no harness update path yet, no per-window backends, the restart e2e (if Task 8 dropped it).
- [ ] **Step 2: The other docs**, one paragraph or row each.
- [ ] **Step 3: Commit.**

```bash
git -C <worktree> add docs/architecture harnesses/demo/HARNESS.md packages/cli/src
git -C <worktree> commit -m "docs: the harness backend (hatches H2)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

## Parallel execution

| Wave | Tasks | Notes |
|---|---|---|
| A | 1, 2, 3 | SDK / backend-protocol.ts / backend-log.ts (2 and 3 import Task 1's constants: start 1 first or inline the numbers and switch after 1 lands) |
| B | 4 | needs 1–3 |
| C | 5 | needs 4's class shape (it uses a fake `startProcess`, so it can start once 4's interface is committed) |
| D | 6, then 7 | 7 needs `client.backend` from 6 |
| E | 8, then 9 | |
