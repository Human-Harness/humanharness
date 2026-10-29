import { describe, expect, it } from "vitest";
import { execAllowed, fillSecrets, hostAllowed, type PluginPermissions, permissionLines, permissionsAdded, REDACTED, redact, secretRefs } from "../src/index";

describe("hostAllowed (§4.2, Decision 8)", () => {
  const hosts = ["*.atlassian.net", "api.firehydrant.io", "internal.example.com:8443"];
  it.each([
    ["https://acme.atlassian.net/rest", true],
    ["https://a.b.atlassian.net/", true],
    ["https://ACME.Atlassian.NET/", true],
    ["https://acme.atlassian.net./", true],
    ["https://api.firehydrant.io/v1", true],
    ["https://api.firehydrant.io:443/v1", true],
    ["https://internal.example.com:8443/x", true],
    ["https://atlassian.net/", false],
    ["https://evilatlassian.net/", false],
    ["https://atlassian.net.evil.com/", false],
    ["https://acme.atlassian.net.evil.com/", false],
    ["https://.atlassian.net/", false],
    ["http://api.firehydrant.io/", false],
    ["https://api.firehydrant.io:444/", false],
    ["https://internal.example.com/x", false],
    ["https://internal.example.com:443/x", false],
    ["https://user:pw@api.firehydrant.io/", false],
    ["https://user@api.firehydrant.io/", false],
    ["https://api.firehydrant.io@evil.com/", false],
    ["https://evil.com#@api.firehydrant.io/", false],
    ["https://evil.com\\@api.firehydrant.io/", false],
    ["https://127.0.0.1/", false],
    ["https://2130706433/", false],
    ["https://0x7f.1/", false],
    ["https://[::1]/", false],
    ["https://localhost/", false],
    ["https://a.localhost/", false],
    ["file:///etc/hosts", false],
    ["hh-plugin://other/x", false],
    ["wss://api.firehydrant.io/", false],
    ["javascript:alert(1)", false],
    ["not a url", false],
    ["", false],
  ])("%s → %s", (url, ok) => {
    expect(hostAllowed(url, hosts)).toBe(ok);
  });

  it("refuses localhost and IP literals even when declared", () => {
    expect(hostAllowed("https://localhost/", ["localhost"])).toBe(false);
    expect(hostAllowed("https://10.0.0.1/", ["10.0.0.1"])).toBe(false);
    expect(hostAllowed("https://foo.localhost/", ["*.localhost"])).toBe(false);
  });

  it("no pattern, no host; a malformed pattern matches nothing", () => {
    expect(hostAllowed("https://api.firehydrant.io/", [])).toBe(false);
    expect(hostAllowed("https://api.firehydrant.io/", ["*"])).toBe(false);
    expect(hostAllowed("https://api.firehydrant.io/", ["*.io:x"])).toBe(false);
    expect(hostAllowed("https://api.firehydrant.io/", ["api.firehydrant.io:"])).toBe(false);
  });

  it("an IDN host is compared in its punycode form", () => {
    expect(hostAllowed("https://bücher.example/", ["xn--bcher-kva.example"])).toBe(true);
  });
});

