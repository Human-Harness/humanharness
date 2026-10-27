# OpenCode as a third engine

Date: 2026-10-26. Status: approved design; implemented by plan 2026-10-27-opencode-engine.md.

## Why

Today each engine is one company's own CLI: Claude Code for Claude, Codex for ChatGPT. Every new provider means a new CLI, a new adapter and a new legal review, and several were excluded or left pending (Gemini, Qwen, Kimi, GLM). OpenCode is an open-source CLI (MIT) that talks ACP and connects to many providers: API keys (OpenRouter, Anthropic API, OpenAI API, DeepSeek…) and local models (Ollama). Adding it as one engine gives users any model they choose without the core adding a CLI per provider.

It does not replace Claude or Codex. Those stay the route for people who pay a subscription: a Claude Pro/Max plan only works in the official `claude` binary (Anthropic blocked subscription logins in third-party tools in 2026, and OpenCode removed it), and Codex covers ChatGPT plans.

## Decisions

- **D1. The app installs OpenCode; the user configures it.** The app helps install it and opens OpenCode's own login. Which provider, key or local model the user picks is theirs, under that provider's terms. The app never asks for, stores or reads keys (compliance rules 1, 2 and 4 of the core spec hold unchanged). This is the core spec's "Plan B" (API-key mode through the CLI's official flow), reached through one CLI instead of many.
- **D2. Legal status `allowed`.** The app drives an unmodified OpenCode under its MIT license, and OpenCode documents ACP clients officially. The provider's terms are between the user and the provider; the notice says so.
- **D3. Generic legal notice.** The core spec (rule 6) requires provider, data location and training facts when an engine is chosen. With OpenCode these depend on the provider the user configures, so the notice says that and links OpenCode's docs on providers.
- **D4. Models come from OpenCode.** No fixed list in the registry: the app uses the `model` and `effort` config options OpenCode sends over ACP.
- **D5. Usage is cost, not plan windows.** OpenCode reports the session's cost in USD. The Usage tab shows it; there are no limit windows.

## 1. Registry entry (`packages/engines`)

```ts
{
  id: "opencode",
  name: "OpenCode",
  provider: "OpenCode",
  status: "allowed",
  statusSource: "https://opencode.ai/docs/acp (2026-10-26)",
  requires: "An account or API key with a provider you set up in OpenCode, or a local model (Ollama)",
  dataLocation: "Depends on the provider you set up in OpenCode",
  trainsOnData: "Depends on the provider you set up in OpenCode",
  termsUrl: "https://opencode.ai/docs/providers/",   // to confirm in the spike: OpenCode's own terms page, if any
  privacyUrl: "https://opencode.ai/docs/providers/",
  detect: { binary: "opencode", versionArgs: ["--version"], minVersion: "<tested version>" },
  transport: { kind: "acp", command: ["opencode", "acp"], modes: { edit: "build", readOnly: "plan" } },
  models: { efforts: [] },          // filled from ACP config options at session start
  reportsLimits: false,
  setup: {
    install: { command: "curl -fsSL https://opencode.ai/install | bash", docsUrl: "https://opencode.ai/docs/" },
    login: ["auth", "login"],
    status: { args: ["auth", "list"], format: "opencode-auth-list" },
    update: ["upgrade"],
    logout: ["auth", "logout"],
  },
  logo: "assets/opencode.svg",
}
```

`brands` stays empty: OpenCode's name already goes into `brandNames()`. A harness may not use "OpenCode" in its name or logo.

## 2. Setup and login

- **Install.** Same flow as the other engines: the app shows the official command, the user confirms, the app runs it.
- **Login.** `opencode auth login` is interactive (pick a provider, paste a key or open a browser), so "Sign in" opens it in Terminal, as the manual-install help already does. The app waits for the user to come back and re-checks the status. It never reads `~/.local/share/opencode/auth.json` (compliance rule 1).
- **Status.** New format `opencode-auth-list`: ready when `opencode auth list` lists at least one provider. A user on local models only (Ollama is set up in `opencode.json`, not through `auth`) shows no providers there. So the status is also ready when the first ACP session reports a current model. Until then Home shows "Configurar" with a card: "Elegí un proveedor en OpenCode" plus a link to its provider docs.
- **ACP auth.** If a prompt fails with `auth_required`, the runtime emits `session-expired` (the existing "sign in again" error) and the UI offers "Iniciar sesión" (the same Terminal flow).
- **Logout.** `opencode auth logout` only when the user asks (Settings › Motor).

## 3. Models and efforts

