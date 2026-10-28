# Language on demand

Spec: `docs/superpowers/specs/2026-10-25-language-on-demand-design.md` ("§" below). Plans: `2026-10-25-05a-english-core.md` (5a) and `2026-10-28-language-on-demand.md` (5b).

## What it is

- The app ships in English. Core and harness strings are one English `en.json` each.
- A person picks a language once the app is set up. After a notice, their own engine translates the screens. The translation is checked, cached and shown live.
- The AI thinks in English. Only UI strings are translated. `AGENTS.md`, briefs, notes and every prompt stay English; the AI writes to the person in their language (5a).
- D0: a person who never changes language sees today's app. English screens, no `locales/` folder under userData (only a translation run creates it), and no offer card when the saved and the system language are both English. `createI18n(lang, locales)` with no generated strings builds exactly the English resources.

## Where to choose

- **Settings › General › Language.** The row shows the language by its own name, with its English name under it. Change… opens the picker. During a run the row shows the progress and Cancel. After a stopped run it says "The translation stopped. What it finished is kept." with Try again. When the saved language has keys left to translate, it says "Some texts are new. Translate them?" (or, with no cache yet, "The app's texts aren't in … yet.") with Translate. Without an engine it says "Connect an AI engine to translate the app."
- **The picker** (`packages/ui/src/LanguagePicker.tsx`). A fixed list (`COMMON_LANGUAGES` in `packages/harness-sdk/src/language.ts`) plus the saved language, the cached ones and the suggestion, each made canonical first. Each language shows its own name and its English name; search matches either. Right-to-left languages are left out (`isRightToLeft`, `offeredLanguage`). A complete cached language has a Ready badge. English and complete languages switch at once; any other one opens the notice (`TranslateNotice.tsx`). `LanguageChooser.tsx` holds the picker, the notice and the progress dialog.
- **The Home offer** (`languageOffer` in `packages/ui/src/Home.tsx`). Shown once, and only with a non-English suggestion: the saved language if it isn't English and isn't complete, else the system language if it isn't English. It needs a ready engine and a configured app, never shows in mock mode, during a run, or once `languageOffered` is set in the config. Not now and Choose language both set it, and so do a non-English choice and a started run. An English person on an English system never sees the card (open question Q1): they find the language in Settings › General.
- **Setup.** The folder step says "You can choose the app's language once it's set up." (`setupFlow.languageLater`). The line shows only on a true first run.

