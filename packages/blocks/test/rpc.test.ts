import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { type Rpc, RpcRefused, callRpc, openRpc } from "../src";

let rpc: Rpc | undefined;
afterEach(async () => {
  await rpc?.close();
  rpc = undefined;
});

describe("rpc", () => {
  it("answers each request with the handler's result", async () => {
    const seen: unknown[] = [];
    rpc = await openRpc(async (request) => {
      seen.push(request);
      return { echo: request, big: "x".repeat(200_000) };
    });
    const [a, b] = await Promise.all([callRpc(rpc, { op: "get", n: 1 }), callRpc(rpc, { op: "get", n: 2 })]);
    expect(a).toMatchObject({ echo: { op: "get", n: 1 } });
    expect((b as { big: string }).big).toHaveLength(200_000);
    expect(seen).toHaveLength(2);
  });

  it("passes the handler's refusal back as RpcRefused", async () => {
    rpc = await openRpc(async () => {
      throw new Error("not allowed");
    });
    const err = await callRpc(rpc, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcRefused);
    expect((err as Error).message).toBe("not allowed");
  });

  it("tells a handler's \"Bad token\" refusal from a bad token", async () => {
    rpc = await openRpc(async () => {
      throw new Error("Bad token");
    });
    const err = await callRpc(rpc, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcRefused);
    expect((err as Error).message).toBe("Bad token");
    const bad = await callRpc({ path: rpc.path, token: "wrong" }, {}).catch((e: unknown) => e);
    expect(bad).not.toBeInstanceOf(RpcRefused);
  });

  it("refuses a caller without the token, and cleans up on close", async () => {
    let calls = 0;
    rpc = await openRpc(async () => ++calls);
    await expect(callRpc({ path: rpc.path, token: "wrong" }, {})).rejects.toThrow(/token/);
    expect(calls).toBe(0);
    const where = rpc.path;
    await rpc.close();
    rpc = undefined;
    if (process.platform !== "win32") expect(fs.existsSync(where)).toBe(false);
    await expect(callRpc({ path: where, token: "x" }, {}, 500)).rejects.toThrow();
  });
});