- On `session/new`, OpenCode sends `configOptions` with `model` (values `provider/model`) and, for models with variants, `effort` (category `thought_level`). The runtime already turns `configOptions` into the model offer (`offeredModels`); Settings › Modelos shows that list.
- To apply a task's model profile, the ACP transport calls `session/set_config_option` (`configId: "model"` or `"effort"`) after `session/new` or `session/load`. Codex applies profiles through `CODEX_CONFIG` at spawn; OpenCode does not need a restart. The transport picks the method per engine: a new optional `TransportDef` field `profile: "codex-config" | "config-option"`.
- **light / standard / deep.** There is no fixed mapping, because the models depend on the provider. Default: every tier uses the session's default model; the user may assign a model per tier in Settings › Modelos (existing override). A `config_option_update` that removes the chosen model falls back to the default and emits the existing `model-unavailable` error.
- The context cap is not sent to OpenCode; it compacts on its own (plan Q4).

## 4. Usage

- `usage_update` already becomes a `context` event (`used`, `size`). The transport also reads `cost` (`amount`, `currency`).
- `cost` is the session's running total, so the per-turn cost is the delta from the previous update in the same session. It is recorded in `usage.jsonl` as `costUsd` (real money, unlike Claude's `costEquivalentUsd`). A non-USD currency is not recorded.
- `session/prompt` returns `usage` with `inputTokens`/`outputTokens`/`totalTokens`; these feed the existing token measurements, as with Codex.
- **Settings › Uso.** The engine reports no limits, so the tab uses the existing "no limits" layout (comparison with the average). It adds one row, "Lo que gastaste en los últimos 30 días: US$ x,xx", and a caption: "Lo informa OpenCode. Con modelos locales es 0." No plansUrl (it depends on the provider).
- Usage excludes child sessions (an OpenCode limitation); documented, not worked around.

## 5. Permissions and modes

- Permission answers already pick an option by `kind` (`allow_once` / `reject_once`), which OpenCode sends. No change.
- `modes`: `edit` → `build` agent, `readOnly` → `plan` agent, set with `session/set_mode` as for Codex. The spike confirms the ids.
- The harness MCP servers go in `session/new` as for Codex (stdio supported; SSE is not, and the core does not use it).
- OpenCode allows one prompt at a time per session; the runtime already runs one turn at a time.

## 6. Core spec changes

- Engine status table: new row "OpenCode | `opencode acp`, user's own provider set up in OpenCode | **allowed** | MIT, unmodified; ACP documented by OpenCode. Provider terms are the user's; the notice says so. Claude Pro/Max does not work through it (Anthropic forbids it); an Anthropic API key does."
- "v1 engines" becomes Claude, Codex and OpenCode. The manifest `engines` list may include `"opencode"`; the demo harness adds it.
- Rule 1 also names `~/.local/share/opencode`.

## 7. Testing

- **Unit.** Registry entry; `opencode-auth-list` status parsing (providers / empty / error); cost delta per turn (first update, increasing totals, resumed session, missing cost, non-USD); profile applied via `set_config_option`; `auth_required` maps to `session-expired`.
- **Fake agent.** The ACP fake agent gains a scripted `usage_update` with `cost` and a `config_option_update`.
- **Real (manual).** OpenCode with Ollama on the Mac (no cost): install, status, a demo task end to end, Usage shows US$ 0. One run with an OpenRouter key to see a real cost.

## 8. Spike first (one short task)

1. Install command and `--version` output; set `minVersion`.
2. `opencode auth list` output with providers, empty, and Ollama-only.
3. Mode ids in OpenCode 2 (`build` / `plan`?) and what `plan` blocks (edits, shell).
4. Whether `usage_update` arrives with Ollama models (cost 0 or absent).
5. OpenCode's own terms and privacy URLs, if they exist.

### Spike results (2026-10-27, CLI not run; source read at OpenCode v1.19.4, with a look at v2.2.0)

The spike did not run the CLI: OpenCode is not installed on the planning machine, and nothing was installed. These results come from public material only: the docs (`opencode.ai/docs/cli/`, `opencode.ai/docs/acp/`), the install script, the legal pages and the MIT source on GitHub (`anomalyco/opencode`, tags `v1.19.4` and `v2.2.0`). No account, credential or config file was read. Each line says "confirmed (source)" when the source shows it, or "unverified" when only a real run can tell. The manual check in §7 ("Real") is a release gate: it confirms these lines against the real CLI before release.

