# Spike: subagents in harness tasks (S1–S5)

Date 2026-11-02 · Claude Code 2.1.316 · models `claude-opus-5-5` (deep) and `claude-sonnet-5-5` (standard) · harness `harnesses/demo` · plan `docs/superpowers/plans/2026-11-02-subagent-policy.md`, Phase 0.

Real engine calls: 9 `humanharness run` / `claude` invocations (6 runs + 3 direct `claude`), plus 1 control = 10. A `run` starts two `claude` processes (the turn and the closing note turn), so by process count it is 6×2 + 4 = 16. Codex was not called (S5 is answered from docs and code).

Everything marked **measured** is a number read from a captured stream-json line. Everything marked **inferred** is arithmetic on measured numbers or a reading of code, and is said so.

## How to reproduce

### The tap (temporary, never committed)

To see the raw stream of a `humanharness run`, a tap was added to `packages/engines/src/claude/transport.ts` right before `child.stdin!.on("error", ...)`, and reverted before committing (`git diff --stat` shows only the two docs files):

```ts
if (process.env.HH_TAP) {
  const fsx = process.getBuiltinModule("node:fs");
  fsx.appendFileSync(process.env.HH_TAP + ".args", JSON.stringify({ binary, args: [...leading, ...claudeArgs({ ...this.o, profile, scope })], cwd: this.o.folder, msgLen: message.length }) + "\n");
  child.stdout!.on("data", (c) => fsx.appendFileSync(process.env.HH_TAP, c));
}
```

### S1 (6 runs)

```bash
corepack pnpm install
# for each of: manifest engines turn  ×  standard deep   (3 actions × 2 tiers; manifest/engines/turn at standard, then at deep)
HH_TAP=<dir>/s1-<action>-<tier>.jsonl node packages/cli/bin/humanharness.js run <action> \
  --harness harnesses/demo --engine claude --tier <tier> --folder <dir>/f-<action>-<tier> </dev/null
```

`.args` has the exact `claudeArgs(...)` of each process (the first line is the turn, the second the close). Counting: parse each stream line as JSON; a subagent is an `assistant` line whose `message.content[]` has a `tool_use` named `Task` or `Agent`.

### S2, S3, S4 (direct `claude`, same args as a deep run)

