import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { englishItems, textHash } from "@humanharness/i18n/translate";
import { afterEach, describe, expect, it } from "vitest";
import { TranslationCache, emptyCache } from "../src/main/translation-cache";

let dir: string;
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const make = () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-tcache-"));
  return new TranslationCache(dir);
};
const write = (tag: string, body: unknown) => {
  fs.mkdirSync(path.join(dir, "locales"), { recursive: true });
  fs.writeFileSync(path.join(dir, "locales", `${tag}.json`), typeof body === "string" ? body : JSON.stringify(body));
};
const EN = englishItems({ "chat.send": "Send", a: "A", b: "B", c: "C", f: "F", p_one: "{{count}} p", p_other: "{{count}} ps", q_one: "{{count}} q", q_other: "{{count}} qs" }, {});
const h = (key: string) => EN.find((i) => i.key === key)!.hash;

describe("TranslationCache (spec §6)", () => {
  it("D0: reading creates nothing; a missing file is an empty cache", async () => {
    const c = make();
    expect(await c.load("es", EN)).toEqual(emptyCache("es"));
    expect(await c.tags()).toEqual([]);
    expect(fs.existsSync(path.join(dir, "locales"))).toBe(false);
  });

  it("saves atomically under locales/<tag>.json and lists canonical tags only", async () => {
    const c = make();
    const file = { ...emptyCache("pt-BR"), entries: { "core:chat.send": { en: h("core:chat.send"), value: "Enviar" } } };
    await c.save(file);
    expect(await c.load("pt-BR", EN)).toEqual(file);
    fs.writeFileSync(path.join(dir, "locales", "not a tag.json"), "{}");
    fs.writeFileSync(path.join(dir, "locales", "he.json"), "{}");
    expect(await c.tags()).toEqual(["pt-BR"]);
    expect(fs.readdirSync(path.join(dir, "locales")).some((n) => n.endsWith(".tmp"))).toBe(false);
  });

  it("refuses a tag that isn't offered, and a file that is too big, malformed or of another version reads as empty", async () => {
    const c = make();
    await expect(c.save(emptyCache("../evil"))).rejects.toThrow();
    write("es", "x".repeat(4 * 1024 * 1024 + 1));
    expect(await c.load("es", EN)).toEqual(emptyCache("es"));
    write("fr", { version: 1, tag: "fr", entries: { "core:a": { en: 3, value: "x" }, "core:b": { en: h("core:b"), value: "ok" } }, failed: { "core:c": { en: h("core:c"), count: "two" } } });
    expect(await c.load("fr", EN)).toEqual({ ...emptyCache("fr"), entries: { "core:b": { en: h("core:b"), value: "ok" } } });
    write("fr", { version: 2, tag: "fr", entries: { "core:b": { en: h("core:b"), value: "ok" } } });
    expect(await c.load("fr", EN)).toEqual(emptyCache("fr"));
    write("de", "[1,2]");
    expect(await c.load("de", EN)).toEqual(emptyCache("de"));
  });

  it("refuses a symlink in place of the file", async () => {
    const c = make();
    const elsewhere = path.join(dir, "elsewhere.json");
    fs.writeFileSync(elsewhere, JSON.stringify({ version: 1, tag: "es", entries: { "core:b": { en: h("core:b"), value: "ok" } } }));
    fs.mkdirSync(path.join(dir, "locales"));
    fs.symlinkSync(elsewhere, path.join(dir, "locales", "es.json"));
    expect(await c.load("es", EN)).toEqual(emptyCache("es"));
  });

  it("drops prototype keys, legal keys, unknown plural forms and a file written for another tag", async () => {
    const c = make();
    const entries = JSON.parse(
      '{"core:__proto__":{"en":"h","value":"x"},"core:a.constructor":{"en":"h","value":"x"},"core:a..b":{"en":"h","value":"x"},' +
        '"core:legal.engine.noticeTitle":{"en":"h","value":"x"},"other:a":{"en":"h","value":"x"},' +
        `"core:p":{"en":"${h("core:p")}","value":{"one":"{{count}} 1","bogus":"2"}},"core:q":{"en":"${h("core:q")}","value":{"one":"{{count}} 1","other":"{{count}} 2"}}}`,
    );
    write("sv", { version: 1, tag: "sv", entries, failed: JSON.parse(`{"__proto__":{"en":"h","count":1},"core:f":{"en":"${h("core:f")}","count":9}}`) });
    const got = await c.load("sv", EN);
    expect(Object.keys(got.entries)).toEqual(["core:q"]);
    expect(got.failed).toEqual({ "core:f": { en: h("core:f"), count: 2 } });
    expect(Object.getPrototypeOf(got.entries)).toBe(Object.prototype);
    write("nl", { version: 1, tag: "es", entries: { "core:b": { en: h("core:b"), value: "ok" } } });
    expect(await c.load("nl", EN)).toEqual(emptyCache("nl"));
  });

  it("keeps only entries whose hash matches the current English and that pass checkTranslation again", async () => {
    const c = make();
    const items = englishItems({ "chat.send": "Send {{n}}", "a.b": "Old", "c.d": "Fine", "x_one": "{{count}} file", "x_other": "{{count}} files" }, {});
    const hash = (k: string) => items.find((i) => i.key === k)!.hash;
    write("de", {
      version: 1,
      tag: "de",
      entries: {
        "core:chat.send": { en: hash("core:chat.send"), value: "Senden" }, // lost its placeholder: refused on read
        "core:a.b": { en: textHash("Older"), value: "Alt" }, // English changed: stale
        "core:c.d": { en: hash("core:c.d"), value: "Gut" },
        "core:x": { en: hash("core:x"), value: { one: "{{count}} Datei", other: "{{count}} Dateien" } },
        "core:gone": { en: "h", value: "x" }, // no longer in the English
      },
      failed: { "core:a.b": { en: textHash("Older"), count: 2 }, "core:gone": { en: "h", count: 1 } },
    });
    const got = await c.load("de", items);
    expect(got.entries).toEqual({
      "core:c.d": { en: hash("core:c.d"), value: "Gut" },
      "core:x": { en: hash("core:x"), value: { one: "{{count}} Datei", other: "{{count}} Dateien" } },
    });
    // A failure counts only for the English it failed on.
    expect(got.failed).toEqual({});
    // With no English at all, nothing is kept.
    expect(await c.load("de", [])).toEqual(emptyCache("de"));
  });

  it("refuses to write a file too big to read back, and saves one after another", async () => {
    const c = make();
    const big = { ...emptyCache("es"), entries: { "core:a": { en: "h", value: "x".repeat(4000) } } as Record<string, { en: string; value: string }> };
    for (let i = 0; i < 1100; i++) big.entries[`core:k${i}`] = { en: "h", value: "x".repeat(4000) };
    await expect(c.save(big)).rejects.toThrow(/too big/);
    expect(fs.existsSync(path.join(dir, "locales", "es.json"))).toBe(false);
    await Promise.all([1, 2, 3].map((n) => c.save({ ...emptyCache("es"), entries: { "core:a": { en: h("core:a"), value: `v${n}` } } })));
    expect((await c.load("es", EN)).entries["core:a"]?.value).toBe("v3");
  });
});
