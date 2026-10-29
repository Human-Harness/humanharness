import { HIDDEN_CHARS, TOOL_ID } from "@humanharness/harness-sdk";
import { fenceFor } from "@humanharness/workspace";

/** The longest `## Data` sent to an AI step (R4): about 50,000 tokens. */
export const DATA_MAX_CHARS = 200_000;

const TITLE = "## Data";
const CUT_NOTE = `(cut: the data is longer than ${DATA_MAX_CHARS} characters)`;

const HIDDEN = new RegExp(HIDDEN_CHARS.source, "gu");
/** `\uXXXX` for each UTF-16 unit of `c`. */
const escape = (c: string) => Array.from({ length: c.length }, (_, i) => `\\u${c.charCodeAt(i).toString(16).padStart(4, "0")}`).join("");
/**
 * Compact JSON with every hidden character (line separators, bidi controls, zero-width and tag characters: the SDK's
 * HIDDEN_CHARS) written as a `\u` escape: the value parses back exact, and nothing hidden reaches the model raw.
 */
const jsonOf = (value: unknown) => (JSON.stringify(value) ?? "null").replace(HIDDEN, escape);

const part = (name: string, json: string, fence = fenceFor(json)) => `### ${name}\n\n${fence}json\n${json}\n${fence}`;

/** `text`'s first `n` UTF-16 units, never ending inside a surrogate pair. */
function head(text: string, n: number): string {
  const cut = text.slice(0, Math.max(0, n));
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * The AI step's data (tools spec §7.1): one `### <name>` part per input, compact JSON in a fence one longer than its
 * longest backtick run, so a value can't close it (R4). A name must be a TOOL_ID (an `as`), so a heading is always one
 * plain line. The section is at most DATA_MAX_CHARS characters before its cut note: whole parts while they fit, then
 * the first that doesn't is cut inside its own (closed) fence, the rest go, and the note follows outside every fence.
 */
export function dataSection(parts: { name: string; value: unknown }[]): string {
  for (const { name } of parts) if (!TOOL_ID.test(name)) throw new Error("Not a step name");
  let text = TITLE;
  for (const { name, value } of parts) {
    const json = jsonOf(value);
    const whole = `\n\n${part(name, json)}`;
    if (text.length + whole.length <= DATA_MAX_CHARS) {
      text += whole;
      continue;
    }
    // The cut JSON's fence is never longer than the whole one's, so this room is enough for it.
    const room = DATA_MAX_CHARS - text.length - (whole.length - json.length);
    if (room > 0) text += `\n\n${part(name, head(json, room))}`;
    return `${text}\n\n${CUT_NOTE}`;
  }
  return text;
}
