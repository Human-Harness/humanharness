import path from "node:path";
import { MOD_ID } from "@humanharness/mod-sdk";
import type { ModsConfig } from "@humanharness/protocol";

export type ModOrigin = "core" | "harness" | "local";
/**
 * `config.json` → `mods` as the shell keeps it: the protocol's fields and `trusted`, the user-layer mods the person
 * reviewed and accepted (minimal-core 0b2); one of those turns on without another review.
 */
export type ModsSettings = ModsConfig & { trusted?: string[] };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `config.json` → `mods`, cleaned; undefined when nothing is left. */
export function cleanModsConfig(v: unknown): ModsSettings | undefined {
  if (!isObj(v)) return undefined;
  const out: ModsSettings = {};
  if (Array.isArray(v.trusted)) {
    const trusted = [...new Set(v.trusted.filter((id): id is string => typeof id === "string" && MOD_ID.test(id)))];
    if (trusted.length > 0) out.trusted = trusted;
  }
  if (isObj(v.on)) {
    const on = Object.fromEntries(Object.entries(v.on).filter(([id, b]) => MOD_ID.test(id) && typeof b === "boolean")) as Record<string, boolean>;
    if (Object.keys(on).length > 0) out.on = on;
  }
  if (Array.isArray(v.local)) {
    const local = [...new Set(v.local.filter((p): p is string => typeof p === "string" && path.isAbsolute(p)))];
    if (local.length > 0) out.local = local;
  }
  if (isObj(v.failed)) {
    const failed = Object.fromEntries(Object.entries(v.failed).filter(([id, r]) => MOD_ID.test(id) && typeof r === "string").map(([id, r]) => [id, (r as string).slice(0, 300)]));
    if (Object.keys(failed).length > 0) out.failed = failed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * On when not failed, and then the person's switch, else on if the harness declares it or it is a core mod that is
 * on by default (`coreOn`, from `CORE_MODS`).
 */
export function isModOn(id: string, origin: ModOrigin, c: ModsConfig | undefined, coreOn = false): boolean {
  if (c?.failed?.[id] !== undefined) return false;
  const own = c?.on?.[id];
  if (own !== undefined) return own;
  return origin === "harness" || (origin === "core" && coreOn);
}
