# Document Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app reads Markdown well. One rich renderer serves the chat and a new document reader: real headings with anchors, GFM tables, Mermaid diagrams, callouts, highlighted code, clickable links, task lists, footnotes, local images. A reader panel opens beside the chat (or full screen) from cards that each turn leaves for the `.md` files it added or changed, from `.md` links, and from `client.openDocument(path)`. Every harness's `AGENTS.md` gets a base "Writing for the reader" guide; a harness may also declare document kinds with section templates, which the reader checks and only warns about.

**Architecture:**
- **Pure helpers (`packages/harness-sdk/src/documents.ts`, subpath `@humanharness/harness-sdk/documents`, no Node imports).** Front-matter split, heading slugs, title fallback, word count and reading time, `.md` path test, the template check, the callout names, the kind id pattern. The runtime, the CLI and the window all use them.
- **Manifest (`packages/harness-sdk/src/index.ts`).** Optional `documents: { kinds }`, validated with zod.
- **`AGENTS.md` (`packages/workspace/src/instructions.ts`).** `managedSection` gets an optional `writing` option: the base guide plus, with kinds, the "Document kinds" part. Without the option the text is byte for byte today's (every existing D0 test keeps passing unchanged). The runtime always passes it (spec D4).
- **Cards (`packages/runtime`).** After a successful turn's "Turn: …" commit, the runtime diffs it against the turn's "Before message" commit (`History.changes`, a new public wrapper of the private `diff`). Every added or changed `.md` outside `.harness/` becomes a `DocumentCard`, sent as a new `documents` event right before `done`. The shell's `TurnRecorder`, the window's reducer and the CLI read it; the card is saved on the chat entry (`ChatEntry.documents`).
- **Main process (`packages/shell/src/main/documents.ts` + IPC).** `hh:readDocument` (only `.md`/`.markdown` inside the folder or a reference folder, never writes), `hh:readImage` (local images as data URLs), `hh:documentsExist`, `hh:watchDocument`/`hh:unwatchDocument` (live reload through a folder watcher). External links use the existing `setWindowOpenHandler`, which already sends `http(s)` to the system browser.
- **Renderer (`packages/ui`).** `markdown.tsx` is rewritten: `unified` + `remark-parse` + `remark-gfm` give an mdast tree that the plan's own walker turns into React elements (no hast step, no raw HTML ever; an `html` node renders as text). Fading words and `[[frag:…]]` citations keep working. `markdownToPlain` and its old parser move unchanged to `markdown-plain.ts`. Code is highlighted with `lowlight` (a fixed language set, rendered from its tree, never from HTML strings). Mermaid is loaded with a dynamic `import("mermaid")` on the first diagram, drawn in strict mode, and shown as an `<img>` with an SVG data URL.
- **Reader (`packages/ui/src/DocumentReader.tsx`, `DocumentCards.tsx`).** The panel beside the chat, the table of contents with the template note, the chips, the reading preferences (`AppConfig.reader`), Source, the size notice, live reload that keeps the place.
- **SDK.** `@humanharness/ui` exports `<Markdown source={…} path={…} />`; `HarnessClient` gets `openDocument(path)` and `onOpenDocument(listener)` (a preload-local event, like `onModeSwitch`).
- **Terminal.** `humanharness run` prints `Documents: <path> (new|updated)` per card.

**Tech Stack:** TypeScript, pnpm via corepack, Electron 44 + electron-vite 5, React 19, i18next, zod 4, Vitest + happy-dom, Playwright with the fake agents. New dependencies, all in `@humanharness/ui`: `unified`, `remark-parse`, `remark-gfm`, `@types/mdast` (dev), `lowlight`, `highlight.js` (only its grammar files), `mermaid`.

Spec: `docs/superpowers/specs/2026-10-27-document-reader-design.md` (on `origin/master` and `origin/docs/document-reader-spec`, not yet on `feat/opencode`; Task 0 brings it over). "§" and "D" numbers below refer to it. Mockup: https://claude.ai/artifact/L1DxW1KuL6LbCy4i93z3zp.

---

## Conventions

**Code**
- Same as plans 1–9:
  - English everywhere (code, comments, docs, UI strings);
  - packages export TS source;
  - extensionless imports;
  - tests in `packages/<name>/test/`;
  - one commit per task.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line. Find elements by role and visible text. Use `renderIn("en", …)` from `packages/ui/test/render.tsx` when the component uses `useTranslation`.
- `@humanharness/ui` imports values from other workspace packages only through browser-safe subpaths (`@humanharness/harness-sdk/language`, and the new `@humanharness/harness-sdk/documents`). Everything else stays `import type`.
- Colours only through `--hh-*` tokens. This plan adds callout tokens (Task 6) in both the light block and the dark `@media` block of `packages/ui/src/styles.css`.
- UI strings live in `packages/i18n/src/locales/en.json`, under a new top-level `reader` key.
- Document text, front-matter and file paths are untrusted data: they never become HTML, never pick a URL scheme other than `http(s)` for a link, and never reach the main process except as a relative path that main checks again.
- Errors over IPC travel as data, never as thrown errors.

**Commands and git**
- The worktree is `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data`. Create branch `feat/document-reader` from `feat/opencode` (plan 9) and implement there (Task 0).
- Run every `corepack pnpm …` command from the worktree root. A single test file: `corepack pnpm vitest run <path>`.
- `<worktree>` below means that path, written out in full.
- Git: always `git -C <worktree> …`, one simple command per call. Never use bare `git stash`. Never push.
- Every commit message ends with these two lines, with a blank line before them:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7
  ```
- Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green before its commit.
  - Tasks that touch the shell's main process, the preload or the UI also run `corepack pnpm app:build`.
  - Task 18 runs `corepack pnpm e2e`.
- The workspace sets a minimum release age for new packages (`pnpm-workspace.yaml`). `corepack pnpm --filter @humanharness/ui add <pkg>` then picks the newest version old enough. Never add an entry to `minimumReleaseAgeExclude`.

**Compliance**
- Never read `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode` or any credential file. This holds for the tests and for product code too. Tests use temp folders only.
- `hh:readDocument` and `hh:readImage` never write and never follow a path out of the person's folder or a reference folder (§5.3). They reuse `open-path.ts`'s checks (real paths, links resolved, re-checked right before reading).

**D0 is a hard rule.** A harness that does not declare `documents` keeps, byte for byte:
- its manifest validation result and `AppState` (no `documents` field);
- every `managedSection(…)` result called without `writing` (all existing tests in `packages/workspace/test/instructions.test.ts` stay unchanged);
- its chat log entries for turns that change no `.md` file (no `documents` field, no `documents` event);
- the CLI output for those turns;
- `AppConfig` on disk until the person changes a reading preference (no `reader` field written on its own);
- no template note, no kind chip, no "unknown kind" chip, ever.

What the spec deliberately changes for every harness, and this plan follows (see Open questions Q1–Q3): the managed section of `AGENTS.md` gains the base writing guide (spec D4 "always"); the chat draws richer Markdown (spec D1); a turn that adds or changes an `.md` gets a card (spec §5.1). Tasks 3, 4, 12, 13, 15 and 16 hold the D0 regression tests.

## Decisions this plan takes where the spec leaves room

**Renderer (§3)**
- mdast straight to React with our own walker, instead of `mdast-util-to-hast` + `hast-util-to-jsx-runtime`. Text nodes need the chat's word fading and `[[frag:…]]` citations, blockquotes need the callout rewrite, code needs Mermaid and the highlighter, links need the §3.4 rules: all are easier on mdast, and no raw-HTML path exists at all.
- `html` nodes (block and inline) render as their source text. `definition` nodes render nothing; `linkReference`/`imageReference` resolve through them.
- Soft line breaks: `breaks` is on in the chat (a single newline is a `<br>`, as today) and off in the reader (GitHub's file view).
- Tight list items render their paragraph without a `<p>` (as remark-rehype does), so a chat list looks as it does today.
- Headings `#`–`####` are `h1`–`h4`; `#####` and `######` stay bold lines (`p.hh-md-heading`). Every heading gets an id: `idPrefix + slug`. The reader uses an empty prefix so `#anchor` links work; each chat message uses its own prefix (from `useId`) so two messages never share an id.
- Callouts: a blockquote whose first paragraph starts with `[!NOTE]`, `[!TIP]`, `[!WARNING]`, `[!SUMMARY]`, `[!DECISION]` or `[!QUESTION]` (any case). Anything else is a plain blockquote.
- Caption: a paragraph whose only child is one `emphasis`, right after a table or a Mermaid diagram.
- Highlighter: `lowlight` with `bash`, `css`, `diff`, `go`, `java`, `javascript`, `json`, `markdown`, `python`, `rust`, `sql`, `typescript`, `xml`, `yaml` (aliases `sh`, `shell`, `zsh`, `js`, `jsx`, `ts`, `tsx`, `html`, `yml`, `md`, `py`, `rs`). Any other language is plain text.
- Code label: the `title="…"` of the info string's meta when present, else the language, else none.
- Mermaid: `securityLevel: "strict"`, `htmlLabels: false` (also under `flowchart`), `theme: "base"` with `themeVariables` read from the `--hh-*` tokens at draw time. The SVG is shown as `<img src="data:image/svg+xml,…">` (already allowed by the page's CSP `img-src 'self' data:`): an image cannot run scripts or load anything. Its `alt` is the caption's text, else "Diagram". It is drawn again when `prefers-color-scheme` changes. Draws run one at a time.
- Unclosed fence while streaming: a code node is "closed" when the last line of its source slice is a closing fence of the same character and at least the same length. An unclosed `mermaid` fence shows its source.

**Links and images (§3.2, §3.4)**
- `doc`: a relative link whose path ends in `.md` (any case), resolved against the current document's folder (the folder root in the chat). It opens in the reader, at the anchor when there is one.
- `anchor`: `#…` scrolls to `idPrefix + id` in the same document or message.
- `external`: `http:` or `https:` with a parseable URL: `<a target="_blank" rel="noreferrer noopener">` (main's existing `setWindowOpenHandler` opens the system browser) followed by the domain in muted text.
- Everything else (`file:`, `javascript:`, `mailto:`, `//host`, a relative non-`.md` path) is plain text: the label, then ` (url)` when the label differs, exactly as today.
- Outside a `DocumentContext` (a harness view drawn outside the chat), `doc` links are plain text too.
- Images: a relative path is read through `hh:readImage` (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`; at most 5 MB; same folder checks as documents). A remote image is an external link with its domain. Anything else, or a refusal, shows the alt text.

**Cards (§5.1)**
- A `DocumentCard` is `{ path, title, kind?, change: "new" | "updated", words }`. The window computes the reading time (`max(1, ceil(words / 230))` minutes).
- Only `ok` turns that made a "Turn: …" commit. A stopped or failed turn makes no card.
- Excluded: deleted files, anything under `.harness/`, and anything that is not `.md` (case-insensitive). At most 20 cards per turn, in path order.
- The title is read from the file at the turn's commit, not from disk.
- A quiet turn (closing, checkpoint) keeps its cards in the recorder but its entry is not shown (as today); nothing new is drawn for it.
- Deleted or moved: when the chat shows entries with cards, it asks `hh:documentsExist` for their paths (once per change of the list). A missing card is struck through, `aria-disabled`, and does nothing on click.
- "The agent of that turn": the entry's `engine` id mapped to its name from `state.engines`, else the configured engine's name.

**Reader (§5.2, §5.3, §6)**
- `hh:readDocument(path)` answers `{ ok: true, text, mtime, size }` or `{ ok: false, reason: "outside" | "missing" | "not-markdown" | "too-large" | "not-ready", size? }`. Over 10 MB it refuses ("too-large"); see Q6. Main returns the whole text; the window renders the first 200 KB when `size` is over 1 MB, and Source shows all of it.
- Live reload: main watches the document's folder (not the file: an editor or an agent may replace the file by renaming) and tells the window after 150 ms of quiet. The reader reads again; before it draws, it notes the last heading whose top is at or above the scroll box's top, and after drawing it scrolls that heading into view.
- Reading preferences: `AppConfig.reader = { font?: "sans" | "serif", size?: "normal" | "large" }`, set from two toggles in the reader's header ("Aa" menu). No Settings row (Q7).
- Full screen hides the chat column and the flow side panel; "Show chat" brings them back. Escape closes the reader when focus is inside it.
- On narrow windows (under 1100 px) the table of contents is hidden.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/harness-sdk/src/documents.ts` | create | Pure helpers: front-matter, slugs, title, words, reading time, template check, callouts, kind id |
| `packages/harness-sdk/src/index.ts` | modify | `documents` manifest schema; re-export the helpers |
| `packages/harness-sdk/package.json` | modify | `./documents` subpath |
| `packages/harness-sdk/test/documents.test.ts` | create | Helpers and manifest validation |
| `packages/workspace/src/instructions.ts` | modify | `writing` option: base guide and kinds |
| `packages/workspace/src/history.ts` | modify | Public `changes(from, to)` |
| `packages/workspace/test/instructions.test.ts`, `history.test.ts` | modify | Guide snapshots, D0, `changes` |
| `packages/runtime/src/events.ts` | modify | `DocumentCard`, `documents` event |
| `packages/runtime/src/documents.ts` | create | `turnDocuments(history, before, after)` |
| `packages/runtime/src/runtime.ts` | modify | Pass `writing`; emit `documents` |
| `packages/runtime/test/documents.test.ts`, `runtime.test.ts` | create / modify | Cards from a turn; AGENTS.md with the guide |
| `packages/shell/src/main/chat-log.ts` | modify | `TurnRecorder` keeps `documents` |
| `packages/shell/src/main/documents.ts` | create | Locate, read, image, exists, watch |
| `packages/shell/src/main/config.ts`, `validate.ts` | modify | `reader` preferences |
| `packages/shell/src/main/index.ts` | modify | IPC handlers, `AppState.documents` |
| `packages/shell/src/preload/index.ts` | modify | New client methods |
| `packages/shell/test/documents.test.ts`, `chat-log.test.ts`, `config.test.ts`, `validate.test.ts` | create / modify | Main-side tests |
| `packages/cli/src/terminal.ts` | modify | `Documents:` lines |
| `packages/cli/test/terminal.test.ts` | modify | Its test |
| `packages/ui/package.json` | modify | New dependencies |
| `packages/ui/src/markdown-plain.ts` | create | The old parser and `markdownToPlain`, moved unchanged |
| `packages/ui/src/markdown.tsx` | rewrite | The rich renderer |
| `packages/ui/src/doc-links.ts` | create | Link and image rules, path joining |
| `packages/ui/src/documents-context.ts` | create | `DocumentContext` (open, image, kinds) |
| `packages/ui/src/highlight.ts` | create | `lowlight` with the fixed language set |
| `packages/ui/src/MermaidDiagram.tsx` | create | Lazy Mermaid |
| `packages/ui/src/DocumentReader.tsx` | create | The reader panel |
| `packages/ui/src/DocumentCards.tsx` | create | Cards under an answer |
| `packages/ui/src/client.ts` | modify | Types and client methods |
| `packages/ui/src/state.ts` | modify | `documents` event in the reducer |
| `packages/ui/src/Message.tsx`, `ChatView.tsx` | modify | Cards, the panel, the context |
| `packages/ui/src/index.ts` | modify | Export `Markdown` |
| `packages/ui/src/styles.css` | modify | Renderer, callouts, reader |
| `packages/ui/test/*.test.tsx`, `fake-client.ts` | create / modify | UI tests |
| `packages/i18n/src/locales/en.json` | modify | `reader.*` strings |
| `packages/e2e/fixtures/reader-mock/manifest.json`, `packages/e2e/tests/reader.spec.ts` | create | End-to-end |
| `docs/architecture/documents.md`, `manifest.md`, `history.md`, `turn.md` | create / modify | Architecture docs |
| `docs/superpowers/specs/2026-10-27-document-reader-design.md` | add (Task 0), modify (Task 19) | Spec on the branch; status |

---

### Task 0: Branch and spec

**Files:**
- Add: `docs/superpowers/specs/2026-10-27-document-reader-design.md` (from `origin/master`)

- [ ] **Step 1: Create the branch**

Run: `git -C <worktree> switch -c feat/document-reader feat/opencode`
Expected: `Switched to a new branch 'feat/document-reader'`.

- [ ] **Step 2: Bring the spec over**

Run: `git -C <worktree> fetch origin`
Run: `git -C <worktree> checkout origin/master -- docs/superpowers/specs/2026-10-27-document-reader-design.md`
Expected: the file exists. If `origin/master` does not have it yet, use `origin/docs/document-reader-spec` instead.

- [ ] **Step 3: Commit**

```bash
git -C <worktree> add docs/superpowers/specs/2026-10-27-document-reader-design.md
git -C <worktree> commit -m "docs(spec): document reader on the plan 10 branch"
```

---

### Task 1: Dependencies and a parse smoke test

**Files:**
- Modify: `packages/ui/package.json`
- Test: `packages/ui/test/markdown-deps.test.ts`

- [ ] **Step 1: Add the packages**

Run: `corepack pnpm --filter @humanharness/ui add unified remark-parse remark-gfm lowlight highlight.js mermaid`
Run: `corepack pnpm --filter @humanharness/ui add -D @types/mdast`
Expected: `packages/ui/package.json` lists them; `pnpm-lock.yaml` changes. Record the installed majors in the commit message body. The plan's code assumes `unified@11`, `remark-parse@11`, `remark-gfm@4`, `lowlight@3`, `highlight.js@11`, `mermaid@11`. If a different major was picked, stop and adapt the imports in Tasks 5, 8 and 9 to its documented API.

- [ ] **Step 2: Write the smoke test**

Create `packages/ui/test/markdown-deps.test.ts`:

```ts
import { createLowlight } from "lowlight";
import typescript from "highlight.js/lib/languages/typescript";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

describe("renderer dependencies", () => {
  it("remark-gfm's tables, task lists, strikethrough and footnotes reach the tree with parse() alone", () => {
    const tree = unified().use(remarkParse).use(remarkGfm).parse("| a |\n|--:|\n| 1 |\n\n- [x] done\n\n~~gone~~[^1]\n\n[^1]: note");
    const types = tree.children.map((n) => n.type);
    expect(types).toEqual(["table", "list", "paragraph", "footnoteDefinition"]);
    expect((tree.children[0] as { align: unknown[] }).align).toEqual(["right"]);
  });

  it("lowlight answers a tree, never an HTML string", () => {
    const low = createLowlight({ typescript });
    const root = low.highlight("typescript", "const a = 1;");
    expect(root.type).toBe("root");
    expect(JSON.stringify(root)).toContain("hljs-keyword");
  });
});
```

- [ ] **Step 3: Run it**

Run: `corepack pnpm vitest run packages/ui/test/markdown-deps.test.ts`
Expected: PASS. (If the first test fails because `parse()` ignores the GFM extensions, the renderer in Task 5 must call `processor.runSync(processor.parse(text))` instead; note it in the commit.)

- [ ] **Step 4: Typecheck, test, commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`. Expected: green.

```bash
git -C <worktree> add packages/ui/package.json pnpm-lock.yaml packages/ui/test/markdown-deps.test.ts
git -C <worktree> commit -m "build(ui): remark, lowlight and mermaid for the document reader"
```

---

### Task 2: Pure document helpers

**Files:**
- Create: `packages/harness-sdk/src/documents.ts`
- Modify: `packages/harness-sdk/package.json`, `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/documents.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/harness-sdk/test/documents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CALLOUTS,
  DOCUMENT_KIND_ID,
  checkTemplate,
  createSlugger,
  documentTitle,
  isMarkdownPath,
  readingMinutes,
  splitFrontMatter,
  summarizeDocument,
  wordCount,
} from "../src/documents";

describe("splitFrontMatter", () => {
  it("reads simple key: value pairs and strips the block from the body", () => {
    const fm = splitFrontMatter('---\ntitle: "ADR 7: Cache"\nkind: adr\nstatus: \'accepted\'\n---\n# Body\n');
    expect(fm).toEqual({ data: { title: "ADR 7: Cache", kind: "adr", status: "accepted" }, body: "# Body\n", broken: false, lines: 5 });
  });

  it("no front-matter: everything is body", () => {
    expect(splitFrontMatter("# Hi\n---\n")).toEqual({ data: {}, body: "# Hi\n---\n", broken: false, lines: 0 });
  });

  it("an unclosed block is not front-matter", () => {
    expect(splitFrontMatter("---\ntitle: x\n").data).toEqual({});
    expect(splitFrontMatter("---\ntitle: x\n").body).toBe("---\ntitle: x\n");
  });

  it("broken front-matter is hidden but ignored (§6)", () => {
    const fm = splitFrontMatter("---\ntitle: x\nthis is not yaml\n---\nText");
    expect(fm).toEqual({ data: {}, body: "Text", broken: true, lines: 4 });
  });

  it("skips indented lines, comments and empty lines; takes CRLF and a BOM", () => {
    const fm = splitFrontMatter("﻿---\r\ntags:\r\n  - a\r\n# note\r\n\r\ntitle: T\r\n...\r\nX");
    expect(fm.data).toEqual({ tags: "", title: "T" });
    expect(fm.body).toBe("X");
  });
});

describe("createSlugger", () => {
  it("makes GitHub-style ids, deduplicated in order", () => {
    const slug = createSlugger();
    expect(slug("Alternatives considered")).toBe("alternatives-considered");
    expect(slug("Alternatives considered")).toBe("alternatives-considered-1");
    expect(slug("¿Qué pasa? — Ñandú")).toBe("qué-pasa--ñandú");
    expect(slug("!!!")).toBe("section");
    expect(slug("!!!")).toBe("section-1");
  });
});

describe("documentTitle", () => {
  it("front-matter title, else the first # heading outside code, else the file name", () => {
    expect(documentTitle("a/b.md", "---\ntitle: From FM\n---\n# H1")).toBe("From FM");
    expect(documentTitle("a/b.md", "```\n# not this\n```\n## Two\n# Real one #\n")).toBe("Real one");
    expect(documentTitle("tickets/MUS-412/analysis.md", "No heading")).toBe("analysis");
  });
});

describe("words and reading time", () => {
  it("counts the body's words, without the front-matter", () => {
    expect(wordCount("---\ntitle: a b c\n---\none two\nthree")).toBe(3);
  });
  it("230 words a minute, at least one", () => {
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(230)).toBe(1);
    expect(readingMinutes(231)).toBe(2);
  });
});

describe("isMarkdownPath", () => {
  it("takes .md in any case, nothing else", () => {
    expect(isMarkdownPath("a/B.MD")).toBe(true);
    expect(isMarkdownPath("a.markdown")).toBe(false);
    expect(isMarkdownPath("a.md.txt")).toBe(false);
  });
});

describe("summarizeDocument", () => {
  it("title, kind and words for a card", () => {
    expect(summarizeDocument("x/plan.md", "---\nkind: analysis\n---\n# The plan\nGo now.")).toEqual({ title: "The plan", kind: "analysis", words: 5 });
    expect(summarizeDocument("x/plan.md", "Hi")).toEqual({ title: "plan", words: 1 });
  });
});

describe("checkTemplate (§4.3)", () => {
  const kinds = {
    analysis: { when: "x", sections: ["Context", "Options", "Risks"] },
    adr: { when: "y", sections: ["Status"], status: ["proposed", "accepted"] },
  };
  it("a missing section, matched without case and trimmed; order and extras are fine", () => {
    expect(checkTemplate(kinds, { kind: "analysis" }, ["  options ", "CONTEXT", "Extra"])).toEqual({ kind: "analysis", missing: ["Risks"] });
  });
  it("an unknown kind", () => {
    expect(checkTemplate(kinds, { kind: "memo" }, [])).toEqual({ kind: "memo", unknownKind: true, missing: [] });
  });
  it("a status outside the kind's list", () => {
    expect(checkTemplate(kinds, { kind: "adr", status: "done" }, ["Status"])).toEqual({ kind: "adr", missing: [], badStatus: "done" });
    expect(checkTemplate(kinds, { kind: "adr", status: "accepted" }, ["Status"])).toEqual({ kind: "adr", missing: [] });
  });
  it("no kind, or no kinds declared: no check", () => {
    expect(checkTemplate(kinds, {}, [])).toBeNull();
    expect(checkTemplate(undefined, { kind: "adr" }, [])).toBeNull();
    expect(checkTemplate({}, { kind: "adr" }, [])).toBeNull();
  });
});

describe("constants", () => {
  it("six callouts, three GitHub's and three of the core", () => {
    expect(CALLOUTS).toEqual(["note", "tip", "warning", "summary", "decision", "question"]);
  });
  it("kind ids are lowercase", () => {
    expect(DOCUMENT_KIND_ID.test("adr")).toBe(true);
    expect(DOCUMENT_KIND_ID.test("design-doc2")).toBe(true);
    expect(DOCUMENT_KIND_ID.test("ADR")).toBe(false);
    expect(DOCUMENT_KIND_ID.test("2x")).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/harness-sdk/test/documents.test.ts`
Expected: FAIL ("Cannot find module '../src/documents'").

- [ ] **Step 3: Write the helpers**

Create `packages/harness-sdk/src/documents.ts`:

```ts
// No Node imports here: the screens import this file (`@humanharness/harness-sdk/documents`).

/** A document kind's id (document-reader spec §4.2). */
export const DOCUMENT_KIND_ID = /^[a-z][a-z0-9-]*$/;

/** The callouts the renderer draws (§3.2): GitHub's three, then the core's three. The set is fixed. */
export const CALLOUTS = ["note", "tip", "warning", "summary", "decision", "question"] as const;
export type Callout = (typeof CALLOUTS)[number];

/** A kind a harness declares (manifest `documents.kinds`). */
export interface DocumentKind {
  /** One sentence: when to use it. */
  when: string;
  /** Its `##` sections, in order. */
  sections: string[];
  /** The values its front-matter `status` may take. */
  status?: string[];
}

export interface FrontMatter {
  /** Top-level `key: value` pairs, quotes removed. Empty when there is none or it is broken. */
  data: Record<string, string>;
  /** The text after the block (all of it when there is no block). */
  body: string;
  /** There was a closed block, but a line in it was not `key: value` (§6: ignored). */
  broken: boolean;
  /** How many lines the block took, delimiters included (0 without one). */
  lines: number;
}

const KEY_VALUE = /^([A-Za-z_][\w-]*):(?:\s+(.*?))?\s*$/;

function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(v);
      return typeof parsed === "string" ? parsed : v;
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replaceAll("''", "'");
  return v;
}

/** The front-matter block at the very top (`---` … `---` or `...`): a small YAML subset, never more. */
export function splitFrontMatter(text: string): FrontMatter {
  const src = text.replace(/^﻿/, "");
  const lines = src.split(/\r?\n/);
  if (lines[0] !== "---") return { data: {}, body: text, broken: false, lines: 0 };
  const end = lines.findIndex((l, i) => i > 0 && (l === "---" || l === "..."));
  if (end < 0) return { data: {}, body: text, broken: false, lines: 0 };
  const data: Record<string, string> = {};
  let broken = false;
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) continue;
    const m = KEY_VALUE.exec(line);
    if (!m) {
      broken = true;
      continue;
    }
    data[m[1]] = unquote(m[2] ?? "");
  }
  // The body keeps its own line endings: only the block's lines are cut (line endings may be mixed).
  const body = stripLines(src, end + 1);
  return { data: broken ? {} : data, body, broken, lines: end + 1 };
}

/** `text` without its first `count` lines (any line ending). */
function stripLines(text: string, count: number): string {
  let i = 0;
  for (let n = 0; n < count; n++) {
    const next = text.indexOf("\n", i);
    if (next < 0) return "";
    i = next + 1;
  }
  return text.slice(i);
}

/** A heading's anchor id, GitHub style: lowercase, punctuation dropped, spaces to dashes. */
export function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Slugs deduplicated in the order asked: "a", "a-1", "a-2". An empty slug is "section". */
export function createSlugger(): (text: string) => string {
  const seen = new Set<string>();
  return (text) => {
    const base = slug(text) || "section";
    let id = base;
    for (let n = 1; seen.has(id); n++) id = `${base}-${n}`;
    seen.add(id);
    return id;
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const H1 = /^ {0,3}#\s+(.*?)(?:\s+#+)?\s*$/;

/** A card's title (§5.1): front-matter `title`, else the first `#` heading outside code, else the file name. */
export function documentTitle(path: string, text: string): string {
  const fm = splitFrontMatter(text);
  const fromFm = fm.data.title?.trim();
  if (fromFm) return fromFm;
  let fence: string | null = null;
  for (const line of fm.body.split(/\r?\n/)) {
    const f = FENCE.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = H1.exec(line);
    if (h && h[1].trim()) return h[1].trim();
  }
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}

/** Words in the body (front-matter left out). */
export function wordCount(text: string): number {
  return splitFrontMatter(text).body.split(/\s+/).filter(Boolean).length;
}

/** Reading time at 230 words a minute (§5.1), at least one minute. */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.ceil(words / 230));
}

/** A Markdown document the reader opens and cards are made for: `.md`, any case. */
export function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path);
}