describe("execAllowed (§4.2, Decision 9)", () => {
  const gh = [
    { cmd: "gh", args: ["api", "--method", "GET", "*"] },
    { cmd: "date", args: [] },
  ];
  it.each([
    [["gh", ["api", "--method", "GET", "/repos/x"]], true],
    [["gh", ["api", "--method", "GET", "/repos/x", "--jq", ".[]"]], true],
    [["gh", ["api", "--method", "GET"]], false], // * needs one or more
    [["gh", ["api", "--method", "POST", "/repos/x"]], false],
    [["gh", ["api", "--method", "GET", "/x", "--method", "POST"]], false], // a flag of the prefix repeated after *
    [["gh", ["api", "--method", "GET", "/x", "--method=POST"]], false],
    [["gh", ["api", "--method", "GET", "/x", "--meth=POST"]], false], // an abbreviation (getopt_long)
    [["gh", ["api", "--method", "GET", "/x", "-XPOST"]], false], // the short alias
    [["gh", ["api", "--method", "GET", "/x", "-X", "POST"]], false],
    [["gh", ["api", "--method", "GET", "/x", "--request", "POST"]], false], // the other long alias
    [["gh", ["api", "--method", "GET", "/x", "-vXPOST"]], false], // grouped short options
    [["gh", ["api", "--method", "GET", "/x", "--", "--method", "POST"]], false],
    [["gh", ["api", "--method", "GET", "/x", "{{secret:jira}}"]], false],
    [["date", []], true],
    [["date", ["-u"]], false],
    [["sh", ["-c", "id"]], false],
    [["/usr/bin/gh", ["api", "--method", "GET", "/x"]], false],
    [["./gh", ["api", "--method", "GET", "/x"]], false],
    [["GH", ["api", "--method", "GET", "/x"]], false],
    [["gh", ["api", "--method", "GET", "{{secret:jira}}"]], false],
    [["gh", ["API", "--method", "GET", "/x"]], false],
  ] as const)("%j → %s", ([cmd, args], ok) => {
    expect(execAllowed(cmd, [...args], gh)).toBe(ok);
  });

  it("a NUL byte, an overlong arg or too many args are refused", () => {
    expect(execAllowed("gh", ["api", "--method", "GET", "/x\0y"], gh)).toBe(false);
    expect(execAllowed("gh", ["api", "--method", "GET", "x".repeat(4097)], gh)).toBe(false);
    expect(execAllowed("gh", ["api", "--method", "GET", ...Array.from({ length: 300 }, () => "x")], gh)).toBe(false);
  });

  it("a pattern that pins a short flag refuses its long aliases and every short option after *", () => {
    const curlish = [{ cmd: "gh", args: ["api", "-X", "GET", "*"] }];
    expect(execAllowed("gh", ["api", "-X", "GET", "/x"], curlish)).toBe(true);
    expect(execAllowed("gh", ["api", "-X", "GET", "/x", "--method", "POST"], curlish)).toBe(false);
    expect(execAllowed("gh", ["api", "-X", "GET", "/x", "--method=POST"], curlish)).toBe(false);
    expect(execAllowed("gh", ["api", "-X", "GET", "/x", "-q", ".x"], curlish)).toBe(false);
  });

  it("a secret reference in any spelling is refused in an arg", () => {
    expect(execAllowed("gh", ["api", "--method", "GET", "{{ Secret:jira}}"], gh)).toBe(false);
    expect(execAllowed("gh", ["api", "--method", "GET", "{{SECRET:jira}}"], gh)).toBe(false);
  });

  it.each([
    ["--input", "/etc/passwd"],
    ["--input=/etc/passwd"],
    ["--inp=/etc/passwd"],
    ["--field", "k=@/etc/passwd"],
    ["--field=k=v"],
    ["-F", "k=@/etc/passwd"],
    ["--raw-field", "k=v"],
    ["-f", "k=v"],
    ["--hostname", "evil.com"],
    ["--header", "X-HTTP-Method-Override: POST"],
    ["https://evil.com/x"],
    ["/x", "--jq", "https://evil.com"],
    ["@/etc/passwd"],
  ])("a read-only gh api GET pattern refuses %j after *", (...tail) => {
    expect(execAllowed("gh", ["api", "--method", "GET", "/x", ...tail], gh)).toBe(false);
    expect(execAllowed("gh", ["api", "--method", "GET", ...tail], gh)).toBe(false);
  });

  it("a read-only gh api GET pattern still allows --paginate and --jq", () => {
    expect(execAllowed("gh", ["api", "--method", "GET", "/x", "--paginate", "--jq", ".[].name"], gh)).toBe(true);
  });

  it("a pattern that pins no flag lets option-like tokens through after *", () => {
    expect(execAllowed("gh", ["--version"], [{ cmd: "gh", args: ["*"] }])).toBe(true);
  });

  it("a malformed pattern matches nothing: * not last, a path as command", () => {
    expect(execAllowed("gh", ["x", "api"], [{ cmd: "gh", args: ["*", "api"] }])).toBe(false);
    expect(execAllowed("/bin/sh", ["-c", "id"], [{ cmd: "/bin/sh", args: ["-c", "id"] }])).toBe(false);
  });
});

