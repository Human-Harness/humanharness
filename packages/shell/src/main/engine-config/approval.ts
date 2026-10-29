import { createHmac, timingSafeEqual } from "node:crypto";
import type { EngineApproval } from "@humanharness/workspace";

// A scope's engine approval is signed by the app (hatches spec §5.3, E1, E10). `.harness/scopes.json` sits in the
// folder the agent can write and the hash has no secret, so without a tag the agent could approve its own config.
// The key is the links' one (`linkedSecret` in linked-ipc.ts). An old signed approval can be pasted back; it
// only restores a config the person approved once, so no nonce is kept.

/** HMAC-SHA256 with the app's key over profile ("" without profiles), scope, hash and time. */
export function engineApprovalTag(profile: string, scope: string, a: { hash: string; at: string }, secret: Buffer): string {
  return createHmac("sha256", secret).update(JSON.stringify(["hh-engine-v1", profile, scope, a.hash, a.at])).digest("hex");
}

/** Whether `a` carries the tag the app made for it in `profile`/`scope`. No approval or no key: not valid. */
export function engineApprovalValid(a: EngineApproval | undefined, profile: string, scope: string, secret: Buffer | null): boolean {
  if (!a || !secret || typeof a.tag !== "string" || typeof a.hash !== "string" || typeof a.at !== "string") return false;
  const want = Buffer.from(engineApprovalTag(profile, scope, a, secret));
  const got = Buffer.from(a.tag);
  return want.length === got.length && timingSafeEqual(want, got);
}
