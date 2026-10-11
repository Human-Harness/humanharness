# Human Harness — Plan 2b: Onboarding and usage

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app looks like a native macOS app (Home screen, Settings sheet, restyled work screen) and a non-technical user can get an engine ready from inside it — legal notice and acceptance, install (Claude), sign in, update when too old, a test prompt — and always sees where they stand on their plan: an engine pill with usage on Home, a meter on the work screen, details in Settings → Usage, a local `usage.jsonl`, a warning before heavy harness actions and the reset time when they run out.

**Architecture:** Engine setup data (official install command, login/status/update/logout args, provider, logo file, whether it reports limits) lives in `packages/engines`; the manifest gains `actions` with cost hints, `tagline` and `logo`. The shell gets small plain-Node modules, each unit-tested: a shared store at `~/.humanharness/engines.json`, engine detection (installed / version / signed in), a runner for the official install, update, login and logout processes, a test prompt over the existing transports, a usage log and an engine-switch rule; then the main process is wired (IPC, hiddenInset window, appearance, logos as data URLs). The UI kit is rebuilt on design tokens: `Home`, a `SettingsSheet` with General / Engine / Usage tabs (onboarding runs from the Engine tab), and the 2a chat as the work screen with a pre-flight dialog and fixable error cards. Everything goes through the `HarnessClient` contract, whose non-React part moves to `@humanharness/ui/client` so the main process no longer bundles React.

**Tech Stack:** plan 2a's (Electron 44, electron-vite 5, React 19, i18next 26, Vitest 5 + happy-dom) plus `@fontsource/lexend` 5.3.0 (OFL-1.1) for the display font, bundled into the renderer (no network fonts).

Specs: `docs/superpowers/specs/2026-10-10-humanharness-core-design.md` (§5 engines and compliance, §6 usage awareness and errors, §9 onboarding) and `docs/superpowers/specs/2026-10-11-app-look-design.md` (window, screens, tokens, engine logos; mockups linked there). Roadmap: `docs/superpowers/plans/2026-10-10-00-roadmap.md`. Previous plan: `docs/superpowers/plans/2026-10-10-02a-desktop-app.md`. Results of 2a: `docs/spikes/2026-10-10-desktop-app.md`.

---

## Conventions

- Same as plans 1 and 2a: English everywhere; packages export TS source; extensionless imports; tests in `packages/<name>/test/`; `corepack pnpm …` (pnpm is not on PATH); one commit per task, ending with the session trailers from your system reminder.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line.
- **Compliance (spec §5), restated for this plan's new code:** never read `~/.claude`, `~/.codex` or `~/.gemini`; never pass, inject or strip credentials or auth environment variables; never patch a CLI. The only env the app adds to child processes is `PATH` and `ELECTRON_RUN_AS_NODE=1`. Login always runs the provider's own CLI flow. `claude auth status` prints the account email and org: the app reads **only** `loggedIn` from it and never logs or stores that output. `~/.humanharness/` is ours and never holds credentials.
- Look and feel follow `2026-10-11-app-look-design.md`: colours only through the `--hh-*` tokens defined in Task 11, system font for UI text at 13 px, Lexend only for display text (harness name, wordmark, top-bar title). Every interactive element inside `.hh-topbar` must stay `-webkit-app-region: no-drag` (the CSS does it for `button`, `a`, `input`).
- UI tests find elements by role and visible text, as in 2a. Screens are reached the way a user reaches them (Home → Start, gear → Settings).
- Electron main code that needs a real window is verified manually (Task 17); everything else has unit tests.

## Verified CLI facts (2026-10-11, this machine)

Read-only commands, run while writing this plan. Executors: rely on these; do not log out or touch credentials to re-check them.

| Command | Result |
|---|---|
| `claude --version` | `2.1.296 (Claude Code)`, exit 0. Binary `~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.296` (native installer) |
| `claude auth status --json` (JSON is also the default; `--text` exists) | Signed in: exit **0**, stdout `{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", …, "email": …, "orgId": …, "orgName": …, "subscriptionType": "max"}`. Signed out (checked with an empty config dir): exit **1**, stdout `{"loggedIn": false, "authMethod": "none", "apiProvider": "firstParty", …}`, nothing on stderr |
| `claude auth login --help` | `Sign in to your Anthropic account`; options `--claudeai` (default, subscription), `--console`, `--sso`, `--email <email>`. Behaviour without a TTY is **not verified** (it would need signing out): Task 17 checks it |
| `claude update` | Official self-update (`claude install [target]` also exists) |
| Official Claude install (code.claude.com/docs/en/setup) | `curl -fsSL https://claude.ai/install.sh \| bash` → launcher at `~/.local/bin/claude`. Alternatives: `brew install --cask claude-code`, `npm install -g @anthropic-ai/claude-code` |
| `codex --version` | `codex-cli 0.160.1` (Homebrew cask, `/opt/homebrew/bin/codex`) |
| `codex login status` | Signed in: exit **0**, `Logged in using ChatGPT` on **stderr** (stdout empty). Signed out (checked with an empty `CODEX_HOME`): exit **1**, `Not logged in` on stderr. → read the exit code only |
| `codex login --help` | Browser ChatGPT flow by default; `--device-auth`; `--with-api-key` / `--with-access-token` exist and are never used |
| Official Codex install (learn.chatgpt.com/docs/codex/cli) | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` (→ releases.openai.com) installs to `~/.local/bin`, adds a PATH block to the shell profile, no sudo, prompts only on a TTY. Also npm `@openai/codex`, brew cask `codex` |
| Bundled Codex CLI | `@agentclientprotocol/codex-acp@2.2.2` (already a `shell` dependency) depends on the official `@openai/codex@0.160.1`. `node <…>/@openai/codex/bin/codex.js login status` → `Logged in using ChatGPT`, exit 0; `--version` → `codex-cli 0.160.1`. Resolve it with `createRequire(<codex-acp entry>).resolve("@openai/codex/bin/codex.js")` |
| Claude `rate_limit_event` timing (spike logs) | Arrives mid-turn after the first API response, so it is a snapshot taken during the turn |

## Scope decisions

- **Codex uses the CLI bundled with its adapter** (the same official Codex the adapter runs) for version, status and login, run with Electron's Node. So Codex never needs installing from the app; its official install command stays in the engine data for reference and builds without the bundle. Claude is installed with its official command.
- **Login without an embedded terminal.** The app spawns the CLI's own login (`claude auth login`, `codex login`), which opens the browser. It streams the CLI's output (under "Details"), shows the first web address it prints as a link, and offers a field to paste a code if the sign-in page shows one. If Task 17 shows `claude auth login` needs a real terminal, that is recorded as a follow-up (spec §9 mentions an embedded terminal).
- **Order of setup steps** (each derived from a status check, never from a local flag): legal notice → install → update (below `detect.minVersion`) → sign in → test prompt → ready.
- **Legal notice** is accepted once per computer and engine, with a `NOTICE_VERSION`; bumping it asks again. It lives in `~/.humanharness/engines.json` with the detected binary path, version and the last successful test. Writes are atomic and re-read the file first; two apps writing at the same moment can still lose one update (accepted).
- **Every start:** the app opens on Home; the engine check runs in the background and its result shows in the engine pill (connected / not connected). On the work screen a problem shows as an error card whose button opens Settings → Engine at the step that fixes it. The runtime also refuses to start an outdated or signed-out engine and ends the turn with `outdated-version` / `session-expired`.
- **Usage:** Claude shows the five-hour and seven-day windows (percent used, five-hour reset time); Codex shows "doesn't report your plan's limits" plus the last reply's tokens. Warnings at 80 % and 95 % use the `warn` token. Out-of-quota cards show when the fullest window resets. Home's pill shows the short form ("5 h · 42 %"); Settings → Usage shows every window and each action's cost hint and measured estimate.
- **Pre-flight:** only for actions declared `heavy`, only when the engine reports a five-hour window, and only when `utilization + estimate ≥ 80 %`. The estimate is the mean rise of the five-hour window across earlier turns of that action in `usage.jsonl` (rough: other use of the same account counts too); before there is one, 10 % is assumed and the dialog uses the "can use a large part" wording.
- **Engine switch:** pick another tile in Settings → Engine, finish its setup, press "Use <engine>". When the chat next loads and `.harness/session.json` belongs to another engine, the chat file moves to `.harness/chats/archive/` and `session.json` is deleted; the new chat starts with a notice.
- **Look (spec `2026-10-11-app-look-design.md`):** `hiddenInset` title bar with a 52 px drag region; Home on every launch; the Settings sheet replaces 2a's `SetupScreen`. First launch: Start opens Settings on the Engine tab, which first asks for the folder (language is preselected from the OS and changeable in General); when the engine is ready the sheet closes and the work screen opens. Light tokens from the spec plus a dark set (cheap: tokens only), switched by Settings → General → Appearance through Electron's `nativeTheme.themeSource`. Lexend from `@fontsource/lexend`, bundled.
- **Logos:** engine logos are files in `packages/engines/assets/` (neutral placeholders now; the official Claude and OpenAI assets replace them after checking each provider's brand guidelines — part of the legal gate). The harness logo comes from the manifest; the default is the Human Harness H drawn as an inline SVG component (a vector approximation of `hh.logo.jpeg`, to be replaced by the designer's file). The main process sends logos to the renderer as `data:` URLs, so the renderer's CSP stays unchanged.
- **Manifest:** new optional `tagline` and `logo`; "made by" and Support reuse the existing `author` and `donate` fields rather than adding `developer` / `donationUrl`.
- **Out of scope:** the screen explaining what each plan tier allows for a harness (needs the harness's own copy: plan 3), a redesign of the work screen (only restyled), packaging/signing (incl. copying engine assets into a packaged app), Windows/Linux, website.

## File map

```
packages/engines/src/index.ts, package.json, assets/{claude,codex}.svg   (Task 1)
packages/harness-sdk/src/index.ts               (Task 1: actions, tagline, logo)
packages/ui/
  package.json                                  (Task 2: "./client" export)
  src/client.ts                                 (Task 2: 2b contract, engineProblem)
  src/state.ts, src/usage.ts                    (Task 10)
  src/styles.css, src/chrome.tsx                (Task 11: tokens, TopBar, Segmented, icons, HHLogo)
  src/FolderStep.tsx, src/EngineOnboarding.tsx, src/EngineTab.tsx  (Task 12)
  src/SettingsSheet.tsx                         (Task 13: sheet, General and Usage tabs)
  src/Home.tsx, src/HarnessApp.tsx              (Task 14; src/SetupScreen.tsx deleted)
  src/ChatView.tsx, src/UsageMeter.tsx, src/ErrorCard.tsx, src/Message.tsx  (Task 15)
  test/*.test.ts(x), test/fake-client.ts, test/render.tsx
packages/i18n/src/locales/{en,es}.json          (Task 3)
packages/shell/
  package.json                                  (Task 7: fake-agent; Task 9: @fontsource/lexend)
  src/main/shared-config.ts                     (Task 4: ~/.humanharness/engines.json)
  src/main/engine-command.ts, engine-status.ts  (Task 5)
  src/main/setup-runner.ts                      (Task 6)
  src/main/engine-check.ts                      (Task 7)
  src/main/chat-log.ts, turn-controller.ts, usage-log.ts, engine-switch.ts  (Task 8)
  src/main/assets.ts, validate.ts, index.ts, src/preload/index.ts, src/renderer/main.tsx  (Task 9)
harnesses/demo/harness.config.ts, ui/App.tsx, locales/*.json, README.md   (Task 16)
README.md                                        (Task 16: status, layout, "Create a harness")
docs/spikes/2026-10-11-onboarding-usage.md       (Task 17)
```

---

### Task 1: Engine setup data, logos and manifest additions

**Files:**
- Modify: `packages/engines/src/index.ts`, `packages/engines/package.json`, `packages/engines/test/engines.test.ts`
- Create: `packages/engines/assets/claude.svg`, `packages/engines/assets/codex.svg`
- Modify: `packages/harness-sdk/src/index.ts`, `packages/harness-sdk/test/harness.test.ts`

- [ ] **Step 1: Failing tests**

Append to `packages/engines/test/engines.test.ts` (add `NOTICE_VERSION, meetsMinVersion, parseVersion` to its import from `"../src"`, and at the top `import fs from "node:fs";` and `import { fileURLToPath } from "node:url";`):
```ts
describe("engine setup data", () => {
  it("installs, signs in, checks and updates Claude through its official CLI", () => {
    expect(getEngine("claude").setup).toEqual({
      install: { command: "curl -fsSL https://claude.ai/install.sh | bash", docsUrl: "https://code.claude.com/docs/en/setup" },
      login: ["auth", "login"],
      status: { args: ["auth", "status", "--json"], format: "json-logged-in" },
      update: ["update"],
      logout: ["auth", "logout"],
    });
  });

  it("signs in to Codex with `codex login` and reads the status from the exit code", () => {
    expect(getEngine("codex").setup).toMatchObject({
      install: { command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh" },
      login: ["login"],
      status: { args: ["login", "status"], format: "exit-code" },
      logout: ["logout"],
    });
    expect(getEngine("codex").setup?.update).toBeUndefined();
  });

  it("ships a logo file for each engine the app sets up (placeholders until the official assets pass brand review)", () => {
    for (const id of ["claude", "codex"]) {
      const logo = getEngine(id).logo;
      expect(logo).toBe(`assets/${id}.svg`);
      expect(fs.readFileSync(fileURLToPath(new URL(`../${logo}`, import.meta.url)), "utf8")).toMatch(/^<svg /);
    }
  });

  it("names the provider and whether the engine reports plan limits", () => {
    expect([getEngine("claude").provider, getEngine("claude").reportsLimits]).toEqual(["Anthropic", true]);
    expect([getEngine("codex").provider, getEngine("codex").reportsLimits]).toEqual(["OpenAI", false]);
    for (const e of ENGINES) expect(e.provider.length).toBeGreaterThan(0);
  });

  it("starts the legal notice at version 1", () => {
    expect(NOTICE_VERSION).toBe(1);
  });
});

describe("versions", () => {
  it("reads x.y.z from CLI version output", () => {
    expect(parseVersion("2.1.296 (Claude Code)\n")).toBe("2.1.296");
    expect(parseVersion("codex-cli 0.160.1")).toBe("0.160.1");
    expect(parseVersion("command not found")).toBeNull();
  });

  it("compares versions numerically", () => {
    expect(meetsMinVersion("2.1.296", "2.1.296")).toBe(true);
    expect(meetsMinVersion("2.1.300", "2.1.296")).toBe(true);
    expect(meetsMinVersion("3.0.0", "2.9.9")).toBe(true);
    expect(meetsMinVersion("2.1.29", "2.1.296")).toBe(false);
    expect(meetsMinVersion("0.159.9", "0.160.1")).toBe(false);
  });
});
```

Append inside `describe("defineHarness")` in `packages/harness-sdk/test/harness.test.ts`:
```ts
  it("declares actions with a cost hint, empty by default", () => {
    expect(defineHarness({ ...base, languages: [...base.languages] }).actions).toEqual({});
    const h = defineHarness({
      ...base,
      languages: [...base.languages],
      actions: { research: { label: { es: "Investigar", en: "Research" }, cost: "heavy" } },
    });
    expect(h.actions.research).toEqual({ label: { es: "Investigar", en: "Research" }, cost: "heavy" });
    expect(() =>
      defineHarness({ ...base, languages: [...base.languages], actions: { research: { label: { es: "x", en: "x" }, cost: "huge" as never } } }),
    ).toThrow();
    expect(() =>
      defineHarness({ ...base, languages: [...base.languages], actions: { "Bad Name": { label: { es: "x", en: "x" }, cost: "light" } } }),
    ).toThrow();
  });

  it("takes an optional tagline and logo for the home screen", () => {
    const h = defineHarness({
      ...base,
      languages: [...base.languages],
      tagline: { es: "Tus notas, ordenadas", en: "Your notes, tidy" },
      logo: "./ui/logo.svg",
    });
    expect([h.tagline?.en, h.logo]).toEqual(["Your notes, tidy", "./ui/logo.svg"]);
    expect(defineHarness({ ...base, languages: [...base.languages] }).tagline).toBeUndefined();
  });
```

Run: `corepack pnpm vitest run packages/engines packages/harness-sdk`
Expected: FAIL (`setup`, `provider`, `logo`, `parseVersion`, `actions`, `tagline` don't exist).

- [ ] **Step 2: Implement — engines**

In `packages/engines/src/index.ts`, add after `TransportDef`:
```ts
/** How the app gets an engine ready, always through the provider's own CLI and installer. */
export interface EngineSetup {
  /** Official install command (run with `/bin/bash -c`, shown to the user first) and its docs. */
  install?: { command: string; docsUrl: string };
  /** CLI args for the official login flow (it opens the browser). */
  login: string[];
  /** CLI args for the login status check, and how to read its result. */
  status: { args: string[]; format: "json-logged-in" | "exit-code" };
  /** CLI args for the official self-update, when there is one. */
  update?: string[];
  /** CLI args for the official sign-out (Settings → Engine → Sign out, only when the user asks). */
  logout: string[];
}
```
Add to `EngineDef` (after `name`):
```ts
  /** Company that runs the service; named in the legal notice. */
  provider: string;
  /** Whether the engine reports plan-limit windows (Claude) or only tokens (Codex). */
  reportsLimits: boolean;
  /** Install / login / status / update / logout. Absent for engines the app can't set up itself. */
  setup?: EngineSetup;
  /**
   * Logo file inside this package (`assets/<id>.svg`), shown on the engine tiles. The files are
   * placeholders: the providers' official logos go here once their brand guidelines are checked
   * (part of the legal gate before distribution).
   */
  logo?: string;
```
Add these fields to each entry of `ENGINES`:
- `claude`:
```ts
    provider: "Anthropic",
    reportsLimits: true,
    setup: {
      install: { command: "curl -fsSL https://claude.ai/install.sh | bash", docsUrl: "https://code.claude.com/docs/en/setup" },
      login: ["auth", "login"],
      status: { args: ["auth", "status", "--json"], format: "json-logged-in" },
      update: ["update"],
      logout: ["auth", "logout"],
    },
    logo: "assets/claude.svg",
```
- `codex`:
```ts
    provider: "OpenAI",
    reportsLimits: false,
    // The app runs the official Codex CLI bundled with the ACP adapter (status, login), so it never
    // installs Codex itself; the official install command is kept for builds without the bundle.
    setup: {
      install: { command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh", docsUrl: "https://learn.chatgpt.com/docs/codex/cli" },
      login: ["login"],
      status: { args: ["login", "status"], format: "exit-code" },
      logout: ["logout"],
    },
    logo: "assets/codex.svg",
```
- `kimi`: `provider: "Moonshot AI", reportsLimits: false,`
- `gemini`: `provider: "Google", reportsLimits: false,`
- `qwen`: `provider: "Alibaba Cloud", reportsLimits: false,`

Append at the end of the file:
```ts
/** Bumped whenever the legal notice text changes, so users accept it again. */
export const NOTICE_VERSION = 1;

/** The first x.y.z in a CLI's version output ("2.1.296 (Claude Code)", "codex-cli 0.160.1"). */
export function parseVersion(output: string): string | null {
  return /\d+\.\d+\.\d+/.exec(output)?.[0] ?? null;
}

/** True when `version` is `min` or newer (numeric x.y.z comparison). */
export function meetsMinVersion(version: string, min: string): boolean {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
```

Create the placeholder logos (neutral monograms, deliberately not the providers' marks):

`packages/engines/assets/claude.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Claude"><rect width="64" height="64" rx="14" fill="#E7E7E3"/><text x="32" y="41" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="24" font-weight="600" fill="#191E24">Cl</text></svg>
```

`packages/engines/assets/codex.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Codex"><rect width="64" height="64" rx="14" fill="#E7E7E3"/><text x="32" y="41" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="24" font-weight="600" fill="#191E24">Cx</text></svg>
```

`packages/engines/package.json` — export the assets:
```json
  "exports": { ".": "./src/index.ts", "./assets/*": "./assets/*" },
```

- [ ] **Step 3: Implement — manifest actions, tagline and logo**

In `packages/harness-sdk/src/index.ts`, add after `localizedText`:
```ts
export const ACTION_COSTS = ["light", "medium", "heavy"] as const;
export type ActionCost = (typeof ACTION_COSTS)[number];
/** A workflow the harness can start (e.g. from a button), with how much of the plan it tends to use. */
const actionSchema = z.object({ label: localizedText, cost: z.enum(ACTION_COSTS) });
export type HarnessAction = z.output<typeof actionSchema>;
```
and add to `manifestSchema` (after `blocks`):
```ts
  actions: z.record(z.string().regex(/^[a-z][a-z0-9_-]*$/), actionSchema).default({}),
  /** One line under the name on the home screen. */
  tagline: localizedText.optional(),
  /** Logo file in the harness folder (SVG, PNG or JPEG); defaults to the Human Harness H. */
  logo: z.string().optional(),
```
The home screen's "made by" line and Support button use the existing `author` and `donate` fields (no new `developer` / `donationUrl` fields: the public API already has them).

- [ ] **Step 4: Verify**

Run: `corepack pnpm vitest run packages/engines packages/harness-sdk && corepack pnpm typecheck`
Expected: PASS; typecheck clean. (The shell's `appState()` does not list the new fields yet; it still compiles because it builds `EngineOption` explicitly.)

- [ ] **Step 5: Commit**

```bash
git add packages/engines packages/harness-sdk
git commit -m "feat: engine setup data and logos, version helpers, manifest actions, tagline and logo"
```

---

### Task 2: The `@humanharness/ui/client` entry and the 2b client contract

**Files:**
- Modify: `packages/ui/package.json`, `packages/ui/src/client.ts`, `packages/ui/src/ChatView.tsx` (one line)
- Modify: `packages/ui/test/fake-client.ts`
- Create: `packages/ui/test/client.test.ts`
- Modify: `packages/shell/src/main/{index,config,chat-log,turn-controller,validate}.ts` (imports; two spots in `index.ts`), `packages/shell/src/preload/index.ts`

Why: the main process imports `isConfigured` from `@humanharness/ui`, whose index also exports React components, so React ends up in the main bundle. `./client` exposes only the contract and plain helpers.

- [ ] **Step 1: Failing test**

Create `packages/ui/test/client.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type EngineStatus, engineProblem } from "../src/client";

const ready: EngineStatus = {
  engineId: "claude",
  installed: true,
  version: "2.1.296",
  minVersion: "2.1.296",
  outdated: false,
  loggedIn: true,
  noticeAccepted: true,
  verified: true,
};

describe("engineProblem", () => {
  it("is null when the engine is ready", () => {
    expect(engineProblem(ready)).toBeNull();
    expect(engineProblem({ ...ready, loggedIn: null })).toBeNull();
  });

  it("asks for the notice first, then install, update, sign-in and the test prompt", () => {
    expect(engineProblem({ ...ready, noticeAccepted: false, installed: false })).toBe("notice");
    expect(engineProblem({ ...ready, installed: false, loggedIn: false })).toBe("not-installed");
    expect(engineProblem({ ...ready, outdated: true, loggedIn: false })).toBe("outdated");
    expect(engineProblem({ ...ready, loggedIn: false, verified: false })).toBe("logged-out");
    expect(engineProblem({ ...ready, verified: false })).toBe("untested");
  });
});

describe("@humanharness/ui/client", () => {
  it("is exported on its own and imports no runtime code (no React)", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
    expect(pkg.exports["./client"]).toBe("./src/client.ts");
    const src = readFileSync(fileURLToPath(new URL("../src/client.ts", import.meta.url)), "utf8");
    expect(src.match(/^import .*$/gm)?.every((line) => line.startsWith("import type "))).toBe(true);
  });
});
```

Run: `corepack pnpm vitest run packages/ui/test/client.test.ts`
Expected: FAIL (`engineProblem` is not exported; no `./client` export).

- [ ] **Step 2: Implement the contract**

`packages/ui/package.json` — change `exports` to:
```json
  "exports": { ".": "./src/index.ts", "./client": "./src/client.ts", "./styles.css": "./src/styles.css" },
```

Replace `packages/ui/src/client.ts` with:
```ts
import type { ActionCost, Language, LocalizedText } from "@humanharness/harness-sdk";
import type { ActivityKind, EngineError, Event, LimitWindow } from "@humanharness/runtime";

export type Appearance = "system" | "light" | "dark";

export interface AppConfig {
  language?: Language;
  folder?: string;
  engineId?: string;
  /** Settings → General → Appearance. Absent means follow the system. */
  appearance?: Appearance;
}

export interface EngineOption {
  id: string;
  name: string;
  status: "allowed" | "pending";
  /** Company that runs the service (legal notice). */
  provider: string;
  requires: LocalizedText;
  dataLocation: LocalizedText;
  trainsOnData: LocalizedText;
  termsUrl: string;
  privacyUrl: string;
  /** Whether the engine reports plan-limit windows (Claude) or only tokens (Codex). */
  reportsLimits: boolean;
  /** The official install command, shown before the app runs it. */
  installCommand?: string;
  installDocsUrl?: string;
  /** The engine's logo as a data: URL (the main process reads the file). */
  logo?: string;
}

export interface ActionOption {
  label: LocalizedText;
  cost: ActionCost;
}

export interface AppState {
  harness: {
    id: string;
    name: LocalizedText;
    languages: Language[];
    tagline?: LocalizedText;
    /** The harness logo as a data: URL; absent means the Human Harness H. */
    logo?: string;
    /** Who made the harness (manifest `author`), for "made by … with Human Harness". */
    author: string;
    /** Donation link (manifest `donate`), for the Support button. */
    donate?: string;
    version: string;
  };
  config: AppConfig;
  /** Absolute suggested folder (e.g. ~/Documents/Demo). */
  suggestedFolder: string;
  engines: EngineOption[];
  /** The harness's declared actions, by id. */
  actions: Record<string, ActionOption>;
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  blocks: { name: string; data: unknown }[];
  activities: { kind: ActivityKind; detail: string }[];
  at: string;
  error?: EngineError;
  /** User entries: the manifest action that started the turn. */
  action?: string;
  /** Assistant entries: tokens the engine reported for the turn. */
  usage?: TurnUsage;
  /** Assistant entries: plan-limit windows reported during the turn. */
  limits?: LimitWindow[];
  /** Assistant entries: latest data of each state-only block emitted during the turn. */
  state?: Record<string, unknown>;
}

export interface ChatLoad {
  entries: ChatEntry[];
  /** Set when the folder's last session ran on another engine: that chat was archived. */
  switchedFrom?: string;
}

export interface HistoryItem {
  sha: string;
  message: string;
  date: string;
}

/** Why a folder can't be the harness folder. */
export type FolderProblem = "not-absolute" | "root" | "home" | "too-broad" | "protected";

/** A folder the user picked, and why it can't be used (null when it can). */
export interface FolderPick {
  folder: string;
  problem: FolderProblem | null;
}

export interface EngineStatus {
  engineId: string;
  installed: boolean;
  version: string | null;
  minVersion: string;
  outdated: boolean;
  /** Null when the CLI has no status check (or it wasn't run because the CLI is outdated). */
  loggedIn: boolean | null;
  noticeAccepted: boolean;
  /** A test prompt has succeeded on this computer. */
  verified: boolean;
}

export type EngineProblem = "notice" | "not-installed" | "outdated" | "logged-out" | "untested";

/** The first thing left to do before the engine can run turns, or null when it is ready. */
export function engineProblem(s: EngineStatus): EngineProblem | null {
  if (!s.noticeAccepted) return "notice";
  if (!s.installed) return "not-installed";
  if (s.outdated) return "outdated";
  if (s.loggedIn === false) return "logged-out";
  if (!s.verified) return "untested";
  return null;
}

export type SetupStep = "install" | "update" | "login" | "logout";

/** Output of a running install, update or login: its lines, and the first web address it printed. */
export type SetupOutput = { kind: "line"; text: string } | { kind: "url"; url: string };

export interface UsageSummary {
  /** Latest plan-limit windows that haven't reset yet; null when the engine never reported any. */
  limits: LimitWindow[] | null;
  /** Typical share (0..1) of the five-hour window each action used, from the local log. */
  estimates: Record<string, number>;
}

