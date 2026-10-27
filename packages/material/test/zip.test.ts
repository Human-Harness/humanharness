import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { ZIP_MAX_ENTRIES, checkZip, docxBlocks, epubBlocks, odpBlocks, odsSheets, odtBlocks, openZip, pptxBlocks, xlsxSheets, zipText } from "../src";
import { makeDocx, makeEpub, makeOdp, makeOds, makeOdt, makePptx } from "./make-office";

const LIMITS = { entries: 5, total: 10_000, entry: 4_000, part: 3_500 };
const make = async (files: Record<string, string>) => {
  const z = new JSZip();
  for (const [name, text] of Object.entries(files)) z.file(name, text);
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
};

/** Sets every entry's declared uncompressed size (local and central headers) to `size`: a zip that lies. */
function lie(buf: Buffer, size: number): Buffer {
  const out = Buffer.from(buf);
  for (let i = 0; i < out.length - 4; i++) {
    const sig = out.readUInt32LE(i);
    if (sig === 0x04034b50) out.writeUInt32LE(size, i + 22);
    if (sig === 0x02014b50) out.writeUInt32LE(size, i + 24);
  }
  return out;
}

/** A real document with `extra` more (empty) entries in it. */
async function padded(buf: Buffer, extra: number): Promise<Buffer> {
  const z = await JSZip.loadAsync(buf);
  for (let i = 0; i < extra; i++) z.file(`pad/${i}.xml`, "");
  return z.generateAsync({ type: "nodebuffer" });
}

const refused = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ reason: "unreadable" });

describe("the zip guard (zip bombs)", () => {
  it("reads entries within the limits", async () => {
    const zip = await openZip(await make({ "a.xml": "﻿<a/>", "b.xml": "x".repeat(3000) }), LIMITS);
    expect(await zipText(zip, "a.xml")).toBe("<a/>");
    expect(await zipText(zip, "missing.xml")).toBeNull();
  });

  it("too many entries are refused before anything is inflated", async () => {
    await refused(openZip(await make(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`${i}.xml`, ""]))), LIMITS));
  });

  it("directories count as entries, read from the end record before JSZip opens the file", async () => {
    const z = new JSZip();
    for (let i = 0; i < 6; i++) z.folder(`d${i}`);
    await refused(openZip(await z.generateAsync({ type: "nodebuffer" }), LIMITS));
  });

  it("a part that is kept or parsed has the smaller cap; media that is only counted has the larger one", async () => {
    const big = "x".repeat(3800);
    await refused(openZip(await make({ "a.xml": big }), LIMITS));
    const liar = lie(await make({ "a.xml": big }), 10);
    await refused(zipText(await openZip(liar, LIMITS), "a.xml"));
    await expect(checkZip(await make({ "img.png": big }), LIMITS)).resolves.toBeUndefined();
    await refused(checkZip(await make({ "word/document.xml": big }), LIMITS));
  });

  it("a declared size above an entry's or the archive's limit is refused", async () => {
    await refused(openZip(await make({ "a.xml": "x".repeat(5000) }), LIMITS));
    await refused(openZip(await make({ "a.xml": "x".repeat(3500), "b.xml": "x".repeat(3500), "c.xml": "x".repeat(3500) }), LIMITS));
  });

  it("a zip that declares small sizes is still stopped by what it inflates", async () => {
    const liar = lie(await make({ "a.xml": "x".repeat(50_000) }), 10);
    const zip = await openZip(liar, LIMITS);
    await refused(zipText(zip, "a.xml"));
    await refused(checkZip(liar, LIMITS));
  });

  it("a docx whose entries declare a bomb's size is refused before mammoth reads it", async () => {
    await refused(docxBlocks(lie(await makeDocx([{ text: "x" }]), 0xfffffff0)));
  });

  it("every zip format refuses a file with more entries than ZIP_MAX_ENTRIES", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("S").addRows([["a"], [1]]);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    const extra = ZIP_MAX_ENTRIES + 1;
    await refused(docxBlocks(await padded(await makeDocx([{ text: "x" }]), extra)));
    await refused(odtBlocks(await padded(await makeOdt("<text:p>x</text:p>"), extra)));
    await refused(xlsxSheets(await padded(xlsx, extra)));
    await refused(odsSheets(await padded(await makeOds('<table:table table:name="S"/>'), extra)));
    await refused(pptxBlocks(await padded(await makePptx([{ body: ["x"] }]), extra)));
    await refused(odpBlocks(await padded(await makeOdp('<draw:page draw:name="p"/>'), extra)));
    await refused(epubBlocks(await padded(await makeEpub(["<p>x</p>"]), extra)));
  }, 30_000);
});
