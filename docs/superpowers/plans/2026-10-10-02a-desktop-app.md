# Human Harness — Plan 2a: Desktop app

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The demo harness opens as a macOS Electron app: a minimal setup screen (language, folder, engine), then a chat that runs real turns through the plan-1 runtime, renders the harness's own block components, shows activity and errors, persists the conversation, and lets the user go back to an earlier point in history — in Spanish or English.

**Architecture:** `packages/shell` is the Electron app: the main process loads the harness, owns config, the runtime and the chat log, and talks to the renderer over a typed IPC contract; the preload exposes that contract as `window.hh`. electron-vite bundles main (plus two extra entries: the `ui` MCP server and the compiled harness manifest), preload and renderer. `packages/ui` is the React kit (setup screen, chat, blocks, history, error cards) driven by a `HarnessClient` interface, so it is tested in happy-dom with a fake client. `packages/i18n` holds the core translations. Each harness provides `ui/App.tsx` that mounts `HarnessApp` with its block components and locales.

**Tech Stack:** Electron 44, electron-vite 5, Vite 8, React 19, i18next 26 + react-i18next 17, Vitest 5 + @testing-library/react 16 + happy-dom 20. Plan-1 packages unchanged except for three small additions (Task 2).

Spec: `docs/superpowers/specs/2026-10-10-humanharness-core-design.md` (§6 turn flow and errors, §7 folder/history, §9 onboarding). Roadmap: `docs/superpowers/plans/2026-10-10-00-roadmap.md`. Plan 2b (full onboarding: detect/install/login/test, legal notice, usage meter and pre-flight warnings) follows this plan.

---

## Conventions

- Same as plan 1: English everywhere; packages export TS source; extensionless imports; tests in `packages/<name>/test/`; use `corepack pnpm …` (pnpm is not on PATH); one commit per task with the session trailers.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line.
- Compliance rules from spec §5 still apply. The shell never reads `~/.claude` / `~/.codex`, never passes credentials; the only env it adds for child processes is `ELECTRON_RUN_AS_NODE=1` and `PATH`.
- Electron main code that needs a real window is verified manually (Task 11); everything else has unit tests.

## Scope decisions

- **Setup screen, not full onboarding:** language → folder (with the "don't move it" warning) → engine (from `availableEngines`, development mode while unpackaged). It assumes the engine CLI is installed and logged in. Detection, install, login, the legal notice checkbox and the test prompt are plan 2b.
- **History UI:** a panel listing history commits; "Go back to this point" restores that commit. Per-message undo buttons come later.
- **Harness MCP servers** (`mcp` in the manifest) still run as `.ts` through the launcher; the demo has none. Building them is plan 4.
- **Codex in the app** runs the adapter bundled as a dependency of `shell` with Electron's Node, not `npx`.
- **Claude in the app** is spawned by absolute path; the path and `PATH` come from the user's login shell (GUI apps get a minimal `PATH`).

## File map

```
vitest.config.ts, tsconfig.json, package.json        (Task 1: tsx tests, jsx, app scripts)
packages/harness-sdk/src/index.ts                    (Task 2: loadHarness root override)
packages/blocks/src/launch.ts                        (Task 2: electronLauncher, uiServerSpec entry)
packages/runtime/src/runtime.ts                      (Task 2: uiServerEntry option)
packages/i18n/
  src/index.ts                                       createI18n, CORE_LOCALES, Locales
  src/locales/es.json, src/locales/en.json           core UI strings
  test/i18n.test.ts
packages/ui/
  src/client.ts                                      HarnessClient contract + shared types
  src/state.ts                                       reducer: events → chat state
  src/HarnessApp.tsx                                 root: loading / setup / chat
  src/SetupScreen.tsx
  src/ChatView.tsx                                   messages, live turn, composer
  src/Message.tsx, src/ActivityList.tsx, src/ErrorCard.tsx
  src/HistoryPanel.tsx
  src/styles.css                                     tokens, light/dark
  src/index.ts
  test/fake-client.ts, test/state.test.ts, test/HarnessApp.test.tsx
packages/shell/
  package.json, electron.vite.config.ts
  src/main/config.ts                                 per-app config store
  src/main/chat-log.ts                               ChatLog + TurnRecorder
  src/main/engine-command.ts                         binary/PATH resolution, engine command
  src/main/index.ts                                  app, window, IPC handlers
  src/preload/index.ts                               window.hh
  src/renderer/index.html, src/renderer/main.tsx
  test/config.test.ts, test/chat-log.test.ts, test/engine-command.test.ts
harnesses/demo/
  ui/App.tsx, ui/NoteCard.tsx, locales/es.json, locales/en.json, package.json (deps)
```

---

### Task 1: Tooling for React and Electron

**Files:**
- Modify: `vitest.config.ts`, `tsconfig.json`, `package.json`

- [ ] **Step 1: Test discovery and TS config**

`vitest.config.ts` — change `include` to:
```ts
    include: ["packages/*/test/**/*.test.{ts,tsx}"],
```

