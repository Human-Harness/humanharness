# Sidekick — design

Status: draft, 2026-10-25, waiting for Marco's review. Core spec #9, after the eight approved on 2026-10-25. Builds on `2026-10-25-scopes-and-data-design.md`, `2026-10-25-profiles-design.md`, `2026-10-25-harness-settings-design.md` and `2026-10-25-task-phases-design.md`. Mockup: https://claude.ai/artifact/QjjA1E7C7tK8s7VhdYAgAy (six boards: off, reviewing, before you send, after the reply, heads-ups, Settings › Sidekick).

## 1. Why

People get worse results than they could because of how they ask:
- vague words ("make it better");
- missing context ("the stuff about sources" when the decision is in a note);
- two asks in one turn;
- asking for something the current phase is not for.

A harness's decision UI helps at the points the harness designed. Free text, though, still goes out as typed. Sidekick is a second, cheap agent that coaches the person, not the AI:
- it reviews a prompt before it goes out;
- it points out gaps after a reply;
- it raises heads-ups while the person works.

It only suggests; the person decides.

It serves all three pillars:
- **Decision UI.** Every suggestion is a decision: use, edit or ignore.
- **Flow.** It notices drift from the phase.
- **Resources.** It says when to finish a task or save a decision before the context fills.

It costs tokens, so the person can turn it off and always sees what it spends.

## 2. Decisions

Marco confirmed these on 2026-10-25.

- **D1. Sidekick is a core feature.** Every harness gets it. A harness tunes it in the manifest (§3) and cannot replace it.
- **D2. The pre-send review is the core moment.** The review after the reply and the heads-ups come second, and each can be turned off on its own.
- **D3. It has its own presence:** a panel in the right column with a name, a mark and a state (§7). It is not only inline hints.
- **D4. It learns the person** across sessions, on two levels: one about the person across every harness, and one about this harness (§6). The person can see, edit and erase what it learned.
- **D5. A pre-send review never traps the person.**
  - The free local check runs first; the model is asked only when the check flags something, or when the person asks for a review.
  - The model gets about 6 s (adjustable). After that the prompt goes out as typed.
  - ⌘⏎ always sends at once.
- **D6. Sidekick is its own process, on its own tier.**
  - It defaults to `light` and can be changed like any process (plan 3c).
  - It has no tools and sees only compact context (§5).
  - It never writes notes or data on its own. Writes happen only when the person presses a button: "Save as decision", "Finish task".
- **D7. It never drives the flow.** It may suggest a next prompt or closing the task. The app's flow rules (`flow-and-context` spec) are unchanged.
- **D8. Its spend is visible and capped.** Every Sidekick turn is tagged in `usage.jsonl` (§8). At the cap per task, Sidekick goes quiet and says so once.

## 3. Manifest

```ts
sidekick: {
  default: "on",                                   // "on" | "off": the state for a new profile
  tips: "Essays: one section per task. Claims need a source. APA style unless a decision says otherwise.",
  actions: { "draft-section": "auto", "free-chat": "auto", "export": "off" },   // "auto" | "always" | "off"
  checks: { minWords: 6 },                         // local-check thresholds (§4.1)
},
```

- **Without `sidekick`:** Sidekick is available, default `off`, with no tips.
- **`tips`** are domain hints appended to Sidekick's brief, within `SIDEKICK_TIPS_TOKENS_WARN` (300) tokens. They are English, like every manifest text (`2026-10-25-language-on-demand-design.md`).
- **`actions`** set the pre-send mode for each action:
  - `auto`: local check first, then the model only if flagged;
  - `always`: the model reviews every prompt of that action;
  - `off`: no review.

  Free questions follow `auto`.
- **`check`** (plan 4a):
  - every action id must exist;
  - `tips` must stay within budget;
  - `checks` keys must be known.

## 4. The three moments

### 4.1 Before you send (core)

