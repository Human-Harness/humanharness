# Replaceable parts

The parts of Human Harness that age fast sit behind seams, so each can be replaced by writing one module and changing config (spec `docs/superpowers/specs/2026-10-29-replaceable-parts-design.md`).

| Part | Seam | Status |
|---|---|---|
| Engines and transports | `EngineAdapter` + registry (`packages/engines/src/registry.ts`) | Done (plan 1) |
| UI/core contract | `@humanharness/protocol` (`packages/protocol`) | Done (plan 2) |
| Model routing | `ModelPolicy` | Plan 3 |
| Context strategy | `ContextPolicy` | Plan 4 |

Rules: dependencies point down only; no `if (kind === "claude-cli")` outside an engine's folder (`packages/engines/test/boundary.test.ts`); policies decide and never execute; interfaces are defined by their inputs and outputs. How to add an engine: `docs/architecture/engines.md`, "Adding an engine".

## Part 2 — protocol (done)

Spec §5, §8, §12. The contract between the UI and the core is the package `@humanharness/protocol` (`packages/protocol`). It is renderer- and preload-safe: no `node:*`, no `electron`, no `react`.

- **Where things live** (`packages/protocol/src/`): `client.ts` the `*Client` interfaces; `views.ts` the view models and every other contract type; `shared.ts` the pure helpers and constants both sides use; `events.ts` the engine events; `data-change.ts` `hearsDataChange`, its own subpath for the preload (`@humanharness/protocol/data-change`); `channels.ts` the IPC channel table (`@humanharness/protocol/channels`). `index.ts` re-exports everything but `channels.ts` (`data-change` also has its own subpath for the preload).
- **What goes there:** what both sides use, and what `shell/src/main` or `shell/src/preload` imports. Helpers only views use stay in `packages/ui/src/client.ts` (`partsOf`, `engineProblem`). That file re-exports the protocol, so views keep importing `./client`.
- **The channel table** (`channels.ts`): `Invoke` maps a channel to its wire function (arguments to result); `Push` maps a channel to its payload. `hh:scopes` is in both: the preload invokes it and main also pushes it.
- **Adding a channel:** one entry in `Invoke` or `Push`; for an invoke, the handler in main through `handle` / `handleFrom` / `handleAll`, and the preload through `invoke`; for a push, main sends through `sendToWindow` / `sendToContents` and the preload listens through `subscribe`. `packages/protocol/test/channels.test.ts` fails until the channel's name appears in the table, in main and in the preload (it does not check that main actually registers or sends it), and fails on any `"hh:…"` literal in main or the preload that is not in the table.
- **Boundary test** (`packages/protocol/test/boundary.test.ts`): `shell/src/main` and `shell/src/preload` do not import `@humanharness/ui`; `ui/src` does not import `runtime`, `engines` or `workspace`; `protocol` imports only types from `engines`, `workspace` and `i18n`, plus the value `@humanharness/workspace/subjects`.

Deviations from the spec:

1. `protocol` imports types from `workspace` and `i18n` and re-exports `@humanharness/workspace/subjects` (§5.4 said `harness-sdk` and `engines` only); moving those types up would make `workspace` import `protocol`.
2. The renderer in `shell/src/renderer` still imports `@humanharness/ui` (it hosts the UI); the rule covers main, preload and the shell's tests.
3. `ui` may import `@humanharness/i18n` (`HarnessApp` builds its i18next instance with it).
4. The shared helpers are whatever main and preload import, which includes `timeAgo`, `addText` and `laterTasks`.
5. Main checks channel names, not argument and result types: its handlers take `unknown` on purpose because renderer input is untrusted. The `Invoke` result types are the preload's declaration and are not checked against what main returns; a follow-up could check each handler's return against `InvokeResult`.
6. The plugin and tool realms' channels (`hh-plugin:rpc`, `hh-tools:rpc`) stay out of the table; they have their own preloads and validation.
7. §12 is decided: `runtime` keeps re-exporting `Transport`, `Event` and the rest of the contract. 55 files import them through `runtime`; moving them is churn with no behaviour change. Revisit if a later plan touches those files anyway.
8. The `ui` tests stay in `ui/test`; they import `../src/client`, which re-exports the protocol.
