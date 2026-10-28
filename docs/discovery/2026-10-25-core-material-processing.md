# Core feature: material processing (process definition)

Status: proposal, 2026-10-25, waiting for Marco's review. This is discovery output; when it graduates it becomes a spec under `docs/superpowers/specs/`.

Marco's decisions (2026-10-25):
- Material processing is a **core** feature every harness uses, not a student feature.
- At core level we define the **process**, not screens. The process must make sure the material is stored and used optimally and serves each app's purposes.
- The material is converted to a format that is **easy to access** and **split into fragments**, so it never becomes one huge source of information.
- The app **warns the person** that large files make processing costly.
- **No OCR, no photos, no scans.** The app accepts only material that already contains text. Photos and scanned pages are refused, and the app says why.
- **A program does the work; the AI comes in only where it is really needed.** The AI must still **validate what the program produced**, and decide what to do when the result is not good.

## Goal

When the person adds material (digital PDF, links, text), the app turns it once into a set of small Markdown fragments that:

1. **Are correct.** The AI validates the conversion before anything is built on it, and every fragment points back to its place in the original.
2. **Are cheap to use.** A session loads a short summary plus only the fragments it needs, never the whole material.
3. **Serve the harness.** The harness declares what it needs from the material, and the core produces exactly that.

This is pillar 3 (context and resource management) applied to the person's material.

## Principles

- **The original is never changed.** Only the original and the fragments are kept. There is no single big converted copy, so nothing large exists for an agent to load by mistake.
- **Plain Markdown, one small file per fragment.** Any engine can open a fragment with its normal read tool. The MCP tools only make it easier.
- **Only material that already contains text.** A program extracts the text of a digital PDF, a web page or a text file, at no model cost. There is no OCR and no AI transcription. Photos are refused at intake, and so are scanned pages (pages with no text layer).
- **Program first, AI to check and decide.**
  - Free program checks run on everything.
  - The AI reviews only what the checks flag, plus a small sample.
  - The AI decides the fix: re-convert, repair the structure, re-cut, drop noise, or ask the person.
  - It may fix structure but never change the content (see "Validation").
- **Process once, use many times.** A hash per file means unchanged files are never processed again.
- **Smallest tier that does the job.** Each stage has a default tier, and the person can change it like any other process (Settings › Modelos).
- **Load little, fetch on demand.**
- **Engine-neutral.** Only what both engines share: the instructions file, MCP tools, and new or resumed sessions (`docs/architecture/context.md`).

## Concepts

- **Source.** One file or link the person added.
- **Scope.** What the material belongs to, declared by the harness. Student: a topic. Dev: a project.
- **Fragment.** One Markdown file of about 150–800 tokens: one section of a source, with its location, heading path, kind, summary and keywords.
- **Index.** One table per scope listing every fragment in one line each. The agent scans it to choose what to open.
- **Material sheet.** A short structured note per scope, at most about 800 tokens, with sections the harness declares. It is the only material text loaded in every session.
- **Item.** The harness's unit that fragments link to. Student: a map concept. Dev: a ticket or an acceptance criterion.
- **Grounding mode.**
  - `strict`: only the material.
  - `mixed`: material plus the AI's knowledge, kept apart.
  - `off`: material as optional reference.

## How a file becomes stored information

### 1. Where things live

```
<person's folder>/
  material/
    fracciones/                       ← originals, visible, never changed
      Fracciones-cap2.pdf
      apunte-equivalentes.md
.harness/material/
  fracciones/                         ← one folder per scope, derived, owned by the app
    sources.json                      ← one entry per original
    sheet.md                          ← the material sheet
    index.md                          ← one line per fragment
    conflicts.md                      ← material vs AI disagreements
    fragments/
      fracciones-cap2-001.md
      fracciones-cap2-002.md
      …
      apunte-equivalentes-001.md
```

The originals sit in the visible folder, so the person owns them and the folder's history and backup cover them. Everything under `.harness/material/` can be rebuilt from the originals.

### 2. Translation by file type

Every type ends as the same thing: Markdown with location marks. That text exists only while the source is being processed. It is cut into fragments right away and never stored whole.

| Type | How it is read | Becomes Markdown how |
|---|---|---|
| PDF with text (digital) | Parser reads the text layer page by page | Font size and bold become headings (`#`, `##`). Bullets become lists, simple tables become Markdown tables, and formulas stay as text. Each page start gets a mark `<!-- p.4 -->`. A picture in the PDF becomes a placeholder `[figura, p.4]`; figures are not described. Running headers, footers and page numbers that repeat on every page are removed. Words split by end-of-line hyphens are joined. |
| Web link | Fetch the page and keep only the main content (drop menus, ads and footers) | HTML is converted to Markdown, and section headings become the location marks. The source keeps the fetch date, because the page can change later. |
| Text / Markdown | Read as is | Already Markdown. Paragraph numbers are used as locations. |

