# Language on demand

Date: 2026-10-25. Status: approved design.

## Why

- The app ships two hand-kept string maps (`packages/i18n/src/locales/en.json` and `es.json`), and a harness declares `languages: ["es", "en"]` with every label written twice. Each new language is more hand work, for the core and for every harness author.
- What the model reads is mixed: the managed section of `AGENTS.md` is written in the person's language ("Respondé siempre en español."), while the task prompts are in English. Claude and Codex reason better in English; text in another language pulls their thinking into it.

The goal: the app ships in English only. The person picks any language once the app is set up; the app asks the person's own AI engine to translate its strings, after saying so. Whatever the language on screen, the AI thinks in English and writes to the person in their language.

## Decisions

- **D1. English is the only shipped language.** `es.json` goes away. Spanish becomes the first generated language, not a bundled one.
- **D2. Setup runs in English.** It says the language can be chosen once the app is set up. No language can be chosen before an engine is connected, since there is nothing to translate with.
- **D3. Choosing a language starts an agentic translation, and the app says so first.** The person confirms before anything is sent to the engine.
- **D4. The AI always thinks in English and writes to the person in their language.** Everything the model reads from the app is English.
- **D5. Legal texts are always in English.** They are never sent for translation.
- **D6. Notes (`save_note`) are written in English.** They come back into context through the notes index; the person doesn't see them in the app.
- **D7. The harness declares the tone of its translations** (one line in the manifest, in English).
- **D8. After setup, the app offers the language once;** it is always in Settings › General.
- **D9. Right-to-left languages are out of this version.** The picker doesn't offer them.

## 1. What ships

- `packages/i18n` keeps `en.json` only. `CORE_LOCALES` holds English; other languages come from the translation cache (§6).
- The SDK drops the closed language list: `LANGUAGES`, `LocalizedText` and the manifest's `languages` go away. Every manifest text (`name`, action `label` and `description`, and the rest that are `localizedText` today) becomes a plain English string. A harness's own UI strings are an English map only.
- `Language` becomes a language tag (BCP 47, such as `pt-BR`, `fr`, `ja`), checked with `Intl.getCanonicalLocales`. `"en"` is the default.
- The manifest gets an optional `tone`: one English line on how translations should sound, such as `"warm and informal, short sentences, address the person directly"`. Absent means neutral.
- The demo harness and the `humanharness init` template are rewritten to this shape: English strings, English briefs and instructions, and a `tone` line.

## 2. Language tags and names

- The picker lists languages by their own name (`Intl.DisplayNames(tag).of(tag)`, "Português (Brasil)") with the English name under it. The list is built from `Intl.supportedValuesOf` where available, else a fixed list of common tags kept in the core. No translated list is shipped.
- A right-to-left language (its `Intl.Locale` text direction is `rtl`, or it is in a fixed list: `ar`, `he`, `fa`, `ur`, `ps`, `yi`, `dv`, `ckb`, `sd`, `ug`) is not offered (D9).
- The AI gets the language by its English name (`Intl.DisplayNames("en")`, "Brazilian Portuguese"), never by its tag.

## 3. Setup and the offer

- The setup flow is in English. Its first step gets one line: "You can choose the app's language once it's set up."
- When setup ends with the engine ready, Home shows a card once: "Use {{name}} in another language?", with the system language (`app.getLocale()`) suggested when it isn't English, and "Choose language" / "Not now". "Not now" hides the card for good; the choice stays in Settings.
- Settings › General gets **Language**: the current language and "Change…", which opens the picker. English is always in the list and never needs a translation.
- Without a ready engine (not set up, a problem with the engine, or mock mode), the picker is disabled and says why: "Connect an AI engine to translate the app."

## 4. The notice before translating

When the person picks a language that has no complete translation, a dialog says, before anything runs:

> To show {{name}} in **Português (Brasil)**, your AI engine ({{engine}}) will translate the app's texts. It runs once, takes a minute or two and uses a little of your plan. Legal texts stay in English.
>
> [Translate] [Cancel]

Picking English, or a language whose translation is complete and current, switches at once with no dialog.

## 5. The translation run

