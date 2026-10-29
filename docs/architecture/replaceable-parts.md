# Replaceable parts

The parts of Human Harness that age fast sit behind seams, so each can be replaced by writing one module and changing config (spec `docs/superpowers/specs/2026-10-29-replaceable-parts-design.md`).

| Part | Seam | Status |
|---|---|---|
| Engines and transports | `EngineAdapter` + registry (`packages/engines/src/registry.ts`) | Done (plan 1) |
| UI/core contract | `@humanharness/protocol` | Plan 2 |
| Model routing | `ModelPolicy` | Plan 3 |
| Context strategy | `ContextPolicy` | Plan 4 |

Rules: dependencies point down only; no `if (kind === "claude-cli")` outside an engine's folder (`packages/engines/test/boundary.test.ts`); policies decide and never execute; interfaces are defined by their inputs and outputs. How to add an engine: `docs/architecture/engines.md`, "Adding an engine".
