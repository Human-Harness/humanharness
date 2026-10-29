# The broker and secrets

Spec: `docs/superpowers/specs/2026-10-28-tools-and-recipes-design.md` ("§" below), §2 D7 and D9, §4.2, §9. Plan: `docs/superpowers/plans/2026-10-29-tools-slice1-core-broker.md` (slice 1, "Decision N" and the threat rows "S1"–"S6" below). Slice 2 (`2026-10-29-tools-slice2-tools.md`) adds tools on top of what this page describes.

## What it is

- **Secrets are a core service** (D9). The plugins' key store and the generic part of their broker moved into the core, so plugins (now) and the harness's tools (slice 2) share them. Plugin behaviour did not change: every plugin test is byte-identical to before the move.
- A harness may declare its own **`secrets`**: keys the person pastes once (an API token for Jira, say). A **`connect` setup step** asks for them, and **Settings › Connections** lists them. A value goes in and never comes out to the window: the screens only ever learn whether a key is set.
- In slice 1 nothing reads a harness key's value yet. Slice 2's tool broker is the one reader (`harnessValues`), filling `{{secret:<id>}}` in a tool's `ctx.fetch` when the tool's `uses.secrets` names it.
- A harness without `secrets` (and so without a `connect` step) is today's app (D0, below).

## The core broker

`Broker` (`packages/shell/src/main/broker/broker.ts`, §4.2, D7) is the engine every `ctx` call of sandboxed code lands in. It knows nothing about plugins or tools: its owner builds one per caller identity, with a **`BrokerGrant`** saying what that caller may reach, so an identity or a permission is never taken from a call.

