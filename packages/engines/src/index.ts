import { CLAUDE_MODELS, EFFORTS, type EngineModels } from "./models";

export * from "./models";
export * from "./contract";
export { classifyError } from "./classify";

export type LegalStatus = "allowed" | "pending" | "excluded";

export type TransportDef =
  | { kind: "claude-cli"; binary: string }
  | {
      kind: "acp";
      command: string[];
      /** Session modes to set right after session/new|load, by harness edit permission. */
      modes?: { edit: string; readOnly: string };
      /** Lowest adapter version (agentInfo.version at initialize) the harness accepts. */
      minAdapterVersion?: string;
      /**
       * How a task's model profile reaches the agent: `codex-config` (default) through `CODEX_CONFIG` at spawn,
       * `config-option` through `session/set_config_option` on the open session (OpenCode).
       */
      profile?: "codex-config" | "config-option";
      /**
       * Fixed environment for the agent process, set over the inherited one. Never credentials. Only OpenCode has
       * one (its permission config and the switch that keeps it from reading `~/.claude`); Claude and Codex none.
       */
      env?: Record<string, string>;
    };

/**
 * OpenCode's permission config (the 1.x `permission` map, which 2.x migrates): these tools ask before they run,
 * so every such call reaches `session/request_permission` and the harness's permissions decide it. Without it
 * OpenCode runs bash and webfetch without asking, even in its read-only `plan` agent.
 */
export const OPENCODE_PERMISSION = { bash: "ask", edit: "ask", webfetch: "ask", websearch: "ask" } as const;

/**
 * OpenCode's environment. Sources (github.com/anomalyco/opencode, formerly sst/opencode):
 * - 1.x (tag v1.19.4): packages/core/src/flag/flag.ts:22,69; packages/opencode/src/config/config.ts:482-489
 *   (OPENCODE_CONFIG_CONTENT) and :559-561 (OPENCODE_PERMISSION); packages/opencode/src/effect/runtime-flags.ts:24,28.
 * - 2.x (branch dev): packages/cli/src/server-process.ts:128-133; packages/core/src/config.ts:255-263;
 *   packages/core/src/config/normalize.ts:180 (the 1.x `permission` map becomes rules).
 * - Docs: packages/web/src/content/docs/cli.mdx:757,761,766 (opencode.ai/docs/cli, environment variables).
 *
 * `OPENCODE_CONFIG_CONTENT` is an inline config layer (1.x and 2.x) above the person's global and project config.
 * `OPENCODE_PERMISSION` is merged last over `permission` (1.x; 2.x does not read it). `OPENCODE_DISABLE_CLAUDE_CODE`
 * stops OpenCode from reading `~/.claude/CLAUDE.md` and `.claude/skills`, so they never reach the person's provider.
 */
export const OPENCODE_ENV: Readonly<Record<string, string>> = Object.freeze({
  OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: OPENCODE_PERMISSION }),
  OPENCODE_PERMISSION: JSON.stringify(OPENCODE_PERMISSION),
  OPENCODE_DISABLE_CLAUDE_CODE: "1",
});

/** How the app gets an engine ready, always through the provider's own CLI and installer. */
export interface EngineSetup {
  /** Official install command (run with `/bin/bash -c`, shown to the user first) and its docs. */
  install?: { command: string; docsUrl: string };
  /** CLI args for the official login flow (it opens the browser). */
  login: string[];
  /** CLI args for the login status check, and how to read its result. */
  status: { args: string[]; format: "json-logged-in" | "exit-code" | "opencode-auth-list" };
  /** CLI args for the official self-update, when there is one. */
  update?: string[];
  /** CLI args for the official sign-out (Settings → Engine → Sign out, only when the user asks). */
  logout: string[];
  /**
   * Steps that are interactive in the CLI (a provider picker): the app copies the command and opens Terminal,
   * and the person runs it there. Never run by the app.
   */
  inTerminal?: ("login" | "logout")[];
  /** The CLI's own guide to choosing a provider, for an engine whose provider the person sets up. */
  providersUrl?: string;
}

