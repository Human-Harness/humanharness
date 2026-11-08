import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineMod, type MainCtx, type SendVerdict } from "../src";

describe("defineMod", () => {
  it("returns the definition unchanged and types ctx.config from the schema", () => {
    const def = defineMod({
      id: "echo",
      schema: z.object({ word: z.string().default("pong") }),
      main(ctx) {
        expectTypeOf(ctx.config.word).toEqualTypeOf<string>();
        ctx.on.beforeSend(async (send): Promise<SendVerdict> => (send.text === "ping" ? { kind: "rewrite", text: ctx.config.word } : { kind: "pass" }));
      },
    });
    expect(def.id).toBe("echo");
    expectTypeOf(def.main).parameter(0).toEqualTypeOf<MainCtx<{ word: string }>>();
  });
  it("allows a mod with no schema (config is undefined)", () => {
    const def = defineMod({ id: "bare", main(ctx) { expectTypeOf(ctx.config).toEqualTypeOf<undefined>(); } });
    expect(def.schema).toBeUndefined();
  });
});
