import { describe, expect, it } from "vitest";
import { SECRET_SCAN_BYTES, secretShaped, withoutSecretLines } from "../src";

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

  it("only scans the first 256 KB", () => {
    expect(secretShaped(`${"a ".repeat(SECRET_SCAN_BYTES / 2)}ghp_${"A".repeat(36)}`)).toBe(false);
  });
});

describe("withoutSecretLines (notes and chats, §8.2)", () => {
  it("leaves the line out and keeps the rest", () => {
    expect(withoutSecretLines(`# Engines\nuse ghp_${"A".repeat(36)} here\nbudget plan`)).toBe("# Engines\nbudget plan");
  });
});