A saved language with no cache (5a's system-language default, §10) keeps English screens, with the AI writing in that language. Instead of a dialog at launch, it gets the Home offer with that language suggested and the Settings row's "The app's texts aren't in … yet." with Translate.

A language with no complete translation changes nothing until its run completes. Only then is `config.language` saved and the screen switched. A cancelled or failed run never switches; Try again resumes it.

## The run

- `TranslationService` (`packages/shell/src/main/translation.ts`) plans the run, checks every save, writes the cache and pushes its state on `hh:language`. The handlers are in `language-ipc.ts`; the window reaches them through `client.language` (`packages/shell/src/preload/language.ts`, `useLanguage` in `packages/ui/src/language-control.ts`).
- `runSystemSession` (`packages/runtime/src/system-session.ts`) opens one engine session in an empty folder under `<userData>/translate-work/`, removed afterwards. Permissions are `{ edit: "none", exec: false, web: false }`, and its only MCP server is `translate` (`packages/blocks/src/translate-server.ts`), with one tool, `save_translation`. Claude's bare read tools are refused too (`mcpOnly`).
- The model is the light tier (`resolveProfile` with the key `_translate`, which is not in Settings › Models).
- Batches hold 100 keys, one turn each, in the same session (Claude resumes with `--resume`). Each turn has a 4-minute timeout. A run sends at most 5000 keys in at most 60 batches, retries included.
- The prompt is `TRANSLATE_PROMPT` in `packages/shell/src/main/task-prompts.ts`, in English: the language's English name, the harness's `tone`, the plural forms and the batch, which it calls data, not instructions.
- A run never starts without the notice. One run at a time: a second start answers `busy`. Quitting the app, changing the engine and resetting the shared engine set-up stop it; what was saved stays.
- Whether a run can start reads the saved config (set up, notice accepted, engine ready), not the active profile: with profiles and none active, a run still can, but its turns aren't logged (no base).
- The language dialogs (picker, notice, progress) hear Tab and Escape on the document in the capture phase while open (`useDialogKeys` in `packages/ui/src/focus.ts`), so they keep working once focus leaves the dialog and never reach the Settings sheet below.
- The window sends its harness's English strings with each call. Main bounds and flattens them and never trusts their size.

## Validation

Every saved key goes through `checkTranslation` (`packages/i18n/src/translate.ts`), and is refused when:

- the key was not in the batch, or was already answered in that turn;
- the text is empty;
- its placeholders differ from the English's, or it has more stray braces;
- its tags differ, or it adds a `<` or `>`, or a `$t(`;
- it has a control, line separator or bidi character, or a line break the English doesn't have;
- it is longer than max(80, 4 × the English), or longer than 4000 characters;
- a plural doesn't give exactly the language's forms (`Intl.PluralRules`).

A key that fails is sent once more in a later batch of the same run. A second failure for the same English is final: the key stays English until its English changes.

## Cache

- `<userData>/locales/<tag>.json`, written by `TranslationCache` (`packages/shell/src/main/translation-cache.ts`): `{ version: 1, tag, entries: { "<ns>:<key>": { en, value } }, failed: { "<ns>:<key>": { en, count } } }`. `<ns>` is `core` or `harness`; `en` is a cyrb53 hash of the English the value came from.
- A key whose English changed no longer matches its hash, so it counts as missing. The Settings row then says "Some texts are new." Nothing is translated again without asking.
- Every load checks each entry again (its key is still in the English, its hash matches, `checkTranslation` passes), so a hand-edited cache can't inject markup. The file is capped at 4 MB, read without following a symlink, and written atomically.
- Only a run writes it (D0). A failed write fails the run.
- A partial cache shows partly translated. When the saved language has keys left (after a "new texts" run, for example), launch shows the cached keys translated and English for the rest (§6). An empty set, or one with only legal keys, doesn't switch the screen.

## Legal texts

- They live under `legal.`: in the core, `legal.engine.*` (the engine notice). A harness puts its own terms, consent or responsibility texts under `legal.` in its `en.json`.
- They are never sent, never cached and always shown in English. With a non-English screen, the "Legal texts are shown in English." line follows them (`LegalInEnglish` in `packages/ui/src/EngineOnboarding.tsx`), and `useLegalLang()` puts `lang="en"` on them. `lang="en"` appears only when the screen is in another language. In the engine notice the line comes after the accept text, so it covers every legal block.
- `LegalInEnglish` and `useLegalLang` are exported from `@humanharness/ui`: a harness's own legal blocks use them the same way (`lang={useLegalLang()}` on each block, `<LegalInEnglish />` after the last one).
- "Non-English screen" means i18next resolved a translated language. A cached set with nothing left after the checks (empty, or legal keys only) adds no resources and doesn't switch, so the line never shows on an all-English screen.

## Markup

- `language.notice` holds the only tag in the core strings (`<b>`). `TranslateNotice` renders it with `<Trans>`, mapping `b` to `<strong lang={tag}>`, and `transKeepBasicHtmlNodesFor` is empty for the whole app.
- Any future `<Trans>` maps every tag through `components`; no basic HTML is kept from a translation.

## Usage

Each turn appends a `phase: "translate"` line (with `language` and `batch`, numbered from 1 in each run) to the current base's `.harness/usage.jsonl` (`translateRecord` in `usage-log.ts`), failed turns too. With profiles and no active profile, nothing is logged. `summarizeUsage` leaves these lines out of task estimates and scope totals, like material; there is no separate line in Settings › Usage.

## The open task keeps its language

`TaskManager` records the language when a task begins (`languageOf`). Its mode switch, phase changes, resume, wrap-up and answer display use it. `AGENTS.md` is rewritten at the next task. A below-tier mode switch that starts a new task starts it in the new language.

## Testing

- `fake-claude`'s `pseudoTranslate` step (`packages/fake-agent/src/pseudo.ts`) reads the batch in the prompt and saves `[xx] English` for every key, keeping placeholders and tags. `breakKeys` drops a placeholder, to test validation.
- `packages/e2e/tests/language.spec.ts`: D0, a full run in several batches with `--resume`, legal texts kept English and the switch back to English, a failed run, cancel, an engine change mid-run, and mock mode.
- `packages/harness-sdk/test/language.test.ts` (the list and the right-to-left filter), `packages/i18n/test/translate.test.ts` (flattening, hashes, `checkTranslation`), `packages/runtime/test/system-session.test.ts`, `packages/blocks/test/translate-server.test.ts`.
- `packages/shell/test/translation.test.ts`, `translation-cache.test.ts`, `language-ipc.test.ts` and `language-preload.test.ts`.
- `packages/ui/test/language-picker.test.tsx`, `translate-notice.test.tsx`, `language-chooser.test.tsx`, `language-control.test.tsx`; the Language row in `settings.test.tsx`, the offer in `home.test.tsx`, the setup line in `setup-flow.test.tsx` and the legal line in `engine-tab.test.tsx`.

## Known gaps

- The task's language lives in memory: after a restart, an open task uses the saved language again.
- A profile switch during a run doesn't stop it.
- Escape while a pick is still pending can close the chooser and still switch, if the answer is "switched".
- The stopped row doesn't name the language when the run's language differs from the saved one.
- If the state can't be read, the Language row stays read-only.
- Mock mode never translates (see `mock-mode.md`).
- Codex's read-only mode may read files without asking, so the refusal covers only the reads it asks about. Material's sessions keep their read tools.
- Claude's own session record of a run lands in the engine's store, since turns must resume. The app never reads it.
