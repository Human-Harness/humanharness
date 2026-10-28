# Plan 5b — Language on demand (translation run, picker, cache) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person picks any (left-to-right) language once the app is set up; after a notice, the person's own AI engine translates the app's English strings (core plus harness, never legal texts) in batches through a `save_translation` tool. Each translated string is validated, then cached with a hash of the English it came from, and the screen switches live. The AI keeps thinking in English. People and harnesses that never change language see the app exactly as today.

**Architecture:** Spec `docs/superpowers/specs/2026-10-25-language-on-demand-design.md`. This plan covers §2 (picker list), §3, §4, §5, §6, §7 last bullet, §8, §9 and §10. Plan 5a (`2026-10-25-05a-english-core.md`) already shipped D1, D4, D6, D7, §1 and §7.

The work splits into five parts:

- **Pure logic.** In `@humanharness/i18n/translate`, with no Node and no i18next imports. It flattens the English strings, groups plural keys, skips `legal.` keys, hashes the English and checks each translation. The screens and the main process both use it.
- **Engine session.** A new multi-turn `runSystemSession` in `@humanharness/runtime` opens one engine session in an empty folder under the app's data, with only a new `translate` MCP server from `@humanharness/blocks`. The server offers one tool, `save_translation`, and each batch is one turn.
- **Main process.** A `TranslationService` in `packages/shell/src/main/translation.ts` plans the batches, validates every save, writes `<userData>/locales/<tag>.json`, logs each turn as `phase: "translate"` and pushes its state on `hh:language`.
- **Screens.** A `useLanguage` hook in `HarnessApp` loads the cached strings into i18next at start and on switch. Settings › General gets the Language row (picker, progress, Try again, new texts), Home gets the offer card, setup gets one line, and every legal block gets the "Legal texts are shown in English." line.
- **Fake engine.** It answers translation turns with a `pseudoTranslate` step, so the end-to-end tests run with no AI.

**Tech Stack:** TypeScript, zod 4, i18next 26 / react-i18next 17 (`Trans` for the one bolded word), React 19, Electron 44 (electron-vite), `@modelcontextprotocol/sdk` (already a dependency of `blocks`), vitest + happy-dom, Playwright 1.63. ICU `Intl.PluralRules`, `Intl.DisplayNames`, `Intl.Locale` and `Intl.getCanonicalLocales` (Node 22 / Chromium ship full ICU). **No new dependencies.** The only new package edge is workspace-internal: `@humanharness/shell` → `@humanharness/i18n` (Apache-2.0, ours).

**Gate:** `corepack pnpm typecheck && corepack pnpm test` from the repo root after every task; `corepack pnpm e2e` at Task 24 and Task 26.

