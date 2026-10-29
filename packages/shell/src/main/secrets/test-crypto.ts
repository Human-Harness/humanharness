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
      if (!s.startsWith(PREFIX)) throw new Error("not a test key");
      return Buffer.from(s.slice(PREFIX.length), "hex").toString("utf8");
    },
  };
}
