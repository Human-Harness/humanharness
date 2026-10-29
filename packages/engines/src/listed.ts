import type { EngineDef } from "./types";

/** Engines listed only for their legal status (pending or excluded): no folder of their own, the plain ACP adapter runs them. */
export const kimi: EngineDef = {
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
};
export const gemini: EngineDef = {
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
};
export const qwen: EngineDef = {
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
};