No step in this table uses a model.

**Refused at intake, with the reason shown to the person:**
- **Photos and images** (jpg, png, heic…): "La app no lee fotos ni imágenes: necesita material con texto, como un PDF digital, una página web o un archivo de texto."
- **Scanned PDFs.** The parser finds no text layer on a page, so that page is a scan.
  - Whole PDF scanned: refused.
  - Some pages scanned: the person is told which pages have no text and chooses to go on without them or to cancel. Those pages are recorded as `skipped: no-text`.
- **Protected or broken files** that cannot be opened.

Out of the first version: docx/pptx (open question), audio and video.

### 3. Cutting into fragments

The cut is done by a program, not by the model, so it is free and always gives the same result for the same file:

1. **Cut at headings first.** Each section (`#`, `##`, `###`) is a candidate fragment.
2. **Too long** (more than about 800 tokens): split at paragraph breaks into pieces of about 600 tokens. Never cut inside a paragraph, a list, a table or a numbered exercise and its solution.
3. **Too short** (under about 150 tokens): merge with the next section that has the same parent heading.
4. **Examples and exercises stay whole,** even if they exceed the target size, because half an exercise is useless.
5. **Each fragment carries its heading path** ("Fracciones › Equivalentes › Ejemplo 2"), so it makes sense when read alone.

Then the model (`light` tier, in batches of fragments) adds each fragment's kind, a one-line summary and keywords. It reads only the fragments, never the whole source at once.

### 4. What one fragment looks like

`fragments/fracciones-cap2-007.md`:

```markdown
---
id: fracciones-cap2-007
source: Fracciones-cap2.pdf
location: p.4–5
path: Fracciones › Fracciones equivalentes › Ejemplo 2
kind: example
summary: Obtiene 6/15 a partir de 2/5 multiplicando numerador y denominador por 3.
keywords: [equivalentes, multiplicar, numerador, denominador]
tokens: 240
items: [fracciones-equivalentes]
checks: ok            # program checks: ok | flagged (with the reasons)
validated: sample     # AI review: sample | flagged-reviewed | repaired | not-reviewed
---

## Ejemplo 2

Queremos una fracción equivalente a 2/5 con denominador 15.
Como 5 × 3 = 15, multiplicamos también el numerador por 3: 2 × 3 = 6.
Entonces 2/5 = 6/15.
```

A fragment the AI repaired keeps a copy of the program's version in `fragments/.orig/`, so the fix can be reviewed or undone.

### 5. The index and the sheet

`index.md` has one line per fragment. A 60-page PDF gives about 80 fragments, which is about 2,500 tokens for the whole index:

```markdown
| id | where | path | kind | summary | items |
|---|---|---|---|---|---|
| fracciones-cap2-006 | p.4 | Equivalentes › Definición | definition | Dos fracciones son equivalentes si representan la misma cantidad. | fracciones-equivalentes |
| fracciones-cap2-007 | p.4–5 | Equivalentes › Ejemplo 2 | example | 2/5 = 6/15 multiplicando por 3. | fracciones-equivalentes |
| apunte-equivalentes-001 | §1–4 | Ejercicios › Ejercicio 3 | exercise | Ordenar 1/2, 1/3, 1/4 de menor a mayor. | comparar-fracciones |
```

`sheet.md` is built from the summaries in the index, never from the full text. Its sections are the ones the harness declares, plus two that are always there:
- "notation and conventions";
- "what the material does not cover".

### 6. The registry

`sources.json` holds one entry per original:
- id, path or URL;
- hash, type, pages, size;
- pages skipped for having no text;
- status: `pending`, `converting`, `validating`, `needs-person`, `ready`, `refused` or `removed`;
- the quality report: the AI's verdict, the issues found and the fixes applied;
- the cost estimate and the real tokens used;
- the fragment ids.

The hash is what lets an unchanged file be skipped.

### 7. Validation: where the AI checks the program's work

Converting and cutting are done by a program, which is free but can fail in silent ways:
- a two-column page read in the wrong order;
- a document with no detectable headings that becomes one giant section;
- a broken table, or garbled characters from a bad font encoding;
- an index page or a bibliography cut into useless fragments.