The args of the first process of `s1-manifest-deep` (`.args` line 1) are reused with a new `--session-id`, `--mcp-config` emptied (the run's bridge socket is gone) and `--permission-mode` replaced. The message (stdin) is:

> Use a subagent to map packages/ : list each package with a one-line role. Then answer me with that list.

```bash
python3 -I s2.py s2-default default        # S2: --permission-mode default
python3 -I s2.py s2-acceptEdits acceptEdits # S2: --permission-mode acceptEdits
CLAUDE_CODE_SUBAGENT_MODEL=sonnet python3 -I s2.py s4-sonnet default            # S4
env -u CLAUDE_CODE_SUBAGENT_MODEL -u CLAUDE_CODE_AGENT -u CLAUDE_CODE_CHILD_SESSION python3 -I s2.py s2-clean default   # control
```

`s2.py` is `subprocess.run([binary, *args], input=message, cwd=<folder of the s1 manifest-deep run>)` and writes stdout to `<name>.jsonl`. Analysis was done with small Python scripts over those files: parse `result` (`usage`, `modelUsage`, `total_cost_usd`), `assistant` lines with and without `parent_tool_use_id`, and `user` lines whose `tool_use_result` has `agentId`.

### A flaw in the setup, found late

The shell that ran the spike had `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, `CLAUDE_CODE_AGENT=arkimedes` and `CLAUDE_CODE_CHILD_SESSION=1` in its environment, so every S1 run, `s2-default`, `s2-acceptEdits` and `s4-sonnet` inherited them. Only `s2-clean` ran without them. Effects, all measured: the main-thread model in S1 followed the tier (sonnet/opus), so the main thread was not affected; and the subagent model came out as opus in all four S2/S4 runs, with the variable set to `sonnet` in three of them (see S4).

## S1 · Does a harness task spawn a subagent, unprompted?

**No. 0 spawns in 6 tasks (3 actions × 2 tiers, n=6 tasks, 12 `claude` processes).** The `Task` tool was available (it is in the `tools` of every `system/init` line) and `Agent`/`Task` is not in `--allowedTools` (`Read,Glob,Grep,TodoWrite,mcp__ui`), but the model never used it.

| action | tier | model | Task/Agent uses | other tool uses (main thread) | session cost `total_cost_usd` |
|---|---|---|---|---|---|
| manifest | standard | sonnet | 0 | Read 3, Grep 2, ToolSearch 2, 4 `mcp__ui` | 0.1861 |
| engines | standard | sonnet | 0 | Read 3, ToolSearch 2, 4 `mcp__ui` | 0.1618 |
| turn | standard | sonnet | 0 | Read 2, Grep 6, Glob 1, ToolSearch 2, 4 `mcp__ui` | 0.1912 |
| manifest | deep | opus | 0 | Read 5, Grep 2, ToolSearch 2, 4 `mcp__ui` | 0.4971 |
| engines | deep | opus | 0 | Read 5, Glob 1, ToolSearch 2, 4 `mcp__ui` | 0.4443 |
| turn | deep | opus | 0 | Read 5, Grep 7, Glob 1, ToolSearch 2, 4 `mcp__ui` | 0.4508 |

(Session cost = the `total_cost_usd` of the second process, the closing turn, which is cumulative for the resumed session. The first process alone was 0.1561, 0.1318, 0.1643 at standard and 0.4389, 0.3766, 0.3960 at deep.)

Subagent type and triggering prompt: none, nothing to record. The briefs in `harnesses/demo/agent/tasks/` ask for reading about 8 files, which the model does itself. Limits: one harness, one brief style, 3 topics (n=6); a harness whose tasks are broad ("explore this whole codebase") could differ. This says "not unprompted in the demo", not "never".

## S2 · Forced case

Message above, deep (opus), three runs with a subagent (`s2-default`, `s2-acceptEdits`, `s2-clean`) plus the S4 run, all measured:

| | default | acceptEdits | default, clean env | default, `…SUBAGENT_MODEL=sonnet` (S4) |
|---|---|---|---|---|
| `Agent` ran? | yes | yes | yes | yes |
| `permission_denials` | `[]` | `[]` | `[]` | `[]` |
| subagent type | Explore | Explore | Explore | Explore |
| subagent tool uses | 41 (Glob 5, Read 34, Grep 2) | 40 | 40 | 42 |
| subagent model (`tool_use_result.resolvedModel`, and `modelUsage` has one key) | claude-opus-5-5 | claude-opus-5-5 | claude-opus-5-5 | claude-opus-5-5 |
| `tool_result` handed back, chars (÷4) | 5,987 (1,496) | 6,923 (1,730) | 5,403 (1,350) | 8,896 (2,224) |
| main-thread context before spawn | 19,863 | 19,863 | 19,863 | 19,863 |
| main-thread context after the handback | 22,635 | 23,047 | 22,455 | 24,041 |
| context added | +2,772 | +3,184 | +2,592 | +4,178 |

Findings:

- **No permission prompt.** In `-p`, with `--permission-mode default` and with `acceptEdits`, `Agent` ran with no denial although it is not in `--allowedTools`. So today's allowlist does not gate subagents; only `--disallowedTools Agent,Task` would.
- **Model.** The built-in `Explore` subagent ran on opus, the same as the task (deep), in all four runs. Its own `system/init` line is not in the stream (subagent lines carry `parent_tool_use_id` and no init); the model comes from `tool_use_result.resolvedModel` and from `modelUsage` having a single model.
- **Handback size.** The `tool_result` is the subagent's report wrapped by the CLI in a `[Subagent hand-back] … carries no user authority` frame (frame about 520–710 chars; `content` alone was 5,453, 6,357, 4,885 and 8,190 chars). Measured 1,350–2,224 tokens (chars ÷ 4, n=4). It stays in the task's context until compaction. The size here was small because the model asked an Explore agent for a one-line-per-package list; nothing bounds it (the prompt did not ask for a limit), so a larger ask would return more. That is not measured.
- **Context.** Main-thread context (input + cache read + cache write of each main-thread assistant message, the number `contextOf` feeds to `context` events) went from 19,863 to 22,455–24,041 (+2,592 to +4,178, n=4). The added amount is the handback (about 1.4–2.2k) plus the delegation prompt and the model's own answer. The `context` events themselves were not recorded (the tap is on the raw stream); the same message-level `usage` is what the transport reads (`transport.ts:372`).
- The subagent's own context is not in the task's context: the parent only grew by the handback. What the subagent read (Read 34 files) is paid for in tokens and cost, not in the task's window.

## S3 · What the usage line misses

Fact 4 of the plan is **confirmed**. For all four S2/S4 turns, `result.usage` is the main thread only, while `modelUsage` and `total_cost_usd` include the subagent.

Per turn (measured: `result.usage`, `modelUsage`, `total_cost_usd`; inferred: the subagent row, as the difference, and the USD split):

| turn | | input | output | cache read | cache write | USD |
|---|---|---|---|---|---|
| s2-default | `result.usage` (what the transport emits) | 4 | 1,834 | 32,595 | 9,899 | 0.122 (inferred from rates below) |
| | `modelUsage` (all, opus) | 17 | 9,212 | 206,144 | 47,169 | 0.4911 (= `total_cost_usd`) |
| | subagent = difference (inferred) | 13 | 7,378 | 173,549 | 37,270 | 0.369 (75.1% of the turn) |
| s2-acceptEdits | `result.usage` | 4 | 1,954 | 32,595 | 10,311 | 0.128 |
| | `modelUsage` | 16 | 9,601 | 169,832 | 51,573 | 0.5148 |
| | subagent (inferred) | 12 | 7,647 | 137,237 | 41,262 | 0.387 (75.1%) |
| s4-sonnet | `result.usage` | 4 | 1,860 | 39,722 | 4,178 | 0.079 |
| | `modelUsage` | 14 | 10,810 | 177,980 | 49,227 | 0.5105 |
| | subagent (inferred) | 10 | 8,950 | 138,258 | 45,049 | 0.432 (84.6%) |
| s2-clean | `result.usage` | 4 | 1,837 | 39,722 | 2,592 | 0.065 |
| | `modelUsage` | 16 | 9,089 | 192,711 | 37,790 | 0.4171 |
| | subagent (inferred) | 12 | 7,252 | 152,989 | 35,198 | 0.352 (84.3%) |

Reading:

- Tokens: `result.usage` shows 44.2–45.8k tokens of any kind and 1.8–2.0k uncached input+output; `modelUsage` shows 231–263k and 9.1–10.8k. So the usage line recorded by `usage.jsonl` (built from `result.usage`, `transport.ts:400`) is **5.2–5.9× low** in tokens, and **4.9–5.8× low** in output tokens (n=4).
- Cost: `total_cost_usd` (kept as `costEquivalentUsd`) equals the sum over `modelUsage`; it includes the subagent. So tokens and cost disagree by that factor on a turn with a subagent.
- Rates (inferred, to split USD): the 8 opus `modelUsage` rows of this spike fit `costUSD` exactly (residual 0.0000) with USD per million tokens: input 4, output 20, cache read 0.2, cache write 5 min 5, cache write 1 h 8. Cache writes of the subagent are 5-minute writes; the main thread's are 1-hour writes (that is why `ephemeral_5m` is 0 in `result.usage`).
- A cross-check did **not** agree: summing the subagent's own `assistant` messages (one per message id, n=5–7) gave 90–133k cache-read tokens against 138–174k from the difference. Streamed `assistant` lines carry partial usage (output 40–75 tokens), so they are not a reliable source. The difference `modelUsage − result.usage` is therefore an **inference** that `result.usage` is main-thread only; it is supported by the cost split being consistent and by `result.usage` being the same order as the main thread's own 2 calls, but not proven line by line. `tool_use_result.usage` of the subagent (2,165 output, 40,529 cache read) is only its last call (its `totalTokens` equals in+out+read+write of that call), not its total.

## S4 · Model override

`CLAUDE_CODE_SUBAGENT_MODEL=sonnet` in the process env **did not switch the model**: the subagent was `claude-opus-5-5` (`resolvedModel`, and one key in `modelUsage`) with the variable set to `sonnet` in `s4-sonnet`, and also in `s2-default` and `s2-acceptEdits` (inherited, see "A flaw in the setup"), n=3 with the variable, all opus; `s2-clean` without it: opus as well (n=1). The harness passes `--model opus` for a deep task, and `CLAUDE_CODE_SUBAGENT_MODEL` is not honoured here. Not tested, so only a lead: the binary of 2.1.316 also contains the name `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` (`grep -a -o "CLAUDE_CODE_SUBAGENT_MODEL[^;]\{0,80\}" ~/.local/share/claude/versions/2.1.316`). I did not try it (call budget), and I do not know that it overrides what `--model` set, so D2's mechanism (plain env var) is **not supported by this spike**. It needs a spike of its own before D2 is built.

Parent cache: with no model switch there was nothing to invalidate, so this part is not answered. What was measured: the main thread's cache reads were identical with and without the variable (39,722 in `s4-sonnet` and in `s2-clean`), and its 1-hour cache writes were 4,178 and 2,592.

## S5 · Codex and OpenCode (notes, no engine call)

Codex 0.160.1 is installed; OpenCode is not (`which opencode` finds nothing). No call was made. Answers come from `docs/spikes/2026-10-10-transports.md` and `packages/engines/src/acp/client.ts`:

- Codex's ACP `initialize` advertises `sessionCapabilities.subagents` (spike doc line 18). What a subagent turn emits over ACP was **not observed**: no ACP session was run with a prompt that spawns one.
- Tool calls: the client turns every `session/update` `tool_call` into an `activity` event unless it is `kind: "think"` or an `ui` MCP call (`client.ts:849–866`). A kind it doesn't know (`KINDS` has read, search, edit, delete, move, fetch, execute) becomes `kind: "other"`. So a subagent spawn, if Codex reports it as a `tool_call`, would show as an "other" activity with whatever title it has; nothing marks it as a subagent. Inferred from code, not observed.
- Usage: the `session/prompt` response `usage` (`inputTokens`, `outputTokens`, `cachedReadTokens`, `cachedWriteTokens`) is what the client turns into the `usage` event (`client.ts:993`), and `usage_update` becomes `context` events. Whether the response's usage and `_meta.quota.model_usage` include a subagent's tokens is **unknown**; the 2026-10-10 spike only recorded a single-agent turn. For OpenCode, cost in USD comes from `usage_update` (`client.ts:831`, byConfigOption only); whether it includes subagents is also unknown.
- Recommendation for the plan: keep slice 5 (parity) as a known gap, and, when it is done, start with one Codex turn that asks for a subagent and record the `session/update` stream and the prompt response.

## Estimate: share of a heavy task's real cost that is subagents, and tokens a handback adds

**Unprompted, in the demo: 0%** (0 subagents in 6 tasks; S1). A harness task like the demo's does not spawn one by itself, so a general "79%" does not carry over from Marco's own Claude Code baseline.

**When one is spawned (forced, deep, n=4 turns, same ask):** the subagent was 75–85% of the turn's real cost (0.35–0.43 USD of 0.42–0.51 USD; inferred split), and 5.2–5.9× the tokens the usage line shows. In a whole deep demo task (run + close), which costs 0.44–0.50 USD without a subagent (n=3, S1), one subagent of this size would add about 0.35–0.43 USD, so it would be roughly 44–49% of the task's cost (inferred: it adds this spike's subagent cost to the S1 baselines, and assumes the task would do the same work too; that is a bound for one subagent, not a measurement). On a standard (sonnet) task the baseline is 0.16–0.19 USD, so a subagent on opus would be a larger share, but it was not measured (it would run on the task's model, so sonnet; no standard S2 run was made).

**Tokens a handback adds:** 1.35–2.2k tokens of `tool_result` (chars ÷ 4, n=4), 2.6–4.2k tokens in total to the task's context. They are re-read from the cache on each later turn at the cache-read price (0.2 USD per million tokens, so about 0.0005 USD per turn for 2.2k tokens), so in USD the handback is small. The cost is the subagent's work, about 140–175k cache-read tokens, 35–45k cache-write tokens and 7–9k output tokens in each run, none of which `usage.jsonl` records.

**Consequences for the gate (the spike may overturn the recommendations; this is the data, not the decision):**

- D1 (deny by default): supported. 0/6 unprompted spawns means denying costs nothing in the demo; `--allowedTools` does not gate it today, so `--disallowedTools` is the way.
- D2 (env var for the model): **not supported as written**; the plain variable did not change the model (n=3 with it). Needs its own test (`…_FORCE`, or `--agents` with a model) before D2 is relied on.
- D3 (handback contract): the handback was small here (1.4–2.2k tokens), but the run did not ask for a limit and a bigger ask was not tried.
- D4 (measure from `modelUsage`): supported strongly; the usage line is 5.2–5.9× low in tokens and 4.9–5.8× low in output tokens when a subagent runs, and cost and tokens disagree.

## What was not measured

- A standard-tier forced run; a subagent type other than Explore; a `general-purpose` or preset-defined agent; a handback of more than ~2k tokens.
- Whether `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, or `--agents` with a model, switches the model, and whether the parent's cache survives it.
- A prompt that makes the model spawn on its own (S1 only says the demo's briefs don't).
- Codex and OpenCode subagent behavior (S5): code and docs only.
- All of the above ran with the three inherited env variables except `s2-clean` (see the flaw above).