`tsconfig.json` — set `compilerOptions` additions and `include`:
```json
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"]
```
```json
  "include": ["packages/*/src", "packages/*/test", "harnesses/*/*.ts", "harnesses/*/ui"]
```
(The renderer's `window.hh` typing lives in `packages/shell/src/renderer/env.d.ts`, Task 10.)

Root `package.json` — add scripts:
```json
    "app:dev": "corepack pnpm --filter @humanharness/shell dev",
    "app:build": "corepack pnpm --filter @humanharness/shell build"
```

- [ ] **Step 2: Verify nothing broke**

Run: `corepack pnpm test && corepack pnpm typecheck`
Expected: 121 tests pass; typecheck clean.

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts tsconfig.json package.json
git commit -m "chore: tooling for React tests and the desktop app"
```

---

### Task 2: Plan-1 hooks the app needs

**Files:**
- Modify: `packages/harness-sdk/src/index.ts`, `packages/harness-sdk/test/harness.test.ts`
- Modify: `packages/blocks/src/launch.ts`, `packages/blocks/src/index.ts`, `packages/blocks/test/ui-server.test.ts`
- Modify: `packages/runtime/src/runtime.ts`

Why: in the app the manifest is a compiled `harness.js` next to the main bundle, but its files (`agent/…`) live in the harness folder; the `ui` MCP server is a built `ui-server.js` run with Electron's Node.

- [ ] **Step 1: Failing tests**

Append to `packages/harness-sdk/test/harness.test.ts` (inside `describe("loadHarness")`):
```ts
  it("accepts a root override for compiled manifests", async () => {
    const h = await loadHarness(DEMO, { root: "/somewhere/else" });
    expect(h.root).toBe("/somewhere/else");
    expect(h.configPath).toBe(DEMO);
  });
```

Append to `packages/blocks/test/ui-server.test.ts`:
```ts
describe("launchers", () => {
  it("runs Electron as Node and lets the caller choose the ui server entry", async () => {
    const { electronLauncher, uiServerSpec: spec } = await import("../src");
    const launcher = electronLauncher("/Applications/Demo.app/Contents/MacOS/Demo");
    expect(launcher).toEqual({ command: "/Applications/Demo.app/Contents/MacOS/Demo", args: [], env: { ELECTRON_RUN_AS_NODE: "1" } });
    const s = spec({ harnessConfig: "/x/harness.js", bridge: { path: "/b", token: "t" }, launcher, entry: "/x/ui-server.js" });
    expect(s.args).toEqual(["/x/ui-server.js"]);
    expect(s.env).toMatchObject({ ELECTRON_RUN_AS_NODE: "1", HH_HARNESS: "/x/harness.js" });
  });
});
```

Run: `corepack pnpm vitest run packages/harness-sdk packages/blocks` → FAIL (`root` ignored; `electronLauncher` missing).

- [ ] **Step 2: Implement**

`packages/harness-sdk/src/index.ts` — change `loadHarness`:
```ts
export async function loadHarness(configPath: string, options: { root?: string } = {}): Promise<LoadedHarness> {
  const absolute = path.resolve(configPath);
  const mod = (await import(pathToFileURL(absolute).href)) as { default?: unknown };
  if (mod.default === undefined) throw new Error(`${absolute} has no default export`);
  const harness = manifestSchema.parse(mod.default);
  return { ...harness, root: options.root ? path.resolve(options.root) : path.dirname(absolute), configPath: absolute };
}
```

`packages/blocks/src/launch.ts` — add and change:
```ts
/** Runs Electron's embedded Node (packaged and dev app). */
export function electronLauncher(electronPath: string): Launcher {
  return { command: electronPath, args: [], env: { ELECTRON_RUN_AS_NODE: "1" } };
}

export function uiServerSpec(opts: {
  harnessConfig: string;
  bridge: { path: string; token: string };
  launcher: Launcher;
  /** Built entry for the ui server (app); defaults to the TS source (dev). */
  entry?: string;
}): McpServerSpec {
  const entry = opts.entry ?? fileURLToPath(new URL("./ui-server-bin.ts", import.meta.url));
  return {
    name: "ui",
    command: opts.launcher.command,
    args: [...opts.launcher.args, entry],
    env: { ...opts.launcher.env, HH_HARNESS: opts.harnessConfig, HH_BRIDGE: opts.bridge.path, HH_BRIDGE_TOKEN: opts.bridge.token },
  };
}
```
(`packages/blocks/src/index.ts` already re-exports `./launch`.)

`packages/runtime/src/runtime.ts` — add to `RuntimeOptions`:
```ts
  /** Built `ui` MCP server entry (app). Defaults to the TS source (dev). */
  uiServerEntry?: string;
```
and pass it: `uiServerSpec({ harnessConfig: harness.configPath, bridge, launcher, entry: opts.uiServerEntry })`.

- [ ] **Step 3: Verify and commit**

Run: `corepack pnpm test && corepack pnpm typecheck` → all green.
```bash
git add packages/harness-sdk packages/blocks packages/runtime
git commit -m "feat: hooks for compiled manifests and Electron-run MCP servers"
```

---

### Task 3: i18n package

**Files:**
- Create: `packages/i18n/package.json`, `packages/i18n/src/index.ts`, `packages/i18n/src/locales/es.json`, `packages/i18n/src/locales/en.json`, `packages/i18n/test/i18n.test.ts`

- [ ] **Step 1: Package**

`packages/i18n/package.json`:
```json
{
  "name": "@humanharness/i18n",
  "version": "0.1.0",
  "type": "module",
  "license": "Apache-2.0",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@humanharness/harness-sdk": "workspace:*",
    "i18next": "^26.4.3"
  }
}
```
Run: `corepack pnpm install` (add any version pnpm's release-age policy rejects to `minimumReleaseAgeExclude` and mention it).

- [ ] **Step 2: Core strings**

`packages/i18n/src/locales/en.json`:
```json
{
  "setup": {
    "title": "Let's get {{name}} ready",
    "language": "Language",
    "folder": "Your folder",
    "folderHint": "Your work will be saved here.",
    "folderChange": "Choose another folder",
    "folderWarning": "Don't move, rename or edit this folder by hand: the app depends on it.",
    "engine": "AI engine",
    "engineHint": "It uses your own account. Make sure you are signed in to its app on this computer.",
    "engineRequires": "Requires: {{plan}}",
    "engineData": "Your data goes to: {{where}}",
    "enginePending": "Not yet cleared for distribution (development only)",
    "start": "Start"
  },
  "chat": {
    "placeholder": "Write a message…",
    "send": "Send",
    "stop": "Stop",
    "working": "Working…",
    "you": "You"
  },
  "activity": {
    "read": "Reading {{detail}}",
    "edit": "Editing {{detail}}",
    "search": "Searching {{detail}}",
    "web": "Looking up {{detail}}",
    "exec": "Running {{detail}}",
    "other": "Working on {{detail}}"
  },
  "history": {
    "title": "History",
    "restore": "Go back to this point",
    "empty": "Nothing yet.",
    "close": "Close"
  },
  "errors": {
    "engine-not-installed": "I can't find {{engine}} on this computer.",
    "session-expired": "Your {{engine}} session ended. Sign in again in the {{engine}} app and retry.",
    "out-of-quota": "You've reached your plan's limit for now. Your conversation is saved; try again later.",
    "agent-crashed": "Something failed and I didn't change anything.",
    "cancelled": "Stopped.",
    "outdated-version": "{{engine}} needs an update.",
    "retry": "Try again"
  }
}
```

`packages/i18n/src/locales/es.json` (rioplatense, same keys):
```json
{
  "setup": {
    "title": "Preparemos {{name}}",
    "language": "Idioma",
    "folder": "Tu carpeta",
    "folderHint": "Acá se guarda tu trabajo.",
    "folderChange": "Elegir otra carpeta",
    "folderWarning": "No muevas, renombres ni edites esta carpeta a mano: la app depende de ella.",
    "engine": "Motor de IA",
    "engineHint": "Usa tu propia cuenta. Asegurate de tener la sesión iniciada en su app en esta compu.",
    "engineRequires": "Necesitás: {{plan}}",
    "engineData": "Tus datos van a: {{where}}",
    "enginePending": "Todavía no habilitado para distribución (solo desarrollo)",
    "start": "Empezar"
  },
  "chat": {
    "placeholder": "Escribí un mensaje…",
    "send": "Enviar",
    "stop": "Detener",
    "working": "Trabajando…",
    "you": "Vos"
  },
  "activity": {
    "read": "Leyendo {{detail}}",
    "edit": "Editando {{detail}}",
    "search": "Buscando {{detail}}",
    "web": "Consultando {{detail}}",
    "exec": "Ejecutando {{detail}}",
    "other": "Trabajando en {{detail}}"
  },
  "history": {
    "title": "Historial",
    "restore": "Volver a este punto",
    "empty": "Todavía no hay nada.",
    "close": "Cerrar"
  },
  "errors": {
    "engine-not-installed": "No encuentro {{engine}} en esta compu.",
    "session-expired": "Se cerró tu sesión de {{engine}}. Volvé a entrar en la app de {{engine}} y reintentá.",
    "out-of-quota": "Llegaste al límite de tu plan por ahora. Tu conversación quedó guardada; probá más tarde.",
    "agent-crashed": "Algo falló y no cambié nada.",
    "cancelled": "Detenido.",
    "outdated-version": "Hace falta actualizar {{engine}}.",
    "retry": "Reintentar"
  }
}
```

- [ ] **Step 3: Failing tests**

`packages/i18n/test/i18n.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CORE_LOCALES, createI18n } from "../src";