1. **Local check** (deterministic, 0 tokens, under 50 ms), in `packages/workspace/src/sidekick-checks.ts`. Each rule returns a flag with a `kind` and a text span:
   - `vague`: words from a short list ("better", "fix it", "the stuff", "etc.") in a prompt under `minWords`, or with nothing concrete beside them;
   - `missing-context`: a reference ("that file", "the sources", "like before") with nothing attached and no matching note or data title;
   - `two-asks`: two imperative clauses joined by "and also" / "and then" / a new line;
   - `off-phase`: the prompt matches another phase's keywords (`task-phases` spec), not the open one;
   - kinds the person muted (§6.3) are dropped.
2. **Decision.** The prompt goes straight out when:
   - there are no flags, the action is `auto`, and the person did not press "Review";
   - or the action is `off`;
   - or Sidekick is off or past its cap.

   Otherwise the model reviews it.
3. **Model review.** One Sidekick turn (§5) with the prompt, the flags and the compact context. It returns:

   ```ts
   { verdict: "send" | "suggest",
     issues: { kind: "vague" | "missing-context" | "two-asks" | "off-phase" | "other", text: string, span?: [number, number] }[],
     rewrite?: string,            // the suggested prompt
     queued?: string[],           // follow-up prompts split off the original (two-asks)
     confidence: number }         // 0..1
   ```

   The reply is parsed with zod. If it is invalid, the prompt is sent as typed, and a quiet line in the panel says so.
4. **Card.**
   - On `suggest` with `confidence` at or above the threshold for that kind (§6.2), the panel shows the card from the mockup, board 3:
     - the issues;
     - the rewrite with what was added marked;
     - the queued prompts;
     - the buttons **Send suggested · Edit · Send anyway**;
     - why the card was shown ("you usually take scope fixes");
     - a "Don't flag …" link.
   - "Edit" puts the rewrite in the composer.
   - On `send`, or below the threshold, the prompt goes out with nothing shown.
5. **Timeout.** The composer shows "Reviewing…" and "Sends anyway in N s".
   - At the end of the countdown (default 6 s; 10 s or "always wait" in Settings), the prompt goes out as typed.
   - A late review is dropped and not shown, so the panel never suggests changes to a prompt that has already gone out.

### 4.2 After the reply

- **Trigger.** It runs when a task turn ends successfully. It is skipped when:
  - the turn was a checkpoint or a closing turn;
  - the reply came from a block action (no free text);
  - the person has already started a new send.
- **Input.**
  - the person's prompt;
  - the reply, cut to `SIDEKICK_REPLY_TOKENS` (1500) tokens: the head and tail, plus any headings;
  - the phase goal;
  - the last three prompts' first lines.
- **Output:**

  ```ts
  { gap?: { title: string, text: string }, next?: string, repeated?: { topic: string, decision: string } }
  ```

  It shows nothing when everything is empty.
- **Card:** "Put in composer" and "Dismiss". Queued prompts from §4.1 show here too, with "Put in composer" and "Drop".

### 4.3 Heads-ups

They never block. They wait in the panel until the person acts or dismisses them.

