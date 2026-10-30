// Node-free, like the SDK's other tool entries: `@humanharness/harness-sdk/tool-fixtures`.
import { z } from "zod";
import { COLLECTION_NAME } from "./data";
import { fixtureSchema } from "./plugin-fixture-schema";
import { TOOL_ID } from "./tools";

/** A scope a tool call can run in: a scope name, or `_app` for app-wide work. */
const SCOPE = /^(?:_app|[a-z0-9][a-z0-9_-]{0,63})$/;
/**
 * `__proto__` as a JSON key is an own key after JSON.parse, and zod's record drops it without a word: it is refused
 * before the record reads the object.
 */
const noProto = <T extends z.ZodType>(record: T) =>
  z
    .unknown()
    .refine((raw) => !(typeof raw === "object" && raw !== null && Object.hasOwn(raw, "__proto__")), "__proto__ is not a name")
    .pipe(record);
const HIDDEN = new Set([".harness", ".git"]);
/**
 * A file inside the fixture's temp folder, by the shell's tool-files rules: no NUL or `\`, not absolute, `""` and `.`
 * parts dropped (something must be left), no `..`, and no `.harness` or `.git` at any depth in any case (macOS's disk
 * ignores case). It names a file, so it doesn't end in `/`.
 */
function insideFolder(p: string): boolean {
  if (p.includes("\0") || p.includes("\\") || p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.endsWith("/")) return false;
  const parts = p.split("/").filter((x) => x !== "" && x !== ".");
  return parts.length > 0 && !parts.includes("..") && !parts.some((x) => HIDDEN.has(x.toLowerCase()));
}
const filePath = z.string().min(1).max(512).refine(insideFolder, "must be a relative path to a file inside the folder, outside .harness/ and .git/");

/** One case of `humanharness tool test` (tools spec §11, Decision 1): `tools/<id>/fixtures/<name>.json`. */
export const toolFixtureSchema = z.strictObject({
  args: noProto(z.record(z.string(), z.unknown())).default({}),
  inputs: noProto(z.record(z.string().regex(TOOL_ID), z.unknown())).optional(),
  scope: z.string().regex(SCOPE).nullable().default(null),
  exchanges: z.array(fixtureSchema).max(200).optional(),
  data: noProto(z.record(z.string().regex(COLLECTION_NAME), z.array(noProto(z.record(z.string(), z.unknown()))).max(1000))).optional(),
  files: noProto(z.record(filePath, z.string().max(1024 * 1024))).optional(),
  expect: z.union([z.strictObject({ result: z.unknown() }), z.strictObject({ error: z.string().min(1).max(500) })]),
});
export type ToolFixture = z.output<typeof toolFixtureSchema>;
