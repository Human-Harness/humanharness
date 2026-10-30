import type { SecretCrypto } from "./secret-store";

const PREFIX = "hh-test:";

/**
 * A reversible stand-in for safeStorage (HH_TEST_FAKE_SECRETS=1, Decision 10): the e2e stores keys without the
 * Keychain. Hex behind a fixed prefix, so a file never holds the plaintext; development builds only.
 */
export function testCrypto(): SecretCrypto {
  return {
    available: () => true,
    encrypt: (text) => Buffer.from(PREFIX + Buffer.from(text, "utf8").toString("hex")),
    decrypt: (data) => {
      const s = data.toString();
      const hex = s.slice(PREFIX.length);
      // Buffer.from(…, "hex") stops quietly at the first non-hex character; a foreign payload must throw instead.
      if (!s.startsWith(PREFIX) || !/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error("not a test key");
      return Buffer.from(hex, "hex").toString("utf8");
    },
  };
}