describe("secrets (§4.2, D5)", () => {
  it("finds references and fills them", () => {
    expect(secretRefs("Bearer {{secret:jira}} {{secret:fh}}")).toEqual(["jira", "fh"]);
    expect(fillSecrets("Bearer {{secret:jira}}", { jira: "tok123456" })).toEqual({ ok: true, text: "Bearer tok123456", used: ["tok123456"] });
    expect(fillSecrets("no keys here", { jira: "x" })).toEqual({ ok: true, text: "no keys here", used: [] });
  });

  it("an unknown or unstored secret is refused, a malformed reference too", () => {
    expect(fillSecrets("{{secret:nope}}", { jira: "x" })).toEqual({ ok: false, reason: 'The key "nope" is not stored' });
    expect(fillSecrets("{{secret:Jira}}", {})).toMatchObject({ ok: false });
    expect(fillSecrets("{{ secret:jira }}", { jira: "x" })).toMatchObject({ ok: false });
    expect(fillSecrets("{{SECRET:jira}}", { jira: "x" })).toMatchObject({ ok: false });
    expect(fillSecrets("{{secret:jira}", { jira: "x" })).toMatchObject({ ok: false });
  });

  it("inherited names never count as stored", () => {
    expect(fillSecrets("{{secret:constructor}}", {})).toMatchObject({ ok: false });
    expect(fillSecrets("{{secret:tostring}}", {})).toMatchObject({ ok: false });
  });

  it("a value that looks like a reference is inserted as is, never filled again", () => {
    expect(fillSecrets("{{secret:a}}", { a: "{{secret:b}}", b: "leak" })).toEqual({ ok: true, text: "{{secret:b}}", used: ["{{secret:b}}"] });
    expect(fillSecrets("x $& {{secret:a}}", { a: "$&$1" })).toEqual({ ok: true, text: "x $& $&$1", used: ["$&$1"] });
  });

  it("redacts raw, URL-encoded and base64 forms", () => {
    const v = "s3cr3t/+value";
    const b64 = btoa(v);
    const text = `a ${v} b ${encodeURIComponent(v)} c ${b64} d ${encodeURIComponent(v).toLowerCase()} e`;
    expect(redact(text, [v])).toBe(`a ${REDACTED} b ${REDACTED} c ${REDACTED} d ${REDACTED} e`);
  });

  it("redacts base64url, unpadded base64 and non-ASCII values", () => {
    const v = "ü?>tok~~";
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(v)));
    const url = b64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    expect(redact(`${b64} ${url} ${b64.replace(/=+$/, "")} ${v}`, [v])).toBe([REDACTED, REDACTED, REDACTED, REDACTED].join(" "));
  });

  it("a longer value is redacted whole even when a shorter one is inside it", () => {
    expect(redact("x abcdef y", ["abc", "abcdef"])).toBe(`x ${REDACTED} y`);
  });

  it("redacts JSON-escaped and form-encoded forms", () => {
    const v = 'a"b\\c d&e';
    const json = JSON.stringify(v).slice(1, -1);
    const form = new URLSearchParams({ x: v }).toString().slice(2);
    expect(json).not.toBe(v);
    expect(form).not.toBe(encodeURIComponent(v));
    expect(redact(`1 ${json} 2 ${form} 3 ${form.toLowerCase()} 4 ${encodeURIComponent(v)}`, [v])).toBe(`1 ${REDACTED} 2 ${REDACTED} 3 ${REDACTED} 4 ${REDACTED}`);
  });

  it("never redacts empty values", () => {
    expect(redact("abc", [""])).toBe("abc");
  });
});

