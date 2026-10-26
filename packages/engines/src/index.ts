import { CLAUDE_MODELS, EFFORTS, type EngineModels } from "./models";

export * from "./models";

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
    };

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

export interface EngineDef {
  id: string;
  name: string;
  /** Company that runs the service; named in the legal notice. */
  provider: string;
  /** Product or model marks of the provider besides `name` (plan 4a `check`: never in a harness's name, tagline or logo). */
  brands?: string[];
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