/** What a card shows of a document. `kind` only when the front-matter has one. */
export function summarizeDocument(path: string, text: string): { title: string; kind?: string; words: number } {
  const kind = splitFrontMatter(text).data.kind?.trim();
  return { title: documentTitle(path, text), ...(kind ? { kind } : {}), words: wordCount(text) };
}

export interface TemplateResult {
  kind: string;
  /** The harness does not declare this kind. */
  unknownKind?: true;
  /** Required sections not found, in the template's order. */
  missing: string[];
  /** The front-matter status is not in the kind's list. */
  badStatus?: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/** The template check (§4.3). Null: nothing to check (no `kind`, or the harness declares no kinds). Never blocks. */
export function checkTemplate(kinds: Record<string, DocumentKind> | undefined, front: Record<string, string>, sections: string[]): TemplateResult | null {
  const kind = front.kind?.trim();
  if (!kind || !kinds || Object.keys(kinds).length === 0) return null;
  if (!Object.hasOwn(kinds, kind)) return { kind, unknownKind: true, missing: [] };
  const def = kinds[kind];
  const have = new Set(sections.map(norm));
  const missing = def.sections.filter((s) => !have.has(norm(s)));
  const status = front.status?.trim();
  return { kind, missing, ...(status && def.status && !def.status.includes(status) ? { badStatus: status } : {}) };
}
```

In `packages/harness-sdk/package.json`, change `exports` to:

```json
  "exports": { ".": "./src/index.ts", "./language": "./src/language.ts", "./documents": "./src/documents.ts" },
```

In `packages/harness-sdk/src/index.ts`, after `export * from "./material";` add:

```ts
export * from "./documents";
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk/test/documents.test.ts`
Expected: PASS. (The "CRLF and BOM" case: `stripLines` cuts after the `...` line, so the body is `X`.)

- [ ] **Step 5: Typecheck, test, commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`. Expected: green.

```bash
git -C <worktree> add packages/harness-sdk/src/documents.ts packages/harness-sdk/src/index.ts packages/harness-sdk/package.json packages/harness-sdk/test/documents.test.ts
git -C <worktree> commit -m "feat(sdk): document helpers — front-matter, slugs, titles, reading time, template check"
```

---

### Task 3: Manifest — `documents.kinds`

**Files:**
- Modify: `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/documents.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/harness-sdk/test/documents.test.ts`:

```ts
import { type HarnessInput, defineHarness } from "../src";

const base: HarnessInput = {
  id: "dev",
  name: "Dev",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Dev" },
  instructions: "./AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: {},
  author: "t",
};

describe("manifest documents (§4.2)", () => {
  it("takes kinds with when, sections and an optional status", () => {
    const h = defineHarness({
      ...base,
      documents: {
        kinds: {
          adr: { when: "A decision with real alternatives.", sections: ["Status", "Context"], status: ["proposed", "accepted"] },
          analysis: { when: "Exploring options.", sections: ["Context"] },
        },
      },
    });
    expect(Object.keys(h.documents!.kinds)).toEqual(["adr", "analysis"]);
  });

  it("refuses a bad id, an empty sections list, an empty heading and an empty when", () => {
    expect(() => defineHarness({ ...base, documents: { kinds: { ADR: { when: "x", sections: ["A"] } } } })).toThrow();
    expect(() => defineHarness({ ...base, documents: { kinds: { adr: { when: "x", sections: [] } } } })).toThrow();
    expect(() => defineHarness({ ...base, documents: { kinds: { adr: { when: "x", sections: [" "] } } } })).toThrow();
    expect(() => defineHarness({ ...base, documents: { kinds: { adr: { when: "", sections: ["A"] } } } })).toThrow();
    expect(() => defineHarness({ ...base, documents: { kinds: { adr: { when: "x", sections: ["A"], status: [] } } } })).toThrow();
  });

  it("refuses the same section twice in a kind", () => {
    expect(() => defineHarness({ ...base, documents: { kinds: { adr: { when: "x", sections: ["Context", "context "] } } } })).toThrow(/twice/);
  });

  it("D0: without documents the manifest has no documents field", () => {
    expect("documents" in defineHarness(base)).toBe(false);
  });
});
```

(Move the new `import` line to the top of the file, next to the other imports.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/harness-sdk/test/documents.test.ts`
Expected: FAIL (the schema strips `documents`, so `h.documents` is undefined; the refusals do not throw).

- [ ] **Step 3: Add the schema**

In `packages/harness-sdk/src/index.ts`, add to the imports from `./documents` (new import line near the others):

```ts
import { DOCUMENT_KIND_ID } from "./documents";
```

Above `const manifestSchema`, add:

```ts
/** One kind of document the harness's agent writes (document-reader spec §4.2). */
const documentKindSchema = z.object({
  when: text.max(300),
  sections: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  status: z.array(z.string().trim().min(1).max(40)).min(1).max(10).optional(),
});
/** Document kinds with a template of required `##` sections. Absent: only the base writing guide (D0). */
const documentsSchema = z.object({ kinds: z.record(z.string().regex(DOCUMENT_KIND_ID), documentKindSchema) });
```

In `manifestSchema`, after `material: materialSchema.optional(),` add:

```ts
  /** Kinds of documents with section templates; the reader checks them and only warns (document-reader spec §4). Absent: none (D0). */
  documents: documentsSchema.optional(),
```

At the end of the `superRefine` callback (after the material block), add:

```ts
  // Document kinds (document-reader spec §4.2): a section named twice could never be told apart by the check.
  for (const [id, kind] of Object.entries(m.documents?.kinds ?? {})) {
    const seen = new Set<string>();
    kind.sections.forEach((s, i) => {
      const key = s.trim().toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["documents", "kinds", id, "sections", i], message: `"${s}" is listed twice` });
      seen.add(key);
    });
  }
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk/test/documents.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`. Expected: green.

```bash
git -C <worktree> add packages/harness-sdk/src/index.ts packages/harness-sdk/test/documents.test.ts
git -C <worktree> commit -m "feat(sdk): manifest documents.kinds with section templates"
```

---

### Task 4: `AGENTS.md` — the writing guide and the kinds

**Files:**
- Modify: `packages/workspace/src/instructions.ts`
- Modify: `packages/runtime/src/runtime.ts`
- Test: `packages/workspace/test/instructions.test.ts`, `packages/runtime/test/runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/workspace/test/instructions.test.ts`, inside a new `describe`:

```ts
describe("writing for the reader (document-reader spec §4)", () => {
  const GUIDE_START = "### Writing for the reader";

  it("D0: without `writing` the section is exactly today's", () => {
    expect(managedSection({ language: "en", blocks })).not.toContain(GUIDE_START);
  });

  it("the base guide: last part of the section, English, the six callouts and nothing else", () => {
    const s = managedSection({ language: "es", blocks: {}, writing: { kinds: {} } });
    expect(s.trimEnd().endsWith(MANAGED_END)).toBe(true);
    const guide = s.slice(s.indexOf(GUIDE_START), s.indexOf(MANAGED_END));
    expect(guide).toMatchSnapshot();
    for (const c of ["NOTE", "TIP", "WARNING", "SUMMARY", "DECISION", "QUESTION"]) expect(guide).toContain(`[!${c}]`);
    expect([...new Set(guide.match(/\[![A-Z]+\]/g))].sort()).toEqual(["[!DECISION]", "[!NOTE]", "[!QUESTION]", "[!SUMMARY]", "[!TIP]", "[!WARNING]"]);
    expect(guide).not.toContain("### Document kinds");
    expect(guide).toContain("`title` always.");
    expect(guide).not.toContain("`kind`");
  });

  it("with kinds: each kind's id, when and its template (front-matter, then headings in order)", () => {
    const s = managedSection({
      language: "en",
      blocks: {},
      writing: {
        kinds: {
          adr: { when: "A decision with real alternatives.", sections: ["Status", "Context", "Decision"], status: ["proposed", "accepted", "superseded"] },
          analysis: { when: "Exploring options before deciding.", sections: ["Context", "Options"] },
        },
      },
    });
    const kinds = s.slice(s.indexOf("### Document kinds"), s.indexOf(MANAGED_END));
    expect(kinds).toMatchSnapshot();
    expect(kinds).toContain("- `adr`: A decision with real alternatives.");
    expect(kinds).toContain("    status: proposed | accepted | superseded");
    expect(kinds.indexOf("    ## Status")).toBeLessThan(kinds.indexOf("    ## Decision"));
    expect(s).toContain("`title` always, and `kind` when one of the kinds below fits.");
  });
});
```

In `packages/runtime/test/runtime.test.ts`, change the D0 test "D0: without settings, AGENTS.md is the base and today's managed section…" so its expected text passes the guide (spec D4: every harness gets it):

```ts
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toBe(
      `${base.trimEnd()}\n\n${managedSection({ language: "en", blocks: allBlocks(harness), writing: { kinds: {} } })}`,
    );
```

and rename it to `"without settings, AGENTS.md is the base, today's managed section and the writing guide; a refresh writes nothing"`.

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/workspace/test/instructions.test.ts packages/runtime/test/runtime.test.ts`
Expected: FAIL (`writing` is not a known option; the guide is missing). The snapshot tests write new snapshots only once the code exists; check them by eye in Step 4.

- [ ] **Step 3: Write the guide**

In `packages/workspace/src/instructions.ts`:

Add to the imports:

```ts
import type { DocumentKind } from "@humanharness/harness-sdk";
```

Add to `TEXT` (after `annotateRule`):

```ts
  writing: "### Writing for the reader",
  writingIntro: "The person reads the `.md` files you write in a reader with rich Markdown. Write them for that reader:",
  writingRules: (withKinds: boolean) => [
    "**Structure.** One idea per section. Use `##` for sections and `###` for subsections, and never skip a level. Keep paragraphs to two to four sentences.",
    "**Summary first.** A document longer than about 300 words starts with a `> [!SUMMARY]` callout that holds the conclusion.",
    "**Pick the element by the content:**",
    "  - two or more options compared on two or more criteria: a table;",
    "  - a flow, a sequence, states or components: a Mermaid diagram (a ```mermaid fence), followed by a one-line caption in italics;",
    "  - a decision: `> [!DECISION]`, with the reason;",
    "  - a question for the person: `> [!QUESTION]`;",
    "  - a risk: `> [!WARNING]`;",
    "  - pending steps: a task list (`- [ ]`).",
    "**Callouts.** Use only these six: `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!SUMMARY]`, `> [!DECISION]`, `> [!QUESTION]`. The first line is the marker alone; the text follows on the next lines of the quote.",
    "**Limits.** Tables up to about six columns: split them, or use a list, beyond that. Diagrams up to about 15 nodes: split them beyond that.",
    "**No raw HTML.** It shows as text. Use Markdown only.",
    "**Links.** Link between documents with relative paths (`adr-007.md`, `../notes/x.md#context`). Links to the web use `https://`.",
    withKinds
      ? "**Front-matter.** Start every document with a front-matter block: `title` always, and `kind` when one of the kinds below fits."
      : "**Front-matter.** Start every document with a front-matter block holding `title` always.",
  ],
  writingExample: [
    "Example of the start of a document:",
    "",
    "    ---",
    "    title: Caching the search results",
    "    ---",
    "    > [!SUMMARY]",
    "    > Cache in memory for ten minutes; it removes most of the slow calls.",
    "",
    "    ## Context",
  ],
  kinds: "### Document kinds",
  kindsIntro:
    "When a document fits one of these kinds, put its id in the front-matter `kind` and use its `##` sections, in this order. Extra sections are fine. The reader warns the person when a section is missing.",
  kindTemplate: "Template:",
```

Note the rule above: the test expects the literal `` `title` always. `` without kinds, so the no-kinds line reads "Start every document with a front-matter block holding `title` always." — keep that exact wording.

Add this function above `managedSection`:

```ts
/** What `AGENTS.md` says about writing documents (document-reader spec §4.1, §4.2). */
export interface WritingGuide {
  /** The harness's document kinds; `{}` for the base guide only. */
  kinds: Record<string, DocumentKind>;
}

