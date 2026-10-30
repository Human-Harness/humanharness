import type { SecretCrypto } from "./secret-store";

/**
 * The SecretStore's crypto over Electron's safeStorage (Decision 17). On Linux without a keyring safeStorage
 * "encrypts" with a hard-coded key (`basic_text`): that counts as unavailable, so keys are refused, never stored in
 * the clear.
 */
export function safeStorageCrypto(
  storage: Pick<typeof import("electron").safeStorage, "isEncryptionAvailable" | "encryptString" | "decryptString" | "getSelectedStorageBackend">,
  platform: NodeJS.Platform = process.platform,
): SecretCrypto {
  return {
    available: () => {
      try {
        if (!storage.isEncryptionAvailable()) return false;
        return platform !== "linux" || storage.getSelectedStorageBackend() !== "basic_text";
      } catch {
        return false;
      }
    },
    encrypt: (text) => storage.encryptString(text),
    decrypt: (data) => storage.decryptString(data),
  };
}
