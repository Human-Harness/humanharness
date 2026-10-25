# Plan 5a — English core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The core and the demo ship in English only, the saved language is any BCP 47 tag, and everything the AI reads is English with a rule to think in English and write to the person in their language.

**Architecture:** Spec `docs/superpowers/specs/2026-10-25-language-on-demand-design.md`, decisions D1, D4, D6, D7 and sections 1, 2 (names only), 7 and 10. `Language` becomes a plain tag string with two helpers in `harness-sdk` (`canonicalLanguage`, `languageName`); every manifest text becomes one English string; `es.json` files are deleted. The screen stays in English until plan 5b adds the translation run, the picker and the cache; the AI already answers in the saved language. Plan 5b (translation on demand: spec §3–6, 8, 9) is written once this plan lands.

**Tech Stack:** TypeScript, zod, i18next/react-i18next, React, Electron, vitest, Playwright. `Intl.getCanonicalLocales` and `Intl.DisplayNames` (Node 22 ships full ICU).

**Gate:** `corepack pnpm typecheck && corepack pnpm test` from the repo root after every task; `corepack pnpm e2e` at task 11 and at the end.

---

## File map

| File | Change |
|---|---|
| `packages/harness-sdk/src/index.ts` | `Language = string`, `DEFAULT_LANGUAGE`, `canonicalLanguage`, `languageName`; drop `LANGUAGES`, `LocalizedText`, `languages`; plain-string texts; `tone` |
| `packages/harness-sdk/src/core-blocks.ts` | `save_note` description: the note is written in English |
| `packages/i18n/src/index.ts`, `src/locales/es.json` | English only; `es.json` deleted |
| `packages/engines/src/index.ts` | `requires`, `dataLocation`, `trainsOnData` become English strings |
| `packages/workspace/src/instructions.ts` | One English managed section with the language rule |
| `packages/shell/src/main/task-prompts.ts` | `{{language}}` = English name of the tag; notes in English |
| `packages/shell/src/main/{validate,references,task-manager,test-hooks,index}.ts` | Tag validation, plain labels, English mock texts |
| `packages/cli/src/{run,check}.ts` | `--language <tag>`; i18n check reads `en.json` only |
| `packages/ui/src/language.ts` (new) | `systemLanguage()` |
| `packages/ui/src/*.tsx`, `client.ts` | Plain strings, no `uiLanguage`, read-only Language row |
| `harnesses/demo/**`, `packages/cli/template/**`, `packages/fake-agent/fixtures/notes-harness/harness.config.ts` | English manifests with `tone`; `es.json` deleted |
| `packages/cli/guide/new-harness.md` | English briefs and instructions, `tone` |
| `packages/e2e/tests/**` | English app |
| `docs/architecture/manifest.md`, `docs/superpowers/plans/2026-10-10-00-roadmap.md` | Docs |

---

### Task 1: harness-sdk — language tags and plain-string manifest

**Files:**
- Modify: `packages/harness-sdk/src/index.ts`
- Modify: `packages/harness-sdk/src/core-blocks.ts`
- Test: `packages/harness-sdk/test/harness.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/harness-sdk/test/harness.test.ts` (keep its imports; add `canonicalLanguage`, `languageName`, `DEFAULT_LANGUAGE` to the import from `../src`):

```ts
describe("language tags", () => {
  it("canonicalizes a valid tag and rejects an invalid one", () => {
    expect(canonicalLanguage("pt-br")).toBe("pt-BR");
    expect(canonicalLanguage("es")).toBe("es");
    expect(canonicalLanguage("not a tag")).toBeNull();
    expect(canonicalLanguage("")).toBeNull();
  });

  it("names a language in English by default, or in another language", () => {
    expect(languageName("es")).toBe("Spanish");
    expect(languageName("pt-BR")).toBe("Brazilian Portuguese");
    expect(languageName("es", "es")).toBe("español");
    expect(languageName("not a tag")).toBe("not a tag");
  });

  it("defaults to English", () => {
    expect(DEFAULT_LANGUAGE).toBe("en");
  });
});

describe("manifest texts", () => {
  it("are plain English strings, with an optional tone", () => {
    const h = defineHarness({ ...minimal, name: "Notes", tagline: "Take notes", tone: "warm and informal" });
    expect(h.name).toBe("Notes");
    expect(h.tone).toBe("warm and informal");
  });

  it("refuses a localized object", () => {
    expect(() => defineHarness({ ...minimal, name: { es: "Notas", en: "Notes" } as never })).toThrow();
  });
});
```

If the file has no `minimal` manifest object yet, add one above these blocks with every required field as plain strings (`id: "notes"`, `name: "Notes"`, `core: "^0.1.0"`, `engines: ["claude"]`, `folder: { suggested: "Documents/Notes" }`, `instructions: "./AGENTS.md"`, `permissions: { edit: "none", exec: false, web: false }`, `blocks: {}`, `author: "Me"`). Then update every existing test in the file that builds a manifest: `name: { es, en }` → `name: "<en value>"`, the same for `label`, `description`, `tagline` and reference `label`, and delete every `languages: [...]` line.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/harness-sdk`
Expected: FAIL — `canonicalLanguage is not a function` / type errors on `name`.

- [ ] **Step 3: Implement**

In `packages/harness-sdk/src/index.ts`, replace lines 15–19 (`LANGUAGES` … `const localizedText`) with:

```ts
/** A BCP 47 language tag ("en", "pt-BR"). The app ships in English; other languages are generated on demand (spec 5 §1). */
export type Language = string;
export const DEFAULT_LANGUAGE: Language = "en";