function keys(o: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("core locales", () => {
  it("es and en have exactly the same keys", () => {
    expect(keys(CORE_LOCALES.es).sort()).toEqual(keys(CORE_LOCALES.en).sort());
  });
});

describe("createI18n", () => {
  it("translates core keys with interpolation", async () => {
    const i18n = await createI18n("es");
    expect(i18n.t("setup.title", { name: "Demo" })).toBe("Preparemos Demo");
    expect(i18n.t("errors.engine-not-installed", { engine: "Claude" })).toBe("No encuentro Claude en esta compu.");
  });

  it("adds the harness's own strings under the harness namespace, falling back to English", async () => {
    const i18n = await createI18n("es", { es: { title: "Notas" }, en: { title: "Notes", only: "English only" } });
    expect(i18n.t("harness:title")).toBe("Notas");
    expect(i18n.t("harness:only")).toBe("English only");
  });

  it("switches language", async () => {
    const i18n = await createI18n("es");
    await i18n.changeLanguage("en");
    expect(i18n.t("chat.send")).toBe("Send");
  });
});
```
Run: `corepack pnpm vitest run packages/i18n` → FAIL.

- [ ] **Step 4: Implement**

`packages/i18n/src/index.ts`:
```ts
import i18next, { type i18n } from "i18next";
import type { Language } from "@humanharness/harness-sdk";
import en from "./locales/en.json";
import es from "./locales/es.json";

export type Locales = Partial<Record<Language, Record<string, unknown>>>;

export const CORE_LOCALES: Record<Language, Record<string, unknown>> = { es, en };

/** Core strings in the default namespace; the harness's own strings under `harness:`. */
export async function createI18n(language: Language, harnessLocales: Locales = {}): Promise<i18n> {
  const instance = i18next.createInstance();
  await instance.init({
    lng: language,
    fallbackLng: "en",
    defaultNS: "core",
    ns: ["core", "harness"],
    interpolation: { escapeValue: false },
    resources: {
      es: { core: CORE_LOCALES.es, harness: harnessLocales.es ?? {} },
      en: { core: CORE_LOCALES.en, harness: harnessLocales.en ?? {} },
    },
  });
  return instance;
}
```
If TS rejects JSON imports, add `"resolveJsonModule": true` to the root `tsconfig.json`.

- [ ] **Step 5: Verify and commit**

Run: `corepack pnpm vitest run packages/i18n && corepack pnpm typecheck` → PASS (4 tests).
```bash
git add packages/i18n pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json
git commit -m "feat(i18n): core es/en strings and harness namespace"
```

---

### Task 4: UI contract and chat state

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/src/client.ts`, `packages/ui/src/state.ts`, `packages/ui/src/index.ts`, `packages/ui/test/state.test.ts`

- [ ] **Step 1: Package**

`packages/ui/package.json`:
```json
{
  "name": "@humanharness/ui",
  "version": "0.1.0",
  "type": "module",
  "license": "Apache-2.0",
  "exports": { ".": "./src/index.ts", "./styles.css": "./src/styles.css" },
  "dependencies": {
    "@humanharness/harness-sdk": "workspace:*",
    "@humanharness/i18n": "workspace:*",
    "@humanharness/runtime": "workspace:*",
    "i18next": "^26.4.3",
    "react-i18next": "^17.0.16"
  },
  "peerDependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" },
  "devDependencies": {
    "@testing-library/react": "^16.3.3",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "happy-dom": "^20.14.6",
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  }
}
```
(`@humanharness/runtime` is used for its `Event` type only.) Run `corepack pnpm install`.

- [ ] **Step 2: Contract**

`packages/ui/src/client.ts`:
```ts
import type { Language, LocalizedText } from "@humanharness/harness-sdk";
import type { ActivityKind, EngineError, Event, LimitWindow } from "@humanharness/runtime";

export interface AppConfig {
  language?: Language;
  folder?: string;
  engineId?: string;
}

export interface EngineOption {
  id: string;
  name: string;
  status: "allowed" | "pending";
  requires: LocalizedText;
  dataLocation: LocalizedText;
}

export interface AppState {
  harness: { id: string; name: LocalizedText; languages: Language[] };
  config: AppConfig;
  /** Absolute suggested folder (e.g. ~/Documents/Demo). */
  suggestedFolder: string;
  engines: EngineOption[];
}

export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  blocks: { name: string; data: unknown }[];
  activities: { kind: ActivityKind; detail: string }[];
  at: string;
  error?: EngineError;
}

export interface HistoryItem {
  sha: string;
  message: string;
  date: string;
}

/** Everything the renderer can ask the main process. Implemented by the preload as `window.hh`. */
export interface HarnessClient {
  getState(): Promise<AppState>;
  pickFolder(defaultPath: string): Promise<string | null>;
  saveConfig(patch: AppConfig): Promise<AppState>;
  loadChat(): Promise<ChatEntry[]>;
  send(message: string): Promise<void>;
  cancel(): Promise<void>;
  onEvent(listener: (event: Event) => void): () => void;
  history(): Promise<HistoryItem[]>;
  restore(sha: string): Promise<void>;
}

export function isConfigured(config: AppConfig): config is Required<AppConfig> {
  return Boolean(config.language && config.folder && config.engineId);
}

export type { Event, EngineError, LimitWindow };
```

- [ ] **Step 3: Failing state tests**

`packages/ui/test/state.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { type ChatState, initialChat, reduceChat } from "../src/state";

const run = (events: Parameters<typeof reduceChat>[1][], from: ChatState = initialChat([])) => events.reduce(reduceChat, from);

describe("reduceChat", () => {
  it("adds the user's message and starts a live turn", () => {
    const s = run([{ type: "user", text: "hi", at: "2026-10-10T00:00:00Z" }]);
    expect(s.entries.map((e) => [e.role, e.text])).toEqual([["user", "hi"]]);
    expect(s.live).toEqual({ text: "", blocks: [], activities: [] });
  });

  it("streams text, paragraphs, activities and visible blocks into the live turn", () => {
    const s = run([
      { type: "user", text: "hi", at: "t" },
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
      { type: "activity", id: "a", kind: "read", detail: "x.md", state: "start" },
      { type: "activity", id: "a", kind: "read", detail: "x.md", state: "end", error: false },
      { type: "paragraph" },
      { type: "text", delta: "Done" },
      { type: "block", name: "note", data: { title: "T" } },
    ]);
    expect(s.live).toEqual({
      text: "Hello\n\nDone",
      blocks: [{ name: "note", data: { title: "T" } }],
      activities: [{ id: "a", kind: "read", detail: "x.md", done: true, error: false }],
    });
  });

  it("keeps state blocks out of the conversation", () => {
    const s = run([{ type: "user", text: "hi", at: "t" }, { type: "block", name: "progress", data: { percent: 5 } }], {
      ...initialChat([]),
      stateBlocks: new Set(["progress"]),
    });
    expect(s.live?.blocks).toEqual([]);
    expect(s.blockState).toEqual({ progress: { percent: 5 } });
  });

  it("closes the turn into an assistant entry on done, with the error if any", () => {
    const s = run([
      { type: "user", text: "hi", at: "t" },
      { type: "text", delta: "partial" },
      { type: "done", ok: false, error: { code: "out-of-quota" } },
    ]);
    expect(s.live).toBeNull();
    expect(s.entries.at(-1)).toMatchObject({ role: "assistant", text: "partial", error: { code: "out-of-quota" } });
  });

  it("remembers the latest plan limits", () => {
    const windows = [{ kind: "five_hour", utilization: 0.2, resetsAt: "2026-10-10T18:00:00.000Z" }];
    const s = run([{ type: "limits", status: "allowed", windows }]);
    expect(s.limits).toEqual(windows);
  });
});
```
Run: `corepack pnpm vitest run packages/ui` → FAIL.

- [ ] **Step 4: Implement**

`packages/ui/src/state.ts`:
```ts
import type { ChatEntry, Event, LimitWindow } from "./client";

export interface LiveActivity {
  id: string;
  kind: ChatEntry["activities"][number]["kind"];
  detail: string;
  done: boolean;
  error?: boolean;
}

export interface LiveTurn {
  text: string;
  blocks: { name: string; data: unknown }[];
  activities: LiveActivity[];
}

export interface ChatState {
  entries: ChatEntry[];
  live: LiveTurn | null;
  /** Latest data of state-only blocks (e.g. progress). */
  blockState: Record<string, unknown>;
  /** Names of state-only blocks; their events never enter the conversation. */
  stateBlocks: Set<string>;
  limits: LimitWindow[] | null;
}

export type ChatAction = Event | { type: "user"; text: string; at: string } | { type: "loaded"; entries: ChatEntry[] };

export function initialChat(entries: ChatEntry[], stateBlocks: string[] = []): ChatState {
  return { entries, live: null, blockState: {}, stateBlocks: new Set(stateBlocks), limits: null };
}

const newId = () => Math.random().toString(36).slice(2);

export function reduceChat(state: ChatState, action: ChatAction): ChatState {
  const live = state.live;
  switch (action.type) {
    case "loaded":
      return { ...state, entries: action.entries };
    case "user":
      return {
        ...state,
        entries: [...state.entries, { id: newId(), role: "user", text: action.text, blocks: [], activities: [], at: action.at }],
        live: { text: "", blocks: [], activities: [] },
      };
    case "text":
      return live ? { ...state, live: { ...live, text: live.text + action.delta } } : state;
    case "paragraph":
      return live && live.text ? { ...state, live: { ...live, text: `${live.text}\n\n` } } : state;
    case "activity": {
      if (!live) return state;
      if (action.state === "start") {
        const activity: LiveActivity = { id: action.id, kind: action.kind, detail: action.detail, done: false };
        return { ...state, live: { ...live, activities: [...live.activities, activity] } };
      }
      const activities = live.activities.map((a) => (a.id === action.id ? { ...a, done: true, error: action.error } : a));
      return { ...state, live: { ...live, activities } };
    }
    case "block":
      if (state.stateBlocks.has(action.name)) return { ...state, blockState: { ...state.blockState, [action.name]: action.data } };
      return live ? { ...state, live: { ...live, blocks: [...live.blocks, { name: action.name, data: action.data }] } } : state;
    case "limits":
      return { ...state, limits: action.windows };
    case "usage":
      return state;
    case "done": {
      if (!live) return state;
      const entry: ChatEntry = {
        id: newId(),
        role: "assistant",
        text: live.text.trim(),
        blocks: live.blocks,
        activities: live.activities.map(({ kind, detail }) => ({ kind, detail })),
        at: new Date().toISOString(),
        ...(action.ok ? {} : { error: action.error }),
      };
      return { ...state, entries: [...state.entries, entry], live: null };
    }
  }
}
```

`packages/ui/src/index.ts`:
```ts
export * from "./client";
export * from "./state";
```

- [ ] **Step 5: Verify and commit**

Run: `corepack pnpm vitest run packages/ui && corepack pnpm typecheck` → PASS (5 tests).
```bash
git add packages/ui pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(ui): client contract and chat state reducer"
```

---

### Task 5: UI components

**Files:**
- Create: `packages/ui/src/HarnessApp.tsx`, `SetupScreen.tsx`, `ChatView.tsx`, `Message.tsx`, `ActivityList.tsx`, `ErrorCard.tsx`, `HistoryPanel.tsx`, `styles.css`
- Create: `packages/ui/test/fake-client.ts`, `packages/ui/test/HarnessApp.test.tsx`
- Modify: `packages/ui/src/index.ts`

Props of the public component:
```ts
export interface HarnessAppProps {
  client: HarnessClient;
  /** Components for visible blocks, by block name. Each gets `data` and `respond(text)`. */
  blocks?: Record<string, React.ComponentType<BlockProps>>;
  /** Names of state-only blocks (their data goes to `renderSide`). */
  stateBlocks?: string[];
  /** Optional side panel driven by state-only blocks. */
  renderSide?: (blockState: Record<string, unknown>) => React.ReactNode;
  /** The harness's own strings, under the `harness:` namespace. */
  locales?: Locales;
}
export interface BlockProps { data: any; respond: (text: string) => void }
```

- [ ] **Step 1: Fake client**

`packages/ui/test/fake-client.ts`:
```ts
import type { AppConfig, AppState, ChatEntry, Event, HarnessClient, HistoryItem } from "../src/client";

export class FakeClient implements HarnessClient {
  state: AppState;
  sent: string[] = [];
  restored: string[] = [];
  cancelled = 0;
  chat: ChatEntry[] = [];
  items: HistoryItem[] = [{ sha: "abc", message: "Turn: hi", date: "2026-10-10T12:00:00.000Z" }];
  private listeners = new Set<(e: Event) => void>();

  constructor(config: AppConfig = {}) {
    this.state = {
      harness: { id: "demo", name: { es: "Demo", en: "Demo" }, languages: ["es", "en"] },
      config,
      suggestedFolder: "/Users/me/Documents/Demo",
      engines: [
        { id: "claude", name: "Claude", status: "allowed", requires: { es: "Plan Pro", en: "Pro plan" }, dataLocation: { es: "EE. UU.", en: "USA" } },
      ],
    };
  }

  emit(e: Event) {
    for (const l of this.listeners) l(e);
  }

  async getState() {
    return this.state;
  }
  async pickFolder() {
    return "/Users/me/Elsewhere";
  }
  async saveConfig(patch: AppConfig) {
    this.state = { ...this.state, config: { ...this.state.config, ...patch } };
    return this.state;
  }
  async loadChat() {
    return this.chat;
  }
  async send(message: string) {
    this.sent.push(message);
  }
  async cancel() {
    this.cancelled++;
  }
  onEvent(listener: (e: Event) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async history() {
    return this.items;
  }
  async restore(sha: string) {
    this.restored.push(sha);
  }
}
```

- [ ] **Step 2: Failing component tests**

`packages/ui/test/HarnessApp.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { HarnessApp, type BlockProps } from "../src";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const Note = ({ data, respond }: BlockProps) => (
  <div>
    <h3>{data.title}</h3>
    <button onClick={() => respond(`More about ${data.title}`)}>more</button>
  </div>
);

describe("HarnessApp", () => {
  it("shows the setup screen until language, folder and engine are chosen", async () => {
    const client = new FakeClient();
    render(<HarnessApp client={client} />);
    await screen.findByText(/get Demo ready|Preparemos Demo/);
    fireEvent.click(screen.getByRole("button", { name: /Start|Empezar/ }));
    await screen.findByPlaceholderText(/Write a message|Escribí un mensaje/);
    expect(client.state.config).toMatchObject({ folder: "/Users/me/Documents/Demo", engineId: "claude" });
  });

  it("lets the user pick another folder and warns about moving it", async () => {
    const client = new FakeClient({ language: "en" });
    render(<HarnessApp client={client} />);
    await screen.findByText(/Don't move, rename or edit this folder/);
    fireEvent.click(screen.getByRole("button", { name: "Choose another folder" }));
    await screen.findByText("/Users/me/Elsewhere");
  });

  it("sends a message, streams the answer and renders blocks", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} blocks={{ note: Note }} />);
    const input = await screen.findByPlaceholderText("Write a message…");
    fireEvent.change(input, { target: { value: "make a note" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(client.sent).toEqual(["make a note"]));
    act(() => {
      client.emit({ type: "text", delta: "Here it is" });
      client.emit({ type: "block", name: "note", data: { title: "Groceries" } });
      client.emit({ type: "done", ok: true });
    });
    expect(screen.getByText("make a note")).toBeTruthy();
    expect(screen.getByText("Here it is")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Groceries" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "more" }));
    await waitFor(() => expect(client.sent).toEqual(["make a note", "More about Groceries"]));
  });

  it("shows activity while working and a Stop button that cancels", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    const input = await screen.findByPlaceholderText("Write a message…");
    fireEvent.change(input, { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    act(() => client.emit({ type: "activity", id: "a", kind: "read", detail: "notes.md", state: "start" }));
    expect(screen.getByText("Reading notes.md")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(client.cancelled).toBe(1));
  });

  it("shows a translated error card when a turn fails", async () => {
    const client = new FakeClient({ ...ready, language: "es" });
    render(<HarnessApp client={client} />);
    const input = await screen.findByPlaceholderText("Escribí un mensaje…");
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    act(() => client.emit({ type: "done", ok: false, error: { code: "out-of-quota" } }));
    expect(screen.getByText(/Llegaste al límite de tu plan/)).toBeTruthy();
  });

  it("feeds state blocks to the side panel, not the chat", async () => {
    const client = new FakeClient(ready);
    render(
      <HarnessApp
        client={client}
        stateBlocks={["progress"]}
        renderSide={(s) => <p>Progress {(s.progress as { percent: number } | undefined)?.percent ?? 0}%</p>}
      />,
    );
    const input = await screen.findByPlaceholderText("Write a message…");
    fireEvent.change(input, { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    act(() => client.emit({ type: "block", name: "progress", data: { percent: 40 } }));
    expect(screen.getByText("Progress 40%")).toBeTruthy();
  });

  it("lists history and restores a point", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await screen.findByPlaceholderText("Write a message…");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await screen.findByText("Turn: hi");
    fireEvent.click(screen.getByRole("button", { name: "Go back to this point" }));
    await waitFor(() => expect(client.restored).toEqual(["abc"]));
  });

  it("loads the saved conversation", async () => {
    const client = new FakeClient(ready);
    client.chat = [{ id: "1", role: "user", text: "earlier question", blocks: [], activities: [], at: "t" }];
    render(<HarnessApp client={client} />);
    await screen.findByText("earlier question");
  });
});
```
Run: `corepack pnpm vitest run packages/ui` → FAIL.

- [ ] **Step 3: Implement**

`packages/ui/src/ActivityList.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import type { LiveActivity } from "./state";

export function ActivityList({ items }: { items: Pick<LiveActivity, "kind" | "detail" | "done">[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <ul className="hh-activity">
      {items.map((a, i) => (
        <li key={i} className={a.done ? "done" : "running"}>
          {t(`activity.${a.kind}`, { detail: a.detail })}
        </li>
      ))}
    </ul>
  );
}
```

`packages/ui/src/ErrorCard.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import type { EngineError } from "./client";

export function ErrorCard({ error, engine, onRetry }: { error: EngineError; engine: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="hh-error" role="alert">
      <p>{t(`errors.${error.code}`, { engine })}</p>
      {onRetry && error.code !== "cancelled" && <button onClick={onRetry}>{t("errors.retry")}</button>}
    </div>
  );
}
```

`packages/ui/src/Message.tsx`:
```tsx
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { ActivityList } from "./ActivityList";
import type { ChatEntry } from "./client";

export interface BlockProps {
  data: any;
  respond: (text: string) => void;
}

export function Blocks({
  blocks,
  components,
  respond,
}: {
  blocks: ChatEntry["blocks"];
  components: Record<string, ComponentType<BlockProps>>;
  respond: (text: string) => void;
}) {
  return (
    <>
      {blocks.map((b, i) => {
        const Component = components[b.name];
        return Component ? (
          <div key={i} className="hh-block">
            <Component data={b.data} respond={respond} />
          </div>
        ) : null;
      })}
    </>
  );
}

export function Message({
  entry,
  components,
  respond,
}: {
  entry: Pick<ChatEntry, "role" | "text" | "blocks" | "activities">;
  components: Record<string, ComponentType<BlockProps>>;
  respond: (text: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <article className={`hh-message ${entry.role}`}>
      {entry.role === "user" && <span className="hh-who">{t("chat.you")}</span>}
      {entry.role === "assistant" && <ActivityList items={entry.activities.map((a) => ({ ...a, done: true }))} />}
      {entry.text && entry.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>)}
      <Blocks blocks={entry.blocks} components={components} respond={respond} />
    </article>
  );
}
```

`packages/ui/src/HistoryPanel.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, HistoryItem } from "./client";

export function HistoryPanel({ client, onClose }: { client: HarnessClient; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  useEffect(() => {
    void client.history().then(setItems);
  }, [client]);
  return (
    <aside className="hh-history" aria-label={t("history.title")}>
      <header>
        <h2>{t("history.title")}</h2>
        <button onClick={onClose}>{t("history.close")}</button>
      </header>
      {items?.length === 0 && <p>{t("history.empty")}</p>}
      <ol>
        {items?.map((item) => (
          <li key={item.sha}>
            <span>{item.message}</span>
            <time>{new Date(item.date).toLocaleString(i18n.language)}</time>
            <button onClick={() => void client.restore(item.sha).then(onClose)}>{t("history.restore")}</button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
```

`packages/ui/src/SetupScreen.tsx`:
```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import type { AppConfig, AppState, HarnessClient } from "./client";

const LANGUAGE_NAMES: Record<Language, string> = { es: "Español", en: "English" };

export function SetupScreen({ client, state, onDone }: { client: HarnessClient; state: AppState; onDone: (s: AppState) => void }) {
  const { t, i18n } = useTranslation();
  const lang = (state.config.language ?? (i18n.language as Language)) || "en";
  const [folder, setFolder] = useState(state.config.folder ?? state.suggestedFolder);
  const [engineId, setEngineId] = useState(state.config.engineId ?? state.engines[0]?.id);

  const changeLanguage = (language: Language) => {
    void i18n.changeLanguage(language);
    void client.saveConfig({ language });
  };
  const start = async () => {
    const config: AppConfig = { language: lang, folder, engineId };
    onDone(await client.saveConfig(config));
  };

  return (
    <main className="hh-setup">
      <h1>{t("setup.title", { name: state.harness.name[lang] })}</h1>

      <section>
        <h2>{t("setup.language")}</h2>
        {state.harness.languages.map((l) => (
          <label key={l}>
            <input type="radio" name="language" checked={lang === l} onChange={() => changeLanguage(l)} />
            {LANGUAGE_NAMES[l]}
          </label>
        ))}
      </section>

      <section>
        <h2>{t("setup.folder")}</h2>
        <p>{t("setup.folderHint")}</p>
        <code>{folder}</code>
        <button onClick={() => void client.pickFolder(folder).then((f) => f && setFolder(f))}>{t("setup.folderChange")}</button>
        <p className="hh-warning">{t("setup.folderWarning")}</p>
      </section>

      <section>
        <h2>{t("setup.engine")}</h2>
        <p>{t("setup.engineHint")}</p>
        {state.engines.map((e) => (
          <label key={e.id} className="hh-engine">
            <input type="radio" name="engine" checked={engineId === e.id} onChange={() => setEngineId(e.id)} />
            <strong>{e.name}</strong>
            <span>{t("setup.engineRequires", { plan: e.requires[lang] })}</span>
            <span>{t("setup.engineData", { where: e.dataLocation[lang] })}</span>
            {e.status === "pending" && <em>{t("setup.enginePending")}</em>}
          </label>
        ))}
      </section>

      <button className="hh-primary" disabled={!folder || !engineId} onClick={() => void start()}>
        {t("setup.start")}
      </button>
    </main>
  );
}
```

`packages/ui/src/ChatView.tsx`:
```tsx
import { type ComponentType, type FormEvent, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityList } from "./ActivityList";
import type { AppState, HarnessClient } from "./client";
import { ErrorCard } from "./ErrorCard";
import { HistoryPanel } from "./HistoryPanel";
import { type BlockProps, Blocks, Message } from "./Message";
import { initialChat, reduceChat } from "./state";

export function ChatView({
  client,
  state,
  components,
  stateBlocks,
  renderSide,
}: {
  client: HarnessClient;
  state: AppState;
  components: Record<string, ComponentType<BlockProps>>;
  stateBlocks: string[];
  renderSide?: (blockState: Record<string, unknown>) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const [chat, dispatch] = useReducer(reduceChat, undefined, () => initialChat([], stateBlocks));
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const lastUserText = useRef("");
  const engine = state.engines.find((e) => e.id === state.config.engineId)?.name ?? "";

  useEffect(() => {
    void client.loadChat().then((entries) => dispatch({ type: "loaded", entries }));
    return client.onEvent((e) => dispatch(e));
  }, [client]);

  const send = (text: string) => {
    const message = text.trim();
    if (!message || chat.live) return;
    lastUserText.current = message;
    dispatch({ type: "user", text: message, at: new Date().toISOString() });
    void client.send(message);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
    setDraft("");
  };
  const last = chat.entries.at(-1);

  return (
    <div className="hh-app">
      <header className="hh-header">
        <h1>{state.harness.name[state.config.language ?? "en"]}</h1>
        <button onClick={() => setShowHistory(true)}>{t("history.title")}</button>
      </header>
      <div className="hh-body">
        <section className="hh-chat">
          {chat.entries.map((entry) => (
            <div key={entry.id}>
              <Message entry={entry} components={components} respond={send} />
              {entry.error && entry === last && (
                <ErrorCard error={entry.error} engine={engine} onRetry={() => send(lastUserText.current)} />
              )}
            </div>
          ))}
          {chat.live && (
            <article className="hh-message assistant live">
              <ActivityList items={chat.live.activities} />
              {chat.live.text ? chat.live.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>) : <p className="hh-working">{t("chat.working")}</p>}
              <Blocks blocks={chat.live.blocks} components={components} respond={send} />
            </article>
          )}
        </section>
        {renderSide && <aside className="hh-side">{renderSide(chat.blockState)}</aside>}
      </div>
      <form className="hh-composer" onSubmit={onSubmit}>
        <textarea
          placeholder={t("chat.placeholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) onSubmit(e);
          }}
        />
        {chat.live ? (
          <button type="button" onClick={() => void client.cancel()}>
            {t("chat.stop")}
          </button>
        ) : (
          <button type="submit">{t("chat.send")}</button>
        )}
      </form>
      {showHistory && <HistoryPanel client={client} onClose={() => setShowHistory(false)} />}
    </div>
  );
}
```

`packages/ui/src/HarnessApp.tsx`:
```tsx
import { type ComponentType, type ReactNode, useEffect, useState } from "react";
import { I18nextProvider } from "react-i18next";
import type { i18n } from "i18next";
import { type Locales, createI18n } from "@humanharness/i18n";
import { ChatView } from "./ChatView";
import { type AppState, type HarnessClient, isConfigured } from "./client";
import type { BlockProps } from "./Message";
import { SetupScreen } from "./SetupScreen";

export interface HarnessAppProps {
  client: HarnessClient;
  blocks?: Record<string, ComponentType<BlockProps>>;
  stateBlocks?: string[];
  renderSide?: (blockState: Record<string, unknown>) => ReactNode;
  locales?: Locales;
}

export function HarnessApp({ client, blocks = {}, stateBlocks = [], renderSide, locales }: HarnessAppProps) {
  const [state, setState] = useState<AppState | null>(null);
  const [i18n, setI18n] = useState<i18n | null>(null);

  useEffect(() => {
    void client.getState().then(async (s) => {
      const preferred = s.config.language ?? (navigator.language.startsWith("es") ? "es" : "en");
      const language = s.harness.languages.includes(preferred) ? preferred : s.harness.languages[0];
      setI18n(await createI18n(language, locales));
      setState(s);
    });
  }, [client, locales]);

  if (!state || !i18n) return null;
  return (
    <I18nextProvider i18n={i18n}>
      {isConfigured(state.config) ? (
        <ChatView client={client} state={state} components={blocks} stateBlocks={stateBlocks} renderSide={renderSide} />
      ) : (
        <SetupScreen client={client} state={state} onDone={setState} />
      )}
    </I18nextProvider>
  );
}
```

`packages/ui/src/styles.css`:
```css
:root {
  --hh-bg: #fbfaf7;
  --hh-surface: #ffffff;
  --hh-text: #1d1d1b;
  --hh-muted: #6b6a66;
  --hh-accent: #2f5d50;
  --hh-accent-text: #ffffff;
  --hh-border: #e4e1da;
  --hh-error-bg: #fbeaea;
  --hh-radius: 10px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --hh-bg: #161615;
    --hh-surface: #1f1f1d;
    --hh-text: #ecebe7;
    --hh-muted: #a3a29d;
    --hh-accent: #7fb7a4;
    --hh-accent-text: #10201b;
    --hh-border: #33322f;
    --hh-error-bg: #3a2222;
  }
}
body { margin: 0; background: var(--hh-bg); color: var(--hh-text); }
button { font: inherit; border-radius: var(--hh-radius); border: 1px solid var(--hh-border); background: var(--hh-surface); color: var(--hh-text); padding: 6px 12px; cursor: pointer; }
.hh-primary, .hh-composer button[type="submit"] { background: var(--hh-accent); color: var(--hh-accent-text); border-color: transparent; }
.hh-setup { max-width: 640px; margin: 40px auto; padding: 0 16px; display: grid; gap: 24px; }
.hh-setup label { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.hh-warning { color: var(--hh-muted); font-size: 0.9em; }
.hh-app { display: grid; grid-template-rows: auto 1fr auto; height: 100vh; }
.hh-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; border-bottom: 1px solid var(--hh-border); }
.hh-header h1 { font-size: 1.1em; margin: 0; }
.hh-body { display: grid; grid-template-columns: 1fr auto; overflow: hidden; }
.hh-chat { overflow-y: auto; padding: 16px; display: grid; gap: 12px; align-content: start; }
.hh-side { width: 240px; padding: 16px; border-left: 1px solid var(--hh-border); }
.hh-message { max-width: 720px; }
.hh-message.user { justify-self: end; background: var(--hh-surface); border: 1px solid var(--hh-border); border-radius: var(--hh-radius); padding: 8px 12px; }
.hh-who { color: var(--hh-muted); font-size: 0.8em; }
.hh-activity { list-style: none; padding: 0; margin: 0 0 4px; color: var(--hh-muted); font-size: 0.85em; }
.hh-activity .running::after { content: " …"; }
.hh-block { margin: 8px 0; }
.hh-error { background: var(--hh-error-bg); border-radius: var(--hh-radius); padding: 8px 12px; }
.hh-composer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--hh-border); }
.hh-composer textarea { flex: 1; min-height: 44px; resize: vertical; font: inherit; border-radius: var(--hh-radius); border: 1px solid var(--hh-border); background: var(--hh-surface); color: var(--hh-text); padding: 8px; }
.hh-history { position: fixed; inset: 0 0 0 auto; width: min(360px, 100%); background: var(--hh-surface); border-left: 1px solid var(--hh-border); padding: 16px; overflow-y: auto; }
.hh-history li { display: grid; gap: 4px; margin-bottom: 12px; }
.hh-history time { color: var(--hh-muted); font-size: 0.8em; }
@media (max-width: 640px) { .hh-body { grid-template-columns: 1fr; } .hh-side { display: none; } }
```

Replace `packages/ui/src/index.ts`:
```ts
export * from "./client";
export * from "./state";
export { HarnessApp, type HarnessAppProps } from "./HarnessApp";
export type { BlockProps } from "./Message";
```
(The CSS is imported by the app's renderer entry, not by components, so tests don't need a CSS loader.)

- [ ] **Step 4: Verify and commit**

Run: `corepack pnpm vitest run packages/ui` (3 runs) `&& corepack pnpm typecheck` → PASS (13 tests).
```bash
git add packages/ui pnpm-lock.yaml
git commit -m "feat(ui): setup screen, chat, blocks, activity, errors and history"
```

---

### Task 6: shell — config store

**Files:**
- Create: `packages/shell/package.json`, `packages/shell/src/main/config.ts`, `packages/shell/test/config.test.ts`

- [ ] **Step 1: Package**

`packages/shell/package.json`:
```json
{
  "name": "@humanharness/shell",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "Apache-2.0",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build"
  },
  "dependencies": {
    "@agentclientprotocol/codex-acp": "2.2.2",
    "@humanharness/blocks": "workspace:*",
    "@humanharness/engines": "workspace:*",
    "@humanharness/harness-sdk": "workspace:*",
    "@humanharness/runtime": "workspace:*",
    "@humanharness/ui": "workspace:*"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^6.1.2",
    "electron": "^44.7.0",
    "electron-vite": "^5.0.0",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "vite": "^8.3.4"
  }
}
```
Run: `corepack pnpm install`. pnpm 12 blocks build scripts: approve `electron` (it downloads its binary in postinstall) with `corepack pnpm approve-builds electron` if install reports it; add release-age exclusions if needed; mention both.

- [ ] **Step 2: Failing test**

`packages/shell/test/config.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ConfigStore } from "../src/main/config";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("ConfigStore", () => {
  it("starts empty and merges patches to disk", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    const store = new ConfigStore(dir);
    expect(await store.load()).toEqual({});
    await store.save({ language: "es" });
    await store.save({ folder: "/x", engineId: "claude" });
    expect(await new ConfigStore(dir).load()).toEqual({ language: "es", folder: "/x", engineId: "claude" });
  });

  it("never changes the folder once set", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    const store = new ConfigStore(dir);
    await store.save({ folder: "/first" });
    await store.save({ folder: "/second" });
    expect((await store.load()).folder).toBe("/first");
  });

  it("survives a corrupt file", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    fs.writeFileSync(path.join(dir, "config.json"), "{nope");
    expect(await new ConfigStore(dir).load()).toEqual({});
  });
});
```
Run: `corepack pnpm vitest run packages/shell` → FAIL.

- [ ] **Step 3: Implement**

`packages/shell/src/main/config.ts`:
```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppConfig } from "@humanharness/ui";

/** Per-app settings in Electron's userData folder. The folder is fixed once chosen (spec §7). */
export class ConfigStore {
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, "config.json");
  }

  async load(): Promise<AppConfig> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8")) as AppConfig;
    } catch {
      return {};
    }
  }

  async save(patch: AppConfig): Promise<AppConfig> {
    const current = await this.load();
    const next: AppConfig = { ...current, ...patch, ...(current.folder ? { folder: current.folder } : {}) };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(next, null, 2));
    return next;
  }
}
```

- [ ] **Step 4: Verify and commit**

Run: `corepack pnpm vitest run packages/shell && corepack pnpm typecheck` → PASS (3 tests).
```bash
git add packages/shell pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(shell): per-app config store"
```

---

### Task 7: shell — chat log

**Files:**
- Create: `packages/shell/src/main/chat-log.ts`, `packages/shell/test/chat-log.test.ts`

The conversation lives in the user's folder (`.harness/chats/main.jsonl`), one JSON entry per line; the main process records each turn from the runtime events.

- [ ] **Step 1: Failing test**

`packages/shell/test/chat-log.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ChatLog, TurnRecorder } from "../src/main/chat-log";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("TurnRecorder", () => {
  it("builds the assistant entry from runtime events", () => {
    const r = new TurnRecorder(new Set(["progress"]));
    r.add({ type: "text", delta: "Hello" });
    r.add({ type: "activity", id: "a", kind: "edit", detail: "x.md", state: "start" });
    r.add({ type: "paragraph" });
    r.add({ type: "text", delta: "Done" });
    r.add({ type: "block", name: "note", data: { title: "T" } });
    r.add({ type: "block", name: "progress", data: { percent: 5 } });
    const entry = r.finish({ type: "done", ok: true });
    expect(entry).toMatchObject({
      role: "assistant",
      text: "Hello\n\nDone",
      blocks: [{ name: "note", data: { title: "T" } }],
      activities: [{ kind: "edit", detail: "x.md" }],
    });
    expect(entry.error).toBeUndefined();
  });

  it("records the error of a failed turn", () => {
    const r = new TurnRecorder(new Set());
    expect(r.finish({ type: "done", ok: false, error: { code: "agent-crashed" } }).error).toEqual({ code: "agent-crashed" });
  });
});

describe("ChatLog", () => {
  it("appends and loads entries in order", async () => {
    const folder = fs.mkdtempSync(path.join(root, "f-"));
    const log = new ChatLog(folder);
    await log.append({ id: "1", role: "user", text: "hi", blocks: [], activities: [], at: "t1" });
    await log.append({ id: "2", role: "assistant", text: "hello", blocks: [], activities: [], at: "t2" });
    expect((await new ChatLog(folder).load()).map((e) => e.text)).toEqual(["hi", "hello"]);
    expect(fs.existsSync(path.join(folder, ".harness", "chats", "main.jsonl"))).toBe(true);
  });

  it("skips broken lines and returns the last N", async () => {
    const folder = fs.mkdtempSync(path.join(root, "f-"));
    fs.mkdirSync(path.join(folder, ".harness", "chats"), { recursive: true });
    fs.writeFileSync(
      path.join(folder, ".harness", "chats", "main.jsonl"),
      ['{"id":"1","role":"user","text":"a","blocks":[],"activities":[],"at":"t"}', "{broken", '{"id":"2","role":"user","text":"b","blocks":[],"activities":[],"at":"t"}'].join("\n") + "\n",
    );
    expect((await new ChatLog(folder).load(1)).map((e) => e.text)).toEqual(["b"]);
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement**

`packages/shell/src/main/chat-log.ts`:
```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Event } from "@humanharness/runtime";
import type { ChatEntry } from "@humanharness/ui";