export interface SendOptions {
  /** The manifest action this message starts (tags the turn; heavy ones may ask first). */
  action?: string;
}

/** Everything the renderer can ask the main process. Implemented by the preload as `window.hh`. */
export interface HarnessClient {
  getState(): Promise<AppState>;
  /** Null when the user cancelled the dialog. */
  pickFolder(defaultPath: string): Promise<FolderPick | null>;
  saveConfig(patch: AppConfig): Promise<AppState>;
  loadChat(): Promise<ChatLoad>;
  send(message: string, options?: SendOptions): Promise<void>;
  cancel(): Promise<void>;
  onEvent(listener: (event: Event) => void): () => void;
  history(): Promise<HistoryItem[]>;
  restore(sha: string): Promise<void>;
  engineStatus(engineId: string): Promise<EngineStatus>;
  acceptNotice(engineId: string): Promise<void>;
  /** Runs the official install, update, login or logout; resolves when it exits. */
  runSetup(engineId: string, step: SetupStep): Promise<{ ok: boolean }>;
  /** Types one line into the running login (e.g. a code the sign-in page shows). */
  setupInput(text: string): Promise<void>;
  cancelSetup(): Promise<void>;
  onSetupOutput(listener: (output: SetupOutput) => void): () => void;
  /** Sends a tiny prompt to check the engine works; marks it verified when it does. */
  testEngine(engineId: string): Promise<{ ok: boolean; error?: EngineError }>;
  getUsage(): Promise<UsageSummary>;
  /** Shows the configured folder in Finder. */
  revealFolder(): Promise<void>;
}

/** A config with everything a turn needs (appearance stays optional). */
export type ConfiguredApp = AppConfig & Required<Pick<AppConfig, "language" | "folder" | "engineId">>;

export function isConfigured(config: AppConfig): config is ConfiguredApp {
  return Boolean(config.language && config.folder && config.engineId);
}

export type { Event, EngineError, LimitWindow };
```

- [ ] **Step 3: Keep the kit and the shell compiling**

`packages/ui/src/ChatView.tsx` — in the first `useEffect`, change the `loadChat` line to:
```ts
    void client.loadChat().then(({ entries }) => dispatch({ type: "loaded", entries }));
```

Replace `packages/ui/test/fake-client.ts` with:
```ts
import type {
  AppConfig,
  AppState,
  ChatEntry,
  EngineError,
  EngineStatus,
  Event,
  FolderPick,
  HarnessClient,
  HistoryItem,
  SendOptions,
  SetupOutput,
  SetupStep,
  UsageSummary,
} from "../src/client";

export class FakeClient implements HarnessClient {
  state: AppState;
  sent: string[] = [];
  sentOptions: SendOptions[] = [];
  restored: string[] = [];
  cancelled = 0;
  chat: ChatEntry[] = [];
  switchedFrom: string | undefined;
  items: HistoryItem[] = [{ sha: "abc", message: "Turn: hi", date: "2026-10-10T12:00:00.000Z" }];
  sendError: Error | null = null;
  saveError: Error | null = null;
  restoreError: Error | null = null;
  pickResult: FolderPick | null = { folder: "/Users/me/Elsewhere", problem: null };
  stateError: Error | null = null;
  getStateCalls = 0;
  loadChatGate: Promise<void> | null = null;
  /** Engine status returned by engineStatus (any engine id); setup steps update it. */
  status: EngineStatus = {
    engineId: "claude",
    installed: true,
    version: "2.1.296",
    minVersion: "2.1.296",
    outdated: false,
    loggedIn: true,
    noticeAccepted: true,
    verified: true,
  };
  accepted: string[] = [];
  setupRuns: { engineId: string; step: SetupStep }[] = [];
  setupResult = { ok: true };
  /** When set, runSetup waits for it (a login in progress). */
  setupGate: Promise<void> | null = null;
  setupInputs: string[] = [];
  setupCancelled = 0;
  tested: string[] = [];
  testResult: { ok: boolean; error?: EngineError } = { ok: true };
  usage: UsageSummary = { limits: null, estimates: {} };
  revealed = 0;
  private listeners = new Set<(e: Event) => void>();
  private setupListeners = new Set<(o: SetupOutput) => void>();

  constructor(config: AppConfig = {}) {
    this.state = {
      harness: {
        id: "demo",
        name: { es: "Demo", en: "Demo" },
        languages: ["es", "en"],
        tagline: { es: "Notas de prueba", en: "Test notes" },
        author: "Marco Zanger",
        donate: "https://example.com/donate",
        version: "0.1.0",
      },
      config,
      suggestedFolder: "/Users/me/Documents/Demo",
      engines: [
        {
          id: "claude",
          name: "Claude",
          status: "allowed",
          provider: "Anthropic",
          requires: { es: "Plan Pro", en: "Pro plan" },
          dataLocation: { es: "EE. UU.", en: "USA" },
          trainsOnData: { es: "Según tu configuración", en: "Depends on your settings" },
          termsUrl: "https://example.com/terms",
          privacyUrl: "https://example.com/privacy",
          reportsLimits: true,
          installCommand: "curl -fsSL https://claude.ai/install.sh | bash",
          installDocsUrl: "https://code.claude.com/docs/en/setup",
          logo: "data:image/svg+xml;base64,PHN2Zy8+",
        },
      ],
      actions: {},
    };
  }

  emit(e: Event) {
    for (const l of this.listeners) l(e);
  }
  emitSetup(o: SetupOutput) {
    for (const l of this.setupListeners) l(o);
  }

  async getState() {
    this.getStateCalls++;
    if (this.stateError) throw this.stateError;
    return this.state;
  }
  async pickFolder() {
    return this.pickResult;
  }
  async saveConfig(patch: AppConfig) {
    if (this.saveError) throw this.saveError;
    this.state = { ...this.state, config: { ...this.state.config, ...patch } };
    return this.state;
  }
  async loadChat() {
    if (this.loadChatGate) await this.loadChatGate;
    return { entries: this.chat, ...(this.switchedFrom ? { switchedFrom: this.switchedFrom } : {}) };
  }
  async send(message: string, options: SendOptions = {}) {
    this.sent.push(message);
    this.sentOptions.push(options);
    if (this.sendError) throw this.sendError;
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
    if (this.restoreError) throw this.restoreError;
    this.restored.push(sha);
  }
  async engineStatus(engineId: string) {
    return { ...this.status, engineId };
  }
  async acceptNotice(engineId: string) {
    this.accepted.push(engineId);
    this.status = { ...this.status, noticeAccepted: true };
  }
  async runSetup(engineId: string, step: SetupStep) {
    this.setupRuns.push({ engineId, step });
    if (this.setupGate) await this.setupGate;
    if (this.setupResult.ok) {
      if (step === "install") this.status = { ...this.status, installed: true };
      if (step === "update") this.status = { ...this.status, outdated: false };
      if (step === "login") this.status = { ...this.status, loggedIn: true };
      if (step === "logout") this.status = { ...this.status, loggedIn: false };
    }
    return this.setupResult;
  }
  async setupInput(text: string) {
    this.setupInputs.push(text);
  }
  async cancelSetup() {
    this.setupCancelled++;
  }
  onSetupOutput(listener: (o: SetupOutput) => void) {
    this.setupListeners.add(listener);
    return () => this.setupListeners.delete(listener);
  }
  async testEngine(engineId: string) {
    this.tested.push(engineId);
    if (this.testResult.ok) this.status = { ...this.status, verified: true };
    return this.testResult;
  }
  async getUsage() {
    return this.usage;
  }
  async revealFolder() {
    this.revealed++;
  }
}
```

Shell imports — point every `@humanharness/ui` import in the shell sources at the new entry:
```bash
sed -i '' 's#"@humanharness/ui"#"@humanharness/ui/client"#' packages/shell/src/main/index.ts packages/shell/src/main/config.ts packages/shell/src/main/chat-log.ts packages/shell/src/main/turn-controller.ts packages/shell/src/main/validate.ts packages/shell/src/preload/index.ts
```

`packages/shell/src/main/index.ts` — in `appState()`, replace the `harness:` line with the following (logos are read in Task 9):
```ts
    harness: {
      id: harness.id,
      name: harness.name,
      languages: harness.languages,
      ...(harness.tagline ? { tagline: harness.tagline } : {}),
      author: harness.author,
      ...(harness.donate ? { donate: harness.donate } : {}),
      version: app.getVersion(),
    },
```
then replace the `engines:` mapping with the following and add `actions`:
```ts
    engines: availableEngines(harness.engines, mode()).map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status as "allowed" | "pending",
      provider: e.provider,
      requires: e.requires,
      dataLocation: e.dataLocation,
      trainsOnData: e.trainsOnData,
      termsUrl: e.termsUrl,
      privacyUrl: e.privacyUrl,
      reportsLimits: e.reportsLimits,
      ...(e.setup?.install ? { installCommand: e.setup.install.command, installDocsUrl: e.setup.install.docsUrl } : {}),
    })),
    actions: harness.actions,
```
change `validConfig`'s signature to `async function validConfig(): Promise<ConfiguredApp | null>` (add `type ConfiguredApp` to the `@humanharness/ui/client` import: `Required<AppConfig>` would now wrongly require `appearance`), and replace the `hh:loadChat` handler with:
```ts
  handle("hh:loadChat", async () => {
    const c = await config.load();
    return { entries: c.folder ? await new ChatLog(c.folder).load() : [] };
  });
```

Replace `packages/shell/src/preload/index.ts` with:
```ts
import { contextBridge, ipcRenderer } from "electron";
import type { Event, HarnessClient, SetupOutput } from "@humanharness/ui/client";

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_e: unknown, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const client: HarnessClient = {
  getState: () => ipcRenderer.invoke("hh:getState"),
  pickFolder: (defaultPath) => ipcRenderer.invoke("hh:pickFolder", defaultPath),
  saveConfig: (patch) => ipcRenderer.invoke("hh:saveConfig", patch),
  loadChat: () => ipcRenderer.invoke("hh:loadChat"),
  send: (message, options) => ipcRenderer.invoke("hh:send", message, options ?? {}),
  cancel: () => ipcRenderer.invoke("hh:cancel"),
  onEvent: (listener) => subscribe<Event>("hh:event", listener),
  history: () => ipcRenderer.invoke("hh:history"),
  restore: (sha) => ipcRenderer.invoke("hh:restore", sha),
  engineStatus: (engineId) => ipcRenderer.invoke("hh:engineStatus", engineId),
  acceptNotice: (engineId) => ipcRenderer.invoke("hh:acceptNotice", engineId),
  runSetup: (engineId, step) => ipcRenderer.invoke("hh:runSetup", engineId, step),
  setupInput: (text) => ipcRenderer.invoke("hh:setupInput", text),
  cancelSetup: () => ipcRenderer.invoke("hh:cancelSetup"),
  onSetupOutput: (listener) => subscribe<SetupOutput>("hh:setupOutput", listener),
  testEngine: (engineId) => ipcRenderer.invoke("hh:testEngine", engineId),
  getUsage: () => ipcRenderer.invoke("hh:getUsage"),
  revealFolder: () => ipcRenderer.invoke("hh:revealFolder"),
};

contextBridge.exposeInMainWorld("hh", client);
```
(The new channels are handled in Task 9.)

- [ ] **Step 4: Verify**

Run: `corepack pnpm test && corepack pnpm typecheck`
Expected: all tests pass (including the new `client.test.ts`); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/ui packages/shell/src
git commit -m "feat(ui): client entry without React and the onboarding/usage contract"
```

---
### Task 3: Strings for Home, Settings, onboarding, the legal notice and usage

**Files:**
- Modify: `packages/i18n/src/locales/en.json`, `packages/i18n/src/locales/es.json`, `packages/i18n/test/i18n.test.ts`

All UI tasks below use exactly these keys. 2a's `setup.title`, `setup.start`, `setup.engine` and `setup.engineHint` stay until Task 14 deletes the old setup screen, and them with it.

- [ ] **Step 1: Failing test**

In `packages/i18n/test/i18n.test.ts`, in the test `"translates core keys with interpolation"`, replace the `setup.title` line with:
```ts
    expect(i18n.t("home.start", { name: "Demo" })).toBe("Iniciar Demo");
```
and append inside `describe("createI18n")`:
```ts
  it("has the Home, Settings, legal notice, usage and pre-flight strings in both languages", async () => {
    const en = await createI18n("en");
    expect(en.t("engine.noticeAccount", { provider: "Anthropic", plan: "Claude Pro or Max plan" })).toBe(
      "You use your own Anthropic account and plan (Claude Pro or Max plan) under their terms. This app is not made or endorsed by Anthropic.",
    );
    expect(en.t("usage.window", { label: "5 h", percent: 16 })).toBe("5 h: 16 % used");
    expect(en.t("preflight.estimate", { action: "Research", estimate: 8, left: 84 })).toBe(
      "\"Research\" usually uses about 8 % of your 5-hour window. You have 84 % left.",
    );
    expect(en.t("settings.madeBy", { author: "Marco" })).toBe("Made by Marco with Human Harness");
    const es = await createI18n("es");
    expect(es.t("settings.tabs.engine")).toBe("Motor");
    expect(es.t("engine.accept")).toBe("Entiendo y acepto");
    expect(es.t("errors.fix.session-expired")).toBe("Volver a entrar");
  });
```

Run: `corepack pnpm vitest run packages/i18n`
Expected: FAIL (keys missing; i18next returns the key).

- [ ] **Step 2: Replace the English strings**

Replace `packages/i18n/src/locales/en.json` with:
```json
{
  "home": {
    "start": "Start {{name}}",
    "settings": "Settings",
    "connected": "Connected",
    "notConnected": "Not connected",
    "checking": "Checking…",
    "usage": "{{label}} · {{percent}} %",
    "noEngine": "No AI engine yet"
  },
  "settings": {
    "title": "Settings",
    "done": "Done",
    "tabs": { "general": "General", "engine": "Engine", "usage": "Usage" },
    "language": "Language",
    "appearance": "Appearance",
    "appearanceSystem": "Automatic",
    "appearanceLight": "Light",
    "appearanceDark": "Dark",
    "folder": "Folder",
    "folderFixed": "Chosen at setup; it can't be changed.",
    "reveal": "Show in Finder",
    "about": "About",
    "version": "Version {{version}}",
    "madeBy": "Made by {{author}} with Human Harness",
    "support": "Support"
  },
  "setup": {
    "title": "Let's get {{name}} ready",
    "start": "Start",
    "engine": "AI engine",
    "engineHint": "It uses your own account. Make sure you are signed in to its app on this computer.",
    "welcome": "{{name}} works with an AI plan you already have, using your own account. The app doesn't see or keep anything outside your computer: your work stays in a folder you choose.",
    "language": "Language",
    "folder": "Your folder",
    "folderHint": "Your work will be saved here.",
    "folderChange": "Choose another folder",
    "folderWarning": "Don't move, rename or edit this folder by hand: the app depends on it.",
    "useFolder": "Use this folder",
    "engineRequires": "Requires: {{plan}}",
    "engineData": "Your data goes to: {{where}}",
    "enginePending": "Not yet cleared for distribution (development only)",
    "folderProblem": {
      "not-absolute": "I couldn't use that folder. Pick another one.",
      "root": "That's the top of the disk. Pick or create a folder for your work.",
      "home": "That's your whole home folder. Pick or create a folder inside it.",
      "too-broad": "That folder is too general. Pick or create a folder inside it.",
      "protected": "That folder belongs to the system or other apps. Pick another one, for example inside Documents."
    },
    "saveError": "I couldn't save your settings. Try again or pick another folder."
  },
  "engine": {
    "tilesLabel": "AI engines",
    "moreSoon": "More engines · coming soon",
    "current": "In use",
    "use": "Use {{engine}}",
    "plan": "Plan",
    "data": "Your data goes to",
    "version": "Installed version",
    "signOut": "Sign out",
    "signingOut": "Signing out…",
    "noticeTitle": "Before using {{engine}}",
    "noticeProvider": "{{engine}} is a service of {{provider}}. What you write here, and the files in your folder that the AI reads, are sent to {{provider}} ({{where}}).",
    "noticeTraining": "Training on your data: {{trains}}",
    "noticeAccount": "You use your own {{provider}} account and plan ({{plan}}) under their terms. This app is not made or endorsed by {{provider}}.",
    "noticeContent": "Answers are written by {{provider}}'s AI with your account. Check what matters: this app is not responsible for what the AI writes.",
    "terms": "{{provider}} terms",
    "privacy": "{{provider}} privacy policy",
    "accept": "I understand and accept",
    "continue": "Continue",
    "cancel": "Cancel",
    "checking": "Checking {{engine}} on this computer…",
    "installTitle": "Install {{engine}}",
    "installText": "{{engine}} isn't on this computer yet. I'll install it with {{provider}}'s official installer:",
    "installRun": "Install",
    "installing": "Installing… this can take a minute.",
    "installManual": "I can't install {{engine}} myself. Follow the official instructions, then come back:",
    "installDocs": "Official instructions",
    "updateTitle": "Update {{engine}}",
    "updateText": "This app needs {{engine}} {{min}} or newer; you have {{version}}.",
    "updateRun": "Update",
    "updating": "Updating…",
    "loginTitle": "Sign in to {{engine}}",
    "loginText": "Sign in with your {{provider}} account. Your browser will open the official sign-in page.",
    "loginRun": "Sign in",
    "loggingIn": "Waiting for you to finish signing in in your browser…",
    "loginOpen": "Open the sign-in page",
    "loginCode": "If the page shows a code, paste it here",
    "loginCodeSend": "Send code",
    "testTitle": "One last check",
    "testing": "Sending {{engine}} a tiny test message…",
    "ready": "{{engine}} is ready ✓",
    "failed": "That didn't work. Try again.",
    "retry": "Try again",
    "recheck": "Check again",
    "details": "Details"
  },
  "usage": {
    "five_hour": "5 h",
    "seven_day": "week",
    "window": "{{label}}: {{percent}} % used",
    "resets": "resets at {{time}}",
    "resetsFull": "Resets {{time}}",
    "unknown": "Your plan's usage shows up after the first message.",
    "noLimits": "{{engine}} doesn't report your plan's limits.",
    "lastTurn": "Last message: {{tokens}} tokens.",
    "near": "Close to your limit",
    "almostOut": "Almost at your limit",
    "planTitle": "Your plan",
    "actionsTitle": "What this app can do",
    "cost": { "light": "Light", "medium": "Medium", "heavy": "Heavy" },
    "estimate": "Usually about {{percent}} % of the 5-hour window",
    "noActions": "This app doesn't declare any actions."
  },
  "preflight": {
    "title": "This is a heavy task",
    "estimate": "\"{{action}}\" usually uses about {{estimate}} % of your 5-hour window. You have {{left}} % left.",
    "hint": "\"{{action}}\" can use a large part of your 5-hour window. You have {{left}} % left.",
    "continue": "Continue",
    "notNow": "Not now"
  },
  "chat": {
    "placeholder": "Write a message…",
    "send": "Send",
    "stop": "Stop",
    "working": "Working…",
    "you": "You",
    "home": "Home",
    "switched": "You're now using {{engine}}, so I started a new conversation. The earlier one is saved in your folder."
  },
  "activity": {
    "read": "Reading {{detail}}",
    "edit": "Editing {{detail}}",
    "search": "Searching {{detail}}",
    "web": "Looking up {{detail}}",
    "exec": "Checking the folder…",
    "other": "Working on {{detail}}"
  },
  "history": {
    "title": "History",
    "restore": "Go back to this point",
    "empty": "Nothing yet.",
    "close": "Close",
    "confirm": "Go back to this point? Files changed after it will be undone.",
    "confirmYes": "Yes, go back",
    "cancel": "Cancel",
    "restored": "I went back to that point. Files changed after it were undone.",
    "restoreFailed": "I couldn't go back to that point. Try again in a moment."
  },
  "app": {
    "loadError": "The app couldn't start. Close it and open it again."
  },
  "errors": {
    "engine-not-installed": "I can't find {{engine}} on this computer.",
    "session-expired": "Your {{engine}} session ended. Sign in again to continue.",
    "out-of-quota": "You've reached your plan's limit for now. Your conversation is saved; try again later.",
    "agent-crashed": "Something failed and I didn't change anything.",
    "cancelled": "Stopped.",
    "outdated-version": "{{engine}} needs an update.",
    "notice": "{{engine}} isn't fully set up in this app yet.",
    "resetsAt": "Your limit resets: {{time}}.",
    "retry": "Try again",
    "fix": {
      "engine-not-installed": "Install {{engine}}",
      "session-expired": "Sign in again",
      "outdated-version": "Update {{engine}}",
      "notice": "Finish setting up {{engine}}"
    }
  }
}
```

- [ ] **Step 3: Replace the Spanish strings**

Replace `packages/i18n/src/locales/es.json` with:
```json
{
  "home": {
    "start": "Iniciar {{name}}",
    "settings": "Ajustes",
    "connected": "Conectado",
    "notConnected": "Sin conectar",
    "checking": "Revisando…",
    "usage": "{{label}} · {{percent}} %",
    "noEngine": "Todavía sin motor de IA"
  },
  "settings": {
    "title": "Ajustes",
    "done": "Listo",
    "tabs": { "general": "General", "engine": "Motor", "usage": "Uso" },
    "language": "Idioma",
    "appearance": "Apariencia",
    "appearanceSystem": "Automática",
    "appearanceLight": "Clara",
    "appearanceDark": "Oscura",
    "folder": "Carpeta",
    "folderFixed": "Se eligió al configurar; no se puede cambiar.",
    "reveal": "Mostrar en Finder",
    "about": "Acerca de",
    "version": "Versión {{version}}",
    "madeBy": "Hecho por {{author}} con Human Harness",
    "support": "Apoyar"
  },
  "setup": {
    "title": "Preparemos {{name}}",
    "start": "Empezar",
    "engine": "Motor de IA",
    "engineHint": "Usa tu propia cuenta. Asegurate de tener la sesión iniciada en su app en esta compu.",
    "welcome": "{{name}} funciona con un plan de IA que ya tenés, con tu propia cuenta. La app no ve ni guarda nada fuera de tu compu: tu trabajo queda en una carpeta que elegís vos.",
    "language": "Idioma",
    "folder": "Tu carpeta",
    "folderHint": "Acá se guarda tu trabajo.",
    "folderChange": "Elegir otra carpeta",
    "folderWarning": "No muevas, renombres ni edites esta carpeta a mano: la app depende de ella.",
    "useFolder": "Usar esta carpeta",
    "engineRequires": "Necesitás: {{plan}}",
    "engineData": "Tus datos van a: {{where}}",
    "enginePending": "Todavía no habilitado para distribución (solo desarrollo)",
    "folderProblem": {
      "not-absolute": "No pude usar esa carpeta. Elegí otra.",
      "root": "Esa es la raíz del disco. Elegí o creá una carpeta para tu trabajo.",
      "home": "Esa es tu carpeta personal entera. Elegí o creá una carpeta adentro de ella.",
      "too-broad": "Esa carpeta es muy general. Elegí o creá una carpeta adentro de ella.",
      "protected": "Esa carpeta es del sistema o de otras apps. Elegí otra, por ejemplo una dentro de Documentos."
    },
    "saveError": "No pude guardar la configuración. Probá de nuevo o elegí otra carpeta."
  },
  "engine": {
    "tilesLabel": "Motores de IA",
    "moreSoon": "Más motores · próximamente",
    "current": "En uso",
    "use": "Usar {{engine}}",
    "plan": "Plan",
    "data": "Tus datos van a",
    "version": "Versión instalada",
    "signOut": "Cerrar sesión",
    "signingOut": "Cerrando sesión…",
    "noticeTitle": "Antes de usar {{engine}}",
    "noticeProvider": "{{engine}} es un servicio de {{provider}}. Lo que escribas acá, y los archivos de tu carpeta que lea la IA, se envían a {{provider}} ({{where}}).",
    "noticeTraining": "Entrenamiento con tus datos: {{trains}}",
    "noticeAccount": "Usás tu propia cuenta y tu plan de {{provider}} ({{plan}}), bajo sus términos. Esta app no está hecha ni respaldada por {{provider}}.",
    "noticeContent": "Las respuestas las escribe la IA de {{provider}} con tu cuenta. Revisá lo importante: esta app no se hace responsable de lo que escribe la IA.",
    "terms": "Términos de {{provider}}",
    "privacy": "Política de privacidad de {{provider}}",
    "accept": "Entiendo y acepto",
    "continue": "Continuar",
    "cancel": "Cancelar",
    "checking": "Revisando {{engine}} en esta compu…",
    "installTitle": "Instalar {{engine}}",
    "installText": "{{engine}} todavía no está en esta compu. Lo instalo con el instalador oficial de {{provider}}:",
    "installRun": "Instalar",
    "installing": "Instalando… puede tardar un minuto.",
    "installManual": "No puedo instalar {{engine}} por mi cuenta. Seguí las instrucciones oficiales y después volvé:",
    "installDocs": "Instrucciones oficiales",
    "updateTitle": "Actualizar {{engine}}",
    "updateText": "Esta app necesita {{engine}} {{min}} o más nuevo; tenés {{version}}.",
    "updateRun": "Actualizar",
    "updating": "Actualizando…",
    "loginTitle": "Entrar a {{engine}}",
    "loginText": "Entrá con tu cuenta de {{provider}}. Tu navegador va a abrir la página oficial para iniciar sesión.",
    "loginRun": "Iniciar sesión",
    "loggingIn": "Esperando a que termines de iniciar sesión en el navegador…",
    "loginOpen": "Abrir la página para iniciar sesión",
    "loginCode": "Si la página te muestra un código, pegalo acá",
    "loginCodeSend": "Enviar código",
    "testTitle": "Un último control",
    "testing": "Le mando a {{engine}} un mensaje de prueba cortito…",
    "ready": "Todo listo con {{engine}} ✓",
    "failed": "Eso no funcionó. Probá de nuevo.",
    "retry": "Reintentar",
    "recheck": "Revisar de nuevo",
    "details": "Detalles"
  },
  "usage": {
    "five_hour": "5 h",
    "seven_day": "semana",
    "window": "{{label}}: {{percent}} % usado",
    "resets": "se renueva a las {{time}}",
    "resetsFull": "Se renueva: {{time}}",
    "unknown": "El uso de tu plan aparece después del primer mensaje.",
    "noLimits": "{{engine}} no informa los límites de tu plan.",
    "lastTurn": "Último mensaje: {{tokens}} tokens.",
    "near": "Cerca de tu límite",
    "almostOut": "Casi en tu límite",
    "planTitle": "Tu plan",
    "actionsTitle": "Lo que puede hacer esta app",
    "cost": { "light": "Liviana", "medium": "Media", "heavy": "Pesada" },
    "estimate": "Suele usar alrededor del {{percent}} % de la ventana de 5 horas",
    "noActions": "Esta app no declara acciones."
  },
  "preflight": {
    "title": "Esta tarea es pesada",
    "estimate": "«{{action}}» suele usar alrededor del {{estimate}} % de tu ventana de 5 horas. Te queda {{left}} %.",
    "hint": "«{{action}}» puede usar una parte grande de tu ventana de 5 horas. Te queda {{left}} %.",
    "continue": "Continuar",
    "notNow": "Ahora no"
  },
  "chat": {
    "placeholder": "Escribí un mensaje…",
    "send": "Enviar",
    "stop": "Detener",
    "working": "Trabajando…",
    "you": "Vos",
    "home": "Inicio",
    "switched": "Ahora usás {{engine}}, así que empecé una conversación nueva. La anterior quedó guardada en tu carpeta."
  },
  "activity": {
    "read": "Leyendo {{detail}}",
    "edit": "Editando {{detail}}",
    "search": "Buscando {{detail}}",
    "web": "Consultando {{detail}}",
    "exec": "Revisando la carpeta…",
    "other": "Trabajando en {{detail}}"
  },
  "history": {
    "title": "Historial",
    "restore": "Volver a este punto",
    "empty": "Todavía no hay nada.",
    "close": "Cerrar",
    "confirm": "¿Volver a este punto? Se deshacen los cambios posteriores en tus archivos.",
    "confirmYes": "Sí, volver",
    "cancel": "Cancelar",
    "restored": "Volví a ese punto. Se deshicieron los cambios posteriores en tus archivos.",
    "restoreFailed": "No pude volver a ese punto. Probá de nuevo en un momento."
  },
  "app": {
    "loadError": "La app no pudo arrancar. Cerrala y volvé a abrirla."
  },
  "errors": {
    "engine-not-installed": "No encuentro {{engine}} en esta compu.",
    "session-expired": "Se cerró tu sesión de {{engine}}. Volvé a entrar para seguir.",
    "out-of-quota": "Llegaste al límite de tu plan por ahora. Tu conversación quedó guardada; probá más tarde.",
    "agent-crashed": "Algo falló y no cambié nada.",
    "cancelled": "Detenido.",
    "outdated-version": "Hace falta actualizar {{engine}}.",
    "notice": "{{engine}} todavía no está del todo configurado en esta app.",
    "resetsAt": "Tu límite se renueva: {{time}}.",
    "retry": "Reintentar",
    "fix": {
      "engine-not-installed": "Instalar {{engine}}",
      "session-expired": "Volver a entrar",
      "outdated-version": "Actualizar {{engine}}",
      "notice": "Terminar de configurar {{engine}}"
    }
  }
}
```

