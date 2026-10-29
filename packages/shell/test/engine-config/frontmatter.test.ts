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