export class ChatLog {
  private readonly file: string;

  constructor(folder: string) {
    this.file = path.join(folder, ".harness", "chats", "main.jsonl");
  }

  async append(entry: ChatEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.appendFile(this.file, JSON.stringify(entry) + "\n");
  }

  async load(limit = 200): Promise<ChatEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch {
      return [];
    }
    const entries: ChatEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as ChatEntry);
      } catch {
        // skip a broken line
      }
    }
    return entries.slice(-limit);
  }
}

/** Accumulates one turn's events into the assistant entry that gets saved. */
export class TurnRecorder {
  private text = "";
  private blocks: ChatEntry["blocks"] = [];
  private activities: ChatEntry["activities"] = [];

  constructor(private readonly stateBlocks: Set<string>) {}

  add(e: Event): void {
    if (e.type === "text") this.text += e.delta;
    else if (e.type === "paragraph" && this.text) this.text += "\n\n";
    else if (e.type === "activity" && e.state === "start") this.activities.push({ kind: e.kind, detail: e.detail });
    else if (e.type === "block" && !this.stateBlocks.has(e.name)) this.blocks.push({ name: e.name, data: e.data });
  }

  finish(done: Extract<Event, { type: "done" }>): ChatEntry {
    return {
      id: randomUUID(),
      role: "assistant",
      text: this.text.trim(),
      blocks: this.blocks,
      activities: this.activities,
      at: new Date().toISOString(),
      ...(done.ok ? {} : { error: done.error }),
    };
  }
}
```

- [ ] **Step 3: Verify and commit**

Run: `corepack pnpm vitest run packages/shell && corepack pnpm typecheck` → PASS.
```bash
git add packages/shell
git commit -m "feat(shell): chat log in the user's folder"
```

---

### Task 8: shell — engine command resolution

**Files:**
- Create: `packages/shell/src/main/engine-command.ts`, `packages/shell/test/engine-command.test.ts`

GUI apps on macOS start with a minimal `PATH`, so `claude` is not found by name. The login shell knows the user's real `PATH`. Codex runs the adapter that ships with the app.

- [ ] **Step 1: Failing test**

`packages/shell/test/engine-command.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type CommandDeps, engineCommand, loginShellPath, resolveBinary } from "../src/main/engine-command";

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
```
Run → FAIL.

- [ ] **Step 2: Implement**

`packages/shell/src/main/engine-command.ts`:
```ts
import path from "node:path";
import type { EngineDef } from "@humanharness/engines";