- [ ] **Step 4: Verify**

Run: `corepack pnpm vitest run packages/i18n packages/ui`
Expected: PASS (including the key-parity test; no 2a UI test depends on the changed `session-expired` text).

- [ ] **Step 5: Commit**

```bash
git add packages/i18n
git commit -m "feat(i18n): Home, Settings, onboarding, legal notice, usage and pre-flight strings"
```

---

### Task 4: Shared engine config in `~/.humanharness/`

**Files:**
- Create: `packages/shell/src/main/shared-config.ts`, `packages/shell/test/shared-config.test.ts`

Schema of `~/.humanharness/engines.json` (version 1). It never holds credentials, emails or anything the CLIs print about the account:
```json
{
  "version": 1,
  "engines": {
    "claude": {
      "binary": "/Users/me/.local/bin/claude",
      "version": "2.1.296",
      "notice": { "version": 1, "acceptedAt": "2026-10-11T14:00:00.000Z" },
      "verifiedAt": "2026-10-11T14:01:00.000Z"
    }
  }
}
```

- [ ] **Step 1: Failing test**

Create `packages/shell/test/shared-config.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SharedConfigStore, noticeAccepted, sharedConfigDir } from "../src/main/shared-config";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const newDir = () => fs.mkdtempSync(path.join(root, "s-"));

describe("SharedConfigStore", () => {
  it("lives in ~/.humanharness", () => {
    expect(sharedConfigDir("/Users/me")).toBe("/Users/me/.humanharness");
  });

  it("starts empty and merges updates per engine", async () => {
    const dir = newDir();
    const store = new SharedConfigStore(dir);
    expect(await store.load()).toEqual({ version: 1, engines: {} });
    await store.update("claude", { binary: "/bin/claude", version: "2.1.296" });
    await store.update("claude", { verifiedAt: "2026-10-11T14:00:00.000Z" });
    await store.update("codex", { notice: { version: 1, acceptedAt: "t" } });
    expect(await store.engine("claude")).toEqual({ binary: "/bin/claude", version: "2.1.296", verifiedAt: "2026-10-11T14:00:00.000Z" });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "engines.json"), "utf8")).engines.codex.notice.version).toBe(1);
    expect(fs.readdirSync(dir)).toEqual(["engines.json"]);
  });

  it("keeps only known fields", async () => {
    const store = new SharedConfigStore(newDir());
    await store.update("claude", { version: "1.0.0", email: "someone@example.com", token: "x" } as never);
    expect(await store.engine("claude")).toEqual({ version: "1.0.0" });
  });

  it("re-reads the file before writing, so two apps don't drop each other's changes", async () => {
    const dir = newDir();
    const a = new SharedConfigStore(dir);
    const b = new SharedConfigStore(dir);
    await a.update("claude", { version: "2.1.296" });
    await b.update("codex", { version: "0.160.1" });
    await a.update("claude", { verifiedAt: "t" });
    expect(Object.keys((await b.load()).engines).sort()).toEqual(["claude", "codex"]);
  });

  it("treats a broken or unknown file as empty", async () => {
    const dir = newDir();
    fs.writeFileSync(path.join(dir, "engines.json"), "{nope");
    expect(await new SharedConfigStore(dir).load()).toEqual({ version: 1, engines: {} });
    fs.writeFileSync(path.join(dir, "engines.json"), JSON.stringify({ version: 2, engines: { claude: {} } }));
    expect(await new SharedConfigStore(dir).load()).toEqual({ version: 1, engines: {} });
  });
});

describe("noticeAccepted", () => {
  it("needs the current notice version", () => {
    expect(noticeAccepted({}, 1)).toBe(false);
    expect(noticeAccepted({ notice: { version: 1, acceptedAt: "t" } }, 1)).toBe(true);
    expect(noticeAccepted({ notice: { version: 1, acceptedAt: "t" } }, 2)).toBe(false);
  });
});
```

Run: `corepack pnpm vitest run packages/shell/test/shared-config.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

Create `packages/shell/src/main/shared-config.ts`:
```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/** What every Human Harness app on this computer knows about one engine. Never credentials. */
export interface SharedEngineRecord {
  /** Absolute path of the CLI found last time (informational: it is detected again on every check). */
  binary?: string;
  version?: string;
  /** The legal notice the user accepted, and when. */
  notice?: { version: number; acceptedAt: string };
  /** Last time a test prompt succeeded. */
  verifiedAt?: string;
}

export interface SharedConfig {
  version: 1;
  engines: Record<string, SharedEngineRecord>;
}

const FIELDS: readonly string[] = ["binary", "version", "notice", "verifiedAt"];
const empty = (): SharedConfig => ({ version: 1, engines: {} });

export function sharedConfigDir(home: string = os.homedir()): string {
  return path.join(home, ".humanharness");
}

/**
 * `~/.humanharness/engines.json`, shared by every harness app. Each update re-reads the file and
 * writes atomically (temp file + rename), so apps don't drop each other's earlier changes.
 */
export class SharedConfigStore {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir: string) {
    this.file = path.join(dir, "engines.json");
  }

  async load(): Promise<SharedConfig> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, "utf8")) as Partial<SharedConfig> | null;
      if (raw?.version !== 1 || typeof raw.engines !== "object" || raw.engines === null) return empty();
      return { version: 1, engines: raw.engines };
    } catch {
      return empty();
    }
  }

  async engine(id: string): Promise<SharedEngineRecord> {
    return (await this.load()).engines[id] ?? {};
  }

  /** Merges `patch` into the engine's record. Unknown fields and undefined values are dropped. */
  update(id: string, patch: SharedEngineRecord): Promise<SharedEngineRecord> {
    const run = this.queue.then(async () => {
      const config = await this.load();
      const clean = Object.fromEntries(Object.entries(patch).filter(([k, v]) => FIELDS.includes(k) && v !== undefined));
      const next: SharedEngineRecord = { ...config.engines[id], ...clean };
      config.engines[id] = next;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, JSON.stringify(config, null, 2) + "\n");
        await fs.rename(tmp, this.file);
      } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/** Whether the record shows the legal notice accepted at the current version. */
export function noticeAccepted(record: SharedEngineRecord, currentVersion: number): boolean {
  return record.notice?.version === currentVersion;
}
```

- [ ] **Step 3: Verify**

Run: `corepack pnpm vitest run packages/shell/test/shared-config.test.ts && corepack pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add packages/shell/src/main/shared-config.ts packages/shell/test/shared-config.test.ts
git commit -m "feat(shell): shared engine config in ~/.humanharness"
```

---

### Task 5: Engine detection (installed, version, signed in)

**Files:**
- Modify: `packages/shell/src/main/engine-command.ts`, `packages/shell/test/engine-command.test.ts`
- Create: `packages/shell/src/main/engine-status.ts`, `packages/shell/test/engine-status.test.ts`

- [ ] **Step 1: Failing tests**

Append to `packages/shell/test/engine-command.test.ts` (add `cliCommand` to its import from `"../src/main/engine-command"`):
```ts
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
```

Create `packages/shell/test/engine-status.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { NOTICE_VERSION, getEngine } from "@humanharness/engines";
import type { CommandDeps } from "../src/main/engine-command";
import { detectEngine, parseLoggedIn } from "../src/main/engine-status";
import { SharedConfigStore } from "../src/main/shared-config";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const store = () => new SharedConfigStore(fs.mkdtempSync(path.join(root, "s-")));

type Reply = { stdout?: string; code?: number };

/** Fake commands answered by their args (bundled `.js` entries left out); the login shell gives /usr/bin. */
function deps(replies: Record<string, Reply>, overrides: Partial<CommandDeps> = {}) {
  const calls: { cmd: string; args: string[]; env?: Record<string, string> }[] = [];
  const d: CommandDeps = {
    shell: "/bin/zsh",
    home: "/Users/me",
    run: async (cmd, args, env) => {
      if (cmd === "/bin/zsh") return { stdout: "/usr/bin", code: 0 };
      calls.push({ cmd, args, env });
      const reply = replies[args.filter((a) => !a.endsWith(".js")).join(" ")];
      return { stdout: reply?.stdout ?? "", code: reply?.code ?? 1 };
    },
    isExecutable: async (p) => p === "/Users/me/.local/bin/claude",
    electronPath: "/App/Electron",
    resolveModule: () => {
      throw new Error("not bundled");
    },
    ...overrides,
  };
  return { d, calls };
}

const signedIn = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "someone@example.com", subscriptionType: "max" });
const signedOut = JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" });

describe("parseLoggedIn", () => {
  it("reads only the loggedIn flag from JSON, or the exit code", () => {
    expect(parseLoggedIn("json-logged-in", { stdout: signedIn, code: 0 })).toBe(true);
    expect(parseLoggedIn("json-logged-in", { stdout: signedOut, code: 1 })).toBe(false);
    expect(parseLoggedIn("json-logged-in", { stdout: "not json", code: 0 })).toBe(false);
    expect(parseLoggedIn("exit-code", { stdout: "", code: 0 })).toBe(true);
    expect(parseLoggedIn("exit-code", { stdout: "", code: 1 })).toBe(false);
  });
});

describe("detectEngine", () => {
  it("reports a ready Claude and remembers its path and version, never the account", async () => {
    const s = store();
    await s.update("claude", { notice: { version: NOTICE_VERSION, acceptedAt: "t" }, verifiedAt: "t" });
    const { d } = deps({ "--version": { stdout: "2.1.296 (Claude Code)\n", code: 0 }, "auth status --json": { stdout: signedIn, code: 0 } });
    expect(await detectEngine(getEngine("claude"), d, s)).toEqual({
      engineId: "claude",
      installed: true,
      version: "2.1.296",
      minVersion: "2.1.296",
      outdated: false,
      loggedIn: true,
      noticeAccepted: true,
      verified: true,
    });
    const saved = JSON.stringify(await s.load());
    expect(saved).toContain("/Users/me/.local/bin/claude");
    expect(saved).not.toContain("someone@example.com");
  });

  it("reports a signed-out Claude as not verified and not accepted", async () => {
    const s = store();
    await s.update("claude", { verifiedAt: "t" });
    const { d } = deps({ "--version": { stdout: "2.1.296 (Claude Code)", code: 0 }, "auth status --json": { stdout: signedOut, code: 1 } });
    expect(await detectEngine(getEngine("claude"), d, s)).toMatchObject({ loggedIn: false, verified: false, noticeAccepted: false });
  });

  it("flags an outdated Claude without checking the session", async () => {
    const { d, calls } = deps({ "--version": { stdout: "2.1.200 (Claude Code)", code: 0 } });
    expect(await detectEngine(getEngine("claude"), d, store())).toMatchObject({ installed: true, version: "2.1.200", outdated: true, loggedIn: null });
    expect(calls.map((c) => c.args.join(" "))).toEqual(["--version"]);
  });

  it("reports a missing Claude, or one whose --version fails, as not installed", async () => {
    const missing = deps({}, { isExecutable: async () => false });
    expect(await detectEngine(getEngine("claude"), missing.d, store())).toMatchObject({ installed: false, version: null, loggedIn: null });
    expect(missing.calls).toEqual([]);
    const broken = deps({ "--version": { code: 1 } });
    expect(await detectEngine(getEngine("claude"), broken.d, store())).toMatchObject({ installed: false });
  });

  it("checks Codex through the bundled CLI under Electron's Node", async () => {
    const { d, calls } = deps(
      { "--version": { stdout: "codex-cli 0.160.1", code: 0 }, "login status": { code: 1 } },
      { resolveModule: (id, from) => (from ? "/app/codex.js" : "/app/acp.js") },
    );
    expect(await detectEngine(getEngine("codex"), d, store())).toMatchObject({ installed: true, version: "0.160.1", loggedIn: false });
    expect(calls[0]).toMatchObject({ cmd: "/App/Electron", args: ["/app/codex.js", "--version"], env: { ELECTRON_RUN_AS_NODE: "1" } });
  });

  it("asks for the notice again after its version changes", async () => {
    const s = store();
    await s.update("claude", { notice: { version: NOTICE_VERSION - 1, acceptedAt: "t" } });
    const { d } = deps({ "--version": { stdout: "2.1.296", code: 0 }, "auth status --json": { stdout: signedIn, code: 0 } });
    expect((await detectEngine(getEngine("claude"), d, s)).noticeAccepted).toBe(false);
  });
});
```

Run: `corepack pnpm vitest run packages/shell/test/engine-command.test.ts packages/shell/test/engine-status.test.ts`
Expected: FAIL (`cliCommand`, `engine-status` missing; the fallback test fails).

- [ ] **Step 2: Implement — engine-command**

In `packages/shell/src/main/engine-command.ts`:

Change `CommandDeps` to:
```ts
export interface CommandDeps {
  shell: string;
  home: string;
  /** Runs a command to completion. `env` is added to the app's own environment (PATH and the like, never credentials). */
  run: (cmd: string, args: string[], env?: Record<string, string>) => Promise<{ stdout: string; code: number }>;
  isExecutable: (file: string) => Promise<boolean>;
  electronPath: string;
  /** Resolves a module path, from this package or (with `from`) from another module's location. */
  resolveModule: (id: string, from?: string) => string;
}
```

Add after `BUNDLED_ADAPTERS`:
```ts
/** Official CLIs bundled with an adapter, by engine id: resolved from the adapter's own location. */
const BUNDLED_CLIS: Record<string, { adapter: string; cli: string }> = {
  codex: { adapter: "@agentclientprotocol/codex-acp/dist/index.js", cli: "@openai/codex/bin/codex.js" },
};

/** Folders official installers use, searched after PATH: a fresh install may not be on the login PATH yet. */
export const knownBinDirs = (home: string): string[] => [path.join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];
```

Replace the fallback line in `loginShellPath` with:
```ts
  return [...knownBinDirs(d.home), "/usr/bin", "/bin"].join(":");
```

Replace `resolveBinary` with:
```ts
export async function resolveBinary(name: string, searchPath: string, d: CommandDeps): Promise<string | null> {
  const dirs = new Set([...searchPath.split(":").filter(Boolean), ...knownBinDirs(d.home)]);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (await d.isExecutable(candidate)) return candidate;
  }
  return null;
}
```

Append:
```ts
export interface CliCommand {
  command: string[];
  env: Record<string, string>;
  /** True when it is the copy bundled with the app (never installed or updated by the app). */
  bundled: boolean;
}

/** How the app runs an engine's own CLI (version, status, login, update). Null when it isn't there. */
export async function cliCommand(engine: EngineDef, d: CommandDeps): Promise<CliCommand | null> {
  const PATH = await loginShellPath(d);
  const bundled = BUNDLED_CLIS[engine.id];
  if (bundled) {
    try {
      const cli = d.resolveModule(bundled.cli, d.resolveModule(bundled.adapter));
      return { command: [d.electronPath, cli], env: { PATH, ELECTRON_RUN_AS_NODE: "1" }, bundled: true };
    } catch {
      // not bundled in this build: look for an installed CLI
    }
  }
  const binary = await resolveBinary(engine.detect.binary, PATH, d);
  return binary ? { command: [binary], env: { PATH }, bundled: false } : null;
}
```

- [ ] **Step 3: Implement — detection**

Create `packages/shell/src/main/engine-status.ts`:
```ts
import { type EngineDef, type EngineSetup, NOTICE_VERSION, meetsMinVersion, parseVersion } from "@humanharness/engines";
import type { EngineStatus } from "@humanharness/ui/client";
import { type CommandDeps, cliCommand } from "./engine-command";
import { type SharedConfigStore, noticeAccepted } from "./shared-config";

/**
 * Whether the status command says the user is signed in. For JSON output only `loggedIn` is read:
 * the rest (email, organization) is never kept or logged.
 */
export function parseLoggedIn(format: EngineSetup["status"]["format"], out: { stdout: string; code: number }): boolean {
  if (format === "exit-code") return out.code === 0;
  try {
    return (JSON.parse(out.stdout) as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    return false;
  }
}

/** Checks the engine's CLI: installed, version against `detect.minVersion`, signed in. Reads nothing from the CLI's own files. */
export async function detectEngine(engine: EngineDef, d: CommandDeps, shared: SharedConfigStore): Promise<EngineStatus> {
  const record = await shared.engine(engine.id);
  const base = {
    engineId: engine.id,
    minVersion: engine.detect.minVersion,
    noticeAccepted: noticeAccepted(record, NOTICE_VERSION),
  };
  const missing: EngineStatus = { ...base, installed: false, version: null, outdated: false, loggedIn: null, verified: false };

  const cli = await cliCommand(engine, d);
  if (!cli) return missing;
  const [binary, ...leading] = cli.command;
  const v = await d.run(binary, [...leading, ...engine.detect.versionArgs], cli.env);
  const version = v.code === 0 ? parseVersion(v.stdout) : null;
  if (!version) return missing;

  const outdated = !meetsMinVersion(version, engine.detect.minVersion);
  let loggedIn: boolean | null = null;
  if (engine.setup && !outdated) {
    const s = await d.run(binary, [...leading, ...engine.setup.status.args], cli.env);
    loggedIn = parseLoggedIn(engine.setup.status.format, s);
  }
  await shared.update(engine.id, { binary: cli.bundled ? undefined : binary, version }).catch(() => undefined);
  return { ...base, installed: true, version, outdated, loggedIn, verified: Boolean(record.verifiedAt) && loggedIn !== false };
}
```

- [ ] **Step 4: Verify**

Run: `corepack pnpm vitest run packages/shell && corepack pnpm typecheck`
Expected: PASS (the existing `engine-command` tests still pass: the fallback list is unchanged and their `run`/`resolveModule` fakes fit the wider signatures); typecheck clean. (`main/index.ts` still passes a two-argument `run` — that is valid; Task 9 adds `env`.)

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/main/engine-command.ts packages/shell/src/main/engine-status.ts packages/shell/test/engine-command.test.ts packages/shell/test/engine-status.test.ts
git commit -m "feat(shell): detect engines: installed, minimum version, signed in"
```

---

### Task 6: Official install, update, login and logout processes

**Files:**
- Create: `packages/shell/src/main/setup-runner.ts`, `packages/shell/test/setup-runner.test.ts`

- [ ] **Step 1: Failing test**

Create `packages/shell/test/setup-runner.test.ts`:
```ts
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
```

Run: `corepack pnpm vitest run packages/shell/test/setup-runner.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

Create `packages/shell/src/main/setup-runner.ts`:
```ts
import { spawn } from "node:child_process";
import type { EngineDef } from "@humanharness/engines";
import type { SetupOutput, SetupStep } from "@humanharness/ui/client";
import type { CliCommand } from "./engine-command";

export interface ProcessCommand {
  command: string[];
  env: Record<string, string>;
}

/**
 * The command for one setup step, or null when the engine has none. Install runs the provider's
 * official command through bash; update, login and logout run the engine's own CLI.
 */
export function setupCommand(engine: EngineDef, step: SetupStep, cli: CliCommand | null, PATH: string): ProcessCommand | null {
  const setup = engine.setup;
  if (!setup) return null;
  if (step === "install") return setup.install ? { command: ["/bin/bash", "-c", setup.install.command], env: { PATH } } : null;
  if (!cli) return null;
  const args = { login: setup.login, update: setup.update, logout: setup.logout }[step];
  return args ? { command: [...cli.command, ...args], env: cli.env } : null;
}

const URL_RE = /https:\/\/[^\s"'<>]+/;
// Colours and cursor moves that CLIs print even without a terminal.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

export interface RunningSetup {
  /** Writes one line to the process (e.g. a code from the sign-in page). */
  write(text: string): void;
  cancel(): void;
  /** The exit code; null when it was killed or couldn't start. */
  exit: Promise<number | null>;
}

/** Spawns one setup process and reports its output line by line, plus the first web address it prints. */
export function runSetupProcess(cmd: ProcessCommand, onOutput: (o: SetupOutput) => void): RunningSetup {
  const [binary, ...args] = cmd.command;
  const child = spawn(binary, args, { env: { ...process.env, ...cmd.env }, stdio: ["pipe", "pipe", "pipe"] });
  let urlSent = false;

  const emitLine = (raw: string) => {
    const text = raw.replace(ANSI, "").trim();
    if (!text) return;
    onOutput({ kind: "line", text });
    const url = urlSent ? undefined : URL_RE.exec(text)?.[0];
    if (url) {
      urlSent = true;
      onOutput({ kind: "url", url });
    }
  };
  const read = (stream: NodeJS.ReadableStream) => {
    let rest = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      rest += chunk;
      const lines = rest.split(/\r?\n|\r/);
      rest = lines.pop() ?? "";
      for (const line of lines) emitLine(line);
    });
    stream.on("end", () => {
      if (rest) emitLine(rest);
      rest = "";
    });
  };
  read(child.stdout!);
  read(child.stderr!);
  child.stdin!.on("error", () => {}); // the process may exit before reading

  const exit = new Promise<number | null>((resolve) => {
    child.on("error", (err) => {
      onOutput({ kind: "line", text: err.message });
      resolve(null);
    });
    child.on("close", (code) => resolve(code));
  });

  return {
    write: (text) => {
      if (child.stdin!.writable) child.stdin!.write(`${text.trim()}\n`);
    },
    cancel: () => {
      child.kill("SIGTERM");
    },
    exit,
  };
}
```

- [ ] **Step 3: Verify**

Run: `corepack pnpm vitest run packages/shell/test/setup-runner.test.ts && corepack pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add packages/shell/src/main/setup-runner.ts packages/shell/test/setup-runner.test.ts
git commit -m "feat(shell): run the official install, update, login and logout"
```

---

### Task 7: Test prompt

**Files:**
- Modify: `packages/shell/package.json` (devDependency)
- Create: `packages/shell/src/main/engine-check.ts`, `packages/shell/test/engine-check.test.ts`

- [ ] **Step 1: Add the fake agents to the shell's tests**

In `packages/shell/package.json`, add to `devDependencies`:
```json
    "@humanharness/fake-agent": "workspace:*",
```
Run: `corepack pnpm install`
Expected: the lockfile updates; no new downloads.

- [ ] **Step 2: Failing test**

Create `packages/shell/test/engine-check.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claudeResultLine, claudeTextLines, fakeAcpCommand, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { getEngine } from "@humanharness/engines";
import { TEST_PROMPT, testPrompt } from "../src/main/engine-check";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("testPrompt", () => {
  it("passes when Claude answers, sending the tiny prompt on stdin", async () => {
    const stdin = path.join(root, "stdin.txt");
    const r = await testPrompt(getEngine("claude"), {
      command: fakeClaudeCommand(),
      env: { HH_FAKE_SCRIPT: writeScript(root, { steps: [...claudeTextLines("OK"), claudeResultLine(true, "OK")] }), HH_FAKE_STDIN: stdin },
    });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(stdin, "utf8")).toBe(TEST_PROMPT);
  });

  it("returns the engine's error when it fails", async () => {
    const r = await testPrompt(getEngine("claude"), {
      command: fakeClaudeCommand(),
      env: { HH_FAKE_SCRIPT: writeScript(root, { steps: [claudeResultLine(false, "Not logged in · Please run /login")], exitCode: 1 }) },
    });
    expect(r).toMatchObject({ ok: false, error: { code: "session-expired" } });
  });

  it("passes when an ACP engine answers, in its read-only mode and without MCP servers", async () => {
    const log = path.join(root, "acp-log.jsonl");
    const r = await testPrompt(getEngine("codex"), {
      command: fakeAcpCommand(),
      env: {
        HH_FAKE_SCRIPT: writeScript(root, { turns: [[{ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "OK" } } }, { stop: "end_turn" }]] }),
        HH_FAKE_LOG: log,
      },
    });
    expect(r.ok).toBe(true);
    const requests = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method: string; params: any });
    expect(requests.find((q) => q.method === "session/set_mode")?.params.modeId).toBe("read-only");
    expect(requests.find((q) => q.method === "session/new")?.params.mcpServers).toEqual([]);
  });

  it("gives up after the timeout", async () => {
    const r = await testPrompt(
      getEngine("claude"),
      { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, { steps: [{ sleep: 5000 }] }) } },
      { timeoutMs: 200 },
    );
    expect(r).toMatchObject({ ok: false, error: { code: "cancelled" } });
  });
});
```

Run: `corepack pnpm vitest run packages/shell/test/engine-check.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `packages/shell/src/main/engine-check.ts`:
```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EngineDef } from "@humanharness/engines";
import {
  AcpTransport,
  ClaudeCliTransport,
  type EngineError,
  type Event,
  type Transport,
  type TransportOptions,
} from "@humanharness/runtime";

export const TEST_PROMPT = "Reply with the single word OK.";
const TIMEOUT_MS = 90_000;

/**
 * Runs one tiny turn in an empty temporary folder: read-only, no MCP servers, nothing saved.
 * It proves the CLI starts, the user is signed in and the plan answers.
 */
export async function testPrompt(
  engine: EngineDef,
  cmd: { command: string[]; env: Record<string, string> },
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; error?: EngineError }> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "hh-check-"));
  const options: TransportOptions = {
    folder,
    session: { id: randomUUID(), started: false },
    mcp: [],
    permissions: { edit: "none", exec: false, web: false },
    sessionMode: engine.transport.kind === "acp" ? engine.transport.modes?.readOnly : undefined,
    minAdapterVersion: engine.transport.kind === "acp" ? engine.transport.minAdapterVersion : undefined,
    command: cmd.command,
    env: cmd.env,
    onSessionStarted: () => {},
  };
  const transport: Transport = engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(options) : new AcpTransport(options);
  const events: Event[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    await transport.turn(TEST_PROMPT, (e) => events.push(e), controller.signal);
  } finally {
    clearTimeout(timer);
    await transport.close().catch(() => undefined);
    await fs.rm(folder, { recursive: true, force: true });
  }
  const done = events.find((e): e is Extract<Event, { type: "done" }> => e.type === "done");
  if (done?.ok) return { ok: true };
  return { ok: false, error: done && !done.ok ? done.error : { code: "agent-crashed" } };
}
```

- [ ] **Step 4: Verify**

Run: `corepack pnpm vitest run packages/shell/test/engine-check.test.ts && corepack pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/package.json pnpm-lock.yaml packages/shell/src/main/engine-check.ts packages/shell/test/engine-check.test.ts
git commit -m "feat(shell): test prompt over the engine's transport"
```

---
### Task 8: Usage log, usage on chat entries, actions, and the engine switch

**Files:**
- Modify: `packages/shell/src/main/chat-log.ts`, `packages/shell/src/main/turn-controller.ts`
- Create: `packages/shell/src/main/usage-log.ts`, `packages/shell/src/main/engine-switch.ts`
- Modify: `packages/shell/test/chat-log.test.ts`, `packages/shell/test/turn-controller.test.ts`
- Create: `packages/shell/test/usage-log.test.ts`, `packages/shell/test/engine-switch.test.ts`

