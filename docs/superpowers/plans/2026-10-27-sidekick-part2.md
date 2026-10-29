# Sidekick, part 2 (after the reply, heads-ups, learning, several sidekicks, places, presets, import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship delivery slices 2–5 of the Sidekick spec on top of part 1: the after-reply moment and queued prompts, the three heads-ups with their buttons, learning (events, thresholds per kind, muting, the profile update at task close, "What Sidekick learned"), several sidekicks with personalities and purposes (routing, one session per sidekick, shared cap, per-scope records, the `focus`, `process-guard`, `mentor`, `daily-summary` and `custom` purposes, the `phase-change`, `daily` and `before-approve` moments), harness places (`client.sidekick.ask`), presets, and import by paste or file picker.

**Architecture:** Everything stays in the part 1 shape. The `sidekick` collection gains three record types (`learned`, `sidekick`, `scope`) next to `settings`. A small events log (`<base>/.harness/sidekick/events.jsonl`) feeds per-sidekick thresholds and muting. The `SidekickController` becomes a router: for each moment it builds the candidates (sidekicks on in the open scope with a purpose for that moment), picks one speaker (free routing first, then the person's order), and only that sidekick's session (one per sidekick and task, its own folder and brief) calls the model. New moments enter through two new optional `TaskDeps` hooks (`turnEnded`, `phaseMoved`) and through app start (`daily`); `before-approve` and places are client calls.

**Tech Stack:** as part 1 (TypeScript, zod 4, Electron 44, React 19, i18next, Vitest + happy-dom, Playwright with fake-claude, pnpm via corepack).

**Spec:** `docs/superpowers/specs/2026-10-25-sidekick-design.md` §2a, §4.2, §4.3, §6, §7, §8, §10 slices 2–5. **Depends on:** part 1 merged (`docs/superpowers/plans/2026-10-27-sidekick-part1.md`); branch `feat/sidekick-many` stacked on `feat/sidekick`.

---

## Conventions

Same as part 1: UI strings only inside the `"sidekick"` block of `packages/i18n/src/locales/en.json`; `@humanharness/ui` imports only types; colours via `--hh-*` tokens; main modules take I/O as deps; English everywhere, including the labels the spec writes in Spanish (Decision 9 below). Small additive edits only to the hot files shared with the document-reader line (`en.json`, `client.ts`, shell `main/index.ts`); the task `AGENTS.md` managed section is never touched.

**Commands and git.** `git -C <worktree> …`, never a bare stash, never push. Every commit ends with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7
```

Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green; main/preload/UI tasks also run `corepack pnpm app:build`; Task 26 runs `corepack pnpm e2e`.

**Compliance.** The import picker refuses any path inside `~/.claude` or `~/.codex`, after resolving links, **before reading anything**: it compares resolved paths only (a `realpath` of the picked file and of the two home folders), and never lists or opens anything inside those folders. Never read `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode` or credential files either.

**D0 is a hard rule** (each with a regression test):
- with Sidekick off nothing new runs: no after-reply turn, no heads-up, no learning turn, no daily card, no events line (Tasks 5, 7, 9, 16);
- with Sidekick on and no sidekick records, the person has exactly part 1's single "Sidekick" (prompt-coach + focus), and the pre-send review behaves as in part 1 (Task 11);
- a manifest without `places`/`presets` parses to the same object (Task 1);
- `TaskManager` without the new hooks runs exactly as before (Tasks 5, 15);
- `.harness/sidekick/events.jsonl` is never committed by the history (Task 2);
- the harness UI's `client.data` still never sees the `sidekick` collection (part 1 Task 9 test stays).

## Decisions this plan takes where the spec leaves room

1. **Record ids.** `settings`; learned items `l-<8 hex>`; sidekicks the slug of their name (`sidekick` for the default one, `-2`, `-3` on clashes); scope records `s-<scope>-<sidekick>`.
2. **The default sidekick is implicit until written.** With no `sidekick`-type record the controller acts as if the default one exists (`DEFAULT_SIDEKICK`); the first edit, reorder, scope switch or adoption writes it. So part 1 folders need no migration.
3. **Moments on by default.** `afterReply` and `headsUps` default to on (when Sidekick is on); the cap bounds their cost. Open question 1.
4. **Thresholds** need the full 10 cards (spec "its last 10 cards"); with fewer, 0.5. `timeout` outcomes don't count as cards.
5. **"Why shown"** is shown only with at least 3 past cards of that kind for that sidekick: "You took N of your last M <kind> suggestions".
6. **Learning session.** The learn turn runs on the prompt-coach speaker's engine and tier in a one-off session (its own `learn` folder), closed right after; logged with `moment: "learn"`.
7. **Heads-ups → buttons.** Context near full → Finish task; repeated ask → Save as decision; off-phase drift → Finish task. Every heads-up also has Dismiss. "Save as decision" writes a note as the person (title "Decision: <topic>", the decision in `decisions`) in the open task's scope, with a `Note: …` history commit carrying the task's trailer.
8. **Scope settings.** The core has no per-scope settings screen. "Sidekicks in this <scope label>" is a section of Settings › Sidekicks for the open scope (absent without scopes: the single implicit scope uses the sidekicks' defaults).
9. **English labels.** The spec's Spanish quotes become: "Import", "Suggested by the harness", "What they learned about you", "These files belong to an engine's settings. Copy or paste their content instead.", "It's a copy: changes to the original won't reach it.", "I understand it's a copy", "The original changed · Bring the changes", "Not imported: …", "Sidekicks in this <scope label>".
10. **`before-approve` without a caller.** The document-review spec isn't implemented: this plan ships the controller method, IPC and `client.sidekick.beforeApprove`, tested in isolation; the "Approve" button wiring belongs to the document-review plan. The E2E pairs pre-send with `phase-change` instead (spec §10 asks for before-approve: Open question 3).
11. **`focus` heads-ups about parallel tasks** (waiting > 30 min, > 3 waiting) need the parallel-tasks spec: not in this plan; the `focus` purpose ships with the three §4.3 heads-ups.
12. **Daily summary input.** Yesterday's closed tasks (their notes' titles), notes written, and Sidekick + task tokens from `usage.jsonl`; titles only. It runs once per local calendar day, at the first app start after setup, from `whenReady`.
13. **Place answers** are free text (`{ text }`, at most 600 characters), not the pre-send contract.
14. **Import limits:** at most 4 files, 64 KB each, `.md`/`.txt`/no extension; paste up to 64 KB.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/harness-sdk/src/sidekick.ts` | Modify | Moments, purposes' moments, places, presets, record types, default sidekick, helpers |
| `packages/workspace/src/sidekick-events.ts` | Create | events.jsonl: append, trim, read, thresholds, shares |
| `packages/workspace/src/sidekick-brief.ts` | Modify | Personality, purposes, per-purpose tips, learned items |
| `packages/shell/src/main/sidekick-turns.ts` | Modify | After-reply, learn, purpose, daily, place, approve and import prompts and parsers |
| `packages/shell/src/main/sidekick-route.ts` | Create | Candidates and the speaker (D11) |
| `packages/shell/src/main/sidekick-store.ts` | Modify | Records: sidekicks, scope records, learned items, muting |
| `packages/shell/src/main/sidekick.ts` | Modify | Moments, routing, sessions per sidekick, heads-ups, learning, daily, places, approve |
| `packages/shell/src/main/sidekick-import.ts` | Create | Path refusal, file reading, hashing, conversion |
| `packages/shell/src/main/sidekick-ipc.ts` | Modify | New channels |
| `packages/shell/src/main/task-manager.ts` | Modify | `turnStarting`, `turnEnded`, `phaseMoved` hooks |
| `packages/shell/src/main/index.ts` | Modify | Wiring (small, additive) |
| `packages/shell/src/preload/index.ts` | Modify | New client calls |
| `packages/ui/src/client.ts` | Modify | Card moments, cards list, heads-ups, sidekicks, learned, import types; new client calls |
| `packages/ui/src/sidekick/*.tsx` | Modify/Create | Cards, heads-ups, learned list, Sidekicks tab, editor, import, scope section, presets |
| `packages/ui/src/InputForm.tsx` | Modify | Pre-send review of free-text answers |
| `packages/i18n/src/locales/en.json` | Modify | Inside the `sidekick` block only |
| `packages/e2e/tests/sidekick-many.spec.ts` | Create | Two sidekicks |
| `docs/architecture/sidekick.md` | Modify | Part 2 sections |

---

### Task 0: Commit this plan

- [ ] **Step 1:** Copy this file to `docs/superpowers/plans/2026-10-27-sidekick-part2.md` in the `feat/sidekick-many` worktree (branched from `feat/sidekick`).

- [ ] **Step 2: Commit**

```bash
git -C <worktree> add docs/superpowers/plans/2026-10-27-sidekick-part2.md
git -C <worktree> commit -m "docs(plans): sidekick part 2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 1: SDK — moments, purposes, places, presets and the new record types

**Files:**
- Modify: `packages/harness-sdk/src/sidekick.ts`
- Test: `packages/harness-sdk/test/sidekick.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/harness-sdk/test/sidekick.test.ts
import { DEFAULT_SIDEKICK, purposeMoments, sidekickCollection, speaksAt } from "../src";

describe("several sidekicks (spec §2a)", () => {
  const schema = () => sidekickCollection().schema;

  it("D0: a block without places and presets parses as before", () => {
    const h = defineHarness({ ...minimal, sidekick: { default: "on" } });
    expect(h.sidekick).toEqual({ default: "on" });
  });

  it("places: action-id pattern, unique", () => {
    expect(defineHarness({ ...minimal, sidekick: { places: [{ id: "terminal", label: "Terminal", description: "Agent output." }] } }).sidekick?.places).toHaveLength(1);
    expect(() => defineHarness({ ...minimal, sidekick: { places: [{ id: "Bad", label: "x", description: "y" }] } })).toThrow();
    expect(() => defineHarness({ ...minimal, sidekick: { places: [{ id: "t", label: "a", description: "b" }, { id: "t", label: "c", description: "d" }] } })).toThrow(/unique/);
  });

  it("presets: known purposes, custom with text and known moments, personality within 1,500", () => {
    const ok = { name: "Guard", mark: "🛡️", personality: "Calm.", purposes: [{ id: "process-guard" }, { id: "custom", text: "Watch the terminal.", moments: ["place:terminal"] }] };
    const h = defineHarness({ ...minimal, sidekick: { places: [{ id: "terminal", label: "Terminal", description: "x" }], presets: [ok] } });
    expect(h.sidekick?.presets?.[0].name).toBe("Guard");
    expect(() => defineHarness({ ...minimal, sidekick: { presets: [{ ...ok, purposes: [{ id: "wizard" }] }] } as never })).toThrow();
    expect(() => defineHarness({ ...minimal, sidekick: { presets: [{ ...ok, purposes: [{ id: "custom", text: "x", moments: ["place:nope"] }] }] } })).toThrow(/place/);
    expect(() => defineHarness({ ...minimal, sidekick: { presets: [{ ...ok, personality: "x".repeat(1501) }] } })).toThrow();
  });

  it("purpose moments and speaksAt", () => {
    expect(purposeMoments({ id: "prompt-coach" })).toEqual(["pre-send", "after-reply"]);
    expect(purposeMoments({ id: "custom", text: "x", moments: ["daily"] })).toEqual(["daily"]);
    expect(speaksAt(DEFAULT_SIDEKICK, "pre-send")).toBe(true);
    expect(speaksAt(DEFAULT_SIDEKICK, "heads-up")).toBe(true);
    expect(speaksAt(DEFAULT_SIDEKICK, "daily")).toBe(false);
  });

  it("record types: learned, sidekick and scope, each with its own fields", () => {
    expect(schema().safeParse({ id: "l-1a2b3c4d", type: "learned", text: "Takes scope fixes.", level: "you", source: "learned", updatedAt: "2026-10-27T10:00:00Z" }).success).toBe(true);
    expect(schema().safeParse({ id: "l-1a2b3c4d", type: "learned", text: "x", level: "team", source: "learned", updatedAt: "x" }).success).toBe(false);
    expect(schema().safeParse({ id: "rulo", type: "sidekick", name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" }], order: 1 }).success).toBe(true);
    expect(schema().safeParse({ id: "rulo", type: "sidekick", name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [], order: 1 }).success).toBe(false);
    expect(schema().safeParse({ id: "s-main-rulo", type: "scope", scope: "main", sidekick: "rulo", on: false, purposeText: "No spec without AC." }).success).toBe(true);
    expect(schema().safeParse({ id: "settings", type: "settings", afterReply: false, headsUps: true, muted: { sidekick: ["vague"] }, learnedAt: "2026-10-27T10:00:00Z", lastDaily: "2026-10-27" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/harness-sdk test -- sidekick`
Expected: FAIL — `purposeMoments` is not exported.

- [ ] **Step 3: Implement (in `sidekick.ts`)**

```ts
/** When a sidekick speaks (spec §2a.1). `place:<id>` is a harness place (§2a.5). */
export const SIDEKICK_MOMENTS = ["pre-send", "after-reply", "heads-up", "before-approve", "phase-change", "daily"] as const;
export type SidekickMoment = (typeof SIDEKICK_MOMENTS)[number] | `place:${string}`;
const PLACE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
export const isMoment = (v: unknown): v is SidekickMoment =>
  typeof v === "string" && ((SIDEKICK_MOMENTS as readonly string[]).includes(v) || (v.startsWith("place:") && PLACE_ID.test(v.slice(6))));

export const SIDEKICK_PERSONALITY_MAX = 1500;
export const SIDEKICK_PURPOSE_TEXT_MAX = 600;

type CorePurpose = Exclude<SidekickPurpose, "custom">;
/** The core's purposes and their moments (spec §2a.2). */
export const PURPOSE_MOMENTS: Record<CorePurpose, readonly SidekickMoment[]> = {
  "prompt-coach": ["pre-send", "after-reply"],
  focus: ["heads-up"],
  "process-guard": ["before-approve", "phase-change"],
  mentor: ["after-reply"],
  "daily-summary": ["daily"],
};

export const purposeSchema = z.union([
  z.strictObject({ id: z.enum(["prompt-coach", "focus", "process-guard", "mentor", "daily-summary"]) }),
  z.strictObject({
    id: z.literal("custom"),
    text: z.string().min(1).max(SIDEKICK_PURPOSE_TEXT_MAX),
    moments: z.array(z.string().refine(isMoment, "Unknown moment")).min(1).max(7),
  }),
]);
export type SidekickPurposeDef = z.output<typeof purposeSchema>;

export const purposeMoments = (p: SidekickPurposeDef): readonly SidekickMoment[] => (p.id === "custom" ? (p.moments as SidekickMoment[]) : PURPOSE_MOMENTS[p.id]);

const placeSchema = z.strictObject({ id: z.string().regex(PLACE_ID), label: z.string().min(1).max(40), description: z.string().min(1).max(300) });
const presetSchema = z.strictObject({
  name: z.string().min(1).max(40),
  mark: z.string().min(1).max(16),
  personality: z.string().max(SIDEKICK_PERSONALITY_MAX),
  purposes: z.array(purposeSchema).min(1).max(6),
});
```

`sidekickSchema` gains two optional fields and a refine (keep `z.strictObject`):

```ts
  places: z.array(placeSchema).max(12).optional(),
  presets: z.array(presetSchema).max(8).optional(),
}).superRefine((s, ctx) => {
  const ids = new Set<string>();
  for (const [i, p] of (s.places ?? []).entries()) {
    if (ids.has(p.id)) ctx.addIssue({ code: "custom", path: ["places", i, "id"], message: `Place ids must be unique: "${p.id}"` });
    ids.add(p.id);
  }
  for (const [i, preset] of (s.presets ?? []).entries()) {
    for (const [j, purpose] of preset.purposes.entries()) {
      if (purpose.id !== "custom") continue;
      for (const m of purpose.moments) {
        if (m.startsWith("place:") && !ids.has(m.slice(6))) ctx.addIssue({ code: "custom", path: ["presets", i, "purposes", j, "moments"], message: `"${m}" names no place of this harness` });
      }
    }
  }
});
```

The record schema becomes (replacing part 1's `sidekickRecordSchema`):

```ts
const ISO = z.string().min(10).max(40);
export const SIDEKICK_RECORD_TYPES = ["settings", "learned", "sidekick", "scope"] as const;
export const sidekickRecordSchema = z
  .strictObject({
    id: z.string().min(1).max(80),
    type: z.enum(SIDEKICK_RECORD_TYPES),
    // settings
    on: z.boolean().optional(),
    preSend: z.boolean().optional(),
    afterReply: z.boolean().optional(),
    headsUps: z.boolean().optional(),
    wait: literalOf(SIDEKICK_WAITS).optional(),
    cap: literalOf(SIDEKICK_CAPS).optional(),
    introSeen: z.boolean().optional(),
    presetsOffered: z.boolean().optional(),
    /** Muted kinds per sidekick id (spec §6.3). */
    muted: z.record(z.string(), z.array(z.string().max(40)).max(10)).optional(),
    /** When learning last ran (spec §6.4). */
    learnedAt: ISO.optional(),
    /** The local day the daily card last ran (YYYY-MM-DD). */
    lastDaily: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // learned
    text: z.string().min(1).max(300).optional(),
    level: z.enum(["you", "harness"]).optional(),
    kind: z.string().max(40).optional(),
    source: z.union([z.enum(["learned", "person"]), z.strictObject({ kind: z.literal("paste") }), z.strictObject({ kind: z.literal("files"), paths: z.array(z.string().max(1024)).min(1).max(4), hash: z.string().regex(/^[0-9a-f]{64}$/) })]).optional(),
    updatedAt: ISO.optional(),
    // sidekick
    name: z.string().min(1).max(40).optional(),
    mark: z.string().min(1).max(16).optional(),
    personality: z.string().max(SIDEKICK_PERSONALITY_MAX).optional(),
    purposes: z.array(purposeSchema).min(1).max(6).optional(),
    order: z.number().int().min(0).max(999).optional(),
    tier: z.enum(["light", "standard", "deep"]).optional(),
    /** The preset name it was adopted from (§2a.7). */
    preset: z.string().max(40).optional(),
    // scope
    scope: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),
    sidekick: z.string().max(80).optional(),
    purposeText: z.string().max(SIDEKICK_PURPOSE_TEXT_MAX).optional(),
    places: z.array(z.string().regex(PLACE_ID)).max(12).optional(),
  })
  .superRefine((r, ctx) => {
    const need = (fields: string[]) => {
      for (const f of fields) if ((r as Record<string, unknown>)[f] === undefined) ctx.addIssue({ code: "custom", path: [f], message: `A ${r.type} record needs "${f}"` });
    };
    if (r.type === "settings" && r.id !== SIDEKICK_SETTINGS_ID) ctx.addIssue({ code: "custom", path: ["id"], message: `The settings record's id is "${SIDEKICK_SETTINGS_ID}"` });
    if (r.type === "learned") {
      need(["text", "level", "source", "updatedAt"]);
      if (typeof r.source === "object") ctx.addIssue({ code: "custom", path: ["source"], message: 'A learned item\'s source is "learned" or "person"' });
    }
    if (r.type === "sidekick") {
      need(["name", "mark", "personality", "purposes", "order"]);
      if (typeof r.source === "string") ctx.addIssue({ code: "custom", path: ["source"], message: "A sidekick's source is an import" });
    }
    if (r.type === "scope") need(["scope", "sidekick", "on"]);
  });
```

Helpers:

```ts
export interface SidekickDef {
  id: string;
  name: string;
  mark: string;
  personality: string;
  purposes: SidekickPurposeDef[];
  order: number;
  tier?: "light" | "standard" | "deep";
  source?: { kind: "paste" } | { kind: "files"; paths: string[]; hash: string };
  preset?: string;
}

/** Without presets, a profile gets this one (spec §3): part 1's single Sidekick. */
export const DEFAULT_SIDEKICK: SidekickDef = { id: "sidekick", name: "Sidekick", mark: "spark", personality: "", purposes: [{ id: "prompt-coach" }, { id: "focus" }], order: 0 };

export const speaksAt = (s: Pick<SidekickDef, "purposes">, moment: SidekickMoment): boolean => s.purposes.some((p) => purposeMoments(p).includes(moment));
```

`sidekickSettings` gains `afterReply: stored?.afterReply ?? true`, `headsUps: stored?.headsUps ?? true`, `presetsOffered: stored?.presetsOffered ?? false`, `muted: stored?.muted ?? {}` (and the `SidekickSettings` interface those fields; update part 1's test expectations of the full object accordingly).

`mark` is "one emoji, or a color token" (§2a.1); `"spark"` names the core's SVG mark (part 1's `SidekickMark`).

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/harness-sdk test`
Expected: PASS (part 1's settings tests updated for the new fields).

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/harness-sdk
git -C <worktree> commit -m "feat(sdk): sidekick moments, purposes, places, presets and record types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 2: Workspace — the events log, thresholds and shares

**Files:**
- Create: `packages/workspace/src/sidekick-events.ts`
- Modify: `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/sidekick-events.test.ts`, `packages/workspace/test/history.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/workspace/test/sidekick-events.test.ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SIDEKICK_EVENTS_MAX, type SidekickEvent, appendSidekickEvent, readSidekickEvents, sidekickEventsFile, thresholdFor, usedShare, whyShown } from "../src/sidekick-events";

const ev = (o: Partial<SidekickEvent>): SidekickEvent => ({ at: "2026-10-27T10:00:00Z", sidekick: "sidekick", moment: "pre", kind: "vague", outcome: "used", ...o });

describe("events.jsonl (spec §6.1)", () => {
  it("lives in .harness/sidekick/ and appends lines", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "hh-ske-"));
    expect(sidekickEventsFile(base)).toBe(path.join(base, ".harness", "sidekick", "events.jsonl"));
    await appendSidekickEvent(base, ev({}));
    await appendSidekickEvent(base, ev({ outcome: "dismissed" }));
    expect((await readSidekickEvents(base)).map((e) => e.outcome)).toEqual(["used", "dismissed"]);
  });

  it("keeps the last 2,000 lines; skips broken ones", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "hh-ske-"));
    const file = sidekickEventsFile(base);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Array.from({ length: SIDEKICK_EVENTS_MAX + 250 }, (_, i) => JSON.stringify(ev({ task: `t${i}` }))).join("\n") + "\n{broken\n");
    await appendSidekickEvent(base, ev({ task: "last" }));
    const all = await readSidekickEvents(base);
    expect(all).toHaveLength(SIDEKICK_EVENTS_MAX);
    expect(all.at(-1)?.task).toBe("last");
  });
});

describe("thresholds per sidekick and kind (spec §6.2, D12)", () => {
  it("0.5 until 10 cards; 0.8 when under 20% of the last 10 were used", () => {
    const nine = Array.from({ length: 9 }, () => ev({ outcome: "dismissed" }));
    expect(thresholdFor(nine, "sidekick", "vague")).toBe(0.5);
    const ten = [...nine, ev({ outcome: "used" })];
    expect(thresholdFor(ten, "sidekick", "vague")).toBe(0.8);
    expect(thresholdFor([...ten, ev({ outcome: "used" })], "sidekick", "vague")).toBe(0.5);
  });

  it("per sidekick: ignoring the mentor never quiets the prompt coach; timeouts don't count", () => {
    const mentor = Array.from({ length: 10 }, () => ev({ sidekick: "mentor", outcome: "dismissed" }));
    expect(thresholdFor(mentor, "mentor", "vague")).toBe(0.8);
    expect(thresholdFor(mentor, "sidekick", "vague")).toBe(0.5);
    expect(thresholdFor(Array.from({ length: 10 }, () => ev({ outcome: "timeout" })), "sidekick", "vague")).toBe(0.5);
  });

  it("used share and why shown", () => {
    const e = [ev({ outcome: "used" }), ev({ outcome: "edited" }), ev({ outcome: "dismissed" }), ev({ kind: "two-asks" })];
    expect(usedShare(e)).toEqual({ used: 3, of: 4 });
    expect(whyShown(e, "sidekick", "vague")).toEqual({ kind: "vague", used: 2, of: 3 });
    expect(whyShown(e, "sidekick", "two-asks")).toBeNull();
  });
});
```

Append to `packages/workspace/test/history.test.ts`, inside the describe that holds "never tracks ignored paths" (same `write`, `read`, `history` helpers):

```ts
  it("never tracks Sidekick's events log (sidekick spec §6.1)", async () => {
    write(".harness/sidekick/events.jsonl", '{"outcome":"used"}\n');
    write("a.md", "1");
    const before = (await history.save("before"))!;
    write(".harness/sidekick/events.jsonl", '{"outcome":"used"}\n{"outcome":"dismissed"}\n');
    await history.restore(before, "undo");
    expect(read(".harness/sidekick/events.jsonl")).toBe('{"outcome":"used"}\n{"outcome":"dismissed"}\n');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/workspace test -- sidekick-events history`
Expected: FAIL — module missing (the history case may already pass: `.harness/` is ignored except what the history keeps; keep it as the regression test).

- [ ] **Step 3: Implement**

```ts
// packages/workspace/src/sidekick-events.ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** Spec §6.1: trimmed to the last 2,000 lines. */
export const SIDEKICK_EVENTS_MAX = 2000;
const TRIM_SLACK = 200;
const LAST_CARDS = 10;
const START = 0.5;
const RAISED = 0.8;
const LOW_SHARE = 0.2;
const WHY_MIN = 3;

export type SidekickEventMoment = "pre" | "after" | "heads-up" | "before-approve" | "phase-change" | "daily" | "place";
export type SidekickOutcome = "used" | "edited" | "sent-anyway" | "dismissed" | "muted" | "timeout";

export interface SidekickEvent {
  at: string;
  task?: string;
  scope?: string;
  action?: string;
  sidekick: string;
  moment: SidekickEventMoment;
  kind: string;
  outcome: SidekickOutcome;
  confidence?: number;
}

/** Not tracked by the history, never leaves the machine (spec §6.1). */
export const sidekickEventsFile = (base: string): string => path.join(base, ".harness", "sidekick", "events.jsonl");

export async function readSidekickEvents(base: string): Promise<SidekickEvent[]> {
  const raw = await fs.readFile(sidekickEventsFile(base), "utf8").catch(() => "");
  const out: SidekickEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as SidekickEvent;
      if (typeof e.sidekick === "string" && typeof e.kind === "string" && typeof e.outcome === "string") out.push(e);
    } catch {
      // a broken line is skipped
    }
  }
  return out.slice(-SIDEKICK_EVENTS_MAX);
}

/** Appends one event; past the limit (with some slack, so it isn't rewritten every time) keeps the last 2,000. */
export async function appendSidekickEvent(base: string, e: SidekickEvent): Promise<void> {
  const file = sidekickEventsFile(base);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(e) + "\n");
  const raw = await fs.readFile(file, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length <= SIDEKICK_EVENTS_MAX + TRIM_SLACK && !lines.some((l) => !l.startsWith("{"))) return;
  const kept = (await readSidekickEvents(base)).map((x) => JSON.stringify(x));
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, kept.join("\n") + "\n");
  await fs.rename(tmp, file);
}

const isCard = (e: SidekickEvent) => e.outcome !== "timeout";
const isUsed = (e: SidekickEvent) => e.outcome === "used" || e.outcome === "edited";

/** The show threshold of `kind` for `sidekick` (spec §6.2): 0.8 when under 20% of its last 10 cards were used. */
export function thresholdFor(events: readonly SidekickEvent[], sidekick: string, kind: string): number {
  const cards = events.filter((e) => e.sidekick === sidekick && e.kind === kind && isCard(e)).slice(-LAST_CARDS);
  if (cards.length < LAST_CARDS) return START;
  return cards.filter(isUsed).length / cards.length < LOW_SHARE ? RAISED : START;
}

/** "N of M suggestions used" (spec §8), over the given events. */
export function usedShare(events: readonly SidekickEvent[]): { used: number; of: number } {
  const cards = events.filter(isCard);
  return { used: cards.filter(isUsed).length, of: cards.length };
}

/** Why a card shows (spec §4.1 step 4): how often this sidekick's `kind` suggestions were taken lately; null with fewer than 3. */
export function whyShown(events: readonly SidekickEvent[], sidekick: string, kind: string): { kind: string; used: number; of: number } | null {
  const cards = events.filter((e) => e.sidekick === sidekick && e.kind === kind && isCard(e)).slice(-LAST_CARDS);
  return cards.length < WHY_MIN ? null : { kind, used: cards.filter(isUsed).length, of: cards.length };
}
```

`export * from "./sidekick-events";` in `packages/workspace/src/index.ts`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/workspace test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/workspace
git -C <worktree> commit -m "feat(workspace): sidekick events log, thresholds per kind and shares

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---
### Task 3: Controller — outcomes, thresholds per kind, "why", and muting

**Files:**
- Modify: `packages/ui/src/client.ts` (card `kind`, `moment`, `speaker`, `why`; `SidekickState.past`, `used`; `client.sidekick.mute/unmute`)
- Modify: `packages/shell/src/main/sidekick-store.ts` (`all`, `put`, `remove`, `mute`, `unmute`)
- Modify: `packages/shell/src/main/sidekick.ts`
- Modify: `packages/shell/src/main/sidekick-ipc.ts`, `packages/shell/src/preload/index.ts`, `packages/shell/src/main/index.ts` (deps `events`, store `readAll`), `packages/ui/test/fake-client.ts`
- Test: `packages/shell/test/sidekick-controller.test.ts`, `packages/shell/test/sidekick-store.test.ts` (append)

- [ ] **Step 1: Types (client.ts)**

```ts
export type SidekickCardMoment = "pre" | "after" | "heads-up" | "before-approve" | "phase-change" | "daily" | "place";

// SidekickCard gains:
  /** Which moment it belongs to; and who speaks (spec §7 "every card names who speaks"). */
  moment: SidekickCardMoment;
  speaker: SidekickInfo;
  /** The kind its threshold and muting use: the first issue's (or flag's) kind; "gap", "next"… for other moments. */
  kind: string;
  /** "You took N of your last M <kind> suggestions" (spec §4.1 step 4); absent with fewer than 3. */
  why?: { used: number; of: number };

// SidekickState gains:
  /** The current task's earlier cards, one line each ("Earlier · used"). */
  past: { id: string; kind: string; outcome: SidekickOutcome | "muted" | "timeout"; speaker: string }[];
  /** "N of M suggestions used" over the last 7 days (spec §8). */
  used: { used: number; of: number };

// SidekickInfo gains `mark: string` (part 1's one is "spark").

// client.sidekick gains:
    /** "Don't flag …": mutes the card's kind for its sidekick at once, and remembers it as the person's (spec §6.3). */
    mute(cardId: string): Promise<void>;
    /** Undoes a mute (Settings). */
    unmute(sidekick: string, kind: string): Promise<void>;
```

`SidekickInfo` in `appState()` becomes `{ id: "sidekick", name: "Sidekick", mark: "spark" }`; the FakeClient's `sidekickState` fixtures in the UI tests (`SK_ON`) gain `past: []`, `used: { used: 0, of: 0 }` and `info.mark`.

- [ ] **Step 2: Write the failing tests**

```ts
// append to packages/shell/test/sidekick-controller.test.ts
// The `harness()` helper gains an in-memory events log: `events: SidekickEvent[]` passed as
//   events: { read: async () => events, append: async (_b, e) => void events.push(e) },
// and returns `events`. Its store gets `readAll: async () => (record ? [record] : [])`.

describe("outcomes and learning signals (spec §6.1–6.3)", () => {
  it("resolve appends one event with the card's kind and confidence", async () => {
    const h = harness({ record: on });
    const r = await h.ctl.review({ text: "make it better" });
    if (r.kind !== "card") throw new Error("card expected");
    await h.ctl.resolve(r.card.id, "used");
    expect(h.events).toEqual([expect.objectContaining({ sidekick: "sidekick", moment: "pre", kind: "vague", outcome: "used", confidence: 0.8, task: "t1" })]);
    expect((await h.ctl.state()).past).toEqual([{ id: r.card.id, kind: "vague", outcome: "used", speaker: "sidekick" }]);
  });

  it("a timeout is an event too", async () => {
    const slow = (signal: AbortSignal) => new Promise<SidekickAnswer>((resolve) => signal.addEventListener("abort", () => resolve({ ok: false, text: "", error: { code: "cancelled" } })));
    const h = harness({ record: on, answers: [slow], waitMs: 30 });
    await h.ctl.review({ text: "make it better" });
    expect(h.events.map((e) => e.outcome)).toEqual(["timeout"]);
  });

  it("a kind ignored 9 times in 10 needs 0.8: a 0.7 suggestion is sent with nothing shown", async () => {
    const ignored = Array.from({ length: 10 }, (_, i) => ({ at: "2026-10-27T09:00:00Z", sidekick: "sidekick", moment: "pre" as const, kind: "vague", outcome: i === 0 ? ("used" as const) : ("dismissed" as const) }));
    const h = harness({ record: on, events: ignored, answers: [json({ verdict: "suggest", issues: [{ kind: "vague", text: "x" }], rewrite: "y", confidence: 0.7 })] });
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
  });

  it("why: with 3+ past cards of the kind", async () => {
    const past = Array.from({ length: 3 }, () => ({ at: "2026-10-27T09:00:00Z", sidekick: "sidekick", moment: "pre" as const, kind: "vague", outcome: "used" as const }));
    const r = await harness({ record: on, events: past }).ctl.review({ text: "make it better" });
    expect(r.kind === "card" && r.card.why).toEqual({ used: 3, of: 3 });
  });

  it("mute: the kind is muted for that sidekick, remembered as the person's, and no longer flagged", async () => {
    const h = harness({ record: on });
    const r = await h.ctl.review({ text: "make it better" });
    if (r.kind !== "card") throw new Error("card expected");
    await h.ctl.mute(r.card.id);
    expect(h.record()).toMatchObject({ muted: { sidekick: ["vague"] } });
    expect(h.writes).toContainEqual(expect.objectContaining({ op: "put", record: expect.objectContaining({ type: "learned", kind: "vague", source: "person", level: "you" }) }));
    expect(h.events.at(-1)).toMatchObject({ outcome: "muted", kind: "vague" });
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
    await h.ctl.unmute("sidekick", "vague");
    expect(h.record()).not.toHaveProperty("muted.sidekick");
  });
});
```

(Extend the `harness()` helper accordingly: `events` option, `writes` captured from the store's `write`, the store's `readAll`, and `record()` reading the settings record from the captured records. Keep every part 1 case passing.)

- [ ] **Step 3: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-controller sidekick-store`
Expected: FAIL — `mute` is not a function; no events appended.

- [ ] **Step 4: Implement**

`SidekickStoreDeps` gains `readAll(): Promise<SidekickRecord[]>`; `read()` becomes `(await readAll()).find((r) => r.type === "settings") ?? null` inside the store (drop the old `read` dep). New methods:

```ts
  async all(): Promise<SidekickRecord[]> {
    return this.d.readAll().catch(() => []);
  }

  async put(record: SidekickRecord): Promise<void> {
    await this.d.write({ op: "put", collection: SIDEKICK_COLLECTION, record });
  }

  async remove(id: string): Promise<void> {
    await this.d.write({ op: "delete", collection: SIDEKICK_COLLECTION, key: id });
  }

  /** "Don't flag …" (spec §6.3): muted at once for that sidekick, plus a learned item marked the person's. */
  async mute(sidekick: string, sidekickName: string, kind: string, now: string): Promise<void> {
    const s = await this.settings();
    const muted = { ...s.muted, [sidekick]: [...new Set([...(s.muted[sidekick] ?? []), kind])] };
    await this.set({ muted });
    await this.put({ id: `l-${randomBytes(4).toString("hex")}`, type: "learned", text: `Doesn't want ${kind} suggestions from ${sidekickName}.`, level: "you", kind, source: "person", updatedAt: now });
  }

  async unmute(sidekick: string, kind: string): Promise<void> {
    const s = await this.settings();
    const left = (s.muted[sidekick] ?? []).filter((k) => k !== kind);
    const { [sidekick]: _drop, ...rest } = s.muted;
    await this.set({ muted: left.length ? { ...rest, [sidekick]: left } : rest });
  }
```

(`randomBytes` from `node:crypto`. The patch schema accepts `muted`, `afterReply`, `headsUps`, `presetsOffered`, `learnedAt`, `lastDaily` from now on; a `muted` equal to `{}` counts as the default.)

In the controller:
- deps gain `events: { read(base: string): Promise<SidekickEvent[]>; append(base: string, e: SidekickEvent): Promise<void> }`;
- `review` passes `muted: settings.muted[SIDEKICK_ID] ?? []` to `localCheck`;
- the card's kind is `reply.issues[0]?.kind ?? flags[0]?.kind ?? "other"`; the show test becomes `reply.confidence < thresholdFor(events, speaker.id, kind)`;
- the card gets `moment: "pre"`, `speaker: { id, name, mark }`, `kind`, and `why` from `whyShown(events, speaker.id, kind)` (without its `kind` field);
- a timeout appends `{ …, outcome: "timeout", kind: flags[0]?.kind ?? "other" }`;
- a private `outcome(card, outcome)` appends the event (`at`, the open task's `task`/`scope`/`action`, `sidekick`, `moment`, `kind`, `outcome`, `confidence`) and pushes `{ id, kind, outcome, speaker }` onto a `past` list kept per task (cleared by `betweenTasks` when the task changes);
- `resolve(cardId, outcome)` calls `outcome(card, outcome)`;
- `mute(cardId)` calls `store.mute(...)`, `outcome(card, "muted")`, clears the card;
- `unmute(sidekick, kind)` calls `store.unmute` and pushes the state;
- `state()` adds `past` and `used: usedShare(events within the last 7 days)`.

IPC: `hh:sidekickMute(cardId: string)`, `hh:sidekickUnmute(sidekick: string, kind: string)` (strings up to 80 characters, else ignored). Preload: `mute: (id) => ipcRenderer.invoke("hh:sidekickMute", id)`, `unmute: (s, k) => ipcRenderer.invoke("hh:sidekickUnmute", s, k)`. In `index.ts`: the store's `readAll` is `(await sidekickStoreFor(baseOf(c)).query(SIDEKICK_COLLECTION, {}, { who: "person", scope: APP_SCOPE })).records as SidekickRecord[]`, and the controller's `events` dep is `{ read: readSidekickEvents, append: appendSidekickEvent }`. FakeClient: `mute`/`unmute` push to `sidekickCalls`.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test && corepack pnpm --filter @humanharness/ui test`
Expected: PASS.

- [ ] **Step 6: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/shell packages/ui
git -C <worktree> commit -m "feat(shell): sidekick outcomes, per-kind thresholds, why shown and muting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 4: UI — why, "Don't flag …", earlier cards and "N of M used"

**Files:**
- Modify: `packages/ui/src/sidekick/SidekickPanel.tsx`, `packages/ui/src/sidekick/SidekickTab.tsx`, `packages/ui/src/ChatView.tsx` (pass `onMute`)
- Modify: `packages/i18n/src/locales/en.json` (inside `sidekick` only)
- Test: `packages/ui/test/sidekick-panel.test.tsx`, `packages/ui/test/sidekick-tab.test.tsx` (append)

- [ ] **Step 1: Write the failing tests**

```tsx
// append to packages/ui/test/sidekick-panel.test.tsx
describe("learning in the panel (spec §4.1, §7)", () => {
  it("why and Don't flag", async () => {
    const h = { ...handlers(), onMute: vi.fn() };
    await panel({ ...SK_ON, status: "suggestion", card: { ...CARD, moment: "pre", kind: "vague", speaker: SK_ON.info, why: { used: 4, of: 5 } } }, h);
    expect(screen.getByText("You took 4 of your last 5 “vague” suggestions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Don't flag “vague”" }));
    expect(h.onMute).toHaveBeenCalledWith("c1");
  });

  it("earlier cards collapse to one line", async () => {
    await panel({ ...SK_ON, past: [{ id: "c0", kind: "two-asks", outcome: "used", speaker: "sidekick" }] });
    expect(screen.getByText("Earlier · used")).toBeTruthy();
  });
});
```

```tsx
// append to packages/ui/test/sidekick-tab.test.tsx
it("N of M used, and muted kinds with Undo", async () => {
  const c = new FakeClient({ language: "en" });
  c.sidekickState = { ...SK_ON, used: { used: 3, of: 8 }, settings: { ...SK_ON.settings, muted: { sidekick: ["vague"] } } };
  await renderIn("en", <SidekickTab client={c} onModels={() => {}} />);
  expect(await screen.findByText("3 of 8 suggestions used this week")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Flag “vague” again" }));
  await waitFor(() => expect(c.sidekickCalls).toContainEqual(["unmute", "sidekick", "vague"]));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-panel sidekick-tab`
Expected: FAIL.

- [ ] **Step 3: Implement**

Strings (inside `"sidekick"`): `"why": "You took {{used}} of your last {{of}} “{{kind}}” suggestions"`, `"mute": "Don't flag “{{kind}}”"`, `"earlier": "Earlier · {{outcome}}"`, `"outcomes": { "used": "used", "edited": "edited", "sent-anyway": "sent anyway", "dismissed": "dismissed", "muted": "muted", "timeout": "timed out" }`, and in `settings`: `"usedShare": "{{used}} of {{of}} suggestions used this week"`, `"muted": "Not flagged"`, `"unmute": "Flag “{{kind}}” again"`.

In `SidekickPanel`, the card shows, below the buttons:

```tsx
      {card.why && <p className="hh-caption">{t("sidekick.why", { used: card.why.used, of: card.why.of, kind: card.kind })}</p>}
      <button type="button" className="hh-link" onClick={() => onMute(card.id)}>{t("sidekick.mute", { kind: card.kind })}</button>
```

(`onMute(cardId: string): void` joins `SidekickPanelProps`; `ChatView` passes `onMute={(id) => void client.sidekick.mute(id)}`.) Below the live card, the past ones:

```tsx
              {s.past.length > 0 && (
                <ul className="hh-sk-past">
                  {s.past.map((p) => (
                    <li key={p.id} className="hh-caption">{t("sidekick.earlier", { outcome: t(`sidekick.outcomes.${p.outcome}`) })}</li>
                  ))}
                </ul>
              )}
```

In `SidekickTab`, after the week line: `t("sidekick.settings.usedShare", state.used)` when `state.used.of > 0`, and a "Not flagged" list: one row per `[sidekick, kinds]` of `settings.muted`, each kind with a button `t("sidekick.settings.unmute", { kind })` calling `client.sidekick.unmute(sidekick, kind)`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/ui test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/ui packages/i18n/src/locales/en.json
git -C <worktree> commit -m "feat(ui): why shown, Don't flag, earlier cards and suggestions used

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 5: After the reply — the hooks, the turn and its card (main)

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts` (`TaskDeps.turnStarting?`, `TaskDeps.turnEnded?`; `runTurn` collects the reply text)
- Modify: `packages/shell/src/main/sidekick-turns.ts` (`afterReplyPrompt`, `cutReply`, `parseAfter`)
- Modify: `packages/shell/src/main/sidekick.ts` (`afterReply`, cancel on send)
- Modify: `packages/shell/src/main/index.ts` (two deps lines)
- Test: `packages/shell/test/task-manager.test.ts` (append), `packages/shell/test/sidekick-turns.test.ts`, `packages/shell/test/sidekick-controller.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// append to packages/shell/test/task-manager.test.ts (reuse the file's `setup()` that scripts one turn's events)
describe("Sidekick hooks (sidekick spec §4.2)", () => {
  it("turnEnded gets the prompt, the reply text and the kind; turnStarting runs before each run turn", async () => {
    const ended: unknown[] = [];
    let starting = 0;
    const t = setup({ script: [[{ type: "text", delta: "Hello " }, { type: "text", delta: "there." }, { type: "done", ok: true }]], deps: { turnEnded: (e) => void ended.push(e), turnStarting: () => void starting++ } });
    await t.manager.ask("What is a manifest?");
    expect(starting).toBe(1);
    expect(ended).toEqual([expect.objectContaining({ kind: "run", ok: true, prompt: "What is a manifest?", reply: "Hello there.", fromBlock: false, task: expect.objectContaining({ id: "t1" }) })]);
  });

  it("D0: without the hooks nothing changes", async () => {
    const t = setup({ script: [[{ type: "done", ok: true }]] });
    await t.manager.ask("x");
    expect(t.turns).toHaveLength(1);
  });
});
```

(If the file's `setup` has no `deps` override, add one: `deps?: Partial<TaskDeps>` spread last into the `TaskManager` deps.)

```ts
// append to packages/shell/test/sidekick-turns.test.ts
import { SIDEKICK_AFTER_MARK, afterReplyPrompt, cutReply, parseAfter } from "../src/main/sidekick-turns";

describe("after the reply (spec §4.2)", () => {
  it("cuts a long reply to head, headings and tail", () => {
    const reply = ["# Intro", "a ".repeat(4000), "## Middle", "b ".repeat(4000), "## End", "c ".repeat(4000)].join("\n");
    const cut = cutReply(reply, 1500);
    expect(cut).toContain("# Intro");
    expect(cut).toContain("## Middle");
    expect(cut).toContain("## End");
    expect(cut).toContain("[…]");
    expect(cut.length).toBeLessThan(reply.length / 2);
    expect(cutReply("short", 1500)).toBe("short");
  });

  it("the prompt holds the person's prompt, the cut reply, the phase goal and the last three prompts' first lines", () => {
    const p = afterReplyPrompt({ harness: { name: "Essay Coach" }, phase: { label: "Outline", brief: "Agree on sections." }, prompt: "Outline chapter 2", reply: "Here it is.", lastPrompts: ["one\nmore", "two", "three", "four"], uiLanguage: "English", purposeText: "No spec without AC." });
    expect(p.startsWith(SIDEKICK_AFTER_MARK)).toBe(true);
    expect(p).toContain("- two\n- three\n- four");
    expect(p).not.toContain("one");
    expect(p).toContain("Scope purpose: No spec without AC.");
  });

  it("parses gap, next and repeated; empty means nothing", () => {
    expect(parseAfter('{"gap":{"title":"Sources","text":"No source for claim 2."},"next":"Add a source for claim 2"}')).toEqual({ gap: { title: "Sources", text: "No source for claim 2." }, next: "Add a source for claim 2" });
    expect(parseAfter("{}")).toEqual({});
    expect(parseAfter("nope")).toBeNull();
  });
});
```

```ts
// append to packages/shell/test/sidekick-controller.test.ts
describe("after the reply (spec §4.2)", () => {
  const end = (o: Partial<Parameters<SidekickController["afterReply"]>[0]> = {}) => ({ task: { id: "t1", scope: "main" }, kind: "run" as const, ok: true, prompt: "Outline chapter 2", reply: "Here it is.", fromBlock: false, ...o });

  it("D0: off → nothing", async () => {
    const h = harness();
    await h.ctl.afterReply(end());
    expect(h.asked).toEqual([]);
  });

  it("a gap becomes an after card, with Put in composer's text", async () => {
    const h = harness({ record: on, answers: [json({ gap: { title: "Sources", text: "No source for claim 2." }, next: "Add a source for claim 2" })] });
    await h.ctl.afterReply(end());
    const s = await h.ctl.state();
    expect(s.cards).toEqual([expect.objectContaining({ moment: "after", kind: "gap", after: { gap: { title: "Sources", text: "No source for claim 2." }, next: "Add a source for claim 2" } })]);
    expect(h.logged.at(-1)).toMatchObject({ moment: "after" });
  });

  it("skipped: checkpoint or close turns, failed turns, block answers, the setting off, nothing to show", async () => {
    for (const e of [end({ kind: "checkpoint" }), end({ kind: "close" }), end({ ok: false }), end({ fromBlock: true })]) {
      const h = harness({ record: on });
      await h.ctl.afterReply(e);
      expect(h.asked).toEqual([]);
    }
    const off = harness({ record: { ...on, afterReply: false } });
    await off.ctl.afterReply(end());
    expect(off.asked).toEqual([]);
    const empty = harness({ record: on, answers: ["{}"] });
    await empty.ctl.afterReply(end());
    expect((await empty.ctl.state()).cards).toEqual([]);
  });

  it("a new send cancels a running after-reply turn", async () => {
    const slow = (signal: AbortSignal) => new Promise<SidekickAnswer>((resolve) => signal.addEventListener("abort", () => resolve({ ok: false, text: "", error: { code: "cancelled" } })));
    const h = harness({ record: on, answers: [slow] });
    const running = h.ctl.afterReply(end());
    await vi.waitFor(() => expect(h.asked).toHaveLength(1));
    h.ctl.turnStarting();
    await running;
    expect((await h.ctl.state()).cards).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- task-manager sidekick-turns sidekick-controller`
Expected: FAIL.

- [ ] **Step 3: Implement**

`task-manager.ts`, in `TaskDeps`:

```ts
  /** A task turn is about to run (Sidekick cancels its after-reply turn, sidekick spec §5 "Serial"). Absent: nothing (D0). */
  turnStarting?(): void;
  /** A task turn ended (sidekick spec §4.2). Never awaited: it never delays the task. Absent: nothing (D0). */
  turnEnded?(end: TurnEnd): void;
```

```ts
export interface TurnEnd {
  task: { id: string; action?: string; scope: string; phase?: string };
  kind: TurnKind;
  ok: boolean;
  /** What the person sent (the display text when the engine got a brief). */
  prompt: string;
  /** The reply's text (paragraphs joined by a blank line). */
  reply: string;
  /** The turn answered an input block (no free text): `[answer to …]`. */
  fromBlock: boolean;
  /** Context used and the task's cap, when the engine reported it (heads-ups, Task 7). */
  context?: { used: number; cap?: number };
}
```

In `runTurn`: before `this.turnTask = task.id;` add `if (kind === "run") this.d.turnStarting?.();`; in `onEvent` collect `if (e.type === "text") reply.at(-1)… ` (a `const parts = [""]` with `paragraph` pushing a new one, as in part 1's `SidekickSession`); after `if (seen.used !== undefined || seen.compacted) await this.track(task.id, seen);`:

```ts
    if (this.d.turnEnded) {
      const end: TurnEnd = {
        task: { id: task.id, ...(task.action ? { action: task.action } : {}), scope: scopeOfTask(task), ...(task.phase ? { phase: task.phase.id } : {}) },
        kind,
        ok: result.ok,
        prompt: options.display ?? message,
        reply: parts.filter((p) => p.trim()).join("\n\n").trim(),
        fromBlock: message.startsWith("[answer to "),
        ...(seen.used !== undefined ? { context: { used: seen.used, ...(task.profile ? { cap: task.profile.cap } : {}) } } : {}),
      };
      try {
        this.d.turnEnded(end);
      } catch (err) {
        console.error("Sidekick's turn hook failed", err);
      }
    }
```

`sidekick-turns.ts`:

```ts
export const SIDEKICK_AFTER_MARK = "Sidekick: after the reply";
export const SIDEKICK_REPLY_TOKENS = 1500;

/** The reply cut to about `maxTokens` (spec §4.2): its head and tail, plus every heading in between. */
export function cutReply(reply: string, maxTokens: number = SIDEKICK_REPLY_TOKENS): string {
  if (estimateTokens(reply) <= maxTokens) return reply;
  const chars = maxTokens * 4;
  const head = reply.slice(0, Math.floor(chars * 0.45));
  const tail = reply.slice(-Math.floor(chars * 0.45));
  const middle = reply.slice(head.length, reply.length - tail.length);
  const headings = middle.split("\n").filter((l) => /^#{1,6}\s/.test(l));
  return [head, "[…]", ...headings, "[…]", tail].join("\n");
}

export interface AfterInput {
  harness: { name: string; tagline?: string };
  phase?: { label: string; brief?: string };
  prompt: string;
  reply: string;
  /** The task's earlier prompts, oldest first; the last three first lines go in. */
  lastPrompts: readonly string[];
  uiLanguage: string;
  /** The scope's purpose text for this sidekick (§2a.4), when any. */
  purposeText?: string;
}

export function afterReplyPrompt(i: AfterInput): string {
  return [
    SIDEKICK_AFTER_MARK,
    "",
    `App: ${i.harness.name}${i.harness.tagline ? ` — ${i.harness.tagline}` : ""}`,
    ...(i.phase ? [`Open phase: ${i.phase.label}${i.phase.brief ? ` — ${i.phase.brief.split("\n")[0]}` : ""}`] : []),
    ...(i.purposeText ? [`Scope purpose: ${i.purposeText}`] : []),
    "Earlier prompts (first lines):",
    ...i.lastPrompts.slice(-3).map((p) => `- ${p.split("\n")[0]}`),
    `UI language: ${i.uiLanguage}`,
    "",
    "<prompt>",
    i.prompt,
    "</prompt>",
    "<reply>",
    cutReply(i.reply),
    "</reply>",
    "",
    'Answer with the JSON object only: {"gap":{"title":string,"text":string}?,"next":string?,"repeated":{"topic":string,"decision":string}?}. Leave out what you have nothing useful for; {} is a fine answer.',
  ].join("\n");
}

export const afterSchema = z.object({
  gap: z.object({ title: z.string().min(1).max(80), text: z.string().min(1).max(400) }).optional(),
  next: z.string().min(1).max(4000).optional(),
  repeated: z.object({ topic: z.string().min(1).max(80), decision: z.string().min(1).max(400) }).optional(),
});
export type SidekickAfter = z.output<typeof afterSchema>;

/** Shared by every JSON reply: the object between the first "{" and the last "}", parsed with `schema`; null otherwise. */
export function parseJson<T>(text: string, schema: z.ZodType<T>): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const r = schema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export const parseAfter = (text: string): SidekickAfter | null => parseJson(text, afterSchema);
```

(`estimateTokens` from `@humanharness/workspace`. Refactor part 1's `parseReview` to use `parseJson` too.)

In the controller (client.ts `SidekickCard` gains `after?: SidekickAfter`-shaped `{ gap?: { title: string; text: string }; next?: string; repeated?: { topic: string; decision: string } }`, and `SidekickState` gains `cards: SidekickCard[]` — the current task's waiting cards other than the live pre-send one):

```ts
  private after: AbortController | null = null;
  private cards: SidekickCard[] = [];
  /** The task's earlier prompts (first lines), for the next after-reply turn. */
  private prompts: string[] = [];

  /** A task turn is about to run: a running after-reply turn is dropped (spec §5 "Sending cancels"). */
  turnStarting(): void {
    this.after?.abort();
  }

  async afterReply(end: TurnEnd): Promise<void> {
    this.prompts.push(end.prompt);
    const settings = await this.d.store.settings();
    if (this.closed || !settings.on || !settings.afterReply) return;
    if (!end.ok || end.kind !== "run" || end.fromBlock) return;
    const setup = await this.d.setup().catch(() => null);
    if (!setup || !(await this.d.hasNotice(setup.engineId).catch(() => false))) return;
    if (await this.pastCap(setup.base, end.task.id, settings)) return;
    const controller = new AbortController();
    this.after = controller;
    try {
      const engine = this.d.engine(setup.engineId);
      const session = await this.sessionFor(setup.base, engine, end.task.id, end.task.id);
      if (!session) return;
      const phases = this.d.phases(end.task.action);
      const open = phases.find((p) => p.id === end.task.phase);
      const answer = await session.ask(
        afterReplyPrompt({
          harness: this.d.harness,
          ...(open ? { phase: { label: open.label, ...(open.brief ? { brief: open.brief } : {}) } } : {}),
          prompt: end.prompt,
          reply: end.reply,
          lastPrompts: this.prompts.slice(0, -1),
          uiLanguage: await this.d.uiLanguage().catch(() => "English"),
        }),
        controller.signal,
      );
      await this.logTurn(setup.base, engine, session, end.task, "after", answer);
      if (controller.signal.aborted || !answer.ok) return;
      const after = parseAfter(answer.text);
      if (!after || (!after.gap && !after.next && !after.repeated)) return;
      this.cards.push({
        id: randomUUID(),
        moment: "after",
        speaker: this.info(),
        kind: after.gap ? "gap" : after.next ? "next" : "repeated",
        prompt: end.prompt,
        flags: [],
        issues: [],
        confidence: 1,
        after,
        at: new Date().toISOString(),
      });
      this.noteRepeated(end.task.id, after.repeated); // Task 7
      await this.push();
    } finally {
      if (this.after === controller) this.after = null;
    }
  }
```

Factor part 1's review-time cap check and usage logging into `pastCap(base, taskId, settings)` and `logTurn(base, engine, session, task, moment, answer)` and use them in `review` too. `info()` returns `{ id: SIDEKICK_ID, name: SIDEKICK_NAME, mark: "spark" }` until Task 11. `review()` also calls `this.after?.abort()` first. `betweenTasks` clears `cards` and `prompts` when the open task changed. `resolve` and `mute` look the card up in `this.cards` too and remove it.

In `index.ts`, the TaskManager deps gain:

```ts
  turnStarting: () => sidekickCtl?.turnStarting(),
  turnEnded: (end) => void sidekickCtl?.afterReply(end).catch((err: unknown) => console.error("Sidekick's after-reply turn failed", err)),
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/shell packages/ui/src/client.ts
git -C <worktree> commit -m "feat(shell): Sidekick after the reply

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 6: UI — the after-reply card and queued prompts

**Files:**
- Modify: `packages/ui/src/sidekick/SidekickPanel.tsx`, `packages/ui/src/ChatView.tsx`
- Modify: `packages/i18n/src/locales/en.json` (inside `sidekick`)
- Test: `packages/ui/test/sidekick-panel.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

```tsx
describe("after-reply card (spec §4.2)", () => {
  const AFTER: SidekickCard = { id: "a1", moment: "after", kind: "gap", speaker: SK_ON.info, prompt: "Outline", flags: [], issues: [], confidence: 1, at: "2026-10-27T10:00:00Z", after: { gap: { title: "Sources", text: "No source for claim 2." }, next: "Add a source for claim 2" } };

  it("shows the gap and the next prompt; Put in composer and Dismiss", async () => {
    const h = handlers();
    await panel({ ...SK_ON, cards: [AFTER] }, h);
    expect(screen.getByText("Sources")).toBeTruthy();
    expect(screen.getByText("No source for claim 2.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Put in composer" }));
    expect(h.onPutInComposer).toHaveBeenCalledWith("Add a source for claim 2");
    expect(h.onDismiss).toHaveBeenCalledWith("a1", "used");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(h.onDismiss).toHaveBeenLastCalledWith("a1", "dismissed");
  });
});
```

(`handlers()` gains `onDismiss: vi.fn()`.)

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-panel`
Expected: FAIL.

- [ ] **Step 3: Implement**

Strings: `"after": { "title": "After the reply", "next": "Next prompt", "dismiss": "Dismiss" }`.

`SidekickPanelProps` gains `onDismiss(cardId: string, outcome: "used" | "dismissed"): void`. The body renders `s.cards` (newest first) after the live card with an `AfterCard`:

```tsx
function AfterCard({ card, onPutInComposer, onDismiss }: { card: SidekickCard } & Pick<SidekickPanelProps, "onPutInComposer" | "onDismiss">) {
  const { t } = useTranslation();
  const a = card.after ?? {};
  return (
    <section className="hh-sk-card" aria-label={t("sidekick.after.title")}>
      <h3>{t("sidekick.after.title")}</h3>
      {a.gap && (
        <>
          <h4>{a.gap.title}</h4>
          <p>{a.gap.text}</p>
        </>
      )}
      {a.next && (
        <>
          <h4>{t("sidekick.after.next")}</h4>
          <p>{a.next}</p>
        </>
      )}
      <div className="hh-sk-actions">
        {a.next && (
          <button type="button" className="hh-primary" onClick={() => { onPutInComposer(a.next!); onDismiss(card.id, "used"); }}>
            {t("sidekick.card.putInComposer")}
          </button>
        )}
        <button type="button" onClick={() => onDismiss(card.id, "dismissed")}>{t("sidekick.after.dismiss")}</button>
      </div>
    </section>
  );
}
```

`ChatView` passes `onDismiss={(id, outcome) => void client.sidekick.resolve(id, outcome)}`. Queued prompts from a pre-send card that was sent (Send suggested / Send anyway) move to an after-style list: when `ChatView` resolves a pre-send card that has `queued`, it keeps them in a local `queued` state shown by the panel under "For later" with Put in composer / Drop (the part 1 rendering, moved out of the live card into the panel body so it survives the card).

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/ui test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/ui packages/i18n/src/locales/en.json
git -C <worktree> commit -m "feat(ui): Sidekick's after-reply card and queued prompts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 7: Heads-ups — context near full, repeated ask, off-phase drift (main)

**Files:**
- Modify: `packages/shell/src/main/sidekick.ts`
- Modify: `packages/shell/src/main/sidekick-ipc.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/shell/src/main/index.ts` (`saveDecision` dep)
- Test: `packages/shell/test/sidekick-controller.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
describe("heads-ups (spec §4.3)", () => {
  const end = (o: object = {}) => ({ task: { id: "t1", scope: "main" }, kind: "run" as const, ok: true, prompt: "p", reply: "r", fromBlock: false, ...o });

  it("context ≥ 75% of the cap: one heads-up per task, 0 tokens", async () => {
    const h = harness({ record: { ...on, afterReply: false } });
    await h.ctl.afterReply(end({ context: { used: 160_000, cap: 200_000 } }));
    await h.ctl.afterReply(end({ context: { used: 170_000, cap: 200_000 } }));
    expect((await h.ctl.state()).cards.filter((c) => c.moment === "heads-up")).toEqual([expect.objectContaining({ kind: "context", headsUp: { kind: "context", share: 0.8 } })]);
    expect(h.asked).toEqual([]);
  });

  it("the same topic asked 3 times: a heads-up with the draft decision", async () => {
    const rep = json({ repeated: { topic: "APA style", decision: "Use APA 7 everywhere." } });
    const h = harness({ record: on, answers: [rep, rep, rep] });
    for (let i = 0; i < 3; i++) await h.ctl.afterReply(end());
    expect((await h.ctl.state()).cards.find((c) => c.moment === "heads-up")).toMatchObject({ kind: "repeated", headsUp: { kind: "repeated", topic: "APA style", decision: "Use APA 7 everywhere." } });
  });

  it("two off-phase flags in a row: drift", async () => {
    const phases = [{ id: "outline", label: "Outline" }, { id: "review", label: "Review citations" }];
    const h = harness({ record: on, task: { id: "t1", action: "essay", scope: "main", phase: "outline" }, phases, answers: [json({ verdict: "send", issues: [], confidence: 1 }), json({ verdict: "send", issues: [], confidence: 1 })] });
    await h.ctl.review({ text: "Check the citations in section 2 against the bibliography" });
    await h.ctl.review({ text: "Check the citations in section 3 against the bibliography" });
    expect((await h.ctl.state()).cards.find((c) => c.moment === "heads-up")).toMatchObject({ kind: "off-phase", headsUp: { kind: "off-phase" } });
  });

  it("heads-ups off, or Sidekick off: none", async () => {
    const h = harness({ record: { ...on, headsUps: false, afterReply: false } });
    await h.ctl.afterReply(end({ context: { used: 190_000, cap: 200_000 } }));
    expect((await h.ctl.state()).cards).toEqual([]);
  });

  it("Save as decision writes the note as the person, then the card goes", async () => {
    const rep = json({ repeated: { topic: "APA style", decision: "Use APA 7 everywhere." } });
    const h = harness({ record: on, answers: [rep, rep, rep] });
    for (let i = 0; i < 3; i++) await h.ctl.afterReply(end());
    const card = (await h.ctl.state()).cards.find((c) => c.moment === "heads-up")!;
    await h.ctl.saveDecision(card.id);
    expect(h.decisions).toEqual([{ task: "t1", scope: "main", title: "Decision: APA style", decision: "Use APA 7 everywhere." }]);
    expect((await h.ctl.state()).cards).toEqual([]);
  });
});
```

(The `harness()` helper gains a `phases` option feeding `deps.phases`, and a `saveDecision` dep that records into `decisions`.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-controller`
Expected: FAIL.

- [ ] **Step 3: Implement**

`client.ts`: `SidekickCard` gains `headsUp?: { kind: "context"; share: number } | { kind: "repeated"; topic: string; decision: string } | { kind: "off-phase"; phase?: string }`; `client.sidekick` gains `saveDecision(cardId: string): Promise<{ ok: boolean; message?: string }>`.

Controller (deps gain `saveDecision(o: { task: string; scope: string; title: string; decision: string }): Promise<void>`):

```ts
const CONTEXT_SHARE = 0.75;
const REPEATS = 3;
const DRIFT = 2;

  /** Per task: whether the context heads-up showed, how often each topic came back, the off-phase streak. */
  private signals = { task: "", context: false, topics: new Map<string, number>(), drift: 0 };

  private signalsFor(task: string) {
    if (this.signals.task !== task) this.signals = { task, context: false, topics: new Map(), drift: 0 };
    return this.signals;
  }

  private async headsUp(task: { id: string; scope: string }, kind: string, headsUp: NonNullable<SidekickCard["headsUp"]>): Promise<void> {
    const settings = await this.d.store.settings();
    if (!settings.on || !settings.headsUps) return;
    const speaker = await this.speakerFor("heads-up", task.scope, "heads-up"); // Task 12; until then this.info()
    if (!speaker) return;
    this.cards.push({ id: randomUUID(), moment: "heads-up", speaker, kind, prompt: "", flags: [], issues: [], confidence: 1, headsUp, at: new Date().toISOString() });
    await this.push();
  }
```

- In `afterReply`, before the setting check: if `end.context?.cap` and `end.context.used / end.context.cap >= CONTEXT_SHARE` and `!signals.context`, set it and `headsUp(end.task, "context", { kind: "context", share: Math.round(used / cap * 100) / 100 })` — this runs even when `afterReply` is off (it costs nothing), but only when Sidekick is on and `headsUps` is on.
- `noteRepeated(task, repeated)`: count by `repeated.topic.trim().toLowerCase()`; at exactly `REPEATS`, `headsUp(task, "repeated", { kind: "repeated", topic, decision })`.
- In `review`, after the local check: if a flag is `off-phase`, `signals.drift++`, else `signals.drift = 0`; at exactly `DRIFT`, `headsUp(task, "off-phase", { kind: "off-phase", phase: <the other phase's label that matched, if known> })`.
- `saveDecision(cardId)`: the card must be a `repeated` heads-up of the open task; calls `d.saveDecision({ task, scope, title: `Decision: ${topic}`, decision })`, records the outcome `used`, drops the card.

`index.ts`, the `saveDecision` dep, reusing the task's note path (D6 "Writes happen only when the person presses a button"):

```ts
    saveDecision: async ({ task, scope, title, decision }) => {
      const c = await validConfig();
      if (!c) throw new Error("The app is not set up yet");
      const base = baseOf(c);
      const note = { title, summary: [decision], decisions: [decision], files: [], open: [] };
      const meta = { action: "decision", date: new Date().toISOString(), engine: c.engineId };
      const slug = noteSlug(title);
      await writeNote(base, slug, note, meta, notesPrefix(scoped(), scope === APP_SCOPE ? MAIN_SCOPE : scope));
      await (await currentHistory())?.save(`Note: ${title}`, await tasks.trailerNow());
      void task;
    },
```

(Check `NoteMeta`'s required fields in `packages/workspace/src/notes.ts:8` and fill exactly those; the person's decision is a note like any other, so the task agent sees it next time from the notes index.)

IPC `hh:sidekickSaveDecision(cardId)` → `{ ok: true }` or `{ ok: false, message }`. "Finish task" in the UI (Task 8) calls the existing `client.finishTask()`: no new main path.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/shell packages/ui/src/client.ts
git -C <worktree> commit -m "feat(shell): Sidekick heads-ups and Save as decision

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 8: UI — heads-ups and the three moments in Settings

**Files:**
- Modify: `packages/ui/src/sidekick/SidekickPanel.tsx`, `packages/ui/src/sidekick/SidekickTab.tsx`, `packages/ui/src/ChatView.tsx`
- Modify: `packages/i18n/src/locales/en.json` (inside `sidekick`)
- Test: `packages/ui/test/sidekick-panel.test.tsx`, `packages/ui/test/sidekick-tab.test.tsx` (append)

- [ ] **Step 1: Write the failing tests**

```tsx
describe("heads-ups (spec §4.3, §7)", () => {
  const hu = (headsUp: NonNullable<SidekickCard["headsUp"]>, kind: string): SidekickCard => ({ id: `h-${kind}`, moment: "heads-up", kind, speaker: SK_ON.info, prompt: "", flags: [], issues: [], confidence: 1, at: "2026-10-27T10:00:00Z", headsUp });

  it("the head counts them; each has its button and Dismiss", async () => {
    const h = { ...handlers(), onSaveDecision: vi.fn(), onFinishTask: vi.fn() };
    await panel({ ...SK_ON, cards: [hu({ kind: "context", share: 0.8 }, "context"), hu({ kind: "repeated", topic: "APA style", decision: "Use APA 7." }, "repeated")] }, h);
    expect(screen.getByText("2 heads-ups")).toBeTruthy();
    expect(screen.getByText("This task has used 80% of its context.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish task" }));
    expect(h.onFinishTask).toHaveBeenCalledWith("h-context");
    fireEvent.click(screen.getByRole("button", { name: "Save as decision" }));
    expect(h.onSaveDecision).toHaveBeenCalledWith("h-repeated");
  });
});
```

```tsx
it("each moment on its own (spec §8)", async () => {
  const c = new FakeClient({ language: "en" });
  c.sidekickState = SK_ON;
  await renderIn("en", <SidekickTab client={c} onModels={() => {}} />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "After the reply" }));
  await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { afterReply: false }]));
  fireEvent.click(screen.getByRole("checkbox", { name: "Heads-ups" }));
  await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { headsUps: false }]));
});
```

(`SK_ON.settings` gains `afterReply: true, headsUps: true, presetsOffered: true, muted: {}`.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-panel sidekick-tab`
Expected: FAIL.

- [ ] **Step 3: Implement**

Strings: `"status.headsUps": "{{count}} heads-ups"` (as `"headsUpCount": "{{count}} heads-ups"`), `"headsUp": { "context": "This task has used {{percent}}% of its context.", "repeated": "You've asked about “{{topic}}” three times. Save it as a decision?", "offPhase": "The last prompts belong to another phase.", "saveDecision": "Save as decision", "finishTask": "Finish task" }`, and in `settings`: `"afterReply": "After the reply"`, `"afterReplyHint": "Points out gaps and suggests a next prompt."`, `"headsUps": "Heads-ups"`, `"headsUpsHint": "Context near full, repeated asks, drifting off the phase. They cost nothing."`.

The head's state reads `t("sidekick.headsUpCount", { count })` when heads-up cards wait and nothing else is going on. A `HeadsUpCard` renders the text for its `headsUp.kind`, the button (`Save as decision` → `onSaveDecision(card.id)`; `Finish task` → `onFinishTask(card.id)`) and Dismiss (`onDismiss(card.id, "dismissed")`). `ChatView` wires `onSaveDecision={(id) => void client.sidekick.saveDecision(id)}` and `onFinishTask={(id) => { void client.sidekick.resolve(id, "used"); void client.finishTask(); }}`. Heads-ups never block and never take focus. `SidekickTab` gets two more checkboxes (`afterReply`, `headsUps`) under the pre-send one.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/ui test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/ui packages/i18n/src/locales/en.json
git -C <worktree> commit -m "feat(ui): Sidekick heads-ups and the moments in Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 9: Learning — the profile update at task close (main)

**Files:**
- Modify: `packages/shell/src/main/sidekick-turns.ts` (`learnPrompt`, `parseLearn`)
- Modify: `packages/shell/src/main/sidekick.ts` (`learn` from `betweenTasks`; learned items in the brief)
- Modify: `packages/workspace/src/sidekick-brief.ts` (already takes `learned`)
- Modify: `packages/shell/src/main/index.ts` (`writeApp` dep)
- Test: `packages/shell/test/sidekick-turns.test.ts`, `packages/shell/test/sidekick-controller.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// sidekick-turns
import { SIDEKICK_LEARN_MARK, learnPrompt, parseLearn } from "../src/main/sidekick-turns";

describe("learning turn (spec §6.4)", () => {
  it("lists the items with ids and the new events", () => {
    const p = learnPrompt({ items: [{ id: "l-1", text: "Takes scope fixes.", level: "you", source: "learned" }], events: [{ kind: "vague", outcome: "used", moment: "pre", sidekick: "sidekick" }] });
    expect(p.startsWith(SIDEKICK_LEARN_MARK)).toBe(true);
    expect(p).toContain("- [l-1] (you) Takes scope fixes.");
    expect(p).toContain("- pre vague → used");
  });

  it("parses add, update and remove", () => {
    expect(parseLearn('{"add":[{"text":"Writes short prompts.","level":"you"}],"update":[{"id":"l-1","text":"Usually takes scope fixes."}],"remove":["l-2"]}')).toEqual({
      add: [{ text: "Writes short prompts.", level: "you" }],
      update: [{ id: "l-1", text: "Usually takes scope fixes." }],
      remove: ["l-2"],
    });
  });
});
```

```ts
// controller
describe("learning at task close (spec §6.4)", () => {
  const ev = (i: number) => ({ at: `2026-10-27T10:0${i}:00Z`, sidekick: "sidekick", moment: "pre" as const, kind: "vague", outcome: "used" as const });

  it("fewer than 5 new events: no turn", async () => {
    const h = harness({ record: on, events: [ev(1), ev(2), ev(3), ev(4)], task: null });
    await h.ctl.betweenTasks();
    expect(h.asked).toEqual([]);
  });

  it("5 or more: one learn turn; the result goes in as the app; person items never change", async () => {
    const person = { id: "l-p", type: "learned" as const, text: "Doesn't want vague suggestions.", level: "you" as const, kind: "vague", source: "person" as const, updatedAt: "2026-10-26T00:00:00Z" };
    const h = harness({
      record: on,
      extra: [person, { id: "l-1", type: "learned", text: "Old.", level: "you", source: "learned", updatedAt: "2026-10-26T00:00:00Z" }],
      events: [ev(1), ev(2), ev(3), ev(4), ev(5)],
      task: null,
      answers: [json({ add: [{ text: "Writes short prompts.", level: "you" }], update: [{ id: "l-1", text: "New." }, { id: "l-p", text: "Hacked." }], remove: ["l-p"] })],
    });
    await h.ctl.betweenTasks();
    expect(h.asked[0]).toContain("Sidekick: learn");
    expect(h.appWrites).toEqual([
      expect.objectContaining({ op: "put", record: expect.objectContaining({ type: "learned", text: "Writes short prompts.", source: "learned" }) }),
      expect.objectContaining({ op: "put", record: expect.objectContaining({ id: "l-1", text: "New." }) }),
    ]);
    expect(h.record()).toMatchObject({ learnedAt: expect.any(String) });
    expect(h.logged.at(-1)).toMatchObject({ moment: "learn" });
  });

  it("the next session's brief carries the learned items", async () => {
    const h = harness({ record: on, extra: [{ id: "l-1", type: "learned", text: "Writes short prompts.", level: "you", source: "learned", updatedAt: "x" }] });
    await h.ctl.review({ text: "make it better" });
    expect(h.briefs[0]).toContain("- Writes short prompts.");
  });
});
```

(`harness()` gains `extra` records returned by `readAll`, and an `appWrites` list fed by a new `writeApp` dep.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-turns sidekick-controller`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export const SIDEKICK_LEARN_MARK = "Sidekick: learn";
export const SIDEKICK_LEARN_MIN = 5;

export function learnPrompt(i: { items: readonly { id: string; text: string; level: string; source: string }[]; events: readonly { kind: string; outcome: string; moment: string; sidekick: string }[] }): string {
  return [
    SIDEKICK_LEARN_MARK,
    "",
    "What you know about the person (ids in brackets; items marked (person) are theirs: never change or remove them):",
    ...(i.items.length ? i.items.map((it) => `- [${it.id}] (${it.source === "person" ? "person" : it.level}) ${it.text}`) : ["- (nothing yet)"]),
    "What they did with your suggestions since then:",
    ...i.events.map((e) => `- ${e.moment} ${e.kind} → ${e.outcome}`),
    "",
    'Answer with the JSON object only: {"add":[{"text":string,"level":"you"|"harness","kind":string?}],"update":[{"id":string,"text":string}],"remove":[string]}. "you": about the person in general; "harness": how they work in this app. One short sentence per item; at most 3 changes.',
  ].join("\n");
}

export const learnSchema = z.object({
  add: z.array(z.object({ text: z.string().min(1).max(300), level: z.enum(["you", "harness"]), kind: z.string().max(40).optional() })).max(3).default([]),
  update: z.array(z.object({ id: z.string(), text: z.string().min(1).max(300) })).max(3).default([]),
  remove: z.array(z.string()).max(3).default([]),
});
export const parseLearn = (text: string) => parseJson(text, learnSchema);
```

(The test's `learnPrompt` line for a learned item prints its level `(you)`; a person item prints `(person)`.)

Controller (deps gain `writeApp(request: unknown): Promise<unknown>` — the `sidekick` store written with `who: "app"`):

```ts
  /** Spec §6.4: at task close, with 5+ new events since the last update, one turn updates the learned items. */
  private async learn(): Promise<void> {
    const settings = await this.d.store.settings();
    if (!settings.on) return;
    const setup = await this.d.setup().catch(() => null);
    if (!setup || !(await this.d.hasNotice(setup.engineId).catch(() => false))) return;
    const since = settings.learnedAt ?? "";
    const events = (await this.d.events.read(setup.base).catch(() => [])).filter((e) => e.at > since);
    if (events.length < SIDEKICK_LEARN_MIN) return;
    const records = await this.d.store.all();
    const items = records.filter((r) => r.type === "learned");
    const engine = this.d.engine(setup.engineId);
    const session = await this.oneOff(setup.base, engine, "learn");
    if (!session) return;
    try {
      const answer = await session.ask(learnPrompt({ items: items.map((r) => ({ id: r.id, text: r.text!, level: r.level!, source: r.source as string })), events }), new AbortController().signal);
      await this.logTurn(setup.base, engine, session, undefined, "learn", answer);
      const result = answer.ok ? parseLearn(answer.text) : null;
      if (!result) return;
      const now = new Date().toISOString();
      const mine = new Set(items.filter((r) => r.source === "learned").map((r) => r.id));
      for (const a of result.add) await this.d.writeApp({ op: "put", collection: SIDEKICK_COLLECTION, record: { id: `l-${randomBytes(4).toString("hex")}`, type: "learned", ...a, source: "learned", updatedAt: now } });
      for (const u of result.update) {
        const old = items.find((r) => r.id === u.id);
        if (old && mine.has(u.id)) await this.d.writeApp({ op: "put", collection: SIDEKICK_COLLECTION, record: { ...old, text: u.text, updatedAt: now } });
      }
      for (const id of result.remove) if (mine.has(id)) await this.d.writeApp({ op: "delete", collection: SIDEKICK_COLLECTION, key: id });
      await this.d.store.set({ learnedAt: now });
    } finally {
      await session.close();
    }
  }
```

`oneOff(base, engine, id)`: a `SidekickSession` in `sidekickWorkDir(userData, base, id)` with the default brief, never stored in `sessions`. `betweenTasks()` ends with `await this.learn().catch((err) => console.error("Sidekick could not learn", err))` when the open task changed (i.e. one just closed) — with no task open. `sessionFor` passes `learned: records.filter((r) => r.type === "learned").map((r) => r.text!)` into `sidekickBrief`, so the brief changes only between tasks (a session opens once per task).

`index.ts`:

```ts
    writeApp: async (request) => {
      const c = await validConfig();
      if (!c) throw new Error("The app is not set up yet");
      const result = await runDataRequest(sidekickStoreFor(baseOf(c)), request, { who: "app", scope: APP_SCOPE });
      await (await currentHistory())?.save(`${DATA_CHANGE_PREFIX}${SIDEKICK_COLLECTION}`).catch((err: unknown) => console.error("Could not record Sidekick's learning", err));
      return result;
    },
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/shell packages/workspace
git -C <worktree> commit -m "feat(shell): Sidekick learns at task close

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 10: UI — "What Sidekick learned"

**Files:**
- Create: `packages/ui/src/sidekick/LearnedList.tsx`
- Modify: `packages/ui/src/sidekick/SidekickTab.tsx`, `packages/ui/src/client.ts` (`client.sidekick.learned`, `forget`, `forgetAll`, `editLearned`), main IPC + preload + controller pass-throughs to the store
- Modify: `packages/i18n/src/locales/en.json` (inside `sidekick`)
- Test: `packages/ui/test/sidekick-learned.test.tsx`, `packages/shell/test/sidekick-ipc.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/ui/test/sidekick-learned.test.tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LearnedList } from "../src/sidekick/LearnedList";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);
const ITEMS = [
  { id: "l-1", text: "Takes scope fixes.", level: "you" as const, source: "learned" as const },
  { id: "l-2", text: "Sections stay under 400 words.", level: "harness" as const, source: "learned" as const },
  { id: "l-3", text: "Doesn't want vague suggestions.", level: "you" as const, source: "person" as const },
];

describe("What Sidekick learned (spec §6.4)", () => {
  it("two columns; Forget this", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickLearned = ITEMS;
    await renderIn("en", <LearnedList client={c} />);
    const you = await screen.findByRole("region", { name: "About you" });
    const here = screen.getByRole("region", { name: "In this app" });
    expect(you.textContent).toContain("Takes scope fixes.");
    expect(here.textContent).toContain("Sections stay under 400 words.");
    fireEvent.click(screen.getAllByRole("button", { name: "Forget this" })[0]);
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["forget", "l-1"]));
  });

  it("Edit opens an editable list; Save sends the changes", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickLearned = ITEMS;
    await renderIn("en", <LearnedList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue("Takes scope fixes."), { target: { value: "Usually takes scope fixes." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["editLearned", [{ id: "l-1", text: "Usually takes scope fixes." }]]));
  });

  it("Forget everything asks once", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickLearned = ITEMS;
    await renderIn("en", <LearnedList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "Forget everything" }));
    expect(c.sidekickCalls).not.toContainEqual(["forgetAll"]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, forget everything" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["forgetAll"]));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-learned`
Expected: FAIL.

- [ ] **Step 3: Implement**

`client.ts`:

```ts
export interface SidekickLearned {
  id: string;
  text: string;
  level: "you" | "harness";
  source: "learned" | "person";
  kind?: string;
}
// client.sidekick gains:
    learned(): Promise<SidekickLearned[]>;
    forget(id: string): Promise<void>;
    forgetAll(): Promise<void>;
    /** Edits from the person: their items become `source: "person"` (learning never changes them again). */
    editLearned(changes: { id: string; text: string }[]): Promise<void>;
```

Main: the controller forwards to the store, **as the person** (`store.put/remove` → `personData`, `Data: sidekick` commits). `forgetAll` deletes every `learned` record (both levels, person items included: the person asked). `editLearned` puts each changed item with the new text, `source: "person"`, `updatedAt: now`. IPC channels `hh:sidekickLearned`, `hh:sidekickForget(id)`, `hh:sidekickForgetAll()`, `hh:sidekickEditLearned(changes)` (an array of at most 50 `{ id: string ≤ 80, text: string 1..300 }`, else ignored). FakeClient: `sidekickLearned: SidekickLearned[] = []` and the four calls recorded in `sidekickCalls`.

Strings: `"learned": { "title": "What Sidekick learned", "you": "About you", "harness": "In this app", "forget": "Forget this", "edit": "Edit", "save": "Save", "cancel": "Cancel", "forgetAll": "Forget everything", "confirmAll": "Yes, forget everything", "confirmAllText": "Sidekick forgets everything it learned, here and about you. This can't be undone from here.", "empty": "Nothing yet.", "yours": "Yours" }`.

```tsx
// packages/ui/src/sidekick/LearnedList.tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SidekickLearned } from "../client";

export function LearnedList({ client }: { client: HarnessClient }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SidekickLearned[]>([]);
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const [confirm, setConfirm] = useState(false);
  const load = () => void client.sidekick.learned().then(setItems, () => setItems([]));
  useEffect(load, [client]);
  const column = (level: "you" | "harness", label: string) => (
    <section aria-label={label} className="hh-sk-learned-col">
      <h4>{label}</h4>
      {items.filter((i) => i.level === level).length === 0 && <p className="hh-caption">{t("sidekick.learned.empty")}</p>}
      <ul>
        {items.filter((i) => i.level === level).map((i) => (
          <li key={i.id}>
            {editing ? (
              <input value={editing[i.id] ?? i.text} aria-label={i.text} onChange={(e) => setEditing({ ...editing, [i.id]: e.target.value })} />
            ) : (
              <>
                <span>{i.text}</span>
                {i.source === "person" && <span className="hh-caption"> · {t("sidekick.learned.yours")}</span>}
                <button type="button" className="hh-link" onClick={() => void client.sidekick.forget(i.id).then(load)}>{t("sidekick.learned.forget")}</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <div className="hh-sk-learned">
      <h3>{t("sidekick.learned.title")}</h3>
      <div className="hh-sk-learned-cols">
        {column("you", t("sidekick.learned.you"))}
        {column("harness", t("sidekick.learned.harness"))}
      </div>
      {editing ? (
        <div className="hh-sk-actions">
          <button
            type="button"
            className="hh-primary"
            onClick={() => {
              const changes = Object.entries(editing).filter(([id, text]) => items.find((i) => i.id === id)?.text !== text && text.trim()).map(([id, text]) => ({ id, text: text.trim() }));
              setEditing(null);
              void client.sidekick.editLearned(changes).then(load);
            }}
          >
            {t("sidekick.learned.save")}
          </button>
          <button type="button" onClick={() => setEditing(null)}>{t("sidekick.learned.cancel")}</button>
        </div>
      ) : (
        <div className="hh-sk-actions">
          <button type="button" onClick={() => setEditing({})} disabled={items.length === 0}>{t("sidekick.learned.edit")}</button>
          {confirm ? (
            <>
              <p>{t("sidekick.learned.confirmAllText")}</p>
              <button type="button" onClick={() => { setConfirm(false); void client.sidekick.forgetAll().then(load); }}>{t("sidekick.learned.confirmAll")}</button>
              <button type="button" onClick={() => setConfirm(false)}>{t("sidekick.learned.cancel")}</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirm(true)} disabled={items.length === 0}>{t("sidekick.learned.forgetAll")}</button>
          )}
        </div>
      )}
    </div>
  );
}
```

`SidekickTab` renders `<LearnedList client={client} />` at the end.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/ui test && corepack pnpm --filter @humanharness/shell test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/ui packages/shell packages/i18n/src/locales/en.json
git -C <worktree> commit -m "feat(ui): What Sidekick learned, with forget and edit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---
### Task 11: Store — sidekick records, the implicit default, and order

**Files:**
- Modify: `packages/shell/src/main/sidekick-store.ts` (`sidekicks`, `saveSidekick`, `removeSidekick`, `reorder`, `scopeRecords`, `setScope`)
- Test: `packages/shell/test/sidekick-store.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// append to packages/shell/test/sidekick-store.test.ts (reuse its in-memory `store(records)` helper; it now takes `readAll`)
import { DEFAULT_SIDEKICK } from "@humanharness/harness-sdk";

describe("sidekick records (spec §2a.1, Decisions 1–2)", () => {
  it("D0: no sidekick records → the implicit default, nothing written", async () => {
    const s = store([]);
    expect(await s.store.sidekicks()).toEqual([DEFAULT_SIDEKICK]);
    expect(s.writes).toEqual([]);
  });

  it("saving a new one writes the default first, then the new one with a slug id and the next order", async () => {
    const s = store([]);
    const saved = await s.store.saveSidekick({ name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" }] });
    expect(saved.id).toBe("rulo");
    expect(s.writes.map((w) => (w as { record: { id: string } }).record.id)).toEqual(["sidekick", "rulo"]);
    expect((await s.store.sidekicks()).map((k) => [k.id, k.order])).toEqual([["sidekick", 0], ["rulo", 1]]);
  });

  it("name clashes get -2, -3", async () => {
    const s = store([{ ...DEFAULT_SIDEKICK, type: "sidekick" }]);
    expect((await s.store.saveSidekick({ name: "Sidekick", mark: "x", personality: "", purposes: [{ id: "mentor" }] })).id).toBe("sidekick-2");
  });

  it("reorder rewrites order 0..n by the given ids", async () => {
    const s = store([{ ...DEFAULT_SIDEKICK, type: "sidekick" }, { id: "rulo", type: "sidekick", name: "Rulo", mark: "x", personality: "", purposes: [{ id: "mentor" }], order: 1 }]);
    await s.store.reorder(["rulo", "sidekick"]);
    expect((await s.store.sidekicks()).map((k) => k.id)).toEqual(["rulo", "sidekick"]);
  });

  it("removing deletes the record, its scope records and its muted kinds; the last one can't go", async () => {
    const s = store([
      { ...DEFAULT_SIDEKICK, type: "sidekick" },
      { id: "rulo", type: "sidekick", name: "Rulo", mark: "x", personality: "", purposes: [{ id: "mentor" }], order: 1 },
      { id: "s-main-rulo", type: "scope", scope: "main", sidekick: "rulo", on: false },
      { id: "settings", type: "settings", muted: { rulo: ["gap"] } },
    ]);
    await s.store.removeSidekick("rulo");
    expect(s.deleted).toEqual(["rulo", "s-main-rulo"]);
    expect(await s.store.settings()).toMatchObject({ muted: {} });
    await expect(s.store.removeSidekick("sidekick")).rejects.toThrow(/at least one/);
  });

  it("scope records: setScope writes s-<scope>-<sidekick>; on by default when absent", async () => {
    const s = store([]);
    await s.store.setScope("main", "sidekick", { on: false, purposeText: "No spec without AC." });
    expect(s.writes.at(-1)).toMatchObject({ op: "put", record: { id: "s-main-sidekick", type: "scope", scope: "main", sidekick: "sidekick", on: false, purposeText: "No spec without AC." } });
    expect(await s.store.scopeFor("main", "rulo")).toEqual({ on: true });
  });
});
```

(Extend the helper: an in-memory `records` array that `readAll` returns and `write` mutates — `put` replaces by id, `delete` removes and pushes the key to `deleted`.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-store`
Expected: FAIL — `sidekicks` is not a function.

- [ ] **Step 3: Implement**

```ts
import { DEFAULT_SIDEKICK, SIDEKICK_COLLECTION, type SidekickDef, type SidekickPurposeDef, type SidekickRecord } from "@humanharness/harness-sdk";

const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "sidekick";

const toDef = (r: SidekickRecord): SidekickDef => ({
  id: r.id,
  name: r.name!,
  mark: r.mark!,
  personality: r.personality ?? "",
  purposes: r.purposes!,
  order: r.order!,
  ...(r.tier ? { tier: r.tier } : {}),
  ...(typeof r.source === "object" ? { source: r.source } : {}),
  ...(r.preset ? { preset: r.preset } : {}),
});

  /** The person's sidekicks by order; the implicit default when none is written (Decision 2). */
  async sidekicks(): Promise<SidekickDef[]> {
    const written = (await this.all()).filter((r) => r.type === "sidekick").map(toDef);
    return written.length ? written.sort((a, b) => a.order - b.order) : [DEFAULT_SIDEKICK];
  }

  private async materialize(): Promise<SidekickDef[]> {
    const written = (await this.all()).some((r) => r.type === "sidekick");
    if (!written) await this.put({ ...DEFAULT_SIDEKICK, type: "sidekick" } as SidekickRecord);
    return this.sidekicks();
  }

  /** New when `id` is absent; otherwise replaces that sidekick's fields. */
  async saveSidekick(s: Omit<SidekickDef, "id" | "order"> & { id?: string; order?: number }): Promise<SidekickDef> {
    const all = await this.materialize();
    const old = s.id ? all.find((k) => k.id === s.id) : undefined;
    let id = old?.id;
    if (!id) {
      const base = slug(s.name);
      id = base;
      for (let n = 2; all.some((k) => k.id === id); n++) id = `${base}-${n}`;
    }
    const def: SidekickDef = { ...s, id, order: old?.order ?? s.order ?? Math.max(-1, ...all.map((k) => k.order)) + 1 };
    await this.put({ ...def, type: "sidekick" } as SidekickRecord);
    return def;
  }

  async reorder(ids: readonly string[]): Promise<void> {
    const all = await this.materialize();
    const rest = all.filter((k) => !ids.includes(k.id));
    const ordered = [...ids.map((id) => all.find((k) => k.id === id)).filter((k): k is SidekickDef => !!k), ...rest];
    for (const [order, k] of ordered.entries()) if (k.order !== order) await this.put({ ...k, order, type: "sidekick" } as SidekickRecord);
  }

  async removeSidekick(id: string): Promise<void> {
    const all = await this.materialize();
    if (all.length <= 1) throw new Error("Keep at least one sidekick");
    await this.remove(id);
    for (const r of await this.all()) if (r.type === "scope" && r.sidekick === id) await this.remove(r.id);
    const s = await this.settings();
    if (s.muted[id]) {
      const { [id]: _drop, ...rest } = s.muted;
      await this.set({ muted: rest });
    }
  }

  /** A sidekick in a scope (spec §2a.4): on unless a record says off; the scope's purpose text and places. */
  async scopeFor(scope: string, sidekick: string): Promise<{ on: boolean; purposeText?: string; places?: string[] }> {
    const r = (await this.all()).find((x) => x.type === "scope" && x.scope === scope && x.sidekick === sidekick);
    return r ? { on: r.on!, ...(r.purposeText ? { purposeText: r.purposeText } : {}), ...(r.places ? { places: r.places } : {}) } : { on: true };
  }

  async setScope(scope: string, sidekick: string, v: { on: boolean; purposeText?: string; places?: string[] }): Promise<void> {
    await this.put({ id: `s-${scope}-${sidekick}`.slice(0, 80), type: "scope", scope, sidekick, ...v } as SidekickRecord);
  }
```

(Every write here goes through the person's path: `Data: sidekick` commits, as part 1.)

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-store`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/shell
git -C <worktree> commit -m "feat(shell): sidekick records, implicit default, order and scope records

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 12: Routing — candidates, the speaker, and the shared cap

**Files:**
- Create: `packages/shell/src/main/sidekick-route.ts`
- Modify: `packages/shell/src/main/sidekick-turns.ts` (`routePrompt`, `parseRoute`)
- Test: `packages/shell/test/sidekick-route.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shell/test/sidekick-route.test.ts
import { DEFAULT_SIDEKICK, type SidekickDef } from "@humanharness/harness-sdk";
import { describe, expect, it, vi } from "vitest";
import { candidates, pickSpeaker } from "../src/main/sidekick-route";

const RULO: SidekickDef = { id: "rulo", name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" }, { id: "process-guard" }], order: 1 };
const on = async () => ({ on: true });

describe("candidates (spec §2a.3)", () => {
  it("only sidekicks on in the scope with a purpose for the moment", async () => {
    const off = async (_s: string, id: string) => ({ on: id !== "rulo" });
    expect((await candidates([DEFAULT_SIDEKICK, RULO], "after-reply", "main", on)).map((k) => k.id)).toEqual(["sidekick", "rulo"]);
    expect((await candidates([DEFAULT_SIDEKICK, RULO], "after-reply", "main", off)).map((k) => k.id)).toEqual(["sidekick"]);
    expect((await candidates([DEFAULT_SIDEKICK, RULO], "phase-change", "main", on)).map((k) => k.id)).toEqual(["rulo"]);
    expect(await candidates([DEFAULT_SIDEKICK], "daily", "main", on)).toEqual([]);
  });

  it("muted kinds don't remove a candidate (they only filter its cards)", async () => {
    expect(await candidates([DEFAULT_SIDEKICK], "pre-send", "main", on)).toHaveLength(1);
  });
});

describe("pickSpeaker (spec §2a.3, D11)", () => {
  it("one candidate: no routing turn", async () => {
    const route = vi.fn();
    expect(await pickSpeaker([DEFAULT_SIDEKICK], "x", route)).toBe(DEFAULT_SIDEKICK);
    expect(route).not.toHaveBeenCalled();
  });

  it("several: free routing first (a local rule by purpose), the person's order on a tie", async () => {
    const route = vi.fn();
    // a heads-up goes to the one with focus; after-reply with prompt-coach and mentor ties → order
    expect((await pickSpeaker([RULO, DEFAULT_SIDEKICK].sort((a, b) => a.order - b.order), "after-reply", route)).id).toBe("sidekick");
    expect(route).not.toHaveBeenCalled();
  });

  it("custom purposes on the same moment: one light routing turn picks; a bad answer falls back to order", async () => {
    const a: SidekickDef = { ...RULO, id: "a", order: 0, purposes: [{ id: "custom", text: "Watch tests.", moments: ["after-reply"] }] };
    const b: SidekickDef = { ...RULO, id: "b", order: 1, purposes: [{ id: "custom", text: "Watch docs.", moments: ["after-reply"] }] };
    expect((await pickSpeaker([a, b], "after-reply", async () => "b")).id).toBe("b");
    expect((await pickSpeaker([a, b], "after-reply", async () => "nobody")).id).toBe("a");
    expect((await pickSpeaker([a, b], "after-reply", async () => { throw new Error("x"); })).id).toBe("a");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-route`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shell/src/main/sidekick-route.ts
import { purposeMoments, speaksAt, type SidekickDef, type SidekickMoment } from "@humanharness/harness-sdk";

/** Sidekicks on in `scope` that have a purpose for `moment` (spec §2a.3), in the person's order. */
export async function candidates(
  all: readonly SidekickDef[],
  moment: SidekickMoment,
  scope: string,
  scopeFor: (scope: string, sidekick: string) => Promise<{ on: boolean }>,
): Promise<SidekickDef[]> {
  const out: SidekickDef[] = [];
  for (const s of [...all].sort((a, b) => a.order - b.order)) {
    if (!speaksAt(s, moment)) continue;
    if (!(await scopeFor(scope, s.id).catch(() => ({ on: true }))).on) continue;
    out.push(s);
  }
  return out;
}

/** Only custom purposes need the model to tell candidates apart; core purposes route by order. */
const customAt = (s: SidekickDef, moment: SidekickMoment) => s.purposes.some((p) => p.id === "custom" && purposeMoments(p).includes(moment));

/**
 * One speaker per moment (D11). Free routing first: when two or more candidates speak at this moment only
 * through custom purposes, one light turn (`route`) picks by their texts; otherwise, and on any failure, the
 * first in the person's order.
 */
export async function pickSpeaker(
  list: readonly SidekickDef[],
  moment: SidekickMoment,
  route: (choices: { id: string; text: string }[]) => Promise<string>,
): Promise<SidekickDef> {
  if (list.length <= 1) return list[0]!;
  const custom = list.filter((s) => customAt(s, moment) && !s.purposes.some((p) => p.id !== "custom" && purposeMoments(p).includes(moment)));
  if (custom.length === list.length) {
    const choices = custom.map((s) => ({ id: s.id, text: s.purposes.filter((p) => p.id === "custom").map((p) => (p as { text: string }).text).join(" ") }));
    const id = await route(choices).catch(() => "");
    const hit = list.find((s) => s.id === id.trim());
    if (hit) return hit;
  }
  return list[0]!;
}
```

`sidekick-turns.ts`:

```ts
export const SIDEKICK_ROUTE_MARK = "Sidekick: route";
export function routePrompt(moment: string, context: string, choices: readonly { id: string; text: string }[]): string {
  return [SIDEKICK_ROUTE_MARK, "", `Moment: ${moment}`, "Context:", context.slice(0, 2000), "Who should speak? Choices:", ...choices.map((c) => `- ${c.id}: ${c.text}`), "", "Answer with the id only."].join("\n");
}
```

The routing turn runs in the controller's one-off `route` session on the **light** tier, its usage logged with `moment: "route"`, and counts against the shared cap like every other Sidekick turn (spec §5: one cap for all sidekicks; `sidekickSpent` already sums every `phase: "sidekick"` line).

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-route`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/shell
git -C <worktree> commit -m "feat(shell): sidekick candidates and speaker routing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 13: One session and one brief per sidekick

**Files:**
- Modify: `packages/workspace/src/sidekick-brief.ts` (`personality`, `purposes`, per-purpose tips)
- Modify: `packages/shell/src/main/sidekick.ts` (`sessions` keyed by sidekick; `speakerFor`; every moment routes)
- Modify: `packages/shell/src/main/index.ts` (controller deps `routeTier`)
- Test: `packages/workspace/test/sidekick-brief.test.ts`, `packages/shell/test/sidekick-controller.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// append to packages/workspace/test/sidekick-brief.test.ts
describe("a brief per sidekick (spec §2a.1)", () => {
  it("names the sidekick, carries its personality and only its purposes' tips", () => {
    const b = sidekickBrief({ ...BASE, sidekick: { name: "Rulo", personality: "Direct, dry humour.", purposes: [{ id: "mentor" }] } });
    expect(b).toContain("You are Rulo");
    expect(b).toContain("Direct, dry humour.");
    expect(b).toContain("## Mentor");
    expect(b).not.toContain("## Prompt coach");
  });

  it("D0: without `sidekick`, the part 1 brief exactly", () => {
    expect(sidekickBrief(BASE)).toBe(PART1_BRIEF_SNAPSHOT);
  });

  it("custom purposes go in as their text", () => {
    expect(sidekickBrief({ ...BASE, sidekick: { name: "A", personality: "", purposes: [{ id: "custom", text: "Watch the tests.", moments: ["after-reply"] }] } })).toContain("Watch the tests.");
  });
});
```

(`BASE` is the file's existing input; `PART1_BRIEF_SNAPSHOT` is `sidekickBrief(BASE)` captured before the change with `toMatchInlineSnapshot()` — run part 1's version once, paste the result.)

```ts
// append to packages/shell/test/sidekick-controller.test.ts
describe("several sidekicks (spec §2a)", () => {
  const RULO = { id: "rulo", type: "sidekick" as const, name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" as const }], order: 1 };
  const DEF = { id: "sidekick", type: "sidekick" as const, name: "Sidekick", mark: "spark", personality: "", purposes: [{ id: "prompt-coach" as const }, { id: "focus" as const }], order: 0 };

  it("pre-send: only Sidekick speaks (Rulo has no pre-send purpose); one session", async () => {
    const h = harness({ record: on, extra: [DEF, RULO] });
    const r = await h.ctl.review({ text: "make it better" });
    expect(r.kind === "card" && r.card.speaker).toEqual({ id: "sidekick", name: "Sidekick", mark: "spark" });
    expect(h.sessions).toEqual(["sidekick"]);
  });

  it("after-reply with two candidates: one speaker by order, the other's session never opens", async () => {
    const h = harness({ record: on, extra: [{ ...RULO, order: 0 }, { ...DEF, order: 1 }], answers: [json({ next: "Ask for the sources" })] });
    await h.ctl.afterReply({ task: { id: "t1", scope: "main" }, kind: "run", ok: true, prompt: "p", reply: "r", fromBlock: false });
    expect((await h.ctl.state()).cards[0]?.speaker.id).toBe("rulo");
    expect(h.sessions).toEqual(["rulo"]);
    expect(h.briefs[0]).toContain("You are Rulo");
  });

  it("a sidekick off in the scope never speaks there", async () => {
    const h = harness({ record: on, extra: [{ ...DEF, purposes: [{ id: "focus" as const }] }, RULO, { id: "s-main-rulo", type: "scope", scope: "main", sidekick: "rulo", on: false }] });
    await h.ctl.afterReply({ task: { id: "t1", scope: "main" }, kind: "run", ok: true, prompt: "p", reply: "r", fromBlock: false });
    expect(h.asked).toEqual([]);
  });

  it("the cap is shared", async () => {
    const h = harness({ record: { ...on, cap: 5000 }, extra: [DEF, RULO], spent: 5000 });
    expect(await h.ctl.review({ text: "make it better" })).toMatchObject({ kind: "send" });
  });
});
```

(The `harness()` helper records each opened session's sidekick id in `sessions` — the `session` factory dep gains the sidekick id — and takes `spent`.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/workspace test -- sidekick-brief && corepack pnpm --filter @humanharness/shell test -- sidekick-controller`
Expected: FAIL.

- [ ] **Step 3: Implement**

`sidekick-brief.ts` — the input gains `sidekick?: { name: string; personality: string; purposes: SidekickPurposeDef[] }`. When present: the first line becomes `You are ${name}, a sidekick in ${harness.name}. You never act; you only suggest.` and then, if `personality`, a `## Personality` section with it; the tips section is built per purpose:

```ts
const PURPOSE_TIPS: Record<string, { title: string; lines: string[] }> = {
  "prompt-coach": { title: "Prompt coach", lines: ["Before a send: one ask per prompt, scope named, done defined.", "After a reply: gaps and the next prompt."] },
  focus: { title: "Focus", lines: ["Say when the task drifts off its phase, repeats an ask, or nears its context limit."] },
  "process-guard": { title: "Process guard", lines: ["Before a phase change or an approval: what the phase promised and isn't there yet."] },
  mentor: { title: "Mentor", lines: ["After a reply: one thing worth learning from it, briefly, in the person's words."] },
  "daily-summary": { title: "Daily summary", lines: ["Once a day: what got done yesterday, what's open, what it cost."] },
};
```

`custom` purposes render as `## Your purpose` with their `text`. Without `sidekick`, the output is byte-for-byte part 1's (the snapshot test).

Controller:
- `sessions: Map<string, { task: string; session: SidekickSession }>` keyed by sidekick id (part 1 had one); `sessionFor(base, engine, taskId, adopt, speaker)` opens it in `sidekickWorkDir(userData, base, speaker.id)` with the speaker's brief (learned items, personality, purposes) and tier (`speaker.tier ?? profile tier`).
- `speakerFor(moment, scope, context): Promise<SidekickInfo & { def: SidekickDef } | null>`: `const list = await candidates(await store.sidekicks(), moment, scope, (s, id) => store.scopeFor(s, id))`; `null` when empty; else `pickSpeaker(list, moment, (choices) => this.routeTurn(moment, context, choices))`. `info()` from Task 5 becomes the speaker's `{ id, name, mark }`.
- `review` uses `speakerFor("pre-send", …)` (with no candidate: `{ kind: "send" }`); `afterReply` uses `"after-reply"`; heads-ups `"heads-up"`.
- `betweenTasks` closes every session of the old task.
- `muted`, thresholds and `why` read by the speaker's id.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/workspace test && corepack pnpm --filter @humanharness/shell test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/workspace packages/shell
git -C <worktree> commit -m "feat(shell): one session and brief per sidekick, routed per moment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 14: Scope purpose text in every turn's context

**Files:**
- Modify: `packages/shell/src/main/sidekick-turns.ts` (`preSendPrompt` takes `purposeText?`)
- Modify: `packages/shell/src/main/sidekick.ts`
- Test: `packages/shell/test/sidekick-turns.test.ts`, `packages/shell/test/sidekick-controller.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// sidekick-turns
it("pre-send carries the scope's purpose text when given (spec §2a.4)", () => {
  expect(preSendPrompt({ ...PRE_INPUT, purposeText: "No spec without AC." })).toContain("Scope purpose: No spec without AC.");
  expect(preSendPrompt(PRE_INPUT)).not.toContain("Scope purpose");
});
```

```ts
// controller
it("the open scope's purpose text reaches the speaker's turn, never the brief", async () => {
  const h = harness({ record: on, extra: [{ id: "s-main-sidekick", type: "scope", scope: "main", sidekick: "sidekick", on: true, purposeText: "No spec without AC." }] });
  await h.ctl.review({ text: "make it better" });
  expect(h.asked[0]).toContain("Scope purpose: No spec without AC.");
  expect(h.briefs[0]).not.toContain("No spec without AC.");
});
```

(`PRE_INPUT` is the file's existing pre-send input fixture.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-turns sidekick-controller`
Expected: FAIL.

- [ ] **Step 3: Implement**

`PreSendInput` gains `purposeText?: string`; `preSendPrompt` adds `...(i.purposeText ? [`Scope purpose: ${i.purposeText}`] : [])` right after the phase line (same place as `afterReplyPrompt`). The controller reads `(await store.scopeFor(task.scope, speaker.id)).purposeText` for every turn (pre-send, after-reply, before-approve, phase-change, place) and passes it. It goes in each turn, not in the brief: the brief lives in the sidekick's folder, which every scope shares, so keeping scope text out of it keeps the folder scope-free.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
corepack pnpm typecheck
git -C <worktree> add packages/shell
git -C <worktree> commit -m "feat(shell): scope purpose text in sidekick turns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 15: Purposes at work — process-guard at phase change, mentor after the reply

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts` (`TaskDeps.phaseMoved?`, called from `movePhase`)
- Modify: `packages/shell/src/main/sidekick-turns.ts` (`phaseChangePrompt`, `guardSchema`, `parseGuard`; `afterReplyPrompt` takes `purposes`)
- Modify: `packages/shell/src/main/sidekick.ts` (`phaseMoved`)
- Modify: `packages/shell/src/main/index.ts` (one deps line)
- Test: `packages/shell/test/task-manager-phases.test.ts`, `packages/shell/test/sidekick-turns.test.ts`, `packages/shell/test/sidekick-controller.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// append to packages/shell/test/task-manager-phases.test.ts (reuse its setup(); the action has phases "warmup" → "main")
describe("phaseMoved hook (sidekick spec §2a.2)", () => {
  it("is called with the phase left and the phase entered", async () => {
    const moved: unknown[] = [];
    const t = setup({ deps: { phaseMoved: (e) => void moved.push(e) } });
    await t.manager.start("session");
    await t.manager.nextPhase();
    expect(moved).toEqual([expect.objectContaining({ from: "warmup", to: "main", task: expect.objectContaining({ id: expect.any(String) }) })]);
  });

  it("D0: no hook, same moves", async () => {
    const t = setup();
    await t.manager.start("session");
    await t.manager.nextPhase();
    expect((await t.manager.runningTask())?.phase?.id).toBe("main");
  });
});
```

(Use whichever public call moves the phase in that file — `nextPhase`, or the phase block answer the existing tests use; the hook sits inside the private `movePhase`, so every path reaches it.)

```ts
// sidekick-turns
import { SIDEKICK_PHASE_MARK, parseGuard, phaseChangePrompt } from "../src/main/sidekick-turns";

it("phase change prompt: the phase left with its brief, the one entered, the last prompts", () => {
  const p = phaseChangePrompt({ harness: { name: "Essay Coach" }, from: { label: "Outline", brief: "Agree on sections." }, to: { label: "Draft" }, lastPrompts: ["a", "b"], uiLanguage: "English" });
  expect(p.startsWith(SIDEKICK_PHASE_MARK)).toBe(true);
  expect(p).toContain("Leaving: Outline — Agree on sections.");
  expect(p).toContain("Entering: Draft");
  expect(parseGuard('{"missing":["No agreed section list"]}')).toEqual({ missing: ["No agreed section list"] });
  expect(parseGuard("{}")).toEqual({ missing: [] });
});

it("after-reply asks for a lesson when the speaker is a mentor", () => {
  expect(afterReplyPrompt({ ...AFTER_INPUT, purposes: ["mentor"] })).toContain('"lesson":string?');
  expect(afterReplyPrompt(AFTER_INPUT)).not.toContain("lesson");
});
```

```ts
// controller
describe("phase change (spec §2a.2 process-guard)", () => {
  const GUARD = { id: "guard", type: "sidekick" as const, name: "Guard", mark: "🛡️", personality: "", purposes: [{ id: "process-guard" as const }], order: 1 };
  const phases = [{ id: "outline", label: "Outline", brief: "Agree on sections." }, { id: "draft", label: "Draft" }];

  it("a guard speaks with what the phase left missing", async () => {
    const h = harness({ record: on, extra: [GUARD], phases, answers: [json({ missing: ["No agreed section list"] })] });
    await h.ctl.phaseMoved({ task: { id: "t1", scope: "main", action: "essay" }, from: "outline", to: "draft" });
    expect((await h.ctl.state()).cards).toEqual([expect.objectContaining({ moment: "phase-change", kind: "missing", speaker: expect.objectContaining({ id: "guard" }), guard: { missing: ["No agreed section list"] } })]);
  });

  it("D0: no process-guard sidekick → no turn", async () => {
    const h = harness({ record: on, phases });
    await h.ctl.phaseMoved({ task: { id: "t1", scope: "main", action: "essay" }, from: "outline", to: "draft" });
    expect(h.asked).toEqual([]);
  });
});
```

(`AFTER_INPUT` is the Task 5 test's input as a constant.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- task-manager-phases sidekick-turns sidekick-controller`
Expected: FAIL.

- [ ] **Step 3: Implement**

`task-manager.ts`:

```ts
  /** A task's phase moved (sidekick spec §2a.2 "phase-change"). Never awaited. Absent: nothing (D0). */
  phaseMoved?(e: { task: { id: string; action?: string; scope: string }; from: string; to: string }): void;
```

At the end of `movePhase`, after the phase is written: `try { this.d.phaseMoved?.({ task: { id: task.id, ...(task.action ? { action: task.action } : {}), scope: scopeOfTask(task) }, from, to }); } catch (err) { console.error("Sidekick's phase hook failed", err); }`.

`sidekick-turns.ts`:

```ts
export const SIDEKICK_PHASE_MARK = "Sidekick: phase change";
export function phaseChangePrompt(i: { harness: { name: string }; from: { label: string; brief?: string }; to: { label: string }; lastPrompts: readonly string[]; uiLanguage: string; purposeText?: string }): string {
  return [
    SIDEKICK_PHASE_MARK,
    "",
    `App: ${i.harness.name}`,
    `Leaving: ${i.from.label}${i.from.brief ? ` — ${i.from.brief.split("\n")[0]}` : ""}`,
    `Entering: ${i.to.label}`,
    ...(i.purposeText ? [`Scope purpose: ${i.purposeText}`] : []),
    "Prompts in the phase left (first lines):",
    ...i.lastPrompts.slice(-5).map((p) => `- ${p.split("\n")[0]}`),
    `UI language: ${i.uiLanguage}`,
    "",
    'Answer with the JSON object only: {"missing":[string]} — what the phase left promised and the prompts never reached; [] when nothing.',
  ].join("\n");
}
export const guardSchema = z.object({ missing: z.array(z.string().min(1).max(200)).max(5).default([]) });
export const parseGuard = (t: string) => parseJson(t, guardSchema);
```

`AfterInput` gains `purposes?: string[]`; when it includes `"mentor"`, the answer line reads `{"gap":…?,"next":string?,"repeated":…?,"lesson":string?}` plus "lesson: one thing worth learning from this reply, in a sentence." `afterSchema` gains `lesson: z.string().min(1).max(300).optional()`; the after card renders it under "Worth knowing" (string `"sidekick.after.lesson": "Worth knowing"` — Task 24 renders it).

Controller: `SidekickCard` gains `guard?: { missing: string[] }`. `phaseMoved(e)`: Sidekick on; `speakerFor("phase-change", scope, …)`; null → return; cap check; one turn in the speaker's session with `phaseChangePrompt`; usage `moment: "phase-change"`; a card `{ moment: "phase-change", kind: "missing" }` only when `missing.length`. `index.ts`: `phaseMoved: (e) => void sidekickCtl?.phaseMoved(e).catch((err: unknown) => console.error("Sidekick's phase turn failed", err)),`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/shell
git -C <worktree> commit -m "feat(shell): process-guard at phase change, mentor lessons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 16: The daily summary

**Files:**
- Modify: `packages/shell/src/main/sidekick-turns.ts` (`dailyPrompt`)
- Modify: `packages/shell/src/main/sidekick.ts` (`daily(now)`)
- Modify: `packages/shell/src/main/index.ts` (call from `whenReady`; `dailyInput` dep)
- Test: `packages/shell/test/sidekick-turns.test.ts`, `packages/shell/test/sidekick-controller.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// sidekick-turns
import { SIDEKICK_DAILY_MARK, dailyPrompt } from "../src/main/sidekick-turns";
it("daily prompt: titles only, tokens, no bodies", () => {
  const p = dailyPrompt({ harness: { name: "Essay Coach" }, day: "2026-10-26", notes: ["Outline chapter 2", "Sources"], tokens: { tasks: 120_000, sidekick: 9_000 }, open: ["Draft chapter 3"], uiLanguage: "English" });
  expect(p.startsWith(SIDEKICK_DAILY_MARK)).toBe(true);
  expect(p).toContain("- Outline chapter 2");
  expect(p).toContain("Tokens: tasks 120000, Sidekick 9000");
});
```

```ts
// controller
describe("daily (spec §2a.2 daily-summary, Decision 12)", () => {
  const DAILY = { id: "day", type: "sidekick" as const, name: "Day", mark: "☀️", personality: "", purposes: [{ id: "daily-summary" as const }], order: 1 };
  const input = { day: "2026-10-26", notes: ["Outline"], tokens: { tasks: 1, sidekick: 1 }, open: [] };

  it("once per local day: a card, and lastDaily set", async () => {
    const h = harness({ record: on, extra: [DAILY], dailyInput: input, answers: ["Yesterday you outlined chapter 2."] });
    await h.ctl.daily(new Date("2026-10-27T08:00:00"));
    await h.ctl.daily(new Date("2026-10-27T15:00:00"));
    expect(h.asked).toHaveLength(1);
    expect((await h.ctl.state()).cards).toEqual([expect.objectContaining({ moment: "daily", kind: "daily", text: "Yesterday you outlined chapter 2." })]);
    expect(h.record()).toMatchObject({ lastDaily: "2026-10-27" });
  });

  it("D0: no daily-summary sidekick, or Sidekick off → nothing", async () => {
    for (const h of [harness({ record: on, dailyInput: input }), harness({ extra: [DAILY], dailyInput: input })]) {
      await h.ctl.daily(new Date("2026-10-27T08:00:00"));
      expect(h.asked).toEqual([]);
    }
  });

  it("nothing happened yesterday → no turn", async () => {
    const h = harness({ record: on, extra: [DAILY], dailyInput: { ...input, notes: [], tokens: { tasks: 0, sidekick: 0 } } });
    await h.ctl.daily(new Date("2026-10-27T08:00:00"));
    expect(h.asked).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-turns sidekick-controller`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export const SIDEKICK_DAILY_MARK = "Sidekick: daily summary";
export interface DailyInput { day: string; notes: string[]; tokens: { tasks: number; sidekick: number }; open: string[] }
export function dailyPrompt(i: DailyInput & { harness: { name: string }; uiLanguage: string }): string {
  return [
    SIDEKICK_DAILY_MARK,
    "",
    `App: ${i.harness.name}`,
    `Day: ${i.day}`,
    "Notes written that day:",
    ...(i.notes.length ? i.notes.map((n) => `- ${n}`) : ["- (none)"]),
    "Still open:",
    ...(i.open.length ? i.open.map((n) => `- ${n}`) : ["- (none)"]),
    `Tokens: tasks ${i.tokens.tasks}, Sidekick ${i.tokens.sidekick}`,
    `UI language: ${i.uiLanguage}`,
    "",
    "Answer in at most 4 short sentences, plain text: what got done, what's open, one suggestion for today.",
  ].join("\n");
}
```

Controller (deps gain `dailyInput(base: string, day: string): Promise<DailyInput>`; `SidekickCard` gains `text?: string`):

```ts
  async daily(now: Date = new Date()): Promise<void> {
    const settings = await this.d.store.settings();
    if (this.closed || !settings.on) return;
    const today = localDay(now);
    if (settings.lastDaily === today) return;
    const speaker = await this.speakerFor("daily", APP_SCOPE, "daily");
    if (!speaker) return;
    const setup = await this.d.setup().catch(() => null);
    if (!setup || !(await this.d.hasNotice(setup.engineId).catch(() => false))) return;
    await this.d.store.set({ lastDaily: today });
    const input = await this.d.dailyInput(setup.base, localDay(new Date(now.getTime() - 86_400_000))).catch(() => null);
    if (!input || (input.notes.length === 0 && input.tokens.tasks === 0)) return;
    if (await this.pastCap(setup.base, "daily", settings)) return;
    const engine = this.d.engine(setup.engineId);
    const session = await this.oneOff(setup.base, engine, speaker.id, speaker.def);
    if (!session) return;
    try {
      const answer = await session.ask(dailyPrompt({ ...input, harness: this.d.harness, uiLanguage: await this.d.uiLanguage().catch(() => "English") }), new AbortController().signal);
      await this.logTurn(setup.base, engine, session, undefined, "daily", answer);
      if (!answer.ok || !answer.text.trim()) return;
      this.cards.push({ id: randomUUID(), moment: "daily", kind: "daily", speaker: { id: speaker.id, name: speaker.name, mark: speaker.mark }, prompt: "", flags: [], issues: [], confidence: 1, text: answer.text.trim().slice(0, 1200), at: now.toISOString() });
      await this.push();
    } finally {
      await session.close();
    }
  }

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
```

(`lastDaily` is set before the turn so a crash never repeats it. Daily cards are app-wide: `betweenTasks` keeps cards with `moment: "daily"`.) The `scope` for daily routing is `APP_SCOPE` (scope records never switch daily off; a sidekick with `daily-summary` is the switch).

`index.ts`:

```ts
    dailyInput: async (base, day) => {
      const notes = (await readNotes(base).catch(() => [])).filter((n) => n.meta.date.startsWith(day)).map((n) => n.note.title);
      const usage = await readUsage(base).catch(() => []);
      const ofDay = usage.filter((u) => u.at.startsWith(day));
      const sum = (xs: typeof usage) => xs.reduce((a, u) => a + u.input + u.output, 0);
      const open = (await tasks.openTitles().catch(() => [])) as string[];
      return { day, notes, tokens: { tasks: sum(ofDay.filter((u) => u.phase !== "sidekick")), sidekick: sum(ofDay.filter((u) => u.phase === "sidekick")) }, open };
    },
```

(Check the exact names: `readNotes`'s entry shape in `packages/workspace/src/notes.ts`, the usage reader and line fields in `packages/workspace/src/usage.ts`. If `TaskManager` has no list of open task titles, pass `open: []` — Open question 7.) In `whenReady`, after the controller is built and the window loads: `void sidekickCtl?.daily().catch((err: unknown) => console.error("Sidekick's daily card failed", err));`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/shell
git -C <worktree> commit -m "feat(shell): Sidekick daily summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 17: Before approve — the controller, IPC and client call

**Files:**
- Modify: `packages/shell/src/main/sidekick-turns.ts` (`approvePrompt`)
- Modify: `packages/shell/src/main/sidekick.ts` (`beforeApprove`)
- Modify: `packages/shell/src/main/sidekick-ipc.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`
- Test: `packages/shell/test/sidekick-controller.test.ts`, `packages/shell/test/sidekick-ipc.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// controller
describe("before approve (spec §2a.2, Decision 10)", () => {
  const GUARD = { id: "guard", type: "sidekick" as const, name: "Guard", mark: "🛡️", personality: "", purposes: [{ id: "process-guard" as const }], order: 1 };

  it("returns what's missing and leaves a card; approval itself is never blocked", async () => {
    const h = harness({ record: on, extra: [GUARD], answers: [json({ missing: ["No acceptance criteria"] })] });
    const r = await h.ctl.beforeApprove({ title: "Spec: login", text: "# Login\nUsers sign in." });
    expect(r).toEqual({ kind: "card", card: expect.objectContaining({ moment: "before-approve", guard: { missing: ["No acceptance criteria"] } }) });
  });

  it("nothing missing, no guard, Sidekick off, or past the wait: approve", async () => {
    expect(await harness({ record: on, extra: [GUARD], answers: [json({ missing: [] })] }).ctl.beforeApprove({ title: "x", text: "y" })).toEqual({ kind: "approve" });
    expect(await harness({ record: on }).ctl.beforeApprove({ title: "x", text: "y" })).toEqual({ kind: "approve" });
    expect(await harness({ extra: [GUARD] }).ctl.beforeApprove({ title: "x", text: "y" })).toEqual({ kind: "approve" });
  });

  it("the document is cut like a reply", async () => {
    const h = harness({ record: on, extra: [GUARD], answers: [json({ missing: [] })] });
    await h.ctl.beforeApprove({ title: "x", text: "# A\n" + "a ".repeat(20000) });
    expect(h.asked[0]!.length).toBeLessThan(12000);
  });
});
```

```ts
// ipc
it("hh:sidekickBeforeApprove ignores bad input", async () => {
  const { invoke, ctl } = ipcHarness();
  expect(await invoke("hh:sidekickBeforeApprove", { title: 1 })).toEqual({ kind: "approve" });
  expect(ctl.beforeApprove).not.toHaveBeenCalled();
});
```

(`ipcHarness()` is the part 1 test helper for `sidekick-ipc.ts`.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-controller sidekick-ipc`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export const SIDEKICK_APPROVE_MARK = "Sidekick: before approve";
export function approvePrompt(i: { harness: { name: string }; title: string; text: string; phase?: { label: string; brief?: string }; uiLanguage: string; purposeText?: string }): string {
  return [
    SIDEKICK_APPROVE_MARK,
    "",
    `App: ${i.harness.name}`,
    ...(i.phase ? [`Open phase: ${i.phase.label}${i.phase.brief ? ` — ${i.phase.brief.split("\n")[0]}` : ""}`] : []),
    ...(i.purposeText ? [`Scope purpose: ${i.purposeText}`] : []),
    `UI language: ${i.uiLanguage}`,
    `<document title="${i.title.replace(/"/g, "'")}">`,
    cutReply(i.text),
    "</document>",
    "",
    'The person is about to approve this document. Answer with the JSON object only: {"missing":[string]} — what it lacks against the phase and the scope purpose; [] when it is fine.',
  ].join("\n");
}
```

Controller `beforeApprove({ title, text }): Promise<{ kind: "approve" } | { kind: "card"; card: SidekickCard }>`: Sidekick on; `speakerFor("before-approve", task scope)`; null → approve; cap → approve; the turn races the person's wait setting like pre-send (part 1's `wait` logic, factored into `withWait(ms, fn)`); timeout → approve plus a `timeout` event; `missing.length` → card (pushed to `cards` too). IPC `hh:sidekickBeforeApprove({ title: string ≤ 200, text: string ≤ 200_000 })`. `client.sidekick.beforeApprove(doc: { title: string; text: string }): Promise<{ kind: "approve" } | { kind: "card"; card: SidekickCard }>` with a doc comment: "For the document-review flow: call before approving; on a card, show it next to Approve (approve anyway stays possible)." FakeClient returns `{ kind: "approve" }` unless `sidekickApprove` is set.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test && corepack pnpm --filter @humanharness/ui test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/shell packages/ui
git -C <worktree> commit -m "feat(shell): Sidekick before-approve check for documents

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 18: Harness places — `client.sidekick.ask`

**Files:**
- Modify: `packages/shell/src/main/sidekick-turns.ts` (`placePrompt`)
- Modify: `packages/shell/src/main/sidekick.ts` (`ask`)
- Modify: `packages/shell/src/main/sidekick-ipc.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`
- Modify: `packages/ui/src/harness-client.ts` (or wherever the harness UI's client is narrowed in part 1 Task 9) — expose `sidekick.ask` only
- Test: `packages/shell/test/sidekick-controller.test.ts`, `packages/shell/test/sidekick-ipc.test.ts`, `packages/ui/test/harness-client.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// controller
describe("places (spec §2a.5, Decision 13)", () => {
  const WATCH = { id: "watch", type: "sidekick" as const, name: "Watch", mark: "👀", personality: "", purposes: [{ id: "custom" as const, text: "Explain terminal output.", moments: ["place:terminal"] }], order: 1 };
  const harnessDef = { name: "Dev", sidekick: { places: [{ id: "terminal", label: "Terminal", description: "Agent output." }] } };

  it("a sidekick with that place answers in free text", async () => {
    const h = harness({ record: on, extra: [WATCH], harnessDef, answers: ["That error means the port is busy."] });
    expect(await h.ctl.ask("terminal", "EADDRINUSE :3000")).toEqual({ ok: true, text: "That error means the port is busy.", speaker: { id: "watch", name: "Watch", mark: "👀" } });
    expect(h.logged.at(-1)).toMatchObject({ moment: "place:terminal" });
  });

  it("unknown place, no sidekick there, off in the scope, Sidekick off: not ok, no turn", async () => {
    const cases = [
      harness({ record: on, extra: [WATCH], harnessDef }).ctl.ask("nope", "x"),
      harness({ record: on, harnessDef }).ctl.ask("terminal", "x"),
      harness({ record: on, extra: [WATCH, { id: "s-main-watch", type: "scope", scope: "main", sidekick: "watch", on: false }], harnessDef }).ctl.ask("terminal", "x"),
      harness({ extra: [WATCH], harnessDef }).ctl.ask("terminal", "x"),
    ];
    for (const r of await Promise.all(cases)) expect(r).toEqual({ ok: false });
  });

  it("answers are cut to 600 characters", async () => {
    const h = harness({ record: on, extra: [WATCH], harnessDef, answers: ["x".repeat(900)] });
    const r = await h.ctl.ask("terminal", "y");
    expect(r.ok && r.text.length).toBe(600);
  });
});
```

```ts
// harness-client: the harness UI sees sidekick.ask and nothing else of client.sidekick
it("harness UI gets sidekick.ask only", () => {
  const c = harnessClientFor(new FakeClient({ language: "en" }));
  expect(Object.keys(c.sidekick)).toEqual(["ask"]);
});
```

(Use the existing narrowing function's name from part 1 Task 9; `harnessClientFor` stands for it.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-controller && corepack pnpm --filter @humanharness/ui test -- harness-client`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export const SIDEKICK_PLACE_MARK = "Sidekick: place";
export function placePrompt(i: { place: { label: string; description: string }; content: string; uiLanguage: string; purposeText?: string }): string {
  return [SIDEKICK_PLACE_MARK, "", `Place: ${i.place.label} — ${i.place.description}`, ...(i.purposeText ? [`Scope purpose: ${i.purposeText}`] : []), `UI language: ${i.uiLanguage}`, "<content>", i.content.slice(0, 16_000), "</content>", "", "Answer in plain text, at most 3 short sentences."].join("\n");
}
```

Controller `ask(place: string, content: string): Promise<{ ok: true; text: string; speaker: SidekickInfo } | { ok: false }>`: Sidekick on; the place must be in `this.d.harness.sidekick?.places`; the scope is the open task's or `APP_SCOPE`; a candidate must have `place:<id>` and, when its scope record lists `places`, include it; `speakerFor(`place:${place}`, …)`; cap; one turn in the speaker's session (the open task's, or a one-off when no task is open) with `placePrompt`; usage `moment: `place:${place}``; `text: answer.text.trim().slice(0, 600)`. Never a card: the harness shows the answer in its place.

IPC `hh:sidekickAsk(place: string matching /^[a-z][a-z0-9_-]{0,63}$/, content: string ≤ 64_000)` → `{ ok: false }` on bad input. The harness UI's client gets `sidekick: { ask: (place, content) => client.sidekick.ask(place, content) }` — nothing else from `client.sidekick` (D0: harness UIs without places never call it). Add to `docs/architecture/sidekick.md` in Task 27.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test && corepack pnpm --filter @humanharness/ui test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/shell packages/ui
git -C <worktree> commit -m "feat(shell): harness places and client.sidekick.ask

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---
### Task 19: Presets — "Suggested by the harness"

**Files:**
- Modify: `packages/shell/src/main/sidekick.ts` (`presets`, `adoptPreset`), `packages/shell/src/main/sidekick-ipc.ts`, `packages/shell/src/preload/index.ts`
- Modify: `packages/ui/src/client.ts` (`SidekickPreset`, `client.sidekick.presets`, `adoptPreset`), `packages/ui/test/fake-client.ts`
- Create: `packages/ui/src/sidekick/PresetOffer.tsx`
- Modify: `packages/i18n/src/locales/en.json` (inside `sidekick`)
- Test: `packages/shell/test/sidekick-controller.test.ts`, `packages/ui/test/sidekick-presets.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
// controller
describe("presets (spec §2a.7)", () => {
  const harnessDef = { name: "Dev", sidekick: { presets: [{ name: "Guard", mark: "🛡️", personality: "Calm.", purposes: [{ id: "process-guard" as const }] }] } };

  it("lists the harness's presets with whether each is adopted", async () => {
    const h = harness({ record: on, harnessDef });
    expect(await h.ctl.presets()).toEqual([{ name: "Guard", mark: "🛡️", personality: "Calm.", purposes: [{ id: "process-guard" }], adopted: false }]);
  });

  it("adopting writes a sidekick with `preset`, and marks presets offered", async () => {
    const h = harness({ record: on, harnessDef });
    await h.ctl.adoptPreset("Guard");
    expect(h.records()).toContainEqual(expect.objectContaining({ type: "sidekick", name: "Guard", preset: "Guard" }));
    expect(h.record()).toMatchObject({ presetsOffered: true });
    expect((await h.ctl.presets())[0]?.adopted).toBe(true);
  });

  it("D0: a harness without presets → []", async () => {
    expect(await harness({ record: on }).ctl.presets()).toEqual([]);
  });
});
```

```tsx
// packages/ui/test/sidekick-presets.test.tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PresetOffer } from "../src/sidekick/PresetOffer";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

it("offers the presets once; Add adopts; Not now marks them offered", async () => {
  const c = new FakeClient({ language: "en" });
  c.sidekickPresets = [{ name: "Guard", mark: "🛡️", personality: "Calm.", purposes: [{ id: "process-guard" }], adopted: false }];
  await renderIn("en", <PresetOffer client={c} />);
  expect(await screen.findByRole("region", { name: "Suggested by the harness" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Add Guard" }));
  await waitFor(() => expect(c.sidekickCalls).toContainEqual(["adoptPreset", "Guard"]));
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { presetsOffered: true }]));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-controller && corepack pnpm --filter @humanharness/ui test -- sidekick-presets`
Expected: FAIL.

- [ ] **Step 3: Implement**

`client.ts`:

```ts
export interface SidekickPurposeView { id: string; text?: string; moments?: string[] }
export interface SidekickPreset { name: string; mark: string; personality: string; purposes: SidekickPurposeView[]; adopted: boolean }
// client.sidekick gains:
    presets(): Promise<SidekickPreset[]>;
    adoptPreset(name: string): Promise<void>;
```

Controller: `presets()` maps `this.d.harness.sidekick?.presets ?? []` with `adopted: sidekicks.some((s) => s.preset === p.name)`. `adoptPreset(name)`: the preset must exist and not be adopted; `store.saveSidekick({ name, mark, personality, purposes, preset: name })`; `store.set({ presetsOffered: true })`; push the state. IPC `hh:sidekickPresets`, `hh:sidekickAdoptPreset(name: string ≤ 40)`.

`PresetOffer` (shown at the top of Settings › Sidekicks — Task 22 — while `settings.presetsOffered` is false and at least one preset isn't adopted; nowhere else, so harnesses without presets show nothing):

```tsx
export function PresetOffer({ client, onDone }: { client: HarnessClient; onDone?: () => void }) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<SidekickPreset[]>([]);
  useEffect(() => void client.sidekick.presets().then(setPresets, () => setPresets([])), [client]);
  const open = presets.filter((p) => !p.adopted);
  if (open.length === 0) return null;
  return (
    <section aria-label={t("sidekick.presets.title")} className="hh-sk-presets">
      <h3>{t("sidekick.presets.title")}</h3>
      <ul>
        {open.map((p) => (
          <li key={p.name}>
            <SidekickMark mark={p.mark} />
            <strong>{p.name}</strong>
            {p.personality && <p className="hh-caption">{p.personality}</p>}
            <button type="button" onClick={() => void client.sidekick.adoptPreset(p.name).then(() => client.sidekick.presets().then(setPresets))}>
              {t("sidekick.presets.add", { name: p.name })}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="hh-link" onClick={() => void client.sidekick.set({ presetsOffered: true }).then(onDone)}>{t("sidekick.presets.notNow")}</button>
    </section>
  );
}
```

(`SidekickMark` from part 1 takes `mark`: `"spark"` draws the SVG, anything else renders as text — extend it here if part 1's version takes no prop.) Strings: `"presets": { "title": "Suggested by the harness", "add": "Add {{name}}", "notNow": "Not now" }`. FakeClient: `sidekickPresets: SidekickPreset[] = []`, both calls recorded.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test && corepack pnpm --filter @humanharness/ui test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/shell packages/ui packages/i18n/src/locales/en.json
git -C <worktree> commit -m "feat: sidekick presets suggested by the harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 20: Import — the main side (refusal before reading, limits, conversion)

**Files:**
- Create: `packages/shell/src/main/sidekick-import.ts`
- Modify: `packages/shell/src/main/sidekick-turns.ts` (`importPrompt`, `importSchema`, `parseImport`)
- Modify: `packages/shell/src/main/sidekick.ts` (`importDraft`, `checkOriginal`), `packages/shell/src/main/sidekick-ipc.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/shell/src/main/index.ts` (the picker dep)
- Test: `packages/shell/test/sidekick-import.test.ts`, `packages/shell/test/sidekick-controller.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shell/test/sidekick-import.test.ts
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IMPORT_MAX_BYTES, IMPORT_MAX_FILES, readImportFiles, refusedPath } from "../src/main/sidekick-import";

const fakeHome = () => {
  const home = mkdtempSync(join(tmpdir(), "hh-home-"));
  mkdirSync(join(home, ".claude"));
  mkdirSync(join(home, ".codex"));
  mkdirSync(join(home, "notes"));
  return home;
};

describe("refusal before reading (compliance)", () => {
  it("refuses paths inside ~/.claude or ~/.codex, also through a link, comparing resolved paths only", async () => {
    const home = fakeHome();
    const link = join(home, "notes", "link.md");
    symlinkSync(join(home, ".claude", "CLAUDE.md"), link); // a dangling link: never created, never read
    expect(await refusedPath(join(home, ".claude", "x.md"), home)).toBe(true);
    expect(await refusedPath(join(home, ".codex", "AGENTS.md"), home)).toBe(true);
    expect(await refusedPath(link, home)).toBe(true);
    expect(await refusedPath(join(home, "notes", "me.md"), home)).toBe(false);
  });

  it("readImportFiles never opens a refused file", async () => {
    const home = fakeHome();
    const open = vi.fn(async () => "x");
    const r = await readImportFiles([join(home, ".claude", "CLAUDE.md")], home, { read: open, size: async () => 10 });
    expect(r).toEqual({ ok: false, reason: "engine-settings" });
    expect(open).not.toHaveBeenCalled();
  });

  it("limits: count, size, extension; the hash covers every file", async () => {
    const home = fakeHome();
    const f = (n: string, body: string) => { const p = join(home, "notes", n); writeFileSync(p, body); return p; };
    const ok = await readImportFiles([f("a.md", "A"), f("b.txt", "B")], home);
    expect(ok).toMatchObject({ ok: true, text: expect.stringContaining("A"), hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await readImportFiles(Array.from({ length: IMPORT_MAX_FILES + 1 }, (_, i) => f(`${i}.md`, "x")), home)).toEqual({ ok: false, reason: "too-many" });
    expect(await readImportFiles([f("big.md", "x".repeat(IMPORT_MAX_BYTES + 1))], home)).toEqual({ ok: false, reason: "too-big", file: "big.md" });
    expect(await readImportFiles([f("a.pdf", "x")], home)).toEqual({ ok: false, reason: "type", file: "a.pdf" });
  });
});
```

```ts
// controller
describe("import (spec §2a.6)", () => {
  it("converts pasted text to a draft sidekick plus learned items; nothing is saved yet", async () => {
    const h = harness({ record: on, answers: [json({ name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" }], learned: [{ text: "Prefers short answers.", level: "you" }], skipped: ["Tool permissions"] })] });
    const d = await h.ctl.importDraft({ kind: "paste", text: "You are Rulo. Be direct. Prefer short answers. Allow Bash." });
    expect(d).toEqual({ ok: true, draft: { name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" }], source: { kind: "paste" } }, learned: [{ text: "Prefers short answers.", level: "you" }], skipped: ["Tool permissions"] });
    expect(h.writes).toEqual([]);
    expect(h.logged.at(-1)).toMatchObject({ moment: "import" });
  });

  it("checkOriginal: same hash → unchanged; different → changed; a refused or missing file → gone", async () => {
    const h = harness({ record: on, files: { "/n/a.md": "v2" } });
    expect(await h.ctl.checkOriginal({ kind: "files", paths: ["/n/a.md"], hash: sha256("v2") })).toBe("unchanged");
    expect(await h.ctl.checkOriginal({ kind: "files", paths: ["/n/a.md"], hash: sha256("v1") })).toBe("changed");
    expect(await h.ctl.checkOriginal({ kind: "files", paths: ["/n/gone.md"], hash: sha256("v1") })).toBe("gone");
  });
});
```

(`sha256` is a test helper over `createHash("sha256")` of the files' joined text exactly as `readImportFiles` joins it; the `harness()` helper gains `files` feeding an `importFiles` dep built on `readImportFiles` with an in-memory `read`/`size`.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/shell test -- sidekick-import sidekick-controller`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shell/src/main/sidekick-import.ts
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join, sep } from "node:path";

export const IMPORT_MAX_FILES = 4;
export const IMPORT_MAX_BYTES = 64 * 1024;
const EXTS = new Set([".md", ".txt", ""]);
/** Engine settings folders: refused by resolved path, never listed or opened (spec §2a.6, compliance). */
const ENGINE_DIRS = [".claude", ".codex"];

/** The real path of `p`, resolving links; for a dangling link, its target resolved through its folder. */
async function resolved(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    const { readlink } = await import("node:fs/promises");
    try {
      const target = await readlink(p);
      return resolved(target.startsWith(sep) ? target : join(dirname(p), target));
    } catch {
      return join(await realpath(dirname(p)).catch(() => dirname(p)), basename(p));
    }
  }
}

const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + sep);

export async function refusedPath(p: string, home: string): Promise<boolean> {
  const real = await resolved(p);
  for (const d of ENGINE_DIRS) {
    const dir = await realpath(join(home, d)).catch(() => join(home, d));
    if (inside(real, dir)) return true;
  }
  return false;
}

export type ImportRead =
  | { ok: true; text: string; hash: string; paths: string[] }
  | { ok: false; reason: "engine-settings" | "too-many" | "too-big" | "type" | "unreadable"; file?: string };

export async function readImportFiles(
  paths: readonly string[],
  home: string,
  io: { read(p: string): Promise<string>; size(p: string): Promise<number> } = { read: (p) => readFile(p, "utf8"), size: async (p) => (await stat(p)).size },
): Promise<ImportRead> {
  if (paths.length > IMPORT_MAX_FILES) return { ok: false, reason: "too-many" };
  // Every refusal check runs before any file is opened.
  for (const p of paths) if (await refusedPath(p, home)) return { ok: false, reason: "engine-settings" };
  for (const p of paths) if (!EXTS.has(extname(p).toLowerCase())) return { ok: false, reason: "type", file: basename(p) };
  const parts: string[] = [];
  for (const p of paths) {
    const size = await io.size(p).catch(() => -1);
    if (size < 0) return { ok: false, reason: "unreadable", file: basename(p) };
    if (size > IMPORT_MAX_BYTES) return { ok: false, reason: "too-big", file: basename(p) };
    parts.push(`<file name="${basename(p)}">\n${await io.read(p)}\n</file>`);
  }
  const text = parts.join("\n");
  return { ok: true, text, hash: createHash("sha256").update(text).digest("hex"), paths: [...paths] };
}
```

`sidekick-turns.ts`:

```ts
export const SIDEKICK_IMPORT_MARK = "Sidekick: import";
export function importPrompt(text: string): string {
  return [
    SIDEKICK_IMPORT_MARK,
    "",
    "Turn these instructions into a sidekick. Keep only what fits: a name, a mark (one emoji), a personality (how it talks, at most 1,500 characters), purposes, and things it knows about the person. Drop tool permissions, commands, file paths, secrets and anything about running code: list those as skipped.",
    `Purposes: prompt-coach, focus, process-guard, mentor, daily-summary, or {"id":"custom","text":string,"moments":[${'"pre-send"|"after-reply"|"heads-up"|"before-approve"|"phase-change"|"daily"'}]}.`,
    "<instructions>",
    text,
    "</instructions>",
    "",
    'Answer with the JSON object only: {"name":string,"mark":string,"personality":string,"purposes":[…],"learned":[{"text":string,"level":"you"|"harness"}],"skipped":[string]}',
  ].join("\n");
}
export const importSchema = z.object({
  name: z.string().min(1).max(40),
  mark: z.string().min(1).max(16),
  personality: z.string().max(1500),
  purposes: z.array(purposeSchema).min(1).max(6),
  learned: z.array(z.object({ text: z.string().min(1).max(300), level: z.enum(["you", "harness"]) })).max(10).default([]),
  skipped: z.array(z.string().max(120)).max(20).default([]),
});
export const parseImport = (t: string) => parseJson(t, importSchema);
```

(`purposeSchema` from `@humanharness/harness-sdk`, Task 1; places in custom moments are refused here — an imported sidekick gets places through the scope section.)

Controller (deps gain `importFiles(paths: string[]): Promise<ImportRead>` and `pickImportFiles(): Promise<string[]>`):
- `importDraft(input: { kind: "paste"; text: string } | { kind: "files"; paths: string[] })`: Sidekick need not be on (it's Settings), but the engine notice must be accepted; paste text ≤ `IMPORT_MAX_BYTES`, else `{ ok: false, reason: "too-big" }`; files via `importFiles`; one turn in a one-off `import` session, standard tier; usage `moment: "import"`; returns `{ ok: true, draft: { name, mark, personality, purposes, source }, learned, skipped }` with `source` `{ kind: "paste" }` or `{ kind: "files", paths, hash }`, or `{ ok: false, reason }`. **Nothing is written**: Task 21's Save calls `saveSidekick` and `put`s the learned items (as the person, `source: "person"`).
- `checkOriginal(source)`: `importFiles(source.paths)`; `ok` and same hash → `"unchanged"`; ok and other hash → `"changed"`; else `"gone"`.
- `pickFiles()`: calls `pickImportFiles` → `dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"], filters: [{ name: "Text", extensions: ["md", "txt"] }] })` in `index.ts`; the dialog only returns paths: refusal happens in `readImportFiles` before any read.

IPC: `hh:sidekickPickFiles()` → `string[]`; `hh:sidekickImportDraft(input)` (validated: `kind` and a string ≤ 64 KB, or ≤ 4 path strings ≤ 1024); `hh:sidekickCheckOriginal(id: string)` — looks the sidekick up by id and checks its stored `source`, so the renderer never passes paths to check. `client.ts`: `SidekickDraft`, `SidekickImportResult`, and the three calls `pickFiles()`, `importDraft(input)`, `checkOriginal(sidekickId): Promise<"unchanged" | "changed" | "gone" | "none">`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/shell test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/shell packages/ui/src/client.ts
git -C <worktree> commit -m "feat(shell): import a sidekick from pasted text or files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 21: Import — the UI and "The original changed"

**Files:**
- Create: `packages/ui/src/sidekick/ImportSidekick.tsx`
- Modify: `packages/ui/test/fake-client.ts`, `packages/i18n/src/locales/en.json` (inside `sidekick`)
- Test: `packages/ui/test/sidekick-import.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/ui/test/sidekick-import.test.tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportSidekick } from "../src/sidekick/ImportSidekick";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);
const DRAFT = { ok: true as const, draft: { name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" }], source: { kind: "paste" as const } }, learned: [{ text: "Prefers short answers.", level: "you" as const }], skipped: ["Tool permissions"] };

describe("Import (spec §2a.6)", () => {
  it("paste → preview with what was skipped; Save needs the copy acknowledgement", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickImport = DRAFT;
    const onSaved = vi.fn();
    await renderIn("en", <ImportSidekick client={c} onSaved={onSaved} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Paste instructions" }), { target: { value: "You are Rulo." } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Rulo")).toBeTruthy();
    expect(screen.getByText("Not imported: Tool permissions")).toBeTruthy();
    expect(screen.getByText("What they learned about you")).toBeTruthy();
    expect(screen.getByText("It's a copy: changes to the original won't reach it.")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand it's a copy" }));
    fireEvent.click(save);
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["saveSidekick", expect.objectContaining({ name: "Rulo", source: { kind: "paste" } }), [{ text: "Prefers short answers.", level: "you" }]]));
    expect(onSaved).toHaveBeenCalled();
  });

  it("an engine-settings file is refused with the spec's message", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickPicked = ["/Users/x/.claude/CLAUDE.md"];
    c.sidekickImport = { ok: false, reason: "engine-settings" };
    await renderIn("en", <ImportSidekick client={c} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose files" }));
    expect(await screen.findByText("These files belong to an engine's settings. Copy or paste their content instead.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-import`
Expected: FAIL.

- [ ] **Step 3: Implement**

Strings (`sidekick.import`): `"title": "Import"`, `"paste": "Paste instructions"`, `"choose": "Choose files"`, `"run": "Import"`, `"working": "Reading…"`, `"skipped": "Not imported: {{list}}"`, `"learned": "What they learned about you"`, `"copy": "It's a copy: changes to the original won't reach it."`, `"ack": "I understand it's a copy"`, `"save": "Save"`, `"cancel": "Cancel"`, `"changed": "The original changed · Bring the changes"`, and `"errors": { "engine-settings": "These files belong to an engine's settings. Copy or paste their content instead.", "too-many": "Choose at most 4 files.", "too-big": "{{file}} is larger than 64 KB.", "type": "{{file}} isn't a .md or .txt file.", "unreadable": "{{file}} couldn't be read.", "failed": "The import didn't work. Try again or paste less." }`.

`client.sidekick` gains `saveSidekick(def: SidekickDraftDef & { id?: string }, learned?: { text: string; level: "you" | "harness" }[]): Promise<SidekickInfo>` (main: `store.saveSidekick` then a `put` per learned item with `source: "person"` — the person saved them). Also used by Task 22's editor.

```tsx
// packages/ui/src/sidekick/ImportSidekick.tsx
export function ImportSidekick({ client, onSaved, onCancel }: { client: HarnessClient; onSaved(): void; onCancel?(): void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SidekickImportResult | null>(null);
  const [ack, setAck] = useState(false);
  const run = async (input: SidekickImportInput) => {
    setBusy(true);
    setAck(false);
    setResult(await client.sidekick.importDraft(input).catch(() => ({ ok: false as const, reason: "failed" as const })));
    setBusy(false);
  };
  return (
    <section aria-label={t("sidekick.import.title")} className="hh-sk-import">
      <h3>{t("sidekick.import.title")}</h3>
      <textarea aria-label={t("sidekick.import.paste")} value={text} onChange={(e) => setText(e.target.value)} rows={6} />
      <div className="hh-sk-actions">
        <button type="button" disabled={busy || !text.trim()} onClick={() => void run({ kind: "paste", text })}>{t("sidekick.import.run")}</button>
        <button type="button" disabled={busy} onClick={() => void client.sidekick.pickFiles().then((paths) => paths.length && run({ kind: "files", paths }))}>{t("sidekick.import.choose")}</button>
      </div>
      {busy && <p className="hh-caption">{t("sidekick.import.working")}</p>}
      {result && !result.ok && <p role="alert">{t(`sidekick.import.errors.${result.reason}`, { file: result.file })}</p>}
      {result?.ok && (
        <div className="hh-sk-preview">
          <p><SidekickMark mark={result.draft.mark} /> <strong>{result.draft.name}</strong></p>
          {result.draft.personality && <p>{result.draft.personality}</p>}
          <p className="hh-caption">{result.draft.purposes.map((p) => t(`sidekick.purposes.${p.id}`)).join(" · ")}</p>
          {result.learned.length > 0 && (
            <>
              <h4>{t("sidekick.import.learned")}</h4>
              <ul>{result.learned.map((l) => <li key={l.text}>{l.text}</li>)}</ul>
            </>
          )}
          {result.skipped.length > 0 && <p className="hh-caption">{t("sidekick.import.skipped", { list: result.skipped.join(", ") })}</p>}
          <p>{t("sidekick.import.copy")}</p>
          <label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> {t("sidekick.import.ack")}</label>
          <div className="hh-sk-actions">
            <button type="button" className="hh-primary" disabled={!ack} onClick={() => void client.sidekick.saveSidekick(result.draft, result.learned).then(onSaved)}>{t("sidekick.import.save")}</button>
            {onCancel && <button type="button" onClick={onCancel}>{t("sidekick.import.cancel")}</button>}
          </div>
        </div>
      )}
    </section>
  );
}
```

Purpose labels (`sidekick.purposes`): `"prompt-coach": "Prompt coach"`, `"focus": "Focus"`, `"process-guard": "Process guard"`, `"mentor": "Mentor"`, `"daily-summary": "Daily summary"`, `"custom": "Custom"`. "The original changed · Bring the changes" is rendered by Task 22's list row for a sidekick whose `checkOriginal` says `changed`; its button reruns `importDraft({ kind: "files", paths })` and opens this component's preview with the new draft (the person saves again; `saveSidekick` with the existing id). FakeClient: `sidekickImport`, `sidekickPicked`, and the calls recorded.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/ui test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/ui packages/shell packages/i18n/src/locales/en.json
git -C <worktree> commit -m "feat(ui): import a sidekick, with preview and copy acknowledgement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 22: Settings › Sidekicks — list, editor, order

**Files:**
- Create: `packages/ui/src/sidekick/SidekickList.tsx`, `packages/ui/src/sidekick/SidekickEditor.tsx`
- Modify: `packages/ui/src/sidekick/SidekickTab.tsx` (the tab is renamed "Sidekicks" once there are two or more), `packages/ui/src/client.ts` (`client.sidekick.list`, `remove`, `reorder`), main IPC + preload + controller pass-throughs, `packages/ui/test/fake-client.ts`
- Modify: `packages/i18n/src/locales/en.json` (inside `sidekick`)
- Test: `packages/ui/test/sidekick-list.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/ui/test/sidekick-list.test.tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SidekickList } from "../src/sidekick/SidekickList";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);
const LIST = [
  { id: "sidekick", name: "Sidekick", mark: "spark", personality: "", purposes: [{ id: "prompt-coach" }, { id: "focus" }], order: 0 },
  { id: "rulo", name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" }], order: 1, source: { kind: "files" as const, paths: ["/n/rulo.md"], hash: "a".repeat(64) } },
];

describe("Settings › Sidekicks (spec §8)", () => {
  it("lists them in order with their purposes; Move up reorders", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = LIST;
    await renderIn("en", <SidekickList client={c} />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("strong")?.textContent)).toEqual(["Sidekick", "Rulo"]);
    expect(rows[0]!.textContent).toContain("Prompt coach · Focus");
    fireEvent.click(screen.getByRole("button", { name: "Move Rulo up" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["reorder", ["rulo", "sidekick"]]));
  });

  it("New opens the editor; a custom purpose needs text and a moment", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = LIST;
    await renderIn("en", <SidekickList client={c} />);
    fireEvent.click(await screen.findByRole("button", { name: "New sidekick" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Docs" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Custom" }));
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "What it watches for" }), { target: { value: "Docs stay in sync." } });
    fireEvent.click(screen.getByRole("checkbox", { name: "After the reply" }));
    fireEvent.click(save);
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["saveSidekick", expect.objectContaining({ name: "Docs", purposes: [{ id: "custom", text: "Docs stay in sync.", moments: ["after-reply"] }] }), undefined]));
  });

  it("an imported one whose original changed shows the banner", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = LIST;
    c.sidekickOriginal = { rulo: "changed" };
    await renderIn("en", <SidekickList client={c} />);
    expect(await screen.findByRole("button", { name: "The original changed · Bring the changes" })).toBeTruthy();
  });

  it("Remove asks; the last one has no Remove", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickList = [LIST[0]!];
    await renderIn("en", <SidekickList client={c} />);
    await screen.findByText("Sidekick");
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-list`
Expected: FAIL.

- [ ] **Step 3: Implement**

`client.sidekick` gains `list(): Promise<SidekickView[]>` (`SidekickView` = the def as plain data), `remove(id)`, `reorder(ids)`. Main forwards to the store (`removeSidekick`, `reorder`), as the person.

Strings (`sidekick.list`): `"title": "Sidekicks"`, `"new": "New sidekick"`, `"edit": "Edit {{name}}"`, `"up": "Move {{name}} up"`, `"down": "Move {{name}} down"`, `"remove": "Remove {{name}}"`, `"confirmRemove": "Remove {{name}}? What it learned stays until you forget it."`, `"orderHint": "When two could speak, the higher one does."`; (`sidekick.editor`): `"name": "Name"`, `"mark": "Mark"`, `"personality": "Personality"`, `"personalityHint": "How it talks. Up to 1,500 characters."`, `"purposes": "Purposes"`, `"customText": "What it watches for"`, `"moments": "When it speaks"`, `"tier": "Model"`, `"save": "Save"`, `"cancel": "Cancel"`; (`sidekick.moments`): `"pre-send": "Before sending"`, `"after-reply": "After the reply"`, `"heads-up": "Heads-ups"`, `"before-approve": "Before approving"`, `"phase-change": "Phase change"`, `"daily": "Daily"`.

`SidekickList`: loads `list()`; for each with `source.kind === "files"`, calls `checkOriginal(id)` once; renders an `<ul>` of rows (mark, `<strong>` name, purposes line joined with " · ", Edit, Move up/down, Remove when more than one — Remove confirms inline), a "New sidekick" button and an "Import" button (opens `ImportSidekick`), and the order hint. The banner button reruns the import and shows `ImportSidekick`'s preview (pass `initial` draft prop to it).

`SidekickEditor`: fields name (≤ 40), mark (text input, ≤ 16, default "spark"), personality (textarea ≤ 1500 with counter), a checkbox per core purpose plus "Custom" (custom reveals the text field ≤ 600 and a checkbox per moment from `sidekick.moments`, plus one per harness place `place:<id>` labelled with the place's label), tier `Segmented` (Light / Standard / Deep; "Default" = absent). Save is disabled until name is set, at least one purpose is checked, and a custom purpose has text and a moment. Save → `client.sidekick.saveSidekick(def)`.

`SidekickTab` renders, in order: the part 1 on/off and moments, `PresetOffer`, `SidekickList`, the scope section (Task 23), `LearnedList`. The Settings tab label stays "Sidekick" with one sidekick and reads "Sidekicks" with more (the `useSidekick` state's `sidekicks.length`; the tab id is unchanged so `settings.spec` keeps passing).

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/ui test && corepack pnpm --filter @humanharness/shell test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/ui packages/shell packages/i18n/src/locales/en.json
git -C <worktree> commit -m "feat(ui): Settings Sidekicks list, editor and order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 23: "Sidekicks in this <scope>" section

**Files:**
- Create: `packages/ui/src/sidekick/ScopeSidekicks.tsx`
- Modify: `packages/ui/src/sidekick/SidekickTab.tsx`, `packages/ui/src/client.ts` (`client.sidekick.scope(scope)`, `setScope`), main IPC + preload + controller pass-throughs, `packages/ui/test/fake-client.ts`
- Modify: `packages/i18n/src/locales/en.json` (inside `sidekick`)
- Test: `packages/ui/test/sidekick-scope.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/ui/test/sidekick-scope.test.tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScopeSidekicks } from "../src/sidekick/ScopeSidekicks";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

describe("Sidekicks in this scope (spec §2a.4, Decision 8)", () => {
  it("one row per sidekick: on/off and the purpose text for this scope", async () => {
    const c = new FakeClient({ language: "en" });
    c.sidekickScope = [{ id: "sidekick", name: "Sidekick", mark: "spark", on: true }, { id: "rulo", name: "Rulo", mark: "🦊", on: false, purposeText: "No spec without AC." }];
    await renderIn("en", <ScopeSidekicks client={c} scope={{ id: "login", label: "Login project" }} scopeNoun="project" />);
    expect(await screen.findByRole("region", { name: "Sidekicks in this project" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Rulo" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["setScope", "login", "rulo", { on: true, purposeText: "No spec without AC." }]));
    fireEvent.change(screen.getByRole("textbox", { name: "Sidekick's purpose here" }), { target: { value: "Keep PRs small." } });
    fireEvent.blur(screen.getByRole("textbox", { name: "Sidekick's purpose here" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["setScope", "login", "sidekick", { on: true, purposeText: "Keep PRs small." }]));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-scope`
Expected: FAIL.

- [ ] **Step 3: Implement**

`client.sidekick` gains `scope(scope: string): Promise<{ id: string; name: string; mark: string; on: boolean; purposeText?: string; places?: string[] }[]>` and `setScope(scope, sidekick, v: { on: boolean; purposeText?: string; places?: string[] })` (IPC validates the scope id regex and text ≤ 600). Strings: `"scope": { "title": "Sidekicks in this {{noun}}", "purpose": "{{name}}'s purpose here", "purposeHint": "Added to what it reads on every turn in this {{noun}}." }`.

`ScopeSidekicks` renders a region titled with the harness's scope noun (the `scopes.label` the app already uses for `ScopePicker`), one row per sidekick: a checkbox labelled with the name (on/off), and a textarea labelled `t("sidekick.scope.purpose", { name })` saved on blur. `SidekickTab` renders it only when the harness has scopes and a scope is open (its props come from `appState()`'s scope fields the `ScopePicker` already uses); otherwise nothing — D0 for harnesses without scopes.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/ui test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/ui packages/shell packages/i18n/src/locales/en.json
git -C <worktree> commit -m "feat(ui): sidekicks per scope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 24: The panel with several sidekicks

**Files:**
- Modify: `packages/ui/src/sidekick/SidekickPanel.tsx` (speaker line, phase-change / daily / lesson cards, rail marks)
- Modify: `packages/ui/src/sidekick/SidekickMark.tsx`
- Modify: `packages/i18n/src/locales/en.json` (inside `sidekick`)
- Test: `packages/ui/test/sidekick-panel.test.tsx` (append)

- [ ] **Step 1: Write the failing tests**

```tsx
describe("several sidekicks in the panel (spec §7)", () => {
  const RULO = { id: "rulo", name: "Rulo", mark: "🦊" };

  it("every card names who speaks", async () => {
    await panel({ ...SK_ON, cards: [{ id: "a", moment: "after", kind: "next", speaker: RULO, prompt: "", flags: [], issues: [], confidence: 1, at: "x", after: { next: "Ask for sources", lesson: "Sources first." } }] });
    expect(screen.getByText("Rulo")).toBeTruthy();
    expect(screen.getByText("🦊")).toBeTruthy();
    expect(screen.getByText("Worth knowing")).toBeTruthy();
  });

  it("phase-change and daily cards", async () => {
    await panel({ ...SK_ON, cards: [
      { id: "p", moment: "phase-change", kind: "missing", speaker: RULO, prompt: "", flags: [], issues: [], confidence: 1, at: "x", guard: { missing: ["No agreed section list"] } },
      { id: "d", moment: "daily", kind: "daily", speaker: RULO, prompt: "", flags: [], issues: [], confidence: 1, at: "x", text: "Yesterday you outlined chapter 2." },
    ] });
    expect(screen.getByText("Before moving on")).toBeTruthy();
    expect(screen.getByText("No agreed section list")).toBeTruthy();
    expect(screen.getByText("Yesterday you outlined chapter 2.")).toBeTruthy();
  });

  it("the rail shows the waiting speakers' marks", async () => {
    await panel({ ...SK_ON, collapsed: true, cards: [{ id: "d", moment: "daily", kind: "daily", speaker: RULO, prompt: "", flags: [], issues: [], confidence: 1, at: "x", text: "y" }] });
    expect(screen.getByRole("button", { name: "Sidekick · 1 waiting" }).textContent).toContain("🦊");
  });

  it("D0: one sidekick → no speaker line on its cards", async () => {
    await panel({ ...SK_ON, status: "suggestion", card: { ...CARD, moment: "pre", kind: "vague", speaker: SK_ON.info } });
    expect(screen.queryByText("Sidekick", { selector: ".hh-sk-speaker" })).toBeNull();
  });
});
```

(`SidekickState` gains `sidekicks: number` — how many the person has — set by the controller; `SK_ON` has `1`. Use whatever prop part 1 named for the collapsed rail; `collapsed` stands for it.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/ui test -- sidekick-panel`
Expected: FAIL.

- [ ] **Step 3: Implement**

Strings: `"after.lesson": "Worth knowing"`, `"guard": { "title": "Before moving on", "approveTitle": "Before approving" }`, `"daily": { "title": "Yesterday" }`, `"rail": { "waiting": "Sidekick · {{count}} waiting" }` (if part 1's rail label differs, extend it with the count).

- A `Speaker` line (`<span className="hh-sk-speaker"><SidekickMark mark={card.speaker.mark} /> {card.speaker.name}</span>`) heads every card when `s.sidekicks > 1`.
- `GuardCard` for `phase-change` and `before-approve`: title by moment, the `missing` list, Dismiss.
- `DailyCard`: title "Yesterday", `card.text`, Dismiss.
- `AfterCard` renders `after.lesson` under "Worth knowing".
- The collapsed rail shows up to three distinct marks of waiting cards' speakers and the count.
- `SidekickMark({ mark })`: `"spark"` → the part 1 SVG; a `--hh-*` token name → a dot coloured by `var(<token>)`; anything else → the text (emoji) in a `span` with `aria-hidden`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/ui test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/ui packages/i18n/src/locales/en.json
git -C <worktree> commit -m "feat(ui): sidekick panel with several speakers and new card kinds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 25: Pre-send review of free-text block answers

**Files:**
- Modify: `packages/ui/src/InputForm.tsx`
- Modify: `packages/ui/src/ChatView.tsx` (pass the review function down)
- Test: `packages/ui/test/input-form.test.tsx` (append)

- [ ] **Step 1: Write the failing tests**

```tsx
// append to packages/ui/test/input-form.test.tsx (reuse its block fixture with one free-text field)
describe("Sidekick on free-text answers (spec §4.1)", () => {
  it("a free-text answer goes through review first; a card holds it", async () => {
    const review = vi.fn(async () => ({ kind: "card" as const }));
    const onSubmit = vi.fn();
    await renderForm({ block: TEXT_BLOCK, onSubmit, review });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "make it better" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(review).toHaveBeenCalledWith("make it better"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("send → submits as before", async () => {
    const onSubmit = vi.fn();
    await renderForm({ block: TEXT_BLOCK, onSubmit, review: async () => ({ kind: "send" as const }) });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ok" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });

  it("D0: without `review`, or with choices only, nothing changes", async () => {
    const onSubmit = vi.fn();
    await renderForm({ block: TEXT_BLOCK, onSubmit });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ok" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });
});
```

(Use the file's existing render helper and a block fixture with a single `text` field; `renderForm` and `TEXT_BLOCK` stand for them. Name the submit button as the file's other tests do.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @humanharness/ui test -- input-form`
Expected: FAIL.

- [ ] **Step 3: Implement**

`InputForm` gains an optional prop `review?(text: string): Promise<{ kind: "send" } | { kind: "card" }>`. On submit, when `review` is set and the answer has free text (the joined text fields, non-empty), it awaits `review(text)` before `onSubmit`; on `card` it keeps the form as is (the card shows in the panel; its "Send suggested" puts the rewrite in the composer and its "Send anyway" calls the form's submit with `skipReview`). `ChatView` passes `review={sidekickOn ? (text) => client.sidekick.review({ text, block: true }) : undefined}`; part 1's `review` input gains `block?: boolean` so the controller records `moment: "pre"` with `kind` from the block answer and skips the after-reply turn that follows (it's `fromBlock`). Choice-only blocks never call it.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @humanharness/ui test`
Expected: PASS.

- [ ] **Step 5: Typecheck, build and commit**

```bash
corepack pnpm typecheck && corepack pnpm app:build
git -C <worktree> add packages/ui packages/shell
git -C <worktree> commit -m "feat(ui): Sidekick reviews free-text block answers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

### Task 26: E2E — two sidekicks

**Files:**
- Modify: `packages/fake-agent/src/…` (part 1 Task 20's `mockSidekickReply`: answer the new marks)
- Modify: the demo harness's manifest `sidekick` block (add one preset, default still off)
- Create: `packages/e2e/tests/sidekick-many.spec.ts`

- [ ] **Step 1: Extend the fake replies**

In `mockSidekickReply(prompt)` (part 1 Task 20), add by mark:
- `SIDEKICK_AFTER_MARK` → `{"next":"Ask for the sources of claim 2"}`;
- `SIDEKICK_PHASE_MARK` → `{"missing":["No agreed section list"]}`;
- `SIDEKICK_LEARN_MARK` → `{"add":[],"update":[],"remove":[]}`;
- `SIDEKICK_ROUTE_MARK` → the first id listed;
- `SIDEKICK_DAILY_MARK`, `SIDEKICK_PLACE_MARK` → one sentence;
- `SIDEKICK_IMPORT_MARK` → a fixed draft (`Rulo`, mentor);
- `SIDEKICK_APPROVE_MARK` → `{"missing":[]}`.

Demo manifest: `sidekick: { default: "off", presets: [{ name: "Guard", mark: "🛡️", personality: "Calm and brief.", purposes: [{ id: "process-guard" }] }] }`.

- [ ] **Step 2: Write the test**

```ts
// packages/e2e/tests/sidekick-many.spec.ts
import { expect, test } from "@playwright/test";
import { launchApp } from "./helpers";

test("two sidekicks: Sidekick reviews before sending, Guard speaks at the phase change", async () => {
  const { page, close } = await launchApp({ engine: "claude", sidekick: "on" });
  try {
    // Adopt the harness's preset.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Sidekick" }).click();
    await page.getByRole("region", { name: "Suggested by the harness" }).getByRole("button", { name: "Add Guard" }).click();
    await expect(page.getByRole("tab", { name: "Sidekicks" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Pre-send: the default Sidekick flags a vague prompt.
    await page.getByRole("button", { name: /Start/ }).first().click();
    await page.getByRole("textbox", { name: "Message" }).fill("make it better");
    await page.keyboard.press("Enter");
    const panel = page.getByRole("complementary", { name: "Sidekick" });
    await expect(panel.getByText("Sidekick", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Send anyway" }).click();

    // Phase change: Guard speaks, named.
    await page.getByRole("button", { name: "Next phase" }).click();
    await expect(panel.getByText("Guard")).toBeVisible();
    await expect(panel.getByText("No agreed section list")).toBeVisible();
  } finally {
    await close();
  }
});
```

(Use the part 1 E2E's launch options and selectors — `sidekick: "on"` writes the settings record before launch in part 1's `sidekick.spec.ts`; match the "Next phase" control to the demo action's phase UI; pick a demo action with at least two phases.)

- [ ] **Step 3: Run it**

Run: `corepack pnpm app:build && corepack pnpm e2e -- sidekick`
Expected: PASS (both `sidekick.spec.ts` and `sidekick-many.spec.ts`), and the whole `corepack pnpm e2e` stays green.

- [ ] **Step 4: Commit**

```bash
git -C <worktree> add packages/fake-agent packages/e2e packages/harness-demo
git -C <worktree> commit -m "test(e2e): two sidekicks, pre-send and phase change

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

(Use the demo harness's real package path in `git add`.)

---

### Task 27: Docs

**Files:**
- Modify: `docs/architecture/sidekick.md` (part 1 created it)
- Modify: `docs/architecture/manifest.md` (the `sidekick.places` / `sidekick.presets` fields)

- [ ] **Step 1: Write the sections**

In `sidekick.md`, add:
- **Moments** — pre-send, after the reply (hooks `turnStarting`/`turnEnded`; skipped for checkpoint/close/failed/block turns; cancelled by a send), heads-ups (75 % context, 3 repeats, 2 off-phase in a row; 0 tokens for context), phase change (`phaseMoved` hook), daily (first start of a local day), before-approve (`client.sidekick.beforeApprove`, for the document-review flow), places.
- **Learning** — `events.jsonl` (2,000 lines, never in history), thresholds per sidekick and kind (0.5; 0.8 when used < 20 % of the last 10), why shown (≥ 3), muting (person items), the learn turn at task close (≥ 5 events; app writes; person items untouched), "What Sidekick learned".
- **Several sidekicks** — record types, implicit default, candidates → speaker (custom-only ties use one light routing turn; else order), one session and folder per sidekick, shared cap, scope records and purpose text per turn.
- **Places and presets** — manifest fields, `client.sidekick.ask` (the only Sidekick call a harness UI gets), presets offered once in Settings.
- **Import** — paste or files; refusal of `~/.claude` / `~/.codex` by resolved path before reading; limits; preview with "Not imported"; copy acknowledgement; hash and "The original changed".
- **Usage moments** — `pre`, `after`, `learn`, `route`, `phase-change`, `daily`, `before-approve`, `place:<id>`, `import`.

In `manifest.md`, document `sidekick.places[]` (`id`, `label`, `description`) and `sidekick.presets[]` (`name`, `mark`, `personality`, `purposes`), with the rule that a custom `place:<id>` moment must name a declared place.

- [ ] **Step 2: Check and commit**

```bash
corepack pnpm typecheck && corepack pnpm test
git -C <worktree> add docs/architecture
git -C <worktree> commit -m "docs: sidekick part 2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Self-review against the spec

| Spec | Task(s) |
|---|---|
| §2a.1 sidekick = name, mark, personality, purposes, order | 1, 11, 13, 22 |
| §2a.2 purposes and their moments | 1, 13, 15, 16, 17 |
| §2a.3 candidates, one speaker, free routing then order (D11) | 12, 13 |
| §2a.4 per-scope on/off and purpose text | 11, 14, 23 |
| §2a.5 harness places, `client.sidekick.ask` | 1, 18 |
| §2a.6 import by paste/files, refusal, copy, "original changed" | 20, 21, 22 |
| §2a.7 presets offered | 1, 19 |
| §4.2 after the reply, cut reply, next prompt, queued prompts | 5, 6 |
| §4.3 heads-ups and their buttons | 7, 8 |
| §5 serial (send cancels), shared cap | 5, 12, 13 |
| §6.1–6.3 events, thresholds, why shown, muting | 2, 3, 4 |
| §6.4 learning at task close, What Sidekick learned | 9, 10 |
| §7 cards name who speaks, past cards, rail | 4, 24 |
| §8 settings: moments, N of M used, sidekicks, scope | 4, 8, 22, 23 |
| §4.1 free-text block answers | 25 |
| §10 E2E with two sidekicks | 26 (phase change instead of before-approve: Open question 3) |
| D0 | Conventions list; regression tests in 1, 2, 5, 7, 9, 11, 13, 15, 16, 18, 19, 23, 24, 25 |

Not in this plan, by Decisions 10–11: the Approve-button wiring for before-approve (document-review plan) and the `focus` heads-ups about parallel tasks (parallel-tasks plan).

## Open questions (each with the default this plan takes)

1. **Moments on by default?** After-reply and heads-ups cost tokens (heads-ups only via `repeated`). *Default: on when Sidekick is on; the cap bounds cost; one checkbox each in Settings.*
2. **Threshold window.** Raise to 0.8 only after 10 cards of a kind, or earlier? *Default: needs the full 10; timeouts don't count.*
3. **E2E for before-approve.** Spec §10 asks for it, but no Approve button exists yet. *Default: E2E covers pre-send + phase change; before-approve gets unit + IPC tests; the document-review plan adds its E2E.*
4. **Where scope settings live.** No per-scope settings screen exists. *Default: a "Sidekicks in this <scope>" section inside Settings › Sidekicks for the open scope.*
5. **Learning session.** Its own one-off session vs. the speaker's task session. *Default: one-off `learn` folder, prompt-coach speaker's engine and tier, closed right after.*
6. **Repeated-topic detection.** Counted from the after-reply turn's `repeated.topic` (so it needs after-reply on). *Default: yes; with after-reply off only context and drift heads-ups run.*
7. **Daily input.** Titles of yesterday's notes + tokens; open tasks only if `TaskManager` can list them. *Default: titles and tokens only; `open: []` when no list exists.*
8. **Place answers.** Free text ≤ 600 characters, no card. *Default: as stated; a harness wanting structure asks for it in the place description.*
9. **Import limits.** *Default: 4 files, 64 KB each, `.md`/`.txt`/no extension; paste ≤ 64 KB; tool permissions and commands are always dropped and listed under "Not imported".*
10. **Import of `~/.claude`/`~/.codex` content pasted by hand.** Pasting is the spec's sanctioned path. *Default: allowed; only the file picker refuses those folders.*