export interface CommandDeps {
  shell: string;
  home: string;
  run: (cmd: string, args: string[]) => Promise<{ stdout: string; code: number }>;
  isExecutable: (file: string) => Promise<boolean>;
  electronPath: string;
  resolveModule: (id: string) => string;
}

/** Bundled ACP adapters, by the npm package the engine's command names. */
const BUNDLED_ADAPTERS: Record<string, string> = {
  "@agentclientprotocol/codex-acp": "@agentclientprotocol/codex-acp/dist/index.js",
};

export async function loginShellPath(d: CommandDeps): Promise<string> {
  try {
    const { stdout, code } = await d.run(d.shell, ["-ilc", 'printf "%s" "$PATH"']);
    if (code === 0 && stdout.trim()) return stdout.trim().split("\n").pop()!;
  } catch {
    // fall through
  }
  return [path.join(d.home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");
}

export async function resolveBinary(name: string, searchPath: string, d: CommandDeps): Promise<string | null> {
  for (const dir of searchPath.split(":").filter(Boolean)) {
    const candidate = path.join(dir, name);
    if (await d.isExecutable(candidate)) return candidate;
  }
  return null;
}

/** How the app starts an engine. Null when the CLI isn't installed. Never adds credentials. */
export async function engineCommand(
  engine: EngineDef,
  d: CommandDeps,
): Promise<{ command: string[]; env: Record<string, string> } | null> {
  const PATH = await loginShellPath(d);
  if (engine.transport.kind === "claude-cli") {
    const binary = await resolveBinary(engine.transport.binary, PATH, d);
    return binary ? { command: [binary], env: { PATH } } : null;
  }
  const pkg = engine.transport.command.find((part) => part.replace(/@[^@/]+$/, "") in BUNDLED_ADAPTERS);
  if (pkg) {
    const entry = d.resolveModule(BUNDLED_ADAPTERS[pkg.replace(/@[^@/]+$/, "")]);
    return { command: [d.electronPath, entry], env: { PATH, ELECTRON_RUN_AS_NODE: "1" } };
  }
  const [binaryName, ...args] = engine.transport.command;
  const binary = await resolveBinary(binaryName, PATH, d);
  return binary ? { command: [binary, ...args], env: { PATH } } : null;
}
```

- [ ] **Step 3: Verify and commit**

Run: `corepack pnpm vitest run packages/shell && corepack pnpm typecheck` → PASS.
```bash
git add packages/shell
git commit -m "feat(shell): resolve engine commands for a GUI app"
```

---

### Task 9: shell — main process and preload

**Files:**
- Create: `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`

No unit tests (needs Electron); exercised in Task 11.

- [ ] **Step 1: Main process**

`packages/shell/src/main/index.ts`:
```ts
import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, app, dialog, ipcMain } from "electron";
import { electronLauncher } from "@humanharness/blocks";
import { availableEngines, getEngine } from "@humanharness/engines";
import { type LoadedHarness, loadHarness } from "@humanharness/harness-sdk";
import { type HarnessRuntime, type RunningTurn, createRuntime, fail } from "@humanharness/runtime";
import { type AppConfig, type AppState, isConfigured } from "@humanharness/ui";
import { ChatLog, TurnRecorder } from "./chat-log";
import { ConfigStore } from "./config";
import { type CommandDeps, engineCommand } from "./engine-command";

declare const __HARNESS_DIR__: string;

const requireFromHere = createRequire(import.meta.url);
const commandDeps: CommandDeps = {
  shell: process.env.SHELL || "/bin/zsh",
  home: os.homedir(),
  run: (cmd, args) =>
    new Promise((resolve) => {
      execFile(cmd, args, { timeout: 5000 }, (err, stdout) => resolve({ stdout: String(stdout), code: err ? 1 : 0 }));
    }),
  isExecutable: (file) => fs.access(file, constants.X_OK).then(() => true, () => false),
  electronPath: process.execPath,
  resolveModule: (id) => requireFromHere.resolve(id),
};

let harness: LoadedHarness;
let config: ConfigStore;
let runtime: HarnessRuntime | null = null;
let current: RunningTurn | null = null;
let window: BrowserWindow | null = null;

const mode = () => (app.isPackaged ? "distribution" : "development");
const stateBlocks = () => new Set(Object.entries(harness.blocks).filter(([, b]) => !b.visible).map(([n]) => n));

async function appState(): Promise<AppState> {
  return {
    harness: { id: harness.id, name: harness.name, languages: harness.languages },
    config: await config.load(),
    suggestedFolder: path.join(os.homedir(), harness.folder.suggested),
    engines: availableEngines(harness.engines, mode()).map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status as "allowed" | "pending",
      requires: e.requires,
      dataLocation: e.dataLocation,
    })),
  };
}

