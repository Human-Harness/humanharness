/**
 * The TOML subset a scope's `codex.toml` needs (Decision 4: nothing may be installed, so no TOML package): tables,
 * arrays of tables, dotted keys, basic and literal strings, integers, floats, booleans, arrays (over several lines too)
 * and inline tables. Anything else (dates, multi-line strings, hex, exponents, inf/nan) is an error naming the line.
 *
 * The file is written by anyone who can write the person's folder, so the parser never builds an object through
 * `__proto__`, `constructor` or `prototype`: those keys are refused, and every key is set with `defineProperty`.
 */

/** The largest `codex.toml` read (the engine folder's per-file cap). */
export const TOML_MAX_BYTES = 256 * 1024;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const BARE_KEY = /^[A-Za-z0-9_-]$/;
const NUMBER = /^[+-]?\d+(_\d+)*(\.\d+(_\d+)*)?$/;
const DATE_OR_TIME = /^\d{4}-\d{2}-\d{2}|^\d{2}:\d{2}/;
const ESCAPES: Record<string, string> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };

type Table = Record<string, unknown>;

/** Parses `src`; throws `Error("line N: …")` on anything outside the subset, or "too large" over 256 KB. */
export function parseToml(src: string): Table {
  if (Buffer.byteLength(src, "utf8") > TOML_MAX_BYTES) throw new Error("codex.toml is too large (over 256 KB)");
  return new Parser(src.startsWith("﻿") ? src.slice(1) : src).parse();
}

/** A key as a message names it: bare when it could be written bare, quoted otherwise. */
const shown = (path: string[]): string => path.map((k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k))).join(".");

function define(table: Table, key: string, value: unknown): void {
  Object.defineProperty(table, key, { value, enumerable: true, writable: true, configurable: true });
}

const isTable = (v: unknown): v is Table => typeof v === "object" && v !== null && !Array.isArray(v);

class Parser {
  private pos = 0;
  private line = 1;
  private readonly root: Table = {};
  /** Tables a `[header]` or a dotted key defined: a second header for one is a redefinition. */
  private readonly defined = new Set<Table>();
  /** Inline tables and plain arrays: closed, nothing may be added to them later. */
  private readonly closed = new Set<unknown>();
  /** Arrays made by `[[header]]`: the only arrays a header may append to or descend into. */
  private readonly tableArrays = new Set<unknown[]>();

  constructor(private readonly src: string) {}

  parse(): Table {
    let current = this.root;
    for (;;) {
      this.skipBlank(true);
      if (this.pos >= this.src.length) return this.root;
      if (this.src.startsWith("[[", this.pos)) {
        this.pos += 2;
        current = this.arrayTable(this.key("]"));
        this.expect("]]");
      } else if (this.src[this.pos] === "[") {
        this.pos += 1;
        current = this.table(this.key("]"));
        this.expect("]");
      } else {
        this.keyValue(current, "=");
      }
      this.endOfLine();
    }
  }

  private fail(message: string): never {
    throw new Error(`line ${this.line}: ${message}`);
  }

