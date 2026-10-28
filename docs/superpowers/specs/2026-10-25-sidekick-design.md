# Sidekick — design

Status: approved by Marco on 2026-10-27, including the several-sidekicks update and five fixes from his review (§2a.1 `defaultOn`, §2a.2 several purposes in one moment, §2a.6 re-check on "Traer cambios", §5 folder and sessions without a task). **Updated 2026-10-27 for several sidekicks** (spec E from `docs/discovery/2026-10-26-dev-vs-core.md`, candidate C1; decisions from the dev mockup v3, round 4, and a brainstorming session with Marco on 2026-10-27): see D9–D14 and §2a. Where an older section says "Sidekick", read "the sidekick that speaks". Core spec #9, after the eight approved on 2026-10-25. Builds on `2026-10-25-scopes-and-data-design.md`, `2026-10-25-profiles-design.md`, `2026-10-25-harness-settings-design.md` and `2026-10-25-task-phases-design.md`. Mockup: https://claude.ai/artifact/QjjA1E7C7tK8s7VhdYAgAy (six boards: off, reviewing, before you send, after the reply, heads-ups, Settings › Sidekick).

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
- **D4. It learns the person** across sessions, on two levels: one about the person in general, and one about how they work in this harness (§6). Both levels stay inside this app's folder; nothing is shared between apps. The person can see, edit and erase what it learned.
- **D5. A pre-send review never traps the person.**
  - The free local check runs first; the model is asked only when the check flags something, or when the person asks for a review.
  - The model gets about 6 s (adjustable). After that the prompt goes out as typed.
  - ⌘⏎ always sends at once.
- **D6. Sidekick is its own process, on its own tier.**
  - It defaults to `light` and can be changed like any process (plan 3c).
  - It has no tools and sees only compact context (§5).
  - It never writes notes or data on its own. Writes happen only when the person presses a button: "Save as decision", "Finish task".
- **D7. It never drives the flow.** It may suggest a next prompt or closing the task. The app's flow rules (`flow-and-context` spec) are unchanged.
- **D8. Its spend is visible and capped.** Every Sidekick turn is tagged in `usage.jsonl` (§8). At the cap per task, Sidekick goes quiet and says so once. With several sidekicks, **the cap is shared** by all of them (D11).

Added on 2026-10-27 (Marco):

- **D9. Several sidekicks, each with a personality and purposes.** The person writes each sidekick's personality as a prompt and picks its purposes from the core's list, or writes their own (§2a.2). A purpose of their own never grants tools or permissions: no sidekick has tools (D6).
- **D10. Sidekicks belong to the person; the scope picks them.**
  - Sidekicks live in the person's profile (the app-wide `sidekick` collection).
  - Each scope turns them on or off, and may add a purpose text and places of its own.
  - The personality stays the person's.
- **D11. One sidekick speaks per moment.**
  - It is the first one, in the person's order, among those turned on in the scope with a purpose for that moment.
  - Free signals can route.
  - Only that one calls the model, so the cost does not grow with the number of sidekicks.
- **D12. What is learned about the person is shared; what is learned about each sidekick is its own.** Learned items (`you`, `harness`) are read by every sidekick. Thresholds per kind and muting are per sidekick.
- **D13. Import by paste or file picker.**
  - The picker refuses `~/.claude` and `~/.codex`, so the engines' compliance rule ("the app never reads `~/.claude` or `~/.codex`", `docs/architecture/engines.md`) holds.
  - A turn turns the text into a sidekick.
  - The person confirms it with a copy notice and a checkbox.
- **D14. Harnesses may ship presets.** Adopting one makes a copy that the person owns and can edit.

## 2a. Several sidekicks

### 2a.1 A sidekick

```ts
type Sidekick = {
  id: string;                 // slug of the name
  name: string;               // "Rulo"
  mark: string;               // one emoji, or a color token
  personality: string;        // the person's prompt: how it talks, what it cares about; up to 1,500 characters
  purposes: Purpose[];
  order: number;              // who speaks first (D11)
  defaultOn: boolean;         // on in a scope with no record (§2a.4); true when created or adopted
  tier?: "light" | "standard" | "deep";   // default: the `sidekick` process tier (§5)
  source?: { kind: "paste" } | { kind: "files"; paths: string[]; hash: string };   // when imported (§2a.6)
};

type Purpose =
  | { id: "prompt-coach" | "focus" | "process-guard" | "mentor" | "daily-summary" }
  | { id: "custom"; text: string; moments: Moment[] };

type Moment = "pre-send" | "after-reply" | "heads-up" | "before-approve" | "phase-change" | "daily" | `place:${string}`;
```

These are records in the app-wide `sidekick` collection (§6.4), next to the settings and the learned items. With profiles, each profile has its own sidekicks.

