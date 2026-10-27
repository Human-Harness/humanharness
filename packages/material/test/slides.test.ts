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

  const withEncryption = async (entries: [algorithm: string, uri: string][]) => {
    const zip = await JSZip.loadAsync(await makeEpub(["<p>x</p>"]));
    const data = entries.map(
      ([alg, uri]) => `<enc:EncryptedData><enc:EncryptionMethod Algorithm="${alg}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData>`,
    );
    zip.file("META-INF/encryption.xml", `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">${data.join("")}</encryption>`);
    return epubBlocks(await zip.generateAsync({ type: "nodebuffer" }));
  };
  const AES = "http://www.w3.org/2001/04/xmlenc#aes128-cbc";

  it("a DRM-locked ebook is refused as protected: an encrypted chapter, or any algorithm but font obfuscation", async () => {
    await expect(withEncryption([[AES, "OEBPS/text/c1.xhtml"]])).rejects.toMatchObject({ reason: "protected" });
    await expect(withEncryption([[AES, "OEBPS/fonts/a.otf"]])).rejects.toMatchObject({ reason: "protected" });
    await expect(withEncryption([["http://www.idpf.org/2008/embedding", "OEBPS/text/c1.xhtml"]])).rejects.toMatchObject({ reason: "protected" });
  });

  it("obfuscated fonts are not a lock", async () => {
    const blocks = await withEncryption([
      ["http://www.idpf.org/2008/embedding", "OEBPS/fonts/a.otf"],
      ["http://ns.adobe.com/pdf/enc#RC", "OEBPS/fonts/b.otf"],
    ]);
    expect(blocks.map((b) => b.md)).toEqual(["x"]);
  });

  it("an href from the package's root (a leading /) is found", async () => {
    const zip = await JSZip.loadAsync(await makeEpub(["<p>rooted</p>"]));
    const opf = (await zip.file("OEBPS/book.opf")?.async("string")) ?? "";
    zip.file("OEBPS/book.opf", opf.replace('href="text/c1.xhtml"', 'href="/OEBPS/text/c1.xhtml"'));
    expect((await epubBlocks(await zip.generateAsync({ type: "nodebuffer" }))).map((b) => b.md)).toEqual(["rooted"]);
  });
});