**Two major lines.** OpenCode 1 (latest `v1.19.4`, 2026-10-22) and OpenCode 2 (`v2.2.0`, 2026-10-27) are both released. The official installer (`opencode.ai/install`, which redirects to the `v1` branch script) installs only OpenCode 1 and refuses a 2.x version. `opencode upgrade --major` moves a person to OpenCode 2 and removes OpenCode 1. OpenCode 2 changes `auth list` (see A3). The plan targets OpenCode 1. Open decision for Marco: refuse 2.x (a `maxVersion` or a major check), or parse both `auth list` formats.

§8 items:
1. Install and version: `curl -fsSL https://opencode.ai/install | bash` puts the binary in `~/.opencode/bin` (no override) and adds that folder to the shell's rc file unless `--no-modify-path`. The version flag is `--version` / `-v`; the exact output is unverified. `minVersion` stays `"0.0.0"` until a real run; the source read here is 1.19.4.
2. `auth list`: in OpenCode 1 it prints a "Credentials ~/.local/share/opencode/auth.json" block (one line per provider stored by `auth login`, then `└  N credentials`), and an "Environment" block only when a provider's key is set in the environment (`└  N environment variable(s)`). Ollama set up in `opencode.json` is in neither, so it does not show (confirmed (source); matches §2). The provider lines carry a raw ANSI dim code (`\x1b[90m`) before the credential type, even when piped. The exact glyphs come from `@clack/prompts` (`┌`, `│`, `●`, `└`); unverified byte for byte.
3. Modes: the ACP modes are OpenCode's primary, non-hidden agents; by default `build` (the default) and `plan`. `plan` denies every edit except plan files (`.opencode/plans/*.md` and OpenCode's own plans folder). It does not block shell commands: bash keeps the default permission. A person's own `opencode.json` can add agents or change the default (confirmed (source)).
4. `usage_update` is sent once at the end of each prompt, with `cost: { amount, currency: "USD" }` = the session's running total. It is sent only when OpenCode knows the model's context limit. A local model without a known limit gets no `usage_update` at all, so Usage shows no cost row rather than US$ 0 (confirmed (source); whether Ollama models have a limit is unverified). No `usage_update` is sent on `session/load`.
5. Terms and privacy: OpenCode has both: `https://opencode.ai/legal/terms-of-service` (Anomaly Innovations, Inc.) and `https://opencode.ai/legal/privacy-policy`. Both cover OpenCode's website, its inference product and hosted offering; the terms say the open-source software, when not hosted, is governed only by its license.

Plan assumptions:
- A1 (install path `~/.opencode/bin`): confirmed (source), for OpenCode 1 and 2.
- A2 (`--version` prints `x.y.z`): unverified; the flag exists.
- A3 (`auth list` format): confirmed for OpenCode 1 in structure (see item 2); the parser must tolerate ANSI codes. Differs in OpenCode 2: a plain table (`<integration>  <source>  stored|environment`), the line `No authenticated integrations` when empty, and `--format json`.
- A4 (modes `build` and `plan`, `plan` refuses edits): confirmed (source). `session/new` does not return a `modes` field; the modes come as a `configOptions` select with `id: "mode"`, category `mode`. `session/set_mode` is still supported.
- A5 (`configOptions`: `model` with `provider/model` values; effort select `id: "effort"`, category `thought_level`): confirmed (source). The effort values are the model's variants plus `"default"`, and the effort option is absent for a model without variants.
- A6 (`session/set_config_option` takes `{ sessionId, configId, value }` and answers `{ configOptions }`): confirmed (source). Setting `model` also sends a `config_option_update`; an unknown model, effort or mode is an `invalid_params` error (`-32602`).
- A7 (`usage_update.cost` in USD, running total): confirmed (source), with the limits in item 4.
- A8 (`session/prompt` answers with `usage`): confirmed (source): `inputTokens`, `outputTokens`, `totalTokens`, and `thoughtTokens` / `cachedReadTokens` / `cachedWriteTokens` when above 0.
- A9 (missing or expired key is `auth_required`, `-32000`): confirmed (source) for a provider auth error during a prompt. What happens with no provider and no local model at all is unverified.
- A10 (no terms or privacy page of its own): differs. Both pages exist (item 5); the registry uses them.

## Out of scope

- Subscription logins inside OpenCode (ChatGPT, Copilot, SuperGrok): the app does not guide or block them. The user picks them in OpenCode's own login under those providers' terms. ChatGPT is still offered through the Codex engine.
- A provider picker inside the app, key entry in the app, or reading OpenCode's config.
- A cost budget or spending alerts (possible later, now that cost is measured).