export interface EngineDef {
  id: string;
  name: string;
  /** Company that runs the service; named in the legal notice. */
  provider: string;
  /** Product or model marks of the provider besides `name` (plan 4a `check`: never in a harness's name, tagline or logo). */
  brands?: string[];
  /** Whether the engine reports plan-limit windows (Claude) or only tokens (Codex). */
  reportsLimits: boolean;
  /** Whether the engine reports what each turn cost in USD (OpenCode). Absent: it does not. */
  reportsCost?: boolean;
  /** Install / login / status / update / logout. Absent for engines the app can't set up itself. */
  setup?: EngineSetup;
  /**
   * Logo file inside this package (`assets/<id>.svg`), shown on the engine tiles. The files are
   * placeholders: the providers' official logos go here once their brand guidelines are checked
   * (part of the legal gate before distribution).
   */
  logo?: string;
  status: LegalStatus;
  /** Where the status comes from: "<url> (<yyyy-mm-dd>)". */
  statusSource: string;
  /** Legal facts shown in the engine's notice: always English (spec 5 D5). */
  requires: string;
  dataLocation: string;
  trainsOnData: string;
  termsUrl: string;
  privacyUrl: string;
  detect: { binary: string; versionArgs: string[]; minVersion: string };
  transport: TransportDef;
  /** Extra file some engines need to pick up AGENTS.md. */
  instructionsFile?: { path: string; content: string };
  /** The models and efforts Settings › Modelos offers for this engine. */
  models?: EngineModels;
  /** Limit windows: `primary` is the window kind usage estimates measure (Settings › Uso, spec 3b). */
  limits?: { primary: string };
  /** The provider's page of plans, the only plan fact the core keeps (reviewed with the engine). */
  plansUrl?: string;
}

