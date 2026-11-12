import path from "node:path";
import { CORE_MOD_LIST } from "./core-mod-list";

/** The built copy of the core mods: `out/core-mods/`, beside `out/main/` (packaged and dev alike). */
const builtDir = path.join(import.meta.dirname, "..", "core-mods");

/**
 * The core mods' ids and default switches: core-mod-list.ts's, and Home, the screen the app opens on, on (minimal-core
 * step 0b1). Plain data: the shell build copies each one's files from `packages/mods/<id>/` (electron.vite.config.ts).
 */
export const CORE_MOD_SWITCHES: Record<string, { on?: boolean }> = { ...CORE_MOD_LIST, home: { on: true } };

/** Mods the core ships (spec D2), each at its built copy, with its default switch. */
export const CORE_MODS: Record<string, { dir: string; on?: boolean }> = Object.fromEntries(
  Object.entries(CORE_MOD_SWITCHES).map(([id, m]) => [id, { ...m, dir: path.join(builtDir, id) }]),
);

/** Whether a core mod is on by default. */
export const coreModOn = (id: string): boolean => Object.hasOwn(CORE_MODS, id) && CORE_MODS[id].on === true;