/** The "Writing for the reader" part, and with kinds the "Document kinds" part. */
export function writingLines(writing: WritingGuide | undefined): string[] {
  if (!writing) return [];
  const t = TEXT;
  const kinds = Object.entries(writing.kinds);
  const lines = ["", t.writing, "", t.writingIntro, "", ...t.writingRules(kinds.length > 0).map((r) => (r.startsWith("  ") ? r : `- ${r}`)), "", ...t.writingExample];
  if (kinds.length === 0) return lines;
  lines.push("", t.kinds, "", t.kindsIntro, "");
  for (const [id, k] of kinds) {
    lines.push(`- \`${id}\`: ${k.when}`, `  ${t.kindTemplate}`, "", "    ---", "    title: …", `    kind: ${id}`);
    if (k.status) lines.push(`    status: ${k.status.join(" | ")}`);
    lines.push("    ---", ...k.sections.map((s) => `    ## ${s}`), "");
  }
  lines.pop();
  return lines;
}
```

Change `managedSection`'s options and body:

```ts
export function managedSection(opts: {
  language: Language;
  blocks: Record<string, Block>;
  references?: ReferenceFolder[];
  settings?: readonly string[];
  material?: boolean;
  /** The writing guide (document-reader spec D4). Absent: no such part (callers that predate it). */
  writing?: WritingGuide;
}): string {
```

and, right before `lines.push(MANAGED_END, "");`:

```ts
  lines.push(...writingLines(opts.writing));
```

Add `writing?: WritingGuide;` to `InstructionsText` (with the doc comment "The writing guide; the runtime always passes it (spec D4)."), and pass it on in `agentsText`:

```ts
  const section = managedSection({ language: opts.language, blocks: opts.blocks, references: opts.references, settings: opts.settings, material: opts.material, writing: opts.writing });
```

Export `writingLines` and `WritingGuide` from `packages/workspace/src/index.ts` if that file lists exports by name (check with `grep -n instructions packages/workspace/src/index.ts`; an `export *` needs nothing).

- [ ] **Step 4: Pass it from the runtime**

In `packages/runtime/src/runtime.ts`, after `const withMaterial = …;` add:

```ts
  // Every harness gets the writing guide; its kinds only when it declares them (document-reader spec D4).
  const writing = { kinds: harness.documents?.kinds ?? {} };
```

and add `writing` to both the `writeInstructions({ … })` call and the `refreshInstructions({ … })` call:

```ts
  const generated = await writeInstructions({ folder, base, language: opts.language, blocks, references, engine, writing, ...(settings ? { settings } : {}), ...withMaterial });
```

```ts
          return refreshInstructions({ folder, base, language: opts.language, blocks, references, writing, ...(now ? { settings: now } : {}), ...withMaterial });
```

- [ ] **Step 5: Run the tests and read the snapshots**

Run: `corepack pnpm vitest run packages/workspace/test/instructions.test.ts packages/runtime/test/runtime.test.ts`
Expected: PASS, with two new snapshots in `packages/workspace/test/__snapshots__/instructions.test.ts.snap`. Open the file and check: about 40 lines for the base guide (spec §4.1), no Spanish even with `language: "es"`, the kinds' templates as indented blocks.

- [ ] **Step 6: Typecheck, test, commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`. Expected: green. If an e2e helper or another package test compares a whole `AGENTS.md`, update it to include `writing: { kinds: {} }` the same way (search: `grep -rn "managedSection(" packages --include=*.ts`).

```bash
git -C <worktree> add packages/workspace/src/instructions.ts packages/workspace/src/index.ts packages/workspace/test/instructions.test.ts packages/workspace/test/__snapshots__ packages/runtime/src/runtime.ts packages/runtime/test/runtime.test.ts
git -C <worktree> commit -m "feat(workspace): writing guide and document kinds in AGENTS.md"
```

---
### Task 5: The renderer — mdast to React

**Files:**
- Create: `packages/ui/src/markdown-plain.ts`
- Rewrite: `packages/ui/src/markdown.tsx`
- Modify: `packages/ui/src/Message.tsx`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/markdown.test.tsx`

- [ ] **Step 1: Move the old parser and `markdownToPlain`, unchanged**

Create `packages/ui/src/markdown-plain.ts` with, copied byte for byte from today's `markdown.tsx`: the `Inline` and `Block` types, `FENCE`, `HEADING`, `BULLET`, `ORDERED`, `RULE`, `parseBlocks`, `INLINE`, `parseInline`, `plainInline` and `markdownToPlain`. Its only import is:

```ts
import { plainCitations } from "./citations";
```

Add this comment at the top:

```ts
/**
 * The chat's screen-reader text (`markdownToPlain`), with the line parser it always used. Kept as it was when the
 * rich renderer replaced the drawing (document-reader spec §3.1): the announcement must not change.
 */
```

Export `parseBlocks`, `parseInline` and `markdownToPlain` (as today).

- [ ] **Step 2: Rewrite the tests that the spec changes, and add the new ones**

In `packages/ui/test/markdown.test.tsx`:
- change the helper to `const md = (text: string) => render(<div>{<Markdown source={text} />}</div>).container.firstElementChild as HTMLElement;` and every other `<Markdown text=` to `<Markdown source=`;
- delete the tests "shows headings as bold lines" and "shows links as text with their URL, never as clickable links" (spec §3.2 and §3.4 replace them; Task 7 adds the link tests);
- add, inside `describe("Markdown")`:

```tsx
  it("draws real headings # to #### with deduplicated anchor ids; ##### stays a bold line", () => {
    const el = render(<Markdown source={"# Top\n## The **manifest**\n## The manifest\n#### Four\n##### Five"} idPrefix="" />).container;
    expect([...el.querySelectorAll("h1,h2,h3,h4")].map((h) => [h.tagName, h.id, h.textContent])).toEqual([
      ["H1", "top", "Top"],
      ["H2", "the-manifest", "The manifest"],
      ["H2", "the-manifest-1", "The manifest"],
      ["H4", "four", "Four"],
    ]);
    expect(el.querySelector("p.hh-md-heading > strong")?.textContent).toBe("Five");
  });

  it("prefixes ids per message, so two answers never share one", () => {
    const { container } = render(
      <>
        <Markdown source="## Same" />
        <Markdown source="## Same" />
      </>,
    );
    const ids = [...container.querySelectorAll("h2")].map((h) => h.id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids.every((id) => id.endsWith("same"))).toBe(true);
  });

  it("draws GFM tables in a scrolling box, right-aligned columns with tabular numbers", () => {
    const el = md("| Option | Cost |\n|:--|--:|\n| A | 10 |\n| B | 200 |");
    const box = el.querySelector(".hh-md-table");
    expect(box?.getAttribute("role")).toBe("region");
    expect(box?.getAttribute("tabindex")).toBe("0");
    expect([...el.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Option", "Cost"]);
    expect([...el.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent))).toEqual([["A", "10"], ["B", "200"]]);
    expect(el.querySelectorAll("td.hh-num")).toHaveLength(2);
    expect(el.querySelector("th.hh-num")?.textContent).toBe("Cost");
  });

  it("task lists are read-only checkboxes", () => {
    const el = md("- [x] done\n- [ ] to do");
    const boxes = [...el.querySelectorAll<HTMLInputElement>("li input[type=checkbox]")];
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([[true, true], [false, true]]);
  });

  it("strikethrough", () => {
    expect(md("~~gone~~").querySelector("del")?.textContent).toBe("gone");
  });

  it("a document hides its front-matter and keeps soft line breaks as spaces", () => {
    const el = render(<Markdown source={"---\ntitle: T\nkind: adr\n---\nOne\ntwo"} document />).container;
    expect(el.textContent).not.toContain("title:");
    expect(el.querySelector("p")?.innerHTML).toBe("One\ntwo");
  });
```

- [ ] **Step 3: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/markdown.test.tsx`
Expected: FAIL (`source` is not a prop; no real headings, no tables).

- [ ] **Step 4: Write the renderer**

Replace `packages/ui/src/markdown.tsx` with:

```tsx
import { Fragment, type ReactNode, createElement, useContext, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Code, Definition, FootnoteDefinition, Heading, List, Nodes, Parents, PhrasingContent, Root, RootContent, Table } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { createSlugger, splitFrontMatter } from "@humanharness/harness-sdk/documents";
import { CitationContext, splitCitations } from "./citations";

export { markdownToPlain } from "./markdown-plain";

/**
 * The rich renderer for the chat and the document reader (document-reader spec §3): `remark-parse` + `remark-gfm`
 * into mdast, then straight to React elements. There is no raw-HTML path: HTML in the source is shown as text.
 */
const processor = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdown(text: string): Root {
  return processor.parse(text) as Root;
}

/** Everything a node needs to draw itself. */
interface Ctx {
  fade: boolean;
  /** A single newline is a line break (the chat); off in documents. */
  breaks: boolean;
  /** Put before every id this text makes (headings, footnotes). */
  prefix: string;
  slug: (text: string) => string;
  /** The parsed text, for the source of a node (an unclosed fence). */
  source: string;
  /** The document's own path (relative to the folder); "" in the chat. */
  base: string;
  definitions: Map<string, Definition>;
  t: TFunction;
}

/** A node's plain text (headings' ids, captions, link labels). */
export function textOf(node: Nodes): string {
  if ("value" in node && typeof node.value === "string" && node.type !== "html") return node.value;
  if ("children" in node) return (node.children as Nodes[]).map(textOf).join("");
  return "";
}

/**
 * Text that fades in word by word as it arrives: each word is its own span, and a span already on screen keeps
 * its place (and so doesn't fade again) when more words come after it.
 */
function fadingWords(text: string): ReactNode[] {
  return text.split(/(\s+)/).map((w, i) => (!w || /^\s+$/.test(w) ? w : <span key={i} className="hh-word">{w}</span>));
}

/** `[[frag:<id>]]` (material spec §9): "<source>, <location>", which opens the original; text when there is no such fragment. */
function Citation({ id }: { id: string }) {
  const cite = useContext(CitationContext);
  const { t } = useTranslation();
  const [label, setLabel] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    cite?.label(id).then(
      (l) => live && setLabel(l),
      () => live && setLabel(null),
    );
    return () => {
      live = false;
    };
  }, [cite, id]);
  // Until the label arrives, or when there is none, the marker stays plain text: no empty button to land on.
  if (!cite || !label) return <>{`[[frag:${id}]]`}</>;
  const opens = t("material.openOriginal");
  return (
    <button type="button" className="hh-citation" title={opens} aria-description={opens} onClick={() => cite.open(id)}>
      {label}
    </button>
  );
}

/** A text run with its citations drawn, only inside a `CitationContext`; otherwise exactly the text (D0). */
function CitedText({ text, fade }: { text: string; fade: boolean }) {
  const cite = useContext(CitationContext);
  if (!cite || !text.includes("[[frag:")) return <>{fade ? fadingWords(text) : text}</>;
  return (
    <>
      {splitCitations(text).map((part, i) =>
        typeof part === "string" ? <Fragment key={i}>{fade ? fadingWords(part) : part}</Fragment> : <Citation key={i} id={part.id} />,
      )}
    </>
  );
}

/** A text node: in the chat a single newline is a line break. */
function renderText(value: string, ctx: Ctx, key: number): ReactNode {
  if (!ctx.breaks || !value.includes("\n")) return <CitedText key={key} text={value} fade={ctx.fade} />;
  return (
    <Fragment key={key}>
      {value.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <CitedText text={line} fade={ctx.fade} />
        </Fragment>
      ))}
    </Fragment>
  );
}

function renderInline(nodes: PhrasingContent[], ctx: Ctx): ReactNode[] {
  return nodes.map((n, i) => renderPhrasing(n, ctx, i));
}

function renderPhrasing(n: PhrasingContent, ctx: Ctx, i: number): ReactNode {
  switch (n.type) {
    case "text":
      return renderText(n.value, ctx, i);
    case "html":
      // Raw HTML stays text, always.
      return <Fragment key={i}>{n.value}</Fragment>;
    case "inlineCode":
      return (
        <code key={i} className={ctx.fade ? "hh-word" : undefined}>
          {n.value}
        </code>
      );
    case "strong":
      return <strong key={i}>{renderInline(n.children, ctx)}</strong>;
    case "emphasis":
      return <em key={i}>{renderInline(n.children, ctx)}</em>;
    case "delete":
      return <del key={i}>{renderInline(n.children, ctx)}</del>;
    case "break":
      return <br key={i} />;
    case "link":
      return renderLink(n.url, n.children, ctx, i);
    case "linkReference": {
      const def = ctx.definitions.get(n.identifier);
      return def ? renderLink(def.url, n.children, ctx, i) : <Fragment key={i}>{renderInline(n.children, ctx)}</Fragment>;
    }
    case "image":
      return renderImage(n.url, n.alt ?? "", ctx, i);
    case "imageReference": {
      const def = ctx.definitions.get(n.identifier);
      return def ? renderImage(def.url, n.alt ?? "", ctx, i) : <Fragment key={i}>{n.alt ?? ""}</Fragment>;
    }
    case "footnoteReference":
      return renderFootnoteReference(n.identifier, ctx, i);
    default:
      return null;
  }
}

/** A link (§3.4). Task 7 gives it its rules; until then it is today's: the text, then its URL. */
function renderLink(url: string, children: PhrasingContent[], ctx: Ctx, key: number): ReactNode {
  const label = children.map(textOf).join("");
  return (
    <Fragment key={key}>
      {renderInline(children, ctx)}
      {label !== url && <span className="hh-md-url">{` (${url})`}</span>}
    </Fragment>
  );
}

/** An image (§3.2). Task 7 reads local files; until then its alt text. */
function renderImage(_url: string, alt: string, _ctx: Ctx, key: number): ReactNode {
  return (
    <span key={key} className="hh-md-alt">
      {alt}
    </span>
  );
}

/** A footnote reference. Task 6 numbers and links it; until then its label. */
function renderFootnoteReference(id: string, _ctx: Ctx, key: number): ReactNode {
  return <sup key={key}>{id}</sup>;
}

function renderHeading(n: Heading, ctx: Ctx, key: number): ReactNode {
  if (n.depth > 4) {
    return (
      <p key={key} className="hh-md-heading">
        <strong>{renderInline(n.children, ctx)}</strong>
      </p>
    );
  }
  return createElement(`h${n.depth}`, { key, id: `${ctx.prefix}${ctx.slug(textOf(n))}`, className: "hh-md-h", "data-heading": "" }, renderInline(n.children, ctx));
}

function renderList(n: List, ctx: Ctx, key: number): ReactNode {
  const items = n.children.map((item, j) => (
    <li key={j} className={item.checked === null || item.checked === undefined ? undefined : "hh-md-task"}>
      {typeof item.checked === "boolean" && <input type="checkbox" checked={item.checked} disabled readOnly />}
      {renderBlocks(item.children, ctx, !n.spread && !item.spread)}
    </li>
  ));
  if (n.ordered) {
    return (
      <ol key={key} className="hh-md-list" start={n.start === 1 || n.start === null || n.start === undefined ? undefined : n.start}>
        {items}
      </ol>
    );
  }
  return (
    <ul key={key} className="hh-md-list">
      {items}
    </ul>
  );
}

const alignClass = (a: Table["align"][number] | undefined): string | undefined =>
  a === "right" ? "hh-num" : a === "center" ? "hh-align-center" : undefined;

function renderTable(n: Table, ctx: Ctx, key: number): ReactNode {
  const [head, ...rows] = n.children;
  const align = n.align ?? [];
  return (
    <div key={key} className="hh-md-table" role="region" tabIndex={0} aria-label={ctx.t("reader.table")}>
      <table>
        {head && (
          <thead>
            <tr>
              {head.children.map((c, i) => (
                <th key={i} className={alignClass(align[i])}>
                  {renderInline(c.children, ctx)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r, j) => (
            <tr key={j}>
              {r.children.map((c, i) => (
                <td key={i} className={alignClass(align[i])}>
                  {renderInline(c.children, ctx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A fenced or indented code block. Task 8 highlights it and Task 9 draws Mermaid. */
function renderCode(n: Code, _ctx: Ctx, key: number, _caption?: string): ReactNode {
  return (
    <pre key={key} className="hh-md-code">
      <code>{n.value}</code>
    </pre>
  );
}

/** A blockquote. Task 6 turns callouts into boxes. */
function renderBlockquote(children: RootContent[], ctx: Ctx, key: number): ReactNode {
  return <blockquote key={key}>{renderBlocks(children, ctx)}</blockquote>;
}

function renderBlock(n: RootContent, ctx: Ctx, key: number, tight: boolean, caption?: string): ReactNode {
  switch (n.type) {
    case "paragraph":
      return tight ? <Fragment key={key}>{renderInline(n.children, ctx)}</Fragment> : <p key={key}>{renderInline(n.children, ctx)}</p>;
    case "heading":
      return renderHeading(n, ctx, key);
    case "list":
      return renderList(n, ctx, key);
    case "table":
      return renderTable(n, ctx, key);
    case "code":
      return renderCode(n, ctx, key, caption);
    case "blockquote":
      return renderBlockquote(n.children, ctx, key);
    case "thematicBreak":
      return <hr key={key} />;
    case "html":
      return (
        <p key={key} className="hh-md-raw">
          {n.value}
        </p>
      );
    // Definitions are drawn where they are used; footnote definitions at the end (Task 6).
    default:
      return null;
  }
}

/** Children of a block, in order. `tight`: a tight list item's paragraphs are drawn without `<p>`. */
function renderBlocks(nodes: RootContent[], ctx: Ctx, tight = false): ReactNode[] {
  return nodes.map((n, i) => renderBlock(n, ctx, i, tight));
}

function collectDefinitions(tree: Root): Map<string, Definition> {
  const out = new Map<string, Definition>();
  const walk = (node: Nodes) => {
    if (node.type === "definition" && !out.has(node.identifier)) out.set(node.identifier, node);
    if ("children" in node) for (const c of node.children as Nodes[]) walk(c);
  };
  walk(tree);
  return out;
}

export interface MarkdownProps {
  /** The Markdown text. */
  source: string;
  /** Each new word fades in (an answer arriving). */
  fade?: boolean;
  /** A document (the reader, or a harness view of a file): its front-matter is hidden and soft breaks are spaces. */
  document?: boolean;
  /** The document's path inside the folder: relative links and images resolve from its folder. */
  path?: string;
  /** Put before every id; default: one of this component's own (the reader passes ""). */
  idPrefix?: string;
}

/** Markdown as React elements (document-reader spec §3). */
export function Markdown({ source, fade = false, document = false, path = "", idPrefix }: MarkdownProps) {
  const { t } = useTranslation();
  const auto = useId();
  const prefix = idPrefix ?? `m${auto.replace(/[^A-Za-z0-9]/g, "")}-`;
  const text = document ? splitFrontMatter(source).body : source;
  const tree = useMemo(() => parseMarkdown(text), [text]);
  const ctx: Ctx = { fade, breaks: !document, prefix, slug: createSlugger(), source: text, base: path, definitions: collectDefinitions(tree), t };
  return <>{renderBlocks(tree.children, ctx)}</>;
}

/** A heading the reader's table of contents lists. */
export interface OutlineItem {
  depth: 2 | 3;
  text: string;
  id: string;
}

/**
 * The document's `##` and `###` headings with the ids `Markdown` gives them (empty prefix), its `##` texts for the
 * template check, and its front-matter. Ids are made in the same order as the renderer makes them.
 */
export function documentOutline(source: string): { front: Record<string, string>; outline: OutlineItem[]; sections: string[] } {
  const fm = splitFrontMatter(source);
  const slug = createSlugger();
  const outline: OutlineItem[] = [];
  const sections: string[] = [];
  const walk = (node: Nodes) => {
    if (node.type === "footnoteDefinition") return;
    if (node.type === "heading" && node.depth <= 4) {
      const text = textOf(node);
      const id = slug(text);
      if (node.depth === 2) sections.push(text);
      if (node.depth === 2 || node.depth === 3) outline.push({ depth: node.depth, text, id });
    }
    if ("children" in node) for (const c of (node as Parents).children as Nodes[]) walk(c);
  };
  walk(parseMarkdown(fm.body));
  return { front: fm.data, outline, sections };
}

export type { FootnoteDefinition };
```

(`FootnoteDefinition` is imported for Task 6; the re-export keeps the import used until then. Task 6 removes the re-export.)

- [ ] **Step 5: Use `source` in the chat**

In `packages/ui/src/Message.tsx`, change `<Markdown text={text} fade={fade} />` to `<Markdown source={text} fade={fade} />`.

- [ ] **Step 6: Strings and styles**

In `packages/i18n/src/locales/en.json`, add a top-level key (keep the file's key order; put it after `"mock"`):

```json
  "reader": {
    "table": "Table"
  },
```

In `packages/ui/src/styles.css`, after the existing `.hh-md-*` rules, add:

```css
.hh-md-h { font-family: var(--hh-display); line-height: 1.25; margin: 1.2em 0 0.4em; color: var(--hh-ink); scroll-margin-top: 16px; }
h1.hh-md-h { font-size: 1.6em; font-weight: 600; }
h2.hh-md-h { font-size: 1.3em; font-weight: 600; }
h3.hh-md-h { font-size: 1.1em; font-weight: 600; }
h4.hh-md-h { font-size: 1em; font-weight: 600; color: var(--hh-slate); }
.hh-message .hh-md-h:first-child { margin-top: 0; }
.hh-md-table { overflow-x: auto; max-width: 100%; margin: 0.8em 0; border: 1px solid var(--hh-line); border-radius: 8px; }
.hh-md-table table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 0.95em; }
.hh-md-table th, .hh-md-table td { padding: 6px 10px; border-bottom: 1px solid var(--hh-line); text-align: left; vertical-align: top; }
.hh-md-table thead th { position: sticky; top: 0; background: var(--hh-sheet); font-weight: 600; }
.hh-md-table tbody tr:last-child td { border-bottom: none; }
.hh-md-table .hh-num { text-align: right; font-variant-numeric: tabular-nums; }
.hh-md-table .hh-align-center { text-align: center; }
.hh-md-task { list-style: none; }
.hh-md-task > input { margin: 0 6px 0 -18px; vertical-align: middle; }
.hh-md-raw { white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; color: var(--hh-slate); }
.hh-md-alt { color: var(--hh-muted); font-style: italic; }
blockquote { margin: 0.8em 0; padding: 0 0 0 12px; border-left: 3px solid var(--hh-line-strong); color: var(--hh-slate); }
```

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/markdown.test.tsx`
Expected: PASS, including the unchanged tests for paragraphs (`First line<br>second line`), inline marks, code spans, lists (`three<br>continued`), numbered lists, fenced code (also unclosed), raw HTML, `markdownToPlain`, `Message` and citations. If the bullet-list test fails because `- `, `* ` and `+ ` now make three lists, the assertions still hold (three `ul > li`); if the continuation item comes out wrapped in `<p>`, check that `!n.spread && !item.spread` is passed as `tight`.

- [ ] **Step 8: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`. Expected: green.

```bash
git -C <worktree> add packages/ui/src/markdown.tsx packages/ui/src/markdown-plain.ts packages/ui/src/Message.tsx packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/ui/test/markdown.test.tsx
git -C <worktree> commit -m "feat(ui): rich Markdown renderer on remark — headings, tables, task lists"
```

---

### Task 6: Callouts, captions and footnotes

**Files:**
- Modify: `packages/ui/src/markdown.tsx`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/markdown.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `packages/ui/test/markdown.test.tsx`:

```tsx
describe("callouts, captions, footnotes (§3.2)", () => {
  it("draws each of the six callouts as a labelled box; the marker is gone", async () => {
    const src = ["NOTE", "TIP", "WARNING", "SUMMARY", "DECISION", "QUESTION"].map((c) => `> [!${c}]\n> Body of ${c.toLowerCase()}.`).join("\n\n");
    const { container } = await renderIn("en", <Markdown source={src} />);
    const boxes = [...container.querySelectorAll(".hh-callout")];
    expect(boxes.map((b) => b.className)).toEqual([
      "hh-callout hh-callout-note",
      "hh-callout hh-callout-tip",
      "hh-callout hh-callout-warning",
      "hh-callout hh-callout-summary",
      "hh-callout hh-callout-decision",
      "hh-callout hh-callout-question",
    ]);
    expect(boxes.map((b) => b.querySelector(".hh-callout-label")?.textContent)).toEqual(["Note", "Tip", "Warning", "Summary", "Decision", "Question"]);
    expect(boxes[0].getAttribute("role")).toBe("note");
    expect(container.textContent).not.toContain("[!");
    expect(boxes[3].textContent).toContain("Body of summary.");
  });

  it("is case-insensitive; an unknown marker stays a plain quote", async () => {
    const { container } = await renderIn("en", <Markdown source={"> [!note] lower\n\n> [!CAUTION]\n> GitHub has it, we do not"} />);
    expect(container.querySelectorAll(".hh-callout")).toHaveLength(1);
    expect(container.querySelector(".hh-callout")?.textContent).toContain("lower");
    expect(container.querySelector("blockquote")?.textContent).toContain("[!CAUTION]");
  });

  it("an italic paragraph right after a table is its caption; elsewhere it is plain", () => {
    const el = md("| a |\n|---|\n| 1 |\n\n*Costs per month*\n\n*Not a caption*");
    const ps = [...el.querySelectorAll("p")];
    expect(ps[0].className).toBe("hh-md-caption");
    expect(ps[1].className).toBe("");
  });

  it("footnotes: numbered references, a list at the end, links there and back", async () => {
    const { container } = await renderIn("en", <Markdown source={"First[^b] and second[^a].\n\n[^a]: Alpha.\n[^b]: Beta."} idPrefix="" />);
    const refs = [...container.querySelectorAll("sup a")];
    expect(refs.map((a) => [a.textContent, a.getAttribute("href"), a.id])).toEqual([
      ["1", "#fn-b", "fnref-b"],
      ["2", "#fn-a", "fnref-a"],
    ]);
    const items = [...container.querySelectorAll(".hh-md-footnotes li")];
    expect(items.map((li) => [li.id, li.textContent?.replace("↩", "").trim()])).toEqual([
      ["fn-b", "Beta."],
      ["fn-a", "Alpha."],
    ]);
    expect(items[0].querySelector("a.hh-md-back")?.getAttribute("href")).toBe("#fnref-b");
    expect(items[0].querySelector("a.hh-md-back")?.getAttribute("aria-label")).toBe("Back to the text");
  });

  it("a footnote never referenced is not listed", () => {
    expect(md("Text.\n\n[^x]: Lonely.").querySelector(".hh-md-footnotes")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/markdown.test.tsx`
Expected: FAIL (no `.hh-callout`, no caption class, footnotes drawn as their label).

- [ ] **Step 3: Implement**

In `packages/ui/src/markdown.tsx`:

1. Add to the imports: `import { CALLOUTS, type Callout } from "@humanharness/harness-sdk/documents";` (merge with the existing import from that path), and remove the trailing `export type { FootnoteDefinition };`.

2. Add to `Ctx`:

```ts
  /** Footnote ids in the order they are first referenced, and their definitions. */
  footnotes: { order: string[]; defs: Map<string, FootnoteDefinition> };
```

3. Replace `renderFootnoteReference` with:

```tsx
/** A footnote reference: its number by first use, linked to its note and back. */
function renderFootnoteReference(id: string, ctx: Ctx, key: number): ReactNode {
  if (!ctx.footnotes.defs.has(id)) return <Fragment key={key}>{`[^${id}]`}</Fragment>;
  let n = ctx.footnotes.order.indexOf(id);
  if (n < 0) n = ctx.footnotes.order.push(id) - 1;
  return (
    <sup key={key}>
      <a href={`#${ctx.prefix}fn-${id}`} id={`${ctx.prefix}fnref-${id}`} className="hh-md-fnref" onClick={(e) => jump(e, `${ctx.prefix}fn-${id}`)}>
        {n + 1}
      </a>
    </sup>
  );
}

/** Scrolls to an id inside the app (never a navigation). */
function jump(e: { preventDefault(): void }, id: string): void {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView?.({ block: "start" });
}

/** The notes at the end, in the order they were referenced. */
function renderFootnotes(ctx: Ctx): ReactNode {
  if (ctx.footnotes.order.length === 0) return null;
  return (
    <section className="hh-md-footnotes" aria-label={ctx.t("reader.footnotes")}>
      <ol>
        {ctx.footnotes.order.map((id) => {
          const def = ctx.footnotes.defs.get(id)!;
          // Headings inside a note get no id: the outline never lists them.
          const inner: Ctx = { ...ctx, slug: () => "" };
          return (
            <li key={id} id={`${ctx.prefix}fn-${id}`}>
              {renderBlocks(def.children, inner, true)}{" "}
              <a href={`#${ctx.prefix}fnref-${id}`} className="hh-md-back" aria-label={ctx.t("reader.backToText")} onClick={(e) => jump(e, `${ctx.prefix}fnref-${id}`)}>
                ↩
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
```

4. Replace `renderBlockquote` with:

```tsx
const CALLOUT_MARK = /^\[!([A-Za-z]+)\][ \t]*\n?/;

/** A blockquote, or a callout (§3.2) when its first paragraph starts with one of the six markers. */
function renderBlockquote(children: RootContent[], ctx: Ctx, key: number): ReactNode {
  const first = children[0];
  const lead = first?.type === "paragraph" ? first.children[0] : undefined;
  const mark = lead?.type === "text" ? CALLOUT_MARK.exec(lead.value) : null;
  const kind = mark?.[1].toLowerCase();
  if (!mark || !kind || !(CALLOUTS as readonly string[]).includes(kind)) return <blockquote key={key}>{renderBlocks(children, ctx)}</blockquote>;
  // The marker goes; the rest of the first paragraph stays (a callout may put text right after the marker).
  const rest = (lead as { value: string }).value.slice(mark[0].length);
  const firstRest = { ...first, children: [...(rest ? [{ ...lead!, value: rest }] : []), ...(first as { children: PhrasingContent[] }).children.slice(1)] } as RootContent;
  const body = (firstRest as { children: PhrasingContent[] }).children.length > 0 ? [firstRest, ...children.slice(1)] : children.slice(1);
  return (
    <div key={key} className={`hh-callout hh-callout-${kind}`} role="note">
      <p className="hh-callout-label">
        <CalloutIcon kind={kind as Callout} />
        {ctx.t(`reader.callout.${kind}`)}
      </p>
      {renderBlocks(body, ctx)}
    </div>
  );
}

/** A small line icon per callout, in the text colour (no colour of its own). */
function CalloutIcon({ kind }: { kind: Callout }) {
  const d: Record<Callout, string> = {
    note: "M12 8v5M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
    tip: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 3z",
    warning: "M12 9v4M12 17h.01M10.3 4l-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0z",
    summary: "M5 6h14M5 12h14M5 18h9",
    decision: "M5 12l4 4 10-10",
    question: "M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.1-1.3 2v.3M12 17h.01",
  };
  return (
    <svg className="hh-callout-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d[kind]} />
    </svg>
  );
}
```

5. Captions: replace `renderBlocks` with:

```tsx
/** An italic paragraph (one `emphasis` and nothing else) right after a table or a Mermaid diagram (§3.2). */
function isCaption(n: RootContent | undefined): n is Extract<RootContent, { type: "paragraph" }> {
  return n?.type === "paragraph" && n.children.length === 1 && n.children[0].type === "emphasis";
}
const captioned = (n: RootContent | undefined) => n?.type === "table" || (n?.type === "code" && n.lang?.toLowerCase() === "mermaid");

/** Children of a block, in order. `tight`: a tight list item's paragraphs are drawn without `<p>`. */
function renderBlocks(nodes: RootContent[], ctx: Ctx, tight = false): ReactNode[] {
  return nodes.map((n, i) => {
    if (isCaption(n) && captioned(nodes[i - 1])) {
      return (
        <p key={i} className="hh-md-caption">
          {renderInline(n.children[0].type === "emphasis" ? n.children[0].children : [], ctx)}
        </p>
      );
    }
    const next = nodes[i + 1];
    return renderBlock(n, ctx, i, tight, captioned(n) && isCaption(next) ? textOf(next) : undefined);
  });
}
```

6. In `Markdown`, collect the footnote definitions and draw the notes:

```tsx
  const footnotes = { order: [] as string[], defs: collectFootnotes(tree) };
  const ctx: Ctx = { fade, breaks: !document, prefix, slug: createSlugger(), source: text, base: path, definitions: collectDefinitions(tree), footnotes, t };
  const body = renderBlocks(tree.children, ctx);
  return (
    <>
      {body}
      {renderFootnotes(ctx)}
    </>
  );
```

and add next to `collectDefinitions`:

```ts
function collectFootnotes(tree: Root): Map<string, FootnoteDefinition> {
  const out = new Map<string, FootnoteDefinition>();
  for (const n of tree.children) if (n.type === "footnoteDefinition" && !out.has(n.identifier)) out.set(n.identifier, n);
  return out;
}
```

(The body is drawn before the notes, so `order` is complete when `renderFootnotes` runs: references inside a note that point to a later note are numbered as they are met.)

- [ ] **Step 4: Strings and styles**

In `en.json` under `reader`:

```json
    "footnotes": "Footnotes",
    "backToText": "Back to the text",
    "callout": {
      "note": "Note",
      "tip": "Tip",
      "warning": "Warning",
      "summary": "Summary",
      "decision": "Decision",
      "question": "Question"
    },
```

In `styles.css`, add the callout tokens to the light `:root` block:

```css
  --hh-callout-note: #e8eef8;
  --hh-callout-tip: #e7f3ec;
  --hh-callout-warning: #fbefe3;
  --hh-callout-summary: #efedf8;
  --hh-callout-decision: #e6f2f1;
  --hh-callout-question: #fbf3dc;
```

and to the dark block:

```css
    --hh-callout-note: #1f2a3a;
    --hh-callout-tip: #1e3026;
    --hh-callout-warning: #3a2a1c;
    --hh-callout-summary: #29253a;
    --hh-callout-decision: #1c302e;
    --hh-callout-question: #3a321c;
```

and the rules:

```css
.hh-callout { margin: 0.8em 0; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--hh-line); }
.hh-callout > :last-child { margin-bottom: 0; }
.hh-callout-label { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--hh-slate); }
.hh-callout-note { background: var(--hh-callout-note); }
.hh-callout-tip { background: var(--hh-callout-tip); }
.hh-callout-warning { background: var(--hh-callout-warning); }
.hh-callout-warning .hh-callout-label { color: var(--hh-warn); }
.hh-callout-summary { background: var(--hh-callout-summary); }
.hh-callout-decision { background: var(--hh-callout-decision); }
.hh-callout-question { background: var(--hh-callout-question); }
.hh-md-caption { margin: -0.3em 0 1em; font-size: 0.9em; color: var(--hh-muted); text-align: center; }
.hh-md-footnotes { margin-top: 2em; padding-top: 0.6em; border-top: 1px solid var(--hh-line); font-size: 0.9em; color: var(--hh-slate); }
.hh-md-footnotes a.hh-md-back { text-decoration: none; }
```

`packages/ui/test/styles.test.ts` may check that every `--hh-*` token is defined in both blocks; run it.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/markdown.test.tsx packages/ui/test/styles.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`. Expected: green.

```bash
git -C <worktree> add packages/ui/src/markdown.tsx packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/ui/test/markdown.test.tsx
git -C <worktree> commit -m "feat(ui): callouts, captions and footnotes"
```

---

### Task 7: Links and local images

**Files:**
- Create: `packages/ui/src/doc-links.ts`, `packages/ui/src/documents-context.ts`
- Modify: `packages/ui/src/markdown.tsx`, `packages/ui/src/styles.css`
- Test: `packages/ui/test/doc-links.test.ts`, `packages/ui/test/markdown.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/doc-links.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { imageTarget, joinPath, linkTarget } from "../src/doc-links";

describe("joinPath", () => {
  it("resolves against the document's folder", () => {
    expect(joinPath("docs/adr/a.md", "b.md")).toBe("docs/adr/b.md");
    expect(joinPath("docs/adr/a.md", "../notes/./x.md")).toBe("docs/notes/x.md");
    expect(joinPath("", "x.md")).toBe("x.md");
    expect(joinPath("a.md", "../../up.md")).toBe("../../up.md");
  });
});

describe("linkTarget (§3.4)", () => {
  it("a relative .md opens in the reader, at its anchor", () => {
    expect(linkTarget("adr-007.md", "docs/a.md")).toEqual({ kind: "doc", path: "docs/adr-007.md" });
    expect(linkTarget("../notes/x.MD#context", "docs/a.md")).toEqual({ kind: "doc", path: "notes/x.MD", anchor: "context" });
    expect(linkTarget("my%20doc.md", "")).toEqual({ kind: "doc", path: "my doc.md" });
  });
  it("#anchor scrolls within the document", () => {
    expect(linkTarget("#risks", "a.md")).toEqual({ kind: "anchor", id: "risks" });
    expect(linkTarget("#", "a.md")).toEqual({ kind: "text" });
  });
  it("http(s) goes to the browser, with its domain", () => {
    expect(linkTarget("https://Example.com/x?y=1", "")).toEqual({ kind: "external", url: "https://example.com/x?y=1", domain: "example.com" });
    expect(linkTarget("HTTP://a.org", "")).toMatchObject({ kind: "external", domain: "a.org" });
  });
  it("any other scheme, protocol-relative, a non-.md path or junk is text", () => {
    for (const href of ["javascript:alert(1)", "file:///etc/passwd", "mailto:a@b.c", "//evil.com/x.md", "src/a.ts", "data:text/html,x", "", "   ", "https://"]) {
      expect(linkTarget(href, "")).toEqual({ kind: "text" });
    }
  });
});

describe("imageTarget", () => {
  it("local, remote or nothing", () => {
    expect(imageTarget("img/a.png", "docs/x.md")).toEqual({ kind: "local", path: "docs/img/a.png" });
    expect(imageTarget("https://cdn.x.com/a.png", "")).toEqual({ kind: "remote", url: "https://cdn.x.com/a.png", domain: "cdn.x.com" });
    expect(imageTarget("data:image/png;base64,AAA", "")).toEqual({ kind: "none" });
    expect(imageTarget("file:///a.png", "")).toEqual({ kind: "none" });
  });
});
```

Add to `packages/ui/test/markdown.test.tsx` (import `DocumentContext` from `../src/documents-context`, and `vi` from `vitest`):

```tsx
describe("links and images (§3.4)", () => {
  const host = (over: Partial<{ open: (p: string, a?: string) => void; image: (p: string) => Promise<string | null> }> = {}) => ({
    open: vi.fn(),
    image: vi.fn(async () => null),
    ...over,
  });

  it("an external link opens in the browser (target _blank) and shows its domain", () => {
    const el = md("See [the docs](https://example.com/x).");
    const a = el.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.com/x");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noreferrer noopener");
    expect(el.textContent).toBe("See the docs (example.com).");
  });

  it("a bare URL is a link too", () => {
    expect(md("Go to https://example.com now").querySelector("a")?.getAttribute("href")).toBe("https://example.com/");
  });

  it("other schemes are plain text with their URL, as before", () => {
    const el = md("[js](javascript:alert(1)) and [f](file:///etc/passwd)");
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toBe("js (javascript:alert(1)) and f (file:///etc/passwd)");
  });

  it("a relative .md opens the reader through the context, resolved from the document", () => {
    const h = host();
    const { container } = render(
      <DocumentContext.Provider value={h}>
        <Markdown source="Read [ADR 7](../adr/007.md#context)." path="docs/notes/a.md" document />
      </DocumentContext.Provider>,
    );
    fireEvent.click(container.querySelector("a")!);
    expect(h.open).toHaveBeenCalledWith("docs/adr/007.md", "context");
  });

  it("without a context a .md link is plain text", () => {
    const el = md("[ADR](adr.md)");
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toBe("ADR (adr.md)");
  });

  it("#anchor scrolls to the heading with this text's prefix", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { container } = render(<Markdown source={"[Risks](#risks)\n\n## Risks"} idPrefix="p-" />);
    fireEvent.click(container.querySelector("a")!);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(container.querySelector("#p-risks")).not.toBeNull();
  });

  it("a local image is read through the context; a refusal shows its alt text", async () => {
    const h = host({ image: vi.fn(async (p: string) => (p === "docs/a.png" ? "data:image/png;base64,AAA" : null)) });
    render(
      <DocumentContext.Provider value={h}>
        <Markdown source={"![Chart](a.png) ![Gone](b.png)"} path="docs/x.md" document />
      </DocumentContext.Provider>,
    );
    expect((await screen.findByRole("img", { name: "Chart" })).getAttribute("src")).toBe("data:image/png;base64,AAA");
    expect(await screen.findByText("Gone")).toBeTruthy();
  });

  it("a remote image is a link with its domain, never loaded", () => {
    const el = md("![Logo](https://cdn.x.com/l.png)");
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://cdn.x.com/l.png");
    expect(el.textContent).toBe("Logo (cdn.x.com)");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/doc-links.test.ts packages/ui/test/markdown.test.tsx`
Expected: FAIL (missing modules; links still text).

- [ ] **Step 3: Write the rules**

Create `packages/ui/src/doc-links.ts`:

```ts
import { isMarkdownPath } from "@humanharness/harness-sdk/documents";

/** Where a link goes (document-reader spec §3.4). */
export type LinkTarget =
  | { kind: "doc"; path: string; anchor?: string }
  | { kind: "anchor"; id: string }
  | { kind: "external"; url: string; domain: string }
  | { kind: "text" };

export type ImageTarget = { kind: "local"; path: string } | { kind: "remote"; url: string; domain: string } | { kind: "none" };

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** `rel` resolved against the folder of `base` (a file path inside the folder; "" for the folder itself). */
export function joinPath(base: string, rel: string): string {
  if (rel.startsWith("/")) return rel;
  const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
  const out: string[] = [];
  for (const part of [...dir.split("/"), ...rel.split("/")]) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function web(href: string): { url: string; domain: string } | null {
  try {
    const u = new URL(href);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname ? { url: u.href, domain: u.hostname } : null;
  } catch {
    return null;
  }
}

export function linkTarget(href: string, base: string): LinkTarget {
  const h = href.trim();
  if (!h || h.startsWith("//")) return { kind: "text" };
  if (h.startsWith("#")) return h.length > 1 ? { kind: "anchor", id: decode(h.slice(1)) } : { kind: "text" };
  const scheme = SCHEME.exec(h);
  if (scheme) {
    if (!/^https?$/i.test(scheme[1])) return { kind: "text" };
    const w = web(h);
    return w ? { kind: "external", ...w } : { kind: "text" };
  }
  const hash = h.indexOf("#");
  const file = decode((hash < 0 ? h : h.slice(0, hash)).split("?")[0]);
  const anchor = hash < 0 ? "" : decode(h.slice(hash + 1));
  if (!isMarkdownPath(file)) return { kind: "text" };
  return { kind: "doc", path: joinPath(base, file), ...(anchor ? { anchor } : {}) };
}

export function imageTarget(src: string, base: string): ImageTarget {
  const s = src.trim();
  if (!s || s.startsWith("//")) return { kind: "none" };
  const scheme = SCHEME.exec(s);
  if (scheme) {
    const w = /^https?$/i.test(scheme[1]) ? web(s) : null;
    return w ? { kind: "remote", ...w } : { kind: "none" };
  }
  return { kind: "local", path: joinPath(base, decode(s.split(/[?#]/)[0])) };
}
```

Create `packages/ui/src/documents-context.ts`:

```ts
import { createContext } from "react";
import type { DocumentKind } from "@humanharness/harness-sdk/documents";

/** What Markdown needs from the window to open documents and read images (document-reader spec §3.4, §5.1). */
export interface DocumentHost {
  /** Opens a document (a path inside the folder) in the reader, at `anchor` when given. */
  open(path: string, anchor?: string): void;
  /** A local image as a data: URL; null when refused or missing. */
  image(path: string): Promise<string | null>;
  /** The harness's document kinds (manifest `documents.kinds`); absent without them (D0). */
  kinds?: Record<string, DocumentKind>;
}

/** Null outside the chat: `.md` links are plain text and local images show their alt text. */
export const DocumentContext = createContext<DocumentHost | null>(null);
```

- [ ] **Step 4: Draw links and images**

In `packages/ui/src/markdown.tsx`:
- import `{ imageTarget, linkTarget } from "./doc-links"` and `{ DocumentContext, type DocumentHost } from "./documents-context"`;
- add `host: DocumentHost | null;` to `Ctx`, and in `Markdown` read `const host = useContext(DocumentContext);` and pass `host` into `ctx`;
- replace `renderLink` and `renderImage` with:

```tsx
/** A link (§3.4): a document in the reader, an anchor, the browser for http(s), plain text for anything else. */
function renderLink(url: string, children: PhrasingContent[], ctx: Ctx, key: number): ReactNode {
  const label = renderInline(children, ctx);
  const target = linkTarget(url, ctx.base);
  if (target.kind === "external") {
    return (
      <Fragment key={key}>
        <a href={target.url} target="_blank" rel="noreferrer noopener" className="hh-md-link">
          {label}
        </a>
        <span className="hh-md-domain">{` (${target.domain})`}</span>
      </Fragment>
    );
  }
  if (target.kind === "doc" && ctx.host) {
    const host = ctx.host;
    return (
      <a
        key={key}
        href={url}
        className="hh-md-link hh-md-doclink"
        onClick={(e) => {
          e.preventDefault();
          host.open(target.path, target.anchor);
        }}
      >
        {label}
      </a>
    );
  }
  if (target.kind === "anchor") {
    const id = `${ctx.prefix}${target.id}`;
    return (
      <a key={key} href={`#${id}`} className="hh-md-link" onClick={(e) => jump(e, id)}>
        {label}
      </a>
    );
  }
  const text = children.map(textOf).join("");
  return (
    <Fragment key={key}>
      {label}
      {text !== url && <span className="hh-md-url">{` (${url})`}</span>}
    </Fragment>
  );
}

/** An image (§3.2): only local files, read by the main process; a remote one is a link with its domain. */
function renderImage(url: string, alt: string, ctx: Ctx, key: number): ReactNode {
  const target = imageTarget(url, ctx.base);
  if (target.kind === "remote") {
    return (
      <Fragment key={key}>
        <a href={target.url} target="_blank" rel="noreferrer noopener" className="hh-md-link">
          {alt || target.url}
        </a>
        <span className="hh-md-domain">{` (${target.domain})`}</span>
      </Fragment>
    );
  }
  if (target.kind === "local" && ctx.host) return <LocalImage key={key} path={target.path} alt={alt} host={ctx.host} />;
  return (
    <span key={key} className="hh-md-alt">
      {alt}
    </span>
  );
}

function LocalImage({ path, alt, host }: { path: string; alt: string; host: DocumentHost }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    host.image(path).then(
      (s) => live && setSrc(s),
      () => live && setSrc(null),
    );
    return () => {
      live = false;
    };
  }, [host, path]);
  if (!src) return <span className="hh-md-alt">{alt}</span>;
  return <img className="hh-md-img" src={src} alt={alt} />;
}
```

(`jump` is the helper Task 6 added.)

- [ ] **Step 5: Styles**

```css
.hh-md-link { color: var(--hh-ink); text-decoration: underline; text-decoration-color: var(--hh-line-strong); text-underline-offset: 2px; }
.hh-md-link:hover { text-decoration-color: var(--hh-ink); }
.hh-md-domain, .hh-md-url { color: var(--hh-muted); font-size: 0.9em; }
.hh-md-img { max-width: 100%; height: auto; border-radius: 6px; }
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/doc-links.test.ts packages/ui/test/markdown.test.tsx`
Expected: PASS. The old raw-HTML test still passes (the `<a href="https://x">` there is HTML, shown as text, never a link).

- [ ] **Step 7: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`. Expected: green.

```bash
git -C <worktree> add packages/ui/src/doc-links.ts packages/ui/src/documents-context.ts packages/ui/src/markdown.tsx packages/ui/src/styles.css packages/ui/test/doc-links.test.ts packages/ui/test/markdown.test.tsx
git -C <worktree> commit -m "feat(ui): clickable links by rule, local images only"
```

---

### Task 8: Highlighted code with a label and Copy

**Files:**
- Create: `packages/ui/src/highlight.ts`
- Modify: `packages/ui/src/markdown.tsx`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`, `packages/ui/package.json`
- Test: `packages/ui/test/markdown.test.tsx`

- [ ] **Step 1: Add the hast types**

Run: `corepack pnpm --filter @humanharness/ui add -D @types/hast`

- [ ] **Step 2: Write the failing tests**

Add to `packages/ui/test/markdown.test.tsx`:

```tsx
describe("code blocks (§3.2)", () => {
  it("highlights a known language from a tree of spans, with its label and Copy", async () => {
    const write = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText: write } });
    const { container } = await renderIn("en", <Markdown source={"```ts\nconst a = 1;\n```"} />);
    expect(container.querySelector("pre > code")?.textContent).toBe("const a = 1;");
    expect(container.querySelector("pre span.hljs-keyword")?.textContent).toBe("const");
    expect(container.querySelector(".hh-md-codelabel")?.textContent).toBe("ts");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(write).toHaveBeenCalledWith("const a = 1;");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("a title in the info string is the label; an unknown language stays plain text", async () => {
    const { container } = await renderIn("en", <Markdown source={'```cobol title="src/pay.cbl"\nMOVE A TO B.\n```'} />);
    expect(container.querySelector(".hh-md-codelabel")?.textContent).toBe("src/pay.cbl");
    expect(container.querySelector("pre span")).toBeNull();
  });

  it("HTML inside highlighted code stays text", async () => {
    const { container } = await renderIn("en", <Markdown source={"```html\n<img src=x onerror=alert(1)>\n```"} />);
    expect(container.querySelector("pre img")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/markdown.test.tsx`
Expected: FAIL (no spans, no label, no Copy).

- [ ] **Step 4: Write the highlighter**

Create `packages/ui/src/highlight.ts`:

```ts
import { type ReactNode, createElement } from "react";
import type { ElementContent, RootContent } from "hast";
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/** A fixed set of common languages (document-reader spec §3.2). Anything else is plain text. */
const low = createLowlight({ bash, css, diff, go, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml });
low.registerAlias({
  bash: ["sh", "shell", "zsh"],
  javascript: ["js", "jsx", "mjs", "cjs"],
  typescript: ["ts", "tsx"],
  xml: ["html"],
  yaml: ["yml"],
  markdown: ["md"],
  python: ["py"],
  rust: ["rs"],
});

function draw(node: RootContent | ElementContent, key: number): ReactNode {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return null;
  // lowlight only makes <span class="hljs-…">: anything else is drawn as its text.
  const cls = node.properties?.className;
  const className = Array.isArray(cls) ? cls.filter((c): c is string => typeof c === "string" && c.startsWith("hljs")).join(" ") : undefined;
  return createElement("span", { key, className: className || undefined }, node.children.map((c, i) => draw(c, i)));
}

/** `code` as highlighted spans, or null when the language is not in the set. Never an HTML string. */
export function highlightCode(lang: string | null | undefined, code: string): ReactNode[] | null {
  if (!lang || !low.registered(lang.toLowerCase())) return null;
  return low.highlight(lang.toLowerCase(), code).children.map((c, i) => draw(c, i));
}
```

- [ ] **Step 5: Draw the block**

In `packages/ui/src/markdown.tsx`, import `{ highlightCode } from "./highlight"` and replace `renderCode` with:

```tsx
/** The label of a code block: `title="…"` in its info string, else its language. */
function codeLabel(n: Code): string | null {
  const title = n.meta ? /title="([^"]+)"/.exec(n.meta)?.[1] : undefined;
  return title ?? n.lang ?? null;
}

function CodeBlock({ node }: { node: Code }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const highlighted = useMemo(() => highlightCode(node.lang, node.value), [node.lang, node.value]);
  const label = codeLabel(node);
  return (
    <div className="hh-md-codeblock">
      <div className="hh-md-codebar">
        {label && <span className="hh-md-codelabel">{label}</span>}
        <button
          type="button"
          className="hh-md-copy"
          onClick={() =>
            void navigator.clipboard?.writeText(node.value).then(
              () => setCopied(true),
              () => undefined,
            )
          }
        >
          {copied ? t("reader.copied") : t("reader.copy")}
        </button>
      </div>
      <pre className="hh-md-code">
        <code>{highlighted ?? node.value}</code>
      </pre>
    </div>
  );
}

/** A fenced or indented code block. Task 9 draws Mermaid. */
function renderCode(n: Code, _ctx: Ctx, key: number, _caption?: string): ReactNode {
  return <CodeBlock key={key} node={n} />;
}
```

- [ ] **Step 6: Strings and styles**

`en.json` under `reader`: `"copy": "Copy", "copied": "Copied",`.

```css
.hh-md-codeblock { margin: 0.8em 0; border: 1px solid var(--hh-line); border-radius: 8px; overflow: hidden; background: var(--hh-sheet); }
.hh-md-codebar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 4px 6px 4px 12px; border-bottom: 1px solid var(--hh-line); }
.hh-md-codelabel { margin-right: auto; font-size: 12px; color: var(--hh-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.hh-md-copy { height: 22px; padding: 0 8px; font-size: 12px; }
.hh-md-codeblock .hh-md-code { margin: 0; border: none; border-radius: 0; }
.hljs-keyword, .hljs-built_in, .hljs-type, .hljs-selector-tag { color: var(--hh-ink); font-weight: 600; }
.hljs-string, .hljs-attr, .hljs-template-tag, .hljs-addition { color: var(--hh-ok); }
.hljs-number, .hljs-literal, .hljs-symbol { color: var(--hh-warn); }
.hljs-comment, .hljs-quote, .hljs-meta, .hljs-deletion { color: var(--hh-muted); font-style: italic; }
.hljs-title, .hljs-section, .hljs-name { color: var(--hh-slate); font-weight: 600; }
```

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/markdown.test.tsx`
Expected: PASS. The old test "renders fenced code blocks verbatim" still passes (`pre > code` text is the same; `pre strong, pre b` stays null since spans are the only elements).

- [ ] **Step 8: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`. Expected: green.

```bash
git -C <worktree> add packages/ui/src/highlight.ts packages/ui/src/markdown.tsx packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/ui/package.json pnpm-lock.yaml packages/ui/test/markdown.test.tsx
git -C <worktree> commit -m "feat(ui): highlighted code with label and Copy"
```

---

### Task 9: Mermaid, lazy and strict

**Files:**
- Create: `packages/ui/src/mermaid-loader.ts`, `packages/ui/src/MermaidDiagram.tsx`
- Modify: `packages/ui/src/markdown.tsx`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/mermaid.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/mermaid.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Markdown, parseMarkdown } from "../src/markdown";
import { fenceClosed, mermaidWhy } from "../src/mermaid-loader";
import { renderIn } from "./render";

const m = vi.hoisted(() => ({
  loads: 0,
  initialize: vi.fn(),
  parse: vi.fn(async (code: string) => {
    if (code.includes("broken")) throw new Error("Parse error on line 3:\n...A --> \n-------^\nExpecting 'NODE', got 'EOF'");
    return true;
  }),
  render: vi.fn(async (_id: string, code: string) => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${code.length}</text></svg>` })),
}));
vi.mock("mermaid", () => {
  m.loads++;
  return { default: { initialize: m.initialize, parse: m.parse, render: m.render } };
});

afterEach(cleanup);

describe("Mermaid (§3.3)", () => {
  it("a chat without diagrams never loads Mermaid", async () => {
    await renderIn("en", <Markdown source={"# Hi\n\n```ts\nx\n```"} />);
    expect(m.loads).toBe(0);
  });

  it("draws a closed diagram as an image, strict, with the app's colours; Source shows the code", async () => {
    await renderIn("en", <Markdown source={"```mermaid\nflowchart LR\n  A --> B\n```\n\n*The flow*"} />);
    const img = await screen.findByRole("img", { name: "The flow" });
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(m.loads).toBe(1);
    expect(m.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict", startOnLoad: false, theme: "base" }));
    expect(m.initialize.mock.calls[0][0].flowchart).toEqual({ htmlLabels: false });
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByText(/A --> B/)).toBeTruthy();
  });

  it("while streaming, an unclosed fence shows its source and is not drawn", async () => {
    m.render.mockClear();
    const { container } = await renderIn("en", <Markdown source={"```mermaid\nflowchart LR\n  A --> B"} fade />);
    expect(container.querySelector("pre")?.textContent).toContain("A --> B");
    expect(m.render).not.toHaveBeenCalled();
  });

  it("a diagram that fails to parse shows its source with one line above it", async () => {
    await renderIn("en", <Markdown source={"```mermaid\nflowchart LR\n  broken\n```"} />);
    expect(await screen.findByText("This diagram could not be drawn (line 3: Expecting 'NODE', got 'EOF'). Showing its source.")).toBeTruthy();
    expect(screen.getByText(/broken/)).toBeTruthy();
  });
});

describe("fenceClosed", () => {
  const code = (src: string) => {
    const tree = parseMarkdown(src);
    const node = tree.children.find((n) => n.type === "code")!;
    return fenceClosed(src, node as never);
  };
  it("closed, unclosed, longer close, inside a quote", () => {
    expect(code("```mermaid\na\n```")).toBe(true);
    expect(code("```mermaid\na")).toBe(false);
    expect(code("```mermaid\n")).toBe(false);
    expect(code("````mermaid\na\n```")).toBe(false);
    expect(code("~~~mermaid\na\n~~~~")).toBe(true);
    expect(code("> ```mermaid\n> a\n> ```")).toBe(true);
  });
});

describe("mermaidWhy", () => {
  it("the line and the last line of the message", () => {
    expect(mermaidWhy(new Error("Parse error on line 3:\nx\nExpecting 'A'"))).toBe("line 3: Expecting 'A'");
    expect(mermaidWhy("Lexical error")).toBe("Lexical error");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/mermaid.test.tsx`
Expected: FAIL (missing modules).

- [ ] **Step 3: Write the loader**

Create `packages/ui/src/mermaid-loader.ts`:

```ts
import type { Code } from "mdast";

type Mermaid = (typeof import("mermaid"))["default"];

let loading: Promise<Mermaid> | null = null;

/** Mermaid is loaded the first time a diagram is drawn (§3.3): a chat without diagrams pays nothing. */
function loadMermaid(): Promise<Mermaid> {
  loading ??= import("mermaid").then((m) => m.default);
  return loading;
}

export type Drawn = { ok: true; svg: string } | { ok: false; why: string };

let queue: Promise<unknown> = Promise.resolve();
let count = 0;

/** One draw at a time (Mermaid keeps global state): strict, no HTML labels, the app's colours. */
export function drawMermaid(code: string, themeVariables: Record<string, string>): Promise<Drawn> {
  const run = queue.then(async (): Promise<Drawn> => {
    const mermaid = await loadMermaid();
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables, flowchart: { htmlLabels: false } });
    try {
      await mermaid.parse(code);
      const { svg } = await mermaid.render(`hh-mermaid-${++count}`, code);
      return { ok: true, svg };
    } catch (err) {
      return { ok: false, why: mermaidWhy(err) };
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

/** "line 3: <the message's last line>", or the message's last line. */
export function mermaidWhy(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lines = msg.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines.at(-1) ?? "";
  const detail = last.length > 80 ? `${last.slice(0, 79)}…` : last;
  const line = /line (\d+)/i.exec(msg)?.[1];
  return line ? `line ${line}: ${/^parse error on line/i.test(detail) ? "…" : detail}` : detail || "unknown error";
}

/** Whether a fenced code block's closing fence has arrived (an answer may still be streaming). */
export function fenceClosed(source: string, node: Code): boolean {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return true;
  const lines = source.slice(start, end).split("\n");
  const open = /^[ \t>]*(`{3,}|~{3,})/.exec(lines[0]);
  if (!open) return true;
  if (lines.length < 2) return false;
  const last = lines[lines.length - 1].replace(/^[ \t>]*/, "");
  const char = open[1][0] === "`" ? "`" : "~";
  return new RegExp(`^${char}{${open[1].length},}\\s*$`).test(last);
}
```

Create `packages/ui/src/MermaidDiagram.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Drawn, drawMermaid } from "./mermaid-loader";

/** The app's colours for Mermaid's `base` theme, read from the tokens when the diagram is drawn. */
function themeVariables(): Record<string, string> {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  const vars: Record<string, string> = {
    background: v("--hh-surface"),
    primaryColor: v("--hh-sheet"),
    primaryTextColor: v("--hh-ink"),
    primaryBorderColor: v("--hh-slate"),
    secondaryColor: v("--hh-segment"),
    tertiaryColor: v("--hh-paper"),
    lineColor: v("--hh-slate"),
    textColor: v("--hh-ink"),
    fontFamily: v("--hh-font"),
  };
  return Object.fromEntries(Object.entries(vars).filter(([, x]) => x));
}

/** "light" or "dark", following the system (the app sets nativeTheme from Settings › Appearance). */
function useScheme(): string {
  const query = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;
  const [dark, setDark] = useState(Boolean(query?.matches));
  useEffect(() => {
    if (!query) return;
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    query.addEventListener?.("change", on);
    return () => query.removeEventListener?.("change", on);
  }, [query]);
  return dark ? "dark" : "light";
}

/** A ```mermaid block (§3.3): its source while the fence is open, else the drawing, or its source and why it failed. */
export function MermaidDiagram({ code, closed, caption }: { code: string; closed: boolean; caption?: string }) {
  const { t } = useTranslation();
  const scheme = useScheme();
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [source, setSource] = useState(false);
  useEffect(() => {
    if (!closed) return;
    let live = true;
    setDrawn(null);
    drawMermaid(code, themeVariables()).then((d) => live && setDrawn(d));
    return () => {
      live = false;
    };
  }, [code, closed, scheme]);
  const sourceBlock = (
    <pre className="hh-md-code">
      <code>{code}</code>
    </pre>
  );
  if (!closed) return sourceBlock;
  if (drawn && !drawn.ok) {
    return (
      <div className="hh-md-diagram hh-md-diagram-failed">
        <p className="hh-md-diagram-error" role="note">
          {t("reader.diagramFailed", { why: drawn.why })}
        </p>
        {sourceBlock}
      </div>
    );
  }
  return (
    <figure className="hh-md-diagram">
      <div className="hh-md-diagram-bar">
        <button type="button" aria-pressed={source} onClick={() => setSource((s) => !s)}>
          {t("reader.source")}
        </button>
      </div>
      {source ? (
        sourceBlock
      ) : drawn ? (
        <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawn.svg)}`} alt={caption || t("reader.diagram")} />
      ) : (
        <p className="hh-caption" role="status">
          {t("reader.drawing")}
        </p>
      )}
    </figure>
  );
}
```

If `tsc` refuses `typeof import("mermaid")` in a type position under the repo's settings, use `type Mermaid = { initialize(c: object): void; parse(code: string): Promise<unknown>; render(id: string, code: string): Promise<{ svg: string }> };` instead (the three calls the loader makes).

- [ ] **Step 4: Use it for ```mermaid**

In `packages/ui/src/markdown.tsx`, import `{ MermaidDiagram } from "./MermaidDiagram"` and `{ fenceClosed } from "./mermaid-loader"`, and replace `renderCode` with:

```tsx
/** A fenced or indented code block; ```mermaid is a diagram (§3.3). */
function renderCode(n: Code, ctx: Ctx, key: number, caption?: string): ReactNode {
  if (n.lang?.toLowerCase() === "mermaid") return <MermaidDiagram key={key} code={n.value} closed={fenceClosed(ctx.source, n)} caption={caption} />;
  return <CodeBlock key={key} node={n} />;
}
```

- [ ] **Step 5: Strings and styles**

`en.json` under `reader`:

```json
    "source": "Source",
    "diagram": "Diagram",
    "drawing": "Drawing the diagram…",
    "diagramFailed": "This diagram could not be drawn ({{why}}). Showing its source.",
```

```css
.hh-md-diagram { margin: 0.8em 0; padding: 8px; border: 1px solid var(--hh-line); border-radius: 8px; background: var(--hh-surface); }
.hh-md-diagram img { display: block; max-width: 100%; height: auto; margin: 0 auto; }
.hh-md-diagram-bar { display: flex; justify-content: flex-end; }
.hh-md-diagram-bar button { height: 22px; padding: 0 8px; font-size: 12px; }
.hh-md-diagram-bar button[aria-pressed="true"] { background: var(--hh-segment); }
.hh-md-diagram-error { margin: 0 0 6px; font-size: 13px; color: var(--hh-warn); }
.hh-md-diagram-failed { background: transparent; }
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/mermaid.test.tsx packages/ui/test/markdown.test.tsx`
Expected: PASS.

- [ ] **Step 7: Build and check it in the real window**

Run: `corepack pnpm app:build`. Expected: the renderer build emits a separate chunk for Mermaid (`ls packages/shell/out/renderer/assets | grep -i mermaid` lists files).
Manual check (record the result in the commit body): `corepack pnpm app:dev`, ask a free question in mock mode or paste a recording turn whose text holds a ```mermaid flowchart; the diagram draws, the console shows no Content-Security-Policy error, switching Settings › Appearance redraws it in dark colours. If the CSP blocks something Mermaid needs, stop and report: do not loosen the CSP in this plan.

- [ ] **Step 8: Typecheck, test, commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`. Expected: green.

```bash
git -C <worktree> add packages/ui/src/mermaid-loader.ts packages/ui/src/MermaidDiagram.tsx packages/ui/src/markdown.tsx packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/ui/test/mermaid.test.tsx
git -C <worktree> commit -m "feat(ui): Mermaid diagrams, lazy, strict, drawn as images"
```

---
### Task 10: Main process — reading documents safely

**Files:**
- Create: `packages/shell/src/main/documents.ts`
- Modify: `packages/shell/src/main/open-path.ts` (export `stillSafe`)
- Modify: `packages/ui/src/client.ts` (the `DocumentRead` type only)
- Test: `packages/shell/test/documents.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shell/test/documents.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DocumentWatchers, MAX_DOCUMENT_BYTES, documentsExist, locate, readDocument, readImage } from "../src/main/documents";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-docs-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const folder = path.join(root, "work");
const ref = path.join(root, "ref");
const outside = path.join(root, "outside");
for (const d of [path.join(folder, "docs"), path.join(ref, "guides"), outside]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(folder, "docs", "plan.md"), "# Plan\n");
fs.writeFileSync(path.join(folder, "docs", "notes.txt"), "x");
fs.writeFileSync(path.join(ref, "guides", "style.md"), "# Style\n");
fs.writeFileSync(path.join(outside, "secret.md"), "secret");
fs.writeFileSync(path.join(folder, "docs", "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
fs.writeFileSync(path.join(folder, "docs", "pic.svg"), "<svg/>");
fs.symlinkSync(path.join(outside, "secret.md"), path.join(folder, "docs", "link.md"));
const roots = [folder, ref];

describe("locate", () => {
  it("finds a file in the folder or a reference folder", async () => {
    expect(await locate("docs/plan.md", roots)).toEqual({ ok: true, file: path.join(folder, "docs", "plan.md"), root: folder });
    expect(await locate("guides/style.md", roots)).toMatchObject({ ok: true, root: ref });
  });
  it("tells a missing file from one outside the folder", async () => {
    expect(await locate("docs/gone.md", roots)).toEqual({ ok: false, reason: "missing" });
    expect(await locate("../outside/secret.md", roots)).toEqual({ ok: false, reason: "outside" });
    expect(await locate(path.join(outside, "secret.md"), roots)).toEqual({ ok: false, reason: "outside" });
    expect(await locate("docs/link.md", roots)).toEqual({ ok: false, reason: "outside" });
    for (const junk of [42, "", "a\0b.md", "x".repeat(1001)]) expect(await locate(junk, roots)).toEqual({ ok: false, reason: "outside" });
  });
});

describe("readDocument (§5.3)", () => {
  it("answers the text, the mtime and the size; never writes", async () => {
    const before = fs.statSync(path.join(folder, "docs", "plan.md")).mtimeMs;
    const r = await readDocument("docs/plan.md", roots);
    expect(r).toMatchObject({ ok: true, text: "# Plan\n", size: 7 });
    expect(r.ok && r.mtime).toBe(fs.statSync(path.join(folder, "docs", "plan.md")).mtime.toISOString());
    expect(fs.statSync(path.join(folder, "docs", "plan.md")).mtimeMs).toBe(before);
  });
  it("refuses outside paths, links out, other kinds of file and huge files", async () => {
    expect(await readDocument("../outside/secret.md", roots)).toEqual({ ok: false, reason: "outside" });
    expect(await readDocument("docs/link.md", roots)).toEqual({ ok: false, reason: "outside" });
    expect(await readDocument("docs/notes.txt", roots)).toEqual({ ok: false, reason: "not-markdown" });
    expect(await readDocument("docs/gone.md", roots)).toEqual({ ok: false, reason: "missing" });
    const big = path.join(folder, "docs", "big.md");
    fs.writeFileSync(big, Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 0x61));
    expect(await readDocument("docs/big.md", roots)).toEqual({ ok: false, reason: "too-large", size: MAX_DOCUMENT_BYTES + 1 });
    fs.rmSync(big);
  });
});

describe("readImage", () => {
  it("a local image as a data URL; never SVG, never outside", async () => {
    expect(await readImage("docs/pic.png", roots)).toBe(`data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`);
    expect(await readImage("docs/pic.svg", roots)).toBeNull();
    expect(await readImage("../outside/secret.md", roots)).toBeNull();
    expect(await readImage("docs/missing.png", roots)).toBeNull();
  });
});

describe("documentsExist", () => {
  it("one answer per path", async () => {
    expect(await documentsExist(["docs/plan.md", "docs/gone.md", "../outside/secret.md"], roots)).toEqual([true, false, false]);
  });
});

describe("DocumentWatchers (live reload)", () => {
  it("tells once after a quiet moment when the file changes, also through a rename; not for other files", async () => {
    const changed = vi.fn();
    const w = new DocumentWatchers(changed, 50);
    const id = await w.watch("docs/plan.md", roots);
    expect(id).toEqual(expect.any(Number));
    fs.writeFileSync(path.join(folder, "docs", "other.md"), "x");
    await new Promise((r) => setTimeout(r, 200));
    expect(changed).not.toHaveBeenCalled();
    const tmp = path.join(folder, "docs", "plan.md.tmp");
    fs.writeFileSync(tmp, "# Plan v2\n");
    fs.renameSync(tmp, path.join(folder, "docs", "plan.md"));
    fs.appendFileSync(path.join(folder, "docs", "plan.md"), "more\n");
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(id), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 150));
    expect(changed).toHaveBeenCalledTimes(1);
    w.unwatch(id);
    fs.appendFileSync(path.join(folder, "docs", "plan.md"), "again\n");
    await new Promise((r) => setTimeout(r, 200));
    expect(changed).toHaveBeenCalledTimes(1);
    w.closeAll();
  });

  it("refuses to watch outside the folder", async () => {
    const w = new DocumentWatchers(() => {}, 50);
    expect(await w.watch("../outside/secret.md", roots)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/documents.test.ts`
Expected: FAIL ("Cannot find module '../src/main/documents'").

- [ ] **Step 3: Export `stillSafe`**

In `packages/shell/src/main/open-path.ts`, change `async function stillSafe(` to `export async function stillSafe(`.

- [ ] **Step 4: Add the result type to the client**

In `packages/ui/src/client.ts`, after `FolderPick`:

```ts
/** `hh:readDocument` (document-reader spec §5.3). Main never writes; a refusal is data. */
export type DocumentRead =
  | { ok: true; text: string; mtime: string; size: number }
  | { ok: false; reason: "outside" | "missing" | "not-markdown" | "too-large" | "not-ready"; size?: number };
```

- [ ] **Step 5: Write the module**

Create `packages/shell/src/main/documents.ts`:

```ts
import { type FSWatcher, promises as fs, watch } from "node:fs";
import path from "node:path";
import type { DocumentRead } from "@humanharness/ui/client";
import { stillSafe } from "./open-path";

/** Over this the reader refuses a document (Open questions Q6). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** Over this an image shows its alt text. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const MARKDOWN = /\.(md|markdown)$/i;

export type Located = { ok: true; file: string; root: string } | { ok: false; reason: "outside" | "missing" };

/**
 * Where `rel` is, tried in each root in order (the person's folder first, then the reference folders): a regular file
 * whose real path is inside the same root. A path that is inside a root but not there is "missing"; a path that leaves
 * every root, or a link that points out, is "outside".
 */
export async function locate(rel: unknown, roots: string[]): Promise<Located> {
  if (typeof rel !== "string" || !rel || rel.length > 1000 || rel.includes("\0")) return { ok: false, reason: "outside" };
  let inside = false;
  for (const root of roots) {
    const realRoot = await fs.realpath(root).catch(() => null);
    if (!realRoot) continue;
    const candidate = path.resolve(realRoot, rel);
    if (!candidate.startsWith(realRoot + path.sep)) continue;
    inside = true;
    const real = await fs.realpath(candidate).catch(() => null);
    if (!real) continue;
    if (!real.startsWith(realRoot + path.sep)) return { ok: false, reason: "outside" };
    const stat = await fs.stat(real).catch(() => null);
    if (stat?.isFile()) return { ok: true, file: real, root: realRoot };
  }
  return { ok: false, reason: inside ? "missing" : "outside" };
}

/** A Markdown document's text (§5.3). Only `.md`/`.markdown`; checked again right before it is read. */
export async function readDocument(rel: unknown, roots: string[]): Promise<DocumentRead> {
  if (typeof rel === "string" && rel && !MARKDOWN.test(rel)) return { ok: false, reason: "not-markdown" };
  const at = await locate(rel, roots);
  if (!at.ok) return at;
  if (!MARKDOWN.test(at.file)) return { ok: false, reason: "not-markdown" };
  const stat = await fs.stat(at.file);
  if (stat.size > MAX_DOCUMENT_BYTES) return { ok: false, reason: "too-large", size: stat.size };
  if (!(await stillSafe(at.file, roots))) return { ok: false, reason: "outside" };
  const text = await fs.readFile(at.file, "utf8");
  return { ok: true, text, mtime: stat.mtime.toISOString(), size: stat.size };
}

/** A local image as a data: URL (§3.2), or null. No SVG: only raster formats. */
export async function readImage(rel: unknown, roots: string[]): Promise<string | null> {
  if (typeof rel !== "string") return null;
  const type = IMAGE_TYPES[path.extname(rel).toLowerCase()];
  if (!type) return null;
  const at = await locate(rel, roots);
  if (!at.ok || IMAGE_TYPES[path.extname(at.file).toLowerCase()] !== type) return null;
  const stat = await fs.stat(at.file);
  if (stat.size > MAX_IMAGE_BYTES || !(await stillSafe(at.file, roots))) return null;
  return `data:${type};base64,${(await fs.readFile(at.file)).toString("base64")}`;
}

/** Whether each path is a file the reader could open (cards of moved or deleted files are struck through). */
export async function documentsExist(paths: unknown[], roots: string[]): Promise<boolean[]> {
  return Promise.all(paths.map(async (p) => (await locate(p, roots)).ok));
}

/**
 * Live reload (§5.3): watches a document's folder (a file replaced by a rename keeps being seen) and calls `onChange`
 * with the watch id once things have been quiet for `quietMs`.
 */
export class DocumentWatchers {
  private next = 1;
  private readonly open = new Map<number, () => void>();

  constructor(
    private readonly onChange: (id: number) => void,
    private readonly quietMs = 150,
  ) {}

  async watch(rel: unknown, roots: string[]): Promise<number | null> {
    const at = await locate(rel, roots);
    if (!at.ok) return null;
    const name = path.basename(at.file);
    const id = this.next++;
    let timer: NodeJS.Timeout | null = null;
    let watcher: FSWatcher;
    try {
      watcher = watch(path.dirname(at.file), (_event, file) => {
        if (file !== null && file !== undefined && String(file) !== name) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => this.onChange(id), this.quietMs);
      });
    } catch {
      return null;
    }
    watcher.on("error", () => undefined);
    this.open.set(id, () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    });
    return id;
  }

  unwatch(id: unknown): void {
    if (typeof id !== "number") return;
    this.open.get(id)?.();
    this.open.delete(id);
  }

  closeAll(): void {
    for (const id of [...this.open.keys()]) this.unwatch(id);
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/documents.test.ts packages/shell/test/open-path.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck, test, commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`. Expected: green.

```bash
git -C <worktree> add packages/shell/src/main/documents.ts packages/shell/src/main/open-path.ts packages/ui/src/client.ts packages/shell/test/documents.test.ts
git -C <worktree> commit -m "feat(shell): read documents and images inside the folder, watch for changes"
```

---

### Task 11: IPC, preload, client and the fake client

**Files:**
- Modify: `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`
- Modify: `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`
- Test: `packages/ui/test/client.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/ui/test/client.test.ts`:

```ts
import { FakeClient } from "./fake-client";

describe("FakeClient documents (document-reader spec §5)", () => {
  it("reads, refuses, watches and opens like main and the preload", async () => {
    const c = new FakeClient();
    c.documents["docs/a.md"] = "# A";
    expect(await c.readDocument("docs/a.md")).toEqual({ ok: true, text: "# A", mtime: c.documentMtime, size: 3 });
    expect(await c.readDocument("docs/b.md")).toEqual({ ok: false, reason: "missing" });
    expect(await c.readDocument("../x.md")).toEqual({ ok: false, reason: "outside" });
    expect(await c.documentsExist(["docs/a.md", "docs/b.md"])).toEqual([true, false]);
    let heard = 0;
    const off = c.watchDocument("docs/a.md", () => heard++);
    c.changeDocument("docs/a.md", "# A2");
    off();
    c.changeDocument("docs/a.md", "# A3");
    expect(heard).toBe(1);
    const opened: string[] = [];
    const offOpen = c.onOpenDocument((p) => opened.push(p));
    c.openDocument("docs/a.md");
    offOpen();
    c.openDocument("docs/b.md");
    expect(opened).toEqual(["docs/a.md"]);
  });
});
```

(Keep the existing imports; add `FakeClient`'s import only if the file does not have it.)

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/ui/test/client.test.ts`
Expected: FAIL (`readDocument` is not a function).

- [ ] **Step 3: The client's types**

In `packages/ui/src/client.ts`:

Add to the type imports: `import type { DocumentKind } from "@humanharness/harness-sdk";` (merge into the existing import from `@humanharness/harness-sdk`) and `DocumentCard` to the import from `@humanharness/runtime` (Task 12 creates it; until then add it there now — see Step 4).

In `AppState`, after `material?`:

```ts
  /** The harness's document kinds (manifest `documents`): the reader's template check. Absent: none (D0). */
  documents?: { kinds: Record<string, DocumentKind> };
```

In `ChatEntry`, after `parts?`:

```ts
  /** The `.md` files this turn added or changed (document-reader spec §5.1). Absent: none. */
  documents?: DocumentCard[];
```

In `HarnessClient`, after `revealPath`:

```ts
  /** A Markdown document inside the folder or a reference folder (document-reader spec §5.3). Never writes. */
  readDocument(path: string): Promise<DocumentRead>;
  /** A local image (png, jpeg, gif, webp) inside the folder or a reference folder, as a data: URL; null when refused. */
  readImage(path: string): Promise<string | null>;
  /** Whether each path is still there (a card of a moved or deleted file is struck through). */
  documentsExist(paths: string[]): Promise<boolean[]>;
  /** Calls `listener` after each change to the document; returns the unsubscribe. */
  watchDocument(path: string, listener: () => void): () => void;
  /** Opens a document in the reader panel (the harness's own UI may call it). */
  openDocument(path: string): void;
  /** Every `openDocument`, whoever called it: the chat opens the panel. */
  onOpenDocument(listener: (path: string) => void): () => void;
```

- [ ] **Step 4: The event type the client needs now**

`ChatEntry.documents` needs `DocumentCard` from `@humanharness/runtime`. Add it in this task (Task 12 emits it): in `packages/runtime/src/events.ts`, before `export type Event`:

```ts
/** A Markdown file a turn added or changed (document-reader spec §5.1): what its card shows. */
export interface DocumentCard {
  /** Relative to the folder, forward slashes. */
  path: string;
  title: string;
  /** Front-matter `kind`, when there is one. */
  kind?: string;
  change: "new" | "updated";
  /** Words in the body; the window turns them into a reading time. */
  words: number;
}
```

and to the `Event` union, before the `done` members:

```ts
  /** The turn's added or changed `.md` files, sent right before a successful `done`. Never empty. */
  | { type: "documents"; documents: DocumentCard[] }
```

Make sure `packages/runtime/src/index.ts` re-exports it (it re-exports `./events` with `export *`; check with `grep -n events packages/runtime/src/index.ts`).

`reduceChat` in `packages/ui/src/state.ts` switches over every event type: add, before `case "context":`,

```ts
    case "documents":
      return live ? { ...state, live: { ...live, documents: action.documents } } : state;
```

and to `LiveTurn`: `documents?: DocumentCard[];` (import the type from `./client`, which re-exports nothing for it yet: add `export type { DocumentCard } from "@humanharness/runtime";` next to the other re-exports at the end of `client.ts`). In the `done` case, add to the built entry:

```ts
        ...(live.documents ? { documents: live.documents } : {}),
```

Anything else that switches exhaustively over `Event` fails to compile now: fix each by ignoring `documents` (search: `corepack pnpm typecheck`).

- [ ] **Step 5: Main's handlers**

In `packages/shell/src/main/index.ts`:

Import: `import { DocumentWatchers, documentsExist, readDocument, readImage } from "./documents";`

Near the other module-level state (after `lastAppState`), add:

```ts
/** The reader's open documents: main tells the window when one changes (document-reader spec §5.3). */
const documentWatchers = new DocumentWatchers((id) => sendToWindow("hh:documentChanged", id));

/** Where documents and images may be read: the person's folder, then the usable reference folders; null before setup. */
async function documentRoots(): Promise<string[] | null> {
  const c = await validConfig();
  if (!c) return null;
  return openRoots(baseOf(c), (await workReferences(c, baseOf(c))).map((r) => r.path));
}
```

(Put the function after `validConfig` and `baseOf` are defined if they are `const` arrow functions; function declarations are hoisted.)

After the `hh:revealPath` handler:

```ts
  // The reader (document-reader spec §5.3): it only ever reads, inside the folder or a reference folder.
  handle("hh:readDocument", async (rel: unknown): Promise<DocumentRead> => {
    const roots = await documentRoots();
    if (!roots) return { ok: false, reason: "not-ready" };
    return readDocument(rel, roots).catch((): DocumentRead => ({ ok: false, reason: "missing" }));
  });
  handle("hh:readImage", async (rel: unknown) => {
    const roots = await documentRoots();
    return roots ? readImage(rel, roots).catch(() => null) : null;
  });
  handle("hh:documentsExist", async (paths: unknown) => {
    if (!Array.isArray(paths) || paths.length > 200) return [];
    const roots = await documentRoots();
    return roots ? documentsExist(paths, roots) : paths.map(() => false);
  });
  handle("hh:watchDocument", async (rel: unknown) => {
    const roots = await documentRoots();
    return roots ? documentWatchers.watch(rel, roots) : null;
  });
  handle("hh:unwatchDocument", (id: unknown) => documentWatchers.unwatch(id));
```

Import `DocumentRead` from `@humanharness/ui/client` with the other types.

In `createWindow`'s `win.on("closed", …)` callback, add `documentWatchers.closeAll();`.

In `appState()`, after the material entry (search `material:` in the state object), add:

```ts
    // The reader's template check (document-reader spec §4.3); absent without kinds (D0).
    ...(harness.documents ? { documents: { kinds: harness.documents.kinds } } : {}),
```

- [ ] **Step 6: The preload**

In `packages/shell/src/preload/index.ts`, next to `modeSwitches`:

```ts
/** Told of every `openDocument`, from the window or the harness's own UI (document-reader spec §5.1). */
const documentOpeners = new Set<(path: string) => void>();
```

and in `client`, after `revealPath`:

```ts
  readDocument: (file) => ipcRenderer.invoke("hh:readDocument", file),
  readImage: (file) => ipcRenderer.invoke("hh:readImage", file),
  documentsExist: (paths) => ipcRenderer.invoke("hh:documentsExist", paths),
  watchDocument: (file, listener) => {
    let id: number | null = null;
    let closed = false;
    const off = subscribe<number>("hh:documentChanged", (changed) => {
      if (changed === id) listener();
    });
    void ipcRenderer.invoke("hh:watchDocument", file).then((got: number | null) => {
      if (closed && got !== null) void ipcRenderer.invoke("hh:unwatchDocument", got);
      else id = got;
    });
    return () => {
      closed = true;
      off();
      if (id !== null) void ipcRenderer.invoke("hh:unwatchDocument", id);
    };
  },
  openDocument: (file) => {
    for (const l of documentOpeners) l(file);
  },
  onOpenDocument: (listener) => {
    documentOpeners.add(listener);
    return () => void documentOpeners.delete(listener);
  },
```

- [ ] **Step 7: The fake client**

In `packages/ui/test/fake-client.ts`, import `DocumentRead` with the other types and add to `FakeClient`:

```ts
  /** Documents by path (relative to the folder); readDocument answers from here. */
  documents: Record<string, string> = {};
  documentMtime = "2026-10-27T10:00:00.000Z";
  /** Images by path, as data: URLs. */
  images: Record<string, string> = {};
  private documentWatchers = new Map<string, Set<() => void>>();
  private documentOpeners = new Set<(path: string) => void>();
  async readDocument(file: string): Promise<DocumentRead> {
    if (file.startsWith("../") || file.startsWith("/")) return { ok: false, reason: "outside" };
    const text = this.documents[file];
    if (text === undefined) return { ok: false, reason: "missing" };
    return { ok: true, text, mtime: this.documentMtime, size: new TextEncoder().encode(text).length };
  }
  async readImage(file: string) {
    return this.images[file] ?? null;
  }
  async documentsExist(paths: string[]) {
    return paths.map((p) => Object.hasOwn(this.documents, p));
  }
  watchDocument(file: string, listener: () => void) {
    const set = this.documentWatchers.get(file) ?? new Set();
    set.add(listener);
    this.documentWatchers.set(file, set);
    return () => void set.delete(listener);
  }
  /** Rewrites (or with null deletes) a document and tells its watchers, as main does after a change. */
  changeDocument(file: string, text: string | null) {
    if (text === null) delete this.documents[file];
    else this.documents[file] = text;
    for (const l of [...(this.documentWatchers.get(file) ?? [])]) l();
  }
  openDocument(file: string) {
    for (const l of [...this.documentOpeners]) l(file);
  }
  onOpenDocument(listener: (path: string) => void) {
    this.documentOpeners.add(listener);
    return () => void this.documentOpeners.delete(listener);
  }
```

- [ ] **Step 8: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/client.test.ts packages/ui/test/state.test.ts`
Expected: PASS.

- [ ] **Step 9: D0 test for the state**

Find the test that checks `AppState` for a harness without optional features (search `grep -rn "material\" in\|not.toHaveProperty(\"material\"" packages/shell/test packages/ui/test`). If such a test exists, add `documents` beside `material`. If none exists, skip: Task 16's chat tests cover the window side.

- [ ] **Step 10: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`. Expected: green.

```bash
git -C <worktree> add packages/shell/src/main/index.ts packages/shell/src/preload/index.ts packages/ui/src/client.ts packages/ui/src/state.ts packages/runtime/src/events.ts packages/ui/test/fake-client.ts packages/ui/test/client.test.ts
git -C <worktree> commit -m "feat(shell): documents over IPC — read, images, exists, watch, open"
```

---

### Task 12: Runtime — a card for each `.md` a turn added or changed

**Files:**
- Modify: `packages/workspace/src/history.ts`
- Create: `packages/runtime/src/documents.ts`
- Modify: `packages/runtime/src/runtime.ts`
- Test: `packages/workspace/test/history.test.ts`, `packages/runtime/test/documents.test.ts`, `packages/runtime/test/runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/workspace/test/history.test.ts` (use its existing temp-folder helpers; this sketch makes its own):

```ts
describe("History.changes", () => {
  it("lists what changed between two commits; null from: all added", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-changes-"));
    const folder = path.join(dir, "w");
    fs.mkdirSync(folder);
    const h = new History(folder, path.join(dir, "git"));
    await h.init();
    fs.writeFileSync(path.join(folder, "a.md"), "a");
    const first = (await h.save("one"))!;
    fs.writeFileSync(path.join(folder, "a.md"), "a2");
    fs.writeFileSync(path.join(folder, "b.md"), "b");
    const second = (await h.save("two"))!;
    expect((await h.changes(first, second)).sort((x, y) => x.path.localeCompare(y.path))).toEqual([
      { path: "a.md", kind: "modified" },
      { path: "b.md", kind: "added" },
    ]);
    expect(await h.changes(null, first)).toEqual([{ path: "a.md", kind: "added" }]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

Create `packages/runtime/test/documents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FileChange } from "@humanharness/workspace";
import { MAX_CARDS, turnDocuments } from "../src/documents";

const history = (changes: FileChange[], files: Record<string, string>) => ({
  changes: async () => changes,
  readFileAt: async (_sha: string | null, file: string) => files[file] ?? null,
});

describe("turnDocuments (§5.1)", () => {
  it("an added .md is new, a changed one updated; title, kind and words from the turn's commit", async () => {
    const cards = await turnDocuments(
      history(
        [
          { path: "tickets/MUS-412/analysis.md", kind: "added" },
          { path: "README.md", kind: "modified" },
        ],
        { "tickets/MUS-412/analysis.md": "---\ntitle: Analysis\nkind: analysis\n---\nOne two three", "README.md": "# Read me\nHi" },
      ),
      "before",
      "after",
    );
    expect(cards).toEqual([
      { path: "README.md", title: "Read me", change: "updated", words: 4 },
      { path: "tickets/MUS-412/analysis.md", title: "Analysis", kind: "analysis", change: "new", words: 3 },
    ]);
  });

  it("no card for a non-.md file, a deleted .md, or anything under .harness/", async () => {
    const cards = await turnDocuments(
      history(
        [
          { path: "src/a.ts", kind: "added" },
          { path: "old.md", kind: "deleted" },
          { path: ".harness/notes/x.md", kind: "added" },
          { path: "Notes.MD", kind: "added" },
        ],
        { "Notes.MD": "x" },
      ),
      "b",
      "a",
    );
    expect(cards.map((c) => c.path)).toEqual(["Notes.MD"]);
  });

  it("at most MAX_CARDS, in path order", async () => {
    const changes = Array.from({ length: MAX_CARDS + 5 }, (_, i) => ({ path: `d/${String(i).padStart(2, "0")}.md`, kind: "added" as const }));
    const files = Object.fromEntries(changes.map((c) => [c.path, "x"]));
    const cards = await turnDocuments(history(changes.reverse(), files), "b", "a");
    expect(cards).toHaveLength(MAX_CARDS);
    expect(cards[0].path).toBe("d/00.md");
  });
});
```

Add to `packages/runtime/test/runtime.test.ts`, inside `describe("createRuntime")`:

```ts
  it("sends a documents event before done for the .md files the turn wrote (document-reader §5.1)", async () => {
    const { runtime } = await setup({
      steps: [
        { write: { path: "docs/plan.md", content: "---\ntitle: The plan\n---\nGo." } },
        { write: { path: "src/a.ts", content: "x" } },
        ...claudeTextLines("ok"),
        claudeResultLine(true),
      ],
    });
    const events = await send(runtime, "plan it");
    expect(events.at(-2)).toEqual({ type: "documents", documents: [{ path: "docs/plan.md", title: "The plan", change: "new", words: 1 }] });
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
  });

  it("D0: a turn that changes no .md sends no documents event; neither does a stopped one", async () => {
    const quiet = await setup({ steps: [{ write: { path: "src/a.ts", content: "x" } }, ...claudeTextLines("ok"), claudeResultLine(true)] });
    expect((await send(quiet.runtime)).some((e) => e.type === "documents")).toBe(false);
    await quiet.runtime.close();
    runtime = undefined;
    const stopped = await setup({ steps: [{ write: { path: "kept.md", content: "x" } }, { sleep: 10_000 }] });
    const events: Event[] = [];
    const turn = stopped.runtime.send("hi", (e) => events.push(e));
    while (!fs.existsSync(path.join(stopped.folder, "kept.md"))) await new Promise((r) => setTimeout(r, 50));
    turn.cancel();
    await turn.done;
    expect(events.some((e) => e.type === "documents")).toBe(false);
  }, 10_000);
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/workspace/test/history.test.ts packages/runtime/test/documents.test.ts packages/runtime/test/runtime.test.ts`
Expected: FAIL (`changes` is not a function; missing module; no `documents` event).

- [ ] **Step 3: `History.changes`**

In `packages/workspace/src/history.ts`, after `readFileAt`, add:

```ts
  /** What changed between two commits (tracked files only); `from` null: everything in `to` counts as added. */
  changes(from: string | null, to: string): Promise<FileChange[]> {
    return this.diff(from, to);
  }
```

- [ ] **Step 4: The cards**

Create `packages/runtime/src/documents.ts`:

```ts
import { isMarkdownPath, summarizeDocument } from "@humanharness/harness-sdk";
import type { History } from "@humanharness/workspace";
import type { DocumentCard } from "./events";

/** At most this many cards per turn. */
export const MAX_CARDS = 20;

/**
 * The cards of a turn (document-reader spec §5.1): every `.md` added or changed between the turn's "Before message"
 * commit and its "Turn: …" commit, read at the turn's commit. Never the app's files under `.harness/`.
 */
export async function turnDocuments(history: Pick<History, "changes" | "readFileAt">, before: string, after: string): Promise<DocumentCard[]> {
  const picked = (await history.changes(before, after))
    .filter((c) => c.kind !== "deleted" && isMarkdownPath(c.path) && !c.path.startsWith(".harness/"))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, MAX_CARDS);
  const cards: DocumentCard[] = [];
  for (const c of picked) {
    const text = await history.readFileAt(after, c.path);
    if (text === null) continue;
    cards.push({ path: c.path, ...summarizeDocument(c.path, text), change: c.kind === "added" ? "new" : "updated" });
  }
  return cards;
}
```

- [ ] **Step 5: Emit them**

In `packages/runtime/src/runtime.ts`, import `{ turnDocuments } from "./documents"`, and replace

```ts
            if (f.type === "done" && f.ok) await history.save(`${TURN_PREFIX}${message.slice(0, 60)}`, options.trailer);
```

with

```ts
            if (f.type === "done" && f.ok) {
              const after = await history.save(`${TURN_PREFIX}${message.slice(0, 60)}`, options.trailer);
              // A card for each .md the turn added or changed (document-reader spec §5.1); none: no event at all.
              if (after) {
                const documents = await turnDocuments(history, before, after).catch((err: unknown) => {
                  console.error("Could not list the turn's documents", err);
                  return [];
                });
                if (documents.length > 0) emitOnce({ type: "documents", documents });
              }
            }
```

(The `else if` lines after it stay as they are; check the braces.)

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/workspace/test/history.test.ts packages/runtime/test/documents.test.ts packages/runtime/test/runtime.test.ts`
Expected: PASS. Existing runtime tests that write `.md` files (`notes/Groceries.md`, `plan.md`) now also get a `documents` event: they check `toContainEqual` and `events.at(-1)`, so they still pass. If one compares the whole event list with `toEqual`, add the expected `documents` event to it.

- [ ] **Step 7: Typecheck, test, commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`. Expected: green.

```bash
git -C <worktree> add packages/workspace/src/history.ts packages/workspace/test/history.test.ts packages/runtime/src/documents.ts packages/runtime/src/runtime.ts packages/runtime/test/documents.test.ts packages/runtime/test/runtime.test.ts
git -C <worktree> commit -m "feat(runtime): cards for the .md files a turn added or changed"
```

---

### Task 13: Saved on the entry, printed in the terminal

**Files:**
- Modify: `packages/shell/src/main/chat-log.ts`
- Modify: `packages/cli/src/terminal.ts`
- Test: `packages/shell/test/chat-log.test.ts`, `packages/ui/test/state.test.ts`, `packages/cli/test/terminal.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/shell/test/chat-log.test.ts`:

```ts
describe("TurnRecorder documents (document-reader §5.1)", () => {
  it("saves the turn's cards on its entry; none: no field (D0)", () => {
    const card = { path: "docs/a.md", title: "A", change: "new" as const, words: 10 };
    const r = new TurnRecorder(new Set());
    r.add({ type: "text", delta: "Done." });
    r.add({ type: "documents", documents: [card] });
    expect(r.finish({ type: "done", ok: true }).documents).toEqual([card]);
    const plain = new TurnRecorder(new Set());
    plain.add({ type: "text", delta: "Hi" });
    expect("documents" in plain.finish({ type: "done", ok: true })).toBe(false);
  });
});
```

(Import `TurnRecorder` if the file does not yet.)

Add to `packages/ui/test/state.test.ts`:

```ts
describe("documents (document-reader §5.1)", () => {
  it("the live turn keeps its cards and its entry gets them", () => {
    const card = { path: "docs/a.md", title: "A", change: "updated" as const, words: 3 };
    let s = reduceChat(initialChat([]), { type: "user", text: "go", at: "t" });
    s = reduceChat(s, { type: "text", delta: "ok" });
    s = reduceChat(s, { type: "documents", documents: [card] });
    s = reduceChat(s, { type: "done", ok: true });
    expect(s.entries.at(-1)?.documents).toEqual([card]);
  });
  it("D0: a turn without cards has no documents field", () => {
    let s = reduceChat(initialChat([]), { type: "user", text: "go", at: "t" });
    s = reduceChat(s, { type: "text", delta: "ok" });
    s = reduceChat(s, { type: "done", ok: true });
    expect("documents" in s.entries.at(-1)!).toBe(false);
  });
});
```

Add to `packages/cli/test/terminal.test.ts`, inside `describe("TerminalView")`:

```ts
  it("prints one Documents line per card at the end of the turn (document-reader §5.3)", () => {
    const out = memoryStream();
    const view = new TerminalView(out.stream, "Claude");
    view.event({ type: "text", delta: "Wrote it." });
    view.event({
      type: "documents",
      documents: [
        { path: "tickets/MUS-412/analysis.md", title: "Analysis", change: "new", words: 300 },
        { path: "README.md", title: "Read me", change: "updated", words: 3 },
      ],
    });
    view.event({ type: "done", ok: true });
    expect(out.text()).toBe(["Wrote it.", "Documents: tickets/MUS-412/analysis.md (new)", "Documents: README.md (updated)", ""].join("\n"));
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/chat-log.test.ts packages/ui/test/state.test.ts packages/cli/test/terminal.test.ts`
Expected: FAIL for the recorder and the terminal (the reducer part already passes from Task 11).

- [ ] **Step 3: The recorder**

In `packages/shell/src/main/chat-log.ts`, `TurnRecorder`:
- add a field `private documents: DocumentCard[] | undefined;` (import the type from `@humanharness/ui/client`);
- in `add`, after the `usage` branch: `else if (e.type === "documents") this.documents = e.documents;`
- in `finish`, after `parts`: `...(this.documents ? { documents: this.documents } : {}),`

- [ ] **Step 4: The terminal**

In `packages/cli/src/terminal.ts`, `TerminalView.event`, before the `done` branch:

```ts
    else if (e.type === "documents") {
      this.newline();
      // A path is the agent's text: drawn without terminal control characters.
      for (const d of e.documents) this.line(`Documents: ${plain(d.path)} (${d.change})`);
    }
```

(`plain`, `newline` and `line` already exist in that file; check that `newline()` only ends an open line, so the output above has no blank line between the text and the first `Documents:` line. If `line` adds its own newline after an open line, drop the `this.newline()` call.)

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/chat-log.test.ts packages/ui/test/state.test.ts packages/cli/test/terminal.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`. Expected: green.

```bash
git -C <worktree> add packages/shell/src/main/chat-log.ts packages/cli/src/terminal.ts packages/shell/test/chat-log.test.ts packages/ui/test/state.test.ts packages/cli/test/terminal.test.ts
git -C <worktree> commit -m "feat: document cards saved on the chat entry and printed by humanharness run"
```

---

### Task 14: Reading preferences

**Files:**
- Modify: `packages/ui/src/client.ts`
- Modify: `packages/shell/src/main/config.ts`, `packages/shell/src/main/validate.ts`
- Test: `packages/shell/test/config.test.ts`, `packages/shell/test/validate.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/shell/test/config.test.ts` (it has a temp-dir `ConfigStore` setup; follow it):

```ts
  it("keeps valid reading preferences and drops bad ones (document-reader §5.2)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-cfg-"));
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ reader: { font: "serif", size: "huge" } }));
    expect((await new ConfigStore(dir).load()).reader).toEqual({ font: "serif" });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ reader: "big" }));
    expect("reader" in (await new ConfigStore(dir).load())).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
```

Add to `packages/shell/test/validate.test.ts`:

```ts
  it("reading preferences: sans or serif, normal or large", async () => {
    expect(await configProblem({ reader: { font: "serif", size: "large" } }, ctx)).toBeNull();
    expect(await configProblem({ reader: { font: "mono" } } as never, ctx)).toBe("invalid");
    expect(await configProblem({ reader: [] } as never, ctx)).toBe("invalid");
  });
```

(`ctx` is the `ValidationContext` the file already builds; use its name.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/config.test.ts packages/shell/test/validate.test.ts`
Expected: FAIL.

- [ ] **Step 3: The type and its check**

In `packages/ui/src/client.ts`, before `AppConfig`:

```ts
/** The reader's look (document-reader spec §5.2): global app preferences. */
export interface ReaderPrefs {
  font?: "sans" | "serif";
  size?: "normal" | "large";
}

/** The valid part of saved reading preferences; null when nothing is valid. */
export function cleanReaderPrefs(value: unknown): ReaderPrefs | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const out: ReaderPrefs = {
    ...(v.font === "sans" || v.font === "serif" ? { font: v.font } : {}),
    ...(v.size === "normal" || v.size === "large" ? { size: v.size } : {}),
  };
  return Object.keys(out).length > 0 ? out : null;
}
```

and in `AppConfig`, after `textSize`:

```ts
  /** The reader's font and text size. Absent until the person changes one (D0). */
  reader?: ReaderPrefs;
```

In `packages/shell/src/main/config.ts`, `load()`: take `reader` out with the others and put back only its valid part:

```ts
      const { backupDismissed, textSize, language, profile, reader, ...rest } = saved;
      const readerPrefs = cleanReaderPrefs(reader);
      return {
        ...rest,
        ...(typeof backupDismissed === "boolean" ? { backupDismissed } : {}),
        ...(isTextSize(textSize) ? { textSize } : {}),
        ...(typeof language === "string" && canonicalLanguage(language) === language ? { language } : {}),
        ...(isProfileId(profile) ? { profile } : {}),
        ...(readerPrefs ? { reader: readerPrefs } : {}),
      };
```

(import `cleanReaderPrefs` from `@humanharness/ui/client`).

In `packages/shell/src/main/validate.ts`, `configProblem`, after the `textSize` line:

```ts
  if (c.reader !== undefined) {
    const clean = cleanReaderPrefs(c.reader);
    // Every field given must be valid: nothing is silently dropped from what the window sends.
    if (!clean || Object.keys(clean).length !== Object.keys(c.reader).length) return "invalid";
  }
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/config.test.ts packages/shell/test/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`. Expected: green.

```bash
git -C <worktree> add packages/ui/src/client.ts packages/shell/src/main/config.ts packages/shell/src/main/validate.ts packages/shell/test/config.test.ts packages/shell/test/validate.test.ts
git -C <worktree> commit -m "feat(shell): reading preferences in the app config"
```

---
### Task 15: The reader panel

**Files:**
- Create: `packages/ui/src/DocumentReader.tsx`
- Modify: `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/document-reader.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/document-reader.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentReader } from "../src/DocumentReader";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const ANALYSIS = [
  "---",
  "title: Search cache",
  "kind: analysis",
  "status: draft",
  "---",
  "> [!SUMMARY]",
  "> Cache for ten minutes.",
  "",
  "## Context",
  "",
  "Slow calls.",
  "",
  "### Numbers",
  "",
  "## Options",
  "",
  "See [the ADR](adr/007.md).",
].join("\n");
const kinds = { analysis: { when: "x", sections: ["Context", "Options", "Risks"], status: ["proposed", "accepted"] } };

function setup(over: Partial<Parameters<typeof DocumentReader>[0]> = {}, docs: Record<string, string> = { "docs/cache.md": ANALYSIS }) {
  const client = new FakeClient();
  Object.assign(client.documents, docs);
  const props = {
    client,
    target: { path: "docs/cache.md", agent: "Claude" },
    kinds,
    prefs: {},
    onPrefs: vi.fn(),
    full: false,
    onFull: vi.fn(),
    onClose: vi.fn(),
    onOpen: vi.fn(),
    ...over,
  };
  return { client, props, view: renderIn("en", <DocumentReader {...props} />) };
}

describe("DocumentReader (§5.2)", () => {
  it("shows the path as breadcrumbs, the title, the chips, when it changed, the reading time and the agent", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Search cache" })).toBeTruthy();
    const crumbs = screen.getByRole("navigation", { name: "Path" });
    expect([...crumbs.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["docs", "cache.md"]);
    expect(screen.getByText("analysis")).toBeTruthy();
    expect(screen.getByText("draft")).toBeTruthy();
    expect(screen.getByText("Not one of: proposed, accepted")).toBeTruthy();
    expect(screen.getByText("1 min read")).toBeTruthy();
    expect(screen.getByText("Written by Claude")).toBeTruthy();
    expect(screen.getByText(/^Changed /)).toBeTruthy();
  });

  it("the contents list ## and ###, jump on click, and hold the template note", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    setup();
    const toc = await screen.findByRole("navigation", { name: "Contents" });
    const links = [...toc.querySelectorAll("a")];
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Context", "#context"],
      ["Numbers", "#numbers"],
      ["Options", "#options"],
    ]);
    fireEvent.click(links[2]);
    expect(scroll).toHaveBeenCalled();
    expect(toc.querySelector(".hh-reader-template")?.textContent).toBe("Template analysis: missing section Risks.");
  });

  it("an unknown kind is a grey chip; no kinds declared means no check at all (D0)", async () => {
    setup({ kinds: { adr: { when: "x", sections: ["Status"] } } });
    expect(await screen.findByText("unknown kind")).toBeTruthy();
    cleanup();
    setup({ kinds: undefined });
    await screen.findByRole("heading", { level: 1, name: "Search cache" });
    expect(screen.queryByText("unknown kind")).toBeNull();
    expect(document.querySelector(".hh-reader-template")).toBeNull();
    expect(screen.queryByText(/Not one of/)).toBeNull();
  });

  it("broken front-matter: no chip, and the block never shows as text (§6)", async () => {
    setup({}, { "docs/cache.md": "---\nkind: analysis\nnot yaml here\n---\n# Plain" });
    expect(await screen.findByRole("heading", { name: "Plain" })).toBeTruthy();
    expect(screen.queryByText("analysis")).toBeNull();
    expect(document.body.textContent).not.toContain("not yaml here");
  });

  it("Source shows the raw text, read-only", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Source" }));
    const src = document.querySelector("pre.hh-reader-source");
    expect(src?.textContent).toBe(ANALYSIS);
  });

  it("full screen and close", async () => {
    const { props } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Full screen" }));
    expect(props.onFull).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalled();
    cleanup();
    const again = setup({ full: true });
    fireEvent.click(await screen.findByRole("button", { name: "Show chat" }));
    expect(again.props.onFull).toHaveBeenCalledWith(false);
  });

  it("reading preferences: serif and large, always both fields", async () => {
    const { props } = setup({ prefs: { size: "large" } });
    fireEvent.click(await screen.findByRole("button", { name: "Reading preferences" }));
    fireEvent.click(screen.getByRole("button", { name: "Serif" }));
    expect(props.onPrefs).toHaveBeenCalledWith({ font: "serif", size: "large" });
    expect(document.querySelector(".hh-reader-doc.hh-reader-large")).not.toBeNull();
  });

  it("a .md link opens the linked document, resolved from this one", async () => {
    const { props } = setup();
    fireEvent.click(await screen.findByRole("link", { name: "the ADR" }));
    expect(props.onOpen).toHaveBeenCalledWith("docs/adr/007.md", undefined);
  });

  it("moved or deleted, outside the folder (§6)", async () => {
    setup({ target: { path: "docs/gone.md" } });
    expect(await screen.findByText("This document was moved or deleted.")).toBeTruthy();
    cleanup();
    setup({ target: { path: "../secret.md" } });
    expect(await screen.findByText("This file is outside your folder.")).toBeTruthy();
  });

  it("over 1 MB: the first 200 KB, then the notice", async () => {
    const big = `# Big\n\n${"word ".repeat(300_000)}`;
    setup({ target: { path: "big.md" } }, { "big.md": big });
    expect(await screen.findByText("Showing the first 200 KB of 1.4 MB. Open Source to see all of it.")).toBeTruthy();
  });

  it("live reload: draws the new text and keeps the place at the nearest heading", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = function (this: Element) {
      scroll(this.id);
    };
    const { client } = setup();
    await screen.findByRole("heading", { name: "Options" });
    scroll.mockClear();
    await act(async () => client.changeDocument("docs/cache.md", `${ANALYSIS}\n\n## Risks\n\nNew.`));
    expect(await screen.findByRole("heading", { name: "Risks" })).toBeTruthy();
    await waitFor(() => expect(scroll).toHaveBeenCalledWith("options"));
    expect(document.querySelector(".hh-reader-template")).toBeNull();
  });

  it("live reload of a deleted file says so", async () => {
    const { client } = setup();
    await screen.findByRole("heading", { level: 1, name: "Search cache" });
    await act(async () => client.changeDocument("docs/cache.md", null));
    expect(await screen.findByText("This document was moved or deleted.")).toBeTruthy();
  });
});
```

About the live-reload test: in happy-dom every rectangle is at 0, so "the last heading at or above the top" is the last heading on the page before the reload (`options`). The reader records it before reading again and scrolls back to it after drawing the new text, which is what the test checks.

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/document-reader.test.tsx`
Expected: FAIL ("Cannot find module '../src/DocumentReader'").

- [ ] **Step 3: Write the reader**

Create `packages/ui/src/DocumentReader.tsx`:

```tsx
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type DocumentKind, checkTemplate, readingMinutes, wordCount } from "@humanharness/harness-sdk/documents";
import type { DocumentRead, HarnessClient, ReaderPrefs } from "./client";
import { DocumentContext, type DocumentHost } from "./documents-context";
import { Markdown, documentOutline } from "./markdown";

/** What the reader shows: a document, the place to open at, and the agent of the turn that wrote it. */
export interface ReaderTarget {
  path: string;
  anchor?: string;
  agent?: string;
}

/** Over this the reader draws only the first `SHOWN_BYTES` (§6). */
const BIG_BYTES = 1024 * 1024;
const SHOWN_BYTES = 200 * 1024;

export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The id of the last heading at or above the top of `box` (the place to keep across a reload). */
function headingAtTop(box: HTMLElement | null): string | null {
  if (!box) return null;
  const top = box.getBoundingClientRect().top;
  let last: string | null = null;
  for (const h of box.querySelectorAll<HTMLElement>("[data-heading]")) {
    if (h.getBoundingClientRect().top <= top + 8) last = h.id;
    else break;
  }
  return last;
}

export function DocumentReader({
  client,
  target,
  kinds,
  prefs,
  onPrefs,
  full,
  onFull,
  onClose,
  onOpen,
}: {
  client: HarnessClient;
  target: ReaderTarget;
  kinds?: Record<string, DocumentKind>;
  prefs: ReaderPrefs;
  onPrefs: (p: ReaderPrefs) => void;
  full: boolean;
  onFull: (full: boolean) => void;
  onClose: () => void;
  /** A `.md` link inside the document. */
  onOpen: (path: string, anchor?: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [doc, setDoc] = useState<DocumentRead | null>(null);
  const [source, setSource] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Where to scroll once the next text is drawn: the anchor asked for, or the heading kept across a reload. */
  const restore = useRef<string | null>(target.anchor ?? null);

  useEffect(() => {
    let live = true;
    const read = () =>
      client.readDocument(target.path).then(
        (d) => live && setDoc(d),
        () => live && setDoc({ ok: false, reason: "missing" }),
      );
    void read();
    const off = client.watchDocument(target.path, () => {
      restore.current = headingAtTop(scrollRef.current);
      void read();
    });
    return () => {
      live = false;
      off();
    };
  }, [client, target.path]);

  useEffect(() => {
    if (target.anchor) restore.current = target.anchor;
  }, [target.anchor]);

  useLayoutEffect(() => {
    const id = restore.current;
    if (!doc?.ok || !id) return;
    restore.current = null;
    document.getElementById(id)?.scrollIntoView?.({ block: "start" });
  }, [doc]);

  const text = doc?.ok ? doc.text : "";
  const big = doc?.ok === true && doc.size > BIG_BYTES;
  const shown = big ? text.slice(0, SHOWN_BYTES) : text;
  const { front, outline, sections } = useMemo(() => documentOutline(shown), [shown]);
  const check = checkTemplate(kinds, front, sections);
  const host = useMemo<DocumentHost>(
    () => ({ open: onOpen, image: (p) => client.readImage(p).catch(() => null), ...(kinds ? { kinds } : {}) }),
    [client, kinds, onOpen],
  );
  const font = prefs.font ?? "sans";
  const size = prefs.size ?? "normal";
  const setPref = (change: ReaderPrefs) => onPrefs({ font, size, ...change });
  const crumbs = target.path.split("/").filter(Boolean);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    onClose();
  };
  const jumpTo = (id: string) => document.getElementById(id)?.scrollIntoView?.({ block: "start" });

  let body: ReactNode;
  if (!doc) body = <p className="hh-caption" role="status">{t("reader.loading")}</p>;
  else if (!doc.ok) {
    body = (
      <p className="hh-reader-problem" role="alert">
        {doc.reason === "too-large" ? t("reader.tooLarge", { size: formatSize(doc.size ?? 0) }) : t(`reader.problem.${doc.reason}`)}
      </p>
    );
  } else if (source) {
    body = <pre className="hh-reader-source">{doc.text}</pre>;
  } else {
    body = (
      <>
        <div className="hh-reader-meta">
          {check?.unknownKind ? <span className="hh-chip hh-chip-muted">{t("reader.unknownKind")}</span> : front.kind && <span className="hh-chip">{front.kind}</span>}
          {front.status && <span className="hh-chip">{front.status}</span>}
          {check?.badStatus && kinds?.[check.kind]?.status && (
            <span className="hh-warn hh-reader-status-warn" role="note">
              {t("reader.badStatus", { allowed: kinds[check.kind].status!.join(", ") })}
            </span>
          )}
          <span>{t("reader.changed", { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(doc.mtime)) })}</span>
          <span>{t("reader.minutes", { count: readingMinutes(wordCount(shown)) })}</span>
          {target.agent && <span>{t("reader.writtenBy", { agent: target.agent })}</span>}
        </div>
        {front.title && (
          <h1 className="hh-reader-title" tabIndex={-1}>
            {front.title}
          </h1>
        )}
        <DocumentContext.Provider value={host}>
          <Markdown source={shown} document path={target.path} idPrefix="" />
        </DocumentContext.Provider>
        {big && (
          <p className="hh-reader-truncated" role="note">
            {t("reader.truncated", { shown: formatSize(SHOWN_BYTES), size: formatSize(doc.size) })}
          </p>
        )}
      </>
    );
  }

  return (
    <aside className={`hh-reader${full ? " hh-reader-is-full" : ""}`} aria-label={t("reader.title")} onKeyDown={onKeyDown}>
      <header className="hh-reader-bar">
        <nav aria-label={t("reader.path")}>
          <ol className="hh-reader-crumbs">
            {crumbs.map((c, i) => (
              <li key={i} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                {c}
              </li>
            ))}
          </ol>
        </nav>
        <div className="hh-reader-actions">
          <button type="button" aria-pressed={source} disabled={!doc?.ok} onClick={() => setSource((s) => !s)}>
            {t("reader.source")}
          </button>
          <button type="button" aria-expanded={prefsOpen} onClick={() => setPrefsOpen((o) => !o)} aria-label={t("reader.prefs")}>
            Aa
          </button>
          <button type="button" onClick={() => onFull(!full)}>
            {full ? t("reader.showChat") : t("reader.fullScreen")}
          </button>
          <button type="button" onClick={onClose}>
            {t("reader.close")}
          </button>
        </div>
        {prefsOpen && (
          <div className="hh-reader-prefs" role="group" aria-label={t("reader.prefs")}>
            <div className="hh-segment">
              <button type="button" aria-pressed={font === "sans"} onClick={() => setPref({ font: "sans" })}>
                {t("reader.sans")}
              </button>
              <button type="button" aria-pressed={font === "serif"} onClick={() => setPref({ font: "serif" })}>
                {t("reader.serif")}
              </button>
            </div>
            <div className="hh-segment">
              <button type="button" aria-pressed={size === "normal"} onClick={() => setPref({ size: "normal" })}>
                {t("reader.normal")}
              </button>
              <button type="button" aria-pressed={size === "large"} onClick={() => setPref({ size: "large" })}>
                {t("reader.large")}
              </button>
            </div>
          </div>
        )}
      </header>
      <div className="hh-reader-columns">
        {doc?.ok && !source && (outline.length > 0 || (check && check.missing.length > 0)) && (
          <nav className="hh-reader-toc" aria-label={t("reader.contents")}>
            <ol>
              {outline.map((h) => (
                <li key={h.id} className={`hh-toc-${h.depth}`}>
                  <a
                    href={`#${h.id}`}
                    aria-current={current === h.id ? "location" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      jumpTo(h.id);
                    }}
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ol>
            {check && check.missing.length > 0 && (
              <p className="hh-reader-template" role="note">
                {t("reader.templateLabel")} <strong>{check.kind}</strong>: {t("reader.missing", { count: check.missing.length })}{" "}
                <strong>{check.missing.join(", ")}</strong>.
              </p>
            )}
          </nav>
        )}
        <div className="hh-reader-scroll" ref={scrollRef} onScroll={() => setCurrent(headingAtTop(scrollRef.current))}>
          <article className={`hh-reader-doc hh-reader-${font}${size === "large" ? " hh-reader-large" : ""}`}>{body}</article>
        </div>
      </div>
    </aside>
  );
}
```

The template note's text content must read exactly `Template analysis: missing section Risks.`: with the JSX above it is `Template` + space + `analysis` + `: ` + `missing section` + space + `Risks` + `.`. Check it in the test run; adjust spaces in the JSX, not in the strings, if it differs.

- [ ] **Step 4: Strings**

`en.json` under `reader`:

```json
    "title": "Document",
    "path": "Path",
    "contents": "Contents",
    "loading": "Opening the document…",
    "close": "Close",
    "fullScreen": "Full screen",
    "showChat": "Show chat",
    "prefs": "Reading preferences",
    "sans": "Sans",
    "serif": "Serif",
    "normal": "Normal",
    "large": "Large",
    "changed": "Changed {{date}}",
    "minutes_one": "{{count}} min read",
    "minutes_other": "{{count}} min read",
    "writtenBy": "Written by {{agent}}",
    "unknownKind": "unknown kind",
    "badStatus": "Not one of: {{allowed}}",
    "templateLabel": "Template",
    "missing_one": "missing section",
    "missing_other": "missing sections",
    "truncated": "Showing the first {{shown}} of {{size}}. Open Source to see all of it.",
    "tooLarge": "This document is too large to show ({{size}}).",
    "moved": "This document was moved or deleted.",
    "problem": {
      "missing": "This document was moved or deleted.",
      "outside": "This file is outside your folder.",
      "not-markdown": "Only Markdown documents open here.",
      "not-ready": "Choose your folder first.",
      "too-large": "This document is too large to show."
    },
```

- [ ] **Step 5: Styles**

```css
.hh-reader { display: flex; flex-direction: column; min-width: 0; flex: 0 0 55%; border-left: 1px solid var(--hh-line); background: var(--hh-surface); }
.hh-reader-bar { position: relative; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--hh-line); }
.hh-reader-crumbs { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 12px; color: var(--hh-muted); }
.hh-reader-crumbs li + li::before { content: "/"; margin-right: 4px; color: var(--hh-line-strong); }
.hh-reader-crumbs li[aria-current="page"] { color: var(--hh-ink); font-weight: 600; }
.hh-reader-actions { display: flex; gap: 6px; margin-left: auto; }
.hh-reader-actions button[aria-pressed="true"] { background: var(--hh-segment); }
.hh-reader-prefs { position: absolute; right: 12px; top: calc(100% + 4px); z-index: 2; display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--hh-line); border-radius: 8px; background: var(--hh-surface); }
.hh-reader-prefs button[aria-pressed="true"] { background: var(--hh-ink); color: var(--hh-on-ink); }
.hh-reader-columns { display: flex; flex: 1; min-height: 0; }
.hh-reader-toc { flex: 0 0 200px; overflow-y: auto; padding: 16px 12px; border-right: 1px solid var(--hh-line); font-size: 13px; }
.hh-reader-toc ol { margin: 0; padding: 0; list-style: none; }
.hh-reader-toc li { margin: 2px 0; }
.hh-reader-toc .hh-toc-3 { padding-left: 12px; }
.hh-reader-toc a { color: var(--hh-slate); text-decoration: none; }
.hh-reader-toc a[aria-current="location"] { color: var(--hh-ink); font-weight: 600; }
.hh-reader-template { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--hh-line); color: var(--hh-warn); font-size: 12px; }
.hh-reader-scroll { flex: 1; overflow-y: auto; padding: 24px 32px 48px; }
.hh-reader-doc { max-width: 72ch; margin: 0 auto; line-height: 1.6; font-size: 15px; }
.hh-reader-serif { font-family: Charter, "Iowan Old Style", Georgia, serif; }
.hh-reader-large { font-size: 18px; }
.hh-reader-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; color: var(--hh-muted); }
.hh-reader-title { font-family: var(--hh-display); font-size: 1.9em; line-height: 1.2; margin: 0.4em 0 0.6em; }
.hh-chip { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 10px; background: var(--hh-segment); color: var(--hh-slate); font-size: 12px; }
.hh-chip-muted { color: var(--hh-muted); }
.hh-reader-source { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.hh-reader-problem, .hh-reader-truncated { color: var(--hh-muted); }
@media (max-width: 1100px) { .hh-reader-toc { display: none; } }
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/document-reader.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`. Expected: green.

```bash
git -C <worktree> add packages/ui/src/DocumentReader.tsx packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/ui/test/document-reader.test.tsx
git -C <worktree> commit -m "feat(ui): the document reader panel"
```

---

### Task 16: Cards in the chat, and the panel beside it

**Files:**
- Create: `packages/ui/src/DocumentCards.tsx`
- Modify: `packages/ui/src/Message.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/document-cards.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/document-cards.test.tsx`. Use the chat setup the other ChatView tests use (`packages/ui/test/flow.test.tsx` or `working.test.tsx`: a `FakeClient`, `HarnessApp` or `ChatView` rendered with `renderIn`, and `client.emit(...)` to play a turn). The sketch below uses `ChatView` directly with a state from `client.state`; copy the exact props from the existing tests.

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../src/ChatView";
import type { ChatEntry } from "../src/client";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const card = { path: "tickets/MUS-412/analysis.md", title: "Analysis", kind: "analysis", change: "new" as const, words: 460 };
const answer = (documents?: ChatEntry["documents"]): ChatEntry => ({
  id: "a1",
  role: "assistant",
  text: "I wrote the analysis.",
  blocks: [],
  activities: [],
  at: "2026-10-27T10:00:00.000Z",
  engine: "claude",
  ...(documents ? { documents } : {}),
});

async function chatWith(entries: ChatEntry[], docs: Record<string, string> = {}) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  client.chat = entries;
  Object.assign(client.documents, docs);
  const exists = vi.spyOn(client, "documentsExist");
  await renderIn("en", <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} />);
  return { client, exists };
}

describe("document cards (§5.1)", () => {
  it("a card per document with its title, kind, new or updated and reading time; it opens the reader", async () => {
    await chatWith([answer([card])], { [card.path]: "# Analysis\n\n## Context\n" });
    const button = await screen.findByRole("button", { name: /Analysis/ });
    expect(button.textContent).toContain("analysis");
    expect(button.textContent).toContain("New");
    expect(button.textContent).toContain("2 min read");
    fireEvent.click(button);
    const reader = await screen.findByRole("complementary", { name: "Document" });
    expect(await within(reader).findByRole("heading", { name: "Context" })).toBeTruthy();
    expect(within(reader).getByText("Written by Claude")).toBeTruthy();
  });

  it("a moved or deleted document's card is struck through and does nothing", async () => {
    await chatWith([answer([card])]);
    const button = await screen.findByRole("button", { name: /Analysis/ });
    await vi.waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(button);
    expect(screen.queryByRole("complementary", { name: "Document" })).toBeNull();
  });

  it("D0: no cards, no existence check, no panel", async () => {
    const { exists } = await chatWith([answer()]);
    await screen.findByText("I wrote the analysis.");
    expect(exists).not.toHaveBeenCalled();
    expect(document.querySelector(".hh-doc-cards")).toBeNull();
  });

  it("client.openDocument opens the panel; full screen hides the chat; a .md link in the chat opens the reader", async () => {
    const { client } = await chatWith([{ ...answer(), text: "See [the plan](docs/plan.md)." }], { "docs/plan.md": "# Plan", "x.md": "# X" });
    act(() => client.openDocument("x.md"));
    const reader = await screen.findByRole("complementary", { name: "Document" });
    expect(await within(reader).findByRole("heading", { name: "X" })).toBeTruthy();
    fireEvent.click(within(reader).getByRole("button", { name: "Full screen" }));
    expect(document.querySelector(".hh-body.hh-reader-full")).not.toBeNull();
    fireEvent.click(within(reader).getByRole("button", { name: "Show chat" }));
    expect(document.querySelector(".hh-body.hh-reader-full")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "the plan" }));
    expect(await within(reader).findByRole("heading", { name: "Plan" })).toBeTruthy();
  });

  it("reading preferences are saved with the app config", async () => {
    const { client } = await chatWith([answer([card])], { [card.path]: "# A" });
    const save = vi.spyOn(client, "saveConfig");
    fireEvent.click(await screen.findByRole("button", { name: /Analysis/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Reading preferences" }));
    fireEvent.click(screen.getByRole("button", { name: "Large" }));
    expect(save).toHaveBeenCalledWith({ reader: { font: "sans", size: "large" } });
  });
});
```

(If `FakeClient` names its saved chat differently than `chat`, or `ChatView` needs more props, use the names the existing tests use. The behaviour under test stays the same.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/document-cards.test.tsx`
Expected: FAIL (no cards, no panel).

- [ ] **Step 3: The cards**

Create `packages/ui/src/DocumentCards.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { readingMinutes } from "@humanharness/harness-sdk/documents";
import type { DocumentCard } from "./client";

/** The `.md` files an answer's turn added or changed (document-reader spec §5.1). */
export function DocumentCards({ cards, missing, onOpen }: { cards: DocumentCard[]; missing: ReadonlySet<string>; onOpen: (card: DocumentCard) => void }) {
  const { t } = useTranslation();
  return (
    <ul className="hh-doc-cards" aria-label={t("reader.cards")}>
      {cards.map((c) => {
        const gone = missing.has(c.path);
        return (
          <li key={c.path}>
            <button
              type="button"
              className={gone ? "hh-doc-card hh-doc-card-missing" : "hh-doc-card"}
              aria-disabled={gone || undefined}
              title={gone ? t("reader.moved") : c.path}
              onClick={() => {
                if (!gone) onOpen(c);
              }}
            >
              <span className="hh-doc-card-title">{c.title}</span>
              <span className="hh-doc-card-meta">
                {c.kind && <span className="hh-chip">{c.kind}</span>}
                <span>{t(c.change === "new" ? "reader.new" : "reader.updated")}</span>
                <span>{t("reader.minutes", { count: readingMinutes(c.words) })}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

`en.json` under `reader`: `"cards": "Documents from this answer", "new": "New", "updated": "Updated",`.

- [ ] **Step 4: The message draws them**

In `packages/ui/src/Message.tsx`:
- import `{ DocumentCards }` and the `DocumentCard` type;
- add `"documents"` to the `Pick<ChatEntry, …>` of `entry`;
- add a prop:

```ts
  /** The chat's handling of document cards (document-reader spec §5.1); absent: cards are not drawn. */
  documents?: { missing: ReadonlySet<string>; open(card: DocumentCard): void };
```

- after the `<Answer … />` of an assistant entry, add:

```tsx
      {entry.role === "assistant" && documents && entry.documents && entry.documents.length > 0 && (
        <DocumentCards cards={entry.documents} missing={documents.missing} onOpen={documents.open} />
      )}
```

- [ ] **Step 5: The chat hosts the panel**

In `packages/ui/src/ChatView.tsx`:

Imports:

```ts
import { DocumentContext, type DocumentHost } from "./documents-context";
import { DocumentReader, type ReaderTarget } from "./DocumentReader";
import type { DocumentCard, ReaderPrefs } from "./client";
```

(merge the type imports into the existing import from `./client`).

State, next to `notesPanel`:

```ts
  /** The document reader beside the chat (document-reader spec §5); null: closed. */
  const [reader, setReader] = useState<ReaderTarget | null>(null);
  const [readerFull, setReaderFull] = useState(false);
  const [readerPrefs, setReaderPrefs] = useState<ReaderPrefs>(state.config.reader ?? {});
  /** Card paths that are no longer there (struck through). */
  const [missingDocs, setMissingDocs] = useState<ReadonlySet<string>>(new Set());
```

After the first `useEffect` (the one that loads the chat), add:

```ts
  // The harness's own UI may open a document (`client.openDocument`).
  useEffect(() => client.onOpenDocument((p) => setReader({ path: p })), [client]);
```

Before `return (`, add:

```ts
  const openDoc = (path: string, anchor?: string) => setReader({ path, ...(anchor ? { anchor } : {}) });
  const documentHost = useMemo<DocumentHost>(
    () => ({ open: openDoc, image: (p) => client.readImage(p).catch(() => null), ...(state.documents ? { kinds: state.documents.kinds } : {}) }),
    [client, state.documents],
  );
  /** The engine's name for an entry's `engine` id, else the configured engine's. */
  const engineName = (id: string | undefined) => state.engines.find((e) => e.id === id)?.name ?? engine;
  const cardsFor = (entry: ChatEntry) => ({
    missing: missingDocs,
    open: (card: DocumentCard) => setReader({ path: card.path, agent: engineName(entry.engine) }),
  });
  const savePrefs = (p: ReaderPrefs) => {
    setReaderPrefs(p);
    client.saveConfig({ reader: p }).catch(() => undefined);
  };
```

`useMemo` must be called before any early return and in the same order every render: put `documentHost` next to the other `useMemo` calls near the top (after `stale`), not after conditional code. Move `openDoc` there too (it only calls `setReader`).

The card existence check, after the `shown` constant is computed — it is computed late in the component, so compute the key there and run the effect with it (hooks must stay unconditional; put the `useEffect` right after `shown`, which is not inside a condition):

```ts
  const cardPaths = shown.flatMap((e) => e.documents?.map((d) => d.path) ?? []);
  const cardKey = cardPaths.join("\n");
  useEffect(() => {
    // D0: no cards, no call.
    if (!cardKey) return;
    let live = true;
    const paths = cardKey.split("\n");
    client.documentsExist(paths).then(
      (found) => live && setMissingDocs(new Set(paths.filter((_, i) => !found[i]))),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, cardKey]);
```

In the JSX:
- wrap everything inside the outer `<div className={slim ? …}>` in `<DocumentContext.Provider value={documentHost}>…</DocumentContext.Provider>`;
- change `<div className="hh-body">` to:

```tsx
      <div className={`hh-body${reader && !slim ? " hh-with-reader" : ""}${reader && readerFull && !slim ? " hh-reader-full" : ""}`}>
```

- pass the cards to each `Message`: add `documents={cardsFor(entry)}`;
- after `{renderSide && !slim && …}`, add:

```tsx
        {reader && !slim && (
          <DocumentReader
            key={reader.path}
            client={client}
            target={reader}
            kinds={state.documents?.kinds}
            prefs={readerPrefs}
            onPrefs={savePrefs}
            full={readerFull}
            onFull={setReaderFull}
            onClose={() => {
              setReader(null);
              setReaderFull(false);
              inputRef.current?.focus();
            }}
            onOpen={openDoc}
          />
        )}
```

- [ ] **Step 6: Styles**

```css
.hh-reader-full .hh-main, .hh-reader-full .hh-flow-side, .hh-reader-full .hh-side { display: none; }
.hh-reader-full .hh-reader { flex: 1 1 auto; border-left: none; }
.hh-with-reader .hh-side { display: none; }
.hh-doc-cards { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 0; padding: 0; list-style: none; }
.hh-doc-card { height: auto; flex-direction: column; align-items: flex-start; gap: 2px; padding: 8px 12px; text-align: left; border-radius: 8px; }
.hh-doc-card-title { font-weight: 600; }
.hh-doc-card-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--hh-muted); }
.hh-doc-card-missing { opacity: 0.6; }
.hh-doc-card-missing .hh-doc-card-title { text-decoration: line-through; }
```

(The harness side panel hides while the reader is open: three columns do not fit a 1100 px window. See Q13.)

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/document-cards.test.tsx packages/ui/test/flow.test.tsx packages/ui/test/HarnessApp.test.tsx`
Expected: PASS, and the existing chat tests unchanged.

- [ ] **Step 8: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`. Expected: green.

```bash
git -C <worktree> add packages/ui/src/DocumentCards.tsx packages/ui/src/Message.tsx packages/ui/src/ChatView.tsx packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/ui/test/document-cards.test.tsx
git -C <worktree> commit -m "feat(ui): document cards under answers and the reader beside the chat"
```

---

### Task 17: The SDK exports `<Markdown>`

**Files:**
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/test/markdown.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `packages/ui/test/markdown.test.tsx`:

```tsx
import * as sdk from "../src/index";

describe("SDK export (§5.1)", () => {
  it("harness views render documents with the same component", () => {
    const { container } = render(<sdk.Markdown source={"---\ntitle: T\n---\n## Hello"} document path="docs/a.md" />);
    expect(container.querySelector("h2")?.textContent).toBe("Hello");
    expect(container.textContent).not.toContain("title:");
    expect(typeof sdk.DocumentContext).toBe("object");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/ui/test/markdown.test.tsx`
Expected: FAIL (`sdk.Markdown` is undefined).

- [ ] **Step 3: Export**

In `packages/ui/src/index.ts`, add:

```ts
export { Markdown, type MarkdownProps } from "./markdown";
export { DocumentContext, type DocumentHost } from "./documents-context";
```

- [ ] **Step 4: Run, typecheck, test, build, commit**

Run: `corepack pnpm vitest run packages/ui/test/markdown.test.tsx`, then `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`. Expected: green.

```bash
git -C <worktree> add packages/ui/src/index.ts packages/ui/test/markdown.test.tsx
git -C <worktree> commit -m "feat(ui): export Markdown for harness views"
```

---

### Task 18: End to end in mock mode

**Files:**
- Create: `packages/e2e/fixtures/reader-mock/manifest.json`
- Create: `packages/e2e/tests/reader.spec.ts`

- [ ] **Step 1: The recording**

Create `packages/e2e/fixtures/reader-mock/manifest.json` (a recording for the demo's `manifest` topic that writes two documents, then rewrites one; mock mode plays it with fake-claude, spec 3e):

```json
{
  "version": 1,
  "action": "manifest",
  "match": "# Topic: the manifest",
  "recordedWith": "claude",
  "fallback": { "text": "Not recorded." },
  "turns": [
    {
      "id": "t1",
      "text": "I wrote an overview of the manifest.",
      "writes": [
        {
          "path": "docs/overview.md",
          "content": "---\ntitle: Manifest overview\n---\n> [!SUMMARY]\n> The manifest declares the whole harness.\n\n## Context\n\nSee the [decisions](decisions.md#why).\n\n## Parts\n\n| Part | Count |\n|:--|--:|\n| actions | 6 |\n| blocks | 2 |\n\n*What a harness declares*\n\n## Risks\n\nNone yet.\n"
        },
        { "path": "docs/decisions.md", "content": "# Decisions\n\n## Why\n\nOne file declares everything.\n" }
      ],
      "usage": { "input": 1000, "output": 100, "cacheRead": 0, "cacheWrite": 0 },
      "next": { "*": "t2" }
    },
    {
      "id": "t2",
      "text": "I added a section on blocks.",
      "writes": [
        {
          "path": "docs/overview.md",
          "content": "---\ntitle: Manifest overview\n---\n> [!SUMMARY]\n> The manifest declares the whole harness.\n\n## Context\n\nSee the [decisions](decisions.md#why).\n\n## Parts\n\nActions and blocks.\n\n## Blocks\n\nBlocks are cards the agent shows.\n\n## Risks\n\nNone yet.\n"
        }
      ],
      "usage": { "input": 1200, "output": 120, "cacheRead": 0, "cacheWrite": 0 }
    },
    {
      "id": "close",
      "note": { "title": "Manifest overview", "summary": ["Wrote the overview"], "decisions": [], "files": ["docs/overview.md"], "open": [] }
    }
  ]
}
```

Check the closing turn's shape against `harnesses/demo/mock/manifest.json` (its `close` turn) and copy it if it differs.

- [ ] **Step 2: The test**

Create `packages/e2e/tests/reader.spec.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox } from "./helpers";

const readerMock = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/reader-mock");
const START = "Which part do you want to understand?";
const COMPOSER = "Ask about this topic…";

test("a turn's document: card, reader, contents, full screen, a .md link, live reload", async () => {
  const s = makeSandbox("reader");
  const { app, page } = await launchMock(s, readerMock);
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();

    // The card opens the reader.
    const card = page.getByRole("button", { name: /Manifest overview/ }).first();
    await expect(card).toContainText("New");
    await page.getByRole("button", { name: /Decisions/ }).waitFor();
    await card.click();
    const reader = page.getByRole("complementary", { name: "Document" });
    await expect(reader.getByRole("heading", { level: 1, name: "Manifest overview" })).toBeVisible();
    await expect(reader.locator(".hh-callout-summary")).toBeVisible();
    await expect(reader.locator(".hh-md-caption")).toHaveText("What a harness declares");

    // The table of contents jumps.
    await reader.getByRole("navigation", { name: "Contents" }).getByRole("link", { name: "Risks" }).click();
    await expect(reader.getByRole("heading", { name: "Risks" })).toBeInViewport();

    // Full screen and back.
    await reader.getByRole("button", { name: "Full screen" }).click();
    await expect(page.getByPlaceholder(COMPOSER)).toBeHidden();
    await reader.getByRole("button", { name: "Show chat" }).click();
    await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();

    // A .md link between documents, at its anchor.
    await reader.getByRole("link", { name: "decisions" }).click();
    await expect(reader.getByRole("heading", { name: "Why" })).toBeVisible();

    // Live reload: the agent rewrites the open document.
    await card.click();
    await expect(reader.getByRole("heading", { name: "Context" })).toBeVisible();
    await page.getByPlaceholder(COMPOSER).fill("Add a section on blocks.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(reader.getByRole("heading", { name: "Blocks" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Manifest overview.*Updated/ })).toBeVisible();
  } finally {
    await closeAndClean(app, s);
  }
});
```

- [ ] **Step 3: Run it**

Run: `corepack pnpm e2e`
Expected: every spec passes, `reader.spec.ts` included. If the mock refuses the writes (the demo has `edit: "none"`), check `packages/fake-agent/src/mock-claude.ts`: mock writes are applied by the fake engine whatever the harness permissions. If that assumption is wrong, build a fixture harness with `edit: "folder"` the way `material.spec.ts` builds `material-harness`, and point the test at it.

- [ ] **Step 4: Commit**

```bash
git -C <worktree> add packages/e2e/fixtures/reader-mock packages/e2e/tests/reader.spec.ts
git -C <worktree> commit -m "test(e2e): document cards, reader, links and live reload in mock mode"
```

---

### Task 19: Docs

**Files:**
- Create: `docs/architecture/documents.md`
- Modify: `docs/architecture/manifest.md`, `docs/architecture/history.md`, `docs/architecture/turn.md`, `docs/architecture/mock-mode.md`
- Modify: `docs/superpowers/specs/2026-10-27-document-reader-design.md` (status line)
- Modify (only if it lists manifest fields): `packages/cli/src/guide.ts`

- [ ] **Step 1: `docs/architecture/documents.md`**

Write, in the style of the other architecture docs (short paragraphs, file paths in backticks):
- **Renderer.** `packages/ui/src/markdown.tsx`: remark-parse + remark-gfm to mdast, mdast to React by our own walker; no raw-HTML path; `html` nodes as text. What each element becomes (one line each, from spec §3.2). `markdownToPlain` lives in `markdown-plain.ts`, unchanged since plan 10.
- **Links and images.** `doc-links.ts` rules; external links go through `setWindowOpenHandler`; images through `hh:readImage`.
- **Mermaid.** Lazy `import("mermaid")`, strict, drawn one at a time, shown as an `<img>` data URL; unclosed fences show their source.
- **Cards.** `packages/runtime/src/documents.ts`: the diff between the "Before message" and "Turn: …" commits, `.md` only, never `.harness/`, at most 20; the `documents` event; `ChatEntry.documents`; `humanharness run` prints them.
- **Reader.** `DocumentReader.tsx`; `hh:readDocument` and its refusals; `DocumentWatchers` (folder watch, 150 ms); reading preferences in `AppConfig.reader`; the template check (`checkTemplate`, warns only).
- **Agents.** The "Writing for the reader" part of `AGENTS.md` and the "Document kinds" part (`writingLines`).
- **D0.** What a harness without `documents` keeps.

- [ ] **Step 2: The other docs**

- `manifest.md`: the `documents.kinds` field, its rules (id pattern, `when`, `sections`, `status`, no section twice), and an example (spec §4.2's).
- `history.md`: one paragraph: the runtime reads `History.changes(before, after)` after a successful turn to make document cards.
- `turn.md`: the `documents` event, sent right before `done` on a successful turn that changed `.md` files.
- `mock-mode.md`: a recording's `writes` may hold `.md` files; they become cards like a real turn's.
- `packages/cli/src/guide.ts`: run `grep -n "material" packages/cli/src/guide.ts`. If the guide lists manifest fields for `/new-harness`, add one line for `documents` ("kinds of documents your agent writes, each with its `##` sections; the reader checks them and only warns"). If it does not, change nothing.

- [ ] **Step 3: The spec's status**

In `docs/superpowers/specs/2026-10-27-document-reader-design.md`, change the first paragraph's "Status: approved by Marco on 2026-10-27, section by section." to "Status: approved by Marco on 2026-10-27, section by section; implemented by plan 10 (`docs/superpowers/plans/2026-10-27-document-reader.md`) on `feat/document-reader`."

- [ ] **Step 4: Commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test` (a guide change may have a test). Expected: green.

```bash
git -C <worktree> add docs packages/cli/src/guide.ts
git -C <worktree> commit -m "docs: the document reader in the architecture docs"
```

---

## Self-review against the spec

| Spec | Task |
|---|---|
| D1 one renderer, remark + GFM, no raw HTML | 5, 6, 7, 8 |
| D2 Mermaid only, local, strict | 9 |
| D3 reader panel, full screen; cards, links, `client.openDocument` | 11, 15, 16 |
| D4 base guide always + kinds | 4 |
| D5 template check only warns | 2, 15 |
| §3.1 pipeline, `markdownToPlain` kept | 5 |
| §3.2 headings with ids, tables, Mermaid, callouts, code, inline marks, links, task lists, footnotes, images, front-matter, captions | 5–9, 15 |
| §3.3 lazy, strict, theme, streaming, parse error | 9 |
| §3.4 link rules | 7 |
| §4.1 base guide content | 4 |
| §4.2 kinds schema and AGENTS.md listing | 3, 4 |
| §4.3 template check table | 2, 15 |
| §5.1 cards from the turn's commits, saved, title fallback, 230 wpm; links; `openDocument`; SDK `<Markdown>` | 2, 12, 13, 16, 17 |
| §5.2 layout: breadcrumbs, full screen, close, contents, column width, chips, mtime, reading time, agent, preferences, Source | 14, 15, 16 |
| §5.3 `hh:readDocument`, live reload, terminal, mock mode | 10, 11, 13, 18 |
| §6 errors table | 9, 10, 15, 16 |
| §7 tests | every task; e2e in 18 |
| §8 out of scope | nothing built for C2, C3, C4, editing, export, remote images |

## Open questions

Each has the default this plan uses. They will be taken as decided unless Marco says otherwise.

- **Q1. The base writing guide vs. D0.** Spec D4 says every harness gets the "Writing for the reader" part; the D0 rule says harnesses that don't use the feature stay byte for byte. *Default:* follow D4. `managedSection` called without `writing` stays exactly as today (all existing D0 tests unchanged), but the runtime always passes it, so every harness's `AGENTS.md` gains the guide once (one rewrite between tasks; the engine's cached prefix is rebuilt once). The runtime D0 test is updated in Task 4.
- **Q2. The chat's Markdown changes for every harness.** Real headings instead of bold lines, clickable `http(s)` links (with the domain shown), tables, diagrams. *Default:* yes (spec D1). The read-aloud text (`markdownToPlain`) does not change.
- **Q3. Cards for every harness.** A turn that adds or changes an `.md` gets cards, whether or not the harness declares kinds. *Default:* yes (spec §5.1). Files under `.harness/` (notes, data) never get a card.
- **Q4. A relative link to a file that is not `.md`** (`src/a.ts`). *Default:* plain text with the path in brackets, as today. Opening code files is a later feature (dev harness explorer).
- **Q5. Which local images.** *Default:* PNG, JPEG, GIF and WebP up to 5 MB. No SVG (it can carry scripts and links; drawing it safely is more work than it is worth now).
- **Q6. A very large document.** The spec covers over 1 MB (first 200 KB plus a notice). *Default:* over 10 MB the reader refuses it ("This document is too large to show (12.3 MB).") so the window never receives a huge string.
- **Q7. Where the reading preferences live in the UI.** *Default:* only in the reader's "Aa" menu, saved in the app config. No row in Settings › General.
- **Q8. Diagrams as images.** Drawing the SVG as an `<img>` is the safest choice but its text cannot be selected or found with ⌘F. *Default:* image; the Source toggle shows the text. A later change can inline sanitized SVG if people miss it.
- **Q9. Highlighted languages.** *Default:* bash, CSS, diff, Go, Java, JavaScript, JSON, Markdown, Python, Rust, SQL, TypeScript, XML/HTML, YAML (plus their common aliases).
- **Q10. The demo's own recordings.** The demo is read-only (`edit: "none"`), so its real agent never writes documents. *Default:* the demo's recordings stay as they are; the e2e uses its own recording (`packages/e2e/fixtures/reader-mock`). Adding a document to the demo's tour is a separate decision.
- **Q11. "The agent of that turn" on the reader's header.** *Default:* the engine's name (Claude, Codex, OpenCode) from the chat entry, not the model.
- **Q12. Links inside a reference folder's document.** Paths resolve from the document's own folder and are looked up in the person's folder first, then the reference folders (the same order as Open and Show in Finder). *Default:* keep that order; a same-named file in the person's folder wins.
- **Q13. Three columns.** With the reader open, the harness's own side panel (`renderSide`) is hidden; the flow side panel stays. *Default:* yes, until the mockup says otherwise for wide windows.
- **Q14. Escape.** *Default:* Escape closes the reader when focus is inside it; it never closes it from the composer.
- **Q15. Spec file on the branch.** The spec is on `origin/master` but not on `feat/opencode`. *Default:* Task 0 checks it out from `origin/master` into the plan 10 branch, so the stacked PR carries it.