export const ENGINES: readonly EngineDef[] = [
  {
    id: "claude",
    name: "Claude",
    status: "allowed",
    statusSource: "https://code.claude.com/docs/en/legal-and-compliance (2026-10-10)",
    requires: "Claude Pro or Max plan",
    dataLocation: "Anthropic, USA",
    trainsOnData: "Depends on your privacy settings in claude.ai",
    termsUrl: "https://www.anthropic.com/legal/consumer-terms",
    privacyUrl: "https://www.anthropic.com/legal/privacy",
    detect: { binary: "claude", versionArgs: ["--version"], minVersion: "2.1.296" },
    transport: { kind: "claude-cli", binary: "claude" },
    instructionsFile: { path: "CLAUDE.md", content: "@AGENTS.md\n" },
    models: { list: CLAUDE_MODELS, efforts: EFFORTS },
    provider: "Anthropic",
    reportsLimits: true,
    limits: { primary: "five_hour" },
    plansUrl: "https://claude.com/pricing",
    setup: {
      install: { command: "curl -fsSL https://claude.ai/install.sh | bash", docsUrl: "https://code.claude.com/docs/en/setup" },
      login: ["auth", "login"],
      status: { args: ["auth", "status", "--json"], format: "json-logged-in" },
      update: ["update"],
      logout: ["auth", "logout"],
    },
    logo: "assets/claude.svg",
  },
  {
    id: "codex",
    name: "Codex",
    status: "allowed",
    statusSource: "https://developers.openai.com/siwc/token-sharing-open-source (2026-10-10)",
    requires: "ChatGPT plan (Plus, Pro or higher)",
    dataLocation: "OpenAI, USA",
    trainsOnData: "Depends on your data controls in ChatGPT",
    termsUrl: "https://openai.com/policies/terms-of-use/",
    privacyUrl: "https://openai.com/policies/privacy-policy/",
    // The adapter bundles its own Codex core; `codex` itself is only needed for `codex login`
    // (minVersion is the tested CLI). The adapter is gated by transport.minAdapterVersion.
    detect: { binary: "codex", versionArgs: ["--version"], minVersion: "0.160.1" },
    transport: {
      kind: "acp",
      command: ["npx", "-y", "@agentclientprotocol/codex-acp@2.2.2"],
      modes: { edit: "workspace-write", readOnly: "read-only" },
      minAdapterVersion: "2.2.2",
    },
    // The model list comes from the adapter; these efforts are what Settings offers until it does.
    models: { efforts: ["low", "medium", "high"] },
    provider: "OpenAI",
    brands: ["ChatGPT", "GPT"],
    reportsLimits: false,
    plansUrl: "https://chatgpt.com/pricing",
    // The app runs the official Codex CLI bundled with the ACP adapter (status, login), so it never
    // installs Codex itself; the official install command is kept for builds without the bundle.
    setup: {
      install: { command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh", docsUrl: "https://learn.chatgpt.com/docs/codex/cli" },
      login: ["login"],
      status: { args: ["login", "status"], format: "exit-code" },
      logout: ["logout"],
    },
    logo: "assets/codex.svg",
  },
  {
    id: "opencode",
    name: "OpenCode",
    provider: "OpenCode",
    status: "allowed",
    statusSource: "https://opencode.ai/docs/acp (2026-10-26)",
    requires: "An account or API key with a provider you set up in OpenCode, or a local model (Ollama)",
    dataLocation: "Depends on the provider you set up in OpenCode",
    trainsOnData: "Depends on the provider you set up in OpenCode",
    // OpenCode's own terms and privacy policy (spike); the chosen provider's terms apply on top.
    termsUrl: "https://opencode.ai/legal/terms-of-service",
    privacyUrl: "https://opencode.ai/legal/privacy-policy",
    // OpenCode 1.x and 2.x are both accepted (the status check reads either `auth list` format).
    // minVersion: set from the spike before release.
    detect: { binary: "opencode", versionArgs: ["--version"], minVersion: "0.0.0" },
    transport: { kind: "acp", command: ["opencode", "acp"], modes: { edit: "build", readOnly: "plan" }, profile: "config-option", env: { ...OPENCODE_ENV } },
    // The models come from OpenCode at session start; these efforts are what Settings offers until it does.
    models: { efforts: ["low", "medium", "high"] },
    reportsLimits: false,
    reportsCost: true,
    setup: {
      install: { command: "curl -fsSL https://opencode.ai/install | bash", docsUrl: "https://opencode.ai/docs/" },
      login: ["auth", "login"],
      status: { args: ["auth", "list"], format: "opencode-auth-list" },
      update: ["upgrade"],
      logout: ["auth", "logout"],
      inTerminal: ["login", "logout"],
      providersUrl: "https://opencode.ai/docs/providers/",
    },
    logo: "assets/opencode.svg",
  },
  {
    id: "kimi",
    name: "Kimi",
    provider: "Moonshot AI",
    reportsLimits: false,
    status: "pending",
    statusSource: "https://www.kimi.com/en/help/kimi-code/membership-guide (2026-10-10)",
    requires: "Kimi Code membership",
    dataLocation: "Moonshot AI, China",
    trainsOnData: "Yes, by default (opt-out on request)",
    termsUrl: "https://www.kimi.com/user/agreement/en/modelUse?version=v2",
    privacyUrl: "https://www.kimi.com/es-419/help/others/data-usage",
    detect: { binary: "kimi", versionArgs: ["--version"], minVersion: "0.0.0" },
    transport: { kind: "acp", command: ["kimi", "acp"] },
  },
  {
    id: "gemini",
    name: "Gemini",
    provider: "Google",
    reportsLimits: false,
    status: "excluded",
    statusSource: "https://github.com/google-gemini/gemini-cli/discussions/27274 (2026-10-10)",
    requires: "—",
    dataLocation: "Google, USA",
    trainsOnData: "—",
    termsUrl: "https://geminicli.com/docs/resources/tos-privacy/",
    privacyUrl: "https://policies.google.com/privacy",
    detect: { binary: "gemini", versionArgs: ["--version"], minVersion: "0.0.0" },
    transport: { kind: "acp", command: ["gemini", "--experimental-acp"] },
  },
  {
    id: "qwen",
    name: "Qwen",
    provider: "Alibaba Cloud",
    reportsLimits: false,
    status: "excluded",
    statusSource: "https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/ (2026-10-10)",
    requires: "—",
    dataLocation: "Alibaba Cloud",
    trainsOnData: "—",
    termsUrl: "https://qwenlm.github.io/qwen-code-docs/en/users/support/tos-privacy/",
    privacyUrl: "https://qwenlm.github.io/qwen-code-docs/en/users/support/tos-privacy/",
    detect: { binary: "qwen", versionArgs: ["--version"], minVersion: "0.0.0" },
    transport: { kind: "acp", command: ["qwen", "--acp"] },
  },
];

export type Mode = "distribution" | "development";

export function getEngine(id: string): EngineDef {
  const engine = ENGINES.find((e) => e.id === id);
  if (!engine) throw new Error(`Unknown engine: ${id}`);
  return engine;
}

/** Brands a harness may not use in its name, tagline or logo: each engine's name, its provider's first word and extra marks. */
export function brandNames(): string[] {
  return [...new Set(ENGINES.flatMap((e) => [e.name, e.provider.split(" ")[0], ...(e.brands ?? [])]))];
}

/** Engines a harness may offer: the ones it was tested with, filtered by legal status. */
export function availableEngines(harnessEngineIds: string[], mode: Mode): EngineDef[] {
  const accepted: LegalStatus[] = mode === "distribution" ? ["allowed"] : ["allowed", "pending"];
  return harnessEngineIds
    .map((id) => ENGINES.find((e) => e.id === id))
    .filter((e): e is EngineDef => e !== undefined && accepted.includes(e.status));
}

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