**Hard rules (apply to every task):**
- **D0.** A harness, and a person, that never changes language sees exactly today's app: English screens, and no new file under userData (`locales/` is created only by a translation run). The offer card never shows when the saved language and the system language are both English. `createI18n(lang, locales)` with no generated strings builds exactly the resources it builds today.
- **The AI thinks in English.** Only UI strings are translated. `AGENTS.md`, briefs, notes and every prompt stay English (5a). The translation prompt is English.
- **No credential reads.** No product code and no agent reads `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode` or any credential or account file. The translation session's working folder is an empty temporary folder under `<userData>/translate-work/`. Its permissions are `{ edit: "none", exec: false, web: false }`, and its only MCP server is `translate`.
- **CSP stays as it is** (`packages/shell/src/renderer/index.html`). No new dependency.
- **Agent output is untrusted.** IPC answers are data, and preload invokes catch rejections. Every size and time is bounded: keys per save (150), key length (200), text length (≤ 4000 and ≤ max(80, 4 × English)), keys per run (5000), batches per run (60), turn time (4 min), cache file size (4 MB) and harness strings sent by the window (5000 keys). A translation must keep the same keys, placeholders and tags, and may add no new markup, no `$t(` nesting, no control or bidi-override characters and no new newline.
- **CSS and focus.** New CSS classes are unique (`hh-langpick-*`, `hh-langnotice-*`, `hh-langoffer*`, `hh-langrow-*`, `hh-legal-english`, `hh-setup-language`). Dialogs trap Tab (`trapTab`), close on Escape (with `stopPropagation` so the Settings sheet doesn't also close) and return focus to the element that opened them.

---

## Decisions

1. **One language, both for the screen and for the AI.** `config.language` remains the single setting. Picking a language with no complete translation changes nothing until its run completes. Only then is `config.language` saved and the screen switched. A saved language with no cache (5a's system-language default, §10 migration) keeps today's behaviour: English screens, the AI writing in that language.
2. **Where the harness strings come from.** The window passes its harness's English map (`locales.en`, the same object `HarnessApp` already receives) on every `client.language.*` call. The main process bounds and flattens it (`flattenStrings`) and never trusts its size. Core English comes from `@humanharness/i18n/translate` (bundled into main).
3. **Pure logic lives in `packages/i18n/src/translate.ts`.** It has no Node and no i18next imports and is exported as `@humanharness/i18n/translate`. The renderer uses `toResources`, and main uses the rest. `@humanharness/i18n` joins the shell's bundled `workspacePackages` (main never imports `@humanharness/i18n` root, so i18next stays out of main).
4. **Hash = cyrb53 (53-bit, hex), not SHA-256.** It must run in the renderer too and only detects changed English. A plural group hashes the JSON of its sorted English forms.
5. **Plurals.** English keys `x_one`/`x_other` (and any `_zero`/`_two`/`_few`/`_many`) whose group has an `_other` are sent as one item `x` with an object of English forms. The agent answers with exactly `Intl.PluralRules(tag).resolvedOptions().pluralCategories`. The cache stores the object, and the resources expand it back to `x_<form>`.
6. **Cache file** `<userData>/locales/<tag>.json` = `{ version: 1, tag, entries: { "<ns>:<key>": { en, value } }, failed: { "<ns>:<key>": { en, count } } }`. A key that failed twice for the same English is final: it stays English and is not sent again until its English changes. Entries are checked again on every read, so a hand-edited cache can't inject markup.
7. **Same session, one turn per batch.** Batches hold 100 keys. Claude runs with session persistence on, so turns resume (`--resume`), and Codex/OpenCode keep the ACP session open. Each turn has its own 4-minute timeout. Keys that failed once go in extra batches at the end of the same run (§6 "sent once more in a later batch").
8. **Model.** Light tier: `resolveProfile({ engine, action: "_translate", manifestTier: "light", models })`, then `firstOffered` and `supportedEffort`, like the material stages. `_translate` is not shown in Settings › Models, so the tier is always light.
9. **Usage.** Each turn appends `{ phase: "translate", language, batch, ... }` to the current base's `.harness/usage.jsonl`. With profiles and no active profile, nothing is logged. `summarizeUsage` leaves translate lines out of task estimates, like material.
10. **Picker list.** `Intl.supportedValuesOf` has no `"language"` key, so §2's "where available" never applies. The list is a fixed `COMMON_LANGUAGES` in `harness-sdk/language.ts`, plus the saved language, the cached ones and the suggestion. Each language is listed by its own name, with its English name under it. Right-to-left tags are filtered (`Intl.Locale#getTextInfo` / `textInfo`, plus the spec's fixed list).
11. **The system language** is `systemLanguage()` (`navigator.language`, canonical) in the renderer. In Electron it equals `app.getLocale()`, and 5a already uses it.
12. **One run at a time.** A second start answers `busy`. Quitting, an engine change and `stop()` abort the run, and what was saved stays.
13. **Legal keys.** `engine.notice*` and `engine.accept` move to `legal.engine.*`. A harness's own legal strings go under `legal.` in its `en.json` too. The `engine.terms`/`engine.privacy` link labels stay translatable: they name a document and are not legal text.
14. **The open task keeps its language (§7).** `TaskManager` records the language when a task begins, and every later prompt of that task uses it (mode switch, phase change, resume, wrap-up, answer display). It's kept in memory only, so a restart reads the saved language again.
15. **Fake engine.** A new script step `{ pseudoTranslate: { prefix?, server?, breakKeys? } }` in `fake-claude` reads the batch in the prompt and calls `save_translation` with `"<prefix> <English>"` (placeholders and tags kept). `breakKeys` drops a placeholder, to test validation.
16. **Translations of the notice's bold word** use `<Trans>` with a `<b>` component. This is the first tag in `en.json`, and it exercises the "same tags" rule.

## Conflicts with the spec

- **§3/D8, the offer card vs D0.** The spec shows the card to everyone once after setup. To keep D0 for English users, the card shows only when there is a non-English suggestion: the saved language if it isn't English and isn't complete, else the system language if it isn't English. English users find the language in Settings › General.
- **§10, migration dialog vs card.** The spec opens the §4 dialog at the next launch for a saved `es`. The plan shows the same suggestion as the Home card instead: "Use {{name}} in another language?" with Español suggested, then the §4 notice. Nothing modal opens at launch. Settings › General also says "The app's texts aren't in Español yet." with Translate.
- **§3, "the picker is disabled" without an engine.** The picker still opens so a person can always go back to English or to a complete cached language. Every language that would need a translation is disabled, with "Connect an AI engine to translate the app." This covers mock mode too.
- **§2, "built from `Intl.supportedValuesOf`".** Not possible (no `"language"` key): see Decision 10.
- **§5, "the working folder is an empty folder in the app's data".** Kept (`<userData>/translate-work/<random>`). Claude's own session record lands in the engine's store because turns must resume. The app never reads it.

## File Structure

| File | Responsibility |
|---|---|
| `packages/harness-sdk/src/language.ts` (modify) | `COMMON_LANGUAGES`, `isRightToLeft`, `offeredLanguage`, `pickerLanguages` |
| `packages/i18n/src/translate.ts` (create) | Flatten, plural grouping, `legal.` skip, hash, `checkTranslation`, `toResourceEntries`, `toResources`, `pluralForms`, `CORE_EN` |
| `packages/i18n/src/index.ts` (modify) | `createI18n(language, harness, generated?)` |
| `packages/i18n/src/locales/en.json` (modify) | `legal.engine.*`, `language.*`, `setupFlow.languageLater`, new `settings.languageHint` |
| `packages/i18n/package.json` (modify) | `./translate` export |
| `packages/blocks/src/translate-server.ts`, `translate-server-bin.ts` (create); `launch.ts`, `index.ts` (modify) | The `translate` MCP server and its spec |
| `packages/runtime/src/system-session.ts` (create); `index.ts` (modify) | `runSystemSession`: one session, several turns |
| `packages/fake-agent/src/pseudo.ts` (create); `script.ts`, `fake-claude.ts` (modify) | `pseudoTranslate` step |
| `packages/shell/src/main/task-prompts.ts` (modify) | `TRANSLATE_PROMPT`, `TRANSLATE_NEXT`, `translatePrompt` |
| `packages/shell/src/main/usage-log.ts` (modify) | `translate` turn kind, `translateRecord`, summary skips it |
| `packages/shell/src/main/translation-cache.ts` (create) | Bounded, atomic read/write of `<userData>/locales/<tag>.json` |
| `packages/shell/src/main/translation.ts` (create) | `TranslationService`: state, choose, translate, cancel, strings, stop |
| `packages/shell/src/main/language-ipc.ts` (create) | `hh:language*` handlers, every answer data |
| `packages/shell/src/main/config.ts`, `validate.ts` (modify); `packages/ui/src/client.ts` (modify) | `languageOffered` config flag; language types and `LanguageClient` |
| `packages/shell/src/main/index.ts`, `electron.vite.config.ts`, `package.json` (modify) | Wiring, `translate-server` entry, i18n bundled |
| `packages/shell/src/main/task-manager.ts` (modify) | The open task keeps its language |
| `packages/shell/src/preload/language.ts` (create); `preload/index.ts` (modify) | `client.language` |
| `packages/ui/src/LanguagePicker.tsx`, `TranslateNotice.tsx`, `LanguageChooser.tsx`, `language-control.ts` (create) | Dialogs and the hook |
| `packages/ui/src/HarnessApp.tsx`, `SettingsSheet.tsx`, `Home.tsx`, `SetupFlow.tsx`, `EngineOnboarding.tsx`, `EngineTab.tsx`, `styles.css`, `index.ts` (modify) | Screens |
| `packages/ui/test/fake-client.ts` (modify) | `language` stub |
| `packages/e2e/tests/language.spec.ts` (create); `helpers.ts` (modify) | End-to-end |
| `docs/architecture/language.md` (create); `mock-mode.md`, `setup.md`, `engines.md`, `packages/cli/guide/new-harness.md`, roadmap (modify) | Docs |

## Open questions

1. Should English-system users also see the offer card once (spec D8 literally)? **Default:** No. The card shows only with a non-English suggestion (see Conflicts), to keep D0.
2. Migration (§10): should a modal open at launch, or a Home card? **Default:** The Home card plus the Settings row. Nothing modal at launch.
3. Should the picker allow English and complete languages without an engine? **Default:** Yes. Only languages that need a translation are disabled.
4. Batch size? **Default:** 100 keys, with no test hook to change it.
5. Should Codex/OpenCode's fake (`fake-acp`) also pseudo-translate? **Default:** No. Only `fake-claude`, which the e2e and mock mode use. The runtime test covers ACP with a scripted `mcp` step.
6. When a run is cancelled, should the language switch anyway with what is done? **Default:** No. It stays in the current language, and "Try again" resumes.
7. Should translate turns count in Settings › Usage totals? **Default:** They are logged, and are left out of per-task estimates and per-scope totals like material, but there's no separate "Translation" line in this plan.

## Marco's answers

Marco is away: every open question above takes the plan's **Default**.

---

### Task 0: Bring the spec onto the branch and commit the plan

**Files:**
- Verify: `docs/superpowers/specs/2026-10-25-language-on-demand-design.md`
- Create: `docs/superpowers/plans/2026-10-28-language-on-demand.md`

- [ ] **Step 1: Create the branch**

```bash
git switch -c feat/language-on-demand feat/context-panel
```

- [ ] **Step 2: Make sure the spec on the branch is master's**

Run: `git diff --stat feat/context-panel origin/master -- docs/superpowers/specs/2026-10-25-language-on-demand-design.md`
Expected: no output (identical). If it differs or is missing: `git checkout origin/master -- docs/superpowers/specs/2026-10-25-language-on-demand-design.md`.

- [ ] **Step 3: Copy this plan into the repo**

Copy this file to `docs/superpowers/plans/2026-10-28-language-on-demand.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-25-language-on-demand-design.md docs/superpowers/plans/2026-10-28-language-on-demand.md
git commit -m "docs: plan 5b, language on demand

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

Every later commit ends with the same two trailer lines (shown once per task as `<trailer>`; write them out in full).

---

### Task 1: harness-sdk — the picker's languages, right-to-left excluded

**Files:**
- Modify: `packages/harness-sdk/src/language.ts`
- Test: `packages/harness-sdk/test/language.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { COMMON_LANGUAGES, isRightToLeft, offeredLanguage, pickerLanguages } from "../src/language";

describe("picker languages (spec §2, D9)", () => {
  it("knows right-to-left languages from ICU or the fixed list", () => {
    for (const tag of ["ar", "he", "fa", "ur", "ps", "yi", "dv", "ckb", "sd", "ug", "ar-EG"]) expect(isRightToLeft(tag)).toBe(true);
    for (const tag of ["en", "es", "pt-BR", "ja", "zh-Hant"]) expect(isRightToLeft(tag)).toBe(false);
  });

  it("offers a canonical, left-to-right tag only", () => {
    expect(offeredLanguage("pt-BR")).toBe(true);
    expect(offeredLanguage("pt-br")).toBe(false);
    expect(offeredLanguage("he")).toBe(false);
    expect(offeredLanguage("not a tag")).toBe(false);
    expect(offeredLanguage("x".repeat(40))).toBe(false);
  });

  it("lists English first, then by English name, with extras added once and RTL dropped", () => {
    const list = pickerLanguages(["es", "gl", "ar", "gl", "bad tag"]);
    expect(list[0]).toBe("en");
    expect(list).toContain("gl");
    expect(list).not.toContain("ar");
    expect(list.filter((t) => t === "gl")).toHaveLength(1);
    expect(COMMON_LANGUAGES.every((t) => !isRightToLeft(t))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/harness-sdk/test/language.test.ts`
Expected: FAIL. `COMMON_LANGUAGES` is not exported.

- [ ] **Step 3: Implement** (append to `packages/harness-sdk/src/language.ts`)

```ts
/** Right-to-left languages the picker never offers (spec D9), when ICU doesn't say. */
const RTL = new Set(["ar", "he", "fa", "ur", "ps", "yi", "dv", "ckb", "sd", "ug"]);

/** Common languages the picker lists (spec §2: `Intl.supportedValuesOf` has no language list). All left-to-right. */
export const COMMON_LANGUAGES: readonly Language[] = [
  "en", "es", "pt-BR", "pt-PT", "fr", "de", "it", "nl", "ca", "gl", "eu", "pl", "cs", "sk", "hu", "ro", "bg", "hr", "sr", "sl",
  "el", "uk", "ru", "lt", "lv", "et", "fi", "sv", "da", "nb", "is", "tr", "id", "ms", "fil", "vi", "th", "hi", "bn", "ta", "te",
  "mr", "sw", "ja", "ko", "zh-Hans", "zh-Hant",
];

/** Whether `tag` is written right to left: ICU's text info when it has one, else the spec's fixed list. */
export function isRightToLeft(tag: Language): boolean {
  try {
    const locale = new Intl.Locale(tag) as Intl.Locale & { getTextInfo?: () => { direction?: string }; textInfo?: { direction?: string } };
    const direction = locale.getTextInfo?.().direction ?? locale.textInfo?.direction;
    return direction === "rtl" || RTL.has(locale.language);
  } catch {
    return false;
  }
}

/** A tag the app can offer and translate into: canonical (at most 35 characters) and left to right. */
export function offeredLanguage(tag: unknown): tag is Language {
  return typeof tag === "string" && tag.length <= 35 && canonicalLanguage(tag) === tag && !isRightToLeft(tag);
}

/** The picker's list: English first, then the common languages and `extra` (cached, saved, suggested), by English name. */
export function pickerLanguages(extra: readonly string[] = []): Language[] {
  const rest = [...new Set([...COMMON_LANGUAGES, ...extra])].filter((t) => t !== DEFAULT_LANGUAGE && offeredLanguage(t));
  rest.sort((a, b) => languageName(a).localeCompare(languageName(b), "en"));
  return [DEFAULT_LANGUAGE, ...rest];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/harness-sdk`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/harness-sdk
git commit -m "feat(sdk): the picker's languages, right-to-left ones left out

<trailer>"
```

---

### Task 2: i18n — legal strings under `legal.` and the new language strings

**Files:**
- Modify: `packages/i18n/src/locales/en.json`
- Modify: `packages/ui/src/EngineOnboarding.tsx:268-276`, `packages/ui/src/EngineTab.tsx:233`
- Test: `packages/i18n/test/i18n.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `packages/i18n/test/i18n.test.ts`; update the existing `settings.languageHint` expectation to the new text below)

```ts
describe("legal strings (spec §8)", () => {
  const en = CORE_LOCALES.en as Record<string, any>;
  it("live under legal., and the engine block keeps no notice text of its own", () => {
    expect(Object.keys(en.legal.engine).sort()).toEqual(["accept", "noticeAccount", "noticeContent", "noticeProvider", "noticeTitle", "noticeTraining", "noticeUserProvider"]);
    expect(Object.keys(en.engine).filter((k) => k.startsWith("notice") || k === "accept")).toEqual([]);
  });

  it("the language strings exist, and the notice bolds one word with <b>", () => {
    expect(en.language.notice).toContain("<b>{{language}}</b>");
    expect(en.language.legalEnglish).toBe("Legal texts are shown in English.");
    expect(en.language.needsEngine).toBe("Connect an AI engine to translate the app.");
    expect(en.setupFlow.languageLater).toBe("You can choose the app's language once it's set up.");
  });
});
```

Existing `settings.languageHint` expectation becomes: `"The AI always thinks in English and writes to you in this language."`

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/i18n`
Expected: FAIL. `en.legal` is undefined.

- [ ] **Step 3: Move and add the strings**

In `packages/i18n/src/locales/en.json`:
- Remove `engine.noticeTitle`, `engine.noticeProvider`, `engine.noticeTraining`, `engine.noticeAccount`, `engine.noticeContent`, `engine.noticeUserProvider` and `engine.accept` from `engine`, and add them unchanged as a top-level `"legal": { "engine": { ... } }`.
- Set `settings.languageHint` to `"The AI always thinks in English and writes to you in this language."`
- Add `setupFlow.languageLater`: `"You can choose the app's language once it's set up."`
- Add the top-level block:

```json
"language": {
  "change": "Change…",
  "pickTitle": "Language",
  "search": "Search languages",
  "use": "Use",
  "cancel": "Cancel",
  "ready": "Ready",
  "needsEngine": "Connect an AI engine to translate the app.",
  "noticeTitle": "Translate the app?",
  "notice": "To show {{name}} in <b>{{language}}</b>, your AI engine ({{engine}}) will translate the app's texts. It runs once, takes a minute or two and uses a little of your plan. Legal texts stay in English.",
  "translate": "Translate",
  "progress": "Translating… {{done}} of {{total}}",
  "stopped": "The translation stopped. What it finished is kept.",
  "tryAgain": "Try again",
  "newTexts": "Some texts are new. Translate them?",
  "notYet": "The app's texts aren't in {{language}} yet.",
  "offerTitle": "Use {{name}} in another language?",
  "offerSuggested": "Suggested: {{language}}",
  "offerChoose": "Choose language",
  "offerLater": "Not now",
  "legalEnglish": "Legal texts are shown in English.",
  "failed": "That didn't work. Try again."
}
```

In `EngineOnboarding.tsx` rename the seven `t("engine.notice…")`/`t("engine.accept")` calls to `t("legal.engine.notice…")`/`t("legal.engine.accept")`. In `EngineTab.tsx:233` rename `engine.noticeContent` → `legal.engine.noticeContent`. Run `grep -rn '"engine.notice\|engine.accept' packages/ harnesses/` and fix any other hit (expect none).

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/i18n packages/ui && corepack pnpm typecheck`
Expected: PASS. The UI tests look for English text, which is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n packages/ui/src/EngineOnboarding.tsx packages/ui/src/EngineTab.tsx
git commit -m "feat(i18n): legal strings under legal., and the language strings

<trailer>"
```

---

### Task 3: i18n/translate — items, hash and the check of a translation

**Files:**
- Create: `packages/i18n/src/translate.ts`
- Modify: `packages/i18n/package.json` (exports)
- Test: `packages/i18n/test/translate.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { CORE_EN, checkTranslation, englishItems, flattenStrings, pluralForms, textHash, toResourceEntries, toResources } from "../src/translate";

describe("flattenStrings", () => {
  it("flattens nested strings and drops what isn't a string or is out of bounds", () => {
    expect(flattenStrings({ a: { b: "B", n: 3 }, c: "C", "bad key!": "x", long: "y".repeat(4001) })).toEqual({ "a.b": "B", c: "C" });
    expect(flattenStrings(null)).toEqual({});
    expect(Object.keys(flattenStrings(Object.fromEntries(Array.from({ length: 6000 }, (_, i) => [`k${i}`, "v"]))))).toHaveLength(5000);
  });
});

describe("englishItems (spec §5, §8)", () => {
  it("namespaces keys, groups plurals and never sends legal.", () => {
    const items = englishItems({ "chat.send": "Send", "notes.keyPoints_one": "{{count}} key point", "notes.keyPoints_other": "{{count}} key points", "legal.engine.accept": "I accept" }, { title: "Notes", "legal.terms": "Terms" });
    expect(items.map((i) => i.key)).toEqual(["core:chat.send", "core:notes.keyPoints", "harness:title"]);
    expect(items[1].en).toEqual({ one: "{{count}} key point", other: "{{count}} key points" });
    expect(items[0].hash).toBe(textHash("Send"));
  });

  it("the core's own English never includes a legal key", () => {
    expect(englishItems(CORE_EN, {}).some((i) => i.key.startsWith("core:legal."))).toBe(false);
  });
});

describe("checkTranslation (spec §6)", () => {
  const send = { key: "core:chat.send", en: "Send {{name}}", hash: "h" };
  it("keeps a good text", () => expect(checkTranslation(send, "Enviar {{name}}", ["one", "other"])).toEqual({ ok: true, value: "Enviar {{name}}" }));
  it("refuses empty, missing or extra placeholders, markup, nesting, control and bidi characters, too long", () => {
    for (const [bad, reason] of [
      ["  ", "empty"],
      ["Enviar", "placeholders"],
      ["Enviar {{name}} {{other}}", "placeholders"],
      ["Enviar <script>{{name}}", "markup"],
      ["Enviar <i>{{name}}</i>", "markup"],
      ["$t(legal.engine.accept) {{name}}", "markup"],
      ["Enviar‮ {{name}}", "control"],
      ["Enviar\n{{name}}", "control"],
      ["x".repeat(90) + "{{name}}", "too-long"],
    ] as const) expect(checkTranslation(send, bad, ["other"])).toEqual({ ok: false, reason });
    expect(checkTranslation(send, 42, ["other"])).toEqual({ ok: false, reason: "empty" });
  });
  it("keeps the English tags", () => {
    const notice = { key: "core:language.notice", en: "In <b>{{language}}</b>.", hash: "h" };
    expect(checkTranslation(notice, "En <b>{{language}}</b>.", ["other"]).ok).toBe(true);
    expect(checkTranslation(notice, "En {{language}}.", ["other"])).toEqual({ ok: false, reason: "markup" });
  });
  it("wants every plural form the language needs", () => {
    const plural = { key: "core:notes.keyPoints", en: { one: "{{count}} point", other: "{{count}} points" }, hash: "h" };
    const forms = pluralForms("pl");
    expect(forms).toEqual(["few", "many", "one", "other"]);
    expect(checkTranslation(plural, { one: "{{count}} punkt", few: "{{count}} punkty", many: "{{count}} punktów", other: "{{count}} punktu" }, forms).ok).toBe(true);
    expect(checkTranslation(plural, { one: "{{count}} punkt", other: "{{count}} punktu" }, forms)).toEqual({ ok: false, reason: "forms" });
    expect(checkTranslation(plural, "{{count}} punkt", forms)).toEqual({ ok: false, reason: "forms" });
  });
});

describe("resources", () => {
  it("expands plural objects and nests by namespace; legal keys are dropped", () => {
    const flat = {
      ...toResourceEntries("core:notes.keyPoints", { one: "1 punto", other: "{{count}} puntos" }),
      ...toResourceEntries("harness:title", "Notas"),
      "core:legal.engine.accept": "Acepto",
    };
    expect(flat["core:notes.keyPoints_one"]).toBe("1 punto");
    expect(toResources(flat)).toEqual({ core: { notes: { keyPoints_one: "1 punto", keyPoints_other: "{{count}} puntos" } }, harness: { title: "Notas" } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/i18n/test/translate.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement `packages/i18n/src/translate.ts`**

```ts
// No Node and no i18next here: the screens and the main process both import this (`@humanharness/i18n/translate`).
import en from "./locales/en.json";

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
const CATEGORIES: readonly PluralCategory[] = ["zero", "one", "two", "few", "many", "other"];
export type Translated = string | Partial<Record<PluralCategory, string>>;

/** One thing sent for translation: a namespaced key, its English (an object of forms for a plural), and its hash. */
export interface TranslateItem {
  key: string;
  en: Translated;
  hash: string;
}

/** Keys under this prefix are never sent and always render in English (spec §8). */
export const LEGAL_PREFIX = "legal.";
export const STRING_LIMITS = { keys: 5000, keyLength: 200, text: 4000, depth: 8 } as const;
const KEY = /^[A-Za-z0-9_.-]+$/;

/** Nested string maps flattened to `a.b` keys; anything not a string, too deep, too long or past the key cap is dropped. */
export function flattenStrings(raw: unknown, limits = STRING_LIMITS): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  const walk = (node: unknown, prefix: string, depth: number) => {
    if (typeof node !== "object" || node === null || Array.isArray(node) || depth > limits.depth) return;
    for (const [k, v] of Object.entries(node)) {
      if (n >= limits.keys) return;
      const key = prefix ? `${prefix}.${k}` : k;
      if (!KEY.test(k) || key.length > limits.keyLength) continue;
      if (typeof v === "string") {
        if (v.length <= limits.text) {
          out[key] = v;
          n++;
        }
      } else walk(v, key, depth + 1);
    }
  };
  walk(raw, "", 0);
  return out;
}

/** The core's English, flattened. */
export const CORE_EN: Record<string, string> = flattenStrings(en);

/** cyrb53: a 53-bit hash of the English, to see when it changed (spec §6). Not for security. */
export function textHash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

const sortedJson = (forms: Partial<Record<PluralCategory, string>>) => JSON.stringify(CATEGORIES.filter((c) => forms[c] !== undefined).map((c) => [c, forms[c]]));

/** The plural forms `tag` needs, sorted ("pl" → few, many, one, other). */
export function pluralForms(tag: string): PluralCategory[] {
  try {
    return [...(new Intl.PluralRules(tag).resolvedOptions().pluralCategories as PluralCategory[])].sort();
  } catch {
    return ["one", "other"];
  }
}

/** What goes for translation (spec §5): every core and harness key but `legal.`, plurals grouped by their base key. */
export function englishItems(core: Record<string, string>, harness: Record<string, string>): TranslateItem[] {
  const items: TranslateItem[] = [];
  for (const [ns, map] of [["core", core], ["harness", harness]] as const) {
    const plurals = new Map<string, Partial<Record<PluralCategory, string>>>();
    for (const [k, v] of Object.entries(map)) {
      const m = /^(.*)_(zero|one|two|few|many|other)$/.exec(k);
      if (m && Object.hasOwn(map, `${m[1]}_other`)) plurals.set(m[1], { ...plurals.get(m[1]), [m[2]]: v });
    }
    const seen = new Set<string>();
    for (const [k, v] of Object.entries(map)) {
      if (k.startsWith(LEGAL_PREFIX)) continue;
      const m = /^(.*)_(zero|one|two|few|many|other)$/.exec(k);
      if (m && plurals.has(m[1])) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        const forms = plurals.get(m[1])!;
        items.push({ key: `${ns}:${m[1]}`, en: forms, hash: textHash(sortedJson(forms)) });
      } else items.push({ key: `${ns}:${k}`, en: v, hash: textHash(v) });
    }
  }
  return items;
}

export const placeholders = (s: string): string[] => [...s.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]).sort();
export const tags = (s: string): string[] => [...s.matchAll(/<\/?([A-Za-z0-9]+)\s*\/?>/g)].map((m) => m[0].replace(/\s+/g, "")).sort();
const strip = (s: string) => s.replace(/<\/?([A-Za-z0-9]+)\s*\/?>/g, "").replace(/\{\{[^{}]*\}\}/g, "");
const angles = (s: string) => (strip(s).match(/[<>]/g) ?? []).length;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F‪-‮⁦-⁩]/;

export type CheckReason = "empty" | "too-long" | "placeholders" | "markup" | "control" | "forms";
export type Checked = { ok: true; value: Translated } | { ok: false; reason: CheckReason };

function checkText(en: string, text: unknown): Checked {
  if (typeof text !== "string" || text.trim() === "") return { ok: false, reason: "empty" };
  if (CONTROL.test(text) || (text.includes("\n") && !en.includes("\n"))) return { ok: false, reason: "control" };
  if (text.length > Math.min(STRING_LIMITS.text, Math.max(80, en.length * 4))) return { ok: false, reason: "too-long" };
  if (!same(placeholders(text), placeholders(en))) return { ok: false, reason: "placeholders" };
  if (!same(tags(text), tags(en)) || angles(text) > angles(en) || (text.includes("$t(") && !en.includes("$t("))) return { ok: false, reason: "markup" };
  return { ok: true, value: text };
}

/** Whether `value` may be kept as `item`'s translation (spec §6); `forms` are the target language's plural forms. */
export function checkTranslation(item: TranslateItem, value: unknown, forms: readonly PluralCategory[]): Checked {
  if (typeof item.en === "string") return checkText(item.en, value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, reason: "forms" };
  const given = value as Record<string, unknown>;
  if (!same(Object.keys(given).sort(), [...forms].sort())) return { ok: false, reason: "forms" };
  const englishOther = item.en.other ?? Object.values(item.en)[0] ?? "";
  const out: Partial<Record<PluralCategory, string>> = {};
  for (const f of forms) {
    // Each form is checked against the English `other` (it has every placeholder); `one` may drop `{{count}}`.
    const en = item.en[f] ?? englishOther;
    const r = checkText(en, given[f]);
    if (!r.ok) return r;
    out[f] = r.value as string;
  }
  return { ok: true, value: out };
}

/** A kept translation as flat namespaced i18next keys ("core:notes.keyPoints_one"); legal keys never. */
export function toResourceEntries(key: string, value: Translated): Record<string, string> {
  if (typeof value === "string") return { [key]: value };
  return Object.fromEntries(Object.entries(value).map(([f, v]) => [`${key}_${f}`, v as string]));
}

/** Flat namespaced strings as i18next resources; anything under `legal.` or outside core/harness is dropped. */
export function toResources(flat: Record<string, string>): { core: Record<string, unknown>; harness: Record<string, unknown> } {
  const out = { core: {} as Record<string, unknown>, harness: {} as Record<string, unknown> };
  for (const [full, text] of Object.entries(flat)) {
    const i = full.indexOf(":");
    const ns = full.slice(0, i);
    const key = full.slice(i + 1);
    if ((ns !== "core" && ns !== "harness") || key.startsWith(LEGAL_PREFIX) || typeof text !== "string" || !KEY.test(key)) continue;
    const parts = key.split(".");
    let node = out[ns];
    for (const p of parts.slice(0, -1)) {
      if (typeof node[p] !== "object" || node[p] === null) node[p] = {};
      node = node[p] as Record<string, unknown>;
    }
    node[parts.at(-1)!] = text;
  }
  return out;
}
```

Note on plurals: a translated `one` form often drops `{{count}}` ("un punto"), so the plural check compares each form's placeholders with the *same* English form when it exists, else with `other`. If a language's `one` legitimately drops `{{count}}` while English `one` keeps it, the key fails twice and stays English. This is acceptable and safe.

In `packages/i18n/package.json` set `"exports": { ".": "./src/index.ts", "./translate": "./src/translate.ts" }`.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/i18n && corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n
git commit -m "feat(i18n): what is sent for translation, and the check of each translated text

<trailer>"
```

---

### Task 4: i18n — `createI18n` takes generated strings (D0: same resources without them)

**Files:**
- Modify: `packages/i18n/src/index.ts`
- Test: `packages/i18n/test/i18n.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("generated strings (spec §6)", () => {
  it("D0: no generated strings build exactly today's resources", async () => {
    const i18n = await createI18n("es");
    expect(Object.keys(i18n.options.resources ?? {})).toEqual(["en"]);
  });

  it("shows the cached strings, English for the rest and for legal keys", async () => {
    const i18n = await createI18n("es", { en: { title: "Notes" } }, { "core:chat.send": "Enviar", "harness:title": "Notas", "core:legal.engine.accept": "Acepto" });
    expect(i18n.resolvedLanguage).toBe("es");
    expect(i18n.t("chat.send")).toBe("Enviar");
    expect(i18n.t("harness:title")).toBe("Notas");
    expect(i18n.t("legal.engine.accept")).toBe("I understand and accept");
    expect(i18n.t("settings.title")).toBe("Settings");
  });

  it("English never takes generated strings", async () => {
    const i18n = await createI18n("en", {}, { "core:chat.send": "Enviar" });
    expect(i18n.t("chat.send")).toBe("Send");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/i18n/test/i18n.test.ts`
Expected: FAIL. `chat.send` is still "Send".

- [ ] **Step 3: Implement** (replace `createI18n` in `packages/i18n/src/index.ts`)

```ts
import { toResources } from "./translate";

/** Translated strings from the cache, flat and namespaced ("core:chat.send", "harness:title"). */
export type GeneratedStrings = Record<string, string>;

export async function createI18n(language: Language, harnessLocales: Locales = {}, generated: GeneratedStrings = {}): Promise<i18n> {
  const instance = i18next.createInstance();
  const extra = language !== "en" && Object.keys(generated).length > 0 ? { [language]: toResources(generated) } : {};
  await instance.init({
    lng: language,
    fallbackLng: "en",
    defaultNS: "core",
    ns: ["core", "harness"],
    interpolation: { escapeValue: false },
    resources: { en: { core: CORE_LOCALES.en, harness: harnessLocales.en ?? {} }, ...extra },
  });
  return instance;
}
```

Keep the doc comment above it and add: "`generated` (plan 5b) holds the cached translation of `language`: absent or empty, the resources are English only (D0)."

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/i18n packages/ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n
git commit -m "feat(i18n): the app's strings can come from a cached translation

<trailer>"
```

---

### Task 5: blocks — the `translate` MCP server with `save_translation`

**Files:**
- Create: `packages/blocks/src/translate-server.ts`, `packages/blocks/src/translate-server-bin.ts`
- Modify: `packages/blocks/src/launch.ts`, `packages/blocks/src/index.ts`
- Test: `packages/blocks/test/translate-server.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { type Rpc, devLauncher, openRpc, translateServerSpec } from "../src";

let rpc: Rpc | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  await rpc?.close();
  client = rpc = undefined;
});

async function connect(handler: (r: unknown) => Promise<unknown>) {
  rpc = await openRpc(handler);
  const spec = translateServerSpec({ rpc: { path: rpc.path, token: rpc.token }, launcher: devLauncher() });
  expect(spec.name).toBe("translate");
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...(process.env as Record<string, string>), ...spec.env } }));
  return client;
}

