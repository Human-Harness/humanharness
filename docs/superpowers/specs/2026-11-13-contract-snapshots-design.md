# Published-contract snapshots — design

Date: 2026-11-13
Status: approved by Marco on 2026-11-13
Source: the herdr comparison (https://claude.ai/artifact/9rsD7WqQSYDPyPKQqyGci8), item 3, and the minimal-core spec (`2026-11-05-minimal-core-and-mods-design.md`, §7 "Relation to other work"). herdr freezes `released.openrpc.json` and a test fails on any breaking change.

## 1. Goal

A mod that works today keeps working after an update, unless the mod API version says it won't.

- Users' own AI writes mods against `hh.d.ts` and `mod.json` (minimal-core D5). Those mods are not in this repo, so no test of ours compiles them.
- A change to the mod API that breaks them is invisible in review today: `hh.d.ts` is regenerated and the diff looks like any other.
- This spec adds a frozen copy of the contract and a test that tells additive changes from breaking ones.

**In scope:** `hh.d.ts` (both public modules, `@humanharness/mod-sdk` and `@humanharness/ui`) and `mod.json`.

**Out of scope:**
- The harness manifest (`defineHarness`). Most of its keys move under `mods.<id>` in minimal-core steps 1–10; freeze it after step 10.
- The layout as a file. Its types are in `hh.d.ts` and covered there.
- `plugin.json`. The plugin runtime is deleted in minimal-core step 6.
- Publishing the JSON Schema for editor autocomplete (`$schema`).
- The CLI and the MCP server of step 0c1.

## 2. What is frozen

A new folder, `packages/mod-sdk/released/`:

| File | What it holds |
|---|---|
| `contract.json` | `{ "apiVersion": 1, "frozen": false }` |
| `hh.v1.d.ts` | A copy of `packages/shell/scripts/hh.d.ts` |
| `mod-json.v1.schema.json` | `z.toJSONSchema(modJsonSchema)` (zod 4 built-in, input side) |
| `mod-json.v1.examples/*.json` | Five valid `mod.json` files: minimal, with `ui`, with `requires`, with `clonedFrom`, with `history` |
| `roles.json` | The role of each exported type (§3.2) |

- The `vN` in the file names is `MOD_API_VERSION`. A test fails if `contract.json`'s `apiVersion`, the newest `vN` files and `MOD_API_VERSION` disagree.
- The files are written only by `contracts accept` (§4). Nobody edits them by hand.

## 3. The check

Two commands, in `packages/shell/scripts/contracts.ts` next to `hh-dts.ts`:

- `contracts check` — compares the current contract with the newest frozen one. Runs inside a shell test (`packages/shell/test/contracts.test.ts`).
- `contracts accept` — rewrites the frozen files from the current ones (§4).

The result of `check` is one of: **same**, **additive** (safe for existing mods), or **breaking**, with the list of names or keys behind it.

### 3.1 `hh.d.ts`: values

- `check` writes a temporary `.ts` file that declares the frozen `hh.v1.d.ts` and the current `hh.d.ts` under two module names, and compiles it with `tsc` (`strict`, `strictFunctionTypes`).
- For each name in `publicNames()` (already in `hh-dts.ts`) that is a value (function, component, constant), it asserts **the current type is assignable to the frozen one**.
- Function types are compared strictly, so parameter direction comes out by itself: `defineMod`'s definition, `beforeSend`'s callback and its `SendVerdict`, and component props are covered without a role.
- An exported zod schema (`modJsonSchema`, `blockContentSchema`) is compared by `z.input`, with the `mod` rule (§3.2): it is what a mod writes.

### 3.2 `hh.d.ts`: types

Exported types and interfaces are used by mods as annotations, so the direction depends on who fills them. `roles.json` names it for each:

| Role | Who fills it | Rule | Examples |
|---|---|---|---|
| `host` | The host hands it to the mod | current assignable to frozen (members may be added) | `MainCtx`, `UiCtx`, `TaskRef`, `SendInfo`, `TurnEndInfo`, `EngineRunResult` |
| `mod` | The mod writes it | frozen assignable to current (new members must be optional) | `ModDefinition`, `SendVerdict`, `LayoutNode`, `BlockContent`, `ModJson` |
| `both` | Both | mutually assignable | `Tier`, `Disposer` |

- An exported type with no role fails the check, naming the type and the file to add it to.
- A role in `roles.json` for a name that is no longer exported is dropped by `accept`.

### 3.3 Removed names

A name in the frozen public modules that the current ones don't export is **breaking**. A new name is **additive**.

### 3.4 Method parameters (risk)

TypeScript checks the parameters of methods written in shorthand (`ipc(name, handler)`) bivariantly, even under `strictFunctionTypes`. A breaking change to such a parameter could pass §3.1–3.2.

- The plan's first task is a spike: does a mapped type that turns methods into function-typed properties make the check strict? It is tested on a known breaking change to `MainCtx.ipc`.
- If it does not, the mod API's methods are rewritten as properties (`ipc: (name, handler) => Disposer`) in the same plan. It changes no behaviour.

### 3.5 `mod.json`

- Every property in the frozen schema still exists in the current one.
- No property is required now that was optional or absent in the frozen one.
- Every frozen example parses with the current `modJsonSchema`.
- A new optional property is **additive**. A removed one, a newly required one, or an example that no longer parses is **breaking**.

## 4. Before and after the first release

The check never passes on a stale snapshot. Every change to the contract shows up as a diff of `released/` in its PR.

| | `frozen: false` (now) | `frozen: true` (from the first public release) |
|---|---|---|
| same | test passes | test passes |
| additive | test fails: "run `contracts accept`"; `accept` rewrites `v1` | same |
| breaking | test fails, lists what breaks; `accept` rewrites `v1` and prints a warning | test fails; `accept` refuses and asks to bump `MOD_API_VERSION` |
| after a bump to N | — | `accept` writes `hh.vN.d.ts`, `mod-json.vN.*` and sets `apiVersion: N`; the `v1…v(N-1)` files stay as history |

- `frozen` flips to `true` in a one-line PR at the first public release. That is Marco's decision. It is the first item of the release checklist, which does not exist yet; the plan adds a line to `docs/architecture/mods.md` until it does.
- The host already refuses a mod whose `apiVersion` differs (`mod-json.ts`). The check only makes sure the version is bumped when it must be.

## 5. Docs

`docs/architecture/mods.md` gets a section "The contract":
- what is frozen and where;
- the three results and the roles;
- `contracts check` / `contracts accept`, and when `accept` refuses;
- the `frozen` flag and the release step.

## 6. Testing

- `contracts.test.ts` runs `check` against the repo: it passes on master after the plan's last task.
- Fixture tests, one per rule, each with a small frozen/current pair under `packages/shell/test/fixtures/contracts/`:
  - a removed export → breaking;
  - a new member in a `host` type → additive; in a `mod` type, required → breaking, optional → additive;
  - a `both` type widened → breaking;
  - a function parameter narrowed → breaking; a new optional parameter → additive;
  - an exported type with no role → fails with the file to fix;
  - the method-parameter case of §3.4 → breaking;
  - `mod.json`: a removed property, a newly required one, a frozen example that no longer parses → breaking; a new optional property → additive.
- `accept` with `frozen: true` and a breaking change exits non-zero and writes nothing.
- The version test of §2.
