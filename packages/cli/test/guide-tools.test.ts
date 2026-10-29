import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkHarness } from "../src/check";
import { HARNESS_SECTIONS, parseHarnessMd, sectionText } from "../src/harness-md";
import { initHarness } from "../src/init";
import { CORE, read, replaceIn, tempRoot } from "./helpers";

const guide = read(path.join(CORE, "packages", "cli", "guide"), "new-harness.md");
const template = read(path.join(CORE, "packages", "cli", "template"), "HARNESS.md");

/** Each `## Phase N — Name` with its body (up to the next `## `), as guide.test.ts reads them. */
function phases(text: string): { n: number; name: string; body: string }[] {
  return text
    .split(/^## /m)
    .slice(1)
    .flatMap((p) => {
      const m = /^Phase (\d+) — (.+)\n([\s\S]*)$/.exec(p);
      return m ? [{ n: Number(m[1]), name: m[2].trim(), body: m[3] }] : [];
    });
}
const mechanical = () => phases(guide).find((p) => p.name === "Mechanical work")!;
/** The body of a `## <title>` section of the guide that is not a phase. */
function guideSection(title: string): string | undefined {
  const part = guide
    .split(/^## /m)
    .slice(1)
    .find((p) => p.startsWith(`${title}\n`));
  return part?.slice(title.length + 1);
}

describe("the guide's tools phase (tools spec §11)", () => {
  it("has Mechanical work as Phase 4, between Flow and Context", () => {
    const all = phases(guide);
    expect(all[3]).toMatchObject({ n: 4, name: "Mechanical work" });
    expect(all[2].name).toBe("Flow");
    expect(all[4]).toMatchObject({ n: 5, name: "Context" });
  });

  it("the phase fills HARNESS.md → Mechanical work", () => {
    expect(mechanical().body).toMatch(/^Fills: HARNESS\.md → Mechanical work$/m);
  });

  it("it walks moment by moment: key moment, code or AI, impact", () => {
    const body = mechanical().body;
    expect(body).toContain("moment by moment");
    expect(body).toContain("key moment");
    expect(body).toContain("**Code**");
    expect(body).toContain("**AI**");
    // The impact of each row: what the change saves.
    for (const word of ["time", "tokens", "mistakes"]) expect(body).toContain(word);
  });

  it("it proposes tools, pre-steps and job recipes and points at tool test", () => {
    const body = mechanical().body;
    for (const word of ["`defineTool`", "`returns`", '`agent: "none"`', "`uses`", "`pre`", "`expects`", "`steps`", "tools/<id>/fixtures/<case>.json"]) expect(body).toContain(word);
    expect(body).toContain("humanharness tool test <id>");
    expect(body).toContain("<core>/docs/architecture/tools.md");
  });

  it("it says what tool run, check and the recordings do today", () => {
    const body = mechanical().body;
    // tool run: keys asked hidden, public hosts only, --yes for a tool that writes.
    expect(body).toContain("humanharness tool run <id> --args");
    expect(body).toMatch(/hidden/);
    expect(body).toMatch(/public hosts/);
    expect(body).toContain("--yes");
    // check runs the fixtures; the terminal runs tool code outside the app's sandbox (P12).
    expect(body).toMatch(/`corepack pnpm check` runs every fixture/);
    expect(body).toMatch(/not in the app's sandbox/);
    // Mock mode: recordings of tool accesses and AI steps.
    for (const word of ["--record", "mock/tools/<tool>/", "dev --mock", "Not recorded: <target>", "mock/steps/<job>.json"]) expect(body).toContain(word);
  });

  it("tool run: --yes covers folder and data writes only, so the developer is asked before every run", () => {
    const body = mechanical().body;
    expect(body).toContain("A tool that writes to the folder or its data needs `--yes`");
    expect(body).toContain("fetches and commands always run for real, so ask the developer before every `tool run` and before adding `--yes`");
    expect(body).not.toContain("a tool that writes runs only with `--yes`");
  });

  it("Verify: with tools that declare keys, the developer runs the task in their own terminal", () => {
    const verify = phases(guide).find((p) => p.name === "Verify")!;
    expect(verify.body).toMatch(/tools declare keys[^\n]*in their own terminal/);
  });

  it("has a Lessons section with the spec's lessons", () => {
    const lessons = guideSection("Lessons");
    expect(lessons, "the guide has no ## Lessons section").toBeDefined();
    for (const lesson of ["English ids", "`returns`", "no date or counting logic in prompts", "one tool per mechanical job", "fixture"]) expect(lessons!.toLowerCase()).toContain(lesson.toLowerCase());
  });

  it("puts Lessons before the Verify phase, and it is not a phase", () => {
    expect(guide.indexOf("\n## Lessons\n")).toBeGreaterThan(guide.indexOf("\n## Phase 8 — Identity\n"));
    expect(guide.indexOf("\n## Lessons\n")).toBeLessThan(guide.indexOf("\n## Phase 9 — Verify\n"));
    expect(phases(guide).map((p) => p.name)).not.toContain("Lessons");
  });

  it("refers to phases by their new numbers", () => {
    // No text still points at a phase by its old number (Context was 4, Verify was 8).
    for (const m of guide.matchAll(/\bPhase (\d+)\b(?! —)/g)) expect(Number(m[1])).toBeLessThanOrEqual(9);
    expect(guide).not.toMatch(/## Phase 4 — Context/);
  });

  it("the template's HARNESS.md has the section, and parses with no unknown section", () => {
    const doc = parseHarnessMd(template);
    expect(doc.sections.has("Mechanical work")).toBe(true);
    expect([...doc.sections.keys()].every((k) => (HARNESS_SECTIONS as readonly string[]).includes(k))).toBe(true);
    expect(HARNESS_SECTIONS.indexOf("Mechanical work")).toBe(HARNESS_SECTIONS.indexOf("Flow") + 1);
    expect(sectionText(doc.sections.get("Mechanical work"))).toMatch(/^\| Moment \| Code or AI \| Tool or step \| Why \|\n\|---\|---\|---\|---\|$/m);
  });

  it("the Mechanical work table doesn't become the Flow table", () => {
    expect(parseHarnessMd(template).flow?.map((r) => r.action)).toEqual(["example", "(questions)"]);
  });
});

describe("D0: a HARNESS.md written before the Mechanical work section", () => {
  const { root, cleanup } = tempRoot("hh-guide-tools-");
  afterAll(cleanup);

  it("checks exactly as one with the section", async () => {
    const withIt = path.join(root, "with");
    const without = path.join(root, "without");
    await initHarness({ dir: withIt, core: CORE, install: false });
    await initHarness({ dir: without, core: CORE, install: false });
    replaceIn(without, "HARNESS.md", "## Mechanical work\n\n| Moment | Code or AI | Tool or step | Why |\n|---|---|---|---|\n\n", "");
    expect(parseHarnessMd(read(without, "HARNESS.md")).sections.has("Mechanical work")).toBe(false);
    const strip = (r: Awaited<ReturnType<typeof checkHarness>>) => r.findings.map((f) => ({ ...f, line: undefined }));
    expect(strip(await checkHarness(without))).toEqual(strip(await checkHarness(withIt)));
  });
});
