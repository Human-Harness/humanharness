import { z } from "zod";
import { HIDDEN_CHARS } from "./plugin";

/** A linked folder's key: the action id pattern (spec §3.1). */
export const LINKED_KEY = /^[a-z][a-z0-9_-]{0,63}$/;
/** The most keys a harness may declare. */
export const LINKED_KEYS_MAX = 8;
/** The most folders one scope may link under one `many` key. */
export const LINKED_MANY_MAX = 16;

/** One kind of folder a scope may link (hatches spec §3.1). Strict: a typo is refused. */
export const linkedFolderSchema = z.strictObject({
  /** What Scope settings calls it: one English string (plan 5a). */
  label: z
    .string()
    .min(1)
    .max(40)
    .refine((v) => !HIDDEN_CHARS.test(v), { message: "Display text can't hold hidden or control characters" }),
  /** `read`: the agent reads only; `write`: it may change files there. */
  mode: z.enum(["read", "write"]),
  /** `auto`: tracked by the core history unless it is a git repository (D1); `own`: must be a git repository. */
  history: z.enum(["auto", "own"]).default("auto"),
  /** Several folders under this key, or one. */
  many: z.boolean().default(false),
});
export type LinkedFolderDecl = z.output<typeof linkedFolderSchema>;

export const linkedFoldersSchema = z
  .record(z.string().regex(LINKED_KEY), linkedFolderSchema)
  .refine((r) => Object.keys(r).length <= LINKED_KEYS_MAX, { message: `At most ${LINKED_KEYS_MAX} linked folder keys` });

/** The harness declares at least one kind of linked folder. False: no part-1 code runs (D0). */
export const hasLinkedFolders = (h: { linkedFolders?: Record<string, unknown> }): boolean =>
  !!h.linkedFolders && Object.keys(h.linkedFolders).length > 0;

/** The harness backend's entry: a relative path to a .ts, .mts, .js or .mjs file (hatches spec §4.1). */
export const backendSchema = z
  .string()
  .min(1)
  .regex(/^[^/\\][^:]*\.(ts|mts|js|mjs)$/, { message: "backend is a relative path to a .ts, .mts, .js or .mjs file" });

/** The harness declares a backend. False: no part-2 code runs (D0). */
export const hasBackend = (h: { backend?: string }): boolean => typeof h.backend === "string";

/** Each problem of the hatches a manifest declares (spec §3.1 checks), for `superRefine`. */
export function hatchProblems(h: {
  scopes?: unknown;
  permissions: { edit: "folder" | "none" };
  linkedFolders?: Record<string, LinkedFolderDecl>;
}): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  if (hasLinkedFolders(h) && !h.scopes) out.push({ path: ["linkedFolders"], message: "Linked folders belong to a scope: declare scopes" });
  for (const [key, f] of Object.entries(h.linkedFolders ?? {})) {
    if (f.mode === "write" && h.permissions.edit !== "folder") {
      out.push({ path: ["linkedFolders", key, "mode"], message: 'mode "write" needs permissions.edit: "folder"' });
    }
  }
  return out;
}