`<folder>/.harness/usage.jsonl` — one line per turn the engine reported anything for; it never leaves the machine:
```json
{"at":"2026-10-11T14:02:00.000Z","engine":"claude","action":"tidy","ok":true,"usage":{"inputTokens":8,"outputTokens":379,"cacheReadTokens":63046,"cacheWriteTokens":0},"limits":[{"kind":"five_hour","utilization":0.27,"resetsAt":"2026-10-11T18:00:00.000Z"},{"kind":"seven_day","utilization":0.1,"resetsAt":"2026-10-16T09:00:00.000Z"}]}
```

- [ ] **Step 1: Failing tests — chat log and switch**

Append to `packages/shell/test/chat-log.test.ts`:
```ts
describe("TurnRecorder usage", () => {
  it("keeps tokens, limits and the latest state blocks on the reply", () => {
    const r = new TurnRecorder(new Set(["progress"]));
    const windows = [{ kind: "five_hour", utilization: 0.3, resetsAt: "2026-10-11T15:00:00.000Z" }];
    r.add({ type: "block", name: "progress", data: { percent: 10 } });
    r.add({ type: "block", name: "progress", data: { percent: 40 } });
    r.add({ type: "limits", status: "allowed", windows });
    r.add({ type: "usage", inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, costEquivalentUsd: 0.5 });
    expect(r.finish({ type: "done", ok: true })).toMatchObject({
      usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
      limits: windows,
      state: { progress: { percent: 40 } },
    });
  });

  it("adds nothing when the engine reported nothing", () => {
    const entry = new TurnRecorder(new Set()).finish({ type: "done", ok: true });
    expect("usage" in entry || "limits" in entry || "state" in entry).toBe(false);
  });
});

describe("ChatLog.archive", () => {
  it("moves the conversation to chats/archive and starts empty", async () => {
    const folder = fs.mkdtempSync(path.join(root, "f-"));
    const log = new ChatLog(folder);
    await log.append({ id: "1", role: "user", text: "hi", blocks: [], activities: [], at: "t1" });
    const target = await log.archive("claude");
    expect(target).toMatch(/\.harness\/chats\/archive\/.+-claude\.jsonl$/);
    expect(fs.readFileSync(target!, "utf8")).toContain('"hi"');
    expect(await log.load()).toEqual([]);
  });

  it("does nothing when there is no conversation", async () => {
    const folder = fs.mkdtempSync(path.join(root, "f-"));
    expect(await new ChatLog(folder).archive("claude")).toBeNull();
    expect(fs.existsSync(path.join(folder, ".harness", "chats", "archive"))).toBe(false);
  });
});
```

Create `packages/shell/test/engine-switch.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ChatLog } from "../src/main/chat-log";
import { sessionEngine, startNewChatIfEngineChanged } from "../src/main/engine-switch";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

async function folderWith(engine: string | null, chat: boolean) {
  const folder = fs.mkdtempSync(path.join(root, "f-"));
  fs.mkdirSync(path.join(folder, ".harness"), { recursive: true });
  if (engine) fs.writeFileSync(path.join(folder, ".harness", "session.json"), JSON.stringify({ engine, id: "s1", started: true }));
  if (chat) await new ChatLog(folder).append({ id: "1", role: "user", text: "earlier", blocks: [], activities: [], at: "t" });
  return folder;
}

describe("startNewChatIfEngineChanged", () => {
  it("archives the chat and forgets the session when the engine changed", async () => {
    const folder = await folderWith("claude", true);
    expect(await sessionEngine(folder)).toBe("claude");
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBe("claude");
    expect(await new ChatLog(folder).load()).toEqual([]);
    expect(fs.existsSync(path.join(folder, ".harness", "session.json"))).toBe(false);
    expect(fs.readdirSync(path.join(folder, ".harness", "chats", "archive"))).toHaveLength(1);
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBeNull();
  });

  it("keeps everything when the engine is the same or there was no session", async () => {
    const same = await folderWith("claude", true);
    expect(await startNewChatIfEngineChanged(same, "claude")).toBeNull();
    expect(await new ChatLog(same).load()).toHaveLength(1);
    const none = await folderWith(null, true);
    expect(await startNewChatIfEngineChanged(none, "codex")).toBeNull();
    expect(await new ChatLog(none).load()).toHaveLength(1);
  });

  it("only forgets the session when there was no chat to archive", async () => {
    const folder = await folderWith("claude", false);
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBeNull();
    expect(fs.existsSync(path.join(folder, ".harness", "session.json"))).toBe(false);
  });
});
```

- [ ] **Step 2: Failing tests — usage log and turns**

Create `packages/shell/test/usage-log.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ChatEntry } from "@humanharness/ui/client";
import { type UsageRecord, UsageLog, summarizeUsage, usageRecord } from "../src/main/usage-log";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const R1 = "2026-10-11T15:00:00.000Z";
const R2 = "2026-10-11T20:00:00.000Z";
const WEEK = "2026-10-16T09:00:00.000Z";
const rec = (fiveHour: number, resetsAt: string, action?: string): UsageRecord => ({
  at: "t",
  engine: "claude",
  ok: true,
  ...(action ? { action } : {}),
  limits: [
    { kind: "five_hour", utilization: fiveHour, resetsAt },
    { kind: "seven_day", utilization: 0.05, resetsAt: WEEK },
  ],
});

describe("UsageLog", () => {
  it("appends and loads records, skipping broken lines", async () => {
    const folder = fs.mkdtempSync(path.join(root, "f-"));
    const log = new UsageLog(folder);
    await log.append(rec(0.1, R1));
    fs.appendFileSync(path.join(folder, ".harness", "usage.jsonl"), "{broken\n");
    await log.append(rec(0.2, R1, "tidy"));
    expect((await log.load()).map((r) => r.action)).toEqual([undefined, "tidy"]);
  });
});

describe("usageRecord", () => {
  const entry: ChatEntry = { id: "a", role: "assistant", text: "", blocks: [], activities: [], at: "2026-10-11T14:00:00.000Z" };

  it("is null when the engine reported nothing", () => {
    expect(usageRecord(entry, "claude")).toBeNull();
  });

  it("keeps the engine, action, outcome, tokens and limits", () => {
    const usage = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 };
    expect(usageRecord({ ...entry, usage, error: { code: "cancelled" } }, "codex", "tidy")).toEqual({
      at: "2026-10-11T14:00:00.000Z",
      engine: "codex",
      action: "tidy",
      ok: false,
      usage,
    });
  });
});

describe("summarizeUsage", () => {
  const now = new Date("2026-10-11T16:00:00.000Z");

  it("has no limits until the engine reports some", () => {
    expect(summarizeUsage([], now)).toEqual({ limits: null, estimates: {} });
  });

  it("returns the latest windows that haven't reset yet", () => {
    expect(summarizeUsage([rec(0.1, R1), rec(0.3, R2)], now).limits).toEqual(rec(0.3, R2).limits);
    expect(summarizeUsage([rec(0.3, R1)], now).limits).toEqual([{ kind: "seven_day", utilization: 0.05, resetsAt: WEEK }]);
  });

  it("estimates each action from the rise of the five-hour window in the same window", () => {
    const records = [
      rec(0.1, R1),
      rec(0.18, R1, "tidy"), // +0.08
      rec(0.2, R1),
      rec(0.3, R1, "tidy"), // +0.10
      rec(0.05, R2, "tidy"), // the window reset: not measured
    ];
    const { estimates } = summarizeUsage(records, now);
    expect(Object.keys(estimates)).toEqual(["tidy"]);
    expect(estimates.tidy).toBeCloseTo(0.09);
  });
});
```

Append to `packages/shell/test/turn-controller.test.ts` (add `EngineUnavailable` to its import from `"../src/main/turn-controller"`):
```ts
describe("TurnController usage and actions", () => {
  it("tags the turn with its action and records usage before telling the window", async () => {
    const fake = fakeRuntime();
    const order: string[] = [];
    const entries: ChatEntry[] = [];
    const recorded: [ChatEntry, string | undefined][] = [];
    const controller = new TurnController({
      ensureRuntime: async () => fake.runtime,
      chatLog: async () => ({
        append: async (e) => {
          entries.push(e);
          order.push(`log:${e.role}`);
        },
      }),
      stateBlocks: () => new Set(["progress"]),
      emit: (e) => order.push(`emit:${e.type}`),
      recordUsage: async (entry, action) => {
        recorded.push([entry, action]);
        order.push("usage");
      },
    });
    const sent = controller.send("tidy up", { action: "tidy" });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    const windows = [{ kind: "five_hour", utilization: 0.2, resetsAt: "2026-10-11T15:00:00.000Z" }];
    fake.finish([
      { type: "block", name: "progress", data: { percent: 50 } },
      { type: "limits", status: "allowed", windows },
      { type: "usage", inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0 },
      { type: "done", ok: true },
    ]);
    await sent;
    expect(entries[0]).toMatchObject({ role: "user", text: "tidy up", action: "tidy" });
    expect(entries[1]).toMatchObject({
      role: "assistant",
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0 },
      limits: windows,
      state: { progress: { percent: 50 } },
    });
    expect(recorded).toEqual([[entries[1], "tidy"]]);
    expect(order.slice(-3)).toEqual(["log:assistant", "usage", "emit:done"]);
  });

  it("still ends the turn when recording usage fails", async () => {
    const fake = fakeRuntime();
    const events: Event[] = [];
    const controller = new TurnController({
      ensureRuntime: async () => fake.runtime,
      chatLog: async () => ({ append: async () => {} }),
      stateBlocks: () => new Set(),
      emit: (e) => events.push(e),
      recordUsage: async () => {
        throw new Error("disk full");
      },
    });
    const sent = controller.send("hi");
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([{ type: "done", ok: true }]);
    await sent;
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
  });

  it("ends the turn with the engine's own error when it can't run", async () => {
    const { controller, events, entries } = setup({
      ensureRuntime: async () => {
        throw new EngineUnavailable("outdated-version");
      },
    });
    await controller.send("hi");
    expect(events.at(-1)).toEqual({ type: "done", ok: false, error: { code: "outdated-version" } });
    expect(entries.at(-1)?.error).toEqual({ code: "outdated-version" });
  });
});
```

Run: `corepack pnpm vitest run packages/shell`
Expected: FAIL (`archive`, `engine-switch`, `usage-log`, `EngineUnavailable`, `recordUsage` missing; the recorder drops usage).

- [ ] **Step 3: Implement — chat log**

Replace `packages/shell/src/main/chat-log.ts` with:
```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Event, LimitWindow } from "@humanharness/runtime";
import type { ChatEntry, TurnUsage } from "@humanharness/ui/client";

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

  /** Moves the conversation to `chats/archive/<time>-<label>.jsonl`. Null when there was none. */
  async archive(label: string): Promise<string | null> {
    try {
      await fs.access(this.file);
    } catch {
      return null;
    }
    const dir = path.join(path.dirname(this.file), "archive");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(dir, `${stamp}-${label.replace(/[^a-z0-9-]/gi, "")}.jsonl`);
    await fs.mkdir(dir, { recursive: true });
    await fs.rename(this.file, target);
    return target;
  }
}

/** Accumulates one turn's events into the assistant entry that gets saved. */
export class TurnRecorder {
  private text = "";
  private blocks: ChatEntry["blocks"] = [];
  private activities: ChatEntry["activities"] = [];
  private usage: TurnUsage | undefined;
  private limits: LimitWindow[] | undefined;
  private state: Record<string, unknown> = {};

  constructor(private readonly stateBlocks: Set<string>) {}

  add(e: Event): void {
    if (e.type === "text") this.text += e.delta;
    else if (e.type === "paragraph" && this.text) this.text += "\n\n";
    else if (e.type === "activity" && e.state === "start") this.activities.push({ kind: e.kind, detail: e.detail });
    else if (e.type === "block") {
      if (this.stateBlocks.has(e.name)) this.state[e.name] = e.data;
      else this.blocks.push({ name: e.name, data: e.data });
    } else if (e.type === "limits") this.limits = e.windows;
    else if (e.type === "usage") {
      this.usage = {
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        cacheReadTokens: e.cacheReadTokens,
        cacheWriteTokens: e.cacheWriteTokens,
      };
    }
  }

  finish(done: Extract<Event, { type: "done" }>): ChatEntry {
    return {
      id: randomUUID(),
      role: "assistant",
      text: this.text.trim(),
      blocks: this.blocks,
      activities: this.activities,
      at: new Date().toISOString(),
      ...(this.usage ? { usage: this.usage } : {}),
      ...(this.limits ? { limits: this.limits } : {}),
      ...(Object.keys(this.state).length ? { state: this.state } : {}),
      ...(done.ok ? {} : { error: done.error }),
    };
  }
}
```

- [ ] **Step 4: Implement — engine switch and usage log**

Create `packages/shell/src/main/engine-switch.ts`:
```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { ChatLog } from "./chat-log";

const sessionFile = (folder: string) => path.join(folder, ".harness", "session.json");

/** The engine of the folder's saved agent session (written by the runtime), if any. */
export async function sessionEngine(folder: string): Promise<string | null> {
  try {
    const saved = JSON.parse(await fs.readFile(sessionFile(folder), "utf8")) as { engine?: unknown };
    return typeof saved.engine === "string" ? saved.engine : null;
  } catch {
    return null;
  }
}

/**
 * A new engine can't continue another engine's session, so the conversation starts over: the chat
 * moves to `chats/archive/` and the old session is forgotten. Returns the previous engine id when
 * a chat was archived.
 */
export async function startNewChatIfEngineChanged(folder: string, engineId: string): Promise<string | null> {
  const previous = await sessionEngine(folder);
  if (!previous || previous === engineId) return null;
  const archived = await new ChatLog(folder).archive(previous);
  await fs.rm(sessionFile(folder), { force: true });
  return archived ? previous : null;
}
```

Create `packages/shell/src/main/usage-log.ts`:
```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LimitWindow } from "@humanharness/runtime";
import type { ChatEntry, TurnUsage, UsageSummary } from "@humanharness/ui/client";

/** One turn in `<folder>/.harness/usage.jsonl`. Only what the engine reported; never leaves the machine. */
export interface UsageRecord {
  at: string;
  engine: string;
  action?: string;
  ok: boolean;
  usage?: TurnUsage;
  limits?: LimitWindow[];
}

export class UsageLog {
  private readonly file: string;

  constructor(folder: string) {
    this.file = path.join(folder, ".harness", "usage.jsonl");
  }

  async append(record: UsageRecord): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.appendFile(this.file, JSON.stringify(record) + "\n");
  }

  async load(limit = 500): Promise<UsageRecord[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch {
      return [];
    }
    const records: UsageRecord[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as UsageRecord);
      } catch {
        // skip a broken line
      }
    }
    return records.slice(-limit);
  }
}

/** The usage record for a finished turn, or null when the engine reported nothing. */
export function usageRecord(entry: ChatEntry, engine: string, action?: string): UsageRecord | null {
  if (!entry.usage && !entry.limits) return null;
  return {
    at: entry.at,
    engine,
    ...(action ? { action } : {}),
    ok: !entry.error,
    ...(entry.usage ? { usage: entry.usage } : {}),
    ...(entry.limits ? { limits: entry.limits } : {}),
  };
}

const FIVE_HOUR = "five_hour";

/**
 * Current limits and per-action estimates. An action's estimate is the mean rise of the five-hour
 * window over its turns, each measured against the previous snapshot of the same window. Other use
 * of the same account counts too, so it is a rough guide.
 */
export function summarizeUsage(records: UsageRecord[], now: Date = new Date()): UsageSummary {
  const snapshots = records.filter((r) => r.limits && r.limits.length > 0);
  const last = snapshots.at(-1);
  const sums: Record<string, { total: number; n: number }> = {};
  for (let i = 1; i < snapshots.length; i++) {
    const r = snapshots[i];
    if (!r.action) continue;
    const before = snapshots[i - 1].limits!.find((w) => w.kind === FIVE_HOUR);
    const after = r.limits!.find((w) => w.kind === FIVE_HOUR);
    if (!before || !after || before.resetsAt !== after.resetsAt) continue;
    const sum = (sums[r.action] ??= { total: 0, n: 0 });
    sum.total += Math.max(0, after.utilization - before.utilization);
    sum.n++;
  }
  return {
    limits: last ? last.limits!.filter((w) => Date.parse(w.resetsAt) > now.getTime()) : null,
    estimates: Object.fromEntries(Object.entries(sums).map(([action, s]) => [action, s.total / s.n])),
  };
}
```

- [ ] **Step 5: Implement — turns**

Replace `packages/shell/src/main/turn-controller.ts` with (changes from 2a: `SendOptions`, `recordUsage`, `EngineUnavailable`; `memoise` unchanged):
```ts
import { randomUUID } from "node:crypto";
import { type Event, type HarnessRuntime, type RunningTurn, fail } from "@humanharness/runtime";
import type { ChatEntry, SendOptions } from "@humanharness/ui/client";
import { TurnRecorder } from "./chat-log";

type Done = Extract<Event, { type: "done" }>;

export interface ChatLogLike {
  append(entry: ChatEntry): Promise<void>;
}

/** Thrown by `ensureRuntime` when the engine can't run turns: the turn ends with this error code. */
export class EngineUnavailable extends Error {
  constructor(readonly code: "engine-not-installed" | "outdated-version" | "session-expired") {
    super(`The engine can't run: ${code}`);
  }
}

export interface TurnDeps {
  /** Starts (or returns) the runtime. Null when the engine CLI isn't installed. May throw EngineUnavailable. */
  ensureRuntime: () => Promise<HarnessRuntime | null>;
  /** The chat log of the configured folder, or null when the app isn't configured yet. */
  chatLog: () => Promise<ChatLogLike | null>;
  stateBlocks: () => Set<string>;
  /** Sends an event to the window. May throw (window gone): that never loses the log entry. */
  emit: (e: Event) => void;
  /** Saves the finished turn's usage (usage.jsonl). Failures are logged, never thrown. */
  recordUsage?: (entry: ChatEntry, action: string | undefined) => Promise<void>;
}

/** One message's lifecycle: log, start the runtime, run the turn, log the reply and its usage, then tell the window. */
export class TurnController {
  private turn: { cancelled: boolean; running: RunningTurn | null } | null = null;
  private writes: Promise<void> = Promise.resolve();
  private active: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly deps: TurnDeps) {}

  /** A turn is starting or running. */
  isBusy(): boolean {
    return this.turn !== null;
  }

  cancel(): void {
    if (!this.turn) return;
    this.turn.cancelled = true;
    this.turn.running?.cancel();
  }

  /** For quitting: cancels the current turn and rejects every later send. */
  close(): void {
    this.closed = true;
    this.cancel();
  }

  /** Resolves once the current turn has ended and every queued chat-log write has settled. */
  async flush(): Promise<void> {
    await this.active.catch(() => undefined);
    let seen: Promise<void>;
    do {
      seen = this.writes;
      await seen;
    } while (seen !== this.writes);
  }

  /** Rejects when the app is closing, a turn is already running, or the app isn't set up. */
  send(message: string, options: SendOptions = {}): Promise<void> {
    if (this.closed) return Promise.reject(new Error("The app is closing"));
    if (this.turn) return Promise.reject(new Error("A turn is already running"));
    this.active = this.run(message, options.action);
    return this.active;
  }

  private async run(message: string, action: string | undefined): Promise<void> {
    const turn: { cancelled: boolean; running: RunningTurn | null } = { cancelled: false, running: null };
    this.turn = turn;
    try {
      const log = await this.deps.chatLog();
      if (!log) throw new Error("The app is not set up yet");
      void this.write(log, {
        id: randomUUID(),
        role: "user",
        text: message,
        blocks: [],
        activities: [],
        at: new Date().toISOString(),
        ...(action ? { action } : {}),
      });
      const recorder = new TurnRecorder(this.deps.stateBlocks());
      const finish = async (done: Done) => {
        const entry = recorder.finish(done);
        await this.write(log, entry);
        await this.recordUsage(entry, action);
        this.emit(done);
      };

      if (turn.cancelled) return await finish(fail("cancelled") as Done);
      let rt: HarnessRuntime | null;
      try {
        rt = await this.deps.ensureRuntime();
      } catch (e) {
        if (e instanceof EngineUnavailable) return await finish(fail(e.code) as Done);
        return await finish(fail("agent-crashed", e instanceof Error ? e.message : String(e)) as Done);
      }
      if (turn.cancelled) return await finish(fail("cancelled") as Done);
      if (!rt) return await finish(fail("engine-not-installed") as Done);

      let finished: Promise<void> = Promise.resolve();
      turn.running = rt.send(message, (e) => {
        if (e.type === "done") finished = finish(e);
        else {
          recorder.add(e);
          this.emit(e);
        }
      });
      await turn.running.done;
      await finished;
    } finally {
      this.turn = null;
    }
  }

  private emit(e: Event): void {
    try {
      this.deps.emit(e);
    } catch (err) {
      console.error("Could not send an event to the window", err);
    }
  }

  private async recordUsage(entry: ChatEntry, action: string | undefined): Promise<void> {
    try {
      await this.deps.recordUsage?.(entry, action);
    } catch (err) {
      console.error("Could not save usage", err);
    }
  }

  /** Queues a log write: writes stay in order and a failure never rejects. */
  private write(log: ChatLogLike, entry: ChatEntry): Promise<void> {
    this.writes = this.writes.then(() =>
      log.append(entry).catch((err: unknown) => console.error("Could not save the chat", err)),
    );
    return this.writes;
  }
}

/**
 * Shares one in-flight call of `fn` and keeps its result. A failure or a null result
 * isn't kept, so the next call tries again (e.g. after installing the CLI).
 */
export function memoise<T>(fn: () => Promise<T | null>) {
  let promise: Promise<T | null> | null = null;
  return {
    get(): Promise<T | null> {
      if (!promise) {
        const p = fn().then(
          (v) => {
            if (v === null && promise === p) promise = null;
            return v;
          },
          (err: unknown) => {
            if (promise === p) promise = null;
            throw err;
          },
        );
        promise = p;
      }
      return promise;
    },
    /** The current or in-flight result, without starting anything. */
    peek(): Promise<T | null> | null {
      return promise;
    },
    clear(): void {
      promise = null;
    },
  };
}
```

- [ ] **Step 6: Verify**

Run: `corepack pnpm vitest run packages/shell && corepack pnpm typecheck`
Expected: PASS (old and new shell tests); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shell/src/main packages/shell/test
git commit -m "feat(shell): usage log, usage on chat entries, actions and new chat on engine switch"
```

---

### Task 9: Main process wiring, window chrome and appearance

**Files:**
- Create: `packages/shell/src/main/assets.ts`, `packages/shell/test/assets.test.ts`
- Modify: `packages/shell/src/main/validate.ts`, `packages/shell/test/validate.test.ts`
- Modify: `packages/shell/src/main/index.ts` (full replacement), `packages/shell/src/renderer/main.tsx`, `packages/shell/package.json`
- Possibly modify: `packages/shell/electron.vite.config.ts` (Step 6)

- [ ] **Step 1: Failing tests**

Create `packages/shell/test/assets.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { imageDataUrl } from "../src/main/assets";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("imageDataUrl", () => {
  it("turns an image file into a data: URL the renderer's CSP allows", async () => {
    const file = path.join(root, "logo.svg");
    fs.writeFileSync(file, "<svg/>");
    expect(await imageDataUrl(file)).toBe(`data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`);
  });

  it("returns null for other file types and missing files", async () => {
    const file = path.join(root, "notes.txt");
    fs.writeFileSync(file, "x");
    expect(await imageDataUrl(file)).toBeNull();
    expect(await imageDataUrl(path.join(root, "missing.png"))).toBeNull();
  });
});
```

Append inside `describe("configProblem")` in `packages/shell/test/validate.test.ts`:
```ts
  it("accepts only the known appearances", async () => {
    expect(await configProblem({ appearance: "dark" }, ctx)).toBeNull();
    expect(await configProblem({ appearance: "neon" as never }, ctx)).toBe("invalid");
  });
```

Run: `corepack pnpm vitest run packages/shell/test/assets.test.ts packages/shell/test/validate.test.ts`
Expected: FAIL (`assets.ts` missing; any appearance passes).

- [ ] **Step 2: Implement the helpers**

Create `packages/shell/src/main/assets.ts`:
```ts
import { promises as fs } from "node:fs";
import path from "node:path";

const TYPES: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/** An image file as a data: URL for the renderer (its CSP allows `img-src data:`). Null when missing or not an image. */
export async function imageDataUrl(file: string): Promise<string | null> {
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return null;
  try {
    return `data:${type};base64,${(await fs.readFile(file)).toString("base64")}`;
  } catch {
    return null;
  }
}
```

In `packages/shell/src/main/validate.ts`, add as the third check of `configProblem` (after the `language` check):
```ts
  if (c.appearance !== undefined && !["system", "light", "dark"].includes(c.appearance as string)) return "invalid";
```

Run: `corepack pnpm vitest run packages/shell/test/assets.test.ts packages/shell/test/validate.test.ts`
Expected: PASS.

- [ ] **Step 3: Bundle the display font**

In `packages/shell/package.json`, add to `devDependencies`:
```json
    "@fontsource/lexend": "5.3.0",
```
Run: `corepack pnpm install`
Expected: installs `@fontsource/lexend@5.3.0` (OFL-1.1). If pnpm rejects it under the minimum release age, add `"@fontsource/lexend@5.3.0"` to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` and mention it in your report.

Replace `packages/shell/src/renderer/main.tsx` with:
```tsx
import { createRoot } from "react-dom/client";
import App from "@harness/ui";
// Lexend for display text, bundled with the app (no network fonts).
import "@fontsource/lexend/500.css";
import "@fontsource/lexend/600.css";
import "@humanharness/ui/styles.css";

createRoot(document.getElementById("root")!).render(<App client={window.hh} />);
```

- [ ] **Step 4: Wire the main process**

Replace `packages/shell/src/main/index.ts` with:
```ts
import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, type IpcMainInvokeEvent, app, dialog, ipcMain, nativeTheme, shell } from "electron";
import { electronLauncher } from "@humanharness/blocks";
import { type EngineDef, NOTICE_VERSION, availableEngines, getEngine } from "@humanharness/engines";
import { type LoadedHarness, loadHarness, resolveInHarness } from "@humanharness/harness-sdk";
import { type Event, type HarnessRuntime, createRuntime } from "@humanharness/runtime";
import {
  type AppConfig,
  type AppState,
  type ChatLoad,
  type ConfiguredApp,
  type FolderPick,
  type SendOptions,
  type SetupStep,
  type UsageSummary,
  isConfigured,
} from "@humanharness/ui/client";
import { History } from "@humanharness/workspace";
import { imageDataUrl } from "./assets";
import { ChatLog } from "./chat-log";
import { ConfigStore, historyDir } from "./config";
import { testPrompt } from "./engine-check";
import { type CommandDeps, cliCommand, engineCommand, loginShellPath } from "./engine-command";
import { detectEngine } from "./engine-status";
import { startNewChatIfEngineChanged } from "./engine-switch";
import { type RunningSetup, runSetupProcess, setupCommand } from "./setup-runner";
import { SharedConfigStore, sharedConfigDir } from "./shared-config";
import { EngineUnavailable, TurnController, memoise } from "./turn-controller";
import { UsageLog, summarizeUsage, usageRecord } from "./usage-log";
import { type ValidationContext, checkFolder, configProblem, isAppUrl } from "./validate";

declare const __HARNESS_DIR__: string;

/** The window's background before the page paints (the `paper` token), so there is no white flash. */
const PAPER = { light: "#F4F4F1", dark: "#161819" };
const SETUP_STEPS: SetupStep[] = ["install", "update", "login", "logout"];

