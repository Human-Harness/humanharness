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
