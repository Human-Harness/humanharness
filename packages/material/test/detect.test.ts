import { describe, expect, it } from "vitest";
import { detectType } from "../src";

const bytes = (...b: number[]) => Buffer.from(b);
const zip = Buffer.concat([bytes(0x50, 0x4b, 0x03, 0x04), Buffer.alloc(40)]);

describe("detectType (material spec §3: content first, extension second)", () => {
  it("reads a PDF by its magic bytes, even renamed", () => {
    expect(detectType("notes.txt", Buffer.from("%PDF-1.7\n…"))).toEqual({ ok: true, type: "pdf", family: "pdf" });
  });

  it("tells zip-based formats apart by their extension (the zip's own files are checked later)", () => {
    expect(detectType("a.docx", zip)).toEqual({ ok: true, type: "docx", family: "word" });
    expect(detectType("a.ODT", zip)).toEqual({ ok: true, type: "odt", family: "word" });
    expect(detectType("a.xlsx", zip)).toEqual({ ok: true, type: "xlsx", family: "spreadsheet" });
    expect(detectType("a.ods", zip)).toEqual({ ok: true, type: "ods", family: "spreadsheet" });
    expect(detectType("a.pptx", zip)).toEqual({ ok: true, type: "pptx", family: "presentation" });
    expect(detectType("a.odp", zip)).toEqual({ ok: true, type: "odp", family: "presentation" });
    expect(detectType("a.epub", zip)).toEqual({ ok: true, type: "epub", family: "ebook" });
    expect(detectType("a.zip", zip)).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("refuses images, audio and video with the reason the person reads", () => {
    for (const [name, b] of [
      ["photo.jpg", bytes(0xff, 0xd8, 0xff, 0xe0)],
      ["scan.png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
      ["a.gif", Buffer.from("GIF89a")],
      ["clip.mp4", Buffer.concat([bytes(0, 0, 0, 0x18), Buffer.from("ftypmp42")])],
      ["voice.mp3", Buffer.from("ID3\u0004")],
      ["a.wav", Buffer.concat([Buffer.from("RIFF"), bytes(0, 0, 0, 0), Buffer.from("WAVE")])],
      ["a.webp", Buffer.concat([Buffer.from("RIFF"), bytes(0, 0, 0, 0), Buffer.from("WEBP")])],
    ] as const) {
      expect(detectType(name, b)).toEqual({ ok: false, reason: "media", message: "The app only works with files that have text." });
    }
  });

  it("refuses old Office formats with the way out", () => {
    const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    expect(detectType("old.doc", ole)).toEqual({ ok: false, reason: "old-office", message: "Save it as .docx, .xlsx or .pptx and add it again." });
    expect(detectType("old.xls", Buffer.from("anything"))).toMatchObject({ ok: false, reason: "old-office" });
  });

  it("reads web pages, RTF, CSV and every text file; an unknown extension that decodes as text is text", () => {
    expect(detectType("page.html", Buffer.from("<!doctype html><p>Hi</p>"))).toEqual({ ok: true, type: "html", family: "web" });
    expect(detectType("page.txt", Buffer.from("<html><body>x</body></html>"))).toEqual({ ok: true, type: "html", family: "web" });
    expect(detectType("a.rtf", Buffer.from("{\\rtf1\\ansi Hello}"))).toEqual({ ok: true, type: "rtf", family: "word" });
    expect(detectType("a.csv", Buffer.from("a,b\n1,2\n"))).toEqual({ ok: true, type: "csv", family: "spreadsheet" });
    expect(detectType("a.tsv", Buffer.from("a\tb\n"))).toEqual({ ok: true, type: "tsv", family: "spreadsheet" });
    expect(detectType("a.md", Buffer.from("# Hi"))).toEqual({ ok: true, type: "md", family: "text" });
    expect(detectType("a.json", Buffer.from("{}"))).toEqual({ ok: true, type: "json", family: "text" });
    expect(detectType("a.py", Buffer.from("def f(): pass"))).toEqual({ ok: true, type: "code", family: "text" });
    expect(detectType("README", Buffer.from("Just words."))).toEqual({ ok: true, type: "txt", family: "text" });
  });

  it("text that starts like a media header is text; a real header still is media", () => {
    expect(detectType("bmi.txt", Buffer.from("BMI is weight over height squared.\n"))).toEqual({ ok: true, type: "txt", family: "text" });
    expect(detectType("id.csv", Buffer.from("ID3,name\n1,a\n"))).toEqual({ ok: true, type: "csv", family: "spreadsheet" });
    expect(detectType("oggs.md", Buffer.from("OggS are fun"))).toEqual({ ok: true, type: "md", family: "text" });
    expect(detectType("flac.txt", Buffer.from("fLaC is a codec"))).toEqual({ ok: true, type: "txt", family: "text" });
    const bmp = Buffer.concat([Buffer.from("BM"), Buffer.alloc(12), bytes(40, 0, 0, 0), Buffer.alloc(8)]);
    expect(detectType("picture", bmp)).toMatchObject({ ok: false, reason: "media" });
    expect(detectType("a.bmp", Buffer.from("BM"))).toMatchObject({ ok: false, reason: "media" });
    expect(detectType("song", Buffer.concat([Buffer.from("OggS"), bytes(0, 2)]))).toMatchObject({ ok: false, reason: "media" });
    expect(detectType("song", Buffer.concat([Buffer.from("fLaC"), bytes(0x80, 0, 0, 0x22)]))).toMatchObject({ ok: false, reason: "media" });
  });

  it("sniffs HTML past a UTF-8 BOM, and reads UTF-16 with a BOM as text", () => {
    expect(detectType("page", Buffer.from("﻿<!DOCTYPE html><p>Hi</p>", "utf8"))).toEqual({ ok: true, type: "html", family: "web" });
    const le = Buffer.concat([bytes(0xff, 0xfe), Buffer.from("Hello, café", "utf16le")]);
    const be = Buffer.from(Buffer.concat([bytes(0xfe, 0xff), Buffer.from("<html><body>x</body></html>", "utf16le").swap16()]));
    expect(detectType("notes.txt", le)).toEqual({ ok: true, type: "txt", family: "text" });
    expect(detectType("page", be)).toEqual({ ok: true, type: "html", family: "web" });
  });

  it("refuses anything that is not text: NUL bytes or mostly unprintable", () => {
    expect(detectType("a.bin", bytes(0x41, 0x00, 0x42))).toMatchObject({ ok: false, reason: "binary" });
    expect(detectType("a.dat", Buffer.from(Array.from({ length: 100 }, (_, i) => (i % 2 ? 0x01 : 0x41))))).toMatchObject({ ok: false, reason: "binary" });
  });
});