- **`BrokerGrant`**: `hosts`, `secrets` (the ids the caller may name as `{{secret:<id>}}`; only these are ever asked of the store), `exec` patterns, `collection(name, write)` (own-property safe) and `refusals`, the texts that say where each thing would have to be declared.
- **`CORE_CALLS`**: `fetch`, `exec`, `data.get/query/put/patch/delete/replaceAll`, `log`. The owner passes the subset its callers get in `calls`, plus handlers of its own by name in `extra`. An `extra` that takes a core call's name throws at construction: it would skip the grant checks.
- **Runs**: `startRun(key)` gives a run id every call must carry; `endRun(id)` kills it and aborts its in-flight fetches and commands; `killAll()`. A call on a dead run answers the owner's `ended` text. The per-call budget, the in-flight cap and the fetch/exec slots are as `docs/architecture/plugins.md` ("The broker") describes. A refusal is an answer, never a throw.
- `fetch` and `exec` still go through `plugin-fetch.ts` and `plugin-exec.ts` (Decision 12: the names stay for now; `plugin-cli-entry.test.ts` pins them in the CLI's import graph). Nothing under `broker/` imports Electron.
- **The checks** (`broker/broker-checks.ts`): the pure argument checks and helpers moved verbatim from `plugin-broker.ts` (`checkBudget`, `checkJson`, `record`, `query`, `fetchRequest`, `oneLine`, …), `Slots` and `BROKER_LIMITS`.

Who builds a `Broker`:

- **`PluginBroker`** (`plugin-broker.ts`), now: the plugin adapter. Same constructor, methods and exports as before. Its grant is the manifest's `permissions` (`hosts`, `secrets`, `exec`) and its own declared collections, with the plugin refusal texts unchanged ("… is not declared in permissions.secrets"); it adds `settings.get`, `attention.*` and `chip.*` as `extra` handlers.
- **The tool broker**, in slice 2: a grant from each tool's `uses`.

## The store

`SecretStore` (`packages/shell/src/main/secrets/secret-store.ts`), moved from `plugin-secrets.ts` (now a one-line re-export, so plugin code and tests compile unchanged). `safeStorageCrypto` moved to `secrets/safe-storage.ts` (`plugin-ipc.ts` re-exports it).

| Whose | File | Read by |
|---|---|---|
| A plugin's key | `~/.humanharness/<harness-id>/secrets/<plugin>/<id>.bin` (unchanged) | `values(plugin, ids)`, the plugin's broker |
| The harness's key | `~/.humanharness/<harness-id>/secrets/_harness/<id>.bin` | `harnessValues(ids)`, slice 2's tool broker only |

- **`_harness/`** (`HARNESS_SECRETS_OWNER`) can never be a plugin's folder: no plugin id starts with `_`. The plugin methods refuse it as a plugin; the harness methods (`storedHarness`, `setHarness`, `deleteHarness`, `harnessValues`) only ever name it.
- **Logical names** (§9, Decision 2): `secretName("harness", "jira")` is `jira`, `secretName({ plugin: "oncall" }, "jira")` is `plugin.oncall.jira`. They name keys in log lines (and, from slice 2, in traces); the files keep the paths above.
- The rules are the plugins' (`plugins.md`, "Keys"): 8 to 8,192 characters, trimmed, one line; one encrypted file per key (0700/0600, temp file and rename); no storing when encryption is unavailable (Linux `basic_text` counts as unavailable); no link or hard link followed or written through. A value never reaches a renderer or a log.
- **One store** (Decision 8): `index.ts` builds it (`secretStore()`) when the harness takes plugins, has dev plugins, or declares `secrets`, and hands the same instance to `PluginsController` and `ConnectionsController`. Otherwise none. Keys are per harness, not per profile (Decision 9).
- `harnessValues` doesn't cap how many ids it is given: slice 2's caller caps the list first.

## `secrets` and the `connect` step

`secrets` in the manifest (`packages/harness-sdk/src/secrets.ts`, Decision 3): 1 to 10 (`SECRETS_MAX`) strict `{ id, label, help? }`. `id` matches `^[a-z][a-z0-9_-]{0,39}$` (the plugin key id pattern), each once; `label` 1–80 and `help` 1–200, one line each, no hidden characters. `hasSecrets(harness)` is the D0 switch.

From the e2e fixture (`packages/fake-agent/fixtures/secrets-harness`):

```ts
secrets: [{ id: "jira", label: "Jira API token", help: "Create one at id.atlassian.com → Security → API tokens." }],
setup: [{ id: "jira", kind: "connect", label: "Connect Jira", required: true, secrets: ["jira"] }],
```

The `connect` step (`setup.ts`, Decisions 4 and 5) lists 1 to 10 declared ids, each once; a key may appear in several steps. The setup screen draws a row per listed key (label, help, Set or Not set, a password field, Save or Replace, Delete when set) and "Paste each key to go on." until all are set. **Next** is enabled once every listed key is set and marks the step done; main checks again (`SetupSteps.complete` asks `ConnectionsController.allSet`, fail-closed: no answer, an error or an empty list refuse with `incomplete`). A step whose keys are already set (from Settings) shows Next at once. Skip works as for the other kinds (none on a required step). Done never proves a key is still set: slice 2's broker checks the store at each call. `test?: toolId` and "Test connection" come with tools in slice 2. Details: `docs/architecture/setup.md`.

## Settings › Connections

A tab `connections` after Plugins and before Jobs, shown only when `AppState.connections` is there (the harness declares `secrets`; `{ count }`). One row per declared key in manifest order, the same `SecretField` the connect step uses (`packages/ui/src/connections/`): the field clears before the answer arrives; Delete has no confirm, as in a plugin's detail. A push never carries what is shown: every push and every answer fetch the view again, and only the latest answer is kept. Plugin keys stay in each plugin's detail. The Setup list's connect row has "Open", which switches to this tab.

`ConnectionsController` (`secrets/connections.ts`) and its channels (`secrets/connections-ipc.ts`, through `index.ts`'s `handle()`, so only the app's page), registered only under `hasSecrets` (Decision 7):

| Channel | Sends | Answers |
|---|---|---|
| `hh:connectionsGet` | — | `{ connections: [{ id, label, help?, set }] }`, or `null` when it can't be read |
| `hh:connectionsSet` | `id`, `value` | `{ ok: true }` or `{ ok: false, message }` (a fixed or store text, never the value) |
| `hh:connectionsDelete` | `id` | the same |
| `hh:connectionsChange` (push) | — | the view, after a set or delete |

A malformed id (not the manifest's pattern) or a non-string or huge value gets "Invalid request" before the controller; an undeclared id gets "This harness declares no such key"; a failure, "Something went wrong". Only `set` carries a value; only `set: boolean` comes back. `missingSecretMessage(label)` ("<label> is not set — Settings › Connections", Decision 11) is the text slice 2's tool broker fails a call with.

## The test hook

`HH_TEST_FAKE_SECRETS=1` (`readTestHooks`, `test-hooks.ts`; Decision 10) swaps `safeStorageCrypto(safeStorage)` for `testCrypto()` (`secrets/test-crypto.ts`): a reversible stand-in that writes `hh-test:` and the value's hex, so a file never holds the plaintext and the e2e never touches the Keychain. Only exactly `"1"` turns it on, and **a packaged app ignores it**, like every test hook. Plugins' e2e never set it. Unit tests give every `SecretStore` a fake `SecretCrypto`.

The e2e (`packages/e2e/tests/connections.spec.ts`, fixture `packages/fake-agent/fixtures/secrets-harness`, id `secrets`) goes through the connect step, checks the key file under `<shared>/secrets/secrets/_harness/jira.bin` (`<shared>/<harness-id>/secrets/_harness/<id>.bin`) starts with `hh-test:` and lacks the value, that the page never holds the value, then deletes the key from Settings › Connections.

## D0

A harness that declares no `secrets` runs nothing of this beyond the moved modules, which behave exactly as before: `defineHarness` gives no `secrets` key; form, interview and component step views are unchanged; no `SecretStore` unless it takes plugins (as before); no `_harness/` folder; no `hh:connections*` channel; no `AppState.connections`; no Connections tab. Nothing in slice 1 reaches the runtime (argv, `AGENTS.md`, first messages, history, usage lines).

| D0 item | Pinned by |
|---|---|
| Manifest | `packages/harness-sdk/test/secrets.test.ts` "D0: no secrets key without it" |
| Setup kinds | `packages/harness-sdk/test/setup.test.ts` (earlier tests unchanged); `packages/shell/test/setup-steps.test.ts` "D0: views of form, interview and component steps are unchanged by connect" |
| Store and channels | `packages/shell/test/connections-surface.test.ts` "D0: connections channels are registered only under hasSecrets", "D0: the SecretStore is built only for plugins or secrets" |
| UI | `packages/ui/test/connections-ui.test.tsx` "D0: no Connections tab without state.connections" |
| Runtime and history | `packages/runtime/test/runtime-d0.test.ts`, `hatches-d0.test.ts`, `claude-cli.test.ts` (goldens), `packages/shell/test/hatches-surface.test.ts`, `packages/e2e/tests/history.spec.ts`: byte-identical to before slice 1 |
| Plugins | every plugin test (`packages/shell/test/plugin-*.test.ts`, `plugins-*.test.ts`, `plugins-fixtures.ts`, `packages/cli/test/plugin-*.test.ts`, `packages/harness-sdk/test/plugin*.test.ts`, `define-plugin.test.ts`, `packages/ui/test/plugin*.test.ts(x)`, the plugins e2e): byte-identical to before slice 1 |

## Threat model

The harness's store holds the person's API tokens. The plugins' rows (B6, B8, `plugins.md`) stay as they are; these add the harness side.

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| S1 | A value never reaches a renderer | the view is `{ id, label, help?, set }` only; IPC answers fixed refusals; `set` answers `{ ok }` or a message without the value | `secrets/connections.test.ts` "set and delete change only the state, push the view, and no value in the view or any answer"; the e2e checks the page |
| S2 | Harness and plugin keys never mix | harness keys under `_harness/`, which no plugin id can name; plugins ask only `values(plugin, ids)`; `harnessValues` never reads a plugin folder | `secrets/secret-store.test.ts` "a plugin can't read the harness's keys, nor the other way" |
| S3 | Only declared ids | `set`/`delete` refuse an id the manifest doesn't declare (found with `some`, never an object index); bounded strings at IPC | `secrets/connections-ipc.test.ts` "undeclared, too long or non-string ids are refused" |
| S4 | No storage in the clear | the plugins' `available()` gate; Linux `basic_text` counts as unavailable | `secrets/secret-store.test.ts` "harness keys refuse to store without encryption, and create nothing" |
| S5 | Links and hard links | the store's `lstat`/`O_NOFOLLOW`/`nlink` rules apply to `_harness/` | `secrets/secret-store.test.ts` "a linked _harness folder reads as no keys and is never written through" |
| S6 | Tests never touch the Keychain | fakes in unit tests; `HH_TEST_FAKE_SECRETS=1`, ignored in a packaged app, in the e2e | `test-hooks.test.ts` "fake secrets only when not packaged" |

## Known gaps

- **No "Test connection"** (and no "last test" state in Settings) until slice 2: the spec's test runs a tool, and there are no tools before it.
- **`plugin-fetch.ts` and `plugin-exec.ts` keep their plugin names** although the core broker uses them; their refusal texts name the plugin manifest (a refused host says "… is not declared in permissions.hosts", which `BrokerGrant.refusals` doesn't cover). Slice 2 wraps them with its own texts; a rename is a later cleanup.
- **No per-profile keys**: one set of harness keys per harness, shared by every profile (Decision 9).
- A refused Next on a connect step (only on a race, since Next waits for every key) shows the setup screen's general "incomplete" text, which speaks of the interview.
- `setup.ts` checks a connect step's ids against `secrets`, not against the id pattern itself; an id that doesn't match the pattern can't be declared, so it is refused as undeclared.

## Where to look

- `packages/shell/src/main/broker/broker.ts`, `broker-checks.ts`: the core broker and its checks. `plugin-broker.ts`: the plugin adapter.
- `packages/shell/src/main/secrets/secret-store.ts`, `safe-storage.ts`, `test-crypto.ts`: the store, the OS crypto and the test crypto. `plugin-secrets.ts`: the re-export.
- `packages/shell/src/main/secrets/connections.ts`, `connections-ipc.ts`: Settings › Connections in main. `index.ts`: `secretStore()`, `secretCrypto`, `connections()`, the channels and `AppState.connections`.
- `packages/shell/src/main/setup-steps.ts`: the connect view and its completion gate.
- `packages/harness-sdk/src/secrets.ts`, `setup.ts`, `index.ts`: `secrets`, the `connect` kind and their checks.
- `packages/ui/src/connections/`: `SecretField`, `ConnectionsTab` (`useConnections`), `ConnectStep`; `SettingsSheet.tsx`, `SetupFlow.tsx`, `SetupStepsList.tsx`: the wiring. `client.ts`: `ConnectionsClient` and the view types.
- Tests: `packages/shell/test/broker/`, `packages/shell/test/secrets/`, `connections-surface.test.ts`, `setup-steps.test.ts`, `test-hooks.test.ts`; `packages/harness-sdk/test/secrets.test.ts`, `setup.test.ts`; `packages/ui/test/connections-client.test.ts`, `connections-ui.test.tsx`, `setup-connect.test.tsx`; `packages/e2e/tests/connections.spec.ts`.
