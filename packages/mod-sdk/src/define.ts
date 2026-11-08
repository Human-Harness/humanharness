import type { ZodType } from "zod";
import type { MainCtx, ModDefinition, UiCtx } from "./types";

/** Types a mod. `mod.json` stays the source of id, name and version; the host checks the ids match. */
export function defineMod<C = undefined>(def: { id: string; schema?: ZodType<C>; main?(ctx: MainCtx<C>): void | Promise<void>; ui?(ctx: UiCtx): void }): ModDefinition<C> {
  return def;
}