| Heads-up | Source | Tokens |
|---|---|---|
| Context near full (≥ 75% of the task's cap) | the engine's usage report | 0 |
| Repeated ask (the same topic asked for 3 times) | `repeated` from §4.2 | already paid |
| Off-phase drift (2 off-phase flags in a row) | §4.1 flags | 0 |

Their buttons call existing app paths:
- "Save as decision" → `save_note` with the draft decision, written as `who: "person"`;
- "Finish task" → the normal task close.

## 5. The Sidekick session

- **One Sidekick session per task**, opened at the first Sidekick turn and closed when the task closes. It is reused for every moment, so the cached prefix pays once. This matters on Codex, where the prefix alone is about 15k tokens (plan 3c, spike S7).
  - It is a second `Transport` next to the task's, with its own session id.
  - Claude: one `claude -p --resume` process per turn, as `ClaudeCliTransport` does today.
  - Codex: a second ACP session.
- **No tools, its own working folder.**
  - cwd is `<profile folder>/.harness/sidekick/`, which holds its own `AGENTS.md` (plus the engine's file). The task's instructions, MCP servers and permissions never load.
  - `allowedTools` is empty and no MCP spec is passed.
- **Brief, in the generated `AGENTS.md`:**
  - the core's Sidekick rules: answer only with the JSON, suggest and never act, be brief;
  - the harness `tips`;
  - the learned profile (§6), as sentences.

  It is rewritten only between tasks, like harness settings (`harness-settings` spec D4), so the prefix stays cached.
- **Per-turn context**, compact:
  - the harness goal;
  - the open phase and its goal;
  - the scope's notes index (titles only);
  - the loaded data table titles;
  - the moment's input (§4).

  Never the task's history.
- **Tier.** It is a process named `sidekick` in Settings › Models, default `light`, fixed for the session (plan 3c).
- **Serial with the task.** A pre-send review runs before the task turn, and an after-reply review runs after it. They never overlap. Sending cancels a running after-reply turn.
- **Errors.** `model_not_found`, a timeout or invalid JSON never block the person. The panel shows "Sidekick couldn't review this one", and the prompt goes as typed.

## 6. Learning

### 6.1 Events (free)

- Every card outcome is appended to `<profile folder>/.harness/sidekick/events.jsonl`:

  ```ts
  { at, task, scope, action, moment: "pre" | "after" | "heads-up", kind, outcome: "used" | "edited" | "sent-anyway" | "dismissed" | "muted" | "timeout", confidence }
  ```
- Like `usage.jsonl`, it is not tracked by the history, never leaves the machine, and is trimmed to the last 2000 lines.

### 6.2 Thresholds per kind (free)

- The app derives, from the events, a show threshold for each `kind`: the more the person ignores a kind, the higher its threshold.
- Starting threshold is 0.5. A kind used in under 20% of its last 10 cards rises to 0.8.
- This is deterministic, so it needs no model.

### 6.3 Muting (free)

- "Don't flag …" mutes that `kind` at once, and adds a learned item marked `source: "person"`.
- It can be undone from Settings.

### 6.4 The profile

- **Storage.** A reserved app-wide collection, `sidekick` (`scopes-and-data` spec §4), holds the Sidekick settings and the harness-level learned items:

  ```ts
  { id, text: string, level: "you" | "harness", kind?: string, source: "learned" | "person", updatedAt }
  ```

  It is `agent: "none"`: the task agent never sees it. It gets schema checks, history and undo for free.
- **Update.**
  - At task close, if there are at least 5 new events since the last update, one Sidekick turn gets the current items and the new events. It returns `{ add, update, remove }`.
  - Items with `source: "person"` are never changed or removed by learning.
  - The app applies the result through the data store, with `who: "app"`.
- **Two levels (D4).**
  - **`harness`:** items about how the person works in this harness. They are stored in the profile's `sidekick` collection.
  - **`you`:** items about the person in general ("takes scope fixes", "writes short prompts"). They are stored in the shared Sidekick file (§6.5), read by every Human Harness app on the computer that opts in.
- **In Settings** (mockup, board 6), "What Sidekick learned" shows both columns:
  - each item has "Forget this";
  - "Edit" opens the items as an editable list;
  - "Forget everything" asks once, then clears both levels.

### 6.5 The shared file

- **Location.** `<OS app data>/Human Harness/shared/sidekick.json`, outside every app's folder.
- **Contents.** Only the `you` items, with the same shape. It is never synced, and never part of an app's history.
- **Opt-in per app.** The first time Sidekick learns a `you` item, the app asks once: "Share what Sidekick learns about you with your other Human Harness apps?" Until then, `you` items stay in the app's own collection.
- **With profiles** (`profiles` spec): only the profile marked "This is me" reads and writes the shared file. The others keep `you` items local.

## 7. UI

- **Top bar.** A Sidekick toggle button with a state dot (filled when on, empty when off).
- **Right column.**
  - The Sidekick panel is 330 px. Its head holds the mark, the name and the state: Watching · Reading your prompt… · Has a suggestion · N heads-ups · Off.
  - When the harness also has a side panel (`renderSide`), a **Sidekick | Harness** segmented switch in the head picks which one shows. A new suggestion switches to Sidekick.
  - Collapsed, the panel is a 52 px rail with the mark. The mark lights up when a card is waiting.
- **Cards.**
  - The live card stacks on top. Past cards collapse to one line ("Earlier · used").
  - The panel shows the cards of the current task only.
- **Composer.**
  - While reviewing, the send button reads "Reviewing…", with the countdown hint and ⌘⏎ to send now.
  - With a card, the flagged spans are underlined in the composer.
  - A "Review" button (or ⌥⏎) asks for a review even when the local check finds nothing.
- **Panel foot.** "Sidekick in this task — X / cap tokens", a bar, the tier, and the ⌘⏎ hint.
- **Off state** (mockup, board 1). The rail shows the mark in grey. The first time the person opens it, a short card explains Sidekick and its cost, with "Turn on" and "Not now".
- **Accessibility.**
  - A new card is announced once through the existing polite live region.
  - Cards are real buttons, and the countdown has a text equivalent.
  - The panel never takes focus from the composer.

## 8. Settings and cost

- **Settings › Sidekick** is a core tab, after Models (mockup, board 6). It holds:
  - the on/off switch;
  - the three moments, each on its own, with the longest wait for pre-send;
  - the tier (it links to Models);
  - the cap per task: 20k by default, or 50k, or no cap;
  - the week's spend and "N of M suggestions used";
  - "What Sidekick learned".

  The values live in the `sidekick` collection, so each profile has its own.
- **Usage.**
  - Sidekick turns are logged in `usage.jsonl` with `process: "sidekick"`, and `phase` set to `pre`, `after` or `learn`. This is a new field on `UsageMeta` in `packages/shell/src/main/usage-log.ts`.
  - Settings › Usage can split Sidekick's spend from the task's.
- **No promised savings.** The tab shows only measured numbers. Whether Sidekick pays for itself is measured during dogfooding (§10, Q3), never claimed.

## 9. Depends on

| Spec | For |
|---|---|
| Scopes + data | the `sidekick` collection, notes index per scope, `who: "app"` writes |
| Profiles | per-person settings and items, "This is me" for the shared file |
| Harness settings | the deferred `AGENTS.md` rewrite pattern, the Settings tab pattern |
| Task phases | the phase goal, off-phase checks |
| Input blocks | free-text fields of input blocks are reviewed like the composer (pre-send only) |

## 10. Delivery slices

1. **Pre-send.**
   - Local checks.
   - The Sidekick transport and its folder.
   - The JSON contract.
   - The panel, the card, the toggle and the composer states.
   - The timeout.
   - Usage tagging and the cap.
   - The `sidekick` collection for settings.
   - Settings › Sidekick (without the learned section).
2. **After the reply and heads-ups.** The after-reply turn, queued prompts, the three heads-ups and their buttons.
3. **Learning.**
   - `events.jsonl`, the thresholds per kind and muting.
   - The profile update at task close.
   - "What Sidekick learned" in Settings.
4. **Shared profile.** The shared file, the opt-in, and "This is me" with profiles.

## 11. Open questions

1. **The shared file's place.** A folder outside every app means a path the core owns, but no app's history or backup covers it. Proposed: accept that. It is small, and losing it only resets the `you` items. Or keep `you` items per app and drop the shared file?
2. **Which language Sidekick reads the person's prompts in.** It thinks in English (`language-on-demand` spec), but rewrites must come back in the person's language. Proposed: the rewrite keeps the language of the prompt, and the issues use the app's UI language.
3. **Is it worth it?** Track with mock mode and dogfooding:
   - Sidekick's share of a task's tokens;
   - the share of prompts that reached the model;
   - the share of cards used.

   Set the default cap and the `auto` thresholds from those numbers before making Sidekick default `on` in any harness.
4. **The local-check word lists in other languages.** They ship in English. A harness in another language needs lists in that language; that is part of the language spec's agentic translation.