/** The canonical form of `tag` ("pt-br" → "pt-BR"), or null when it isn't a language tag. */
export function canonicalLanguage(tag: string): Language | null {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}

/** `tag`'s name in the language `display` ("pt-BR" → "Brazilian Portuguese"); the tag itself when there is no name. */
export function languageName(tag: Language, display: Language = DEFAULT_LANGUAGE): string {
  try {
    return new Intl.DisplayNames([display], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Every text in a manifest is one English string; the app translates the screens (spec 5 D1). */
const text = z.string().min(1);
```

Then in the same file:
- `actionSchema`: `label: text,` and `description: text.optional(),`.
- `referenceSchema`: `label: text,`.
- `manifestSchema`: `name: text,`; delete the `languages:` line; `tagline: text.optional(),`; after `tagline` add:

```ts
  /** How translations of this harness's screens should sound, in English ("warm and informal, short sentences"). */
  tone: z.string().min(1).max(300).optional(),
```

In `packages/harness-sdk/src/core-blocks.ts`, in the `save_note` description, replace `"Saves what this topic made clear, only when the app asks you to close the topic. The app writes the note into the folder: never write it yourself.` with `"Saves what this topic made clear, only when the app asks you to close the topic. Write the note in English. The app writes it into the folder: never write it yourself.` (the rest of the string stays).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/harness-sdk`
Expected: PASS. (`corepack pnpm typecheck` fails in other packages until tasks 2–10; that is expected inside this plan.)

- [ ] **Step 5: Commit**

```bash
git add packages/harness-sdk
git commit -m "feat(sdk): a language is any tag and every manifest text is one English string"
```

---

### Task 2: i18n — English only

**Files:**
- Modify: `packages/i18n/src/index.ts`
- Delete: `packages/i18n/src/locales/es.json`
- Modify: `packages/i18n/src/locales/en.json`
- Test: `packages/i18n/test/i18n.test.ts`

- [ ] **Step 1: Rewrite the tests**

Replace `packages/i18n/test/i18n.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { CORE_LOCALES, createI18n } from "../src";

describe("core locales", () => {
  it("ship English only (spec 5 D1)", () => {
    expect(Object.keys(CORE_LOCALES)).toEqual(["en"]);
  });

  it("never state token savings as numbers (spec §5.3)", () => {
    expect(JSON.stringify(CORE_LOCALES.en.notes)).not.toMatch(/token|\d\s?k\b/i);
  });
});

describe("createI18n", () => {
  it("translates core keys with interpolation and plurals", async () => {
    const en = await createI18n("en");
    expect(en.t("home.start", { name: "Demo" })).toBe("Start Demo");
    expect(en.t("models.changed", { tier: "Standard" })).toBe("Changed · recommended: Standard");
    expect(en.t("notes.keyPoints", { count: 1 })).toBe("1 key point");
    expect(en.t("notes.keyPoints", { count: 2 })).toBe("2 key points");
    expect(en.t("settings.languageHint")).toBe("The app's texts are in English for now. The AI answers in this language.");
  });

  it("shows English for a language with no strings, and keeps the tag for formatting", async () => {
    const i18n = await createI18n("pt-BR");
    expect(i18n.language).toBe("pt-BR");
    expect(i18n.resolvedLanguage).toBe("en");
    expect(i18n.t("chat.send")).toBe("Send");
  });

  it("adds the harness's own English strings under the harness namespace", async () => {
    const i18n = await createI18n("es", { en: { title: "Notes" } });
    expect(i18n.t("harness:title")).toBe("Notes");
  });
});
```

Check the `home.start` and `notes.keyPoints_one` values in `en.json` before running; if the English differs, use the file's text in the expectation, not a new string.

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/i18n`
Expected: FAIL — `CORE_LOCALES` has `es`; `settings.languageHint` missing.

- [ ] **Step 3: Implement**

Replace `packages/i18n/src/index.ts` with:

```ts
import i18next, { type i18n } from "i18next";
import type { Language } from "@humanharness/harness-sdk";
import en from "./locales/en.json";

/** A harness's own strings by language. A harness ships `en` only; other languages come from the app (spec 5 D1). */
export type Locales = Partial<Record<Language, Record<string, unknown>>>;

export const CORE_LOCALES: Record<"en", Record<string, unknown>> = { en };

/**
 * Core strings in the default namespace; the harness's own strings under `harness:`. A language with no
 * strings shows English (`resolvedLanguage` is "en") while `language` keeps the tag for dates and numbers.
 */
export async function createI18n(language: Language, harnessLocales: Locales = {}): Promise<i18n> {
  const instance = i18next.createInstance();
  await instance.init({
    lng: language,
    fallbackLng: "en",
    defaultNS: "core",
    ns: ["core", "harness"],
    interpolation: { escapeValue: false },
    resources: { en: { core: CORE_LOCALES.en, harness: harnessLocales.en ?? {} } },
  });
  return instance;
}
```

Delete `packages/i18n/src/locales/es.json`:

```bash
git rm packages/i18n/src/locales/es.json
```

In `packages/i18n/src/locales/en.json`, inside `"settings"`, right after the `"language"` entry, add:

```json
    "languageHint": "The app's texts are in English for now. The AI answers in this language.",
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/i18n`
Expected: PASS. If `resolvedLanguage` comes back `undefined`, i18next didn't resolve it for a language with no bundle: change that expectation to `expect(i18n.resolvedLanguage ?? "en").toBe("en")` and use the same `?? "en"` in task 8, step 4.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n
git commit -m "feat(i18n): the core ships English only"
```

---

### Task 3: engines — English legal facts

**Files:**
- Modify: `packages/engines/src/index.ts`
- Test: any test under `packages/engines/test` that reads these fields

- [ ] **Step 1: Change the type and data**

In `packages/engines/src/index.ts`: drop the `LocalizedText` import; in `EngineDef` make the three fields `requires: string;`, `dataLocation: string;`, `trainsOnData: string;` with this comment above `requires`:

```ts
  /** Legal facts shown in the engine's notice: always English (spec 5 D5). */
```

For every engine entry, keep only the `en` value: `requires: { es: "…", en: "Claude Pro or Max plan" }` → `requires: "Claude Pro or Max plan"`, and the same for `dataLocation` and `trainsOnData` (multi-line `trainsOnData` objects included).

- [ ] **Step 2: Update tests and run**

Run: `grep -rn "requires\|dataLocation\|trainsOnData" packages/engines/test` and change any `.en` / `.es` access or object expectation to the plain string.
Run: `corepack pnpm vitest run packages/engines`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/engines
git commit -m "feat(engines): an engine's legal facts are English strings"
```

---

### Task 4: workspace — one English managed section that says to think in English

**Files:**
- Modify: `packages/workspace/src/instructions.ts`
- Test: `packages/workspace/test/instructions.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/workspace/test/instructions.test.ts`, replace the `describe("managedSection", …)` block's first test with:

```ts
  it("is delimited, always English, and says to think in English and write in the person's language", () => {
    const es = managedSection({ language: "es", blocks });
    expect(es.startsWith(MANAGED_START)).toBe(true);
    expect(es.trimEnd().endsWith(MANAGED_END)).toBe(true);
    expect(es).toContain("## Environment (generated by Human Harness; do not edit)");
    expect(es).toContain("- Think and reason in English.");
    expect(es).toContain("- Write everything the person sees in Spanish: your messages, choices, the content of interface blocks, and the files you write for them.");
    expect(es).toContain("- Notes you save with `save_note` are in English.");
    expect(managedSection({ language: "pt-BR", blocks })).toContain("in Brazilian Portuguese:");
  });
```

In the other tests of that block, delete every assertion on Spanish text (`Respondé…`, `escribí primero…`, `Llamá estas herramientas…`, `Carpetas de referencia…`, `Podés leer…`) and keep the English ones; in the reference-folders test change the `es` call to `language: "es"` with `label: "Human Harness source"` and expect `"### Reference folders (read only)"`, `"You may read these folders with your read tools. Never change anything in them."` and `"- Human Harness source: \`/Users/me/code/hh\`"`.

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/workspace/test/instructions.test.ts`
Expected: FAIL — Spanish section, no "Think and reason in English."

- [ ] **Step 3: Implement**

In `packages/workspace/src/instructions.ts`, change the import to `import { type Block, type Language, blockToolName, languageName } from "@humanharness/harness-sdk";` and replace the whole `TEXT` constant (lines 10–48) with:

```ts
/** The managed section is English whatever the person's language: the model reasons best in it (spec 5 D4). */
const TEXT = {
  title: "## Environment (generated by Human Harness; do not edit)",
  rules: (language: Language) => [
    "Think and reason in English.",
    `Write everything the person sees in ${languageName(language)}: your messages, choices, the content of interface blocks, and the files you write for them.`,
    "Notes you save with `save_note` are in English.",
    "You are running inside a desktop app: the person talks to you from an interface, not a terminal. Don't show commands or file paths unless asked.",
    "Don't use your CLI's own interactive questions: ask in plain text or with the interface tools below.",
    "Work only inside this folder. Keep messages short and clear.",
  ],
  tools: "### Interface tools",
  toolsIntro:
    "Call these tools to show things to the person or update their state. What they show appears in the conversation in the order you call them, among your text: write the sentence that introduces each thing first, then call the tool.",
  example: "Example",
  schema: "Schema",
  references: "### Reference folders (read only)",
  referencesIntro: "You may read these folders with your read tools. Never change anything in them.",
};
```

In `managedSection`, replace `const t = TEXT[opts.language];` with `const t = TEXT;` and `...t.rules.map((r) => \`- ${r}\`)` with `...t.rules(opts.language).map((r) => \`- ${r}\`)`.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/workspace`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace
git commit -m "feat(workspace): the AI's instructions are English and tell it to think in English"
```

---

### Task 5: task prompts — the language by its English name, notes in English

**Files:**
- Modify: `packages/shell/src/main/task-prompts.ts`
- Test: `packages/shell/test/task-prompts.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/shell/test/task-prompts.test.ts`:
- Replace the test `"falls back to English for a language it does not know"` with:

```ts
  it("names any language tag in English", () => {
    expect(fillPrompt("Answer in {{language}}.", { language: "pt-BR", notesIndex: "" })).toBe("Answer in Brazilian Portuguese.");
    expect(fillPrompt("Answer in {{language}}.", { language: "fr", notesIndex: "" })).toBe("Answer in French.");
  });
```

- Add inside `describe("fillPrompt", …)`:

```ts
  it("asks for the closing note in English", () => {
    expect(CLOSE_PROMPT).toContain("Write the note in English.");
  });
```

- Add inside `describe("CHECKPOINT_PROMPT", …)`:

```ts
  it("asks for the note in English", () => {
    expect(CHECKPOINT_PROMPT).toContain("Write the note in English.");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/task-prompts.test.ts`
Expected: FAIL — "French" comes out "English"; prompts lack the sentence.

- [ ] **Step 3: Implement**

In `packages/shell/src/main/task-prompts.ts`:
- Replace lines 1–3 with `import { type Language, languageName } from "@humanharness/harness-sdk";`.
- In `CLOSE_PROMPT`, after `"…and the questions left open.` insert ` Write the note in English.` so it reads `…the files that back them and the questions left open. Write the note in English. Do not write any file yourself…`.
- In `CHECKPOINT_PROMPT`, after `…and the questions still open.` insert ` Write the note in English.` the same way.
- In `fillPrompt`, replace the `language:` line of `values` with `language: languageName(vars.language),` and update the doc comment's last sentence to: `The language is named in English ("pt-BR" → "Brazilian Portuguese").`

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/task-prompts.test.ts`
Expected: PASS. Also run `corepack pnpm vitest run packages/fake-agent` — `promptKind` matches prompts by their opening words, which did not change.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/main/task-prompts.ts packages/shell/test/task-prompts.test.ts
git commit -m "feat(shell): prompts name the language in English and ask for notes in English"
```

---

### Task 6: shell main — tag validation, plain labels, English mock texts

**Files:**
- Modify: `packages/shell/src/main/validate.ts`, `references.ts`, `task-manager.ts`, `test-hooks.ts`, `index.ts`
- Test: `packages/shell/test/validate.test.ts`, `config.test.ts`, `references.test.ts`, `test-hooks.test.ts`, `move-folder.test.ts`, `shared-config.test.ts`

- [ ] **Step 1: Write the failing validation test**

In `packages/shell/test/validate.test.ts`, remove `languages` from every validation context object and add:

```ts
  it("accepts any canonical language tag and refuses anything else", async () => {
    expect(await configProblem({ language: "pt-BR" }, ctx)).toBeNull();
    expect(await configProblem({ language: "es" }, ctx)).toBeNull();
    expect(await configProblem({ language: "pt-br" }, ctx)).toBe("language-unavailable");
    expect(await configProblem({ language: "not a tag" }, ctx)).toBe("language-unavailable");
  });
```

(`ctx` is the context object the file already uses; if it's named differently, use that name.)

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/validate.test.ts`
Expected: FAIL — `pt-BR` is "language-unavailable".

- [ ] **Step 3: Implement validate.ts**

In `packages/shell/src/main/validate.ts`: delete `languages: string[];` from `ValidationContext`; add `import { canonicalLanguage } from "@humanharness/harness-sdk";` and replace the language check with:

```ts
  // Any language: saved in canonical form so the translation cache (plan 5b) has one name per language.
  if (c.language !== undefined && (typeof c.language !== "string" || canonicalLanguage(c.language) !== c.language)) {
    return "language-unavailable";
  }
```

- [ ] **Step 4: Implement the rest of shell main**

- `references.ts`: drop `LocalizedText` from the import; `label: string;` in `ResolvedReference`.
- `task-manager.ts` line 3: drop `type LocalizedText`; line 25: `actions: Record<string, { label: string }>;`; line 265: `display ?? this.d.actions[action].label`.
- `test-hooks.ts`: delete `mockLanguage` (lines 104–111) and replace `mockEngineText` and `mockModels` with:

```ts
/** How a faked engine presents itself in mock mode (spec 3f §4): no provider to disclose, nothing leaves the computer. */
export function mockEngineText(): { name: string; provider: string; requires: string; dataLocation: string; trainsOnData: string } {
  return { name: "Simulated AI (mock)", provider: "Human Harness", requires: "Nothing", dataLocation: "Your data stays on this computer", trainsOnData: "No" };
}

/** The one model a faked engine offers in mock mode; every tier uses it (the fake ignores --model). */
export const MOCK_MODEL = "mock";

export function mockModels(): ModelChoice[] {
  return [{ id: MOCK_MODEL, name: "Test model" }];
}
```

Drop `Language` and `LocalizedText` from its import if unused.
- `index.ts`:
  - import: replace `type Language,` with `DEFAULT_LANGUAGE,` (keep the rest); drop `mockLanguage,` from the test-hooks import.
  - delete line 126 (`const mockLang = …`).
  - line 134 and line 220: delete `languages: harness.languages,`.
  - `modelsView(language: Language | undefined)` → `modelsView()`; inside, `mockModels(mockLang(language))` → `mockModels()`; update its callers (`modelsView(saved.language)` → `modelsView()`).
  - line 236: `...mockEngineText(mockLang(saved.language)),` → `...mockEngineText(),`.
  - line 326: `label: r.label[c.language]` → `label: r.label`.
  - line 430: `?? harness.languages[0]` → `?? DEFAULT_LANGUAGE`.

- [ ] **Step 5: Update the other shell tests and run**

- `test-hooks.test.ts`: delete the `mockLanguage` tests; call `mockEngineText()` and `mockModels()` with no argument and expect the English values above.
- `config.test.ts`, `move-folder.test.ts`, `shared-config.test.ts`, `references.test.ts`: remove `languages:` from contexts and manifests; `label: { es, en }` → the English string.

Run: `corepack pnpm vitest run packages/shell`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shell
git commit -m "feat(shell): any language tag is valid; mock texts and labels are English"
```

---

### Task 7: cli — `--language <tag>` and an English-only i18n check

**Files:**
- Modify: `packages/cli/src/run.ts`, `packages/cli/src/check.ts`
- Test: `packages/cli/test/check.test.ts`, the run tests under `packages/cli/test`

- [ ] **Step 1: Write the failing check tests**

In `packages/cli/test/check.test.ts`, replace the three `i18n` tests that mention `es.json` with:

```ts
  it("i18n: a missing en.json, and a UI key with no string", async () => {
    const gone = await checkHarness(await fixture((d) => fs.rmSync(path.join(d, "locales", "en.json"))));
    expect(gone.findings.filter((f) => f.rule === "i18n").map((f) => f.message)).toEqual(["locales/en.json is missing: the harness's strings are English."]);
  });

  it("i18n: another language's file is ignored with a warning", async () => {
    const r = await checkHarness(await fixture((d) => fs.writeFileSync(path.join(d, "locales", "es.json"), "{}\n")));
    const f = r.findings.filter((x) => x.rule === "i18n");
    expect(f.map((x) => [x.severity, x.message])).toEqual([["warning", "locales/es.json is not read: the app translates from en.json."]]);
  });

  it("i18n: en.json that is JSON but not an object", async () => {
    const r = await checkHarness(await fixture((d) => fs.writeFileSync(path.join(d, "locales", "en.json"), "null\n")));
    expect(r.findings.filter((f) => f.rule === "i18n").map((f) => f.message)).toEqual(["locales/en.json must be a JSON object."]);
  });
```

In the UI-key test (`"scans the manifest's ui folder…"`), drop the expected lines that end in `missing in es.`. Make the test fixture's manifest English-only (plain strings, no `languages`, no `locales/es.json`).

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run packages/cli/test/check.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement check.ts**

In `i18nFindings` (`packages/cli/src/check.ts`), replace the `for (const lang of h.languages) { … }` loop and the "missing in another language" loop with:

```ts
  const keys = new Map<string, Set<string>>();
  const file = path.join(localesDir, "en.json");
  const text = await read(path.join(localesPath, "en.json"));
  if (text === null) {
    out.push(error("i18n", `${file} is missing: the harness's strings are English.`, file));
  } else {
    let parsed: unknown = null;
    let valid = true;
    try {
      parsed = JSON.parse(text);
    } catch {
      valid = false;
      out.push(error("i18n", `${file} is not valid JSON.`, file));
    }
    if (valid && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) out.push(error("i18n", `${file} must be a JSON object.`, file));
    else if (valid) keys.set("en", new Set(flatKeys(parsed as Record<string, unknown>)));
  }
  // Only en.json is read: the app generates every other language (spec 5 D1).
  const others = (await fs.readdir(localesPath).catch(() => [])).filter((f) => f.endsWith(".json") && f !== "en.json").sort();
  for (const other of others) {
    const rel = path.join(localesDir, other);
    out.push(warning("i18n", `${rel} is not read: the app translates from en.json.`, rel));
  }
```

Keep the UI-file scan after it unchanged (it loops over `keys`, which now holds only `en`).

- [ ] **Step 4: Implement run.ts**

In `packages/cli/src/run.ts`:
- import: replace `LANGUAGES, type Language,` with `DEFAULT_LANGUAGE, type Language, canonicalLanguage,`.
- lines 113–114 → `const language: Language = o.language ?? DEFAULT_LANGUAGE;`
- line 177: `label: r.label[language]` → `label: r.label`.
- line 346 → 

```ts
  const language = values.language === undefined ? undefined : canonicalLanguage(values.language);
  if (language === null) throw new UsageError(`Unknown language "${values.language}": use a language tag such as en, es or pt-BR.`);
```

- line 353 → `...(language ? { language } : {}),`.
- In `RUN_USAGE`, if it lists `--language es|en`, change it to `--language <tag>`.

Update run tests that pass `language: "es"` expecting a refusal of other values: expect the new message for `"not a tag"`, and accept `"pt-BR"`.

- [ ] **Step 5: Run and commit**

Run: `corepack pnpm vitest run packages/cli`
Expected: FAIL only in `init.test.ts` / `template.test.ts` (fixed in task 10). Everything else PASS.

```bash
git add packages/cli/src packages/cli/test/check.test.ts packages/cli/test/run.test.ts
git commit -m "feat(cli): run takes any language tag; check reads en.json only"
```

---

### Task 8: ui — plain strings, saved language, read-only Language row

**Files:**
- Create: `packages/ui/src/language.ts`
- Modify: `packages/ui/src/client.ts`, `HarnessApp.tsx`, `FolderStep.tsx`, `SettingsSheet.tsx`, `StartView.tsx`, `EngineOnboarding.tsx`, `ModelsTab.tsx`, `ChatView.tsx`, `HistoryPanel.tsx`, `NotesPanel.tsx`, `Home.tsx`, `SetupFlow.tsx`, `UsageTab.tsx`, `FlowSide.tsx`, `EngineTab.tsx`
- Test: `packages/ui/test/**`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/language.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { systemLanguage } from "../src/language";

afterEach(() => vi.unstubAllGlobals());

describe("systemLanguage", () => {
  it("is the system's language tag in canonical form", () => {
    vi.stubGlobal("navigator", { language: "pt-br" });
    expect(systemLanguage()).toBe("pt-BR");
  });

  it("falls back to English when the system gives no usable tag", () => {
    vi.stubGlobal("navigator", { language: "" });
    expect(systemLanguage()).toBe("en");
  });
});
```

In `packages/ui/test/settings.test.tsx` add (use the file's existing helpers to render the General tab with a `FakeClient`; the pattern below matches its other General-tab tests):

```tsx
  it("shows the saved language by its own name, with the English-for-now hint", async () => {
    await renderGeneral(new FakeClient({ ...ready, language: "es" }));
    expect(screen.getByText("Español")).toBeInTheDocument();
    expect(screen.getByText("The app's texts are in English for now. The AI answers in this language.")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "English" })).toBeNull();
  });
```

If the file has no `renderGeneral`, render the way its nearest General-tab test does.

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm vitest run packages/ui/test/language.test.ts packages/ui/test/settings.test.tsx`
Expected: FAIL — module not found; Segmented still shown.

- [ ] **Step 3: Create language.ts and update client types**

`packages/ui/src/language.ts`:

```ts
import { DEFAULT_LANGUAGE, type Language, canonicalLanguage } from "@humanharness/harness-sdk";

/** The system's language as a canonical tag; English when it gives none. Saved as the person's language at setup. */
export function systemLanguage(): Language {
  return canonicalLanguage(navigator.language || "") ?? DEFAULT_LANGUAGE;
}

/** `tag`'s name in itself, first letter up ("es" → "Español"). */
export function ownName(tag: Language): string {
  const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
  return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
}
```

In `packages/ui/src/client.ts`: drop `LocalizedText` from the import; every `LocalizedText` field (lines 44–46, 63, 65, 74, 105, 107) becomes `string` (keeping `?` where present); delete `languages: Language[];` (line 106).

- [ ] **Step 4: HarnessApp and FolderStep**

`HarnessApp.tsx`, in the load effect, replace:

```ts
    const systemLanguage = navigator.language.startsWith("es") ? "es" : "en";
```
with nothing, and the body with:

```ts
      try {
        const s = await client.getState();
        const instance = await createI18n(s.config.language ?? systemLanguage(), localesRef.current);
        if (cancelled) return;
        setI18n(instance);
        setState(s);
      } catch {
        const instance = await createI18n(systemLanguage(), localesRef.current);
        if (cancelled) return;
        setI18n(instance);
        setFailed(true);
      }
```

Import `systemLanguage` from `./language`. In the `<html lang>` effect, replace `apply(i18n.language); i18n.on("languageChanged", apply);` with:

```ts
    // The language the text is shown in: English until plan 5b translates the app.
    const apply = () => {
      document.documentElement.lang = i18n.resolvedLanguage ?? "en";
    };
    apply();
    i18n.on("languageChanged", apply);
```

(and drop the old `apply` definition taking `language`). Update the `HarnessApp.test.tsx` test `"follows the UI language in <html lang>"` to expect `"en"` for a saved `"es"`.

`FolderStep.tsx`: delete `uiLanguage` (lines 6–10) and its `Language` import; replace `const lang = uiLanguage(state, i18n.language);` with `const lang = state.config.language ?? systemLanguage();` (import from `./language`); `useTranslation()` keeps only `t` if `i18n` is now unused.

- [ ] **Step 5: SettingsSheet Language row**

In `SettingsSheet.tsx`: delete `LANGUAGE_NAMES`, `changeLanguage`, the `Language` import and the `uiLanguage` import. Replace `const lang = uiLanguage(state, i18n.language);` with `const lang = state.config.language ?? systemLanguage();`. Replace the Language row (the `<div className="hh-row">` holding the language `Segmented`) with:

```tsx
        <div className="hh-row hh-row-wrap">
          <span className="hh-row-label">{t("settings.language")}</span>
          <span>{ownName(lang)}</span>
          <p className="hh-caption hh-row-note">{t("settings.languageHint")}</p>
        </div>
```

(`hh-caption hh-row-note` is the class the text-size row already uses for its hint.) Lines 299 and 318: `state.harness.name[lang]` / `state.harness.name[uiLanguage(state, i18n.language)]` → `state.harness.name`.

- [ ] **Step 6: Plain strings everywhere else**

Make each change, then delete any `lang` variable, `uiLanguage` import, `Language` import or `lang` prop that becomes unused (and the prop in its callers):

| File | Change |
|---|---|
| `StartView.tsx` 67, 79 | `action.label[lang]` → `action.label`; `action.description[lang]` → `action.description`; drop the `lang` prop (line 28) |
| `EngineOnboarding.tsx` 28, 260–262 | delete `const lang…`; `engine.dataLocation[lang]` → `engine.dataLocation`, same for `trainsOnData`, `requires` |
| `ModelsTab.tsx` 54, 57, 103 | `taskRows(state, questions)`; `.label[lang]` → `.label`; `.description?.[lang]` → `.description` |
| `ChatView.tsx` 126, 137, 387 | `?.label[lang]` → `?.label`; `state.harness.name[lang]` → `state.harness.name` |
| `HistoryPanel.tsx` 58, 171 | `actions[g.actionId].label[lang]` → `.label`; drop `lang` prop |
| `NotesPanel.tsx` 19 | drop `lang` prop if only used for labels |
| `Home.tsx` 44–45, 67 | `const name = state.harness.name;`; `state.harness.tagline` |
| `SetupFlow.tsx` 27 | `const name = state.harness.name;` |
| `UsageTab.tsx` 102 | drop `lang`; plain labels |
| `FlowSide.tsx` 39, 79, 110 | `.label[lang]` → `.label`; `r.label[lang]` → `r.label`; drop `lang` prop |
| `EngineTab.tsx` 34, 192, 196 | `engine.requires`, `engine.dataLocation` |

Run `grep -rn "uiLanguage\|\[lang\]\|LocalizedText\|harness.languages" packages/ui/src` — expected: no output.

- [ ] **Step 7: Move the UI tests to English**

- `packages/ui/test/fake-client.ts`: delete `languages: ["es", "en"],`; turn every `{ es, en }` text into its English string.
- `packages/ui/test/render.tsx`: `renderIn(language: string, ui)`.
- Every `renderIn("es", …)` (choices, backup-notice, engine-tab, flow-parts, notes-panel, settings, usage-tab, working, setup-flow) becomes `renderIn("en", …)`. For each Spanish string the test expects, find its key in the old file, still on `master` (`git show master:packages/i18n/src/locales/es.json | grep -n "<string>"`), and use the `en.json` value at the same key. A test that only checked a Spanish plural or wording (`"una vez"`, `"1 vez más"`) becomes the English case of the same key; if `renderIn("en")` already covers it in the same file, delete the Spanish duplicate.
- `HarnessApp.test.tsx`: configs with `language: "es"` keep it (it's a valid saved language now); expected texts become English.

Run: `corepack pnpm vitest run packages/ui`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): screens are English, the saved language is shown in Settings for the AI's answers"
```

---

### Task 9: demo harness and the notes fixture — English manifests with a tone

**Files:**
- Modify: `harnesses/demo/harness.config.ts`, `harnesses/demo/ui/App.tsx`, `harnesses/demo/test/*.ts(x)`
- Delete: `harnesses/demo/locales/es.json`
- Modify: `packages/fake-agent/fixtures/notes-harness/harness.config.ts`

- [ ] **Step 1: Write the failing manifest test**

In `harnesses/demo/test/manifest.test.ts` add:

```ts
  it("is English with a tone for its translations", async () => {
    expect(harness.name).toBe("Demo");
    expect(harness.actions.turn.label).toBe("A turn end to end");
    expect(harness.tone).toBe("clear and friendly, for developers; short sentences");
  });
```

(`harness` is the loaded manifest the file already uses; adapt to its name.) Replace any `.label.es` / `.label.en` access in the file with `.label`, and remove `languages` expectations.

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run harnesses/demo`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `harnesses/demo/harness.config.ts` replace `topic` and the plain-text fields:

```ts
const topic = (id: string, label: string, description: string, tier: Tier = "standard") => ({
  label,
  description,
  prompt: `./agent/tasks/${id}.md`,
  cost: "medium" as const,
  tier,
});
```

```ts
  name: "Demo",
```
delete `languages: ["es", "en"],`;
```ts
    references: [{ id: "source", label: "Human Harness source", default: "app-source" }],
```
```ts
  actions: {
    manifest: topic("manifest", "The manifest", "What a harness declares in harness.config.ts and what the core does with it."),
    engines: topic("engines", "Engines", "How Claude or Codex is detected, installed and connected without API keys."),
    turn: topic("turn", "A turn end to end", "From typing to the answer on screen.", "deep"),
    blocks: topic("blocks", "Blocks", "How the AI shows cards and options instead of loose text."),
    context: topic("context", "Context and memory", "What goes to the engine each turn and what is kept.", "deep"),
    history: topic("history", "Folder and history", "How every change is recorded and how to go back."),
  },
```
```ts
  tagline: "How Human Harness works",
  tone: "clear and friendly, for developers; short sentences",
```

`harnesses/demo/ui/App.tsx`: delete the `es` import; `const locales = { en };`.

```bash
git rm harnesses/demo/locales/es.json
```

`harnesses/demo/test/blocks.test.tsx`: render with `en` only and English expectations (same procedure as task 8 step 7).

The demo's briefs (`agent/tasks/*.md`) and `agent/AGENTS.md` are already English; leave them. Check `harnesses/demo/mock/*.json`: they are recordings of the AI's output and may stay in any language, but `mock.spec.ts` (task 11) reads them, so leave them unchanged.

`packages/fake-agent/fixtures/notes-harness/harness.config.ts`: plain English strings, no `languages`.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run harnesses/demo packages/fake-agent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add harnesses/demo packages/fake-agent
git commit -m "feat(demo): the demo is English and declares the tone of its translations"
```

---

### Task 10: template, init and the /new-harness guide

**Files:**
- Modify: `packages/cli/template/harness.config.ts`, `packages/cli/template/ui/App.tsx`, `packages/cli/src/init.ts` (if it writes `name: { es, en }`), `packages/cli/guide/new-harness.md`
- Delete: `packages/cli/template/locales/es.json`
- Test: `packages/cli/test/init.test.ts`, `packages/cli/test/template.test.ts`

- [ ] **Step 1: Update the tests**

- `init.test.ts` line 43: `expect(h.name).toBe("my-harness");`.
- `template.test.ts`: remove `"locales/es.json",` from the file list (line 15); delete the `es` parsing at line 36 and any parity check between `es` and `en`.

Run: `corepack pnpm vitest run packages/cli/test/init.test.ts packages/cli/test/template.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement the template**

In `packages/cli/template/harness.config.ts`:

```ts
  // The app's name, in English. Never a provider or model brand.
  name: "example-harness",
```
delete the `// Languages…` comment and the `languages:` line; after `name` add:

```ts
  // How the app's screens should sound when it translates them for the person, in English. Optional.
  tone: "warm and plain, short sentences",
```

Change the instructions comment to `// This harness's instructions to the AI, in English. The core appends its own section (language rule, tools, folders).` and the action to:

```ts
    example: {
      label: "Example",
      description: "Shows how a task works.",
      // The brief: the first message of the task's session. Write it in English; the AI answers in the person's language.
      prompt: "./agent/tasks/example.md",
```

`packages/cli/template/ui/App.tsx`: delete the `es` import; `const locales = { en };`; the comment at line 10 becomes `// Keys of locales/en.json for the work screen's start view.`

```bash
git rm packages/cli/template/locales/es.json
```

If `packages/cli/src/init.ts` rewrites `name: { es: …, en: … }` when it copies the template, make it write `name: "<id>"` instead (search it for `es:`).

- [ ] **Step 3: Guide**

In `packages/cli/guide/new-harness.md`, in the identity phase (or the phase that covers the manifest's texts), add:

```md
### Language

- Write everything in English: the manifest's texts, `locales/en.json`, the instructions and every brief. The app ships in English and translates the screens into the person's language on their own engine; the AI reads English and answers in the person's language. English is what the models reason best in.
- Don't add other `locales/*.json` files: the app doesn't read them.
- Give the manifest a `tone`: one English line on how the translated screens should sound ("warm and informal, short sentences"). Record it in `HARNESS.md`.
- In a brief, `{{language}}` is the person's language by its English name ("Brazilian Portuguese").
```

If the guide mentions `languages` or `es.json`, remove those lines. If `check.ts` has a `HARNESS.md` vs. manifest rule about languages, remove it and its test.

- [ ] **Step 4: Run and commit**

Run: `corepack pnpm vitest run packages/cli`
Expected: PASS.

```bash
git add packages/cli
git commit -m "feat(cli): the template and the guide are English-only, with a tone"
```

---

### Task 11: e2e — the app in English

**Files:**
- Modify: `packages/e2e/tests/helpers.ts`, `flow.spec.ts`, `mock.spec.ts`, `packages/e2e/real/real.spec.ts`

- [ ] **Step 1: Switch the system language and texts**

- `helpers.ts`: keep `language: "es"` in the saved config (it's what the AI answers in, and what the e2e checks it saves); change the launch comment and args to:

```ts
    // English as the system language: the screens are English (plan 5a); a fresh app saves "en".
    args: [shellDir, "--lang=en"],
```

- `mock.spec.ts` line 79: a fresh app now saves the system's language — expect `language: "en"`.
- In every spec, replace each Spanish UI string (`Iniciar`, `Configurar`, `Elegí…`, button names, headings — about 13 places; `grep -n "[áéíóúñ¿¡]\|Iniciar\|Configurar" packages/e2e/tests/*.ts packages/e2e/real/*.ts`) with the `en.json` value at the same key (same lookup as task 8 step 7). Strings that come from the demo's mock recordings (the AI's own text) stay as recorded.

- [ ] **Step 2: Run**

Run: `corepack pnpm e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/e2e
git commit -m "test(e2e): the app runs in English"
```

---

### Task 12: docs and roadmap

**Files:**
- Modify: `docs/architecture/manifest.md`, `docs/architecture/context.md`, `docs/superpowers/plans/2026-10-10-00-roadmap.md`

- [ ] **Step 1: Edit the docs**

`docs/architecture/manifest.md`, in the table: replace the `languages` row with

```md
| `tone` | One English line on how the translated screens should sound; the app ships in English and translates on the person's engine |
```

and add after the table's intro line: `Every text in the manifest is one English string.`

`docs/architecture/context.md`, under "What a new session gets", add a first bullet:

```md
- Everything the agent reads is English. The managed section of `AGENTS.md` tells it to think in English, to write what the person sees in their language (the saved tag by its English name, `languageName` in `harness-sdk`), and to write notes in English.
```

`docs/superpowers/plans/2026-10-10-00-roadmap.md`, add two rows after 4a:

```md
| 5a | **English core** (`2026-10-25-05a-english-core.md`, spec `2026-10-25-language-on-demand-design.md`) | Language is any BCP 47 tag; manifest texts are one English string, with an optional `tone`; `es.json` gone from the core, the demo and the template. Everything the AI reads is English: the managed section tells it to think in English, write to the person in their language and save notes in English. Screens are English until 5b | 4a |
| 5b | **Translation on demand** (same spec) | Language picker in Settings and the offer after setup; a notice, then a light-tier engine session translates core and harness strings in batches through `save_translation`; validation (keys, placeholders, plural forms), cache with source hashes, retranslation of changed keys only after asking; legal strings under `legal.` always English; pseudo-translation in the fake engine. Written when 5a lands | 5a |
```

- [ ] **Step 2: Commit**

```bash
git add docs
git commit -m "docs: plan 5a in the roadmap; manifest and context docs say English"
```

---

### Task 13: full gate

- [ ] **Step 1:** Run `corepack pnpm typecheck` — expected: no errors.
- [ ] **Step 2:** Run `corepack pnpm test` — expected: all pass.
- [ ] **Step 3:** Run `grep -rn "LocalizedText\|LANGUAGES\|harness.languages\|es\.json\|uiLanguage\|mockLanguage" packages harnesses --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=out` — expected: no output.
- [ ] **Step 4:** Run `corepack pnpm e2e` — expected: all pass.
- [ ] **Step 5:** Launch `corepack pnpm app:dev` with `config.json` language `es` and check by hand: screens in English; Settings › General shows "Español" with the hint; a topic's answer comes in Spanish; the note in `.harness/notes/` is English; `AGENTS.md` in the folder has "Think and reason in English."