### 2a.2 The core's purposes

| Purpose | Speaks at | What it does |
|---|---|---|
| `prompt-coach` | `pre-send`, `after-reply` | §4.1 and §4.2 as specified: vague, missing context, two asks, off-phase, gaps, next prompt, repeated asks |
| `focus` | `heads-up` | §4.3, plus two heads-ups with parallel tasks (`2026-10-27-parallel-tasks-and-jobs-design.md`): a task waiting for the person for more than 30 min, and more than three tasks waiting at once |
| `process-guard` | `before-approve`, `phase-change` | Checks the moment against the scope's rules (its `purposeText`, §2a.4): "never approve with an unconfirmed assumption" |
| `mentor` | `after-reply` | Explains, in at most two lines, a term or a decision in the reply that the learned items say the person may not know |
| `daily-summary` | `daily` | Once a day, at the first app start: what was done yesterday (closed tasks, notes, approvals, spend), from titles only |
| `custom` | the moments it lists | Its `text` joins the personality in its brief |

**The new moments:**
- **`before-approve`.** The person presses "Aprobar" on a reviewed document (`2026-10-27-document-review-and-focus-design.md` §5.4). The input is the document's open questions, its comments and the scope's rules. The approval waits, like a pre-send review: about 6 s, then it goes through, and ⌘⏎ approves at once.
- **`phase-change`.** A phase change is proposed or made (`2026-10-25-task-phases-design.md`). It never blocks.
- **`daily`.** It runs once a day per app, after setup. Its card waits in the panel.
- **`place:<id>`.** The harness asks for it (§2a.5).

**Several purposes in one moment.** When the sidekick that speaks has more than one purpose for the moment (`prompt-coach` and `mentor` both speak `after-reply`), it makes one model call. The turn's brief lists every such purpose, and the card may carry a part for each.

### 2a.3 Who speaks (D11)

1. **Candidates** are the sidekicks turned on in the open scope (§2a.4) with a purpose for the moment.
2. **Free routing first.** A local-check flag (§4.1) goes to a `prompt-coach` candidate, and a free heads-up (§4.3) to a `focus` candidate, whatever the order.
3. **Otherwise** the first candidate in the person's order speaks.
4. **Only that sidekick** runs its local checks' follow-up, calls the model and shows its card. The others stay quiet for that moment.
5. **No candidate:** nothing happens, at no cost.

### 2a.4 Per scope (D10)

- A record `{ scope, sidekick, on, purposeText?, places? }` in the `sidekick` collection, one per scope and sidekick.
- A scope with no record uses the sidekick's `defaultOn`, which is `true` when the sidekick is created or adopted. The person can change it in Settings › Sidekicks.
- `purposeText` (up to 600 characters) is the scope's own purpose: "en este proyecto, cuidá que nadie apruebe un spec sin AC".
- `places` limits which harness places the sidekick answers in this scope.
- `purposeText` goes into the per-turn context (§5), not into the sidekick's `AGENTS.md`, so its cached prefix stays the same across scopes.

### 2a.5 Harness places

```ts
sidekick: {
  places: [
    { id: "terminal", label: "Terminal", description: "Output of an agent's CLI session; flag errors the person may miss." },
  ],
},
```

- The harness UI calls `client.sidekick.ask(place, input)`, with `input` a string of up to 4,000 characters.
- The core routes the call as in §2a.3, among the candidates with that place: a `custom` purpose listing `place:terminal`, or a scope record whose `places` names it.
- The answer comes back as a card in the panel, and also to the harness as `{ sidekick, text } | null`.
- It follows the shared cap.

### 2a.6 Import (D13)

- **Where:** Settings › Sidekicks › "Importar".
- **Two ways in:**
  - **Paste** the text;
  - **or pick files** with the system picker. The main process refuses any path inside `~/.claude` or `~/.codex`, resolved through links: "Estos archivos son de la configuración de un motor. Copiá o pegá su contenido."
- **Conversion.**
  - One `sidekick`-process turn, with no tools, gets the text and the core's conversion brief.
  - It returns `{ name, personality, purposes, learned: string[] }`, parsed with zod.
  - What is not rules or a profile (a task queue, logs) is ignored, and listed as "No se importó: …".
- **Confirmation.**
  - The person sees the result, editable, with the copy notice: "Es una copia: los cambios en el original no llegan acá."
  - A required checkbox: "Entiendo que es una copia".
  - Confirming creates the sidekick, and the learned items are added as shared items with `source: "person"`.
- **Source changed.** For files, `source` keeps the paths and a hash. At app start, if the hash changed, Settings shows "El original cambió · Traer cambios", which runs the conversion again and shows a diff to confirm. Both the hash check and "Traer cambios" resolve the paths again and apply the same `~/.claude` / `~/.codex` refusal, since a link may now point there.

