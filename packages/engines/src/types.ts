import type { EngineModels } from "./models";

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

export type Mode = "distribution" | "development";