async function ensureRuntime(c: Required<AppConfig>): Promise<HarnessRuntime | null> {
  if (runtime) return runtime;
  const engine = getEngine(c.engineId);
  const cmd = await engineCommand(engine, commandDeps);
  if (!cmd) return null;
  runtime = await createRuntime({
    harness,
    engine,
    folder: c.folder,
    gitdir: path.join(app.getPath("userData"), "history"),
    language: c.language,
    launcher: electronLauncher(process.execPath),
    uiServerEntry: path.join(__dirname, "ui-server.js"),
    command: cmd.command,
    env: cmd.env,
  });
  return runtime;
}

function emit(event: unknown) {
  window?.webContents.send("hh:event", event);
}

function registerIpc() {
  ipcMain.handle("hh:getState", () => appState());
  ipcMain.handle("hh:pickFolder", async (_e, defaultPath: string) => {
    const result = await dialog.showOpenDialog(window!, { defaultPath, properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("hh:saveConfig", async (_e, patch: AppConfig) => {
    await config.save(patch);
    return appState();
  });
  ipcMain.handle("hh:loadChat", async () => {
    const c = await config.load();
    return c.folder ? new ChatLog(c.folder).load() : [];
  });
  ipcMain.handle("hh:send", async (_e, message: string) => {
    const c = await config.load();
    if (!isConfigured(c) || current) return;
    const log = new ChatLog(c.folder);
    await log.append({ id: crypto.randomUUID(), role: "user", text: message, blocks: [], activities: [], at: new Date().toISOString() });
    const recorder = new TurnRecorder(stateBlocks());
    let rt: HarnessRuntime | null;
    try {
      rt = await ensureRuntime(c);
    } catch (e) {
      rt = null;
      const done = fail("agent-crashed", (e as Error).message);
      emit(done);
      await log.append(recorder.finish(done as Extract<typeof done, { type: "done" }>));
      return;
    }
    if (!rt) {
      const done = fail("engine-not-installed");
      emit(done);
      await log.append(recorder.finish(done as Extract<typeof done, { type: "done" }>));
      return;
    }
    current = rt.send(message, (e) => {
      emit(e);
      if (e.type === "done") void log.append(recorder.finish(e));
      else recorder.add(e);
    });
    await current.done;
    current = null;
  });
  ipcMain.handle("hh:cancel", () => current?.cancel());
  ipcMain.handle("hh:history", async () =>
    runtime ? (await runtime.history.list()).map((h) => ({ ...h, date: h.date.toISOString() })) : [],
  );
  ipcMain.handle("hh:restore", async (_e, sha: string) => {
    if (runtime && !current) await runtime.history.restore(sha, "Went back to an earlier point");
  });
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1100,
    height: 760,
    title: harness.name.en,
    webPreferences: { preload: path.join(__dirname, "../preload/index.mjs"), contextIsolation: true, sandbox: false },
  });
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await window.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  harness = await loadHarness(path.join(__dirname, "harness.js"), { root: __HARNESS_DIR__ });
  config = new ConfigStore(app.getPath("userData"));
  registerIpc();
  await createWindow();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (!runtime) return;
  event.preventDefault();
  const r = runtime;
  runtime = null;
  void r.close().finally(() => app.quit());
});
```
Notes for the implementer: `__dirname` is provided by electron-vite's CJS/ESM output for main (if the build is ESM and `__dirname` is undefined, use `path.dirname(fileURLToPath(import.meta.url))`); the preload output file name may be `index.js` or `index.mjs` depending on the electron-vite 5 defaults — use what the build produces. `fail` is exported by `@humanharness/runtime` (`events.ts`).

- [ ] **Step 2: Preload**

`packages/shell/src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from "electron";
import type { HarnessClient } from "@humanharness/ui";

const client: HarnessClient = {
  getState: () => ipcRenderer.invoke("hh:getState"),
  pickFolder: (defaultPath) => ipcRenderer.invoke("hh:pickFolder", defaultPath),
  saveConfig: (patch) => ipcRenderer.invoke("hh:saveConfig", patch),
  loadChat: () => ipcRenderer.invoke("hh:loadChat"),
  send: (message) => ipcRenderer.invoke("hh:send", message),
  cancel: () => ipcRenderer.invoke("hh:cancel"),
  onEvent: (listener) => {
    const handler = (_e: unknown, event: Parameters<typeof listener>[0]) => listener(event);
    ipcRenderer.on("hh:event", handler);
    return () => ipcRenderer.removeListener("hh:event", handler);
  },
  history: () => ipcRenderer.invoke("hh:history"),
  restore: (sha) => ipcRenderer.invoke("hh:restore", sha),
};

contextBridge.exposeInMainWorld("hh", client);
```
Note: `hh:send` resolves when the turn ends; the renderer doesn't await it for streaming (events arrive via `onEvent`).

- [ ] **Step 3: Typecheck and commit**

Run: `corepack pnpm typecheck` → clean (fix only type-level mismatches with the real Electron types).
```bash
git add packages/shell
git commit -m "feat(shell): Electron main process and preload bridge"
```

---

### Task 10: shell — renderer, build config and the demo harness UI

**Files:**
- Create: `packages/shell/electron.vite.config.ts`, `packages/shell/src/renderer/index.html`, `packages/shell/src/renderer/main.tsx`, `packages/shell/src/renderer/env.d.ts`
- Create: `harnesses/demo/ui/App.tsx`, `harnesses/demo/ui/NoteCard.tsx`, `harnesses/demo/locales/es.json`, `harnesses/demo/locales/en.json`
- Modify: `harnesses/demo/package.json`

- [ ] **Step 1: Demo UI**

`harnesses/demo/package.json` — add dependencies `"@humanharness/ui": "workspace:*"`, `"react": "^19.3.0"`, and devDependency `"@types/react": "^19.3.0"`. Run `corepack pnpm install`.

`harnesses/demo/locales/en.json`:
```json
{ "progress": "Progress: {{percent}}%", "noteTitle": "Note" }
```
`harnesses/demo/locales/es.json`:
```json
{ "progress": "Progreso: {{percent}} %", "noteTitle": "Nota" }
```

`harnesses/demo/ui/NoteCard.tsx`:
```tsx
import type { BlockProps } from "@humanharness/ui";
import { useTranslation } from "react-i18next";

export function NoteCard({ data }: BlockProps) {
  const { t } = useTranslation("harness");
  return (
    <section className="demo-note" aria-label={t("noteTitle")}>
      <h3>{data.title}</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>{data.body}</p>
    </section>
  );
}
```
(add `"react-i18next": "^17.0.16"` to the demo's dependencies.)

`harnesses/demo/ui/App.tsx`:
```tsx
import { type HarnessClient, HarnessApp } from "@humanharness/ui";
import { useTranslation } from "react-i18next";
import en from "../locales/en.json";
import es from "../locales/es.json";
import { NoteCard } from "./NoteCard";

function Progress({ percent }: { percent: number }) {
  const { t } = useTranslation("harness");
  return <p>{t("progress", { percent })}</p>;
}

const locales = { es, en };

export default function App({ client }: { client: HarnessClient }) {
  return (
    <HarnessApp
      client={client}
      blocks={{ note: NoteCard }}
      stateBlocks={["progress"]}
      renderSide={(s) => <Progress percent={(s.progress as { percent?: number } | undefined)?.percent ?? 0} />}
      locales={locales}
    />
  );
}
```

- [ ] **Step 2: Renderer entry**

`packages/shell/src/renderer/index.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" />
    <title>Human Harness</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`packages/shell/src/renderer/env.d.ts`:
```ts
import type { HarnessClient } from "@humanharness/ui";

declare global {
  interface Window {
    hh: HarnessClient;
  }
}
declare module "@harness/ui" {
  import type { ComponentType } from "react";
  const App: ComponentType<{ client: HarnessClient }>;
  export default App;
}
export {};
```

`packages/shell/src/renderer/main.tsx`:
```tsx
import { createRoot } from "react-dom/client";
import App from "@harness/ui";
import "@humanharness/ui/styles.css";

createRoot(document.getElementById("root")!).render(<App client={window.hh} />);
```

- [ ] **Step 3: Build config**

`packages/shell/electron.vite.config.ts` (check the electron-vite 5 docs with context7 for the exact option that keeps `@humanharness/*` bundled instead of externalized — those packages ship TypeScript source):
```ts
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const harnessDir = path.resolve(process.env.HH_HARNESS_DIR ?? path.join(__dirname, "../../harnesses/demo"));
const bundled = [/^@humanharness\//];

export default defineConfig({
  main: {
    define: { __HARNESS_DIR__: JSON.stringify(harnessDir) },
    build: {
      // keep workspace packages bundled (TS source); externalize the rest
      externalizeDeps: { exclude: ["@humanharness/blocks", "@humanharness/engines", "@humanharness/harness-sdk", "@humanharness/runtime", "@humanharness/workspace", "@humanharness/ui"] },
      rollupOptions: {
        input: {
          index: path.join(__dirname, "src/main/index.ts"),
          "ui-server": path.join(__dirname, "../blocks/src/ui-server-bin.ts"),
          harness: path.join(harnessDir, "harness.config.ts"),
        },
      },
    },
  },
  preload: {
    build: { externalizeDeps: { exclude: ["@humanharness/ui"] }, rollupOptions: { input: { index: path.join(__dirname, "src/preload/index.ts") } } },
  },
  renderer: {
    root: path.join(__dirname, "src/renderer"),
    plugins: [react()],
    resolve: { alias: { "@harness/ui": path.join(harnessDir, "ui/App.tsx") } },
    build: { rollupOptions: { input: path.join(__dirname, "src/renderer/index.html") } },
  },
});
```
`bundled` is a hint for whichever option electron-vite 5 actually uses (older versions: `plugins: [externalizeDepsPlugin({ exclude: [...] })]`); adapt to the real API and remove unused variables. `harness.js` must keep its `default` export (it's loaded with `import()` by the main process and the ui server).

- [ ] **Step 4: Build**

Run: `corepack pnpm app:build`
Expected: `packages/shell/out/main/{index,ui-server,harness}.js`, `out/preload/index.*`, `out/renderer/index.html`. Run `node -e "import('./packages/shell/out/main/harness.js').then(m => console.log(Object.keys(m.default.blocks)))"` → `[ 'note', 'progress' ]`. Fix build config until both hold.

- [ ] **Step 5: Typecheck, tests, commit**

Run: `corepack pnpm typecheck && corepack pnpm test` → green.
```bash
git add packages/shell harnesses/demo pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(shell): renderer, build config and the demo harness UI"
```

---

### Task 11: Run the app for real

- [ ] **Step 1: Fresh start**

Remove any previous dev config: Electron's userData for the dev app (print it with a one-off `console.log(app.getPath("userData"))` if unsure; don't commit that). Then:
Run: `corepack pnpm app:dev`
Expected: a window with the setup screen in the OS language.

- [ ] **Step 2: Walk the happy path with Claude**

1. Choose Español, keep the suggested folder (`~/Documents/Human Harness Demo`), choose Claude, Empezar.
2. Send "Hacé una nota que se llame Compras con leche y pan."
3. Expected: activity lines while working, streamed text, a rendered note card (title + body), the side panel showing "Progreso: … %", no error card. `~/Documents/Human Harness Demo/notes/` has the note; `.harness/chats/main.jsonl` has both entries.
4. Quit and reopen: the conversation is still there, no setup screen.
5. Historial → the list shows "Turn: Hacé una nota…" and "Start"; "Volver a este punto" on "Start" removes the note file from the folder.
6. Send another message and press Detener while it's working → "Detenido." card; the app stays usable.

- [ ] **Step 3: Codex**

Reset the dev config (delete the userData `config.json`), choose Codex in setup, repeat step 2.2–2.3 with a new folder (the folder is fixed per config, so pick a different one via "Elegir otra carpeta").

- [ ] **Step 4: Record and commit**

Write `docs/spikes/2026-10-10-desktop-app.md` with what worked and every problem found (exact error text). Fix only blockers that stop the happy path (within this task's files); list the rest as follow-ups. Commit:
```bash
git add docs/spikes/2026-10-10-desktop-app.md packages/shell
git commit -m "docs: desktop app end-to-end results"
```

---

## Done when

- `corepack pnpm test` and `corepack pnpm typecheck` pass.
- `corepack pnpm app:build` produces a working bundle; `corepack pnpm app:dev` opens the demo harness, completes setup, runs real turns with Claude and with Codex, renders blocks and the side panel, persists the chat, restores history and cancels.
- Results recorded in `docs/spikes/2026-10-10-desktop-app.md`.
