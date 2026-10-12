# Resources: models and context — design (plan 3c)

Status: approved in conversation on 2026-10-12. Builds on [flow and context](2026-10-12-flow-and-context-design.md) (plan 3). Must land before plan 4a, because the authoring guide asks for tiers.

## 1. Why

A Human Harness brings the user close to the best result for a task, using close to the best use of the user's resources. Pillar 3 (context management) therefore also covers the model:

- Don't spend a top model on small work.
- Don't hand a limited model demanding work.
- Keep each task's context within a budget, without losing key decisions.

Today the core never chooses the model, the effort or the context size. Every task runs on the engine's default model.

## 2. What the engines let us control (spikes S5–S7, 2026-10-12)

| | Claude CLI 2.1.296 | Codex through codex-acp 2.2.2 |
|---|---|---|
| Model | `--model <alias or full id>`. The aliases `haiku`, `sonnet` and `opus` always point at the latest version. | `CODEX_CONFIG={"model": …}` at spawn. `session/set_config_option {configId:"model"}` also works later. |
| Effort | `--effort low\|medium\|high\|xhigh\|max`. Accepted silently and not echoed in any event. | `CODEX_CONFIG={"model_reasoning_effort": …}`. Changing the model resets effort to the model's default. |
| Context cap | `--autocompact <100k–1M>` sets the threshold at which the engine compacts. | `model_auto_compact_token_limit`: the engine runs "Compact conversation" before a turn. `model_context_window` caps the window itself. |
| Context in use | Read from the last turn's `usage`: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. | `usage_update {used, size}` notification. |
| Model list | None. | `session/new` returns `configOptions` with the model ids, their descriptions and the effort values. |
| Unavailable model | Exit 1. The result has `is_error:true` with `error:"model_not_found"`, but `subtype:"success"`. | `set_config_option` returns a bare `-32602`. With `CODEX_CONFIG`, check `currentModelId` after `session/new`. |
| Prompt cache | Kept per model. Switching models inside a session makes the new model rewrite the whole history into its cache. | Automatic. Not tested per model. |

`CODEX_CONFIG` is read by the adapter (the README documents it as "JSON object merged into the Codex session config"). It is merged into every session with no allowlist, and it is not a credential variable, so it respects the compliance rules. The Codex prompt prefix alone is about 15k tokens.

## 3. Decisions

- **D1. Abstract tiers.** A task runs at `light`, `standard` or `deep`. A harness never names a model.
- **D2. Fixed per task.** A task's tier, model, effort and cap never change mid-task; changing them inside a session would break the prompt cache. Different tasks on different models are fine, because each model keeps its own cache.
- **D3. Two layers the user can change:**
  1. Each task → `light`, `standard`, `deep` or `custom`.
  2. Each tier → model, effort and context cap, per engine.
  A `custom` task sets its own model, effort and cap.
