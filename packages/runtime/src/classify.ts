import type { ErrorCode } from "./events";

const SESSION = /not logged in|\/login|invalid api key|oauth|unauthori[sz]ed|\b401\b|authentication/i;
const QUOTA = /usage limit|rate limit|limit reached|quota|\b429\b/i;

/** Maps an engine's error text to an ErrorCode. Unknown errors count as a crash. */
export function classifyError(text: string): ErrorCode {
  if (SESSION.test(text)) return "session-expired";
  if (QUOTA.test(text)) return "out-of-quota";
  return "agent-crashed";
}