- **What is sent.** The core's English strings and the harness's English strings, minus the legal keys (§8): each key with its English text. With them: the target language's English name, the harness's `tone`, and the plural forms the language needs (`Intl.PluralRules(tag).resolvedOptions().pluralCategories`, so i18next's `_one`, `_few`, `_many`… keys can be written).
- **How.** Its own engine session, outside the task flow: no notes, no entry in `tasks.json`, no checkpoint. It runs at the `light` tier of the engine in use. The working folder is an empty folder in the app's data, and the only tool it may use is `save_translation`; it reads nothing else.
- **In batches.** The strings go in batches of about 100 keys, one turn each, in the same session. Each turn asks the agent to call `save_translation` once with the batch's map. Batches make each turn small and let a cut run resume where it stopped.
- **The prompt** is in English (`TRANSLATE_PROMPT` in `task-prompts.ts`): translate for a desktop app's interface, keep every `{{placeholder}}` and tag exactly, follow the tone, write the plural forms listed, keep it short like the English.
- **While it runs,** the app stays in English with a progress row in Settings › General ("Translating… 3 of 5"). The person can keep working; a task's turns and the translation's turns run as separate engine processes. Cancel stops the run and keeps what was saved.
- **When it ends,** the app switches to the new language live. Keys that never passed validation stay in English.
- **Measuring.** Each turn goes to `.harness/usage.jsonl` with `phase: "translate"`.

## 6. Validation and cache

- `save_translation` is checked per key before it is kept:
  - the key is one that was sent;
  - the text isn't empty;
  - its `{{placeholders}}` and tags are the same set as the English;
  - a plural key comes with every form the language needs.
  
  A key that fails is sent once more in a later batch; if it fails again it stays in English.
- The cache is `<app data>/locales/<tag>.json`: for each key, the translated text and a hash of the English it came from.
- **After an update** the app compares hashes: keys that are new or whose English changed are missing. If the saved language has missing keys, the next launch shows them in English and Settings › General says "Some texts are new. Translate them?" with the same dialog as §4. It is never run without asking.
- Switching to a language with a complete cache uses it at once.

## 7. What the AI reads

- The managed section of `AGENTS.md` is always written in English, whatever the language. Its language rule becomes:
  - "Think and reason in English."
  - "Write everything the person sees in {{languageName}}: your messages, choices, the content of interface blocks, and the files you write for them."
  - "Notes you save with `save_note` are in English."
- The task prompts keep `{{language}}`, now filled with the English name. `CLOSE_PROMPT` and `CHECKPOINT_PROMPT` say the note is in English (D6).
- The harness's base instructions and briefs are written in English. The `/new-harness` guide says so and why. `humanharness check` does not try to detect the language.
- **Changing the language with an open task** leaves that task as it is: its session keeps the instructions it started with, so the engine's cached prefix stays valid. `AGENTS.md` is rewritten when the next task starts.

## 8. Legal texts

- The legal strings move under one `legal.` key prefix in `en.json`: the engine notice texts (today `engine.notice*`) and any other terms, consent or responsibility text. Keys under `legal.` are never sent for translation and always render in English.
- When the app is in another language, a legal block shows one small line under it, itself in the app's language: "Legal texts are shown in English."

## 9. When it can't translate

- No ready engine, mock mode, out of quota, a crash or a cancel: the app stays in (or keeps) its current language and Settings › General offers "Try again". A run that stopped resumes from its saved batches.
- The fake engine (`packages/fake-agent`) answers a translation run with a pseudo-translation (`[xx] English text`, placeholders kept), so the flow can be tested end to end without an AI.

## 10. Migration

- A saved `config.json` with `language: "es"` keeps it. On the next launch there is no cache for it, so the app opens in English and shows the §4 dialog for Español once.
- Existing notes written in Spanish stay as they are; new ones are English.

## Out of scope

- Right-to-left languages (D9): layout direction and a review of every screen.
- Bundled human-reviewed translations.
- Translating the person's own files, reference folders or anything outside the app's strings.

## Packages touched

- `harness-sdk`: language tag, plain-string manifest texts, `tone`.
- `i18n`: English only, cache-backed resources.
- `workspace`: English-only managed section with the new language rule.
- `shell` (main): translation run, cache, `save_translation` validation, migration, offer state.
- `blocks`: the `save_translation` tool.
- `ui`: language picker, offer card, notice dialog, progress row, legal line.
- `fake-agent`: pseudo-translation.
- `cli`: template, `/new-harness` guide.
- `harnesses/demo`: rewritten in English.