So after cutting, the AI checks the result. To keep it cheap, the AI does not read everything.

**Step A: program checks.** Free, run on every fragment. Each check flags a fragment with a reason:
- **Garbled text:** too many non-letter characters, or broken encoding.
- **Reading order:** sentences that stop mid-line and continue elsewhere. This is the two-column symptom.
- **Bad cut:** a fragment far above or below the target size, or a source that produced only one or two fragments.
- **No structure:** no headings detected in a long source.
- **Broken table:** rows with different column counts.
- **Likely noise:** a table of contents, an index, a bibliography, or pages that are mostly numbers or dots.
- **Leftovers:** repeated text that survived header and footer removal.

**Step B: AI review.** One short system task per source, `standard` tier, with a bounded cost. The AI gets:
- the list of fragments: id, path, size and first line;
- every flagged fragment, in full;
- a sample of unflagged fragments: the first one plus about 10% of the rest, at most 15.

It returns a verdict for the source:
- **good**;
- **usable with fixes**;
- **not usable**.

For each fragment it reviewed, it returns one decision:

| Decision | When | Who carries it out |
|---|---|---|
| `ok` | The fragment reads well on its own | nothing to do |
| `repair` | Broken structure: lost headings, joined lists, a messy table, wrong line breaks | the AI rewrites the fragment's Markdown (`light` tier) |
| `merge` / `split` | The fragment is cut in a bad place (half an exercise, two topics in one) | the program re-cuts at the place the AI points to |
| `drop` | Noise: table of contents, index, bibliography, blank page | the program removes it and records why |
| `reconvert` | The same problem across the whole source (for example, columns) | the program converts again with other settings (column mode, another heading rule); then checks and review run once more |
| `ask` | The AI cannot fix it, or fixing it would mean guessing content | the person decides, through a core decision block |

**Rules the AI must follow:**
- **It may fix structure but never change content.** A repaired fragment must keep the same words as the original. The program compares the two, and if the words differ by more than a small margin (starting value: 2%), the repair is rejected and the decision becomes `ask`.
- **Systematic problems trigger a full review.** If the sample shows problems that the checks did not catch, the AI asks for a full review of that source. The cost warning applies again before it runs.
- **One re-conversion only.** If the result is still not usable after it, the source goes to the person:
  - process only some pages;
  - try another file (for example, a web version of the same text);
  - cancel.
- **Fragments are reviewed again during use.** When the labelling step (stage 6) or an agent in a task finds a fragment that does not make sense alone, it flags it, and that fragment goes back to step B. The fragment is not used until it is fixed.

**What the person sees.** A one-line summary per source, for example: "Listo: 82 fragmentos, 3 páginas de índice descartadas, 2 tablas corregidas". The person is only interrupted for `ask` decisions or for a source that is not usable.

## Cost warning before processing

Intake measures the file before any model runs and shows an estimate. The person chooses:
- go on;
- process only a page range;
- cancel.

- **What costs.**
  - Converting and cutting cost nothing.
  - The AI review costs a bounded amount per source.
  - Labelling grows with the material: about a few hundred tokens per fragment.
  - A full review or a re-conversion repeats part of that cost.
- **When to warn.** Above a size threshold. Starting value, to tune with measurements: more than 50 pages.
- **What the warning says.** The rule is set; the words are the harness's tone:
  - "This file is large: processing it uses about X% of your current usage window."
  - The tip: upload only the chapters you need.
- **Hard limit.** Above a maximum, the app asks for a page range instead of processing the whole file. Starting value: 300 pages or 50 MB.
- **Where the estimate comes from.** Measured pages × tokens per page, from `usage.jsonl`, shown against the engine's reported usage window (core usage awareness). No made-up prices.

## The process, stage by stage

Each processing stage is a **core system task**: a short engine session of its own, never mixed with the person's task. Long material goes in batches, so each session's context stays small.