  /** Spaces and tabs; with `lines`, also newlines and comments. */
  private skipBlank(lines: boolean): void {
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === " " || c === "\t") this.pos += 1;
      else if (lines && c === "#") this.skipComment();
      else if (lines && (c === "\n" || this.src.startsWith("\r\n", this.pos))) this.newline();
      else return;
    }
  }

  private skipComment(): void {
    while (this.pos < this.src.length && this.src[this.pos] !== "\n" && this.src[this.pos] !== "\r") this.pos += 1;
  }

  private newline(): void {
    this.pos += this.src[this.pos] === "\r" ? 2 : 1;
    this.line += 1;
  }

  private endOfLine(): void {
    this.skipBlank(false);
    if (this.src[this.pos] === "#") this.skipComment();
    if (this.pos >= this.src.length) return;
    if (this.src[this.pos] === "\n" || this.src.startsWith("\r\n", this.pos)) return this.newline();
    this.fail("unexpected text after the value");
  }

  private expect(token: string): void {
    this.skipBlank(false);
    if (!this.src.startsWith(token, this.pos)) this.fail(`expected ${token}`);
    this.pos += token.length;
  }

  /** A dotted key up to `end` (not consumed); each part checked against the forbidden names. */
  private key(end: string): string[] {
    const parts: string[] = [];
    for (;;) {
      this.skipBlank(false);
      const c = this.src[this.pos];
      let part = "";
      if (c === '"') {
        if (this.src.startsWith('"""', this.pos)) this.fail("multi-line strings are not supported");
        part = this.basicString();
      } else if (c === "'") {
        if (this.src.startsWith("'''", this.pos)) this.fail("multi-line strings are not supported");
        part = this.literalString();
      } else {
        const start = this.pos;
        while (this.pos < this.src.length && BARE_KEY.test(this.src[this.pos])) this.pos += 1;
        if (this.pos === start) this.fail("a key is missing");
        part = this.src.slice(start, this.pos);
      }
      if (FORBIDDEN_KEYS.has(part)) this.fail(`${part} is not allowed as a key`);
      parts.push(part);
      this.skipBlank(false);
      if (this.src[this.pos] === ".") {
        this.pos += 1;
        continue;
      }
      if (!this.src.startsWith(end, this.pos)) this.fail(`expected ${end} after ${shown(parts)}`);
      return parts;
    }
  }

  /** `key = value` into `table`: dotted parts make (or enter) tables; a key set twice is an error. */
  private keyValue(table: Table, sep: string): void {
    const path = this.key(sep);
    this.pos += sep.length;
    const value = this.value();
    let target = table;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (!Object.hasOwn(target, k)) {
        const next: Table = {};
        define(target, k, next);
        this.defined.add(next);
        target = next;
        continue;
      }
      const existing = target[k];
      if (!isTable(existing) || this.closed.has(existing)) this.fail(`${shown(path.slice(0, i + 1))} is defined twice`);
      target = existing;
    }
    const last = path[path.length - 1];
    if (Object.hasOwn(target, last)) this.fail(`${shown(path)} is defined twice`);
    define(target, last, value);
  }

  /** Walks a header's parent parts: missing tables are made, a `[[…]]` array means its last table. */
  private walk(path: string[]): Table {
    let target = this.root;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (!Object.hasOwn(target, k)) {
        const next: Table = {};
        define(target, k, next);
        target = next;
        continue;
      }
      const existing = target[k];
      if (Array.isArray(existing) && this.tableArrays.has(existing)) target = existing[existing.length - 1] as Table;
      else if (isTable(existing) && !this.closed.has(existing)) target = existing;
      else this.fail(`${shown(path.slice(0, i + 1))} is not a table`);
    }
    return target;
  }

  /** `[a.b]`: the table, made now or made implicitly before; a second header for it is an error. */
  private table(path: string[]): Table {
    const parent = this.walk(path);
    const last = path[path.length - 1];
    if (!Object.hasOwn(parent, last)) {
      const next: Table = {};
      define(parent, last, next);
      this.defined.add(next);
      return next;
    }
    const existing = parent[last];
    if (!isTable(existing) || this.closed.has(existing) || this.defined.has(existing)) this.fail(`${shown(path)} is defined twice`);
    this.defined.add(existing);
    return existing;
  }

  /** `[[a.b]]`: a new table appended to the array `a.b`. */
  private arrayTable(path: string[]): Table {
    const parent = this.walk(path);
    const last = path[path.length - 1];
    const next: Table = {};
    if (!Object.hasOwn(parent, last)) {
      const list: unknown[] = [next];
      this.tableArrays.add(list);
      define(parent, last, list);
      return next;
    }
    const existing = parent[last];
    if (!Array.isArray(existing) || !this.tableArrays.has(existing)) this.fail(`${shown(path)} is defined twice`);
    existing.push(next);
    return next;
  }

  private value(): unknown {
    this.skipBlank(false);
    const c = this.src[this.pos];
    if (c === undefined || c === "\n" || c === "\r" || c === "#") this.fail("a value is missing");
    if (this.src.startsWith('"""', this.pos) || this.src.startsWith("'''", this.pos)) this.fail("multi-line strings are not supported");
    if (c === '"') return this.basicString();
    if (c === "'") return this.literalString();
    if (c === "[") return this.array();
    if (c === "{") return this.inlineTable();
    const start = this.pos;
    while (this.pos < this.src.length && !/[\s,\]}#]/.test(this.src[this.pos])) this.pos += 1;
    const word = this.src.slice(start, this.pos);
    if (word === "true") return true;
    if (word === "false") return false;
    if (DATE_OR_TIME.test(word)) this.fail("dates are not supported");
    if (!NUMBER.test(word)) this.fail(`${JSON.stringify(word.slice(0, 40))} is not a supported value`);
    const n = Number(word.replaceAll("_", ""));
    if (!word.includes(".") && !Number.isSafeInteger(n)) this.fail("the number is too large");
    return n;
  }

  private basicString(): string {
    this.pos += 1;
    let out = "";
    for (;;) {
      const c = this.src[this.pos];
      if (c === undefined || c === "\n" || c === "\r") this.fail("the string is not closed");
      this.pos += 1;
      if (c === '"') return out;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = this.src[this.pos];
      this.pos += 1;
      if (e !== undefined && Object.hasOwn(ESCAPES, e)) out += ESCAPES[e];
      else if (e === "u" || e === "U") out += this.unicode(e === "u" ? 4 : 8);
      else this.fail("unknown escape in a string");
    }
  }

  private unicode(digits: number): string {
    const hex = this.src.slice(this.pos, this.pos + digits);
    if (hex.length !== digits || !/^[0-9A-Fa-f]+$/.test(hex)) this.fail("bad unicode escape");
    const code = Number.parseInt(hex, 16);
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) this.fail("bad unicode escape");
    this.pos += digits;
    return String.fromCodePoint(code);
  }

  private literalString(): string {
    const start = this.pos + 1;
    const end = this.src.indexOf("'", start);
    const nl = this.src.slice(start, end === -1 ? undefined : end).search(/[\r\n]/);
    if (end === -1 || nl !== -1) this.fail("the string is not closed");
    this.pos = end + 1;
    return this.src.slice(start, end);
  }

  /** `[a, b]`, over several lines and with comments between items; closed once read. */
  private array(): unknown[] {
    this.pos += 1;
    const out: unknown[] = [];
    for (;;) {
      this.skipBlank(true);
      if (this.src[this.pos] === "]") break;
      out.push(this.value());
      this.skipBlank(true);
      if (this.src[this.pos] === ",") {
        this.pos += 1;
        continue;
      }
      if (this.src[this.pos] !== "]") this.fail("expected , or ] in an array");
      break;
    }
    this.pos += 1;
    this.closed.add(out);
    return out;
  }

  /** `{ a = 1, b.c = 2 }` on one line; closed once read. */
  private inlineTable(): Table {
    this.pos += 1;
    const out: Table = {};
    this.skipBlank(false);
    if (this.src[this.pos] === "}") {
      this.pos += 1;
      this.closed.add(out);
      return out;
    }
    for (;;) {
      this.keyValue(out, "=");
      this.skipBlank(false);
      const c = this.src[this.pos];
      this.pos += 1;
      if (c === "}") break;
      if (c !== ",") this.fail("expected , or } in an inline table");
    }
    this.closed.add(out);
    return out;
  }
}