### 2a.7 Presets (D14)

```ts
sidekick: {
  presets: [
    { name: "Guardián", mark: "🛡️", personality: "…", purposes: [{ id: "process-guard" }, { id: "focus" }] },
  ],
},
```

- **When they are offered:** the first time the person opens the Sidekick panel, or in Settings › Sidekicks › "Sugeridos por el harness".
- **Adopting one** copies it into the person's sidekicks. A later harness update never changes an adopted copy.

## 3. Manifest

```ts
sidekick: {
  default: "on",                                   // "on" | "off": the state for a new profile
  tips: "Essays: one section per task. Claims need a source. APA style unless a decision says otherwise.",
  // or per purpose: tips: { "prompt-coach": "…", mentor: "…" }
  actions: { "draft-section": "auto", "free-chat": "auto", "export": "off" },   // "auto" | "always" | "off"
  checks: { minWords: 6 },                         // local-check thresholds (§4.1)
  places: [ /* §2a.5 */ ],
  presets: [ /* §2a.7 */ ],
},
```

- **Without `presets`,** a new profile gets one sidekick, "Sidekick", with the `prompt-coach` and `focus` purposes and a neutral personality: the single sidekick of the first version of this spec.
- **Checks** (in addition to the ones below):
  - place ids follow the action-id pattern and are unique;
  - preset purposes are known ids, or `custom` with a `text` and known moments;
  - personalities stay within 1,500 characters.

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

- **Several sidekicks (2026-10-27).** One session per sidekick and task, opened the first time that sidekick speaks in the task. Its working folder is `.harness/sidekick/<sidekick id>/`, holding its own `AGENTS.md`:
  - the core's rules;
  - its personality and purposes;
  - the harness `tips` (the per-purpose ones for its purposes);
  - the shared learned items.

  The scope's `purposeText` goes into the per-turn context. The rest of this section applies to each sidekick's session.
- **Moments with no task open.** `daily`, and a `place:` ask made while no task is open, run as a one-turn session in the same folder: no `--resume`, closed after the turn. They count against the shared cap (D8), charged to the app day instead of a task.
- **One Sidekick session per task**, opened at the first Sidekick turn and closed when the task closes. It is reused for every moment, so the cached prefix pays once. This matters on Codex, where the prefix alone is about 15k tokens (plan 3c, spike S7).
  - It is a second `Transport` next to the task's, with its own session id.
  - Claude: one `claude -p --resume` process per turn, as `ClaudeCliTransport` does today.
  - Codex: a second ACP session.
