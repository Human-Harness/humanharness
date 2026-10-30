import { describe, expect, it } from "vitest";
import { agentFromMarkdown, parseFrontmatter, skillFromMarkdown } from "../../src/main/engine-config/frontmatter";

describe("parseFrontmatter (Decision 4)", () => {
  it("flat keys, lists and | blocks; body after", () => {
    const md = "---\nname: rev\ndescription: Reviews\ntools: [Read, Grep]\nnotes: |\n  one\n  two\n---\nBody\n";
    expect(parseFrontmatter(md)).toEqual({ fields: { name: "rev", description: "Reviews", tools: ["Read", "Grep"], notes: "one\ntwo" }, body: "Body\n" });
  });
  it("no frontmatter: empty fields, whole body", () => {
    expect(parseFrontmatter("Just text")).toEqual({ fields: {}, body: "Just text" });
  });
  it("quoted values and list items, comments, blank lines and CRLF", () => {
    const md = "---\r\n# a comment\r\na: \"x: y\"\r\n\r\nb: 'z'\r\nc: [\"p, q\", r]\r\nd: []\r\n---\r\nBody";
    expect(parseFrontmatter(md)).toEqual({ fields: { a: "x: y", b: "z", c: ["p, q", "r"], d: [] }, body: "Body" });
  });
  it("a closing --- at the end leaves an empty body", () => {
    expect(parseFrontmatter("---\na: 1\n---")).toEqual({ fields: { a: "1" }, body: "" });
  });
  it.each([
    ["---\na:\n  b: 1\n---\n", "a"],
    ["---\n__proto__: x\n---\n", "__proto__"],
    ["---\nconstructor: x\n---\n", "constructor"],
    ["---\na: 1\n", "closing ---"],
    ["---\na: 1\na: 2\n---\n", "a"],
    ["---\na: {b: 1}\n---\n", "a"],
    ["---\na: [x\n---\n", "a"],
    ["---\n- x\n---\n", "- x"],
  ])("refuses %j naming %s", (md, name) => {
    expect(() => parseFrontmatter(md)).toThrow(name);
  });
  it.each([
    ["a lone \\r", "\r"],
    ["NUL", "\u0000"],
    ["a vertical tab", "\u000b"],
    ["ESC", "\u001b"],
    ["DEL", "\u007f"],
    ["NEL (C1)", "\u0085"],
    ["U+2028", "\u2028"],
    ["U+2029", "\u2029"],
    ["U+FEFF", "\ufeff"],
  ])("refuses %s inside the frontmatter, naming the key", (_label, ch) => {
    expect(() => parseFrontmatter(`---\ndescription: d${ch}hooks: x\n---\n`)).toThrow("frontmatter: description has a control");
  });
  it("names the line when the bad character is before any key", () => {
    expect(() => parseFrontmatter("---\na: 1\n\u2028hooks: x\n---\n")).toThrow("line 3");
  });
  it("keeps tabs and CRLF", () => {
    expect(parseFrontmatter("---\r\na: x\ty\r\n---\r\n").fields).toEqual({ a: "x\ty" });
  });
  it("a lone \\r can't smuggle hooks into a skill", () => {
    expect(() => skillFromMarkdown("fmt", "---\ndescription: d\rhooks:\r  Stop:\r    - x\n---\n")).toThrow("skills/fmt/SKILL.md: frontmatter: description");
  });
  it.each([
    ["a trailing space", "--- \ndescription: d\nhooks: [x]\n---\n"],
    ["a leading BOM", "\ufeff---\ndescription: d\nhooks: [x]\n---\n"],
    ["a lone \\r after it", "---\rdescription: d\rhooks: [x]\n---\n"],
  ])("an opening line with %s is refused, not read as no frontmatter", (_label, md) => {
    expect(() => parseFrontmatter(md)).toThrow("the opening line must be exactly ---");
    expect(() => skillFromMarkdown("fmt", md)).toThrow("skills/fmt/SKILL.md: frontmatter: the opening line");
  });
  it("refuses a file over 256 KB", () => {
    expect(() => parseFrontmatter("x".repeat(256 * 1024 + 1))).toThrow("over 256 KB");
    expect(parseFrontmatter("x".repeat(256 * 1024)).body).toHaveLength(256 * 1024);
  });
  it("a | block as long as the cap allows is read in a plain loop", () => {
    const md = `---\nnotes: |\n${" l\n".repeat(85_000)}---\n`;
    expect((parseFrontmatter(md).fields.notes as string).split("\n")).toHaveLength(85_000);
  });
  it("never builds a field through the prototype", () => {
    expect(() => parseFrontmatter("---\nprototype: x\n---\n")).toThrow("prototype");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("agentFromMarkdown (spec §5.2, E6)", () => {
  it("frontmatter as fields, body as prompt; name from the file when missing", () => {
    expect(agentFromMarkdown("reviewer.md", "---\ndescription: Reviews code\ntools: [Read]\nmodel: sonnet\n---\nYou review.")).toEqual({
      name: "reviewer",
      agent: { description: "Reviews code", tools: ["Read"], model: "sonnet", prompt: "You review." },
      ignored: [],
    });
  });
  it("the frontmatter name wins over the file name", () => {
    expect(agentFromMarkdown("x.md", "---\nname: rev\ndescription: d\n---\np").name).toBe("rev");
  });
  it("keeps the allowed fields", () => {
    const md = "---\ndescription: d\ntools: Read, Grep\ndisallowedTools: [Bash]\nmodel: opus\ncolor: blue\nskills: [fmt]\nmemory: project\n---\np";
    expect(agentFromMarkdown("a.md", md).agent).toEqual({
      description: "d",
      tools: "Read, Grep",
      disallowedTools: ["Bash"],
      model: "opus",
      color: "blue",
      skills: ["fmt"],
      memory: "project",
      prompt: "p",
    });
  });
  it("memory: project and local only; user is refused (it lives under ~/.claude)", () => {
    expect(agentFromMarkdown("a.md", "---\ndescription: d\nmemory: local\n---\np").agent.memory).toBe("local");
    expect(() => agentFromMarkdown("a.md", "---\ndescription: d\nmemory: user\n---\np")).toThrow("agents/a.md: memory user is not allowed");
    expect(() => agentFromMarkdown("a.md", "---\ndescription: d\nmemory: elsewhere\n---\np")).toThrow("memory elsewhere is not allowed");
  });
  it("permissionMode is dropped and reported as ignored", () => {
    const parsed = agentFromMarkdown("a.md", "---\ndescription: d\npermissionMode: bypassPermissions\n---\np");
    expect(parsed.ignored).toEqual(["permissionMode"]);
    expect(parsed.agent).not.toHaveProperty("permissionMode");
  });
  it.each(["hooks", "mcpServers"])("refuses %s (Decision 6)", (key) => {
    expect(() => agentFromMarkdown("a.md", `---\ndescription: d\n${key}: [x]\n---\np`)).toThrow(`agents/a.md: ${key} is not allowed`);
  });
  it("refuses any other key, naming it", () => {
    expect(() => agentFromMarkdown("a.md", "---\ndescription: d\nisolation: none\n---\np")).toThrow("agents/a.md: isolation is not allowed");
  });
  it("names the file on a parse error", () => {
    expect(() => agentFromMarkdown("a.md", "---\ndescription: d\n")).toThrow("agents/a.md: ");
  });
  it("needs a description; the name must be a plain id", () => {
    expect(() => agentFromMarkdown("a.md", "p")).toThrow("description");
    expect(() => agentFromMarkdown("a.md", "---\ndescription: [x]\n---\np")).toThrow("description");
    expect(() => agentFromMarkdown("A B.md", "---\ndescription: d\n---\np")).toThrow("name");
    expect(() => agentFromMarkdown("a.md", "---\nname: ../x\ndescription: d\n---\np")).toThrow("name");
    expect(() => agentFromMarkdown("a.txt", "---\ndescription: d\n---\np")).toThrow("name");
  });
});

describe("skillFromMarkdown", () => {
  it("keeps the file as is and reads name and description", () => {
    expect(skillFromMarkdown("fmt", "---\nname: fmt\ndescription: Formats\n---\nDo it")).toEqual({ name: "fmt", description: "Formats" });
  });
  it("the name comes from the folder when missing", () => {
    expect(skillFromMarkdown("fmt", "---\ndescription: Formats\n---\n")).toEqual({ name: "fmt", description: "Formats" });
  });
  it("refuses hooks in a skill's frontmatter (E6)", () => {
    expect(() => skillFromMarkdown("fmt", "---\ndescription: d\nhooks: [x]\n---\n")).toThrow("skills/fmt/SKILL.md: hooks is not allowed");
  });
  it("needs a description, a plain-id folder and a name equal to it", () => {
    expect(() => skillFromMarkdown("fmt", "Do it")).toThrow("skills/fmt/SKILL.md: description");
    expect(() => skillFromMarkdown("Fm t", "---\ndescription: d\n---\n")).toThrow("name");
    expect(() => skillFromMarkdown("fmt", "---\nname: other\ndescription: d\n---\n")).toThrow("name");
  });
});