describe("permissionsAdded and permissionLines (§7, Decision 6)", () => {
  const p = (o: Partial<PluginPermissions> = {}): PluginPermissions => ({
    hosts: ["*.atlassian.net"],
    exec: [{ cmd: "gh", args: ["api", "--method", "GET", "*"] }],
    secrets: [{ id: "jira", label: "Jira" }],
    tasks: false,
    ...o,
  });
  it("nothing added: same, fewer, or a host already covered", () => {
    expect(permissionsAdded(p(), p())).toEqual([]);
    expect(permissionsAdded(p(), p({ hosts: [], exec: [], secrets: [] }))).toEqual([]);
    expect(permissionsAdded(p(), p({ hosts: ["acme.atlassian.net"] }))).toEqual([]);
    expect(permissionsAdded(p(), p({ hosts: ["*.eu.atlassian.net"] }))).toEqual([]);
    expect(permissionsAdded(p({ tasks: true }), p())).toEqual([]);
    expect(permissionsAdded(p(), p({ secrets: [{ id: "jira", label: "Jira, renamed" }] }))).toEqual([]);
  });
  it("lists each addition", () => {
    expect(permissionsAdded(p(), p({ hosts: ["*.atlassian.net", "evil.com"] }))).toEqual([{ kind: "host", value: "evil.com" }]);
    expect(permissionsAdded(p(), p({ exec: [{ cmd: "gh", args: ["*"] }] }))).toEqual([{ kind: "exec", value: "gh *" }]);
    expect(permissionsAdded(p(), p({ secrets: [{ id: "x", label: "X" }] }))).toEqual([{ kind: "secret", value: "x" }]);
    expect(permissionsAdded(p(), p({ tasks: true }))).toEqual([{ kind: "tasks", value: "true" }]);
  });
  it("a wider or different host is an addition", () => {
    const added = (hosts: string[]) => permissionsAdded(p(), p({ hosts }));
    expect(added(["atlassian.net"])).toEqual([{ kind: "host", value: "atlassian.net" }]);
    expect(added(["*.net"])).toEqual([{ kind: "host", value: "*.net" }]);
    expect(added(["acme.atlassian.net:8443"])).toEqual([{ kind: "host", value: "acme.atlassian.net:8443" }]);
    expect(added(["*.eu.atlassian.net:8443"])).toEqual([{ kind: "host", value: "*.eu.atlassian.net:8443" }]);
    expect(added(["evilatlassian.net"])).toEqual([{ kind: "host", value: "evilatlassian.net" }]);
    expect(permissionsAdded(p({ hosts: ["localhost"] }), p({ hosts: ["localhost"] }))).toEqual([]);
  });
  it("an exec pattern that differs at all is an addition, even a narrower one", () => {
    expect(permissionsAdded(p(), p({ exec: [{ cmd: "gh", args: ["api", "--method", "GET", "/x"] }] }))).toEqual([{ kind: "exec", value: "gh api --method GET /x" }]);
    // Token boundaries count: ["a b"] is not ["a", "b"].
    expect(permissionsAdded(p({ exec: [{ cmd: "gh", args: ["a", "b"] }] }), p({ exec: [{ cmd: "gh", args: ["a b"] }] }))).toHaveLength(1);
  });
  it("review lines as data, with read-only only when GET is pinned", () => {
    expect(permissionLines(p({ tasks: true }))).toEqual([
      { kind: "hosts", hosts: ["*.atlassian.net"] },
      { kind: "exec", command: "gh api", readOnly: true, wide: false },
      { kind: "secrets", labels: ["Jira"] },
      { kind: "tasks" },
    ]);
    expect(permissionLines(p({ exec: [{ cmd: "gh", args: ["*"] }] }))[1]).toEqual({ kind: "exec", command: "gh", readOnly: false, wide: true });
    expect(permissionLines(p({ exec: [{ cmd: "gh", args: ["api", "-X", "GET", "*"] }] }))[1]).toMatchObject({ readOnly: true });
    expect(permissionLines(p({ exec: [{ cmd: "gh", args: ["api", "--method=GET", "*"] }] }))[1]).toMatchObject({ command: "gh api", readOnly: true });
    expect(permissionLines(p({ exec: [{ cmd: "gh", args: ["api", "*"] }] }))[1]).toMatchObject({ command: "gh api *", readOnly: false, wide: false });
    expect(permissionLines(p({ exec: [{ cmd: "gh", args: ["api", "--method", "POST", "*"] }] }))[1]).toMatchObject({ readOnly: false });
    expect(permissionLines({ hosts: [], exec: [], secrets: [], tasks: false })).toEqual([]);
  });
  it("read-only only for gh api with GET pinned and nothing else before *: never curl", () => {
    const ro = (cmd: string, args: string[]) => permissionLines(p({ exec: [{ cmd, args }] }))[1];
    expect(ro("gh", ["api", "-XGET", "*"])).toMatchObject({ readOnly: true });
    expect(ro("curl", ["-X", "GET", "*"])).toEqual({ kind: "exec", command: "curl -X GET *", readOnly: false, wide: false });
    expect(ro("curl", ["--request", "GET", "*"])).toMatchObject({ readOnly: false });
    expect(ro("gh", ["api", "--method", "GET", "--input", "f", "*"])).toMatchObject({ readOnly: false });
    expect(ro("gh", ["api", "--method", "GET", "/x"])).toMatchObject({ readOnly: false });
    expect(ro("gh", ["repo", "--method", "GET", "*"])).toMatchObject({ readOnly: false });
    expect(ro("ghx", ["api", "--method", "GET", "*"])).toMatchObject({ readOnly: false });
  });
  it("curl -X GET * keeps the plain exec rule (no read-only claim, so no extra refusals)", () => {
    const curl = [{ cmd: "curl", args: ["-X", "GET", "*"] }];
    expect(execAllowed("curl", ["-X", "GET", "https://example.com/x"], curl)).toBe(true);
    expect(execAllowed("curl", ["-X", "GET", "https://example.com/x", "-XPOST"], curl)).toBe(false);
  });
  it("an exact host with and without :443 is the same host", () => {
    expect(permissionsAdded(p({ hosts: ["x.com"] }), p({ hosts: ["x.com:443"] }))).toEqual([]);
    expect(permissionsAdded(p({ hosts: ["X.com:443"] }), p({ hosts: ["x.com"] }))).toEqual([]);
  });
});