- **No tools, its own working folder.**
  - cwd is `<profile folder>/.harness/sidekick/<sidekick id>/`, which holds its own `AGENTS.md` (plus the engine's file). The task's instructions, MCP servers and permissions never load.
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
  { at, task, scope, action, sidekick, moment: "pre" | "after" | "heads-up" | "before-approve" | "phase-change" | "daily" | "place", kind, outcome: "used" | "edited" | "sent-anyway" | "dismissed" | "muted" | "timeout", confidence }
  ```
- **Per sidekick (D12).** Thresholds (§6.2) and muting (§6.3) are computed per `sidekick` and `kind`: ignoring the mentor never quiets the prompt coach. The learned items (§6.4) are shared by every sidekick.
- Like `usage.jsonl`, it is not tracked by the history, never leaves the machine, and is trimmed to the last 2000 lines.

### 6.2 Thresholds per kind (free)

- The app derives, from the events, a show threshold for each `kind`: the more the person ignores a kind, the higher its threshold.
- Starting threshold is 0.5. A kind used in under 20% of its last 10 cards rises to 0.8.
- This is deterministic, so it needs no model.

### 6.3 Muting (free)

- "Don't flag …" mutes that `kind` at once, and adds a learned item marked `source: "person"`.
- It can be undone from Settings.

### 6.4 The profile

- **Storage.** A reserved app-wide collection, `sidekick` (`scopes-and-data` spec §4), holds the Sidekick settings and the learned items of both levels:

  ```ts
  { id, text: string, level: "you" | "harness", kind?: string, source: "learned" | "person", updatedAt }
  ```

  It is `agent: "none"`: the task agent never sees it. It gets schema checks, history and undo for free.
- **Update.**
  - At task close, if there are at least 5 new events since the last update, one Sidekick turn gets the current items and the new events. It returns `{ add, update, remove }`.
  - Items with `source: "person"` are never changed or removed by learning.
  - The app applies the result through the data store, with `who: "app"`.
- **Two levels (D4)**, both in the profile's `sidekick` collection:
  - **`you`:** items about the person in general ("takes scope fixes", "writes short prompts");
  - **`harness`:** items about how the person works in this harness ("sections stay under 400 words").
- **No sharing between apps** (Marco, 2026-10-25). Each app keeps its own copy, even of the `you` items. Another Human Harness app learns the same person from zero.
  - This keeps every learned item inside the app's folder, covered by its history and backup.
  - It also needs no path outside the folder, and no identity across apps.
  - With profiles, each profile has its own items, like every other piece of data.
- **In Settings** (mockup, board 6), "What Sidekick learned" shows both columns:
  - each item has "Forget this";
  - "Edit" opens the items as an editable list;
  - "Forget everything" asks once, then clears both levels.

## 7. UI

- **Several sidekicks (2026-10-27).**
  - The panel head shows the mark and name of the sidekick that spoke last.
  - A row of small marks shows which sidekicks are on in this scope.
  - Every card names who speaks.
  - The top-bar toggle turns all of them off or on, and each one can be turned off from its mark.
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
- **Several sidekicks (2026-10-27).** The tab is named **Settings › Sidekicks** and adds:
  - the list of sidekicks, ordered by drag (the order decides who speaks, D11);
  - create and edit: name, mark, personality, purposes, and for a `custom` purpose its text and moments;
  - "Importar" (§2a.6) and "Sugeridos por el harness" (§2a.7);
  - per sidekick, its muted kinds and its share of the week's spend;
  - "Lo que aprendieron de vos", shared (§6.4).

  Each scope gets "Sidekicks de este proyecto" (or the scope's label) in the scope's own settings: one switch per sidekick, its `purposeText`, and its places (§2a.4).
- **Usage.** `usage.jsonl` lines also carry `sidekick: <id>`. The cap per task is shared by every sidekick.
- **Usage.**
  - Sidekick turns are logged in `usage.jsonl` with `process: "sidekick"`, and `phase` set to `pre`, `after` or `learn`. This is a new field on `UsageMeta` in `packages/shell/src/main/usage-log.ts`.
  - Settings › Usage can split Sidekick's spend from the task's.
- **No promised savings.** The tab shows only measured numbers. Whether Sidekick pays for itself is measured during dogfooding (§12, Q1), never claimed.

## 9. Depends on

| Spec | For |
|---|---|
| Scopes + data | the `sidekick` collection, notes index per scope, `who: "app"` writes |
| Profiles | per-person settings and learned items |
| Harness settings | the deferred `AGENTS.md` rewrite pattern, the Settings tab pattern |
| Task phases | the phase goal, off-phase checks |
| Input blocks | free-text fields of input blocks are reviewed like the composer (pre-send only) |
| Document review (`2026-10-27-document-review-and-focus-design.md`) | the `before-approve` moment; Sidekick heads-ups pause in focus mode |
| Parallel tasks (`2026-10-27-parallel-tasks-and-jobs-design.md`) | the `focus` heads-ups about waiting tasks; jobs never get a sidekick |

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

4. **Several sidekicks (2026-10-27).**
   - Sidekick records, the order and routing per moment (§2a.3), one session per sidekick, the shared cap.
   - Per-sidekick thresholds and muting.
   - The scope records and their settings.
   - The `focus`, `process-guard`, `mentor` and `daily-summary` purposes, and `custom`.
   - The `before-approve`, `phase-change` and `daily` moments.
5. **Places, presets and import.** `client.sidekick.ask`, `presets`, import by paste or picker with the `~/.claude` / `~/.codex` refusal, the copy confirmation, "El original cambió".

Tests added by slices 4–5:
- routing: order, a flag routed to `prompt-coach`, no candidate;
- the shared cap;
- thresholds and muting per sidekick, with learned items shared;
- `before-approve` waiting and ⌘⏎;
- `daily` once per day;
- `client.sidekick.ask` with and without a candidate;
- import: the picker refusing `~/.claude` (also through a link), confirmation needing the checkbox, "El original cambió" after a hash change;
- E2E with two sidekicks, one speaking before send and the other before approve.

## 11. Language

Sidekick thinks in English (`language-on-demand` spec), like every agent in the core. What it writes for the person follows two rules (Marco, 2026-10-25):
- **The rewrite and the queued prompts keep the language of the person's prompt.** A prompt in Spanish gets a rewrite in Spanish.
- **The issues, the gap and the heads-up texts use the app's UI language.**

The core's Sidekick rules in its `AGENTS.md` say both. The JSON contract carries no language field.

## 12. Open questions

1. **Is it worth it?** Track with mock mode and dogfooding:
   - Sidekick's share of a task's tokens;
   - the share of prompts that reached the model;
   - the share of cards used.

   Set the default cap and the `auto` thresholds from those numbers before making Sidekick default `on` in any harness.
2. **The local-check word lists in other languages.** They ship in English. A harness in another language needs lists in that language; that is part of the language spec's agentic translation.