describe("translate server (spec §5)", () => {
  it("offers only save_translation, and passes the map to the app", async () => {
    const seen: unknown[] = [];
    const c = await connect(async (r) => {
      seen.push(r);
      return "Saved 2.";
    });
    expect((await c.listTools()).tools.map((t) => t.name)).toEqual(["save_translation"]);
    const res = await c.callTool({ name: "save_translation", arguments: { strings: { "core:chat.send": "Enviar", "core:notes.keyPoints": { one: "1 punto", other: "{{count}} puntos" } } } });
    expect(res.isError).toBeFalsy();
    expect(seen).toEqual([{ op: "save", strings: { "core:chat.send": "Enviar", "core:notes.keyPoints": { one: "1 punto", other: "{{count}} puntos" } } }]);
  });

  it("refuses an oversized save before it reaches the app", async () => {
    const seen: unknown[] = [];
    const c = await connect(async (r) => void seen.push(r));
    const big = Object.fromEntries(Array.from({ length: 151 }, (_, i) => [`core:k${i}`, "x"]));
    const res = await c.callTool({ name: "save_translation", arguments: { strings: big } });
    expect(res.isError).toBe(true);
    expect((await c.callTool({ name: "save_translation", arguments: { strings: { "core:a": "x".repeat(4001) } } })).isError).toBe(true);
    expect(seen).toEqual([]);
  });

  it("an app refusal comes back as a tool error the agent reads", async () => {
    const c = await connect(async () => {
      throw new Error("No batch is open");
    });
    const res = await c.callTool({ name: "save_translation", arguments: { strings: { "core:a": "b" } } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("No batch is open");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/blocks/test/translate-server.test.ts`
Expected: FAIL. `translateServerSpec` is not exported.

- [ ] **Step 3: Implement**

`packages/blocks/src/translate-server.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RpcRefused, callRpc } from "./bridge";

/** Bounds of one save (spec §5: batches of about 100 keys); the app checks every key again. */
export const SAVE_LIMITS = { keys: 150, key: 200, text: 4000 } as const;
const text = z.string().max(SAVE_LIMITS.text);
const forms = z.object({ zero: text, one: text, two: text, few: text, many: text, other: text }).partial().strict();
const strings = z
  .record(z.string().min(1).max(SAVE_LIMITS.key), z.union([text, forms]))
  .refine((o) => Object.keys(o).length <= SAVE_LIMITS.keys, `At most ${SAVE_LIMITS.keys} keys per call`);

/**
 * The `translate` MCP server (language spec §5): one tool, `save_translation`, that hands the batch's map to the app over
 * `rpc` as `{ op: "save", strings }`. The server keeps nothing; the app validates and caches.
 */
export function createTranslateServer(rpc: { path: string; token: string }): McpServer {
  const server = new McpServer({ name: "translate", version: "0.1.0" });
  server.registerTool(
    "save_translation",
    {
      description:
        "Saves this batch's translations: an object from each key you were given to its translated text (for a plural key, an object of the forms you were asked for). Call it once per batch.",
      inputSchema: { strings },
    },
    async (args) => {
      try {
        const result = await callRpc(rpc, { op: "save", strings: args.strings }, 30_000);
        return { content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result) }] };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const t = e instanceof RpcRefused ? `Refused: ${message}` : `Could not reach the app (${message}). Do not retry in a loop.`;
        return { isError: true, content: [{ type: "text" as const, text: t }] };
      }
    },
  );
  return server;
}
```

If the installed zod is v4 under `blocks` (check `node_modules/zod/package.json`), keep `import { z } from "zod"`. If `blocks` has no direct zod dependency, import `z` from `@humanharness/harness-sdk` as `data-server.ts` does. **Do not add a dependency.**

`packages/blocks/src/translate-server-bin.ts`:

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTranslateServer } from "./translate-server";

try {
  const rpcPath = process.env.HH_RPC;
  const token = process.env.HH_RPC_TOKEN;
  if (!rpcPath || !token) {
    console.error("HH_RPC and HH_RPC_TOKEN are required");
    process.exit(2);
  }
  await createTranslateServer({ path: rpcPath, token }).connect(new StdioServerTransport());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
```

Append to `packages/blocks/src/launch.ts`:

```ts
/** The `translate` MCP server (language spec §5): `save_translation` asks the app over `rpc`. */
export function translateServerSpec(opts: { rpc: { path: string; token: string }; launcher: Launcher; entry?: string }): McpServerSpec {
  const entry = opts.entry ?? fileURLToPath(new URL("./translate-server-bin.ts", import.meta.url));
  return {
    name: "translate",
    command: opts.launcher.command,
    args: [...opts.launcher.args, entry],
    env: { ...opts.launcher.env, HH_RPC: opts.rpc.path, HH_RPC_TOKEN: opts.rpc.token },
  };
}
```

In `packages/blocks/src/index.ts` add `export { createTranslateServer, SAVE_LIMITS } from "./translate-server";`.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/blocks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/blocks
git commit -m "feat(blocks): the translate server and its save_translation tool

<trailer>"
```

---

### Task 6: runtime — `runSystemSession`, one session with several turns

**Files:**
- Create: `packages/runtime/src/system-session.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/test/system-session.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { devLauncher, translateServerSpec } from "@humanharness/blocks";
import { getEngine } from "@humanharness/engines";
import { type ClaudeScript, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { runSystemSession } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-syssession-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function fake(script: ClaudeScript) {
  const dir = fs.mkdtempSync(path.join(root, "t-"));
  const prompts = path.join(dir, "prompts.jsonl");
  return {
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(dir, script), HH_FAKE_PROMPTS: prompts },
    runs: () => fs.readFileSync(prompts, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { argv: string[]; prompt: string }),
  };
}
const result = { line: { type: "result", subtype: "success", is_error: false, result: "done", usage: { input_tokens: 10, output_tokens: 2 } } };
const server = (rpc: { path: string; token: string }) => translateServerSpec({ rpc, launcher: devLauncher() });

describe("runSystemSession (language spec §5)", () => {
  it("runs one turn per prompt in the same session, with only its server, then removes its folder", async () => {
    const init = { line: { type: "system", subtype: "init", session_id: "fake-session" } };
    const f = fake({ steps: [init, { mcp: { server: "translate", tool: "save_translation", args: { strings: { "core:a": "b" } } } }, result] });
    const parent = path.join(root, "work");
    const seen: unknown[] = [];
    const turns: number[] = [];
    const prompts = ["first", "second"];
    const r = await runSystemSession({
      engine: getEngine("claude"),
      command: f.command,
      env: f.env,
      server,
      parent,
      handle: async (req) => {
        seen.push(req);
        return "Saved 1.";
      },
      next: async (i) => prompts[i] ?? null,
      onTurn: async (t, i) => void turns.push(i),
    });
    expect(r).toMatchObject({ ok: true, turns: 2 });
    expect(turns).toEqual([0, 1]);
    expect(seen).toHaveLength(2);
    const runs = f.runs();
    expect(runs.map((x) => x.prompt)).toEqual(["first", "second"]);
    // The second turn resumes the first one's session (whatever id the transport keeps for it).
    expect(runs[0].argv).toContain("--session-id");
    expect(runs[1].argv).toContain("--resume");
    expect(runs[0].argv).not.toContain("--no-session-persistence");
    const servers = JSON.parse(runs[0].argv[runs[0].argv.indexOf("--mcp-config") + 1]).mcpServers;
    expect(Object.keys(servers)).toEqual(["translate"]);
    const denied = runs[0].argv[runs[0].argv.indexOf("--disallowedTools") + 1].split(",");
    for (const tool of ["Edit", "Write", "Bash", "WebFetch", "WebSearch"]) expect(denied).toContain(tool);
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it("stops at the first failed turn, and on abort; never throws", async () => {
    const f = fake({ steps: [{ line: { type: "result", subtype: "error_during_execution", is_error: true, result: "boom" } }], exitCode: 1 });
    const r = await runSystemSession({ engine: getEngine("claude"), command: f.command, env: f.env, server, parent: path.join(root, "w2"), handle: async () => "", next: async (i) => (i < 3 ? "p" : null) });
    expect(r.ok).toBe(false);
    expect(r.turns).toBe(1);
    const ac = new AbortController();
    ac.abort();
    const stopped = await runSystemSession({ engine: getEngine("claude"), command: f.command, env: f.env, server, parent: path.join(root, "w3"), handle: async () => "", next: async () => "p", signal: ac.signal });
    expect(stopped).toMatchObject({ ok: false, turns: 0, error: { code: "cancelled" } });
  });

  it("caps the number of turns", async () => {
    const f = fake({ steps: [result] });
    const r = await runSystemSession({ engine: getEngine("claude"), command: f.command, env: f.env, server, parent: path.join(root, "w4"), handle: async () => "", next: async () => "again", maxTurns: 3 });
    expect(r).toMatchObject({ ok: true, turns: 3 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/runtime/test/system-session.test.ts`
Expected: FAIL. `runSystemSession` is not exported.

- [ ] **Step 3: Implement `packages/runtime/src/system-session.ts`**

```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type McpServerSpec, openRpc } from "@humanharness/blocks";
import type { EngineDef, ModelProfile } from "@humanharness/engines";
import { AcpTransport } from "./acp";
import { ClaudeCliTransport } from "./claude-cli";
import type { EngineError, Event } from "./events";
import type { SystemTaskResult } from "./system";
import { type Transport, type TransportOptions, acpFields } from "./transport";

export interface SystemSessionOptions {
  engine: EngineDef;
  command: string[];
  env?: Record<string, string>;
  /** The session's only MCP server, given the app's RPC channel. */
  server: (rpc: { path: string; token: string }) => McpServerSpec;
  /** Answers the server's calls; a throw is a refusal the AI reads. */
  handle: (request: unknown) => Promise<unknown>;
  /** Where the empty working folder is made (created if missing); the folder is removed afterwards. */
  parent: string;
  /** The prompt of turn `turn` (0-based), or null when there is nothing more to ask. */
  next: (turn: number) => Promise<string | null>;
  /** After each turn, with what it reported. Awaited before the next prompt is asked. */
  onTurn?: (result: SystemTaskResult, turn: number) => Promise<void>;
  profile?: ModelProfile;
  signal?: AbortSignal;
  turnTimeoutMs?: number;
  maxTurns?: number;
}

export interface SystemSessionResult {
  ok: boolean;
  turns: number;
  error?: EngineError;
}

const TURN_TIMEOUT_MS = 4 * 60_000;
const MAX_TURNS = 60;

/**
 * One engine session outside any task (language spec §5): an empty folder under `parent`, one MCP server, no edits, no
 * web, no commands; one turn per prompt, resumed in the same session. Stops at the first failed turn, a stop (`signal`)
 * or `maxTurns`. Never throws.
 */
export async function runSystemSession(o: SystemSessionOptions): Promise<SystemSessionResult> {
  if (o.signal?.aborted) return { ok: false, turns: 0, error: { code: "cancelled" } };
  let folder: string;
  try {
    await fs.mkdir(o.parent, { recursive: true });
    folder = await fs.mkdtemp(path.join(o.parent, "run-"));
  } catch (err) {
    return { ok: false, turns: 0, error: { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) } };
  }
  const rpc = await openRpc(o.handle).catch(() => null);
  if (!rpc) {
    await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, turns: 0, error: { code: "agent-crashed", detail: "rpc" } };
  }
  const options: TransportOptions = {
    folder,
    session: { id: randomUUID(), started: false },
    mcp: [o.server({ path: rpc.path, token: rpc.token })],
    permissions: { edit: "none", exec: false, web: false },
    ...acpFields(o.engine, "none"),
    // Turns resume the same session (Claude needs it on disk); the app never reads the engine's own store.
    persistSession: true,
    command: o.command,
    ...(o.env ? { env: o.env } : {}),
    onSessionStarted: () => {},
  };
  const transport: Transport = o.engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(options) : new AcpTransport(options);
  let turns = 0;
  let outcome: SystemSessionResult = { ok: true, turns: 0 };
  try {
    for (let i = 0; i < (o.maxTurns ?? MAX_TURNS); i++) {
      if (o.signal?.aborted) {
        outcome = { ok: false, turns, error: { code: "cancelled" } };
        break;
      }
      const prompt = await o.next(i);
      if (prompt === null) break;
      const r = await oneTurn(transport, prompt, o);
      turns++;
      await o.onTurn?.(r, i);
      if (!r.ok) {
        outcome = { ok: false, turns, ...(r.error ? { error: r.error } : {}) };
        break;
      }
    }
  } catch (err) {
    outcome = { ok: false, turns, error: { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) } };
  } finally {
    await transport.close().catch(() => undefined);
    await rpc.close().catch(() => undefined);
    await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
  return outcome.ok ? { ok: true, turns } : { ...outcome, turns };
}

async function oneTurn(transport: Transport, prompt: string, o: SystemSessionOptions): Promise<SystemTaskResult> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), o.turnTimeoutMs ?? TURN_TIMEOUT_MS);
  const result: SystemTaskResult = { ok: false };
  try {
    await transport.turn(
      prompt,
      (e: Event) => {
        if (e.type === "usage") {
          const u = result.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
          result.usage = {
            inputTokens: u.inputTokens + e.inputTokens,
            outputTokens: u.outputTokens + e.outputTokens,
            cacheReadTokens: u.cacheReadTokens + e.cacheReadTokens,
            cacheWriteTokens: u.cacheWriteTokens + e.cacheWriteTokens,
            ...(u.costUsd !== undefined || e.costUsd !== undefined ? { costUsd: (u.costUsd ?? 0) + (e.costUsd ?? 0) } : {}),
          };
          if (e.model) result.model = e.model;
        } else if (e.type === "limits") result.limits = e.windows;
        else if (e.type === "done") {
          result.ok = e.ok;
          if (!e.ok) result.error = e.error;
        }
      },
      controller.signal,
      o.profile,
    );
  } catch (err) {
    result.ok = false;
    result.error = { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
  }
  if (controller.signal.aborted) {
    result.ok = false;
    result.error ??= { code: "cancelled" };
  }
  return result;
}
```

In `packages/runtime/src/index.ts` add `export { runSystemSession, type SystemSessionOptions, type SystemSessionResult } from "./system-session";`. `runSystemTask` is untouched (material keeps its behaviour, D0).

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/runtime`
Expected: PASS. If the Claude transport's `--allowedTools` derivation needs the server name, the existing `mcp__<name>` logic covers `translate`. Check `claude-cli.ts:75-110` and do not special-case it.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): one engine session with several turns, outside any task

<trailer>"
```

---

### Task 7: fake-agent — the pseudo-translation step

**Files:**
- Create: `packages/fake-agent/src/pseudo.ts`
- Modify: `packages/fake-agent/src/script.ts`, `packages/fake-agent/src/fake-claude.ts`, `packages/fake-agent/src/index.ts`
- Test: `packages/fake-agent/test/pseudo.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { pseudoTranslate } from "../src/pseudo";

const prompt = (batch: unknown) => `Translate.\n<batch>\n${JSON.stringify(batch)}\n</batch>\n`;

describe("pseudoTranslate (spec §9)", () => {
  it("prefixes every text, keeps placeholders and tags, writes each requested plural form", () => {
    const out = pseudoTranslate(prompt({ forms: ["few", "one", "other"], strings: { "core:a": "Start {{name}}", "core:b": "In <b>{{x}}</b>", "core:p": { one: "{{count}} item", other: "{{count}} items" } } }), "[xx]");
    expect(out).toEqual({ "core:a": "[xx] Start {{name}}", "core:b": "[xx] In <b>{{x}}</b>", "core:p": { few: "[xx] {{count}} items", one: "[xx] {{count}} item", other: "[xx] {{count}} items" } });
  });

  it("breaks the keys it is told to (drops their placeholders)", () => {
    expect(pseudoTranslate(prompt({ forms: ["other"], strings: { "core:a": "Start {{name}}" } }), "[xx]", ["core:a"])).toEqual({ "core:a": "[xx] Start" });
  });

  it("no batch: nothing", () => expect(pseudoTranslate("hello", "[xx]")).toEqual({}));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/fake-agent/test/pseudo.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

`packages/fake-agent/src/pseudo.ts`:

```ts
/** The batch a translation prompt carries between `<batch>` and `</batch>` (task-prompts `translatePrompt`). */
interface Batch {
  forms: string[];
  strings: Record<string, string | Record<string, string>>;
}

/** The fake engine's answer to a translation turn (spec §9): `<prefix> <English>`, placeholders and tags kept. */
export function pseudoTranslate(prompt: string, prefix = "[xx]", breakKeys: readonly string[] = []): Record<string, string | Record<string, string>> {
  const m = /<batch>\s*([\s\S]*?)\s*<\/batch>/.exec(prompt);
  if (!m) return {};
  let batch: Batch;
  try {
    batch = JSON.parse(m[1]) as Batch;
  } catch {
    return {};
  }
  const one = (key: string, text: string) => {
    const t = `${prefix} ${text}`;
    return breakKeys.includes(key) ? t.replace(/\s*\{\{[^{}]*\}\}/g, "") : t;
  };
  const out: Record<string, string | Record<string, string>> = {};
  for (const [key, en] of Object.entries(batch.strings ?? {})) {
    out[key] = typeof en === "string" ? one(key, en) : Object.fromEntries(batch.forms.map((f) => [f, one(key, en[f] ?? en.other ?? Object.values(en)[0] ?? "")]));
  }
  return out;
}
```

In `script.ts` add to `ClaudeStep`:

```ts
  /** Answers a translation turn (spec §9): reads the prompt's `<batch>` and calls `save_translation` with a pseudo-translation. */
  | { pseudoTranslate: { prefix?: string; server?: string; breakKeys?: string[] } }
```

In `fake-claude.ts` (scripted branch), add before the `"mcp" in step` branch:

```ts
    } else if ("pseudoTranslate" in step) {
      const name = step.pseudoTranslate.server ?? "translate";
      const s = mcpConfig.mcpServers[name];
      if (!s) throw new Error(`fake-claude: pseudoTranslate names unknown server "${name}"`);
      const { pseudoTranslate } = await import("./pseudo");
      const strings = pseudoTranslate(input, step.pseudoTranslate.prefix, step.pseudoTranslate.breakKeys);
      await callMcpTool({ command: s.command, args: s.args ?? [], env: s.env ?? {} }, "save_translation", { strings });
```

In `index.ts` add `export { pseudoTranslate } from "./pseudo";`.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/fake-agent && corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fake-agent
git commit -m "feat(fake-agent): a pseudo-translation for translation turns

<trailer>"
```

---

### Task 8: task prompts — the translation prompt

**Files:**
- Modify: `packages/shell/src/main/task-prompts.ts`
- Test: `packages/shell/test/task-prompts.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { TRANSLATE_NEXT, TRANSLATE_PROMPT, translatePrompt } from "../src/main/task-prompts";

describe("translatePrompt (language spec §5)", () => {
  const batch = { "core:chat.send": "Send", "core:notes.keyPoints": { one: "{{count}} key point", other: "{{count}} key points" } };

  it("the first turn: English instructions, the English language name, the tone, the forms, then the batch", () => {
    const p = translatePrompt({ first: true, language: "pt-BR", tone: "warm and informal", forms: ["many", "one", "other"], batch });
    expect(p.startsWith(TRANSLATE_PROMPT.split("\n")[0].replace("{{languageName}}", "Brazilian Portuguese"))).toBe(true);
    expect(p).toContain("Tone: warm and informal");
    expect(p).toContain("many, one, other");
    expect(p).toContain("{{placeholder}}");
    expect(p).not.toContain("pt-BR");
    const json = JSON.parse(/<batch>\n([\s\S]*)\n<\/batch>/.exec(p)![1]);
    expect(json).toEqual({ forms: ["many", "one", "other"], strings: batch });
  });

  it("a later turn: the short reminder and the batch; no tone means neutral", () => {
    expect(translatePrompt({ first: false, language: "es", forms: ["one", "other"], batch }).startsWith(TRANSLATE_NEXT)).toBe(true);
    expect(translatePrompt({ first: true, language: "es", forms: ["one", "other"], batch })).toContain("Tone: neutral and clear");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/task-prompts.test.ts`
Expected: FAIL. `translatePrompt` is not exported.

- [ ] **Step 3: Implement** (append to `task-prompts.ts`)

```ts
/** The first turn of a translation run (language spec §5). `{{placeholder}}` is literal: it is shown to the AI as such. */
export const TRANSLATE_PROMPT = [
  "You translate the interface of a desktop app into {{languageName}}.",
  "The texts are buttons, labels and short messages. Keep each one about as short as the English.",
  "Keep every {{placeholder}} and every tag such as <b> exactly as written, untranslated. Add no markup and no line breaks.",
  "Tone: {{tone}}.",
  "A plural text comes as an object of English forms. Answer it with an object of exactly these forms: {{forms}}.",
  "Call `save_translation` once with every key of the batch below and its translation. Read nothing and write no file. Then reply with one word: done.",
].join("\n");

/** Every later turn of the same run. */
export const TRANSLATE_NEXT = "Next batch, same rules: call `save_translation` once with every key, then reply: done.";

const NEUTRAL_TONE = "neutral and clear";

/** One translation turn's prompt: the instructions (first turn) or the reminder, then the batch as JSON. */
export function translatePrompt(o: { first: boolean; language: Language; tone?: string; forms: readonly string[]; batch: Record<string, unknown> }): string {
  const head = o.first
    ? TRANSLATE_PROMPT.replace("{{languageName}}", () => languageName(o.language))
        .replace("{{tone}}", () => (o.tone ?? NEUTRAL_TONE).replace(/\.$/, ""))
        .replace("{{forms}}", () => o.forms.join(", "))
    : TRANSLATE_NEXT;
  return `${head}\n\n<batch>\n${JSON.stringify({ forms: o.forms, strings: o.batch })}\n</batch>`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/task-prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/main/task-prompts.ts packages/shell/test/task-prompts.test.ts
git commit -m "feat(shell): the English translation prompt

<trailer>"
```

---

### Task 9: usage log — translate turns, left out of task estimates

**Files:**
- Modify: `packages/shell/src/main/usage-log.ts` (`TurnKind`, `UsageRecord`, new `translateRecord`, `summarizeUsage`)
- Test: `packages/shell/test/usage-log.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
describe("translate turns (language spec §5 Measuring)", () => {
  const profile = { engine: "claude", tier: "light" as const, model: "haiku" };
  it("records phase translate with the language and batch", () => {
    const r = translateRecord({ engine: "claude", language: "es", batch: 2, profile, ok: true, usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }, "2026-10-28T10:00:00.000Z");
    expect(r).toMatchObject({ at: "2026-10-28T10:00:00.000Z", engine: "claude", phase: "translate", language: "es", batch: 2, ok: true });
  });

  it("are not a task's turn, and a turn right before one can't be measured", () => {
    const w = (u: number) => [{ kind: "five_hour", utilization: u, resetsAt: "2099-01-01T00:00:00.000Z" }];
    const records = [
      { at: "1", engine: "claude", action: "a", task: "t1", ok: true, limits: w(10), usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      { at: "2", engine: "claude", phase: "translate" as const, language: "es", batch: 0, ok: true, limits: w(20) },
    ];
    const s = summarizeUsage(records as never, "five_hour", new Date("2026-10-28T00:00:00Z"));
    expect(s.estimates.a).toBeUndefined();
  });
});
```

(Import `translateRecord` next to `materialRecord`. If `estimates` is keyed differently, assert the same thing through the existing material test's style in the file.)

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/usage-log.test.ts`
Expected: FAIL. `translateRecord` is not exported.

- [ ] **Step 3: Implement**

- `TurnKind`: add `| "translate"` and to its doc: "`translate`: one batch of a translation run (language spec §5), not a task's turn."
- `UsageRecord`: add `/** Translate lines only: the target language and the batch's index. */ language?: string; batch?: number;`
- Add after `materialRecord`:

```ts
/** One batch of a translation run (language spec §5). */
export function translateRecord(
  o: { engine: string; language: string; batch: number; profile: ModelProfile; ok: boolean; usage?: TurnUsage; limits?: LimitWindow[] },
  at: string = new Date().toISOString(),
): UsageRecord {
  return {
    at,
    engine: o.engine,
    phase: "translate",
    language: o.language,
    batch: o.batch,
    ...profileMeta(o.profile),
    ok: o.ok,
    ...(o.usage ? { usage: o.usage } : {}),
    ...(o.limits ? { limits: o.limits } : {}),
  };
}
```

- In `summarizeUsage`: introduce `const notTask = (r?: UsageRecord) => r?.phase === "material" || r?.phase === "translate";` and use it in the three places: `if (r.phase === "close" || notTask(r) || r.kind) continue;`, `next?.phase === "material"` → `notTask(next)`, and `if (r.scope && !notTask(r))`. The `material` total stays material-only.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/usage-log.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/main/usage-log.ts packages/shell/test/usage-log.test.ts
git commit -m "feat(shell): translate turns in the usage log, outside task estimates

<trailer>"
```

---

### Task 10: the translation cache file

**Files:**
- Create: `packages/shell/src/main/translation-cache.ts`
- Test: `packages/shell/test/translation-cache.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TranslationCache, emptyCache } from "../src/main/translation-cache";

let dir: string;
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const make = () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-tcache-"));
  return new TranslationCache(dir);
};

describe("TranslationCache (spec §6)", () => {
  it("D0: reading creates nothing; a missing file is an empty cache", async () => {
    const c = make();
    expect(await c.load("es")).toEqual(emptyCache("es"));
    expect(await c.tags()).toEqual([]);
    expect(fs.existsSync(path.join(dir, "locales"))).toBe(false);
  });

  it("saves atomically under locales/<tag>.json and lists canonical tags only", async () => {
    const c = make();
    const file = { ...emptyCache("pt-BR"), entries: { "core:chat.send": { en: "h1", value: "Enviar" } } };
    await c.save(file);
    expect(await c.load("pt-BR")).toEqual(file);
    fs.writeFileSync(path.join(dir, "locales", "not a tag.json"), "{}");
    fs.writeFileSync(path.join(dir, "locales", "he.json"), "{}");
    expect(await c.tags()).toEqual(["pt-BR"]);
    expect(fs.readdirSync(path.join(dir, "locales")).some((n) => n.endsWith(".tmp"))).toBe(false);
  });

  it("refuses a tag that isn't offered, and a file that is too big or malformed reads as empty", async () => {
    const c = make();
    await expect(c.save(emptyCache("../evil"))).rejects.toThrow();
    fs.mkdirSync(path.join(dir, "locales"), { recursive: true });
    fs.writeFileSync(path.join(dir, "locales", "es.json"), "x".repeat(4 * 1024 * 1024 + 1));
    expect(await c.load("es")).toEqual(emptyCache("es"));
    fs.writeFileSync(path.join(dir, "locales", "fr.json"), JSON.stringify({ version: 1, tag: "fr", entries: { "core:a": { en: 3, value: "x" }, "core:b": { en: "h", value: "ok" } }, failed: { "core:c": { en: "h", count: "two" } } }));
    expect(await c.load("fr")).toEqual({ ...emptyCache("fr"), entries: { "core:b": { en: "h", value: "ok" } } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/translation-cache.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement `packages/shell/src/main/translation-cache.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { type Language, offeredLanguage } from "@humanharness/harness-sdk/language";
import type { Translated } from "@humanharness/i18n/translate";

export interface CacheFile {
  version: 1;
  tag: Language;
  /** By namespaced key: the hash of the English it was made from, and the translation. */
  entries: Record<string, { en: string; value: Translated }>;
  /** Keys that failed validation for this English: twice is final (spec §6). */
  failed: Record<string, { en: string; count: number }>;
}

export const emptyCache = (tag: Language): CacheFile => ({ version: 1, tag, entries: {}, failed: {} });
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const KEY = /^(core|harness):[A-Za-z0-9_.-]{1,200}$/;
const isForms = (v: unknown): v is Record<string, string> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((s) => typeof s === "string" && s.length <= 4000) && Object.keys(v).length <= 6;

/** `<userData>/locales/<tag>.json` (language spec §6). Only a translation run writes it; reading never creates anything. */
export class TranslationCache {
  private readonly dir: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(userData: string) {
    this.dir = path.join(userData, "locales");
  }

  private file(tag: Language): string {
    if (!offeredLanguage(tag)) throw new Error(`Not a language the app translates into: ${String(tag).slice(0, 40)}`);
    return path.join(this.dir, `${tag}.json`);
  }

  /** The tags with a cache file, canonical and offered only. */
  async tags(): Promise<Language[]> {
    const names = await fs.readdir(this.dir).catch(() => [] as string[]);
    return names
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -5))
      .filter(offeredLanguage)
      .sort()
      .slice(0, 50);
  }

  /** The cache of `tag`, shape-checked; anything missing, too big or malformed reads as empty. */
  async load(tag: Language): Promise<CacheFile> {
    const out = emptyCache(tag);
    let text: string;
    try {
      const file = this.file(tag);
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_BYTES) return out;
      text = await fs.readFile(file, "utf8");
    } catch {
      return out;
    }
    let raw: { entries?: unknown; failed?: unknown };
    try {
      raw = JSON.parse(text);
    } catch {
      return out;
    }
    if (typeof raw !== "object" || raw === null) return out;
    for (const [k, v] of Object.entries(typeof raw.entries === "object" && raw.entries ? raw.entries : {}).slice(0, MAX_ENTRIES)) {
      const e = v as { en?: unknown; value?: unknown };
      if (!KEY.test(k) || typeof e?.en !== "string" || e.en.length > 32) continue;
      if ((typeof e.value === "string" && e.value.length <= 4000) || isForms(e.value)) out.entries[k] = { en: e.en, value: e.value as Translated };
    }
    for (const [k, v] of Object.entries(typeof raw.failed === "object" && raw.failed ? raw.failed : {}).slice(0, MAX_ENTRIES)) {
      const f = v as { en?: unknown; count?: unknown };
      if (KEY.test(k) && typeof f?.en === "string" && f.en.length <= 32 && Number.isInteger(f.count) && (f.count as number) > 0) out.failed[k] = { en: f.en, count: Math.min(2, f.count as number) };
    }
    return out;
  }

  /** Writes the whole file (temp + rename), one save after another. */
  save(file: CacheFile): Promise<void> {
    const run = this.queue.then(async () => {
      const target = this.file(file.tag);
      await fs.mkdir(this.dir, { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(file));
      await fs.rename(tmp, target);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
```

The shell's main needs `@humanharness/i18n` as a dependency for the type import. Add `"@humanharness/i18n": "workspace:*"` to `packages/shell/package.json` `dependencies` and run `corepack pnpm install` (a workspace link only, no download).

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/translation-cache.test.ts && corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/main/translation-cache.ts packages/shell/test/translation-cache.test.ts packages/shell/package.json pnpm-lock.yaml
git commit -m "feat(shell): the translation cache file, bounded and atomic

<trailer>"
```

---

### Task 11: client types — language state, results and `languageOffered`

**Files:**
- Modify: `packages/ui/src/client.ts`, `packages/shell/src/main/config.ts`, `packages/shell/src/main/validate.ts`
- Test: `packages/shell/test/config.test.ts`, `packages/shell/test/validate.test.ts`

- [ ] **Step 1: Write the failing tests**

`config.test.ts`:

```ts
it("keeps languageOffered only when it is a boolean", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-config-"));
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ language: "es", languageOffered: "yes" }));
  expect(await new ConfigStore(dir).load()).toEqual({ language: "es" });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ language: "es", languageOffered: true }));
  expect(await new ConfigStore(dir).load()).toEqual({ language: "es", languageOffered: true });
});
```

`validate.test.ts` (use the file's existing `ctx` helper):

```ts
it("refuses a languageOffered that isn't a boolean", async () => {
  expect(await configProblem({ languageOffered: "yes" } as never, ctx)).toBe("invalid");
  expect(await configProblem({ languageOffered: true }, ctx)).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/config.test.ts packages/shell/test/validate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/ui/src/client.ts`:
- `AppConfig`: add `/** The person answered the language offer on Home (spec §3): it never shows again. */ languageOffered?: boolean;`
- Add the types and the client:

```ts
/** A translation run (language spec §5): its language, batches done of all, and how it stands. */
export interface LanguageRun {
  tag: Language;
  done: number;
  total: number;
  status: "running" | "done" | "failed" | "cancelled";
  /** `failed` only: the engine's quota, or anything else. */
  reason?: "quota" | "engine";
}

/** What Settings › General, the offer card and the picker need (spec §3, §6). */
export interface LanguageState {
  /** The saved language: the AI writes in it, the screens show its cached translation. */
  language: Language;
  /** Languages with a cache; `complete`: every key translated (or given up) for this app's English. */
  cached: { tag: Language; complete: boolean }[];
  /** Keys of the saved language still in English that a run would send; 0 for English. */
  missing: number;
  /** Whether a translation can run now, else why not (spec §3: no ready engine, mock mode). */
  canTranslate: true | "no-engine" | "mock";
  /** The engine that would translate (the notice names it). */
  engineName?: string;
  run: LanguageRun | null;
}

/** Translated strings from the cache: flat, namespaced ("core:chat.send"). */
export type GeneratedStrings = Record<string, string>;
export type LanguageChoose = { ok: true; language: Language; strings: GeneratedStrings } | { ok: false; reason: "needs-translation" | "invalid" | "busy" | "failed" };
export type LanguageStart = { ok: true } | { ok: false; reason: "invalid" | "busy" | "no-engine" | "mock" | "failed" };

/** `client.language` (language spec). Every answer is data; `harness` is the harness's English map (`locales.en`). */
export interface LanguageClient {
  state(harness: Record<string, unknown>): Promise<LanguageState | null>;
  /** English, or a language with a complete translation: saved and switched at once. */
  choose(tag: Language, harness: Record<string, unknown>): Promise<LanguageChoose>;
  /** Starts the run (after the notice); its progress comes through `onChange`. */
  translate(tag: Language, harness: Record<string, unknown>): Promise<LanguageStart>;
  cancel(): Promise<{ ok: boolean }>;
  strings(tag: Language, harness: Record<string, unknown>): Promise<GeneratedStrings>;
  onChange(listener: (state: LanguageState) => void): () => void;
}
```

- `HarnessClient`: add `/** Language on demand (plan 5b). Absent in a client that predates it: the Language row stays read-only (D0). */ language?: LanguageClient;`

`config.ts` `load()`: destructure `languageOffered` too and add `...(typeof languageOffered === "boolean" ? { languageOffered } : {}),`.

`validate.ts` `configProblem`: after `backupDismissed` add `if (c.languageOffered !== undefined && typeof c.languageOffered !== "boolean") return "invalid";`.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/config.test.ts packages/shell/test/validate.test.ts && corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/client.ts packages/shell/src/main/config.ts packages/shell/src/main/validate.ts packages/shell/test
git commit -m "feat(client): language state, results and the offer flag

<trailer>"
```

---

### Task 12: `TranslationService` — plan, run, validate, cache, switch

**Files:**
- Create: `packages/shell/src/main/translation.ts`
- Test: `packages/shell/test/translation.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageState } from "@humanharness/ui/client";
import { TranslationCache } from "../src/main/translation-cache";
import { type Runner, TranslationService } from "../src/main/translation";

let dir: string;
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const CORE = { "chat.send": "Send", "home.start": "Start {{name}}", "notes.keyPoints_one": "{{count}} key point", "notes.keyPoints_other": "{{count}} key points", "legal.engine.accept": "I accept" };
const HARNESS = { title: "Notes" };

/** A runner that answers each prompt's batch with `answer(batch)` through `handle`, as the engine would. */
function runner(answer: (batch: Record<string, unknown>, forms: string[]) => Record<string, unknown> | null, fail?: number): Runner & { prompts: string[] } {
  const prompts: string[] = [];
  const run: Runner = async ({ next, handle, onTurn, signal }) => {
    for (let i = 0; ; i++) {
      if (signal.aborted) return { ok: false, turns: i, error: { code: "cancelled" } };
      const p = await next(i);
      if (p === null) return { ok: true, turns: i };
      prompts.push(p);
      if (fail === i) {
        await onTurn({ ok: false, error: { code: "out-of-quota" } }, i);
        return { ok: false, turns: i + 1, error: { code: "out-of-quota" } };
      }
      const { forms, strings } = JSON.parse(/<batch>\n([\s\S]*)\n<\/batch>/.exec(p)![1]);
      const a = answer(strings, forms);
      if (a) await handle({ op: "save", strings: a }).catch(() => undefined);
      await onTurn({ ok: true }, i);
    }
  };
  return Object.assign(run, { prompts });
}

const pseudo = (b: Record<string, unknown>, forms: string[]) =>
  Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === "string" ? `~${v}` : Object.fromEntries(forms.map((f) => [f, `~${(v as Record<string, string>).other}`]))]));

function make(o: { language?: string; run?: Runner; available?: true | "no-engine" | "mock"; batchSize?: number } = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-translation-"));
  let saved = o.language ?? "en";
  const sent: LanguageState[] = [];
  const svc = new TranslationService({
    cache: new TranslationCache(dir),
    core: CORE,
    tone: "warm",
    language: async () => saved,
    saveLanguage: async (tag) => void (saved = tag),
    available: async () => o.available ?? true,
    prepare: async () => (o.run ? { engineName: "Claude", run: o.run } : null),
    engineName: async () => "Claude",
    send: (s) => void sent.push(s),
    batchSize: o.batchSize ?? 2,
  });
  return { svc, sent, saved: () => saved, dir };
}

describe("TranslationService (language spec §4–§6, §9)", () => {
  it("D0: English needs nothing and writes nothing", async () => {
    const t = make();
    expect(await t.svc.state(HARNESS)).toMatchObject({ language: "en", cached: [], missing: 0, canTranslate: true, run: null });
    expect(await t.svc.choose("en", HARNESS)).toEqual({ ok: true, language: "en", strings: {} });
    expect(fs.existsSync(path.join(t.dir, "locales"))).toBe(false);
  });

  it("a language without a translation needs the notice first", async () => {
    const t = make();
    expect(await t.svc.choose("es", HARNESS)).toEqual({ ok: false, reason: "needs-translation" });
    expect(t.saved()).toBe("en");
  });

  it("translates in batches, skips legal keys, sends plural forms, then saves and switches", async () => {
    const r = runner(pseudo);
    const t = make({ run: r });
    expect(await t.svc.translate("pl", HARNESS)).toEqual({ ok: true });
    await t.svc.settled();
    expect(r.prompts).toHaveLength(2);
    expect(r.prompts.join("\n")).not.toContain("legal.");
    expect(r.prompts[0]).toContain("Polish");
    expect(r.prompts[0]).toContain("few, many, one, other");
    expect(t.saved()).toBe("pl");
    expect(t.sent.at(-1)).toMatchObject({ language: "pl", missing: 0, run: { tag: "pl", status: "done", done: 2, total: 2 } });
    const strings = await t.svc.strings("pl", HARNESS);
    expect(strings).toMatchObject({ "core:chat.send": "~Send", "core:notes.keyPoints_few": "~{{count}} key points", "harness:title": "~Notes" });
    expect(Object.keys(strings).some((k) => k.includes("legal."))).toBe(false);
    expect(await t.svc.choose("pl", HARNESS)).toMatchObject({ ok: true, language: "pl" });
  });

  it("a key that fails is sent once more in a later batch; failing again it stays English", async () => {
    const r = runner((b, f) => ({ ...pseudo(b, f), ...(Object.hasOwn(b, "core:home.start") ? { "core:home.start": "Empezar" } : {}) }));
    const t = make({ run: r });
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    expect(r.prompts.filter((p) => p.includes("core:home.start"))).toHaveLength(2);
    expect(t.saved()).toBe("es");
    expect((await t.svc.strings("es", HARNESS))["core:home.start"]).toBeUndefined();
    expect(await t.svc.state(HARNESS)).toMatchObject({ missing: 0 });
  });

  it("refuses keys it didn't send and saves outside a batch", async () => {
    let handleRef: ((r: unknown) => Promise<unknown>) | null = null;
    const r: Runner = async ({ next, handle, onTurn }) => {
      handleRef = handle;
      const p = (await next(0))!;
      await expect(handle({ op: "save", strings: { "core:not.sent": "x" } })).resolves.toMatch(/not in this batch/);
      await expect(handle({ op: "nope" })).rejects.toThrow();
      await handle({ op: "save", strings: pseudo(JSON.parse(/<batch>\n([\s\S]*)\n<\/batch>/.exec(p)![1]).strings, ["one", "other"]) });
      await onTurn({ ok: true }, 0);
      return { ok: false, turns: 1, error: { code: "cancelled" } };
    };
    const t = make({ run: r, batchSize: 100 });
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    await expect(handleRef!({ op: "save", strings: { "core:chat.send": "x" } })).rejects.toThrow(/No batch/);
  });

  it("a cut run keeps what was saved, doesn't switch, and resumes where it stopped", async () => {
    const first = runner(pseudo, 1);
    const t = make({ run: first });
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    expect(t.saved()).toBe("en");
    expect(t.sent.at(-1)!.run).toMatchObject({ status: "failed", reason: "quota", done: 1 });
    const left = (await t.svc.state(HARNESS))!;
    expect(left.cached).toEqual([{ tag: "es", complete: false }]);
    const second = runner(pseudo);
    (t.svc as unknown as { d: { prepare: unknown } }).d.prepare = async () => ({ engineName: "Claude", run: second });
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    expect(second.prompts.join("\n")).not.toContain("core:chat.send");
    expect(t.saved()).toBe("es");
  });

  it("refuses: a bad or RTL tag, English, a second run, no engine, mock mode", async () => {
    let release!: () => void;
    const slow: Runner = async ({ next, onTurn }) => {
      await next(0);
      await new Promise<void>((r) => (release = r));
      await onTurn({ ok: true }, 0);
      return { ok: true, turns: 1 };
    };
    const t = make({ run: slow });
    for (const bad of ["he", "../x", 3, "en"]) expect(await t.svc.translate(bad as string, HARNESS)).toEqual({ ok: false, reason: "invalid" });
    expect(await t.svc.translate("es", HARNESS)).toEqual({ ok: true });
    expect(await t.svc.translate("fr", HARNESS)).toEqual({ ok: false, reason: "busy" });
    // The run reaches its first turn only after loading the cache: wait for it before letting it end.
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    await t.svc.settled();
    expect(await make({ available: "mock" }).svc.translate("es", HARNESS)).toEqual({ ok: false, reason: "mock" });
    expect(await make({ available: "no-engine" }).svc.translate("es", HARNESS)).toEqual({ ok: false, reason: "no-engine" });
  });

  it("cancel and stop end the run with what was saved", async () => {
    const t = make({ run: runner(pseudo), batchSize: 1 });
    await t.svc.translate("es", HARNESS);
    await t.svc.cancel();
    await t.svc.settled();
    expect(t.sent.at(-1)!.run?.status === "cancelled" || t.sent.at(-1)!.run?.status === "done").toBe(true);
  });

  it("after an update, changed English is missing again and never sent without asking", async () => {
    const t = make({ run: runner(pseudo) });
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    expect((await t.svc.state({ title: "My notes" }))!.missing).toBe(1);
    expect((await t.svc.strings("es", { title: "My notes" }))["harness:title"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/translation.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement `packages/shell/src/main/translation.ts`**

```ts
import { type Language, offeredLanguage } from "@humanharness/harness-sdk/language";
import {
  type PluralCategory,
  type TranslateItem,
  type Translated,
  checkTranslation,
  englishItems,
  flattenStrings,
  pluralForms,
  toResourceEntries,
} from "@humanharness/i18n/translate";
import type { EngineError, SystemTaskResult } from "@humanharness/runtime";
import type { GeneratedStrings, LanguageChoose, LanguageRun, LanguageStart, LanguageState } from "@humanharness/ui/client";
import { translatePrompt } from "./task-prompts";
import { type CacheFile, type TranslationCache } from "./translation-cache";

/** Runs one translation session (runSystemSession bound to the engine, model and log in index.ts). */
export type Runner = (o: {
  next: (turn: number) => Promise<string | null>;
  handle: (request: unknown) => Promise<unknown>;
  onTurn: (result: SystemTaskResult, turn: number) => Promise<void>;
  signal: AbortSignal;
  /** The language being translated into (for the usage log). */
  tag: Language;
}) => Promise<{ ok: boolean; turns: number; error?: EngineError }>;

export interface TranslationDeps {
  cache: TranslationCache;
  /** The core's English, flattened (CORE_EN). */
  core: Record<string, string>;
  /** The harness's `tone` (manifest), or none: neutral. */
  tone?: string;
  language(): Promise<Language>;
  saveLanguage(tag: Language): Promise<void>;
  /** Cheap: whether a run could start now (spec §3). */
  available(): Promise<true | "no-engine" | "mock">;
  /** The engine's name and a runner; null when the engine can't run after all. */
  prepare(): Promise<{ engineName: string; run: Runner } | null>;
  engineName(): Promise<string | undefined>;
  send(state: LanguageState): void;
  batchSize?: number;
}

const MAX_BATCHES = 60;

/** Sorts the items against the cache: kept (valid for this English), given up (failed twice), missing. */
export function classify(items: TranslateItem[], file: CacheFile, forms: readonly PluralCategory[]) {
  const kept = new Map<string, Translated>();
  const missing: TranslateItem[] = [];
  for (const item of items) {
    const e = file.entries[item.key];
    const ok = e && e.en === item.hash ? checkTranslation(item, e.value, forms) : null;
    if (ok?.ok) kept.set(item.key, ok.value);
    else if (!(file.failed[item.key]?.en === item.hash && file.failed[item.key].count >= 2)) missing.push(item);
  }
  return { kept, missing };
}

/**
 * Language on demand in the main process (language spec §4–§6, §9): the state the window shows, switching to English
 * or a complete translation, and the translation run itself. One run at a time; a run never changes the saved language
 * until it completes. Every public method answers data.
 */
export class TranslationService {
  private run: LanguageRun | null = null;
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;
  private harness: Record<string, string> = {};

  constructor(private readonly d: TranslationDeps) {}

  private items(harnessRaw: unknown): TranslateItem[] {
    this.harness = flattenStrings(harnessRaw);
    return englishItems(this.d.core, this.harness);
  }

  async state(harnessRaw: unknown): Promise<LanguageState> {
    const items = this.items(harnessRaw);
    return this.stateOf(items);
  }

  private async stateOf(items: TranslateItem[]): Promise<LanguageState> {
    const language = await this.d.language();
    const cached = await Promise.all(
      (await this.d.cache.tags()).map(async (tag) => ({ tag, complete: classify(items, await this.d.cache.load(tag), pluralForms(tag)).missing.length === 0 })),
    );
    const missing = language === "en" ? 0 : classify(items, await this.d.cache.load(language), pluralForms(language)).missing.length;
    const engineName = await this.d.engineName().catch(() => undefined);
    return { language, cached, missing, canTranslate: await this.d.available(), ...(engineName ? { engineName } : {}), run: this.run };
  }

  async strings(tag: unknown, harnessRaw: unknown): Promise<GeneratedStrings> {
    if (!offeredLanguage(tag) || tag === "en") return {};
    const items = this.items(harnessRaw);
    const { kept } = classify(items, await this.d.cache.load(tag), pluralForms(tag));
    return Object.assign({}, ...[...kept].map(([k, v]) => toResourceEntries(k, v)));
  }

  async choose(tag: unknown, harnessRaw: unknown): Promise<LanguageChoose> {
    if (tag !== "en" && !offeredLanguage(tag)) return { ok: false, reason: "invalid" };
    if (this.running) return { ok: false, reason: "busy" };
    if (tag !== "en") {
      const items = this.items(harnessRaw);
      if (classify(items, await this.d.cache.load(tag), pluralForms(tag)).missing.length > 0) return { ok: false, reason: "needs-translation" };
    }
    await this.d.saveLanguage(tag);
    return { ok: true, language: tag, strings: await this.strings(tag, harnessRaw) };
  }

  async translate(tag: unknown, harnessRaw: unknown): Promise<LanguageStart> {
    if (!offeredLanguage(tag) || tag === "en") return { ok: false, reason: "invalid" };
    if (this.running) return { ok: false, reason: "busy" };
    const can = await this.d.available();
    if (can !== true) return { ok: false, reason: can };
    const ready = await this.d.prepare().catch(() => null);
    if (!ready) return { ok: false, reason: "no-engine" };
    if (this.running) return { ok: false, reason: "busy" };
    const items = this.items(harnessRaw);
    this.controller = new AbortController();
    this.running = this.go(tag, items, ready.run, this.controller.signal).finally(() => {
      this.running = null;
      this.controller = null;
    });
    return { ok: true };
  }

  async cancel(): Promise<{ ok: boolean }> {
    this.controller?.abort();
    return { ok: true };
  }

  /** Quitting or an engine change: the run stops, what it saved stays. */
  async stop(): Promise<void> {
    this.controller?.abort();
    await this.running;
  }

  /** Resolves once no run is going (tests). */
  async settled(): Promise<void> {
    while (this.running) await this.running;
  }

  private async go(tag: Language, items: TranslateItem[], run: Runner, signal: AbortSignal): Promise<void> {
    const forms = pluralForms(tag);
    const file = await this.d.cache.load(tag);
    const { missing } = classify(items, file, forms);
    const size = Math.max(1, this.d.batchSize ?? 100);
    const batches: TranslateItem[][] = [];
    for (let i = 0; i < missing.length && batches.length < MAX_BATCHES; i += size) batches.push(missing.slice(i, i + size));
    let retry: TranslateItem[] = [];
    let retried = false;
    let current: Map<string, TranslateItem> | null = null;
    let saved = new Set<string>();
    this.run = { tag, done: 0, total: batches.length, status: "running" };
    const push = async () => this.d.send(await this.stateOf(items).catch(() => ({ ...this.emptyState(), run: this.run })));
    await push();

    const fail = (key: string, item: TranslateItem) => {
      const count = (file.failed[key]?.en === item.hash ? file.failed[key].count : 0) + 1;
      file.failed[key] = { en: item.hash, count: Math.min(2, count) };
      delete file.entries[key];
      if (count < 2 && !retried) retry.push(item);
    };

    const next = async (turn: number): Promise<string | null> => {
      let batch = batches.shift();
      if (!batch && retry.length > 0 && !retried) {
        retried = true;
        for (let i = 0; i < retry.length; i += size) batches.push(retry.slice(i, i + size));
        retry = [];
        this.run = { ...this.run!, total: this.run!.total + batches.length };
        batch = batches.shift();
      }
      if (!batch) return null;
      current = new Map(batch.map((it) => [it.key, it]));
      saved = new Set();
      const map = Object.fromEntries(batch.map((it) => [it.key, it.en]));
      return translatePrompt({ first: turn === 0, language: tag, ...(this.d.tone ? { tone: this.d.tone } : {}), forms, batch: map });
    };

    const handle = async (request: unknown): Promise<unknown> => {
      const r = typeof request === "object" && request !== null ? (request as { op?: unknown; strings?: unknown }) : {};
      if (r.op !== "save" || typeof r.strings !== "object" || r.strings === null || Array.isArray(r.strings)) throw new Error("Unknown request");
      if (!current) throw new Error("No batch is open");
      const entries = Object.entries(r.strings as Record<string, unknown>).slice(0, 150);
      const refused: string[] = [];
      let kept = 0;
      for (const [key, value] of entries) {
        const item = current.get(key);
        if (!item) {
          refused.push(`${key.slice(0, 80)} (not in this batch)`);
          continue;
        }
        if (saved.has(key)) continue;
        saved.add(key);
        const c = checkTranslation(item, value, forms);
        if (c.ok) {
          file.entries[key] = { en: item.hash, value: c.value };
          delete file.failed[key];
          kept++;
        } else {
          fail(key, item);
          refused.push(`${key} (${c.reason})`);
        }
      }
      await this.d.cache.save(file);
      return refused.length === 0 ? `Saved ${kept}.` : `Saved ${kept}. Not kept: ${refused.slice(0, 20).join(", ")}.`;
    };

    const onTurn = async (result: SystemTaskResult) => {
      const open = current;
      current = null;
      if (!open || !result.ok) return;
      // A key the agent left out counts as a failure, like a refused one.
      for (const [key, item] of open) if (!saved.has(key)) fail(key, item);
      await this.d.cache.save(file).catch((err: unknown) => console.error("Could not save the translation", err));
      this.run = { ...this.run!, done: this.run!.done + 1 };
      await push();
    };

    let outcome: Awaited<ReturnType<Runner>>;
    try {
      outcome = batches.length === 0 ? { ok: true, turns: 0 } : await run({ next, handle, onTurn, signal, tag });
    } catch (err) {
      console.error("The translation run failed", err);
      outcome = { ok: false, turns: 0, error: { code: "agent-crashed" } };
    }
    if (outcome.ok && !signal.aborted) {
      await this.d.saveLanguage(tag).catch((err: unknown) => console.error("Could not save the language", err));
      this.run = { ...this.run!, status: "done" };
    } else {
      const code = outcome.error?.code;
      this.run = { ...this.run!, status: signal.aborted || code === "cancelled" ? "cancelled" : "failed", ...(code === "out-of-quota" ? { reason: "quota" as const } : code && code !== "cancelled" ? { reason: "engine" as const } : {}) };
    }
    await push();
  }

  private emptyState(): LanguageState {
    return { language: "en", cached: [], missing: 0, canTranslate: "no-engine", run: null };
  }
}
```

Note: the test that swaps `d.prepare` reads the private `d`. Keep the constructor parameter named `d`.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/translation.test.ts`
Expected: PASS. Fix ordering issues in `next`/`onTurn` until every case passes, without loosening any assertion.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/main/translation.ts packages/shell/test/translation.test.ts
git commit -m "feat(shell): the translation run, validated and cached batch by batch

<trailer>"
```

---

### Task 13: IPC — `hh:language*` handlers, every answer data

**Files:**
- Create: `packages/shell/src/main/language-ipc.ts`
- Test: `packages/shell/test/language-ipc.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { LANGUAGE_CHANNELS, languageHandlers } from "../src/main/language-ipc";

describe("hh:language* (language spec)", () => {
  it("passes the arguments and answers data; a throw is logged and answered as data", async () => {
    const calls: unknown[][] = [];
    const svc = {
      state: async (h: unknown) => (calls.push(["state", h]), { language: "en" }),
      choose: async () => {
        throw new Error("boom");
      },
      translate: async (t: unknown, h: unknown) => (calls.push(["translate", t, h]), { ok: true }),
      cancel: async () => ({ ok: true }),
      strings: async () => {
        throw new Error("boom");
      },
    };
    const h = languageHandlers(svc as never);
    expect(Object.keys(h).sort()).toEqual([...LANGUAGE_CHANNELS].sort());
    expect(await h["hh:languageState"]({ a: "b" })).toEqual({ language: "en" });
    expect(await h["hh:languageTranslate"]("es", {})).toEqual({ ok: true });
    expect(await h["hh:languageChoose"]("es", {})).toEqual({ ok: false, reason: "failed" });
    expect(await h["hh:languageStrings"]("es", {})).toEqual({});
    expect(calls).toEqual([["state", { a: "b" }], ["translate", "es", {}]]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/language-ipc.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

```ts
import type { TranslationService } from "./translation";

export const LANGUAGE_CHANNELS = ["hh:languageState", "hh:languageChoose", "hh:languageTranslate", "hh:languageCancel", "hh:languageStrings"] as const;
export type LanguageChannel = (typeof LANGUAGE_CHANNELS)[number];

/** The `hh:language*` handlers (language spec). Every answer is data; a throw is a bug, logged, answered with a fallback. */
export function languageHandlers(svc: Pick<TranslationService, "state" | "choose" | "translate" | "cancel" | "strings">): Record<LanguageChannel, (...args: unknown[]) => Promise<unknown>> {
  const call = (fn: () => unknown, fallback: unknown): Promise<unknown> =>
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        console.error("A language call failed", err);
        return fallback;
      });
  const failed = { ok: false as const, reason: "failed" as const };
  return {
    "hh:languageState": (harness) => call(() => svc.state(harness), null),
    "hh:languageChoose": (tag, harness) => call(() => svc.choose(tag, harness), failed),
    "hh:languageTranslate": (tag, harness) => call(() => svc.translate(tag, harness), failed),
    "hh:languageCancel": () => call(() => svc.cancel(), { ok: false }),
    "hh:languageStrings": (tag, harness) => call(() => svc.strings(tag, harness), {}),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/language-ipc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/main/language-ipc.ts packages/shell/test/language-ipc.test.ts
git commit -m "feat(shell): the language IPC handlers

<trailer>"
```

---

### Task 14: preload — `client.language`

**Files:**
- Create: `packages/shell/src/preload/language.ts`
- Modify: `packages/shell/src/preload/index.ts`
- Test: `packages/shell/test/language-preload.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { languageClient } from "../src/preload/language";

describe("client.language in the preload", () => {
  it("passes channels and arguments; a rejected invoke or a non-data answer is the fallback, never a throw", async () => {
    const invoke = vi.fn(async (channel: string) => (channel === "hh:languageTranslate" ? { ok: true } : undefined));
    const c = languageClient(invoke, () => () => {});
    expect(await c.translate("es", { a: "b" })).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("hh:languageTranslate", "es", { a: "b" });
    expect(await c.state({})).toBeNull();
    expect(await c.choose("es", {})).toEqual({ ok: false, reason: "failed" });
    expect(await c.strings("es", {})).toEqual({});
    const rejecting = languageClient(async () => Promise.reject(new Error("no handler")), () => () => {});
    expect(await rejecting.cancel()).toEqual({ ok: false });
    expect(await rejecting.translate("es", {})).toEqual({ ok: false, reason: "failed" });
  });

  it("strings keeps only string values", async () => {
    const c = languageClient(async () => ({ "core:a": "x", "core:b": 3 }), () => () => {});
    expect(await c.strings("es", {})).toEqual({ "core:a": "x" });
  });

  it("onChange hears only well-formed states", () => {
    let push: (v: unknown) => void = () => {};
    const c = languageClient(async () => null, (_ch, l) => ((push = l), () => {}));
    const got: unknown[] = [];
    c.onChange((s) => got.push(s));
    push(null);
    push({ language: 3 });
    push({ language: "es", cached: [], missing: 0, canTranslate: true, run: null });
    expect(got).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/language-preload.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/shell/src/preload/language.ts`:

```ts
import type { GeneratedStrings, LanguageClient, LanguageState } from "@humanharness/ui/client";

export type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type Subscribe = (channel: string, listener: (value: unknown) => void) => () => void;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isState = (v: unknown): v is LanguageState => isObject(v) && typeof v.language === "string" && Array.isArray(v.cached) && typeof v.missing === "number";

/** `client.language`: every answer is data, a rejected invoke included. */
export function languageClient(invoke: Invoke, subscribe: Subscribe): LanguageClient {
  const ask = <T>(fallback: T, ok: (v: unknown) => boolean, channel: string, ...args: unknown[]): Promise<T> =>
    invoke(channel, ...args).then(
      (v) => (ok(v) ? (v as T) : fallback),
      () => fallback,
    );
  const result = (v: unknown) => isObject(v) && "ok" in v;
  const failed = { ok: false as const, reason: "failed" as const };
  return {
    state: (harness) => ask<LanguageState | null>(null, isState, "hh:languageState", harness),
    choose: (tag, harness) => ask(failed, result, "hh:languageChoose", tag, harness),
    translate: (tag, harness) => ask(failed, result, "hh:languageTranslate", tag, harness),
    cancel: () => ask({ ok: false }, result, "hh:languageCancel"),
    strings: (tag, harness) =>
      ask<GeneratedStrings>({}, isObject, "hh:languageStrings", tag, harness).then((m) => Object.fromEntries(Object.entries(m).filter((e): e is [string, string] => typeof e[1] === "string"))),
    onChange: (listener) => subscribe("hh:language", (v) => (isState(v) ? listener(v) : undefined)),
  };
}
```

In `preload/index.ts`: `import { languageClient } from "./language";` and add to the `client` object: `language: languageClient(fileInvoke, (channel, listener) => subscribe<unknown>(channel, listener)),`.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/language-preload.test.ts && corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/preload packages/shell/test/language-preload.test.ts
git commit -m "feat(preload): client.language, every answer data

<trailer>"
```

---

### Task 15: main wiring — the service, the engine session, the server entry

**Files:**
- Modify: `packages/shell/src/main/index.ts`
- Modify: `packages/shell/electron.vite.config.ts`
- Test: `packages/shell/test/bundle-guard.test.ts` (unchanged; the build is the check), plus the e2e in Task 24

- [ ] **Step 1: Bundle the i18n package and the server entry**

In `electron.vite.config.ts`:
- Add `"@humanharness/i18n"` to `workspacePackages`.
- Add to `main.build.lib.entry`: `"translate-server": path.join(__dirname, "../blocks/src/translate-server-bin.ts"),`

- [ ] **Step 2: Wire the service in `index.ts`**

Imports:

```ts
import { translateServerSpec } from "@humanharness/blocks";
import { CORE_EN } from "@humanharness/i18n/translate";
import { runSystemSession } from "@humanharness/runtime";
import { LANGUAGE_CHANNELS, languageHandlers } from "./language-ipc";
import { TranslationCache } from "./translation-cache";
import { type Runner, TranslationService } from "./translation";
import { translateRecord } from "./usage-log";
```

(Merge with existing import lines from the same modules. `runSystemSession` joins the `@humanharness/runtime` import.)

Next to `materialStageDeps`, add:

```ts
/** The model of a translation run (language spec §5): always the light tier of the engine in use. */
const TRANSLATE_KEY = "_translate";

/** Language on demand (plan 5b); built once the harness is loaded. */
let translation: TranslationService | null = null;

function buildTranslation(): TranslationService {
  const cache = new TranslationCache(app.getPath("userData"));
  return new TranslationService({
    cache,
    core: CORE_EN,
    ...(harness.tone ? { tone: harness.tone } : {}),
    language: async () => (await config.load()).language ?? DEFAULT_LANGUAGE,
    saveLanguage: async (tag) => {
      await config.save({ language: tag });
    },
    available: async () => {
      if (hooks.mock) return "mock";
      const c = await validConfig();
      return c && (await hasNotice(c.engineId)) ? true : "no-engine";
    },
    engineName: async () => {
      const c = await validConfig();
      return c ? getEngine(c.engineId).name : undefined;
    },
    prepare: async () => {
      const c = await validConfig();
      if (!c || hooks.mock || !(await hasNotice(c.engineId))) return null;
      const engine = getEngine(c.engineId);
      const cmd = hooks.engines?.[engine.id] ?? (await engineCommand(engine, commandDeps).catch(() => null));
      if (!cmd) return null;
      const models = cleanModels((await config.load()).models);
      const saved = await savedOffer(engine.id);
      const profile = await supportedEffort(firstOffered(resolveProfile({ engine: engine.id, action: TRANSLATE_KEY, manifestTier: "light", models }), models, saved.models), saved);
      const launcher = electronLauncher(process.execPath);
      const base = baseFor(c, profilesOn());
      const run: Runner = (o) =>
        runSystemSession({
          engine,
          command: cmd.command,
          env: cmd.env,
          server: (rpc) => translateServerSpec({ rpc, launcher, entry: path.join(here, "translate-server.js") }),
          parent: path.join(app.getPath("userData"), "translate-work"),
          handle: o.handle,
          next: o.next,
          signal: o.signal,
          profile,
          onTurn: async (r, i) => {
            await o.onTurn(r, i);
            if (base === null) return;
            const record = translateRecord({ engine: engine.id, language: o.tag, batch: i, profile, ok: r.ok, ...(r.usage ? { usage: r.usage } : {}), ...(r.limits ? { limits: r.limits } : {}) });
            await new UsageLog(base).append(record).catch((err: unknown) => console.error("Could not record the translation turn", err));
          },
        });
      return { engineName: engine.name, run };
    },
    send: (state) => sendToWindow("hh:language", state),
  });
}
```

(Use the names that exist in `index.ts`: `baseFor`, `profilesOn`, `hasNotice`, `validConfig`, `cleanModels`, `resolveProfile`, `firstOffered`, `supportedEffort`, `savedOffer`, `engineCommand`, `commandDeps`, `electronLauncher`, `here`, `UsageLog`, `DEFAULT_LANGUAGE`. Check each with `grep -n` before use, and import what is missing from its module.)

After the harness is loaded (right after `const loaded = await loadHarness(...)` assigns `harness`, where the other services are built): `translation = buildTranslation();`

Where the handlers are registered (next to the `contextHandlers` loop): `for (const [channel, fn] of Object.entries(languageHandlers(translation!))) handle(channel, fn);`

**Stop the run:**
- In `before-quit`, inside the async block before `await dropRuntime()`: `await translation?.stop().catch(() => undefined);`
- In `saveConfigPatch`, in the engine-change branch before `guards.switchEngine(...)`: `await translation?.stop().catch(() => undefined);`

- [ ] **Step 3: Build and run the gate**

Run: `corepack pnpm --filter @humanharness/shell build && ls packages/shell/out/main/translate-server.js && corepack pnpm typecheck && corepack pnpm test`
Expected: the file exists, and typecheck and tests pass. The bundle guard (`noBareDirname`) passes.

- [ ] **Step 4: Commit**

```bash
git add packages/shell/src/main/index.ts packages/shell/electron.vite.config.ts
git commit -m "feat(shell): wire the translation run: light tier, translate server, usage, stop on quit and engine change

<trailer>"
```

---

### Task 16: task manager — the open task keeps its language (spec §7)

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts` (`begin`, and the reads at the mode switch, the answer display, the resume, the phase change and the wrap-up)
- Test: `packages/shell/test/task-manager-phases.test.ts`

- [ ] **Step 1: Write the failing test** (append; `setup`, `brief`, `phasePrompt`, `text` are already imported there)

```ts
it("changing the language with an open task leaves that task in its language (language spec §7)", async () => {
  let lang = "es";
  const t = setup({ extra: { language: async () => lang } });
  await t.manager.start("session");
  expect(t.turns[0].message).toContain("Brief of warmup in Spanish.");
  lang = "fr";
  const r = t.manager.setPhase("main", "t1");
  await r.accepted;
  await r.done;
  expect(t.turns.at(-1)!.message).toContain("Brief of main in Spanish.");
  // The next task starts in the new language.
  await t.manager.finish();
  await t.manager.start("quiz");
  expect(t.turns.at(-1)!.message).not.toContain("Spanish");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-phases.test.ts`
Expected: FAIL. The phase brief says "French".

- [ ] **Step 3: Implement**

In `TaskManager`:

```ts
  /** Each open task's language, read when it began (language spec §7): a change applies from the next task. In memory. */
  private readonly taskLanguages = new Map<string, Language>();

  /** The language of task `id`: the one it began in, else (a task from before a restart) the saved one. */
  private async languageOf(id: string | undefined): Promise<Language> {
    const kept = id !== undefined ? this.taskLanguages.get(id) : undefined;
    return kept ?? this.d.language();
  }
```

- In `begin(...)`, as soon as the new task's id is created (the `this.newId()` call there), add `this.taskLanguages.set(id, await this.d.language());`. The callers already read `d.language()` just before, so it is the same value.
- When a task is closed or interrupted (where `current` is cleared), `this.taskLanguages.delete(id)`.
- Replace `await this.d.language()` with `await this.languageOf(c.id)` at the mode switch (around line 1170), the answer display (≈1417, the open task's id), the resume (≈1471), the phase change (≈1816) and the wrap-up (≈2037). The task starts (≈548, 971, 1371) keep `this.d.language()`.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/task-manager*.test.ts`
Expected: PASS. D0: with a constant `language`, every existing test is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/main/task-manager.ts packages/shell/test/task-manager-phases.test.ts
git commit -m "feat(shell): an open task keeps the language it began in

<trailer>"
```

---

### Task 17: ui — the fake client's `language`, and `useLanguage`

**Files:**
- Modify: `packages/ui/test/fake-client.ts`
- Create: `packages/ui/src/language-control.ts`
- Test: `packages/ui/test/language-control.test.tsx` (create)

- [ ] **Step 1: Add the fake** (in `FakeClient`)

```ts
  /** client.language (plan 5b): what state() answers, calls made, and listeners. */
  languageState: LanguageState = { language: "en", cached: [], missing: 0, canTranslate: true, engineName: "Claude Code", run: null };
  languageStrings: Record<string, GeneratedStrings> = {};
  languageCalls: { op: string; args: unknown[] }[] = [];
  chooseAnswer: LanguageChoose | null = null;
  translateAnswer: LanguageStart = { ok: true };
  languageListeners = new Set<(s: LanguageState) => void>();
  pushLanguage(s: Partial<LanguageState>) {
    this.languageState = { ...this.languageState, ...s };
    for (const l of this.languageListeners) l(this.languageState);
  }
  language: LanguageClient = {
    state: async (harness) => (this.languageCalls.push({ op: "state", args: [harness] }), this.languageState),
    choose: async (tag, harness) => {
      this.languageCalls.push({ op: "choose", args: [tag, harness] });
      if (this.chooseAnswer) return this.chooseAnswer;
      const complete = tag === "en" || this.languageState.cached.some((c) => c.tag === tag && c.complete);
      if (!complete) return { ok: false, reason: "needs-translation" };
      this.languageState = { ...this.languageState, language: tag };
      return { ok: true, language: tag, strings: this.languageStrings[tag] ?? {} };
    },
    translate: async (tag, harness) => (this.languageCalls.push({ op: "translate", args: [tag, harness] }), this.translateAnswer),
    cancel: async () => (this.languageCalls.push({ op: "cancel", args: [] }), { ok: true }),
    strings: async (tag) => this.languageStrings[tag] ?? {},
    onChange: (l) => {
      this.languageListeners.add(l);
      return () => void this.languageListeners.delete(l);
    },
  };
```

(Add `GeneratedStrings`, `LanguageChoose`, `LanguageClient`, `LanguageStart`, `LanguageState` to its type import.)

- [ ] **Step 2: Write the failing test**

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createI18n } from "@humanharness/i18n";
import { useLanguage } from "../src/language-control";
import { FakeClient } from "./fake-client";

describe("useLanguage", () => {
  it("chooses a complete language: loads its strings and switches live", async () => {
    const client = new FakeClient();
    client.languageState = { ...client.languageState, cached: [{ tag: "es", complete: true }] };
    client.languageStrings.es = { "core:chat.send": "Enviar" };
    const i18n = await createI18n("en");
    const changed: string[] = [];
    const { result } = renderHook(() => useLanguage(client, i18n, { title: "Notes" }, (tag) => changed.push(tag)));
    await waitFor(() => expect(result.current.view).not.toBeNull());
    await act(async () => expect(await result.current.choose("es")).toBe("switched"));
    expect(i18n.language).toBe("es");
    expect(i18n.t("chat.send")).toBe("Enviar");
    expect(changed).toEqual(["es"]);
    expect(client.languageCalls.find((c) => c.op === "choose")!.args).toEqual(["es", { title: "Notes" }]);
  });

  it("an incomplete language needs the notice; a run's end switches", async () => {
    const client = new FakeClient();
    client.languageStrings.fr = { "core:chat.send": "Envoyer" };
    const i18n = await createI18n("en");
    const { result } = renderHook(() => useLanguage(client, i18n, {}, () => {}));
    await waitFor(() => expect(result.current.view).not.toBeNull());
    await act(async () => expect(await result.current.choose("fr")).toBe("needs-translation"));
    await act(async () => expect(await result.current.translate("fr")).toBe(true));
    await act(async () => client.pushLanguage({ language: "fr", run: { tag: "fr", done: 1, total: 1, status: "done" } }));
    await waitFor(() => expect(i18n.t("chat.send")).toBe("Envoyer"));
  });

  it("without client.language: no view and nothing to do (D0)", async () => {
    const client = new FakeClient();
    (client as { language?: unknown }).language = undefined;
    const i18n = await createI18n("en");
    const { result } = renderHook(() => useLanguage(client, i18n, {}, () => {}));
    expect(result.current.view).toBeNull();
    expect(await result.current.choose("es")).toBe("failed");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/language-control.test.tsx`
Expected: FAIL. The module is not found.

- [ ] **Step 4: Implement `packages/ui/src/language-control.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { i18n as I18n } from "i18next";
import type { Language } from "@humanharness/harness-sdk/language";
import { toResources } from "@humanharness/i18n/translate";
import type { GeneratedStrings, HarnessClient, LanguageState } from "./client";

export interface LanguageControl {
  view: LanguageState | null;
  choose(tag: Language): Promise<"switched" | "needs-translation" | "failed">;
  translate(tag: Language): Promise<boolean>;
  cancel(): void;
}

/** Puts `strings` under `tag` in i18next and shows it (English: just switches back). */
export async function applyLanguage(i18n: I18n, tag: Language, strings: GeneratedStrings): Promise<void> {
  if (tag !== "en") {
    const { core, harness } = toResources(strings);
    i18n.addResourceBundle(tag, "core", core, true, true);
    i18n.addResourceBundle(tag, "harness", harness, true, true);
  }
  await i18n.changeLanguage(tag);
}

/** Language on demand in the window (spec §3–§6): the state, choosing, translating, and the live switch at a run's end. */
export function useLanguage(client: HarnessClient, i18n: I18n | null, harness: Record<string, unknown>, onSwitched: (tag: Language) => void): LanguageControl {
  const [view, setView] = useState<LanguageState | null>(null);
  const harnessRef = useRef(harness);
  harnessRef.current = harness;
  const switchedRef = useRef(onSwitched);
  switchedRef.current = onSwitched;
  const lang = client.language;

  const switchTo = useCallback(
    async (tag: Language, strings?: GeneratedStrings) => {
      if (!i18n || !lang) return;
      await applyLanguage(i18n, tag, strings ?? (tag === "en" ? {} : await lang.strings(tag, harnessRef.current)));
      switchedRef.current(tag);
    },
    [i18n, lang],
  );

  useEffect(() => {
    if (!lang) return;
    let live = true;
    lang.state(harnessRef.current).then(
      (s) => {
        if (live && s) setView(s);
      },
      () => undefined,
    );
    const off = lang.onChange((s) => {
      if (!live) return;
      setView(s);
      if (s.run?.status === "done" && s.language === s.run.tag && i18n?.language !== s.language) void switchTo(s.language);
    });
    return () => {
      live = false;
      off();
    };
  }, [lang, i18n, switchTo]);

  return {
    view,
    choose: async (tag) => {
      if (!lang) return "failed";
      const r = await lang.choose(tag, harnessRef.current);
      if (r.ok) {
        await switchTo(r.language, r.strings);
        setView((v) => v && { ...v, language: r.language, missing: 0 });
        return "switched";
      }
      return r.reason === "needs-translation" ? "needs-translation" : "failed";
    },
    translate: async (tag) => {
      if (!lang) return false;
      const r = await lang.translate(tag, harnessRef.current);
      return r.ok;
    },
    cancel: () => void lang?.cancel(),
  };
}
```

`@humanharness/i18n` is already a `ui` dependency; the `./translate` subpath exists since Task 3.

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm vitest run packages/ui/test/language-control.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/language-control.ts packages/ui/test
git commit -m "feat(ui): useLanguage, the live switch and the fake client's language

<trailer>"
```

---

### Task 18: ui — the language picker dialog

**Files:**
- Create: `packages/ui/src/LanguagePicker.tsx`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/ui/test/language-picker.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguagePicker } from "../src/LanguagePicker";
import { renderIn } from "./render";

const view = { language: "en", cached: [{ tag: "fr", complete: true }], missing: 0, canTranslate: true as const, run: null };

describe("LanguagePicker (spec §2, §3)", () => {
  it("lists languages by their own name with the English name under, the suggestion selected, no RTL", async () => {
    const onPick = vi.fn();
    await renderIn("en", <LanguagePicker current="en" suggested="es" view={view} onPick={onPick} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Language" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("radio", { name: /Español.*Spanish/ })).toBeChecked();
    expect(screen.queryByRole("radio", { name: /Arabic/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Français.*French.*Ready/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(onPick).toHaveBeenCalledWith("es");
  });

  it("filters by search; without an engine only English and complete languages can be picked, and it says why", async () => {
    await renderIn("en", <LanguagePicker current="en" view={{ ...view, canTranslate: "mock" }} onPick={() => {}} onClose={() => {}} />);
    expect(screen.getByText("Connect an AI engine to translate the app.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Español/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /English/ })).not.toBeDisabled();
    expect(screen.getByRole("radio", { name: /Français/ })).not.toBeDisabled();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search languages" }), { target: { value: "port" } });
    expect(screen.getAllByRole("radio").every((r) => /Portuguese/.test(r.getAttribute("aria-label") ?? r.closest("label")?.textContent ?? ""))).toBe(true);
  });

  it("Escape closes without reaching the sheet; Tab stays inside; focus returns to the opener", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const sheetKey = vi.fn();
    document.body.addEventListener("keydown", sheetKey);
    const { unmount } = await renderIn("en", <LanguagePicker current="en" view={view} onPick={() => {}} onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(sheetKey).not.toHaveBeenCalled();
    unmount();
    expect(document.activeElement).toBe(opener);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/language-picker.test.tsx`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement `packages/ui/src/LanguagePicker.tsx`**

```tsx
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Language, languageName, pickerLanguages } from "@humanharness/harness-sdk/language";
import type { LanguageState } from "./client";
import { ownName } from "./language";
import { trapTab } from "./SettingsSheet";

/** Whether `tag` can be used without a translation run: English, or a complete cached translation. */
export const readyLanguage = (view: LanguageState, tag: Language) => tag === "en" || view.cached.some((c) => c.tag === tag && c.complete);

/**
 * The language picker (spec §2, §3): each language by its own name, its English name under it. Languages that need a
 * translation are disabled while none can run, with the reason. Search filters by either name. Modal: Tab stays
 * inside, Escape closes, focus goes back to the opener.
 */
export function LanguagePicker({ current, suggested, view, onPick, onClose }: { current: Language; suggested?: Language; view: LanguageState; onPick: (tag: Language) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Language>(suggested ?? current);
  const all = useMemo(() => pickerLanguages([current, ...(suggested ? [suggested] : []), ...view.cached.map((c) => c.tag)]), [current, suggested, view.cached]);
  const q = query.trim().toLocaleLowerCase();
  const shown = q ? all.filter((tag) => ownName(tag).toLocaleLowerCase().includes(q) || languageName(tag).toLocaleLowerCase().includes(q)) : all;
  const usable = (tag: Language) => view.canTranslate === true || readyLanguage(view, tag);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    search.current?.focus();
    return () => {
      if (opener?.isConnected && opener.closest("[inert]") === null) opener.focus();
    };
  }, []);
  return (
    <div className="hh-langpick-backdrop">
      <div
        ref={dialog}
        className="hh-langpick"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onKeyDown={(e) => {
          if (e.key === "Tab" && dialog.current) {
            e.stopPropagation();
            trapTab(dialog.current, e.nativeEvent);
          }
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      >
        <h2 id={`${id}-title`}>{t("language.pickTitle")}</h2>
        <input ref={search} type="search" aria-label={t("language.search")} placeholder={t("language.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        {view.canTranslate !== true && <p className="hh-caption hh-langpick-reason">{t("language.needsEngine")}</p>}
        <div className="hh-langpick-list" role="radiogroup" aria-labelledby={`${id}-title`}>
          {shown.map((tag) => (
            <label key={tag} className="hh-langpick-option">
              <input type="radio" name={`${id}-lang`} value={tag} checked={picked === tag} disabled={!usable(tag)} onChange={() => setPicked(tag)} />
              <span className="hh-langpick-name" lang={tag}>
                {ownName(tag)}
              </span>
              <span className="hh-caption hh-langpick-english">{languageName(tag)}</span>
              {tag !== "en" && readyLanguage(view, tag) && <span className="hh-langpick-ready">{t("language.ready")}</span>}
            </label>
          ))}
        </div>
        <div className="hh-langpick-actions">
          <button type="button" onClick={onClose}>
            {t("language.cancel")}
          </button>
          <button type="button" className="hh-primary" disabled={picked === current || !usable(picked)} onClick={() => onPick(picked)}>
            {t("language.use")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

(If the test's search assertion is awkward with label text, assert with `screen.getAllByRole("radio").length` before and after typing, plus `getByRole("radio", { name: /Português/ })`.)

Append to `styles.css` (new classes only, one block):

```css
/* Language on demand (plan 5b): picker, notice, offer card, Settings row, legal line. Own classes only (D0). */
.hh-langpick-backdrop, .hh-langnotice-backdrop { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 16px; background: var(--hh-backdrop); }
.hh-langpick { display: flex; flex-direction: column; gap: 10px; width: min(440px, 100%); max-height: min(560px, 90vh); padding: 16px; border-radius: 10px; background: var(--hh-surface); border: 1px solid var(--hh-line); }
.hh-langpick h2 { margin: 0; font-size: 17px; }
.hh-langpick-list { overflow: auto; display: flex; flex-direction: column; gap: 2px; min-height: 120px; }
.hh-langpick-option { display: grid; grid-template-columns: auto 1fr auto; column-gap: 8px; align-items: center; padding: 6px 8px; border-radius: 6px; }
.hh-langpick-option:has(input:checked) { background: var(--hh-segment); }
.hh-langpick-option:has(input:disabled) { opacity: 0.55; }
.hh-langpick-english { grid-column: 2; }
.hh-langpick-ready { grid-row: 1 / span 2; grid-column: 3; font-size: 12px; color: var(--hh-ok); }
.hh-langpick-reason { margin: 0; }
.hh-langpick-actions, .hh-langnotice-actions, .hh-langoffer-actions { display: flex; justify-content: flex-end; gap: 8px; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/ui/test/language-picker.test.tsx packages/ui/test/styles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/LanguagePicker.tsx packages/ui/src/styles.css packages/ui/test/language-picker.test.tsx
git commit -m "feat(ui): the language picker

<trailer>"
```

---

### Task 19: ui — the notice before translating

**Files:**
- Create: `packages/ui/src/TranslateNotice.tsx`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/ui/test/translate-notice.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TranslateNotice } from "../src/TranslateNotice";
import { renderIn } from "./render";

describe("TranslateNotice (spec §4)", () => {
  it("says what runs, on which engine, that legal texts stay English; Cancel is focused; nothing runs until Translate", async () => {
    const onTranslate = vi.fn();
    const onCancel = vi.fn();
    await renderIn("en", <TranslateNotice tag="pt-BR" harnessName="Demo" engineName="Claude Code" onTranslate={onTranslate} onCancel={onCancel} />);
    const d = screen.getByRole("alertdialog", { name: "Translate the app?" });
    expect(d.textContent).toContain("To show Demo in Português (Brasil), your AI engine (Claude Code) will translate the app's texts.");
    expect(d.textContent).toContain("Legal texts stay in English.");
    expect(screen.getByText("Português (Brasil)").tagName).toBe("STRONG");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    expect(onTranslate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));
    expect(onTranslate).toHaveBeenCalledOnce();
    fireEvent.keyDown(d, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/translate-notice.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useId, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk/language";
import { ownName } from "./language";
import { trapTab } from "./SettingsSheet";

/**
 * The notice before a translation run (spec §4, D3): what will run, on whose engine, and that legal texts stay English.
 * Nothing is sent before Translate. Cancel has focus first; Escape cancels; Tab stays inside; focus returns on close.
 */
export function TranslateNotice({ tag, harnessName, engineName, onTranslate, onCancel }: { tag: Language; harnessName: string; engineName: string; onTranslate: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    return () => {
      if (opener?.isConnected && opener.closest("[inert]") === null) opener.focus();
    };
  }, []);
  return (
    <div className="hh-langnotice-backdrop">
      <div
        ref={dialog}
        className="hh-langnotice"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-text`}
        onKeyDown={(e) => {
          if (e.key === "Tab" && dialog.current) {
            e.stopPropagation();
            trapTab(dialog.current, e.nativeEvent);
          }
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }}
      >
        <p id={`${id}-title`}>
          <strong>{t("language.noticeTitle")}</strong>
        </p>
        <p id={`${id}-text`}>
          <Trans i18nKey="language.notice" values={{ name: harnessName, language: ownName(tag), engine: engineName }} components={{ b: <strong /> }} />
        </p>
        <div className="hh-langnotice-actions">
          <button type="button" ref={cancel} onClick={onCancel}>
            {t("language.cancel")}
          </button>
          <button type="button" className="hh-primary" onClick={onTranslate}>
            {t("language.translate")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Append to the plan-5b CSS block: `.hh-langnotice { max-width: 460px; padding: 16px; border-radius: 10px; background: var(--hh-surface); border: 1px solid var(--hh-line); }`

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/ui/test/translate-notice.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/TranslateNotice.tsx packages/ui/src/styles.css packages/ui/test/translate-notice.test.tsx
git commit -m "feat(ui): the notice before translating

<trailer>"
```

---

### Task 20: ui — `LanguageChooser` (picker → notice → run)

**Files:**
- Create: `packages/ui/src/LanguageChooser.tsx`
- Test: `packages/ui/test/language-chooser.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageChooser } from "../src/LanguageChooser";
import type { LanguageControl } from "../src/language-control";
import { renderIn } from "./render";

const view = { language: "en", cached: [], missing: 0, canTranslate: true as const, engineName: "Claude Code", run: null };

function control(choose: Awaited<ReturnType<LanguageControl["choose"]>>): LanguageControl & { translated: string[] } {
  const translated: string[] = [];
  return { view, choose: vi.fn(async () => choose), translate: vi.fn(async (t: string) => (translated.push(t), true)), cancel: vi.fn(), translated };
}

describe("LanguageChooser", () => {
  it("a language that needs a translation: picker, then the notice, then the run", async () => {
    const c = control("needs-translation");
    const onClose = vi.fn();
    await renderIn("en", <LanguageChooser control={c} start={{ pick: "es" }} harnessName="Demo" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(c.translated).toEqual(["es"]);
  });

  it("a complete language switches with no notice; straight to the notice for new texts", async () => {
    const c = control("switched");
    const onClose = vi.fn();
    await renderIn("en", <LanguageChooser control={c} start={{ pick: "es" }} harnessName="Demo" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await renderIn("en", <LanguageChooser control={c} start={{ notice: "es" }} harnessName="Demo" onClose={() => {}} />);
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/language-chooser.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk/language";
import type { LanguageControl } from "./language-control";
import { LanguagePicker } from "./LanguagePicker";
import { TranslateNotice } from "./TranslateNotice";

/** Picking a language (spec §3–§4): the picker, then, only for a language with no complete translation, the notice. */
export function LanguageChooser({ control, start, harnessName, onClose }: { control: LanguageControl; start: { pick?: Language } | { notice: Language }; harnessName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<Language | null>("notice" in start ? start.notice : null);
  const [failed, setFailed] = useState(false);
  const view = control.view;
  if (!view) return null;
  if (notice)
    return (
      <TranslateNotice
        tag={notice}
        harnessName={harnessName}
        engineName={view.engineName ?? ""}
        onCancel={onClose}
        onTranslate={() => {
          void control.translate(notice).then(onClose, onClose);
        }}
      />
    );
  return (
    <>
      <LanguagePicker
        current={view.language}
        {...("pick" in start && start.pick ? { suggested: start.pick } : {})}
        view={view}
        onClose={onClose}
        onPick={(tag) => {
          void control.choose(tag).then((r) => {
            if (r === "switched") onClose();
            else if (r === "needs-translation") setNotice(tag);
            else setFailed(true);
          });
        }}
      />
      {failed && (
        <p className="hh-save-error" role="alert">
          {t("language.failed")}
        </p>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/ui/test/language-chooser.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/LanguageChooser.tsx packages/ui/test/language-chooser.test.tsx
git commit -m "feat(ui): choosing a language, with the notice only when it needs a translation

<trailer>"
```

---

### Task 21: ui — Settings › General › Language, and `HarnessApp` wiring

**Files:**
- Modify: `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/SettingsSheet.tsx`, `packages/ui/src/styles.css`, `packages/ui/src/index.ts`
- Test: `packages/ui/test/settings.test.tsx`, `packages/ui/test/HarnessApp.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `settings.test.tsx` (use its existing render helper for the sheet with a `FakeClient`, and pass the new `language` prop built with `useLanguage` through a tiny wrapper, or a hand-made `LanguageControl`):

```tsx
describe("Settings › General › Language (spec §3, §5, §6)", () => {
  const control = (view: Partial<LanguageState>) => ({
    view: { language: "es", cached: [], missing: 0, canTranslate: true as const, engineName: "Claude Code", run: null, ...view },
    choose: vi.fn(async () => "switched" as const),
    translate: vi.fn(async () => true),
    cancel: vi.fn(),
  });

  it("shows the language by its own name and English name, with Change…", async () => {
    await renderSettings({ language: control({ cached: [{ tag: "es", complete: true }] }) });
    expect(screen.getByText("Español")).toBeTruthy();
    expect(screen.getByText("Spanish")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    expect(screen.getByRole("dialog", { name: "Language" })).toBeTruthy();
  });

  it("a running translation shows its progress and Cancel", async () => {
    const c = control({ run: { tag: "es", done: 3, total: 5, status: "running" } });
    await renderSettings({ language: c });
    expect(screen.getByRole("status").textContent).toContain("Translating… 3 of 5");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(c.cancel).toHaveBeenCalled();
  });

  it("a stopped run offers Try again; new texts offer Translate; no engine disables them with the reason", async () => {
    await renderSettings({ language: control({ run: { tag: "es", done: 1, total: 5, status: "failed", reason: "quota" } }) });
    expect(screen.getByText("The translation stopped. What it finished is kept.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    cleanup();
    await renderSettings({ language: control({ cached: [{ tag: "es", complete: false }], missing: 4 }) });
    expect(screen.getByText("Some texts are new. Translate them?")).toBeTruthy();
    cleanup();
    await renderSettings({ language: control({ missing: 800, canTranslate: "mock" }) });
    expect(screen.getByText("The app's texts aren't in Español yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Translate" })).toBeDisabled();
    expect(screen.getByText("Connect an AI engine to translate the app.")).toBeTruthy();
  });

  it("D0: no language control keeps today's read-only row", async () => {
    await renderSettings({});
    expect(screen.queryByRole("button", { name: "Change…" })).toBeNull();
    expect(screen.getByText("The AI always thinks in English and writes to you in this language.")).toBeTruthy();
  });
});
```

(`renderSettings` = the file's existing helper, extended to pass `language` to `SettingsSheet`. If no such helper exists, write one that renders `<SettingsSheet client={client} state={client.state} tab="general" onTab={() => {}} onChange={() => {}} onClose={() => {}} onSetup={() => {}} language={opts.language} />` through `renderIn("en", …)`.)

In `HarnessApp.test.tsx`:

```tsx
it("starts in the saved language's cached strings; D0 English asks for none", async () => {
  const client = new FakeClient();
  client.state.config.language = "es";
  client.languageStrings.es = { "core:home.start": "Empezar {{name}}" };
  render(<HarnessApp client={client} />);
  expect(await screen.findByRole("button", { name: /Empezar/ })).toBeTruthy();
  const en = new FakeClient();
  en.state.config.language = "en";
  const spy = vi.spyOn(en.language, "strings");
  render(<HarnessApp client={en} />);
  await screen.findAllByRole("button");
  expect(spy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/settings.test.tsx packages/ui/test/HarnessApp.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`HarnessApp.tsx`:
- In the load effect, before `createI18n`:

```ts
        const lang = s.config.language ?? systemLanguage();
        // Plan 5b: the saved language's cached translation; English (D0) asks for nothing.
        const strings = lang !== "en" && client.language ? await client.language.strings(lang, localesRef.current?.en ?? {}).catch(() => ({})) : {};
        const instance = await createI18n(lang, localesRef.current, strings);
```

- After the i18n state, add: `const language = useLanguage(client, i18n, locales?.en ?? {}, (tag) => setState((s) => s && { ...s, config: { ...s.config, language: tag } }));`. Hooks must run before the early returns, so place it with the other hooks.
- Pass `language={client.language ? language : undefined}` to `SettingsSheet` (and to `Home` in Task 22).
- Update the comment "English until plan 5b translates the app" to "the shown language: the saved one once its translation is loaded".

`SettingsSheet.tsx`:
- Add the prop `language?: LanguageControl` to `SettingsSheet` and pass it to `GeneralTab`.
- In `GeneralTab`, replace the Language row with:

```tsx
        <LanguageRow state={state} language={language} />
```

and add below `GeneralTab`:

```tsx
/** Settings › General › Language (spec §3, §5, §6). Without a language control (D0): the read-only row of plan 5a. */
function LanguageRow({ state, language }: { state: AppState; language?: LanguageControl }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<null | { pick?: Language } | { notice: Language }>(null);
  const lang = language?.view?.language ?? state.config.language ?? systemLanguage();
  const view = language?.view ?? null;
  const run = view?.run ?? null;
  const can = view?.canTranslate === true;
  const stopped = run && (run.status === "failed" || run.status === "cancelled") ? run : null;
  const untranslated = view && lang !== "en" && !run?.status.startsWith("run") && view.missing > 0;
  const none = untranslated && !view.cached.some((c) => c.tag === lang);
  return (
    <>
      <div className="hh-row hh-row-wrap">
        <span className="hh-row-label">{t("settings.language")}</span>
        <span className="hh-langrow-name">
          <span lang={lang}>{ownName(lang)}</span>
          {lang !== "en" && <span className="hh-caption"> {languageName(lang)}</span>}
        </span>
        {language && view && (
          <button type="button" onClick={() => setOpen({})} disabled={run?.status === "running"}>
            {t("language.change")}
          </button>
        )}
        <p className="hh-caption hh-row-note">{t("settings.languageHint")}</p>
      </div>
      {language && run?.status === "running" && (
        <div className="hh-row hh-langrow-progress" role="status">
          <span>{t("language.progress", { done: run.done, total: run.total })}</span>
          <button type="button" onClick={() => language.cancel()}>
            {t("language.cancel")}
          </button>
        </div>
      )}
      {language && stopped && (
        <div className="hh-row hh-langrow-stopped">
          <span>{t("language.stopped")}</span>
          <button type="button" disabled={!can} onClick={() => setOpen({ notice: stopped.tag })}>
            {t("language.tryAgain")}
          </button>
        </div>
      )}
      {language && !stopped && untranslated && (
        <div className="hh-row hh-langrow-new">
          <span>{none ? t("language.notYet", { language: ownName(lang) }) : t("language.newTexts")}</span>
          <button type="button" disabled={!can} onClick={() => setOpen({ notice: lang })}>
            {t("language.translate")}
          </button>
        </div>
      )}
      {language && view && !can && (stopped || untranslated) && <p className="hh-caption">{t("language.needsEngine")}</p>}
      {language && open && <LanguageChooser control={language} start={open} harnessName={state.harness.name} onClose={() => setOpen(null)} />}
    </>
  );
}
```

(`run?.status.startsWith("run")` is `status === "running"`. Write it as `run?.status !== "running"` in the code for clarity. Import `Language`, `languageName` from `@humanharness/harness-sdk/language`, `LanguageControl` from `./language-control`, `LanguageChooser` from `./LanguageChooser`.)

CSS (append to the 5b block): `.hh-langrow-name { display: inline-flex; gap: 6px; align-items: baseline; }` and `.hh-langrow-progress, .hh-langrow-stopped, .hh-langrow-new { gap: 8px; }`.

`index.ts`: export `LanguagePicker`, `TranslateNotice`, `LanguageChooser`, `useLanguage`, `type LanguageControl`.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/ui && corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): Settings › General › Language: change, progress, try again, new texts

<trailer>"
```

---

### Task 22: ui — the offer card on Home

**Files:**
- Modify: `packages/ui/src/Home.tsx`, `packages/ui/src/HarnessApp.tsx` (pass `language`), `packages/ui/src/styles.css`
- Test: `packages/ui/test/home.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
import { languageOffer } from "../src/Home";

describe("the language offer (spec §3, §10)", () => {
  const view = { language: "en", cached: [], missing: 0, canTranslate: true as const, run: null };
  const configured = { language: "en", folder: "/f", engineId: "claude" };
  it("suggests a non-English saved language without a complete translation, else the system language; never English (D0)", () => {
    expect(languageOffer({ config: { ...configured, language: "es" } }, { ...view, language: "es", missing: 9 }, true, "en")).toBe("es");
    expect(languageOffer({ config: configured }, view, true, "fr")).toBe("fr");
    expect(languageOffer({ config: configured }, view, true, "en")).toBeNull();
    expect(languageOffer({ config: configured }, view, true, "he")).toBeNull();
  });
  it("not before the engine is ready, not in mock mode, not once answered", () => {
    expect(languageOffer({ config: configured }, view, false, "fr")).toBeNull();
    expect(languageOffer({ config: configured, mock: true }, view, true, "fr")).toBeNull();
    expect(languageOffer({ config: { ...configured, languageOffered: true } }, view, true, "fr")).toBeNull();
    expect(languageOffer({ config: configured }, null, true, "fr")).toBeNull();
  });
});

it("the card: Choose language opens the picker; Not now hides it for good", async () => {
  const client = new FakeClient();
  client.state.config = { ...client.state.config, language: "es", languageOffered: undefined };
  const c = { view: { language: "es", cached: [], missing: 9, canTranslate: true as const, engineName: "Claude Code", run: null }, choose: vi.fn(), translate: vi.fn(), cancel: vi.fn() };
  await renderHome(client, { language: c, status: client.status });
  const card = screen.getByRole("region", { name: "Use Demo in another language?" });
  expect(card.textContent).toContain("Suggested: Español");
  fireEvent.click(screen.getByRole("button", { name: "Choose language" }));
  expect(screen.getByRole("dialog", { name: "Language" })).toBeTruthy();
  expect(client.savedPatches.at(-1)).toEqual({ languageOffered: true });
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await waitFor(() => expect(client.state.config.languageOffered).toBe(true));
});
```

(Use the file's existing Home render helper. If `FakeClient` records saves under another name than `savedPatches`, use it.)

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/home.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `Home.tsx` export:

```ts
/**
 * The language to offer on Home once (spec §3, §10), or null. Only with a ready engine, outside mock mode, never once
 * answered, and only with a non-English suggestion (D0: an English person and an English system see nothing new).
 */
export function languageOffer(state: { config: AppConfig; mock?: boolean }, view: LanguageState | null, connected: boolean | null, system: Language): Language | null {
  if (!view || connected !== true || state.mock || state.config.languageOffered === true || !isConfigured(state.config)) return null;
  const saved = view.language;
  if (saved !== "en") return view.missing > 0 ? saved : null;
  return system !== "en" && offeredLanguage(system) ? system : null;
}
```

Add the prop `language?: LanguageControl` to `Home`. Inside, with `const offer = language ? languageOffer(state, language.view, connected, systemLanguage()) : null;`, `const [choosing, setChoosing] = useState(false);` and `const offerId = useId();`, render the card above the Start area:

```tsx
      {language && offer && (
        <section className="hh-langoffer" aria-labelledby={offerId}>
          <h2 id={offerId}>{t("language.offerTitle", { name })}</h2>
          <p className="hh-caption">{t("language.offerSuggested", { language: ownName(offer) })}</p>
          <div className="hh-langoffer-actions">
            <button type="button" onClick={() => void client.saveConfig({ languageOffered: true }).then(onChange, () => {})}>
              {t("language.offerLater")}
            </button>
            <button
              type="button"
              className="hh-primary"
              onClick={() => {
                setChoosing(true);
                void client.saveConfig({ languageOffered: true }).then(onChange, () => {});
              }}
            >
              {t("language.offerChoose")}
            </button>
          </div>
        </section>
      )}
      {language && choosing && <LanguageChooser control={language} start={{ pick: offer ?? undefined }} harnessName={name} onClose={() => setChoosing(false)} />}
```

Keep `offer` in a ref while `choosing` is true, so the chooser keeps its suggestion after `languageOffered` is saved and the card goes: `const offered = useRef<Language | null>(null); if (offer) offered.current = offer;` and pass `offered.current`. In `HarnessApp.tsx` pass `language={client.language ? language : undefined}` to `Home`.

CSS (5b block): `.hh-langoffer { display: flex; flex-direction: column; gap: 6px; padding: 14px 16px; border: 1px solid var(--hh-line); border-radius: 10px; background: var(--hh-sheet); }` and `.hh-langoffer h2 { margin: 0; font-size: 15px; }`.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/ui`
Expected: PASS, including every existing Home test (D0: the existing tests have no `language` prop, so no card).

- [ ] **Step 5: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): the language offer on Home, once, only with a non-English suggestion

<trailer>"
```

---

### Task 23: ui — the setup line and the legal line

**Files:**
- Modify: `packages/ui/src/SetupFlow.tsx:326-328`, `packages/ui/src/EngineOnboarding.tsx` (notice body), `packages/ui/src/EngineTab.tsx:233`, `packages/ui/src/styles.css`
- Test: `packages/ui/test/setup-flow.test.tsx`, `packages/ui/test/engine-tab.test.tsx`

- [ ] **Step 1: Write the failing tests**

`setup-flow.test.tsx`:

```tsx
it("the folder step says the language comes once the app is set up (spec §3, D2)", async () => {
  await renderSetup();
  expect(await screen.findByText("You can choose the app's language once it's set up.")).toBeTruthy();
});
```

`engine-tab.test.tsx`:

```tsx
it("in another language, legal text stays English with a line saying so (spec §8)", async () => {
  const i18n = await createI18n("es", {}, { "core:language.legalEnglish": "Los textos legales se muestran en inglés.", "core:engine.data": "Datos" });
  render(<I18nextProvider i18n={i18n}><EngineTab {...props} /></I18nextProvider>);
  expect(screen.getByText(/this app is not responsible for what the AI writes/)).toBeTruthy();
  expect(screen.getByText("Los textos legales se muestran en inglés.")).toBeTruthy();
});

it("D0: in English there is no legal line", async () => {
  await renderIn("en", <EngineTab {...props} />);
  expect(screen.queryByText("Legal texts are shown in English.")).toBeNull();
});
```

(Use the file's existing `props` for a configured engine. Add the same pair to the onboarding notice test in `setup-flow.test.tsx` or `engine-tab.test.tsx`, wherever `EngineOnboarding` with `problem === "notice"` is already rendered.)

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/setup-flow.test.tsx packages/ui/test/engine-tab.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`SetupFlow.tsx`, after the `setupFlow.folderIntro` paragraph: `<p className="hh-caption hh-setup-language">{t("setupFlow.languageLater")}</p>`

A small shared component in `EngineTab.tsx` (exported for `EngineOnboarding`):

```tsx
/** Under a legal block when the screen isn't English (spec §8): the line is in the app's language, the block in English. */
export function LegalInEnglish() {
  const { t, i18n } = useTranslation();
  return i18n.resolvedLanguage && i18n.resolvedLanguage !== "en" ? <p className="hh-caption hh-legal-english">{t("language.legalEnglish")}</p> : null;
}
```

Render `<LegalInEnglish />` after `legal.engine.noticeContent` in `EngineTab.tsx` and after the notice's `<p>{t("legal.engine.noticeContent", v)}</p>` in `EngineOnboarding.tsx`.

CSS (5b block): `.hh-legal-english { margin-top: 4px; font-style: italic; }` and `.hh-setup-language { margin-top: 4px; }`.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): the setup line and the legal line

<trailer>"
```

---

### Task 24: e2e — the translation on the built app (fake engine), and mock mode

**Files:**
- Create: `packages/e2e/tests/language.spec.ts`
- Modify: `packages/e2e/tests/helpers.ts` (`makeSandbox` writes `languageOffered: true` unless the test overrides it, so the existing specs keep their screens)

- [ ] **Step 1: Keep the other specs unchanged**

In `makeSandbox`, write `{ language: "es", folder, engineId: "claude", languageOffered: true, ...config }`, and update its doc comment ("…and the language offer already answered (plan 5b)").

- [ ] **Step 2: Write the spec**

```ts
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { type ClaudeScript, claudeResultLine, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, launchMock, makeSandbox, readJsonl, usageFile } from "./helpers";

test.setTimeout(180_000);
const idle: ClaudeScript = { steps: [...claudeTextLines("ok"), claudeResultLine(true)] };
const translating = (prefix: string): ClaudeScript => ({
  ...idle,
  turns: [{ match: "<batch>", steps: [{ line: { type: "system", subtype: "init", session_id: "tr" } }, { pseudoTranslate: { prefix } }, claudeResultLine(true, "done", "tr")] }],
});

test("D0: an English app shows no offer, no new strings and writes no locales", async () => {
  const s = makeSandbox("lang-d0", { language: "en", languageOffered: false });
  const { app, page } = await launch(s, { claude: idle });
  try {
    await expect(page.getByRole("button", { name: "Start Demo" })).toBeVisible();
    await expect(page.getByRole("region", { name: /in another language/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByText("English", { exact: true })).toBeVisible();
    expect(fs.existsSync(path.join(s.userData, "locales"))).toBe(false);
  } finally {
    await closeAndClean(app, s);
  }
});

test("the offer, the notice, the run in batches, the live switch; legal text stays English", async () => {
  const s = makeSandbox("lang-run", { languageOffered: false });
  const { app, page } = await launch(s, { claude: translating("[es]") });
  try {
    const card = page.getByRole("region", { name: "Use Demo in another language?" });
    await expect(card).toContainText("Suggested: Español");
    await card.getByRole("button", { name: "Choose language" }).click();
    const picker = page.getByRole("dialog", { name: "Language" });
    await expect(picker.getByRole("radio", { name: /Español/ })).toBeChecked();
    await picker.getByRole("button", { name: "Use" }).click();
    const notice = page.getByRole("alertdialog", { name: "Translate the app?" });
    await expect(notice).toContainText("Legal texts stay in English.");
    // Nothing went to the engine before Translate (D3).
    expect(readJsonl<{ prompt: string }>(s.claudePrompts).filter((r) => r.prompt.includes("<batch>"))).toEqual([]);
    await notice.getByRole("button", { name: "Translate" }).click();
    await expect(page.getByRole("button", { name: "[es] Start Demo" })).toBeVisible({ timeout: 150_000 });
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("es");

    const runs = readJsonl<{ argv: string[]; prompt: string }>(s.claudePrompts).filter((r) => r.prompt.includes("<batch>"));
    expect(runs.length).toBeGreaterThan(1);
    expect(runs[0].prompt).toContain("into Spanish");
    expect(runs.some((r) => r.prompt.includes("legal."))).toBe(false);
    expect(runs[1].argv).toContain("--resume");
    const cache = JSON.parse(fs.readFileSync(path.join(s.userData, "locales", "es.json"), "utf8"));
    expect(cache.entries["core:chat.send"].value).toBe("[es] Send");
    const usage = readJsonl<{ phase?: string; language?: string }>(usageFile(s)).filter((r) => r.phase === "translate");
    expect(usage.length).toBe(runs.length);
    expect(JSON.parse(fs.readFileSync(path.join(s.userData, "config.json"), "utf8")).language).toBe("es");

    // Legal text stays English, with the line in the app's language.
    await page.getByRole("button", { name: "[es] Settings" }).click();
    await page.getByRole("tab", { name: "[es] Engine" }).click();
    await expect(page.getByText(/this app is not responsible for what the AI writes/)).toBeVisible();
    await expect(page.getByText("[es] Legal texts are shown in English.")).toBeVisible();

    // Back to English at once, no notice.
    await page.getByRole("tab", { name: "[es] General" }).click();
    await page.getByRole("button", { name: "[es] Change…" }).click();
    await page.getByRole("radio", { name: /English/ }).check();
    await page.getByRole("button", { name: "[es] Use" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "General" })).toBeVisible();
  } finally {
    await closeAndClean(app, s);
  }
});

test("a failed run stays in English, keeps nothing new, and offers Try again", async () => {
  const s = makeSandbox("lang-fail", { languageOffered: true });
  const failing: ClaudeScript = { ...idle, turns: [{ match: "<batch>", steps: [{ line: { type: "result", subtype: "error_during_execution", is_error: true, result: "boom" } }] }], exitCode: 0 };
  const { app, page } = await launch(s, { claude: failing });
  try {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Translate" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Translate" }).click();
    await expect(page.getByText("The translation stopped. What it finished is kept.")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
    await expect(page.getByRole("tab", { name: "General" })).toBeVisible();
    expect(JSON.parse(fs.readFileSync(path.join(s.userData, "config.json"), "utf8")).language).toBe("es");
  } finally {
    await closeAndClean(app, s);
  }
});

test("mock mode: the picker opens, says why, and only English can be picked", async () => {
  const s = makeSandbox("lang-mock", { languageOffered: false });
  const { app, page } = await launchMock(s);
  try {
    await expect(page.getByRole("region", { name: /in another language/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Change…" }).click();
    const picker = page.getByRole("dialog", { name: "Language" });
    await expect(picker.getByText("Connect an AI engine to translate the app.")).toBeVisible();
    await expect(picker.getByRole("radio", { name: /Français/ })).toBeDisabled();
    await expect(picker.getByRole("radio", { name: /English/ })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Change…" })).toBeFocused();
  } finally {
    await closeAndClean(app, s);
  }
});
```

Also add one assertion to the existing fresh mock-setup test in `mock.spec.ts`, on the folder step: `await expect(page.getByText("You can choose the app's language once it's set up.")).toBeVisible();`

- [ ] **Step 3: Run**

Run: `corepack pnpm e2e -- language.spec.ts mock.spec.ts`
Expected: PASS. Then run the whole suite: `corepack pnpm e2e`. Expected: PASS (D0).

- [ ] **Step 4: Commit**

```bash
git add packages/e2e
git commit -m "test(e2e): language on demand: offer, notice, batches, switch, failure, mock mode

<trailer>"
```

---

### Task 25: docs

**Files:**
- Create: `docs/architecture/language.md`
- Modify: `docs/architecture/mock-mode.md`, `docs/architecture/setup.md`, `docs/architecture/engines.md`, `packages/cli/guide/new-harness.md`, `docs/superpowers/plans/2026-10-10-00-roadmap.md`

- [ ] **Step 1: Write `docs/architecture/language.md`** (English, short sentences; the sections and facts below, no new claims)

- **What it is:** The app ships English. A person picks a language after setup. Their engine translates the screens after a notice. The AI thinks in English. Spec link, plans 5a/5b.
- **Where to choose:** Settings › General › Language (Change…, progress, Try again, new texts) and the Home offer (once; only with a non-English suggestion; never in mock mode or without a ready engine). Setup's folder step says it comes later.
- **The run:** `TranslationService` (`packages/shell/src/main/translation.ts`), `runSystemSession` (`packages/runtime/src/system-session.ts`) and the `translate` server (`packages/blocks/src/translate-server.ts`). It works in an empty folder under `<userData>/translate-work/`, uses the light tier and runs batches of 100 keys, one turn each, in one session. Prompt: `TRANSLATE_PROMPT` in `task-prompts.ts`. It never starts without the notice. One run at a time. Quit and engine change stop it.
- **Validation:** The rules of `checkTranslation`, listed: the key was sent, the text isn't empty, the placeholders and tags are the same, there's no new `<`/`>`, no `$t(`, no control or bidi characters and no new line break, it's at most max(80, 4× English) and at most 4000 characters, and a plural has every form. A key that fails is retried once, then stays English until its English changes.
- **Cache:** The format of `<userData>/locales/<tag>.json`, cyrb53 hashes, and how changed English becomes "Some texts are new." It is read again on every load. Only a run writes it (D0).
- **Legal texts:** They live under `legal.` (core: `legal.engine.*`; a harness may use `legal.` in its own `en.json`). They are never sent, always shown in English, and carry the "Legal texts are shown in English." line.
- **Usage:** `phase: "translate"` lines, left out of task estimates.
- **The open task keeps its language.** `AGENTS.md` is rewritten at the next task.
- **Testing:** `pseudoTranslate` step in `fake-claude` (`[xx] English`, `breakKeys`). `packages/e2e/tests/language.spec.ts`.

- [ ] **Step 2: Update the other docs**

- `mock-mode.md`, "What the tester sees": add "**Language.** Mock mode never translates: the picker opens, says 'Connect an AI engine to translate the app.' and offers English and complete cached languages only; the Home offer doesn't show."
- `setup.md`: the folder step's line "You can choose the app's language once it's set up." (spec D2).
- `engines.md`: the notice's texts are `legal.engine.*` keys and always render in English.
- `packages/cli/guide/new-harness.md`: in the strings section, say:
  - the harness writes one English `locales/en.json`, and the app translates it on demand with the manifest's `tone`;
  - keep `{{placeholders}}`;
  - put any terms, consent or responsibility text under `legal.` so it is never translated.
- Roadmap row 5b: replace "Written when 5a lands" with "Plan `2026-10-28-language-on-demand.md`", and note the deviations listed under Conflicts with the spec.

- [ ] **Step 3: Commit**

```bash
git add docs packages/cli/guide/new-harness.md
git commit -m "docs: language on demand

<trailer>"
```

---

### Task 26: full gate

- [ ] **Step 1:** Run `corepack pnpm typecheck && corepack pnpm test`. Expected: PASS.
- [ ] **Step 2:** Run `corepack pnpm e2e`. Expected: PASS.
- [ ] **Step 3:** Check the hard rules with greps:
  - `grep -rn "\.claude\|\.codex\|\.gemini\|opencode" packages/shell/src/main/translation*.ts packages/runtime/src/system-session.ts packages/blocks/src/translate-server*.ts` should print nothing.
  - `git diff feat/context-panel -- packages/shell/src/renderer/index.html` should be empty (CSP untouched).
  - `git diff feat/context-panel -- '**/package.json'` should show only the `./translate` export and the shell's workspace dependency on `@humanharness/i18n`.
- [ ] **Step 4:** If anything was fixed, commit it with `fix: gate` and the trailer. Then stop: the branch is ready for review (superpowers:finishing-a-development-branch).
