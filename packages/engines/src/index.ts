import type { LocalizedText } from "@humanharness/harness-sdk";

export type LegalStatus = "allowed" | "pending" | "excluded";

export type TransportDef =
  | { kind: "claude-cli"; binary: string }
  | {
      kind: "acp";
      command: string[];
      /** Session modes to set right after session/new|load, by harness edit permission. */
      modes?: { edit: string; readOnly: string };
    };

export interface EngineDef {
  id: string;
  name: string;
  status: LegalStatus;
  /** Where the status comes from: "<url> (<yyyy-mm-dd>)". */
  statusSource: string;
  requires: LocalizedText;
  dataLocation: LocalizedText;
  trainsOnData: LocalizedText;
  termsUrl: string;
  privacyUrl: string;
  detect: { binary: string; versionArgs: string[]; minVersion: string };
  transport: TransportDef;
  /** Extra file some engines need to pick up AGENTS.md. */
  instructionsFile?: { path: string; content: string };
}

export const ENGINES: readonly EngineDef[] = [
  {
    id: "claude",
    name: "Claude",
    status: "allowed",
    statusSource: "https://code.claude.com/docs/en/legal-and-compliance (2026-10-10)",
    requires: { es: "Plan Claude Pro o Max", en: "Claude Pro or Max plan" },
    dataLocation: { es: "Anthropic, EE. UU.", en: "Anthropic, USA" },
    trainsOnData: {
      es: "Según tu configuración de privacidad en claude.ai",
      en: "Depends on your privacy settings in claude.ai",
    },
    termsUrl: "https://www.anthropic.com/legal/consumer-terms",
    privacyUrl: "https://www.anthropic.com/legal/privacy",
    detect: { binary: "claude", versionArgs: ["--version"], minVersion: "2.1.296" },
    transport: { kind: "claude-cli", binary: "claude" },
    instructionsFile: { path: "CLAUDE.md", content: "@AGENTS.md\n" },
  },
  {
    id: "codex",
    name: "Codex",
    status: "allowed",
    statusSource: "https://developers.openai.com/siwc/token-sharing-open-source (2026-10-10)",
    requires: { es: "Plan de ChatGPT (Plus, Pro o superior)", en: "ChatGPT plan (Plus, Pro or higher)" },
    dataLocation: { es: "OpenAI, EE. UU.", en: "OpenAI, USA" },
    trainsOnData: {
      es: "Según tu configuración de controles de datos en ChatGPT",
      en: "Depends on your data controls in ChatGPT",
    },
    termsUrl: "https://openai.com/policies/terms-of-use/",
    privacyUrl: "https://openai.com/policies/privacy-policy/",
    // The adapter bundles its own Codex core; `codex` itself is only needed for `codex login`.
    // minVersion gates the adapter version reported as agentInfo.version at initialize.
    detect: { binary: "codex", versionArgs: ["--version"], minVersion: "2.2.2" },
    transport: {
      kind: "acp",
      command: ["npx", "-y", "@agentclientprotocol/codex-acp@2.2.2"],
      modes: { edit: "workspace-write", readOnly: "read-only" },
    },
  },
  {
    id: "kimi",
    name: "Kimi",
    status: "pending",
    statusSource: "https://www.kimi.com/en/help/kimi-code/membership-guide (2026-10-10)",
    requires: { es: "Membresía Kimi Code", en: "Kimi Code membership" },
    dataLocation: { es: "Moonshot AI, China", en: "Moonshot AI, China" },
    trainsOnData: { es: "Sí, por defecto (opt-out por solicitud)", en: "Yes, by default (opt-out on request)" },
    termsUrl: "https://www.kimi.com/user/agreement/en/modelUse?version=v2",
    privacyUrl: "https://www.kimi.com/es-419/help/others/data-usage",
    detect: { binary: "kimi", versionArgs: ["--version"], minVersion: "0.0.0" },
    transport: { kind: "acp", command: ["kimi", "acp"] },
  },
  {
    id: "gemini",
    name: "Gemini",
    status: "excluded",
    statusSource: "https://github.com/google-gemini/gemini-cli/discussions/27274 (2026-10-10)",
    requires: { es: "—", en: "—" },
    dataLocation: { es: "Google, EE. UU.", en: "Google, USA" },
    trainsOnData: { es: "—", en: "—" },
    termsUrl: "https://geminicli.com/docs/resources/tos-privacy/",
    privacyUrl: "https://policies.google.com/privacy",
    detect: { binary: "gemini", versionArgs: ["--version"], minVersion: "0.0.0" },
    transport: { kind: "acp", command: ["gemini", "--experimental-acp"] },
  },
  {
    id: "qwen",
    name: "Qwen",
    status: "excluded",
    statusSource: "https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/ (2026-10-10)",
    requires: { es: "—", en: "—" },
    dataLocation: { es: "Alibaba Cloud", en: "Alibaba Cloud" },
    trainsOnData: { es: "—", en: "—" },
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

/** Engines a harness may offer: the ones it was tested with, filtered by legal status. */
export function availableEngines(harnessEngineIds: string[], mode: Mode): EngineDef[] {
  const accepted: LegalStatus[] = mode === "distribution" ? ["allowed"] : ["allowed", "pending"];
  return harnessEngineIds
    .map((id) => ENGINES.find((e) => e.id === id))
    .filter((e): e is EngineDef => e !== undefined && accepted.includes(e.status));
}
