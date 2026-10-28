import { describe, expect, it } from "vitest";
import { EventLimiter, LineReader, classifyIncoming, encode, isBackendName, refusalFor } from "../../src/main/backend/backend-protocol";

describe("LineReader", () => {
  it("splits on newlines across chunks and keeps the tail", () => {
    const lines: string[] = [];
    const r = new LineReader((l) => lines.push(l), () => {});
    r.push(Buffer.from('{"a":1}\n{"b"'));
    r.push(Buffer.from(':2}\n'));
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });
  it("drops a line over 1 MB and reports it, then goes on (B3)", () => {
    const lines: string[] = [];
    const dropped: number[] = [];
    const r = new LineReader((l) => lines.push(l), (n) => dropped.push(n));
    r.push(Buffer.from("x".repeat(1024 * 1024 + 1)));
    r.push(Buffer.from('\n{"ok":true}\n'));
    expect(lines).toEqual(['{"ok":true}']);
    expect(dropped).toEqual([1024 * 1024 + 1]);
  });
  it("keeps a character split across chunks whole, and skips blank lines and a trailing CR", () => {
    const lines: string[] = [];
    const r = new LineReader((l) => lines.push(l), () => {});
    const bytes = Buffer.from('{"s":"ñ"}\r\n\n');
    const cut = bytes.indexOf(0xc3) + 1;
    r.push(bytes.subarray(0, cut));
    r.push(bytes.subarray(cut));
    expect(lines).toEqual(['{"s":"ñ"}']);
  });
});

describe("classifyIncoming (B3, B4)", () => {
  const ours = new Set([1, 2]);
  it("a result or error for one of our ids is a response", () => {
    expect(classifyIncoming('{"jsonrpc":"2.0","id":1,"result":{"x":1}}', ours)).toEqual({ kind: "response", id: 1, result: { x: 1 } });
    expect(classifyIncoming('{"jsonrpc":"2.0","id":2,"error":{"code":-1,"message":"no"}}', ours)).toEqual({ kind: "response", id: 2, error: "no" });
  });
  it("a notification is an event when its name is valid and its params fit 64 KB", () => {
    expect(classifyIncoming('{"jsonrpc":"2.0","method":"tick","params":{"n":1}}', ours)).toEqual({ kind: "event", event: "tick", data: { n: 1 } });
    expect(classifyIncoming(`{"jsonrpc":"2.0","method":"tick","params":"${"x".repeat(65 * 1024)}"}`, ours).kind).toBe("invalid");
    expect(classifyIncoming('{"jsonrpc":"2.0","method":"bad name","params":1}', ours).kind).toBe("invalid");
  });
  it("refusal of history writes: any request from the backend is refused, whatever it names", () => {
    for (const method of ["history.save", "notes.write", "data.put", "session.new", "init"]) {
      const c = classifyIncoming(`{"jsonrpc":"2.0","id":"x","method":"${method}","params":{}}`, ours);
      expect(c).toEqual({ kind: "request", id: "x", method });
      expect(JSON.parse(refusalFor("x"))).toEqual({ jsonrpc: "2.0", id: "x", error: { code: -32601, message: "The app takes no requests from a backend" } });
    }
    // A request whose id can't be echoed back is not answered at all.
    expect(classifyIncoming('{"jsonrpc":"2.0","id":{"a":1},"method":"history.save"}', ours).kind).toBe("invalid");
    expect(classifyIncoming(`{"jsonrpc":"2.0","id":"${"i".repeat(201)}","method":"history.save"}`, ours).kind).toBe("invalid");
  });
  it("a response to an id we never sent, non-JSON and a non-object are invalid", () => {
    expect(classifyIncoming('{"jsonrpc":"2.0","id":9,"result":1}', ours).kind).toBe("invalid");
    expect(classifyIncoming("not json", ours).kind).toBe("invalid");
    expect(classifyIncoming("[1,2]", ours).kind).toBe("invalid");
    expect(classifyIncoming("null", ours).kind).toBe("invalid");
    expect(classifyIncoming('{"jsonrpc":"2.0","id":{"__proto__":1},"result":1}', ours).kind).toBe("invalid");
    expect(classifyIncoming('{"jsonrpc":"1.0","id":1,"result":1}', ours).kind).toBe("invalid");
  });
  it("cuts an error message to 500 characters", () => {
    const c = classifyIncoming(`{"jsonrpc":"2.0","id":1,"error":{"code":1,"message":"${"e".repeat(900)}"}}`, ours);
    expect(c.kind === "response" && c.error?.length).toBe(500);
  });
  it("an error without a message string still rejects the call", () => {
    expect(classifyIncoming('{"jsonrpc":"2.0","id":1,"error":{"code":1}}', ours)).toEqual({
      kind: "response",
      id: 1,
      error: "The backend answered with an error",
    });
  });
});

describe("isBackendName", () => {
  it("takes the name regex and nothing else", () => {
    expect(isBackendName("echo")).toBe(true);
    expect(isBackendName("files.list:v2")).toBe(true);
    expect(isBackendName("1abc")).toBe(false);
    expect(isBackendName("a".repeat(101))).toBe(false);
    expect(isBackendName(3)).toBe(false);
  });
});

describe("encode", () => {
  it("one line of JSON-RPC 2.0", () => {
    expect(encode({ id: 3, method: "echo", params: { a: 1 } })).toBe('{"jsonrpc":"2.0","id":3,"method":"echo","params":{"a":1}}\n');
    expect(encode({ method: "init", params: {} })).toBe('{"jsonrpc":"2.0","method":"init","params":{}}\n');
  });
});

describe("EventLimiter (B5)", () => {
  it("lets 200 through in a second, drops the rest, and counts them", () => {
    let now = 0;
    const l = new EventLimiter(200, () => now);
    let passed = 0;
    for (let i = 0; i < 250; i++) if (l.take()) passed++;
    expect(passed).toBe(200);
    expect(l.flushDropped()).toBe(50);
    expect(l.flushDropped()).toBe(0);
    now = 1001;
    expect(l.take()).toBe(true);
  });
  it("is a rolling window, not a fixed one", () => {
    let now = 0;
    const l = new EventLimiter(2, () => now);
    l.take();
    now = 600;
    l.take();
    now = 1001;
    expect(l.take()).toBe(true); // the one at 0 left the window
    expect(l.take()).toBe(false); // 600 and 1001 are in it
  });
});
