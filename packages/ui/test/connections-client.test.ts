import { describe, expect, it } from "vitest";
import type { ConnectionsView } from "../src/client";
import { FakeClient } from "./fake-client";

describe("client.connections (tools spec §9)", () => {
  it("the fake keeps state without values: set, then the view says set", async () => {
    const c = new FakeClient();
    c.connectionsDeclared = [{ id: "jira", label: "Jira API token" }];
    expect(await c.connections.set("jira", "tok-123456789")).toEqual({ ok: true });
    expect(await c.connections.get()).toEqual({ connections: [{ id: "jira", label: "Jira API token", set: true }] });
    expect(JSON.stringify(await c.connections.get())).not.toContain("tok-");
    expect((await c.connections.get())!.connections[0]).not.toHaveProperty("help");
  });

  it("the fake answers no connections when none are declared", async () => {
    expect(await new FakeClient().connections.get()).toEqual({ connections: [] });
  });

  it("the fake refuses an undeclared id and keeps help in the view", async () => {
    const c = new FakeClient();
    c.connectionsDeclared = [{ id: "jira", label: "Jira API token", help: "From your Atlassian profile" }];
    const refused = await c.connections.set("github", "tok-123456789");
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).not.toContain("tok-");
    expect(await c.connections.get()).toEqual({
      connections: [{ id: "jira", label: "Jira API token", help: "From your Atlassian profile", set: false }],
    });
  });

  it("the fake refuses a value the store would, with its texts, and never echoes it", async () => {
    const c = new FakeClient();
    c.connectionsDeclared = [{ id: "jira", label: "Jira API token" }];
    for (const [value, message] of [
      ["tok-123", "A key is at least 8 characters"],
      ["   tok-123   ", "A key is at least 8 characters"],
      ["tok-" + "x".repeat(8189), "A key is at most 8192 characters"],
      ["tok-1234\n5678", "A key is one line"],
    ] as const) {
      const answer = await c.connections.set("jira", value);
      expect(answer).toEqual({ ok: false, message });
      expect(JSON.stringify(answer)).not.toContain("tok-");
    }
    expect(await c.connections.get()).toEqual({ connections: [{ id: "jira", label: "Jira API token", set: false }] });
    expect(await c.connections.set("jira", "  tok-12345  ")).toEqual({ ok: true });
  });

  it("the fake answers a malformed id as main's IPC does", async () => {
    const c = new FakeClient();
    c.connectionsDeclared = [{ id: "jira", label: "Jira API token" }];
    for (const id of ["Jira", "", "x".repeat(41), "../jira"]) {
      expect(await c.connections.set(id, "tok-123456789")).toEqual({ ok: false, message: "Invalid request" });
      expect(await c.connections.delete(id)).toEqual({ ok: false, message: "Invalid request" });
    }
    expect(await c.connections.get()).toEqual({ connections: [{ id: "jira", label: "Jira API token", set: false }] });
  });

  it("delete clears a set key, and onChange hears both changes until unsubscribed", async () => {
    const c = new FakeClient();
    c.connectionsDeclared = [{ id: "jira", label: "Jira API token" }];
    const heard: ConnectionsView[] = [];
    const off = c.connections.onChange((v) => heard.push(v));
    await c.connections.set("jira", "tok-123456789");
    expect(await c.connections.delete("jira")).toEqual({ ok: true });
    off();
    await c.connections.set("jira", "tok-987654321");
    expect(heard.map((v) => v.connections[0]?.set)).toEqual([true, false]);
    expect(c.connectionsCalls).toEqual([
      ["set", "jira"],
      ["delete", "jira"],
      ["set", "jira"],
    ]);
  });
});
