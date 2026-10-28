import { describe, expect, it } from "vitest";
import { CORE_EN, checkTranslation, englishItems, flattenStrings, placeholders, pluralForms, tags, textHash, toResourceEntries, toResources } from "../src/translate";

describe("flattenStrings", () => {
  it("flattens nested strings and drops what isn't a string or is out of bounds", () => {
    expect(flattenStrings({ a: { b: "B", n: 3 }, c: "C", "bad key!": "x", long: "y".repeat(4001) })).toEqual({ "a.b": "B", c: "C" });
    expect(flattenStrings(null)).toEqual({});
    expect(Object.keys(flattenStrings(Object.fromEntries(Array.from({ length: 6000 }, (_, i) => [`k${i}`, "v"]))))).toHaveLength(5000);
  });

  it("drops keys that would reach an object's prototype", () => {
    const raw = JSON.parse('{"__proto__": {"x": "X"}, "a": {"constructor": "C", "ok": "O"}}');
    expect(flattenStrings(raw)).toEqual({ "a.ok": "O" });
  });
});

describe("englishItems (spec §5, §8)", () => {
  it("namespaces keys, groups plurals and never sends legal.", () => {
    const items = englishItems({ "chat.send": "Send", "notes.keyPoints_one": "{{count}} key point", "notes.keyPoints_other": "{{count}} key points", "legal.engine.accept": "I accept" }, { title: "Notes", "legal.terms": "Terms" });
    expect(items.map((i) => i.key)).toEqual(["core:chat.send", "core:notes.keyPoints", "harness:title"]);
    expect(items[1].en).toEqual({ one: "{{count}} key point", other: "{{count}} key points" });
    expect(items[0].hash).toBe(textHash("Send"));
  });

  it("a plural suffix with no _other stays a key of its own", () => {
    expect(englishItems({ "a.x_one": "One" }, {}).map((i) => i.key)).toEqual(["core:a.x_one"]);
  });

  it("the core's own English never includes a legal key", () => {
    expect(CORE_EN["legal.engine.noticeTitle"]).toBeTypeOf("string");
    expect(englishItems(CORE_EN, {}).some((i) => i.key.startsWith("core:legal."))).toBe(false);
  });

  it("skips the whole legal subtree once a nested map is flattened", () => {
    const nested = flattenStrings({ legal: { engine: { noticeTitle: "Before you start", deep: { x: "X" } } }, ok: "OK" });
    expect(englishItems(nested, nested).map((i) => i.key)).toEqual(["core:ok", "harness:ok"]);
  });

  it("the notice's bold word must stay bold (the first tag in en.json)", () => {
    const notice = englishItems(CORE_EN, {}).find((i) => i.key === "core:language.notice")!;
    const es = "Para mostrar {{name}} en <b>{{language}}</b>, tu motor ({{engine}}) traducirá los textos.";
    expect(checkTranslation(notice, es, ["one", "other"]).ok).toBe(true);
    expect(checkTranslation(notice, es.replace(/<\/?b>/g, ""), ["one", "other"])).toEqual({ ok: false, reason: "markup" });
  });

  it("the hash changes with the English", () => {
    expect(textHash("Send")).not.toBe(textHash("Send "));
    expect(textHash("Send")).toMatch(/^[0-9a-f]{14}$/);
  });
});

describe("checkTranslation (spec §6)", () => {
  const send = { key: "core:chat.send", en: "Send {{name}}", hash: "h" };
  it("keeps a good text", () => expect(checkTranslation(send, "Enviar {{name}}", ["one", "other"])).toEqual({ ok: true, value: "Enviar {{name}}" }));
  it("refuses empty, missing or extra placeholders, markup, nesting, control and bidi characters, too long", () => {
    for (const [bad, reason] of [
      ["  ", "empty"],
      ["Enviar", "placeholders"],
      ["Enviar {{name}} {{other}}", "placeholders"],
      ["Enviar <script>{{name}}", "markup"],
      ["Enviar <i>{{name}}</i>", "markup"],
      ["Enviar < {{name}}", "markup"],
      ["$t(legal.engine.accept) {{name}}", "markup"],
      ["Enviar‮ {{name}}", "control"],
      ["Enviar⁦ {{name}}", "control"],
      ["Enviar\n{{name}}", "control"],
      ["x".repeat(90) + "{{name}}", "too-long"],
    ] as const) expect(checkTranslation(send, bad, ["other"])).toEqual({ ok: false, reason });
    expect(checkTranslation(send, 42, ["other"])).toEqual({ ok: false, reason: "empty" });
  });
  it("keeps the English tags", () => {
    const notice = { key: "core:language.notice", en: "In <b>{{language}}</b>.", hash: "h" };
    expect(checkTranslation(notice, "En <b>{{language}}</b>.", ["other"]).ok).toBe(true);
    expect(checkTranslation(notice, "En {{language}}.", ["other"])).toEqual({ ok: false, reason: "markup" });
    expect(checkTranslation(notice, "En <b >{{language}}</b>.", ["other"]).ok).toBe(true);
  });
  it("wants every plural form the language needs", () => {
    const plural = { key: "core:notes.keyPoints", en: { one: "{{count}} point", other: "{{count}} points" }, hash: "h" };
    const forms = pluralForms("pl");
    expect(forms).toEqual(["few", "many", "one", "other"]);
    expect(checkTranslation(plural, { one: "{{count}} punkt", few: "{{count}} punkty", many: "{{count}} punktów", other: "{{count}} punktu" }, forms).ok).toBe(true);
    expect(checkTranslation(plural, { one: "{{count}} punkt", other: "{{count}} punktu" }, forms)).toEqual({ ok: false, reason: "forms" });
    expect(checkTranslation(plural, "{{count}} punkt", forms)).toEqual({ ok: false, reason: "forms" });
    expect(pluralForms("not a tag!")).toEqual(["one", "other"]);
  });
});

describe("placeholders and tags read long agent output in linear time", () => {
  it("finds placeholders and tags like i18next writes them", () => {
    expect(placeholders("{{ b }} and {{a}} and {{{c}}} and {{}} and {{d")).toEqual(["a", "b", "c"]);
    expect(tags("<b>x</b> <br/> <br /> < b> <1>")).toEqual(["</b>", "<1>", "<b>", "<br/>", "<br/>"]);
  });

  it("does not stall on hostile input", () => {
    const hostile = ["{{" + " ".repeat(200_000), "{{".repeat(100_000), "<" + "a".repeat(200_000), "<a ".repeat(70_000), "{{ a".repeat(60_000)];
    const start = Date.now();
    for (const s of hostile) {
      placeholders(s);
      tags(s);
      checkTranslation({ key: "core:x", en: s, hash: "h" }, s, ["other"]);
    }
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe("resources", () => {
  it("expands plural objects and nests by namespace; legal keys are dropped", () => {
    const flat: Record<string, string> = {
      ...toResourceEntries("core:notes.keyPoints", { one: "1 punto", other: "{{count}} puntos" }),
      ...toResourceEntries("harness:title", "Notas"),
      "core:legal.engine.accept": "Acepto",
    };
    expect(flat["core:notes.keyPoints_one"]).toBe("1 punto");
    expect(toResources(flat)).toEqual({ core: { notes: { keyPoints_one: "1 punto", keyPoints_other: "{{count}} puntos" } }, harness: { title: "Notas" } });
  });

  it("never writes through a prototype", () => {
    const res = toResources({ "core:__proto__.polluted": "x", "core:a.constructor.b": "y", "harness:prototype": "z", "other:title": "w", nocolon: "v" });
    expect(res).toEqual({ core: {}, harness: {} });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
