import { describe, expect, it } from "vitest";
import { epubBlocks, odpBlocks, pptxBlocks } from "../src";
import JSZip from "jszip";
import { makeEpub, makeOdp, makePptx } from "./make-office";

describe("presentations (§3)", () => {
  it("pptx: one heading per slide in presentation order, body, then notes under 'Notes'", async () => {
    const buf = await makePptx([{ title: "Fractions", body: ["Two parts"], notes: "Say it slowly." }, { body: ["No title here"] }]);
    const blocks = await pptxBlocks(buf);
    expect(blocks.map((b) => [b.kind, b.md, b.loc, b.page])).toEqual([
      ["heading", "## Fractions", "slide 1", 1],
      ["para", "Two parts", "slide 1", 1],
      ["para", "**Notes:** Say it slowly.", "slide 1", 1],
      ["heading", "## Slide 2", "slide 2", 2],
      ["para", "No title here", "slide 2", 2],
    ]);
  });

  it("pptx: text that looks like Markdown stays text", async () => {
    const blocks = await pptxBlocks(await makePptx([{ title: "T", body: ["# not a heading", "- not a list"] }]));
    expect(blocks.slice(1).map((b) => b.md)).toEqual(["\\# not a heading", "\\- not a list"]);
  });

  it("odp: pages, titles and notes", async () => {
    const buf = await makeOdp(
      `<draw:page draw:name="p1"><draw:frame presentation:class="title"><draw:text-box><text:p>Intro</text:p></draw:text-box></draw:frame><draw:frame><draw:text-box><text:p>Hello</text:p></draw:text-box></draw:frame>` +
        `<presentation:notes><draw:frame><draw:text-box><text:p>Remember</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>`,
    );
    expect((await odpBlocks(buf)).map((b) => b.md)).toEqual(["## Intro", "Hello", "**Notes:** Remember"]);
  });

  it("broken files are refused as unreadable", async () => {
    await expect(pptxBlocks(Buffer.from("nope"))).rejects.toMatchObject({ reason: "unreadable" });
    await expect(odpBlocks(Buffer.from("nope"))).rejects.toMatchObject({ reason: "unreadable" });
  });
});

describe("ebooks (§3)", () => {
  it("chapters in spine order, locations under the chapter", async () => {
    const blocks = await epubBlocks(await makeEpub(["<h1>One</h1><p>First.</p>", "<h1>Two</h1><p>Second.</p>"]));
    expect(blocks.map((b) => [b.md, b.loc])).toEqual([
      ["# One", "ch. 1 › § One"],
      ["First.", "ch. 1 › § One ¶1"],
      ["# Two", "ch. 2 › § Two"],
      ["Second.", "ch. 2 › § Two ¶1"],
    ]);
  });

  it("a DRM-locked ebook is refused as protected", async () => {
    const zip = await JSZip.loadAsync(await makeEpub(["<p>x</p>"]));
    zip.file("META-INF/encryption.xml", "<encryption/>");
    await expect(epubBlocks(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({ reason: "protected" });
  });
});
