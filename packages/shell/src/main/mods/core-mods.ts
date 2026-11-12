import path from "node:path";
import { CORE_MOD_LIST } from "./core-mod-list";

/** The built copy of the core mods: `out/core-mods/`, beside `out/main/` (packaged and dev alike). */
const builtDir = path.join(import.meta.dirname, "..", "core-mods");

/** Mods the core ships (spec D2), each at its built copy, with its default switch (see core-mod-list.ts). */
export const CORE_MODS: Record<string, { dir: string; on?: boolean }> = Object.fromEntries(
  Object.entries(CORE_MOD_LIST).map(([id, m]) => [id, { ...m, dir: path.join(builtDir, id) }]),
);

/** Whether a core mod is on by default. */
export const coreModOn = (id: string): boolean => Object.hasOwn(CORE_MODS, id) && CORE_MODS[id].on === true;
