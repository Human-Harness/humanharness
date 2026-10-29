import { describe, expect, it } from "vitest";
import { testCrypto } from "../../src/main/secrets/test-crypto";

describe("testCrypto (HH_TEST_FAKE_SECRETS: e2e keys without the Keychain)", () => {
  it("testCrypto round-trips, never stores the plaintext, and is available", () => {
    const c = testCrypto();
    const b = c.encrypt("tok-123456789");
    expect(b.toString()).not.toContain("tok-123456789");
    expect(c.decrypt(b)).toBe("tok-123456789");
    expect(c.available()).toBe(true);
  });

  it("refuses to decrypt what it did not encrypt", () => {
    expect(() => testCrypto().decrypt(Buffer.from("tok-123456789"))).toThrow();
  });
});