- **D4. Checkpoint before compaction.** At 80% of the task's cap, the app asks for a quiet `save_note` of the decisions so far. The engine then compacts on its own when it reaches the cap.
- **D5. Context meter.** The task row shows how much of the cap is used. Plan quota (Claude's five-hour window) is plan 3b's job.

## 4. Manifest

```ts
actions: {
  manifest: { …, tier: "standard" },   // optional; default "standard"
},
questions: { tier: "light" },          // optional; tier of free questions (q-<slug> tasks); default "standard"
```

- `tier` is `z.enum(["light", "standard", "deep"])`.
- `custom` is a user setting only; a manifest cannot declare it.
- The existing `cost` hint stays. `harness check` (plan 4a) will flag a mismatch such as `cost: "high"` on a `light` action.

## 5. Resolution

```
taskProfile(task) =
  user custom for task          → { model, effort, cap }
  else tier = user tier for task ?? manifest tier ?? "standard"
       → userTiers[engine][tier] ?? DEFAULT_TIERS[engine][tier]
```

The result is a `ModelProfile { engine, tier | "custom", model, effort, cap }`. It is resolved once, when the task starts, and stored in `tasks.json` with the task.

### 5.1 Default tables (core, `packages/engines`)

| Tier | Claude | Codex |
|---|---|---|
| light | `haiku`, effort low, cap 100k | engine default model, effort low, cap 100k |
| standard | `sonnet`, effort medium, cap 200k | engine default model, effort medium, cap 200k |
| deep | `opus`, effort high, cap 400k | engine default model, effort high, cap 400k |

- For Codex, "engine default model" leaves `model` out of `CODEX_CONFIG`, so the defaults keep working as model ids change.
- Caps run from 100k (Claude's minimum) to the model's window. The UI offers 100k, 200k, 400k and 1M.

### 5.2 Applying a profile

- **Claude:** append `--model <model> --effort <effort> --autocompact <cap>` to every call of the task (first turn and every `--resume`).
- **Codex:**
  - Spawn the adapter for the task with `env.CODEX_CONFIG = JSON.stringify({ model?, model_reasoning_effort, model_auto_compact_token_limit: cap })`, one process per task as today.
  - Only these keys are ever written, and any `CODEX_CONFIG` the app's own environment already has is replaced, never merged.
  - After `session/new`, compare `models.currentModelId` with the requested model.
- **Codex model list:** saved from `session/new` `configOptions` (model ids, descriptions, effort values) into `engines.json` → `codex.models`. The Settings select uses this list. Before the first connection, it offers only "Predeterminado del motor".
- **Claude model list:** fixed to the aliases `haiku`, `sonnet` and `opus`.

### 5.3 Unavailable model

- **Detection:**
  - Claude: `is_error` with `error:"model_not_found"`, or `api_error_status:404` with `terminal_reason:"api_error"`.
  - Codex: a model that is not in the saved list, or a `currentModelId` mismatch after `session/new`.
- **Fallback:**
  1. Retry the task once with the next tier down (deep → standard → light → engine default).
  2. Store the fallback profile in the task.
  3. Show a notice: "Tu plan no incluye <modelo>; usamos el nivel <X>."
- A `custom` profile falls back to the engine default.
- The runtime maps `model_not_found` to a new error code, `model_unavailable`.

## 6. Context cap and checkpoint

- After each turn, the TaskManager computes `used`:
  - Claude: from the turn's `usage` event.
  - Codex: from the last `usage_update.used`.
- The runtime emits a new event: `{ type: "context"; used: number; size?: number }`.
- **Checkpoint:**
  - When `used ≥ 0.8 × cap` and no checkpoint has run since the last compaction, the TaskManager runs a quiet turn before the next user turn.
  - It uses the same session and model as the task, and the prompt asks for `save_note` with the decisions so far.
  - The note goes to the task's note file. A later checkpoint or close updates the same file.
- **Compaction is detected to reset the flag:**
  - Codex: a `tool_call` titled "Compact conversation", or a `compaction_update`.
  - Claude: `used` drops by more than 50%.
- **UI:**
  - The checkpoint shows as "Guardando lo importante…" in the Working row.
  - The task row gets a thin context meter, `used / cap` in %, with a tooltip of exact tokens.

## 7. Settings › Modelos

The mockups were approved on the canvas page "Plan 3c · Modelos".

- **Tareas:**
  - One row per action, plus "Pregunta libre", with a segmented control Liviano / Estándar / Profundo / Personalizado.
  - A changed row shows "Cambiado · recomendado: X · Restaurar".
  - A custom row shows a summary and expands to Modelo, Esfuerzo and Tope de contexto, with "Volver a lo recomendado".
- **Niveles:**
  - An engine switch (Claude / Codex).
  - Three cards with Modelo, Esfuerzo and Tope de contexto, plus "Lo usan" chips.
  - Footer: the fallback notice and "Restaurar recomendados".
- **Storage:** `config.json` (per app, so per harness):

```json
"models": {
  "tasks": { "<actionId>|questions": "light|standard|deep" | { "custom": { "engine": "claude", "model": "opus", "effort": "high", "cap": 400000 } } },
  "tiers": { "claude": { "deep": { "model": "opus", "effort": "high", "cap": 400000 } }, "codex": { … } }
}
```

- Each value is validated field by field when it is read; a bad entry is ignored, so the default applies. Model ids must match `^[A-Za-z0-9._\[\]-]{1,64}$` and must not start with `-`.
- Settings changes apply to the next task, never to the running one.

## 8. Usage log

Each `usage.jsonl` line gains `tier`, `model`, `effort` and `cap`. New `kind` values: `checkpoint` and `compaction`. Plan 4a's `humanharness run` reads these to calibrate tiers.

## 9. Demo

The explainer declares:
- `manifest`, `engines`, `blocks`: standard.
- `turn`, `context`: deep.
- `history`: standard.
- questions: light.

## 10. Testing

- **Unit:**
  - resolution order;
  - the default tables;
  - Claude args and the Codex `CODEX_CONFIG` built from a profile;
  - config validation (bad ids, leading `-`);
  - detection of an unavailable model;
  - the fallback chain;
  - the 80% threshold, the once-per-cycle rule and the compaction reset;
  - the `context` event from both transports.
- **UI:** Settings › Modelos views (tier change, restore, custom expand), the context meter, the checkpoint label.
- **E2E (fake engines):**
  - the fake agents record the args and env they get, and assert the tier of the task;
  - a fake reports a growing `used` to trigger the checkpoint;
  - a fake answers `model_not_found` to exercise the fallback.
- **Manual real run:** extend `packages/e2e/real` with `HH_REAL_TIER` and assert the reported model.

## 11. Out of scope

- Plan quota indicator and plan tiers (plan 3b).
- Switching the model mid-task.
- Automatic tier suggestions ("this answer was weak, retry deeper").
- Choosing variants with a larger window, such as Claude's 1M variants.
- Other engines.