const requireFromHere = createRequire(import.meta.url);
const commandDeps: CommandDeps = {
  shell: process.env.SHELL || "/bin/zsh",
  home: os.homedir(),
  run: (cmd, args, env) =>
    new Promise((resolve) => {
      execFile(cmd, args, { timeout: 10_000, env: { ...process.env, ...env } }, (err, stdout) => {
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
        resolve({ stdout: String(stdout), code });
      });
    }),
  isExecutable: (file) => fs.access(file, constants.X_OK).then(() => true, () => false),
  electronPath: process.execPath,
  resolveModule: (id, from) => (from ? createRequire(from) : requireFromHere).resolve(id),
};

let harness: LoadedHarness;
let config: ConfigStore;
let shared: SharedConfigStore;
let window: BrowserWindow | null = null;
/** Settles when the last restore done without a runtime has finished. */
let restoring: Promise<unknown> = Promise.resolve();
/** A restore was asked for and hasn't finished (including finding the history). */
let restorePending = false;
/** Set on the first before-quit: from then on, no new turns or restores. */
let quitting = false;
/** The install, update, login or logout running now, if any (one at a time). */
let setupRun: RunningSetup | null = null;
/** Logos as data: URLs, read once. */
const logos = new Map<string, Promise<string | null>>();

const mode = () => (app.isPackaged ? "distribution" : "development");
const stateBlocks = () => new Set(Object.entries(harness.blocks).filter(([, b]) => !b.visible).map(([n]) => n));
const rendererFile = path.join(__dirname, "../renderer/index.html");
// The dev server is only trusted in development: a packaged app always loads its own file.
const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const appUrl = (url: string) => isAppUrl(url, { devUrl, rendererFile });
const validation = (): ValidationContext => ({
  engineIds: availableEngines(harness.engines, mode()).map((e) => e.id),
  languages: harness.languages,
  home: os.homedir(),
});

/** An engine this harness offers in this build. The id comes from the window, so anything else throws. */
function engineFor(id: unknown): EngineDef {
  const engine = availableEngines(harness.engines, mode()).find((e) => e.id === id);
  if (!engine) throw new Error("This engine is not available");
  return engine;
}

function logo(key: string, file: () => string): Promise<string | null> {
  if (!logos.has(key)) {
    logos.set(
      key,
      (async () => {
        try {
          return await imageDataUrl(file());
        } catch {
          return null;
        }
      })(),
    );
  }
  return logos.get(key)!;
}

const harnessLogo = () => (harness.logo ? logo("harness", () => resolveInHarness(harness, harness.logo!)) : Promise.resolve(null));
// Engine logos ship in the engines package (exported as "./assets/*").
const engineLogo = (e: EngineDef) => (e.logo ? logo(e.id, () => requireFromHere.resolve(`@humanharness/engines/${e.logo}`)) : Promise.resolve(null));

async function appState(): Promise<AppState> {
  const harnessImage = await harnessLogo();
  return {
    harness: {
      id: harness.id,
      name: harness.name,
      languages: harness.languages,
      ...(harness.tagline ? { tagline: harness.tagline } : {}),
      ...(harnessImage ? { logo: harnessImage } : {}),
      author: harness.author,
      ...(harness.donate ? { donate: harness.donate } : {}),
      version: app.getVersion(),
    },
    config: await config.load(),
    suggestedFolder: path.join(os.homedir(), harness.folder.suggested),
    engines: await Promise.all(
      availableEngines(harness.engines, mode()).map(async (e) => {
        const image = await engineLogo(e);
        return {
          id: e.id,
          name: e.name,
          status: e.status as "allowed" | "pending",
          provider: e.provider,
          requires: e.requires,
          dataLocation: e.dataLocation,
          trainsOnData: e.trainsOnData,
          termsUrl: e.termsUrl,
          privacyUrl: e.privacyUrl,
          reportsLimits: e.reportsLimits,
          ...(e.setup?.install ? { installCommand: e.setup.install.command, installDocsUrl: e.setup.install.docsUrl } : {}),
          ...(image ? { logo: image } : {}),
        };
      }),
    ),
    actions: harness.actions,
  };
}

/** The saved config, only when it is complete and valid. */
async function validConfig(): Promise<ConfiguredApp | null> {
  const c = await config.load();
  return isConfigured(c) && (await configProblem(c, validation())) === null ? c : null;
}

function applyAppearance(appearance: AppConfig["appearance"]) {
  nativeTheme.themeSource = appearance ?? "system";
  window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light);
}

const runtime = memoise<HarnessRuntime>(async () => {
  const c = await config.load();
  if (!isConfigured(c)) throw new Error("The app is not set up yet");
  const problem = await configProblem(c, validation());
  if (problem) throw new Error(problem);
  await restoring;
  const engine = getEngine(c.engineId);
  // Spec §9 "every start": enforce detect.minVersion and a signed-in CLI before the first turn.
  const status = await detectEngine(engine, commandDeps, shared);
  if (!status.installed) return null;
  if (status.outdated) throw new EngineUnavailable("outdated-version");
  if (status.loggedIn === false) throw new EngineUnavailable("session-expired");
  const cmd = await engineCommand(engine, commandDeps);
  if (!cmd) return null;
  return createRuntime({
    harness,
    engine,
    folder: c.folder,
    gitdir: historyDir(app.getPath("userData"), c.folder),
    language: c.language,
    launcher: electronLauncher(process.execPath),
    uiServerEntry: path.join(__dirname, "ui-server.js"),
    command: cmd.command,
    env: cmd.env,
  });
});

/** Closes the running runtime (e.g. the engine changed); the next turn starts a new one. */
async function dropRuntime() {
  const rt = await runtime.peek()?.catch(() => null);
  runtime.clear();
  await rt?.close();
}

/** The running runtime's history, or one opened on the configured folder when there is no runtime. */
async function currentHistory(): Promise<History | null> {
  const rt = await runtime.peek()?.catch(() => null);
  if (rt) return rt.history;
  const c = await validConfig();
  if (!c) return null;
  const extra = getEngine(c.engineId).instructionsFile?.path;
  // Same ignore list as the runtime's: its files under .harness/ and the generated instructions.
  const history = new History(c.folder, historyDir(app.getPath("userData"), c.folder), [".harness/", "AGENTS.md", ...(extra ? [extra] : [])]);
  await history.init();
  return history;
}

function sendToWindow(channel: string, value: unknown) {
  try {
    if (window && !window.isDestroyed()) window.webContents.send(channel, value);
  } catch (err) {
    console.error("Could not send to the window", err);
  }
}
const emit = (event: Event) => sendToWindow("hh:event", event);

const turns = new TurnController({
  ensureRuntime: () => runtime.get(),
  chatLog: async () => {
    const c = await config.load();
    if (!isConfigured(c)) return null;
    // An invalid saved config still runs the turn, so the runtime start fails with the reason;
    // nothing is written into a folder that didn't pass validation.
    return (await configProblem(c, validation())) === null ? new ChatLog(c.folder) : { append: async () => {} };
  },
  stateBlocks,
  emit,
  recordUsage: async (entry, action) => {
    const c = await validConfig();
    const record = c ? usageRecord(entry, c.engineId, action) : null;
    if (c && record) await new UsageLog(c.folder).append(record);
  },
});

/** Registers an IPC handler that only answers the app's own page. */
function handle(channel: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!event.senderFrame || !appUrl(event.senderFrame.url)) throw new Error("Unexpected sender");
    return fn(...(args as never[]));
  });
}

function registerIpc() {
  handle("hh:getState", () => appState());
  handle("hh:pickFolder", async (defaultPath: string) => {
    const result = await dialog.showOpenDialog(window!, { defaultPath, properties: ["openDirectory", "createDirectory"] });
    const folder = result.canceled ? undefined : result.filePaths[0];
    if (!folder) return null;
    return { folder, problem: await checkFolder(folder, os.homedir()) } satisfies FolderPick;
  });
  handle("hh:saveConfig", async (patch: AppConfig) => {
    const problem = await configProblem(patch, validation());
    if (problem) throw new Error(problem);
    const before = await config.load();
    if (patch.engineId && before.engineId && patch.engineId !== before.engineId) {
      if (turns.isBusy()) throw new Error("A turn is running");
      await dropRuntime();
    }
    await config.save(patch);
    if (patch.appearance) applyAppearance(patch.appearance);
    return appState();
  });
  handle("hh:loadChat", async (): Promise<ChatLoad> => {
    const c = await validConfig();
    if (!c) return { entries: [] };
    const switchedFrom = turns.isBusy() ? null : await startNewChatIfEngineChanged(c.folder, c.engineId);
    return { entries: await new ChatLog(c.folder).load(), ...(switchedFrom ? { switchedFrom } : {}) };
  });
  handle("hh:send", (message: string, options?: SendOptions) => {
    const action = typeof options?.action === "string" && Object.hasOwn(harness.actions, options.action) ? options.action : undefined;
    return turns.send(message, action ? { action } : {});
  });
  handle("hh:cancel", () => turns.cancel());
  handle("hh:history", async () => {
    const history = await currentHistory();
    return history ? (await history.list()).map((h) => ({ ...h, date: h.date.toISOString() })) : [];
  });
  handle("hh:restore", async (sha: string) => {
    if (quitting) throw new Error("The app is closing");
    if (restorePending) throw new Error("Already going back");
    if (turns.isBusy()) throw new Error("A turn is running");
    restorePending = true;
    try {
      const history = await currentHistory();
      if (!history) throw new Error("The app is not set up yet");
      if (quitting || turns.isBusy()) throw new Error("A turn is running");
      const done = history.restore(sha, "Went back to an earlier point");
      restoring = done.catch(() => undefined);
      await done;
    } finally {
      restorePending = false;
    }
  });
  handle("hh:engineStatus", (engineId: string) => detectEngine(engineFor(engineId), commandDeps, shared));
  handle("hh:acceptNotice", async (engineId: string) => {
    engineFor(engineId);
    await shared.update(engineId, { notice: { version: NOTICE_VERSION, acceptedAt: new Date().toISOString() } });
  });
  handle("hh:runSetup", async (engineId: string, step: SetupStep) => {
    const engine = engineFor(engineId);
    if (!SETUP_STEPS.includes(step)) throw new Error("Unknown setup step");
    if (setupRun) throw new Error("A setup step is already running");
    if (step === "logout" && turns.isBusy()) throw new Error("A turn is running");
    const cli = step === "install" ? null : await cliCommand(engine, commandDeps);
    const cmd = setupCommand(engine, step, cli, await loginShellPath(commandDeps));
    if (!cmd) return { ok: false };
    if (step === "logout") await dropRuntime();
    const run = runSetupProcess(cmd, (output) => sendToWindow("hh:setupOutput", output));
    setupRun = run;
    try {
      return { ok: (await run.exit) === 0 };
    } finally {
      setupRun = null;
    }
  });
  handle("hh:setupInput", (text: string) => {
    if (typeof text === "string") setupRun?.write(text.slice(0, 2000));
  });
  handle("hh:cancelSetup", () => setupRun?.cancel());
  handle("hh:testEngine", async (engineId: string) => {
    const engine = engineFor(engineId);
    const cmd = await engineCommand(engine, commandDeps);
    if (!cmd) return { ok: false, error: { code: "engine-not-installed" } };
    const result = await testPrompt(engine, cmd);
    if (result.ok) await shared.update(engineId, { verifiedAt: new Date().toISOString() });
    return result;
  });
  handle("hh:getUsage", async (): Promise<UsageSummary> => {
    const c = await validConfig();
    if (!c) return { limits: null, estimates: {} };
    return summarizeUsage((await new UsageLog(c.folder).load()).filter((r) => r.engine === c.engineId));
  });
  handle("hh:revealFolder", async () => {
    const c = await validConfig();
    if (c) await shell.openPath(c.folder);
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: harness.name.en,
    // Native look (spec 2026-10-11-app-look-design.md): the page draws the 52 px top bar.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 20, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light,
    webPreferences: { preload: path.join(__dirname, "../preload/index.mjs"), contextIsolation: true, sandbox: false },
  });
  window = win;
  win.on("closed", () => {
    if (window === win) window = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => {
    if (!appUrl(event.url)) event.preventDefault();
  });
  if (devUrl) await win.loadURL(devUrl);
  else await win.loadFile(rendererFile);
}

// Each harness is its own app: keep its config, history and caches apart from other harnesses.
// Set before "ready" (ESM top-level await delays it) so Chromium uses the same folder.
const loaded = await loadHarness(path.join(__dirname, "harness.js"), { root: __HARNESS_DIR__ }).catch((err: unknown) => {
  // showErrorBox is safe before "ready".
  dialog.showErrorBox("This app could not start", err instanceof Error ? err.message : String(err));
  app.exit(1);
  return null;
});

if (loaded) {
  harness = loaded;
  app.setName(harness.name.en);
  app.setPath("userData", path.join(app.getPath("appData"), "Human Harness", harness.id));

  app.whenReady().then(async () => {
    config = new ConfigStore(app.getPath("userData"));
    shared = new SharedConfigStore(sharedConfigDir());
    nativeTheme.themeSource = (await config.load()).appearance ?? "system";
    nativeTheme.on("updated", () => window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light));
    registerIpc();
    await createWindow();
  });

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    turns.close();
    setupRun?.cancel();
    void (async () => {
      try {
        await dropRuntime();
      } catch (err) {
        console.error("Could not close the agent cleanly", err);
      }
      // A cancelled or closed turn still writes its reply to the chat: wait for it.
      await turns.flush();
    })().finally(() => app.quit());
  });
}
```

`testPrompt` already returns `{ ok, error? }`, which is what `testEngine` promises the renderer.

- [ ] **Step 5: Verify**

Run: `corepack pnpm test && corepack pnpm typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 6: Check the main bundle has no React**

Run: `corepack pnpm app:build`
Expected: builds main, preload and renderer; the renderer output includes `lexend-latin-500-normal-*.woff2` and `lexend-latin-600-normal-*.woff2` files.
Run: `grep -cE 'useState|react-dom|"@humanharness/ui' packages/shell/out/main/index.js`
Expected: `0`. If it prints more than 0 because `@humanharness/ui/client` was left as an external import, add `"@humanharness/ui/client"` to the `workspacePackages` list in `packages/shell/electron.vite.config.ts`, rebuild and re-check.

- [ ] **Step 7: Commit**

```bash
git add packages/shell pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(shell): wire onboarding, usage and engine switch; native window chrome and appearance"
```

---

### Task 10: UI chat state and usage helpers

**Files:**
- Modify: `packages/ui/src/state.ts`, `packages/ui/test/state.test.ts`
- Create: `packages/ui/src/usage.ts`, `packages/ui/test/usage.test.ts`

- [ ] **Step 1: Failing tests**

Append inside `describe("reduceChat")` in `packages/ui/test/state.test.ts`:
```ts
  it("keeps the action, tokens, limits and state blocks on the entries", () => {
    const windows = [{ kind: "five_hour", utilization: 0.3, resetsAt: "2026-10-11T15:00:00.000Z" }];
    const s = run(
      [
        { type: "user", text: "hi", at: "t", action: "tidy" },
        { type: "block", name: "progress", data: { percent: 10 } },
        { type: "limits", status: "allowed", windows },
        { type: "usage", inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
        { type: "done", ok: true },
      ],
      { ...initialChat([]), stateBlocks: new Set(["progress"]) },
    );
    expect(s.entries[0]).toMatchObject({ role: "user", action: "tidy" });
    expect(s.entries[1]).toMatchObject({
      usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
      limits: windows,
      state: { progress: { percent: 10 } },
    });
  });

  it("restores state blocks from the saved conversation; newer live data wins", () => {
    const saved = [
      { id: "1", role: "assistant" as const, text: "", blocks: [], activities: [], at: "t", state: { progress: { percent: 20 }, phase: { n: 1 } } },
      { id: "2", role: "assistant" as const, text: "", blocks: [], activities: [], at: "t", state: { progress: { percent: 60 } } },
    ];
    const s = run([{ type: "loaded", entries: saved }], { ...initialChat([]), blockState: { phase: { n: 2 } } });
    expect(s.blockState).toEqual({ progress: { percent: 60 }, phase: { n: 2 } });
  });
```

Create `packages/ui/test/usage.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ChatEntry } from "../src/client";
import { HEAVY_DEFAULT, compactTokens, formatReset, lastTurnTokens, percent, preflight, resetWindow } from "../src/usage";

const w = (kind: string, utilization: number, resetsAt = "2026-10-11T15:00:00.000Z") => ({ kind, utilization, resetsAt });

describe("preflight", () => {
  it("only asks before heavy actions", () => {
    expect(preflight("medium", [w("five_hour", 0.9)], 0.2)).toBeNull();
    expect(preflight(undefined, [w("five_hour", 0.9)], 0.2)).toBeNull();
  });

  it("stays quiet when the engine reports no five-hour window", () => {
    expect(preflight("heavy", null, 0.5)).toBeNull();
    expect(preflight("heavy", [w("seven_day", 0.99)], 0.5)).toBeNull();
  });

  it("asks when the action would likely take the window to 80 % or more", () => {
    expect(preflight("heavy", [w("five_hour", 0.75)], 0.08)).toEqual({ estimate: 0.08, left: 0.25 });
    expect(preflight("heavy", [w("five_hour", 0.6)], 0.08)).toBeNull();
  });

  it("assumes a default share before the log has a measurement", () => {
    expect(preflight("heavy", [w("five_hour", 0.75)], undefined)).toEqual({ estimate: null, left: 0.25 });
    expect(preflight("heavy", [w("five_hour", 0.8 - HEAVY_DEFAULT - 0.05)], undefined)).toBeNull();
  });
});

describe("formatting", () => {
  it("rounds and clamps percentages", () => {
    expect(percent(0.156)).toBe(16);
    expect(percent(1.2)).toBe(100);
    expect(percent(-1)).toBe(0);
  });

  it("shows only the time for a reset within the day, and the weekday otherwise", () => {
    const now = new Date("2026-10-11T12:00:00.000Z");
    const soon = "2026-10-11T15:00:00.000Z";
    const later = "2026-10-14T15:00:00.000Z";
    expect(formatReset(soon, "en", now)).toBe(new Date(soon).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }));
    expect(formatReset(later, "en", now)).toBe(new Date(later).toLocaleString("en", { weekday: "short", hour: "2-digit", minute: "2-digit" }));
  });

  it("totals the last reply's tokens", () => {
    const base = { blocks: [], activities: [], at: "t" };
    const entries: ChatEntry[] = [
      { ...base, id: "1", role: "assistant", text: "", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 1 } },
      { ...base, id: "2", role: "assistant", text: "", usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 100, cacheWriteTokens: 0 } },
      { ...base, id: "3", role: "user", text: "next" },
    ];
    expect(lastTurnTokens(entries)).toBe(1300);
    expect(lastTurnTokens([])).toBeNull();
  });

  it("writes token counts compactly", () => {
    expect(compactTokens(85400, "en")).toBe("85.4K");
  });

  it("mentions the fullest window, the one that frees up last, when out of quota", () => {
    expect(resetWindow([w("five_hour", 1), w("seven_day", 1, "2026-10-14T15:00:00.000Z")])?.kind).toBe("seven_day");
    expect(resetWindow([w("five_hour", 1), w("seven_day", 0.4)])?.kind).toBe("five_hour");
    expect(resetWindow(null)).toBeUndefined();
  });
});
```

Run: `corepack pnpm vitest run packages/ui/test/state.test.ts packages/ui/test/usage.test.ts`
Expected: FAIL (`usage.ts` missing; entries lack usage/limits/state; blockState not restored).

- [ ] **Step 2: Implement — usage helpers**

Create `packages/ui/src/usage.ts`:
```ts
import type { ActionCost } from "@humanharness/harness-sdk";
import type { ChatEntry, LimitWindow, TurnUsage } from "./client";

/** Meter warnings (spec §6): close to the limit, and almost out. */
export const WARN_AT = 0.8;
export const HIGH_AT = 0.95;
/** Share of the five-hour window assumed for a heavy action before the log has a measurement. */
export const HEAVY_DEFAULT = 0.1;

export const percent = (share: number): number => Math.round(Math.min(1, Math.max(0, share)) * 100);

export const totalTokens = (u: TurnUsage): number => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;

/** Tokens of the latest reply that reported any. */
export function lastTurnTokens(entries: ChatEntry[]): number | null {
  const entry = entries.findLast((e) => e.role === "assistant" && e.usage);
  return entry?.usage ? totalTokens(entry.usage) : null;
}

/** "85.4K"-style token count in the UI language. */
export function compactTokens(n: number, language: string): string {
  return new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** When a window resets: the time if it's within the day, otherwise the weekday and time. */
export function formatReset(iso: string, language: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  return date.getTime() - now.getTime() < 20 * 3600_000
    ? date.toLocaleTimeString(language, time)
    : date.toLocaleString(language, { weekday: "short", ...time });
}

export const fiveHour = (limits: LimitWindow[] | null): LimitWindow | undefined => limits?.find((w) => w.kind === "five_hour");

/** The window an out-of-quota card should mention: the fullest, and among those the one that resets last. */
export function resetWindow(limits: LimitWindow[] | null): LimitWindow | undefined {
  if (!limits?.length) return undefined;
  return [...limits].sort((a, b) => b.utilization - a.utilization || Date.parse(b.resetsAt) - Date.parse(a.resetsAt))[0];
}

export interface Preflight {
  /** Measured share of the five-hour window this action usually uses; null before there is one. */
  estimate: number | null;
  /** Share of the five-hour window left. */
  left: number;
}

/**
 * Whether to ask before an action: only heavy ones, only when the engine reports a five-hour window,
 * and only when the action would likely take it to WARN_AT or beyond. Null means go ahead.
 */
export function preflight(cost: ActionCost | undefined, limits: LimitWindow[] | null, estimate: number | undefined): Preflight | null {
  if (cost !== "heavy") return null;
  const window = fiveHour(limits);
  if (!window) return null;
  if (window.utilization + (estimate ?? HEAVY_DEFAULT) < WARN_AT) return null;
  return { estimate: estimate ?? null, left: Math.max(0, 1 - window.utilization) };
}
```

- [ ] **Step 3: Implement — chat state**

Replace `packages/ui/src/state.ts` with:
```ts
import type { ChatEntry, Event, LimitWindow, TurnUsage } from "./client";

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
  usage?: TurnUsage;
  limits?: LimitWindow[];
  /** State-only blocks emitted during this turn (saved on the entry). */
  state?: Record<string, unknown>;
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

export type ChatAction =
  | Event
  | { type: "user"; text: string; at: string; action?: string }
  | { type: "loaded"; entries: ChatEntry[] }
  /** A local assistant message that the UI shows but never saves. */
  | { type: "notice"; text: string; at: string };

export function initialChat(entries: ChatEntry[], stateBlocks: string[] = []): ChatState {
  return { entries, live: null, blockState: {}, stateBlocks: new Set(stateBlocks), limits: null };
}

const newId = () => Math.random().toString(36).slice(2);

export function reduceChat(state: ChatState, action: ChatAction): ChatState {
  const live = state.live;
  switch (action.type) {
    case "loaded": {
      const restored: Record<string, unknown> = Object.assign({}, ...action.entries.map((e) => e.state ?? {}));
      return {
        ...state,
        entries: [...action.entries, ...state.entries.filter((e) => !action.entries.some((s) => s.id === e.id))],
        blockState: { ...restored, ...state.blockState },
      };
    }
    case "notice":
      return {
        ...state,
        entries: [...state.entries, { id: newId(), role: "assistant", text: action.text, blocks: [], activities: [], at: action.at }],
      };
    case "user":
      return {
        ...state,
        entries: [
          ...state.entries,
          {
            id: newId(),
            role: "user",
            text: action.text,
            blocks: [],
            activities: [],
            at: action.at,
            ...(action.action ? { action: action.action } : {}),
          },
        ],
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
      if (state.stateBlocks.has(action.name)) {
        return {
          ...state,
          blockState: { ...state.blockState, [action.name]: action.data },
          live: live ? { ...live, state: { ...live.state, [action.name]: action.data } } : live,
        };
      }
      return live ? { ...state, live: { ...live, blocks: [...live.blocks, { name: action.name, data: action.data }] } } : state;
    case "limits":
      return { ...state, limits: action.windows, live: live ? { ...live, limits: action.windows } : live };
    case "usage":
      return live
        ? {
            ...state,
            live: {
              ...live,
              usage: {
                inputTokens: action.inputTokens,
                outputTokens: action.outputTokens,
                cacheReadTokens: action.cacheReadTokens,
                cacheWriteTokens: action.cacheWriteTokens,
              },
            },
          }
        : state;
    case "done": {
      if (!live) return state;
      const entry: ChatEntry = {
        id: newId(),
        role: "assistant",
        text: live.text.trim(),
        blocks: live.blocks,
        activities: live.activities.map(({ kind, detail }) => ({ kind, detail })),
        at: new Date().toISOString(),
        ...(live.usage ? { usage: live.usage } : {}),
        ...(live.limits ? { limits: live.limits } : {}),
        ...(live.state ? { state: live.state } : {}),
        ...(action.ok ? {} : { error: action.error }),
      };
      return { ...state, entries: [...state.entries, entry], live: null };
    }
  }
}
```

- [ ] **Step 4: Verify**

Run: `corepack pnpm vitest run packages/ui && corepack pnpm typecheck`
Expected: PASS (old and new UI tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/state.ts packages/ui/src/usage.ts packages/ui/test/state.test.ts packages/ui/test/usage.test.ts
git commit -m "feat(ui): usage on chat entries, restored side-panel state, usage helpers"
```

---
### Task 11: Design tokens, display font and app chrome

**Files:**
- Modify: `packages/ui/src/styles.css` (full replacement)
- Create: `packages/ui/src/chrome.tsx`, `packages/ui/test/chrome.test.tsx`, `packages/ui/test/styles.test.ts`, `packages/ui/test/render.tsx`
- Modify: `packages/ui/test/HarnessApp.test.tsx` (remove the old `describe("styles")` block)

Tokens and sizes come from `docs/superpowers/specs/2026-10-11-app-look-design.md`. The dark set is new (the spec only fixes light); it keeps the same roles and contrast.

- [ ] **Step 1: Failing tests**

Create `packages/ui/test/render.tsx` (a helper, not a test file):
```tsx
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@humanharness/i18n";

/** Renders `ui` with the core strings in `language`, like HarnessApp does. */
export async function renderIn(language: "en" | "es", ui: ReactElement) {
  const i18n = await createI18n(language);
  return { i18n, ...render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>) };
}
```

Create `packages/ui/test/styles.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8");
const [light, dark] = css.split("prefers-color-scheme: dark");
const token = (block: string, name: string) => block.match(new RegExp(`--hh-${name}:\\s*(#[0-9a-f]{6})`, "i"))![1].toLowerCase();

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("design tokens", () => {
  it("uses the spec's light palette", () => {
    expect(["paper", "sheet", "surface", "ink", "slate", "muted", "line-strong", "line", "segment", "ok", "warn"].map((n) => token(light, n))).toEqual([
      "#f4f4f1", "#fbfbfa", "#ffffff", "#191e24", "#3f4852", "#5b636c", "#cfcfcb", "#e1e1dd", "#e7e7e3", "#2e6b4f", "#9a4a12",
    ]);
  });

  it("keeps text readable in light and dark: muted, ok and warn ≥ 4.5:1, ink ≥ 7:1", () => {
    for (const block of [light, dark]) {
      for (const bg of ["paper", "sheet", "surface"]) {
        for (const fg of ["muted", "ok", "warn", "slate"]) expect(ratio(token(block, fg), token(block, bg))).toBeGreaterThanOrEqual(4.5);
        expect(ratio(token(block, "ink"), token(block, bg))).toBeGreaterThanOrEqual(7);
      }
      expect(ratio(token(block, "on-ink"), token(block, "ink"))).toBeGreaterThanOrEqual(7);
    }
  });
});

