import { describe, expect, it } from "vitest";
import { MAX_TEXT_BYTES, SECRET_SCAN_BYTES, secretShaped, withoutSecretLines } from "../src";

describe("secretShaped (§8.2)", () => {
  it.each([
    `key = sk-${"a".repeat(40)}`,
    `ghp_${"A".repeat(36)}`,
    `gho_${"b".repeat(36)}`,
    `github_pat_${"A1".repeat(20)}`,
    "token: xoxb-1234567890-abcdef",
    "AKIAABCDEFGHIJKLMNOP",
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN PRIVATE KEY-----",
    `glpat-${"x".repeat(20)}`,
  ])("hits %s", (text) => {
    expect(secretShaped(`before\n${text}\nafter`)).toBe(true);
  });

  it.each([
    "sk-short",
    "the ghp_ prefix names a GitHub token",
    "akiaabcdefghijklmnop",
    "-----BEGIN PUBLIC KEY-----",
    "xoxq-1234567890",
    "glpat-short",
  ])("near miss: %s", (text) => {
    expect(secretShaped(text)).toBe(false);
  });

  it("scans all the text that can be indexed", () => {
    expect(SECRET_SCAN_BYTES).toBe(MAX_TEXT_BYTES);
    expect(secretShaped(`${"a ".repeat(MAX_TEXT_BYTES / 2 - 40)}ghp_${"A".repeat(36)}`)).toBe(true);
  });

  it.each([`ANTHROPIC_KEY_sk-ant-${"a".repeat(40)}`, "AWS_AKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOP_prod", `x_ghp_${"A".repeat(36)}`])(
    "hits a token right after or before _: %s",
    (text) => {
      expect(secretShaped(text)).toBe(true);
    },
  );

  it.each([`task-${"a".repeat(40)}`, "XAKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOPQ"])("near miss inside a word: %s", (text) => {
    expect(secretShaped(text)).toBe(false);
  });
});

describe("withoutSecretLines (notes and chats, §8.2)", () => {
  it("leaves the line out and keeps the rest", () => {
    expect(withoutSecretLines(`# Engines\nuse ghp_${"A".repeat(36)} here\nbudget plan`)).toBe("# Engines\nbudget plan");
  });

  it("leaves a whole private key out, through its END line", () => {
    const key = ["-----BEGIN RSA PRIVATE KEY-----", "MIIEowIBAAKCAQEAx1", "Zm9vYmFyYmF6", "-----END RSA PRIVATE KEY-----"].join("\n");
    const out = withoutSecretLines(`# Deploy\n${key}\nafter the key`);
    expect(out).toBe("# Deploy\nafter the key");
    expect(out).not.toContain("MIIE");
    expect(out).not.toContain("END");
  });

  it.each(["", "EC ", "OPENSSH ", "ENCRYPTED "])("leaves a %sPRIVATE KEY block out", (kind) => {
    const out = withoutSecretLines(`a\n-----BEGIN ${kind}PRIVATE KEY-----\nbody\n-----END ${kind}PRIVATE KEY-----\nb`);
    expect(out).toBe("a\nb");
  });

  it("leaves a PGP private key block out", () => {
    const out = withoutSecretLines("a\n-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nlQOYBF\n=abcd\n-----END PGP PRIVATE KEY BLOCK-----\nb");
    expect(out).toBe("a\nb");
  });

  it("without an END line, leaves out everything after the BEGIN line", () => {
    expect(withoutSecretLines("a\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\nmore")).toBe("a");
  });

  it("keeps a public key", () => {
    const text = "a\n-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----\nb";
    expect(withoutSecretLines(text)).toBe(text);
  });
});
