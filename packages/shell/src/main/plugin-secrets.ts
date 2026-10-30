/** The plugins' keys now live in the core secret store (tools spec §9); this path stays for plugin code and tests. */
export { SECRET_MAX, SECRET_MIN, type SecretCrypto, type SecretResult, SecretStore } from "./secrets/secret-store";
