// Node-free: the exchange schema alone, so `tool-fixtures.ts` can use it without plugin-fixtures.ts's Buffer.
import { z } from "zod";

const MAX_TEXT = 10 * 1024 * 1024;
const headers = z.record(z.string().max(200), z.string().max(8192));
/** One recorded exchange: `fixtures/<source>/<NNN>.json` (Decision 14). Hostile input, like all of a plugin's files. */
export const fixtureSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("fetch"),
    request: z.strictObject({ method: z.string().regex(/^[A-Z]{3,7}$/), url: z.string().max(4096), headers: headers.optional(), body: z.string().max(MAX_TEXT).optional() }),
    // 200–599: what a Response can carry; 1xx never reaches a fetch caller.
    response: z.strictObject({ status: z.number().int().min(200).max(599), headers, text: z.string().max(MAX_TEXT) }),
  }),
  z.strictObject({
    kind: z.literal("exec"),
    request: z.strictObject({ cmd: z.string().max(64), args: z.array(z.string().max(4096)).max(64) }),
    response: z.strictObject({ code: z.number().int(), stdout: z.string().max(MAX_TEXT), stderr: z.string().max(MAX_TEXT) }),
  }),
]);