describe("styles", () => {
  it("makes the top bar the window's drag region, except its controls", () => {
    expect(css).toMatch(/\.hh-topbar\s*{[^}]*-webkit-app-region:\s*drag/);
    expect(css).toMatch(/\.hh-topbar button,[^{]*{[^}]*-webkit-app-region:\s*no-drag/);
  });

  it("uses the system font for UI text and Lexend for display text, with no network fonts", () => {
    expect(css).toMatch(/--hh-font:\s*-apple-system/);
    expect(css).toMatch(/--hh-display:\s*"Lexend"/);
    expect(css).not.toMatch(/url\(\s*["']?https?:/);
    expect(css).not.toMatch(/@import/);
  });

  it("preserves single line breaks in messages", () => {
    expect(css).toMatch(/\.hh-message p\s*{[^}]*white-space:\s*pre-wrap/);
  });
});
```

Create `packages/ui/test/chrome.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HHLogo, Segmented, TopBar } from "../src/chrome";

afterEach(cleanup);

describe("chrome", () => {
  it("TopBar shows a title and its controls", () => {
    render(
      <TopBar title="Demo">
        <button>Settings</button>
      </TopBar>,
    );
    expect(screen.getByRole("heading", { name: "Demo" }).closest("header")?.className).toBe("hh-topbar");
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  it("Segmented marks the chosen option and reports changes", () => {
    const onChange = vi.fn();
    render(<Segmented label="Appearance" value="system" onChange={onChange} options={[{ value: "system", label: "Automatic" }, { value: "dark", label: "Dark" }]} />);
    expect(screen.getByRole("group", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Automatic" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("HHLogo is decorative unless it gets a title", () => {
    const { container, rerender } = render(<HHLogo />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    rerender(<HHLogo title="Human Harness" />);
    expect(screen.getByRole("img", { name: "Human Harness" })).toBeTruthy();
  });
});
```

In `packages/ui/test/HarnessApp.test.tsx`, delete the whole `describe("styles", …)` block at the end of the file (its checks move to `styles.test.ts`) and the then-unused `readFileSync` / `resolve` imports.

Run: `corepack pnpm vitest run packages/ui/test/styles.test.ts packages/ui/test/chrome.test.tsx`
Expected: FAIL (old tokens; `chrome.tsx` missing).

- [ ] **Step 2: Implement — tokens and styles**

Replace `packages/ui/src/styles.css` with:
```css
/* Human Harness look: docs/superpowers/specs/2026-10-11-app-look-design.md. Colours only through these tokens. */
:root {
  --hh-paper: #f4f4f1;
  --hh-sheet: #fbfbfa;
  --hh-surface: #ffffff;
  --hh-ink: #191e24;
  --hh-on-ink: #ffffff;
  --hh-slate: #3f4852;
  --hh-muted: #5b636c;
  --hh-line-strong: #cfcfcb;
  --hh-line: #e1e1dd;
  --hh-segment: #e7e7e3;
  --hh-ok: #2e6b4f;
  --hh-ok-dot: #2e8a5c;
  --hh-warn: #9a4a12;
  --hh-error-bg: #fbeaea;
  --hh-backdrop: rgba(25, 30, 36, 0.18);
  --hh-font: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --hh-display: "Lexend", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  font-family: var(--hh-font);
  font-size: 13px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --hh-paper: #161819;
    --hh-sheet: #1d2023;
    --hh-surface: #24282c;
    --hh-ink: #ecedee;
    --hh-on-ink: #191e24;
    --hh-slate: #c2c7cd;
    --hh-muted: #9aa1a9;
    --hh-line-strong: #4a5057;
    --hh-line: #33383e;
    --hh-segment: #2c3136;
    --hh-ok: #6cc497;
    --hh-ok-dot: #4fb07f;
    --hh-warn: #e39a5e;
    --hh-error-bg: #3a2222;
    --hh-backdrop: rgba(0, 0, 0, 0.45);
    color-scheme: dark;
  }
}

html, body, #root { height: 100%; }
body { margin: 0; background: var(--hh-paper); color: var(--hh-ink); overflow: hidden; -webkit-font-smoothing: antialiased; }
h1, h2, h3 { margin: 0; }
h3 { font-size: 13px; font-weight: 600; color: var(--hh-slate); }
p { margin: 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; }
a { color: var(--hh-ink); }
button, .hh-button { font: inherit; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--hh-line-strong); background: var(--hh-surface); color: var(--hh-ink); text-decoration: none; cursor: default; }
button:disabled { opacity: 0.5; }
button:focus-visible, .hh-button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--hh-ink); outline-offset: 2px; }
input[type="text"], input:not([type]) { font: inherit; height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--hh-line-strong); background: var(--hh-surface); color: var(--hh-ink); }
.hh-primary { background: var(--hh-ink); color: var(--hh-on-ink); border-color: transparent; font-weight: 600; }
/* The big call to action: chamfered corners echo the logo's bevel. */
.hh-start { height: 46px; padding: 0 28px; font-size: 15px; border-radius: 0; clip-path: polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px); }
.hh-display { font-family: var(--hh-display); }
.hh-caption { color: var(--hh-muted); font-size: 12px; margin: 0; }
.hh-warn { color: var(--hh-warn); }
.hh-ok { color: var(--hh-ok); }
.hh-logo { color: var(--hh-ink); }
.hh-save-error, .hh-folder-problem { color: var(--hh-warn); margin: 0; }
.hh-loading, .hh-load-error { padding: 24px; }
.hh-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* Top bar: the window's drag region (hiddenInset title bar), leaving room for the traffic lights. */
.hh-topbar { height: 52px; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 80px; -webkit-app-region: drag; user-select: none; border-bottom: 1px solid var(--hh-line); }
.hh-topbar button, .hh-topbar a, .hh-topbar input { -webkit-app-region: no-drag; }
.hh-title { font-family: var(--hh-display); font-weight: 600; font-size: 14px; white-space: nowrap; }
.hh-spacer { flex: 1; }
.hh-icon-button { width: 30px; padding: 0; }
.hh-segmented { display: inline-flex; padding: 2px; gap: 2px; border-radius: 7px; background: var(--hh-segment); }
.hh-segmented button { height: 24px; border: none; background: transparent; border-radius: 5px; }
.hh-segmented button[aria-pressed="true"], .hh-segmented button[aria-selected="true"] { background: var(--hh-surface); box-shadow: 0 1px 2px rgba(25, 30, 36, 0.15); }

/* Home */
.hh-home { height: 100vh; display: grid; grid-template-rows: 52px 1fr auto; }
.hh-home .hh-topbar { border-bottom: none; }
.hh-home-main { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; padding: 0 16px; }
.hh-home-logo { width: 112px; height: 112px; object-fit: contain; }
.hh-home-name { font-family: var(--hh-display); font-weight: 600; font-size: 34px; }
.hh-home-tagline { color: var(--hh-slate); font-size: 15px; margin-bottom: 8px; }
.hh-pill { height: 30px; border-radius: 15px; border-color: var(--hh-line); gap: 8px; }
.hh-pill img { width: 18px; height: 18px; }
.hh-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--hh-muted); }
.hh-dot.ok { background: var(--hh-ok-dot); }
.hh-footer { display: flex; justify-content: space-between; gap: 16px; padding: 12px 20px; color: var(--hh-muted); font-size: 12px; }
.hh-wordmark { font-family: var(--hh-display); font-weight: 500; color: var(--hh-slate); }

/* Settings sheet, attached under the top bar */
.hh-sheet-backdrop { position: fixed; inset: 52px 0 0 0; background: var(--hh-backdrop); display: flex; justify-content: center; align-items: flex-start; }
.hh-sheet { width: min(620px, calc(100% - 32px)); max-height: calc(100% - 24px); box-sizing: border-box; overflow-y: auto; background: var(--hh-sheet); border: 1px solid var(--hh-line-strong); border-top: none; border-radius: 0 0 12px 12px; padding: 16px 20px 20px; display: grid; gap: 16px; box-shadow: 0 12px 32px rgba(25, 30, 36, 0.18); }
.hh-sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.hh-tab { display: grid; gap: 12px; }
.hh-rows { background: var(--hh-surface); border: 1px solid var(--hh-line); border-radius: 10px; }
.hh-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-top: 1px solid var(--hh-line); }
.hh-row:first-child { border-top: none; }
.hh-row-label { color: var(--hh-slate); }
.hh-onboarding { display: grid; gap: 10px; justify-items: start; }
.hh-onboarding pre { max-height: 160px; overflow: auto; font-size: 11px; color: var(--hh-muted); white-space: pre-wrap; }
.hh-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.hh-tile { position: relative; height: auto; min-height: 104px; flex-direction: column; padding: 14px; gap: 4px; border-radius: 12px; border-color: var(--hh-line); }
.hh-tile[aria-pressed="true"] { border: 2px solid var(--hh-ink); padding: 13px; }
.hh-tile img { width: 40px; height: 40px; }
.hh-tile.more { display: flex; align-items: center; justify-content: center; border: 1px dashed var(--hh-line-strong); color: var(--hh-muted); background: transparent; }
.hh-check { position: absolute; top: 8px; right: 8px; width: 18px; height: 18px; border-radius: 50%; background: var(--hh-ink); color: var(--hh-on-ink); font-size: 11px; display: grid; place-items: center; }

/* Work screen: the 2a chat layout with the tokens (its own design comes later). */
.hh-app { display: grid; grid-template-rows: 52px 1fr auto; height: 100vh; }
.hh-usage { margin: 0; color: var(--hh-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.hh-body { display: grid; grid-template-columns: 1fr auto; overflow: hidden; }
.hh-chat { overflow-y: auto; padding: 16px; display: grid; gap: 12px; align-content: start; }
.hh-side { width: 240px; padding: 16px; border-left: 1px solid var(--hh-line); }
.hh-message { max-width: 720px; }
.hh-message p { white-space: pre-wrap; margin: 0 0 8px; }
.hh-message.user { justify-self: end; background: var(--hh-surface); border: 1px solid var(--hh-line); border-radius: 10px; padding: 8px 12px; }
.hh-who { color: var(--hh-muted); font-size: 12px; }
.hh-activity { list-style: none; padding: 0; margin: 0 0 4px; color: var(--hh-muted); font-size: 12px; }
.hh-activity .running::after { content: " …"; }
.hh-block { margin: 8px 0; }
.hh-error { background: var(--hh-error-bg); border-radius: 10px; padding: 8px 12px; display: grid; gap: 8px; justify-items: start; }
.hh-confirm { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; background: var(--hh-surface); border: 1px solid var(--hh-line); border-radius: 10px; padding: 10px 12px; }
.hh-confirm p { flex-basis: 100%; }
.hh-composer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--hh-line); }
.hh-composer textarea { flex: 1; min-height: 44px; resize: vertical; font: inherit; border-radius: 8px; border: 1px solid var(--hh-line-strong); background: var(--hh-surface); color: var(--hh-ink); padding: 8px; }
.hh-composer button { height: auto; }
.hh-composer button[type="submit"] { background: var(--hh-ink); color: var(--hh-on-ink); border-color: transparent; font-weight: 600; }
.hh-history { position: fixed; inset: 52px 0 0 auto; width: min(360px, 100%); box-sizing: border-box; background: var(--hh-sheet); border-left: 1px solid var(--hh-line-strong); padding: 16px; overflow-y: auto; }
.hh-history li { display: grid; gap: 4px; margin-bottom: 12px; }
.hh-history time { color: var(--hh-muted); font-size: 12px; }
@media (max-width: 640px) { .hh-body { grid-template-columns: 1fr; } .hh-side { display: none; } }
```

- [ ] **Step 3: Implement — chrome components**

Create `packages/ui/src/chrome.tsx`:
```tsx
import type { ReactNode } from "react";

/** The window's top bar: the drag region of the hiddenInset title bar, with room for the traffic lights. */
export function TopBar({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <header className="hh-topbar">
      {title !== undefined && <h1 className="hh-title">{title}</h1>}
      <span className="hh-spacer" />
      {children}
    </header>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** macOS-style segmented control: one choice among a few. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="hh-segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M6.6 1h2.8l.4 1.9 1.3.6 1.7-1 2 2-1 1.7.6 1.3 1.9.4v2.8l-1.9.4-.6 1.3 1 1.7-2 2-1.7-1-1.3.6-.4 1.9H6.6l-.4-1.9-1.3-.6-1.7 1-2-2 1-1.7-.6-1.3L0 9.4V6.6l1.9-.4.6-1.3-1-1.7 2-2 1.7 1 1.3-.6zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"
      />
    </svg>
  );
}

/**
 * The Human Harness H (beveled, charcoal on paper): a vector stand-in for `hh.logo.jpeg` until the
 * designer's file arrives. It takes the ink colour, so it also works in dark mode.
 */
export function HHLogo({ className = "", title }: { className?: string; title?: string }) {
  return (
    <svg
      className={`hh-logo ${className}`.trim()}
      viewBox="0 0 1000 1000"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <polygon fill="currentColor" points="182,155 357,155 357,453 655,453 655,155 830,155 830,870 655,870 655,597 357,597 357,870 182,870" />
      <g fill="#ffffff" fillOpacity="0.12">
        <polygon points="182,155 357,155 270,195 270,830 182,870" />
        <polygon points="270,523 357,453 655,453 742,523" />
        <polygon points="655,155 830,155 742,195 742,523 655,453" />
        <polygon points="655,597 742,523 742,830 655,870" />
      </g>
    </svg>
  );
}
```

- [ ] **Step 4: Verify**

Run: `corepack pnpm vitest run packages/ui && corepack pnpm typecheck`
Expected: PASS (all UI tests: the 2a screens keep working with the new tokens); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): design tokens, top bar, segmented control and the H logo"
```

---

### Task 12: Settings → Engine: folder step, engine tiles and onboarding

**Files:**
- Create: `packages/ui/src/FolderStep.tsx`, `packages/ui/src/EngineOnboarding.tsx`, `packages/ui/src/EngineTab.tsx`
- Create: `packages/ui/test/engine-tab.test.tsx`

Onboarding (spec §9 steps 2–6) runs inside the Engine tab: folder (first launch only) → pick a tile → legal notice with checkbox → install / update / sign in as the status check requires → test prompt → "Use <engine>". A ready engine shows its plan, data location, version and Sign out.

- [ ] **Step 1: Failing test**

Create `packages/ui/test/engine-tab.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState } from "../src/client";
import { EngineTab } from "../src/EngineTab";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

/** The tab with its state lifted, as the sheet holds it. */
function Tab({ client }: { client: FakeClient }) {
  const [state, setState] = useState<AppState>(client.state);
  return <EngineTab client={client} state={state} onChange={setState} />;
}

const withFolder = () => new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo" });
const addCodex = (client: FakeClient) => {
  client.state.engines = [...client.state.engines, { ...client.state.engines[0], id: "codex", name: "Codex", provider: "OpenAI", reportsLimits: false }];
};

describe("EngineTab", () => {
  it("asks for the folder first, explains a folder that can't be used, then saves it with the language", async () => {
    const client = new FakeClient({});
    client.pickResult = { folder: "/Users/me/Documents", problem: "too-broad" };
    await renderIn("en", <Tab client={client} />);
    expect(screen.getByText(/works with an AI plan you already have/)).toBeTruthy();
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose another folder" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That folder is too general. Pick or create a folder inside it.");
    client.pickResult = { folder: "/Users/me/Documents/Mine", problem: null };
    fireEvent.click(screen.getByRole("button", { name: "Choose another folder" }));
    await screen.findByText("/Users/me/Documents/Mine");
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    await screen.findByRole("group", { name: "AI engines" });
    expect(client.state.config).toEqual({ language: "en", folder: "/Users/me/Documents/Mine" });
  });

  it("says when the folder can't be saved", async () => {
    const client = new FakeClient({});
    client.saveError = new Error("protected");
    await renderIn("en", <Tab client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't save/i);
  });

  it("walks a new engine through the notice, install, sign-in and the test prompt", async () => {
    const client = withFolder();
    client.status = { ...client.status, noticeAccepted: false, installed: false, loggedIn: false, verified: false };
    await renderIn("en", <Tab client={client} />);

    await screen.findByRole("heading", { name: "Before using Claude" });
    expect(screen.getByRole("button", { name: /Claude/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/This app is not made or endorsed by Anthropic/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Anthropic terms" }).getAttribute("href")).toBe("https://example.com/terms");
    const accept = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand and accept" }));
    fireEvent.click(accept);

    await screen.findByRole("heading", { name: "Install Claude" });
    expect(screen.getByText("curl -fsSL https://claude.ai/install.sh | bash")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use Claude" }));
    await waitFor(() => expect(client.state.config.engineId).toBe("claude"));

    expect(client.accepted).toEqual(["claude"]);
    expect(client.setupRuns).toEqual([
      { engineId: "claude", step: "install" },
      { engineId: "claude", step: "login" },
    ]);
    expect(client.tested).toEqual(["claude"]);
  });

  it("while signing in, links the page the CLI printed and passes a pasted code", async () => {
    const client = withFolder();
    client.status = { ...client.status, loggedIn: false };
    let finish!: () => void;
    client.setupGate = new Promise((r) => (finish = r));
    await renderIn("en", <Tab client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await screen.findByText(/Waiting for you to finish signing in/);
    act(() => {
      client.emitSetup({ kind: "line", text: "Opening browser…" });
      client.emitSetup({ kind: "url", url: "https://claude.ai/oauth/authorize?x=1" });
    });
    expect(screen.getByRole("link", { name: "Open the sign-in page" }).getAttribute("href")).toBe("https://claude.ai/oauth/authorize?x=1");
    expect(screen.getByText("Opening browser…")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("If the page shows a code, paste it here"), { target: { value: " abc123 " } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(client.setupInputs).toEqual(["abc123"]));
    await act(async () => finish());
    await screen.findByRole("button", { name: "Use Claude" });
  });

  it("offers to try the test prompt again when it fails", async () => {
    const client = withFolder();
    client.status = { ...client.status, verified: false };
    client.testResult = { ok: false, error: { code: "agent-crashed" } };
    await renderIn("en", <Tab client={client} />);
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't work. Try again.");
    client.testResult = { ok: true };
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Use Claude" });
    expect(client.tested).toEqual(["claude", "claude"]);
  });

  it("shows the engine in use with its details, and signs out on request", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    await renderIn("en", <Tab client={client} />);
    await screen.findByText("Claude is ready ✓");
    expect(screen.getByText("Pro plan")).toBeTruthy();
    expect(screen.getByText("USA")).toBeTruthy();
    expect(screen.getByText("2.1.296")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Claude.*Connected.*In use/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { name: "Sign in to Claude" });
    expect(client.setupRuns).toEqual([{ engineId: "claude", step: "logout" }]);
  });

  it("switches to another ready engine and shows the coming-soon tile", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    addCodex(client);
    await renderIn("en", <Tab client={client} />);
    expect(screen.getByText("More engines · coming soon")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Use Codex" }));
    await waitFor(() => expect(client.state.config.engineId).toBe("codex"));
  });
});
```

Run: `corepack pnpm vitest run packages/ui/test/engine-tab.test.tsx`
Expected: FAIL (components missing).

- [ ] **Step 2: Implement — folder step**

Create `packages/ui/src/FolderStep.tsx`:
```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import type { AppState, FolderProblem, HarnessClient } from "./client";

/** The current UI language as a harness language. */
export function uiLanguage(state: AppState, i18nLanguage: string): Language {
  const languages = state.harness.languages;
  return state.config.language ?? (languages.includes(i18nLanguage as Language) ? (i18nLanguage as Language) : languages[0]);
}

/** First launch only: the welcome line and the folder (spec §7: chosen once, then fixed). Saves the language with it. */
export function FolderStep({ client, state, onSaved }: { client: HarnessClient; state: AppState; onSaved: (s: AppState) => void }) {
  const { t, i18n } = useTranslation();
  const lang = uiLanguage(state, i18n.language);
  const [folder, setFolder] = useState(state.suggestedFolder);
  const [problem, setProblem] = useState<FolderProblem | null>(null);
  const [saveError, setSaveError] = useState(false);

  const pick = async () => {
    const result = await client.pickFolder(folder).catch(() => null);
    if (!result) return;
    setProblem(result.problem);
    if (!result.problem) setFolder(result.folder);
  };
  const save = async () => {
    setSaveError(false);
    try {
      onSaved(await client.saveConfig({ language: lang, folder }));
    } catch {
      setSaveError(true);
    }
  };

  return (
    <section className="hh-onboarding">
      <p>{t("setup.welcome", { name: state.harness.name[lang] })}</p>
      <h3>{t("setup.folder")}</h3>
      <p className="hh-caption">{t("setup.folderHint")}</p>
      <div className="hh-rows">
        <div className="hh-row">
          <code>{folder}</code>
          <button onClick={() => void pick()}>{t("setup.folderChange")}</button>
        </div>
      </div>
      {problem && (
        <p className="hh-folder-problem" role="alert">
          {t(`setup.folderProblem.${problem}`)}
        </p>
      )}
      <p className="hh-caption">{t("setup.folderWarning")}</p>
      <button className="hh-primary" onClick={() => void save()}>
        {t("setup.useFolder")}
      </button>
      {saveError && (
        <p className="hh-save-error" role="alert">
          {t("setup.saveError")}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Implement — onboarding steps**

Create `packages/ui/src/EngineOnboarding.tsx`:
```tsx
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import { type EngineOption, type EngineStatus, type HarnessClient, type SetupStep, engineProblem } from "./client";

type Busy = null | "notice" | "test" | SetupStep;

/**
 * The step an engine still needs (spec §9): legal notice, install, update, sign in, test prompt.
 * Each step ends with `refresh()`, which re-reads the real status; nothing is trusted from a local flag.
 * Renders nothing once the engine is ready.
 */
export function EngineOnboarding({
  client,
  engine,
  status,
  refresh,
}: {
  client: HarnessClient;
  engine: EngineOption;
  status: EngineStatus;
  refresh: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language === "es" ? "es" : "en";
  const [busy, setBusy] = useState<Busy>(null);
  const [failed, setFailed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const autoTested = useRef(false);
  const problem = engineProblem(status);

  useEffect(
    () =>
      client.onSetupOutput((o) => {
        if (o.kind === "line") setLines((l) => [...l.slice(-19), o.text]);
        else setUrl(o.url);
      }),
    [client],
  );

  const runTest = useCallback(async () => {
    setBusy("test");
    setFailed(false);
    const result = await client.testEngine(engine.id).catch(() => ({ ok: false }));
    setBusy(null);
    if (!result.ok) setFailed(true);
    await refresh();
  }, [client, engine.id, refresh]);

  // The test prompt runs by itself once; after a failure the user retries.
  useEffect(() => {
    if (problem === "untested" && busy === null && !autoTested.current) {
      autoTested.current = true;
      void runTest();
    }
  }, [problem, busy, runTest]);

  const runStep = async (step: SetupStep) => {
    setBusy(step);
    setFailed(false);
    setLines([]);
    setUrl(null);
    setCode("");
    const result = await client.runSetup(engine.id, step).catch(() => ({ ok: false }));
    setBusy(null);
    await refresh();
    if (!result.ok) setFailed(true);
  };

  const accept = async () => {
    setBusy("notice");
    setFailed(false);
    try {
      await client.acceptNotice(engine.id);
    } catch {
      setFailed(true);
    }
    setBusy(null);
    await refresh();
  };

  if (problem === null) return null;
  const v = { engine: engine.name, provider: engine.provider };
  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noreferrer">
      {text}
    </a>
  );

  let body: ReactNode;
  if (problem === "notice") {
    body = (
      <>
        <h3>{t("engine.noticeTitle", v)}</h3>
        <p>{t("engine.noticeProvider", { ...v, where: engine.dataLocation[lang] })}</p>
        <p>{t("engine.noticeTraining", { trains: engine.trainsOnData[lang] })}</p>
        <p>{t("engine.noticeAccount", { ...v, plan: engine.requires[lang] })}</p>
        <p>{t("engine.noticeContent", v)}</p>
        <p>
          {link(engine.termsUrl, t("engine.terms", v))} · {link(engine.privacyUrl, t("engine.privacy", v))}
        </p>
        <label>
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> {t("engine.accept")}
        </label>
        <button className="hh-primary" disabled={!accepted || busy !== null} onClick={() => void accept()}>
          {t("engine.continue")}
        </button>
      </>
    );
  } else if (problem === "not-installed") {
    body = (
      <>
        <h3>{t("engine.installTitle", v)}</h3>
        {engine.installCommand ? (
          <>
            <p>{t("engine.installText", v)}</p>
            <code>{engine.installCommand}</code>
            {busy === "install" ? (
              <p role="status">{t("engine.installing")}</p>
            ) : (
              <button className="hh-primary" disabled={busy !== null} onClick={() => void runStep("install")}>
                {t("engine.installRun")}
              </button>
            )}
          </>
        ) : (
          <>
            <p>{t("engine.installManual", v)}</p>
            <button disabled={busy !== null} onClick={() => void refresh()}>
              {t("engine.recheck")}
            </button>
          </>
        )}
        {engine.installDocsUrl && <p>{link(engine.installDocsUrl, t("engine.installDocs"))}</p>}
      </>
    );
  } else if (problem === "outdated") {
    body = (
      <>
        <h3>{t("engine.updateTitle", v)}</h3>
        <p>{t("engine.updateText", { ...v, min: status.minVersion, version: status.version })}</p>
        {busy === "update" ? (
          <p role="status">{t("engine.updating")}</p>
        ) : (
          <button className="hh-primary" disabled={busy !== null} onClick={() => void runStep("update")}>
            {t("engine.updateRun")}
          </button>
        )}
        {engine.installDocsUrl && <p>{link(engine.installDocsUrl, t("engine.installDocs"))}</p>}
      </>
    );
  } else if (problem === "logged-out") {
    body = (
      <>
        <h3>{t("engine.loginTitle", v)}</h3>
        <p>{t("engine.loginText", v)}</p>
        {busy === "login" ? (
          <>
            <p role="status">{t("engine.loggingIn")}</p>
            {url && <p>{link(url, t("engine.loginOpen"))}</p>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!code.trim()) return;
                void client.setupInput(code.trim());
                setCode("");
              }}
            >
              <label>
                {t("engine.loginCode")} <input value={code} onChange={(e) => setCode(e.target.value)} />
              </label>{" "}
              <button type="submit">{t("engine.loginCodeSend")}</button>
            </form>
            <button onClick={() => void client.cancelSetup()}>{t("engine.cancel")}</button>
          </>
        ) : (
          <button className="hh-primary" disabled={busy !== null} onClick={() => void runStep("login")}>
            {t("engine.loginRun")}
          </button>
        )}
      </>
    );
  } else {
    body = (
      <>
        <h3>{t("engine.testTitle")}</h3>
        {failed && busy === null ? (
          <button className="hh-primary" onClick={() => void runTest()}>
            {t("engine.retry")}
          </button>
        ) : (
          <p role="status">{t("engine.testing", v)}</p>
        )}
      </>
    );
  }

  return (
    <section className="hh-onboarding" aria-busy={busy !== null}>
      {body}
      {failed && (
        <p className="hh-save-error" role="alert">
          {t("engine.failed")}
        </p>
      )}
      {lines.length > 0 && (
        <details>
          <summary>{t("engine.details")}</summary>
          <pre>{lines.join("\n")}</pre>
        </details>
      )}
    </section>
  );
}
```
(The streamed lines sit inside a closed `<details>`; `getByText` still finds them in happy-dom.)

- [ ] **Step 4: Implement — the Engine tab**

Create `packages/ui/src/EngineTab.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AppState, type EngineStatus, type HarnessClient, engineProblem } from "./client";
import { EngineOnboarding } from "./EngineOnboarding";
import { FolderStep, uiLanguage } from "./FolderStep";

