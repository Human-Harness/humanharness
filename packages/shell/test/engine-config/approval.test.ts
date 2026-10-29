import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { engineApprovalTag, engineApprovalValid, enginePinTag, enginePinValid } from "../../src/main/engine-config/approval";

const secret = randomBytes(32);
const hash = "ab".repeat(32);
const at = "2026-10-28T09:00:00.000Z";

describe("engine approval tag (spec §5.3, E10)", () => {
  it("the app's own approval is valid in its profile and scope", () => {
    const tag = engineApprovalTag("", "intro", { hash, at }, secret);
    expect(tag).toMatch(/^[0-9a-f]{64}$/);
    expect(engineApprovalValid({ hash, at, tag }, "", "intro", secret)).toBe(true);
  });

  it("a forged approval without a tag or with a wrong one is invalid", () => {
    const tag = engineApprovalTag("", "intro", { hash, at }, secret);
    expect(engineApprovalValid(undefined, "", "intro", secret)).toBe(false);
    expect(engineApprovalValid({ hash, at } as never, "", "intro", secret)).toBe(false);
    expect(engineApprovalValid({ hash, at, tag: "0".repeat(64) }, "", "intro", secret)).toBe(false);
    expect(engineApprovalValid({ hash, at, tag: tag.slice(1) }, "", "intro", secret)).toBe(false);
    // The tag covers the hash and the time: neither can be swapped under it.
    expect(engineApprovalValid({ hash: "cd".repeat(32), at, tag }, "", "intro", secret)).toBe(false);
    expect(engineApprovalValid({ hash, at: "2026-10-29T09:00:00.000Z", tag }, "", "intro", secret)).toBe(false);
    // Another key (another install) or no key at all.
    expect(engineApprovalValid({ hash, at, tag }, "", "intro", randomBytes(32))).toBe(false);
    expect(engineApprovalValid({ hash, at, tag }, "", "intro", null)).toBe(false);
  });

  it("another profile's or another scope's tag is invalid", () => {
    const tag = engineApprovalTag("work", "intro", { hash, at }, secret);
    expect(engineApprovalValid({ hash, at, tag }, "work", "intro", secret)).toBe(true);
    expect(engineApprovalValid({ hash, at, tag }, "", "intro", secret)).toBe(false);
    expect(engineApprovalValid({ hash, at, tag }, "home", "intro", secret)).toBe(false);
    expect(engineApprovalValid({ hash, at, tag }, "work", "other", secret)).toBe(false);
  });

  it("epoch 0 is the tag made before epochs existed; a later epoch's tag differs and verifies only at it", () => {
    const v1 = createHmac("sha256", secret).update(JSON.stringify(["hh-engine-v1", "", "intro", hash, at])).digest("hex");
    expect(engineApprovalTag("", "intro", { hash, at }, secret)).toBe(v1);
    expect(engineApprovalTag("", "intro", { hash, at }, secret, 0)).toBe(v1);
    expect(engineApprovalValid({ hash, at, tag: v1 }, "", "intro", secret, 0)).toBe(true);
    // Revoked (epoch 1): the old tag no longer verifies; one made at 1 does, and only at 1.
    expect(engineApprovalValid({ hash, at, tag: v1 }, "", "intro", secret, 1)).toBe(false);
    const e1 = engineApprovalTag("", "intro", { hash, at }, secret, 1);
    expect(e1).not.toBe(v1);
    expect(engineApprovalValid({ hash, at, tag: e1 }, "", "intro", secret, 1)).toBe(true);
    expect(engineApprovalValid({ hash, at, tag: e1 }, "", "intro", secret, 2)).toBe(false);
    expect(engineApprovalValid({ hash, at, tag: e1 }, "", "intro", secret, 0)).toBe(false);
    // The epoch record unreadable: nothing verifies.
    expect(engineApprovalValid({ hash, at, tag: v1 }, "", "intro", secret, null)).toBe(false);
  });

  it("a task's pin carries the epoch too", () => {
    const pin0 = enginePinTag("", "intro", "t1", hash, secret);
    expect(enginePinTag("", "intro", "t1", hash, secret, 0)).toBe(pin0);
    expect(enginePinValid(pin0, "", "intro", "t1", hash, secret, 0)).toBe(true);
    expect(enginePinValid(pin0, "", "intro", "t1", hash, secret, 1)).toBe(false);
    expect(enginePinValid(enginePinTag("", "intro", "t1", hash, secret, 1), "", "intro", "t1", hash, secret, 1)).toBe(true);
    expect(enginePinValid(pin0, "", "intro", "t1", hash, secret, null)).toBe(false);
  });
});
