import { claude } from "./claude/definition";
import { codex } from "./codex/definition";
import { gemini, kimi, qwen } from "./listed";
import { opencode } from "./opencode/definition";
import type { EngineDef, LegalStatus, Mode } from "./types";

export * from "./models";
export * from "./types";
export * from "./contract";
export { classifyError } from "./classify";
export { OPENCODE_ENV, OPENCODE_PERMISSION } from "./opencode/definition";

export const ENGINES: readonly EngineDef[] = [claude, codex, opencode, kimi, gemini, qwen];

export function getEngine(id: string): EngineDef {
  const engine = ENGINES.find((e) => e.id === id);
  if (!engine) throw new Error(`Unknown engine: ${id}`);
  return engine;
}

/** Brands a harness may not use in its name, tagline or logo: each engine's name, its provider's first word and extra marks. */
export function brandNames(): string[] {
  return [...new Set(ENGINES.flatMap((e) => [e.name, e.provider.split(" ")[0], ...(e.brands ?? [])]))];
}

/** Engines a harness may offer: the ones it was tested with, filtered by legal status. */
export function availableEngines(harnessEngineIds: string[], mode: Mode): EngineDef[] {
  const accepted: LegalStatus[] = mode === "distribution" ? ["allowed"] : ["allowed", "pending"];
  return harnessEngineIds
    .map((id) => ENGINES.find((e) => e.id === id))
    .filter((e): e is EngineDef => e !== undefined && accepted.includes(e.status));
}

/** Bumped whenever the legal notice text changes, so users accept it again. */
export const NOTICE_VERSION = 1;

/** The first x.y.z in a CLI's version output ("2.1.296 (Claude Code)", "codex-cli 0.160.1"). */
export function parseVersion(output: string): string | null {
  return /\d+\.\d+\.\d+/.exec(output)?.[0] ?? null;
}

/** True when `version` is `min` or newer (numeric x.y.z comparison). */
export function meetsMinVersion(version: string, min: string): boolean {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