/** Settings → Engine: the folder on first launch, then engine tiles, onboarding and the engine in use. */
export function EngineTab({ client, state, onChange }: { client: HarnessClient; state: AppState; onChange: (s: AppState) => void }) {
  const { t, i18n } = useTranslation();
  const lang = uiLanguage(state, i18n.language);
  const current = state.config.engineId;
  const [selected, setSelected] = useState(current ?? state.engines[0]?.id);
  const [statuses, setStatuses] = useState<Record<string, EngineStatus>>({});
  const [busy, setBusy] = useState<null | "use" | "logout">(null);
  const [failed, setFailed] = useState(false);
  const ids = state.engines.map((e) => e.id).join(",");
  const hasFolder = Boolean(state.config.folder);

  const refresh = useCallback(
    async (id: string) => {
      try {
        const status = await client.engineStatus(id);
        setStatuses((all) => ({ ...all, [id]: status }));
      } catch {
        setFailed(true);
      }
    },
    [client],
  );

  useEffect(() => {
    if (!hasFolder) return;
    for (const id of ids.split(",").filter(Boolean)) void refresh(id);
  }, [hasFolder, ids, refresh]);

  if (!hasFolder) return <FolderStep client={client} state={state} onSaved={onChange} />;

  const engine = state.engines.find((e) => e.id === selected);
  const status = selected ? statuses[selected] : undefined;
  const ready = status ? engineProblem(status) === null : false;

  const use = async () => {
    if (!selected) return;
    setBusy("use");
    setFailed(false);
    try {
      onChange(await client.saveConfig({ engineId: selected }));
    } catch {
      setFailed(true);
    }
    setBusy(null);
  };
  const signOut = async () => {
    if (!selected) return;
    setBusy("logout");
    setFailed(false);
    const result = await client.runSetup(selected, "logout").catch(() => ({ ok: false }));
    setBusy(null);
    await refresh(selected);
    if (!result.ok) setFailed(true);
  };

  return (
    <div className="hh-tab">
      <div className="hh-tiles" role="group" aria-label={t("engine.tilesLabel")}>
        {state.engines.map((e) => {
          const s = statuses[e.id];
          const label = !s ? t("home.checking") : engineProblem(s) === null ? t("home.connected") : t("home.notConnected");
          return (
            <button key={e.id} type="button" className="hh-tile" aria-pressed={selected === e.id} onClick={() => setSelected(e.id)}>
              {selected === e.id && (
                <span className="hh-check" aria-hidden="true">
                  ✓
                </span>
              )}
              {e.logo && <img src={e.logo} alt="" />}
              <strong>{e.name}</strong>
              <span className="hh-caption">{label}</span>
              {e.id === current && <span className="hh-caption">{t("engine.current")}</span>}
              {e.status === "pending" && <em className="hh-caption">{t("setup.enginePending")}</em>}
            </button>
          );
        })}
        <div className="hh-tile more" aria-disabled="true">
          {t("engine.moreSoon")}
        </div>
      </div>

      {engine && !status && <p role="status">{t("engine.checking", { engine: engine.name })}</p>}
      {engine && status && !ready && (
        <EngineOnboarding key={engine.id} client={client} engine={engine} status={status} refresh={() => refresh(engine.id)} />
      )}
      {engine && status && ready && (
        <>
          {selected !== current && (
            <button className="hh-primary" disabled={busy !== null} onClick={() => void use()}>
              {t("engine.use", { engine: engine.name })}
            </button>
          )}
          <div className="hh-rows">
            <div className="hh-row">
              <span>{t("engine.ready", { engine: engine.name })}</span>
              {busy === "logout" ? (
                <span role="status">{t("engine.signingOut")}</span>
              ) : (
                <button disabled={busy !== null} onClick={() => void signOut()}>
                  {t("engine.signOut")}
                </button>
              )}
            </div>
            <div className="hh-row">
              <span className="hh-row-label">{t("engine.plan")}</span>
              <span>{engine.requires[lang]}</span>
            </div>
            <div className="hh-row">
              <span className="hh-row-label">{t("engine.data")}</span>
              <span>{engine.dataLocation[lang]}</span>
            </div>
            <div className="hh-row">
              <span className="hh-row-label">{t("engine.version")}</span>
              <span>{status.version}</span>
            </div>
          </div>
          <p className="hh-caption">{t("engine.noticeContent", { provider: engine.provider })}</p>
        </>
      )}
      {failed && (
        <p className="hh-save-error" role="alert">
          {t("engine.failed")}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `corepack pnpm vitest run packages/ui && corepack pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): engine tab with folder step, engine tiles, legal notice, install, sign-in and test prompt"
```

---

### Task 13: Settings sheet with General and Usage tabs

**Files:**
- Create: `packages/ui/src/SettingsSheet.tsx`, `packages/ui/test/settings.test.tsx`

- [ ] **Step 1: Failing test**

Create `packages/ui/test/settings.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../src/client";
import { type SettingsTab, SettingsSheet } from "../src/SettingsSheet";
import { formatReset } from "../src/usage";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

function Sheet({ client, initialTab = "general", onClose = () => {} }: { client: FakeClient; initialTab?: SettingsTab; onClose?: () => void }) {
  const [state, setState] = useState<AppState>(client.state);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  return <SettingsSheet client={client} state={state} tab={tab} onTab={setTab} onChange={setState} onClose={onClose} />;
}

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

describe("SettingsSheet", () => {
  it("is a dialog with General, Engine and Usage tabs; Done and Escape close it", async () => {
    const client = new FakeClient(ready);
    const onClose = vi.fn();
    await renderIn("en", <Sheet client={client} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(within(dialog).getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Engine", "Usage"]);
    fireEvent.click(screen.getByRole("tab", { name: "Engine" }));
    expect(screen.getByRole("tab", { name: "Engine" }).getAttribute("aria-selected")).toBe("true");
    await screen.findByRole("group", { name: "AI engines" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("General: changes language and appearance, shows the fixed folder and the About card", async () => {
    const client = new FakeClient(ready);
    await renderIn("en", <Sheet client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(client.state.config.appearance).toBe("dark"));
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
    expect(screen.getByText("Chosen at setup; it can't be changed.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    await waitFor(() => expect(client.revealed).toBe(1));
    expect(screen.getByText("Version 0.1.0")).toBeTruthy();
    expect(screen.getByText("Made by Marco Zanger with Human Harness")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Support" }).getAttribute("href")).toBe("https://example.com/donate");
    fireEvent.click(screen.getByRole("button", { name: "Español" }));
    await screen.findByRole("tab", { name: "Motor" });
    expect(client.state.config.language).toBe("es");
  });

  it("Usage: shows each plan window with its reset, and each action's cost and estimate", async () => {
    const client = new FakeClient(ready);
    const reset = new Date(Date.now() + 2 * 3600_000).toISOString();
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.84, resetsAt: reset }], estimates: { tidy: 0.08 } };
    client.state.actions = {
      tidy: { label: { es: "Ordenar", en: "Tidy up" }, cost: "heavy" },
      note: { label: { es: "Nota", en: "Quick note" }, cost: "light" },
    };
    await renderIn("en", <Sheet client={client} initialTab="usage" />);
    expect((await screen.findByText("5 h: 84 % used")).className).toBe("hh-warn");
    expect(screen.getByText(`Resets ${formatReset(reset, "en")}`)).toBeTruthy();
    expect(screen.getByText("Heavy · Usually about 8 % of the 5-hour window")).toBeTruthy();
    expect(screen.getByText("Light")).toBeTruthy();
  });

  it("Usage: says when the engine doesn't report limits, and when the app has no actions", async () => {
    const client = new FakeClient({ ...ready, engineId: "codex" });
    client.state.engines = [{ ...client.state.engines[0], id: "codex", name: "Codex", provider: "OpenAI", reportsLimits: false }];
    await renderIn("en", <Sheet client={client} initialTab="usage" />);
    await screen.findByText("Codex doesn't report your plan's limits.");
    expect(screen.getByText("This app doesn't declare any actions.")).toBeTruthy();
  });
});
```

Run: `corepack pnpm vitest run packages/ui/test/settings.test.tsx`
Expected: FAIL (`SettingsSheet` missing).

- [ ] **Step 2: Implement**

Create `packages/ui/src/SettingsSheet.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import { Segmented } from "./chrome";
import type { AppConfig, AppState, Appearance, HarnessClient, UsageSummary } from "./client";
import { EngineTab } from "./EngineTab";
import { FolderStep, uiLanguage } from "./FolderStep";
import { WARN_AT, formatReset, percent } from "./usage";

export type SettingsTab = "general" | "engine" | "usage";
const TABS: SettingsTab[] = ["general", "engine", "usage"];
const LANGUAGE_NAMES: Record<Language, string> = { es: "Español", en: "English" };

/** The Settings sheet (spec 2026-10-11 "Settings sheet"): attached under the top bar, dimmed backdrop. */
export function SettingsSheet({
  client,
  state,
  tab,
  onTab,
  onChange,
  onClose,
}: {
  client: HarnessClient;
  state: AppState;
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  onChange: (state: AppState) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const doneRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    doneRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="hh-sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="hh-sheet" role="dialog" aria-modal="true" aria-label={t("settings.title")}>
        <div className="hh-sheet-head">
          <div className="hh-segmented" role="tablist" aria-label={t("settings.title")}>
            {TABS.map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTab(id)}>
                {t(`settings.tabs.${id}`)}
              </button>
            ))}
          </div>
          <button ref={doneRef} className="hh-primary" onClick={onClose}>
            {t("settings.done")}
          </button>
        </div>
        <div role="tabpanel" aria-label={t(`settings.tabs.${tab}`)}>
          {tab === "general" && <GeneralTab client={client} state={state} onChange={onChange} />}
          {tab === "engine" && <EngineTab client={client} state={state} onChange={onChange} />}
          {tab === "usage" && <UsageTab client={client} state={state} />}
        </div>
      </div>
    </div>
  );
}

function GeneralTab({ client, state, onChange }: { client: HarnessClient; state: AppState; onChange: (s: AppState) => void }) {
  const { t, i18n } = useTranslation();
  const lang = uiLanguage(state, i18n.language);
  const save = (patch: AppConfig) => client.saveConfig(patch).then(onChange, () => {});
  const changeLanguage = (language: Language) => {
    void i18n.changeLanguage(language);
    void save({ language });
  };
  const appearances: { value: Appearance; label: string }[] = [
    { value: "system", label: t("settings.appearanceSystem") },
    { value: "light", label: t("settings.appearanceLight") },
    { value: "dark", label: t("settings.appearanceDark") },
  ];

  return (
    <div className="hh-tab">
      <div className="hh-rows">
        <div className="hh-row">
          <span className="hh-row-label">{t("settings.language")}</span>
          <Segmented
            label={t("settings.language")}
            value={lang}
            onChange={changeLanguage}
            options={state.harness.languages.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }))}
          />
        </div>
        <div className="hh-row">
          <span className="hh-row-label">{t("settings.appearance")}</span>
          <Segmented label={t("settings.appearance")} value={state.config.appearance ?? "system"} onChange={(appearance) => void save({ appearance })} options={appearances} />
        </div>
        {state.config.folder && (
          <div className="hh-row">
            <span className="hh-row-label">{t("settings.folder")}</span>
            <code>{state.config.folder}</code>
            <button onClick={() => void client.revealFolder()}>{t("settings.reveal")}</button>
          </div>
        )}
      </div>
      {state.config.folder ? (
        <p className="hh-caption">{t("settings.folderFixed")}</p>
      ) : (
        <FolderStep client={client} state={state} onSaved={onChange} />
      )}

      <h3>{t("settings.about")}</h3>
      <div className="hh-rows">
        <div className="hh-row">
          <span className="hh-display">{state.harness.name[lang]}</span>
          <span className="hh-caption">{t("settings.version", { version: state.harness.version })}</span>
        </div>
        <div className="hh-row">
          <span>{t("settings.madeBy", { author: state.harness.author })}</span>
          {state.harness.donate && (
            <a className="hh-button" href={state.harness.donate} target="_blank" rel="noreferrer">
              {t("settings.support")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function UsageTab({ client, state }: { client: HarnessClient; state: AppState }) {
  const { t, i18n } = useTranslation();
  const lang = uiLanguage(state, i18n.language);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  useEffect(() => {
    client.getUsage().then(setUsage, () => setUsage({ limits: null, estimates: {} }));
  }, [client]);
  const engine = state.engines.find((e) => e.id === state.config.engineId);
  const actions = Object.entries(state.actions);

  let plan;
  if (!engine) plan = <p className="hh-caption">{t("home.noEngine")}</p>;
  else if (!engine.reportsLimits) plan = <p className="hh-caption">{t("usage.noLimits", { engine: engine.name })}</p>;
  else if (!usage?.limits?.length) plan = <p className="hh-caption">{t("usage.unknown")}</p>;
  else
    plan = (
      <div className="hh-rows">
        {usage.limits.map((w) => (
          <div key={w.kind} className="hh-row">
            <span className={w.utilization >= WARN_AT ? "hh-warn" : undefined}>
              {t("usage.window", { label: t(`usage.${w.kind}`, { defaultValue: w.kind }), percent: percent(w.utilization) })}
            </span>
            <span className="hh-caption">{t("usage.resetsFull", { time: formatReset(w.resetsAt, i18n.language) })}</span>
          </div>
        ))}
      </div>
    );

  return (
    <div className="hh-tab">
      <h3>{t("usage.planTitle")}</h3>
      {plan}
      <h3>{t("usage.actionsTitle")}</h3>
      {actions.length === 0 ? (
        <p className="hh-caption">{t("usage.noActions")}</p>
      ) : (
        <div className="hh-rows">
          {actions.map(([id, action]) => {
            const estimate = usage?.estimates[id];
            return (
              <div key={id} className="hh-row">
                <span>{action.label[lang]}</span>
                <span className={action.cost === "heavy" ? "hh-warn" : "hh-caption"}>
                  {t(`usage.cost.${action.cost}`)}
                  {estimate !== undefined ? ` · ${t("usage.estimate", { percent: Math.max(1, percent(estimate)) })}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `corepack pnpm vitest run packages/ui && corepack pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): settings sheet with General and Usage tabs"
```

---

### Task 14: Home screen and app routing

**Files:**
- Create: `packages/ui/src/Home.tsx`
- Modify: `packages/ui/src/HarnessApp.tsx` (full replacement), `packages/ui/src/index.ts`
- Delete: `packages/ui/src/SetupScreen.tsx`
- Modify: `packages/i18n/src/locales/{en,es}.json` (drop `setup.title`, `setup.start`, `setup.engine`, `setup.engineHint`)
- Modify: `packages/ui/test/HarnessApp.test.tsx`

Every launch opens on Home. Start goes to the work screen, or — on first launch — opens Settings on the Engine tab; when the sheet finishes setup, the work screen opens. The engine is checked in the background on start and when the engine changes; the result shows in the pill.

- [ ] **Step 1: Move the existing tests to the new flow**

In `packages/ui/test/HarnessApp.test.tsx`:
1. Add `import type { ReactElement } from "react";` and, after the `Note` component, this helper:
```tsx
/** Renders the app and goes from Home to the work screen, as a returning user does. */
async function startWork(ui: ReactElement) {
  const result = render(ui);
  fireEvent.click(await screen.findByRole("button", { name: /^(Start|Iniciar) Demo$/ }));
  return result;
}
```
2. Delete these tests (the 2a setup screen is gone; their checks now live in `engine-tab.test.tsx` and `settings.test.tsx`): `"shows the setup screen until language, folder and engine are chosen"`, `"lets the user pick another folder and warns about moving it"`, `"explains a folder that can't be used, keeps the previous one, and clears the message on a good pick"`, `"shows a message when the settings can't be saved"`, `"saves the language chosen in setup when starting"`, `"groups setup choices in fieldsets with legends"`.
3. In every remaining test that builds its client with `ready` (or `{ ...ready, … }`), except `"shows a loading state, then a translated error if the state cannot load"`, replace `render(<HarnessApp` with `await startWork(<HarnessApp` (keep any destructuring: `const { container } = await startWork(…)`, `const { rerender } = await startWork(…)`).

Append inside `describe("HarnessApp")`:
```tsx
  it("opens on Home with the logo, name, tagline, Start and the engine pill", async () => {
    const client = new FakeClient(ready);
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.42, resetsAt: new Date(Date.now() + 3600_000).toISOString() }], estimates: {} };
    const { container } = render(<HarnessApp client={client} />);
    expect(await screen.findByRole("heading", { name: "Demo" })).toBeTruthy();
    expect(screen.getByText("Test notes")).toBeTruthy();
    expect(container.querySelector("svg.hh-logo")).toBeTruthy();
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
    const pill = await screen.findByRole("button", { name: /Claude.*Connected.*5 h · 42 %/ });
    fireEvent.click(pill);
    await screen.findByRole("group", { name: "AI engines" });
  });

  it("uses the harness's own logo when it has one", async () => {
    const client = new FakeClient(ready);
    client.state.harness.logo = "data:image/svg+xml;base64,PHN2Zy8+";
    const { container } = render(<HarnessApp client={client} />);
    await screen.findByRole("heading", { name: "Demo" });
    expect(container.querySelector("img.hh-home-logo")?.getAttribute("src")).toBe("data:image/svg+xml;base64,PHN2Zy8+");
  });

  it("on first launch, Start opens Settings → Engine and the work screen opens once it is set up", async () => {
    const client = new FakeClient();
    render(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /^(Start|Iniciar) Demo$/ }));
    expect(screen.getByRole("tab", { name: /Engine|Motor/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Use this folder|Usar esta carpeta/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Use Claude|Usar Claude/ }));
    await screen.findByPlaceholderText(/Write a message|Escribí un mensaje/);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(client.state.config).toMatchObject({ folder: "/Users/me/Documents/Demo", engineId: "claude" });
  });

  it("the gear opens Settings on General and Done goes back to Home", async () => {
    render(<HarnessApp client={new FakeClient(ready)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Start Demo" })).toBeTruthy();
  });

  it("shows a signed-out engine as not connected, and the pill leads to sign-in", async () => {
    const client = new FakeClient(ready);
    client.status = { ...client.status, loggedIn: false };
    render(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /Claude.*Not connected/ }));
    await screen.findByRole("heading", { name: "Sign in to Claude" });
  });

  it("follows the UI language in <html lang>", async () => {
    render(<HarnessApp client={new FakeClient({ ...ready, language: "es" })} />);
    await screen.findByRole("button", { name: "Iniciar Demo" });
    expect(document.documentElement.lang).toBe("es");
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await screen.findByRole("button", { name: "Start Demo" });
    expect(document.documentElement.lang).toBe("en");
  });
```

Run: `corepack pnpm vitest run packages/ui/test/HarnessApp.test.tsx`
Expected: FAIL (no Home: no "Start Demo" button).

- [ ] **Step 2: Implement — Home**

Create `packages/ui/src/Home.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import { GearIcon, HHLogo, TopBar } from "./chrome";
import { type AppState, type EngineStatus, type LimitWindow, engineProblem } from "./client";
import { uiLanguage } from "./FolderStep";
import { WARN_AT, fiveHour, percent } from "./usage";

/** The first screen of every launch (spec 2026-10-11 "Home"). */
export function Home({
  state,
  status,
  limits,
  onStart,
  onSettings,
  onEngine,
}: {
  state: AppState;
  /** Background check of the configured engine; null while it runs. */
  status: EngineStatus | null;
  limits: LimitWindow[] | null;
  onStart: () => void;
  onSettings: () => void;
  onEngine: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLanguage(state, i18n.language);
  const name = state.harness.name[lang];
  const engine = state.engines.find((e) => e.id === state.config.engineId);
  const connected = status ? engineProblem(status) === null : null;
  const window = engine?.reportsLimits ? fiveHour(limits) : undefined;

  return (
    <div className="hh-home">
      <TopBar>
        <button className="hh-icon-button" aria-label={t("home.settings")} onClick={onSettings}>
          <GearIcon />
        </button>
      </TopBar>
      <main className="hh-home-main">
        {state.harness.logo ? <img className="hh-home-logo" src={state.harness.logo} alt="" /> : <HHLogo className="hh-home-logo" />}
        <h1 className="hh-home-name">{name}</h1>
        {state.harness.tagline && <p className="hh-home-tagline">{state.harness.tagline[lang]}</p>}
        <button className="hh-primary hh-start" onClick={onStart}>
          {t("home.start", { name })}
        </button>
        {engine ? (
          <button className="hh-pill" onClick={onEngine}>
            {engine.logo && <img src={engine.logo} alt="" />}
            <span>{engine.name}</span>
            <span className={connected ? "hh-dot ok" : "hh-dot"} aria-hidden="true" />
            <span>{connected === null ? t("home.checking") : connected ? t("home.connected") : t("home.notConnected")}</span>
            {window && (
              <span className={window.utilization >= WARN_AT ? "hh-warn" : "hh-caption"}>
                {t("home.usage", { label: t("usage.five_hour"), percent: percent(window.utilization) })}
              </span>
            )}
          </button>
        ) : (
          <p className="hh-caption">{t("home.noEngine")}</p>
        )}
      </main>
      <footer className="hh-footer">
        <span className="hh-wordmark">Human Harness</span>
        <span>{state.config.folder ?? ""}</span>
      </footer>
    </div>
  );
}
```

- [ ] **Step 3: Implement — routing**

Replace `packages/ui/src/HarnessApp.tsx` with:
```tsx
import { type ComponentType, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { I18nextProvider } from "react-i18next";
import type { i18n } from "i18next";
import { type Locales, createI18n } from "@humanharness/i18n";
import { ChatView } from "./ChatView";
import { type AppState, type EngineStatus, type HarnessClient, type LimitWindow, isConfigured } from "./client";
import { Home } from "./Home";
import type { BlockProps } from "./Message";
import { type SettingsTab, SettingsSheet } from "./SettingsSheet";

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
  const [failed, setFailed] = useState(false);
  const [screen, setScreen] = useState<"home" | "work">("home");
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  /** Background check of the configured engine (spec §9 "every start"). */
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [limits, setLimits] = useState<LimitWindow[] | null>(null);
  /** Start was pressed before setup was complete: open the work screen as soon as it is. */
  const startWhenReady = useRef(false);
  // Read through a ref so inline `locales` objects don't re-run the load.
  const localesRef = useRef(locales);
  localesRef.current = locales;

  useEffect(() => {
    let cancelled = false;
    const systemLanguage = navigator.language.startsWith("es") ? "es" : "en";
    void (async () => {
      try {
        const s = await client.getState();
        const preferred = s.config.language ?? systemLanguage;
        const language = s.harness.languages.includes(preferred) ? preferred : s.harness.languages[0];
        const instance = await createI18n(language, localesRef.current);
        if (cancelled) return;
        setI18n(instance);
        setState(s);
      } catch {
        const instance = await createI18n(systemLanguage, localesRef.current);
        if (cancelled) return;
        setI18n(instance);
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (!i18n) return;
    const apply = (language: string) => {
      document.documentElement.lang = language;
    };
    apply(i18n.language);
    i18n.on("languageChanged", apply);
    return () => {
      i18n.off("languageChanged", apply);
    };
  }, [i18n]);

  const engineId = state?.config.engineId;
  const configured = state ? isConfigured(state.config) : false;

  const checkEngine = useCallback(() => {
    if (!engineId) return setStatus(null);
    client.engineStatus(engineId).then(setStatus, () => {});
  }, [client, engineId]);

  useEffect(() => {
    setStatus(null);
    checkEngine();
  }, [checkEngine]);

  // Usage for the engine pill, refreshed whenever Home shows again.
  useEffect(() => {
    if (!configured || screen !== "home") return;
    let cancelled = false;
    client.getUsage().then(
      (u) => {
        if (!cancelled) setLimits(u.limits);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, configured, engineId, screen]);

  // First launch: once Settings has finished the setup, start.
  useEffect(() => {
    if (configured && startWhenReady.current) {
      startWhenReady.current = false;
      setSettings(null);
      setScreen("work");
      checkEngine();
    }
  }, [configured, checkEngine]);

  if (failed && i18n) {
    return (
      <p className="hh-load-error" role="alert">
        {i18n.t("app.loadError")}
      </p>
    );
  }
  if (!state || !i18n) return <div className="hh-loading" role="status" aria-busy="true" />;

  const start = () => {
    if (isConfigured(state.config)) return setScreen("work");
    startWhenReady.current = true;
    setSettings("engine");
  };
  const closeSettings = () => {
    startWhenReady.current = false;
    setSettings(null);
    checkEngine();
  };

  return (
    <I18nextProvider i18n={i18n}>
      {screen === "work" && configured ? (
        <ChatView key={engineId} client={client} state={state} components={blocks} stateBlocks={stateBlocks} renderSide={renderSide} />
      ) : (
        <Home
          state={state}
          status={status}
          limits={limits}
          onStart={start}
          onSettings={() => setSettings("general")}
          onEngine={() => setSettings("engine")}
        />
      )}
      {settings && <SettingsSheet client={client} state={state} tab={settings} onTab={setSettings} onChange={setState} onClose={closeSettings} />}
    </I18nextProvider>
  );
}
```

Delete `packages/ui/src/SetupScreen.tsx`, and remove the keys `title`, `start`, `engine` and `engineHint` from the `setup` object of both `packages/i18n/src/locales/en.json` and `es.json`.

Replace `packages/ui/src/index.ts` with:
```ts
export * from "./client";
export * from "./state";
export * from "./usage";
export { HarnessApp, type HarnessAppProps } from "./HarnessApp";
export type { BlockProps } from "./Message";
```

- [ ] **Step 4: Verify**

Run: `corepack pnpm test && corepack pnpm typecheck`
Expected: all pass (HarnessApp tests on the new flow, i18n parity); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A packages/ui packages/i18n
git commit -m "feat(ui): home screen and app routing; settings sheet replaces the setup screen"
```

---

### Task 15: Work screen: top bar, usage meter, pre-flight and fixable errors

**Files:**
- Create: `packages/ui/src/UsageMeter.tsx`
- Modify: `packages/ui/src/ErrorCard.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/Message.tsx`, `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/index.ts`
- Modify: `packages/ui/test/HarnessApp.test.tsx`

The work screen keeps the 2a chat layout (its own design comes later) under a top bar: harness name, compact usage meter, Home, History and the gear.

- [ ] **Step 1: Failing tests**

At the top of `packages/ui/test/HarnessApp.test.tsx`, add `import { formatReset } from "../src/usage";`. Append inside `describe("HarnessApp")` (below the `typeAndSend` helper):
```tsx
  const in2h = () => new Date(Date.now() + 2 * 3600_000).toISOString();
  const in4d = () => new Date(Date.now() + 4 * 86400_000).toISOString();

  it("shows Claude's plan windows in the top bar, from the log and then live", async () => {
    const client = new FakeClient(ready);
    const fiveHourReset = in2h();
    client.usage = {
      limits: [
        { kind: "five_hour", utilization: 0.16, resetsAt: fiveHourReset },
        { kind: "seven_day", utilization: 0.09, resetsAt: in4d() },
      ],
      estimates: {},
    };
    await startWork(<HarnessApp client={client} />);
    await screen.findByText(`5 h: 16 % used · resets at ${formatReset(fiveHourReset, "en")} — week: 9 % used`);
    act(() => client.emit({ type: "limits", status: "allowed", windows: [{ kind: "five_hour", utilization: 0.85, resetsAt: fiveHourReset }] }));
    expect(screen.getByText(/Close to your limit/)).toBeTruthy();
  });

  it("before any message, says usage shows up later", async () => {
    await startWork(<HarnessApp client={new FakeClient(ready)} />);
    await screen.findByText("Your plan's usage shows up after the first message.");
  });

  it("says when the engine doesn't report limits and shows the last reply's tokens", async () => {
    const client = new FakeClient({ ...ready, engineId: "codex" });
    client.state.engines = [{ ...client.state.engines[0], id: "codex", name: "Codex", provider: "OpenAI", reportsLimits: false }];
    client.chat = [
      { id: "1", role: "assistant", text: "hi", blocks: [], activities: [], at: "t", usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    ];
    await startWork(<HarnessApp client={client} />);
    await screen.findByText(/Codex doesn't report your plan's limits\. Last message: 1\.2K tokens\./);
  });

  it("asks before a heavy action when the 5-hour window is high, and sends only on Continue", async () => {
    const client = new FakeClient(ready);
    client.state.actions = { tidy: { label: { es: "Ordenar", en: "Tidy up" }, cost: "heavy" } };
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.75, resetsAt: in2h() }], estimates: { tidy: 0.08 } };
    await startWork(<HarnessApp client={client} renderSide={(_s, send) => <button onClick={() => send("Tidy all notes", { action: "tidy" })}>tidy</button>} />);
    await screen.findByText(/5 h: 75 % used/);
    fireEvent.click(screen.getByRole("button", { name: "tidy" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain('"Tidy up" usually uses about 8 % of your 5-hour window. You have 25 % left.');
    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(client.sent).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "tidy" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(client.sent).toEqual(["Tidy all notes"]));
    expect(client.sentOptions).toEqual([{ action: "tidy" }]);
  });

  it("goes straight ahead with a heavy action when there is room", async () => {
    const client = new FakeClient(ready);
    client.state.actions = { tidy: { label: { es: "Ordenar", en: "Tidy up" }, cost: "heavy" } };
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.2, resetsAt: in2h() }], estimates: {} };
    await startWork(<HarnessApp client={client} renderSide={(_s, send) => <button onClick={() => send("Tidy all notes", { action: "tidy" })}>tidy</button>} />);
    await screen.findByText(/5 h: 20 % used/);
    fireEvent.click(screen.getByRole("button", { name: "tidy" }));
    await waitFor(() => expect(client.sent).toEqual(["Tidy all notes"]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("tells when the limit resets on an out-of-quota card", async () => {
    const client = new FakeClient(ready);
    const reset = in2h();
    client.usage = { limits: [{ kind: "five_hour", utilization: 1, resetsAt: reset }], estimates: {} };
    await startWork(<HarnessApp client={client} />);
    await screen.findByText(/5 h: 100 % used/);
    await typeAndSend(client, "go");
    act(() => client.emit({ type: "done", ok: false, error: { code: "out-of-quota" } }));
    expect(screen.getByText(`Your limit resets: ${formatReset(reset, "en")}.`)).toBeTruthy();
  });

  it("shows a card for a signed-out engine whose button opens the sign-in step", async () => {
    const client = new FakeClient(ready);
    client.status = { ...client.status, loggedIn: false };
    await startWork(<HarnessApp client={client} />);
    await screen.findByText("Your Claude session ended. Sign in again to continue.");
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    await screen.findByRole("heading", { name: "Sign in to Claude" });
  });

  it("changes engine from Settings → Engine and starts a new conversation", async () => {
    const client = new FakeClient(ready);
    client.state.engines = [...client.state.engines, { ...client.state.engines[0], id: "codex", name: "Codex", provider: "OpenAI", reportsLimits: false }];
    await startWork(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Engine" }));
    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    client.switchedFrom = "claude";
    fireEvent.click(await screen.findByRole("button", { name: "Use Codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByText("You're now using Codex, so I started a new conversation. The earlier one is saved in your folder.");
    expect(client.state.config.engineId).toBe("codex");
  });

  it("goes back Home from the work screen", async () => {
    await startWork(<HarnessApp client={new FakeClient(ready)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Home" }));
    await screen.findByRole("button", { name: "Start Demo" });
  });

  it("restores the side panel from the saved conversation", async () => {
    const client = new FakeClient(ready);
    client.chat = [{ id: "1", role: "assistant", text: "", blocks: [], activities: [], at: "t", state: { progress: { percent: 60 } } }];
    await startWork(
      <HarnessApp client={client} stateBlocks={["progress"]} renderSide={(s) => <p>Progress {(s.progress as { percent: number } | undefined)?.percent ?? 0}%</p>} />,
    );
    await screen.findByText("Progress 60%");
  });
```

Run: `corepack pnpm vitest run packages/ui/test/HarnessApp.test.tsx`
Expected: FAIL (no meter, no dialog, no fix buttons, no Home button; `renderSide` gets one argument).

- [ ] **Step 2: Implement — meter and error card**

Create `packages/ui/src/UsageMeter.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import type { EngineOption, LimitWindow } from "./client";
import { HIGH_AT, WARN_AT, compactTokens, formatReset, percent } from "./usage";

/** Where the user stands on their plan (spec §6), in one line: only what the engine reports. */
export function UsageMeter({ engine, limits, lastTokens }: { engine?: EngineOption; limits: LimitWindow[] | null; lastTokens: number | null }) {
  const { t, i18n } = useTranslation();
  if (!engine) return null;
  if (!engine.reportsLimits) {
    const tokens = lastTokens !== null ? ` ${t("usage.lastTurn", { tokens: compactTokens(lastTokens, i18n.language) })}` : "";
    return <p className="hh-usage">{t("usage.noLimits", { engine: engine.name }) + tokens}</p>;
  }
  if (!limits?.length) return <p className="hh-usage">{t("usage.unknown")}</p>;
  const text = limits
    .map((w) => {
      const part = t("usage.window", { label: t(`usage.${w.kind}`, { defaultValue: w.kind }), percent: percent(w.utilization) });
      return w.kind === "five_hour" ? `${part} · ${t("usage.resets", { time: formatReset(w.resetsAt, i18n.language) })}` : part;
    })
    .join(" — ");
  const highest = Math.max(...limits.map((w) => w.utilization));
  const warning = highest >= HIGH_AT ? t("usage.almostOut") : highest >= WARN_AT ? t("usage.near") : null;
  return (
    <p className={warning ? "hh-usage hh-warn" : "hh-usage"}>
      {warning && <strong>{warning} · </strong>}
      {text}
    </p>
  );
}
```

Replace `packages/ui/src/ErrorCard.tsx` with:
```tsx
import { useTranslation } from "react-i18next";
import type { EngineError, EngineProblem, LimitWindow } from "./client";
import { formatReset, resetWindow } from "./usage";

/** A turn error, or "notice" for an engine whose setup isn't finished. */
export type CardError = EngineError | { code: "notice"; detail?: string };

/** Errors the user fixes in Settings → Engine. */
const FIXABLE = new Set(["engine-not-installed", "session-expired", "outdated-version", "notice"]);

/** The card for an engine that can't run yet (the background check). */
export function problemError(problem: EngineProblem): CardError {
  if (problem === "not-installed") return { code: "engine-not-installed" };
  if (problem === "outdated") return { code: "outdated-version" };
  if (problem === "logged-out") return { code: "session-expired" };
  return { code: "notice" };
}

export function ErrorCard({
  error,
  engine,
  onRetry,
  onFix,
  limits = null,
}: {
  error: CardError;
  engine: string;
  onRetry?: () => void;
  /** Opens Settings → Engine, where the matching step fixes this error. */
  onFix?: () => void;
  limits?: LimitWindow[] | null;
}) {
  const { t, i18n } = useTranslation();
  const reset = error.code === "out-of-quota" ? resetWindow(limits) : undefined;
  return (
    <div className="hh-error" role="alert">
      <p>{t(`errors.${error.code}`, { engine, defaultValue: t("errors.agent-crashed", { engine }) })}</p>
      {reset && <p>{t("errors.resetsAt", { time: formatReset(reset.resetsAt, i18n.language) })}</p>}
      {onFix && FIXABLE.has(error.code) && (
        <button className="hh-primary" onClick={onFix}>
          {t(`errors.fix.${error.code}`, { engine })}
        </button>
      )}
      {onRetry && error.code !== "cancelled" && error.code !== "notice" && <button onClick={onRetry}>{t("errors.retry")}</button>}
    </div>
  );
}
```

`packages/ui/src/Message.tsx` — blocks can start actions too. Change the import and `BlockProps`:
```ts
import type { ChatEntry, SendOptions } from "./client";

export interface BlockProps {
  data: any;
  /** Sends a message as the user (e.g. the chosen option); `options.action` tags a harness action. */
  respond: (text: string, options?: SendOptions) => boolean;
}
```
and in `Blocks` and `Message`, type their `respond` prop as `(text: string, options?: SendOptions) => boolean`.

- [ ] **Step 3: Implement — chat view**

Replace `packages/ui/src/ChatView.tsx` with:
```tsx
import { type ComponentType, type FormEvent, type ReactNode, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityList } from "./ActivityList";
import { GearIcon, TopBar } from "./chrome";
import type { AppState, EngineProblem, HarnessClient, SendOptions } from "./client";
import { ErrorCard, problemError } from "./ErrorCard";
import { uiLanguage } from "./FolderStep";
import { HistoryPanel } from "./HistoryPanel";
import { type BlockProps, Blocks, Message } from "./Message";
import { initialChat, reduceChat } from "./state";
import { UsageMeter } from "./UsageMeter";
import { type Preflight, lastTurnTokens, percent, preflight } from "./usage";

/** How close to the bottom (px) the user must be for new content to keep the chat pinned. */
const STICK_THRESHOLD = 80;

export type SendFn = (text: string, options?: SendOptions) => boolean;

export function ChatView({
  client,
  state,
  components,
  stateBlocks,
  renderSide,
  engineProblem,
  onHome,
  onSettings,
  onFixEngine,
}: {
  client: HarnessClient;
  state: AppState;
  components: Record<string, ComponentType<BlockProps>>;
  stateBlocks: string[];
  renderSide?: (blockState: Record<string, unknown>, send: SendFn) => ReactNode;
  /** What the background check found wrong with the engine, if anything. */
  engineProblem?: EngineProblem | null;
  onHome?: () => void;
  onSettings?: () => void;
  onFixEngine?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [chat, dispatch] = useReducer(reduceChat, undefined, () => initialChat([], stateBlocks));
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [estimates, setEstimates] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<{ text: string; options: SendOptions; check: Preflight } | null>(null);
  const chatRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  // Set synchronously on send so two quick clicks can't both pass before the live turn renders.
  const busy = useRef(false);
  const wasLive = useRef(false);
  const lang = uiLanguage(state, i18n.language);
  const engineOption = state.engines.find((e) => e.id === state.config.engineId);
  const engine = engineOption?.name ?? state.config.engineId ?? "";

  useEffect(() => {
    void client.loadChat().then(({ entries, switchedFrom }) => {
      dispatch({ type: "loaded", entries });
      if (switchedFrom) dispatch({ type: "notice", text: t("chat.switched", { engine }), at: new Date().toISOString() });
    });
    client.getUsage().then(
      (u) => {
        setEstimates(u.estimates);
        if (u.limits) dispatch({ type: "limits", status: "allowed", windows: u.limits });
      },
      () => {},
    );
    return client.onEvent((e) => dispatch(e));
  }, [client]);

  useEffect(() => {
    if (!chat.live) busy.current = false;
  }, [chat.live]);

  useLayoutEffect(() => {
    const el = chatRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.entries, chat.live]);

  useEffect(() => {
    if (chat.live && !wasLive.current) setAnnouncement(t("chat.working"));
    if (!chat.live && wasLive.current) {
      setAnnouncement(chat.entries.findLast((e) => e.role === "assistant")?.text ?? "");
      inputRef.current?.focus();
      client.getUsage().then((u) => setEstimates(u.estimates), () => {});
    }
    wasLive.current = Boolean(chat.live);
  }, [chat.live, chat.entries, t, client]);

  /** True when the message was sent, or is waiting for the user to confirm a heavy action. */
  const send = (text: string, options: SendOptions = {}, confirmed = false): boolean => {
    const message = text.trim();
    if (!message || chat.live || busy.current || (pending && !confirmed)) return false;
    if (!confirmed && options.action) {
      const check = preflight(state.actions[options.action]?.cost, chat.limits, estimates[options.action]);
      if (check) {
        setPending({ text: message, options, check });
        return true;
      }
    }
    busy.current = true;
    stick.current = true;
    dispatch({ type: "user", text: message, at: new Date().toISOString(), ...(options.action ? { action: options.action } : {}) });
    client.send(message, options).catch((err: unknown) => {
      dispatch({ type: "done", ok: false, error: { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) } });
    });
    inputRef.current?.focus();
    return true;
  };
  /** What harness UI gets: it can't skip the pre-flight check. */
  const sendFromHarness: SendFn = (text, options) => send(text, options);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (send(draft)) setDraft("");
  };
  const onScroll = () => {
    const el = chatRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD;
  };
  const last = chat.entries.at(-1);
  const lastUser = chat.entries.findLast((e) => e.role === "user");

  let preflightText = "";
  if (pending) {
    const action = pending.options.action ?? "";
    const label = state.actions[action]?.label[lang] ?? action;
    const left = percent(pending.check.left);
    preflightText =
      pending.check.estimate !== null
        ? t("preflight.estimate", { action: label, estimate: Math.max(1, percent(pending.check.estimate)), left })
        : t("preflight.hint", { action: label, left });
  }

  return (
    <div className="hh-app">
      <TopBar title={state.harness.name[lang]}>
        <UsageMeter engine={engineOption} limits={chat.limits} lastTokens={lastTurnTokens(chat.entries)} />
        {onHome && <button onClick={onHome}>{t("chat.home")}</button>}
        <button onClick={() => setShowHistory(true)}>{t("history.title")}</button>
        {onSettings && (
          <button className="hh-icon-button" aria-label={t("home.settings")} onClick={onSettings}>
            <GearIcon />
          </button>
        )}
      </TopBar>
      <div className="hh-body">
        <section className="hh-chat" ref={chatRef} onScroll={onScroll}>
          {engineProblem && <ErrorCard error={problemError(engineProblem)} engine={engine} onFix={onFixEngine} />}
          {chat.entries.map((entry) => (
            <div key={entry.id}>
              <Message entry={entry} components={components} respond={sendFromHarness} />
              {entry.error && entry === last && (
                <ErrorCard
                  error={entry.error}
                  engine={engine}
                  limits={chat.limits}
                  onFix={onFixEngine}
                  onRetry={lastUser ? () => send(lastUser.text, lastUser.action ? { action: lastUser.action } : {}) : undefined}
                />
              )}
            </div>
          ))}
          {chat.live && (
            <article className="hh-message assistant live">
              <ActivityList items={chat.live.activities} />
              {chat.live.text ? chat.live.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>) : <p className="hh-working">{t("chat.working")}</p>}
              <Blocks blocks={chat.live.blocks} components={components} respond={sendFromHarness} />
            </article>
          )}
          {pending && (
            <div className="hh-confirm" role="alertdialog" aria-labelledby="hh-preflight-title">
              <p id="hh-preflight-title">
                <strong className="hh-warn">{t("preflight.title")}</strong>
              </p>
              <p>{preflightText}</p>
              <button
                className="hh-primary"
                onClick={() => {
                  const p = pending;
                  setPending(null);
                  send(p.text, p.options, true);
                }}
              >
                {t("preflight.continue")}
              </button>
              <button onClick={() => setPending(null)}>{t("preflight.notNow")}</button>
            </div>
          )}
        </section>
        {renderSide && <aside className="hh-side">{renderSide(chat.blockState, sendFromHarness)}</aside>}
      </div>
      <div className="hh-sr-only" aria-live="polite">
        {announcement}
      </div>
      <form className="hh-composer" onSubmit={onSubmit}>
        <textarea
          ref={inputRef}
          aria-label={t("chat.placeholder")}
          placeholder={t("chat.placeholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey) return;
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            if (send(draft)) setDraft("");
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
      {showHistory && (
        <HistoryPanel
          client={client}
          disabled={Boolean(chat.live)}
          onClose={() => setShowHistory(false)}
          onRestored={() => dispatch({ type: "notice", text: t("history.restored"), at: new Date().toISOString() })}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement — pass the new props**

In `packages/ui/src/HarnessApp.tsx`:
- import `type SendFn` from `"./ChatView"` and `engineProblem` from `"./client"`;
- change `renderSide` in `HarnessAppProps` to:
```ts
  /** The side panel: gets the latest state blocks and `send` for buttons that start harness actions. */
  renderSide?: (blockState: Record<string, unknown>, send: SendFn) => ReactNode;
```
- replace the `<ChatView … />` element with:
```tsx
        <ChatView
          key={engineId}
          client={client}
          state={state}
          components={blocks}
          stateBlocks={stateBlocks}
          renderSide={renderSide}
          engineProblem={status ? engineProblem(status) : null}
          onHome={() => setScreen("home")}
          onSettings={() => setSettings("general")}
          onFixEngine={() => setSettings("engine")}
        />
```

In `packages/ui/src/index.ts`, add:
```ts
export type { SendFn } from "./ChatView";
```

- [ ] **Step 5: Verify**

Run: `corepack pnpm vitest run packages/ui && corepack pnpm typecheck`
Expected: PASS (old and new UI tests); typecheck clean. If the 2a test `"retries the last user message found in state, even after a restart"` fails, check that `send` with `{}` options still pushes `"earlier question"` into `client.sent`.

- [ ] **Step 6: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): work screen top bar with usage meter, pre-flight for heavy actions and fixable errors"
```

---

### Task 16: Demo harness and docs

**Files:**
- Modify: `harnesses/demo/harness.config.ts`, `harnesses/demo/ui/App.tsx`, `harnesses/demo/locales/en.json`, `harnesses/demo/locales/es.json`
- Create: `harnesses/demo/README.md`
- Modify: `README.md`

- [ ] **Step 1: Demo manifest — tagline and a heavy action**

In `harnesses/demo/harness.config.ts`, add to the `defineHarness({ … })` object (after `blocks`):
```ts
  actions: {
    tidy: { label: { es: "Ordenar mis notas", en: "Tidy up my notes" }, cost: "heavy" },
  },
  tagline: { es: "Notas de prueba para Human Harness", en: "Test notes for Human Harness" },
```

- [ ] **Step 2: Demo UI — a side-panel button that starts the action**

Replace `harnesses/demo/ui/App.tsx` with:
```tsx
import { type HarnessClient, HarnessApp, type SendFn } from "@humanharness/ui";
import { useTranslation } from "react-i18next";
import en from "../locales/en.json";
import es from "../locales/es.json";
import { NoteCard } from "./NoteCard";

function Side({ percent, send }: { percent: number; send: SendFn }) {
  const { t } = useTranslation("harness");
  return (
    <>
      <p>{t("progress", { percent })}</p>
      <button onClick={() => send(t("tidyMessage"), { action: "tidy" })}>{t("tidy")}</button>
    </>
  );
}

const locales = { es, en };

export default function App({ client }: { client: HarnessClient }) {
  return (
    <HarnessApp
      client={client}
      blocks={{ note: NoteCard }}
      stateBlocks={["progress"]}
      renderSide={(s, send) => <Side percent={(s.progress as { percent?: number } | undefined)?.percent ?? 0} send={send} />}
      locales={locales}
    />
  );
}
```

Replace `harnesses/demo/locales/en.json` with:
```json
{
  "progress": "Progress: {{percent}}%",
  "noteTitle": "Note",
  "tidy": "Tidy up my notes",
  "tidyMessage": "Review all my notes, merge duplicates and give each one a clear title."
}
```
Replace `harnesses/demo/locales/es.json` with:
```json
{
  "progress": "Progreso: {{percent}} %",
  "noteTitle": "Nota",
  "tidy": "Ordenar mis notas",
  "tidyMessage": "Revisá todas mis notas, uní las repetidas y dale a cada una un título claro."
}
```

Run: `corepack pnpm test && corepack pnpm typecheck`
Expected: all pass (the harness-sdk test that loads the demo manifest still passes).

- [ ] **Step 3: Demo README**

Create `harnesses/demo/README.md`:
````markdown
# Demo harness

The smallest harness: the core's tests use it, and it shows every piece a harness provides. Run it as a desktop app from the repository root:

    corepack pnpm app:dev

## Files

| File | What it is |
|---|---|
| `harness.config.ts` | The manifest (`defineHarness`): id, name, tagline, languages, engines it was tested with, suggested folder and seed, instructions, permissions, blocks, actions, author. Loaded from plain Node, so it holds no React. |
| `agent/AGENTS.md` | Instructions for the AI. On every start the core adds a managed section (response language, environment rules, how to use each block) and the file each engine expects (`CLAUDE.md` for Claude). |
| `agent/seed/` | Copied into the user's folder the first time. |
| `ui/App.tsx` | The harness UI: mounts the kit's `HarnessApp` with its block components, the names of its state-only blocks, the side panel and its translations. The side panel's button starts the `tidy` action, which is declared `heavy`, so the app may ask before running it. |
| `ui/NoteCard.tsx` | The React component for the `note` block (`show_note`). Each visible block in the manifest has a component registered under the same name. |
| `locales/es.json`, `locales/en.json` | The harness's own strings, read with `useTranslation("harness")`. Every language in the manifest needs every key. |
| `package.json` | Its dependencies (the SDK, the UI kit, React, zod). |

## Blocks

- `note` (visible): the agent calls `show_note` with `{ title, body }`; the chat renders `NoteCard`.
- `progress` (state only): the agent calls `update_progress` with `{ percent }`; the side panel shows it and the chat log keeps it, so it is back after a restart.

## Actions

- `tidy` (`heavy`): started from the side panel. Each turn it starts is tagged in `.harness/usage.jsonl`, which is how the app learns what it usually costs.
````

- [ ] **Step 4: Root README**

In `README.md`:
1. Replace the **Status** paragraph with:
```markdown
> **Status:** early development. The Node foundations (plan 1) and the desktop app (plans 2a and 2b) are in place: the demo harness runs as a macOS app with Claude and Codex, sets up the engine from inside the app (legal notice, install, sign-in, test) and shows plan usage. Design: [`docs/superpowers/specs/`](docs/superpowers/specs/). Roadmap: [`docs/superpowers/plans/`](docs/superpowers/plans/).
```
2. In **Repository layout**, add under `packages/`:
```
  i18n/          core strings (es, en) and the harness namespace
  ui/            React kit: Home, Settings, onboarding, chat, blocks, usage
  shell/         the Electron app (main, preload, renderer)
```
and replace the line `Planned: \`shell\` (Electron), \`ui\` (React kit), \`i18n\`, \`harnesses/socrates\`, \`tooling/\`.` with `Planned: \`harnesses/socrates\`, \`tooling/\`.`
3. In **Development**, append:
```markdown
Open the demo harness as a desktop app (macOS):

    corepack pnpm app:dev
```
4. Add before **License**:
````markdown
## Create a harness

A harness is a folder with a manifest, instructions for the AI, its own UI and its strings. Start from [`harnesses/demo`](harnesses/demo) (its README explains each file):

1. Copy `harnesses/demo` to `harnesses/<your-id>` and change `name` in its `package.json`.
2. Edit `harness.config.ts`:
   - `id`, `name`, `tagline`, `languages`, `author`, and optionally `logo`, `repo` and `donate` (shown on Home and in Settings → About).
   - `engines`: the engines you tested with. Users only see the ones whose terms allow this use (see the spec, §5).
   - `folder.suggested` and `folder.seed`: where the user's work lives and what is copied there the first time.
   - `permissions`: `edit: "folder"` or `"none"`, `exec`, `web`.
   - `blocks`: one `defineBlock({ description, visible, schema, example })` per piece of UI the AI can show (`visible: true`) or update silently (`visible: false`).
   - `actions`: workflows your UI can start, each with a `cost` of `light`, `medium` or `heavy`. Heavy ones may ask the user first when their plan is close to its limit.
3. Write `agent/AGENTS.md`: what the AI does and when it calls each block's tool (`show_<block>` / `update_<block>`).
4. Write `ui/App.tsx`: mount `HarnessApp` with a component per visible block, the state-only block names, an optional side panel (`renderSide(blockState, send)`; `send(text, { action })` starts an action) and your locales.
5. Add `locales/es.json` and `locales/en.json` with every key in each language.
6. Run it: `corepack pnpm install`, then `HH_HARNESS_DIR=harnesses/<your-id> corepack pnpm app:dev`.

You are responsible for what your harness does with the AI and for the engines you offer: each user brings their own account under their provider's terms.
````

- [ ] **Step 5: Commit**

```bash
git add harnesses/demo README.md
git commit -m "docs: demo harness README, create-a-harness guide; demo tagline and heavy action"
```

---

### Task 17: Run the app for real (with the user)

The user does the onboarding; the executor builds, prepares the clean state, watches the terminal and records. Nobody but the user signs out of a CLI.

- [ ] **Step 1: Build and start fresh**

Run: `corepack pnpm test && corepack pnpm typecheck && corepack pnpm app:build`
Expected: all green; build succeeds.

Start from a clean app state (these files are ours, never the CLIs'): delete `~/Library/Application Support/Human Harness/demo/config.json` and `~/.humanharness/engines.json`. Then:
Run: `corepack pnpm app:dev`
Expected: a window with no title bar chrome except the traffic lights, aligned with the top bar; the top bar drags the window; Home shows the H, "Demo", the tagline, "Start Demo"/"Iniciar Demo" and no engine; Lexend on the name; no white flash on open.

- [ ] **Step 2: Claude onboarding (user)**

1. Gear → General: switch Español/English and Automatic/Light/Dark; the UI and the window background follow. Back to the OS language.
2. Start → Settings opens on Engine with the folder step. Choose a new folder (e.g. `~/Documents/HH Demo 2b`) → "Use this folder".
3. Claude tile → the legal notice (provider, where data goes, training, own account, not endorsed, not responsible for content, terms and privacy links that open in the browser) → tick → Continue.
4. Installed already → (if signed out) Sign in → the browser opens Anthropic's page; finish there. **Record exactly what `claude auth login` printed under Details and whether it completed without a terminal** (this is the unverified fact). Optional, only if the user wants to exercise sign-in: the user signs out first with Settings → Engine → Sign out (or `claude auth logout` themselves).
5. Test prompt runs → "Use Claude" → the sheet closes and the work screen opens.
6. Send "Make a note titled Groceries with milk and bread." → note card, side panel progress, top-bar meter "5 h: … % used · resets at … — week: … % used".
7. Check files: `.harness/usage.jsonl` has one line with `engine`, `usage` and `limits`; `.harness/chats/main.jsonl`'s assistant entry has `usage`, `limits` and `state.progress`; `~/.humanharness/engines.json` has `binary`, `version`, `notice`, `verifiedAt` and nothing else.
8. Press "Tidy up my notes": with room in the 5-hour window it runs straight away (the pre-flight dialog only appears from ~70 % utilization; the unit tests cover it). The new `usage.jsonl` line has `"action":"tidy"`.
9. Quit (Cmd+Q) and reopen: Home's pill shows Claude · Connected · 5 h · N %; Start → the side panel shows the last progress.

- [ ] **Step 3: Codex (user)**

1. Work screen gear → Engine → Codex tile → notice → accept. Its CLI is the bundled one, so there is no install step. Sign in if needed (record what the bundled `codex login` printed and whether it worked under Electron's Node) → test prompt → "Use Codex" → Done.
2. The chat shows "You're now using Codex, so I started a new conversation…"; the old chat is in `.harness/chats/archive/<time>-claude.jsonl`; `.harness/session.json` now says `codex` after the first turn.
3. Send a message: the top-bar meter says "Codex doesn't report your plan's limits. Last message: … tokens."; Settings → Usage says the same and lists "Tidy up my notes · Heavy".

- [ ] **Step 4: Check the main bundle again**

Run: `grep -cE 'useState|react-dom|"@humanharness/ui' packages/shell/out/main/index.js`
Expected: `0`.

- [ ] **Step 5: Record and commit**

Write `docs/spikes/2026-10-11-onboarding-usage.md` with a table per engine (as in `2026-10-10-desktop-app.md`): what worked, every problem with exact text, the `claude auth login` and bundled `codex login` behaviour without a terminal, and screenshots' observations of the look (drag region, traffic-light alignment, dark mode). Fix only blockers of the happy path (within this plan's files); list the rest as follow-ups.
```bash
git add docs/spikes/2026-10-11-onboarding-usage.md packages
git commit -m "docs: onboarding and usage end-to-end results"
```

---

## Done when

- `corepack pnpm test` and `corepack pnpm typecheck` pass; `corepack pnpm app:build` succeeds and the main bundle contains no React.
- The demo opens on Home with the native top bar; first launch goes Start → Settings → Engine (folder, legal notice, install/sign-in as needed, test prompt) → work screen, for Claude and for Codex.
- `~/.humanharness/engines.json` holds only binary path, version, notice acceptance and last test; `<folder>/.harness/usage.jsonl` gets a line per turn; chat entries carry usage, limits and state blocks.
- Claude's windows show on the pill, the top bar and Settings → Usage; Codex says it doesn't report limits; heavy actions ask first when the five-hour window is high; out-of-quota cards say when the limit resets; startup problems show a card that leads to the fix.
- Switching engine starts a new chat and archives the old one.
- Results recorded in `docs/spikes/2026-10-11-onboarding-usage.md`.
