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

describe("secretShaped, widened shapes (§8.2, widened 2026-10-30)", () => {
  const jwt = `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.${"s".repeat(20)}`;
  it.each([
    `ghu_${"A".repeat(36)}`,
    `ghs_${"b".repeat(36)}`,
    `ghr_${"C1".repeat(18)}`,
    `github_pat_${"A".repeat(22)}`,
    `token: xoxa-${"1".repeat(12)}`,
    `xoxp-${"1".repeat(12)}`,
    `xoxr-${"1".repeat(12)}`,
    `xoxs-${"1".repeat(12)}`,
    `xoxo-${"1".repeat(12)}`,
    `xoxe-${"1".repeat(12)}`,
    `xapp-1-A0123BCDEF-1234567890-${"a".repeat(20)}`,
    `Authorization: Bearer ${jwt}`,
    "ASIAABCDEFGHIJKLMNOP",
    "AWS_ASIAABCDEFGHIJKLMNOP",
    "-----BEGIN PGP PRIVATE KEY BLOCK-----",
    "LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQpNSUlFb3dJQkFBS0NBUUVBeDE=",
    "tls.key: LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JSUV2UUlCQURBTkJna3Foa2lH",
    `sk_live_${"a1".repeat(12)}`,
    `rk_live_${"B".repeat(16)}`,
    `STRIPE_sk_live_${"a".repeat(24)}`,
    `AIza${"A1_-".repeat(8)}abc`,
    `GOOGLE_KEY=AIza${"x".repeat(35)}`,
  ])("hits %s", (text) => {
    expect(secretShaped(`before\n${text}\nafter`)).toBe(true);
  });

  it.each([
    `ghx_${"A".repeat(36)}`,
    "ghu_short",
    "github_pat_",
    `xoxq-${"1".repeat(12)}`,
    "xapp-short",
    "the xapp- prefix names a Slack app token",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    "eyJ.eyJ.abc",
    "asiaabcdefghijklmnop",
    "ASIAABCDEFGHIJKLMNOPQ",
    "XASIAABCDEFGHIJKLMNOP",
    "-----BEGIN PGP PUBLIC KEY BLOCK-----",
    "LS0tLS1CRUdJTiBSU0E",
    `xLS0tLS1CRUdJTi${"A".repeat(40)}`,
    `sk_test_${"a".repeat(24)}`,
    "sk_live_short",
    `dsk_live_${"a".repeat(24)}`,
    `AIza${"x".repeat(34)}`,
    `AIza${"x".repeat(36)}`,
    `xAIza${"x".repeat(35)}`,
  ])("near miss: %s", (text) => {
    expect(secretShaped(text)).toBe(false);
  });

  it("leaves a note's line with a widened shape out", () => {
    const jwtLine = `curl -H "Authorization: Bearer ${jwt}"`;
    expect(withoutSecretLines(`# API\n${jwtLine}\nAIza${"x".repeat(35)}\nsk_live_${"a".repeat(24)}\nrest`)).toBe("# API\nrest");
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

  it("leaves a wrapped base64 PEM out, through its last base64 line", () => {
    const pem = ["tls.key: LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JSUV2UUlCQURBTkJna3Foa2lH", "  OXcwQkFRRUZBQVNDQktjd2dnU2pBZ0VBQW9JQkFRQzdWSlRVdDlVczhjS2pNekVm", "  WVd4c2IzY2dkR2hsSUhkcGJtUT0="].join("\n");
    expect(withoutSecretLines(`a\n${pem}\nname: web\n`)).toBe("a\nname: web\n");
    expect(withoutSecretLines(`a\n${pem}\n\nb`)).toBe("a\n\nb");
    expect(withoutSecretLines(`a\n${pem}`)).toBe("a");
  });

  it("keeps a public key", () => {
    const text = "a\n-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----\nb";
    expect(withoutSecretLines(text)).toBe(text);
  });
});