| # | Stage | What it does | Who / tier (default) | Output |
|---|---|---|---|---|
| 0 | Intake | Refuse photos, images and scanned pages, and give the reason. Copy the file into `material/<scope>/` and hash it (a duplicate is skipped). Measure it, estimate the cost, warn, and let the person choose a page range. | core, no model | `sources.json` entry |
| 1 | Convert | Turn the file into Markdown with location marks, using a parser. | program, no model | Markdown in memory |
| 2 | Cut | Cut into fragments with the rules above. | program, no model | `fragments/*.md` |
| 3 | Check | Run the program checks and flag fragments. | program, no model | `checks` in the front matter |
| 4 | Validate | The AI reviews the flagged fragments plus a sample. It gives a verdict and one decision per fragment: `ok`, `repair`, `merge`/`split`, `drop`, `reconvert` or `ask`. | review `standard`; repairs `light`; the person only for `ask` | fixed fragments, quality report |
| 5 | Re-check | Run the checks again on what changed, and compare the words of repaired fragments against the program's version. | program, no model | `validated` in the front matter |
| 6 | Label | Add kind, summary and keywords to each fragment, in batches. This step can still flag a bad fragment, which goes back to stage 4. | `light` | fragment front matter, `index.md` |
| 7 | Sheet | Build the sheet from the index. | `light` | `sheet.md` |
| 8 | Link | Match the harness's items to fragments using summaries and keywords. Compute coverage: items with no fragment, fragments with no item. Note disagreements between the material and general knowledge. | `standard` (correctness matters) | `items` in front matter and index, `conflicts.md` |
| 9 | Hand-off | The harness gets the sheet, the links and the coverage for its flow (student: build or adjust the map). The person confirms any change to their items. | harness flow | the harness's data |

Use, every time a task runs:

| # | Stage | What it does |
|---|---|---|
| 10 | Load | The task's first message gets `sheet.md` plus only the index lines of the task's items, within the harness's token budget. |
| 11 | Fetch | The agent opens full fragments when it needs them, either through MCP tools (`material_read(id)`, `material_search(query)`, a local keyword search with no embeddings and no API key) or with its own read tool on the fragment file. A fragment that does not make sense on its own is flagged with `material_flag(id, reason)` and goes back to stage 4. |
| 12 | Ground | The managed section of `AGENTS.md` adds the rules of the active mode (below). Citations are written `[[frag:<id>]]`, and the UI shows them as "tu libro, p. 4", linked to the source. |
| 13 | Update | A new or changed file goes through stages 0–9 for that source only. A removed source retires its fragments and flags the items it leaves without material. |

## Grounding rules

- **strict.** Answer only from fragments, citing them. If the material does not cover something, say so and offer to switch to mixed for that question. Never fill the gap silently.
- **mixed.** Fragments first, cited. What comes from the AI's own knowledge is marked apart, both in the text and in the UI.
- **Conflict, in any mode.** When the material differs from the AI's knowledge (notation, a teacher's method, a project convention), the material wins. The AI flags the difference once and records it in `conflicts.md`, so it is not raised again.
- The mode is set per scope. The harness gives the default and says whether the person may change it.

## What the harness declares

A `material` field in the manifest. Sketch; the names are not final:

```ts
material: {
  accepts: ['pdf', 'url', 'text'],      // only material with text; images are never accepted
  scope: 'topic',
  sheet: {
    sections: [
      { id: 'terms', label: 'Términos', prompt: 'Términos y definiciones como los usa el material' },
      { id: 'examples', label: 'Ejemplos y ejercicios', prompt: '…' },
    ],
    maxTokens: 800,
  },
  fragmentKinds: ['explanation', 'definition', 'example', 'exercise'],
  items: 'concepts',
  grounding: { default: 'mixed', personCanChange: true },
  budget: { indexTokens: 600 },
}
```

Everything else is core:
- the stages and the cutting rules;
- the storage layout;
- the cost warning;
- the confirm block;
- the MCP tools;
- the grounding rules;
- the tiers;
- measurement.

## Measuring

`usage.jsonl` gets a `material` phase, recorded per stage and source: tokens, tier and model. The core also logs:
- how many fragments were flagged, repaired, dropped or sent to the person;
- which fragments each task opened.

These numbers serve three purposes:
- they feed the cost estimate;
- they tune the size thresholds;
- they show whether the sheet plus the index is enough.

## Open questions

1. **Items.** How the harness hands its items to the core: a file it keeps updated, or a function in the manifest.
2. **Formats.** Whether docx/pptx belong in the first version.
3. **Privacy.** The material stays local, but validation and labelling send parts of it to the engine's provider. Intake should say so once.
4. **When processing runs.** Right after intake, as a background system task (this overlaps with the dev background-jobs candidate), or only when the person asks.
5. **Language.** A material in a different language from the app: whether the sheet follows the material or the app.
6. **Thresholds.** The real warning and limit values, and the sample size and word margin of validation. 50 pages, 300 pages, 50 MB, 10% capped at 15, and 2% are placeholders until measured.
7. **Student harness impact.** Mockup v1 shows "2 fotos del cuaderno" as material. Photos are no longer accepted, so that screen must change.
