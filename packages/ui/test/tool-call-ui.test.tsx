// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import type { ChatEntry, ToolCallView } from "../src/client";
import { ToolCallLine } from "../src/tools/ToolCallLine";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

async function clickStart() {
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
}

const call = (extra: Partial<ToolCallView> = {}): ToolCallView => ({
  tool: "pr-ci",
  caller: "agent",
  ok: true,
  ms: 312,
  summary: "12 items",
  args: '{"repo":"acme/app"}',
  result: '[{"id":1}]',
  accesses: [{ kind: "fetch", target: "GET https://api.github.com/repos/acme/app/pulls", allowed: true }],
  at: "2026-10-29T10:00:00.000Z",
  ...extra,
});

const user: ChatEntry = { id: "1", role: "user", text: "hi", blocks: [], activities: [], at: "t", task: "t1" };
const reply = (extra: Partial<ChatEntry> = {}): ChatEntry => ({ id: "2", role: "assistant", text: "Done.", blocks: [], activities: [], at: "t", task: "t1", ...extra });

describe("tool calls in a chat (tools spec §8.2)", () => {
  it("D0: an entry without tools renders as before", async () => {
    const client = new FakeClient(ready);
    client.chat = [user, reply()];
    render(<HarnessApp client={client} />);
    await clickStart();
    const answer = await screen.findByText("Done.");
    const entry = answer.closest("[data-entry]")!;
    // Only the message itself: no tool line, no tools list, no Tools-off line.
    expect([...entry.children].map((c) => c.tagName)).toEqual(["ARTICLE"]);
    expect(document.querySelector(".hh-tool-call")).toBeNull();
    expect(document.querySelector(".hh-tools-off")).toBeNull();
    expect(screen.queryByText(/0 tokens/)).toBeNull();
  });

  it("a call shows as one folded line: id · summary · 0.3 s · 0 tokens", async () => {
    await renderIn("en", <ToolCallLine call={call()} />);
    const line = screen.getByRole("button", { name: "pr-ci · 12 items · 0.3 s · 0 tokens" });
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("definition")).toBeNull();
    expect((document.getElementById(line.getAttribute("aria-controls")!) as HTMLElement).hidden).toBe(true);
  });

  it("a saved entry's calls show above its reply, in order", async () => {
    const client = new FakeClient(ready);
    client.chat = [user, reply({ tools: [call(), call({ tool: "notes", summary: "1 item", ms: 1500 })] })];
    render(<HarnessApp client={client} />);
    await clickStart();
    await screen.findByText("Done.");
    const lines = [...document.querySelectorAll(".hh-tool-call > button")].map((b) => b.textContent);
    expect(lines).toEqual(["pr-ci · 12 items · 0.3 s · 0 tokens", "notes · 1 item · 1.5 s · 0 tokens"]);
  });

  it("a tool-call event during a turn shows on the live answer and stays after it ends", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await clickStart();
    const box = await screen.findByRole("textbox");
    fireEvent.change(box, { target: { value: "check ci" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(client.sent).toEqual(["check ci"]));
    client.emit({ type: "tool-call", call: call() });
    await screen.findByRole("button", { name: "pr-ci · 12 items · 0.3 s · 0 tokens" });
    client.emit({ type: "text", delta: "CI is green." });
    client.emit({ type: "done", ok: true });
    await screen.findByText("CI is green.");
    expect(screen.getAllByRole("button", { name: "pr-ci · 12 items · 0.3 s · 0 tokens" })).toHaveLength(1);
  });

  it("unfolding shows arguments, result and accesses", async () => {
    await renderIn("en", <ToolCallLine call={call()} />);
    const line = screen.getByRole("button", { name: /^pr-ci/ });
    fireEvent.click(line);
    expect(line.getAttribute("aria-expanded")).toBe("true");
    const details = document.getElementById(line.getAttribute("aria-controls")!)!;
    expect(details.tagName).toBe("DL");
    expect([...details.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Arguments", "Result", "Accesses"]);
    const pres = [...details.querySelectorAll("pre")];
    expect(pres.map((p) => [p.textContent, p.getAttribute("dir")])).toEqual([
      ['{"repo":"acme/app"}', "auto"],
      ['[{"id":1}]', "auto"],
    ]);
    expect(details.querySelector("li")?.textContent).toBe("fetch GET https://api.github.com/repos/acme/app/pulls");
    fireEvent.click(line);
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(details.hidden).toBe(true);
  });

  it("folded, aria-controls still names the details, which are hidden", async () => {
    await renderIn("en", <ToolCallLine call={call()} />);
    const line = screen.getByRole("button", { name: /^pr-ci/ });
    const details = document.getElementById(line.getAttribute("aria-controls")!);
    expect(details?.tagName).toBe("DL");
    expect(details?.hidden).toBe(true);
  });

  it("an error is always unfolded and says '<id> failed · <message>'", async () => {
    const failed = call({ ok: false, summary: "failed", error: "The result doesn't match returns: count: expected number", result: undefined, accesses: [] });
    await renderIn("en", <ToolCallLine call={failed} />);
    const line = screen.getByRole("button", { name: "pr-ci failed · The result doesn't match returns: count: expected number" });
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect(line.closest(".hh-tool-call")?.classList.contains("hh-error")).toBe(true);
    const details = document.getElementById(line.getAttribute("aria-controls")!)!;
    // No result for a failed call; the arguments still show.
    expect([...details.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Arguments"]);
  });

  it("a refused access reads 'access denied' with its target", async () => {
    const refused = call({
      ok: false,
      summary: "failed",
      error: "evil.example is not declared in uses.hosts",
      result: undefined,
      accesses: [
        { kind: "fetch", target: "GET https://api.github.com/x", allowed: true },
        { kind: "fetch", target: "GET https://evil.example/steal", allowed: false },
      ],
    });
    await renderIn("en", <ToolCallLine call={refused} />);
    const items = [...document.querySelectorAll(".hh-tool-call li")].map((li) => li.textContent);
    expect(items).toEqual(["fetch GET https://api.github.com/x", "fetch GET https://evil.example/steal · access denied"]);
  });

  it("an ok call with a refused access shows 'access denied' once unfolded", async () => {
    await renderIn("en", <ToolCallLine call={call({ accesses: [{ kind: "exec", target: "rm -rf x", allowed: false }] })} />);
    expect((document.querySelector(".hh-tool-details") as HTMLElement).hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^pr-ci/ }));
    expect(screen.getByText(/access denied/).closest("li")?.textContent).toBe("exec rm -rf x · access denied");
  });

  it("a saved entry with malformed tools still renders: bad calls are dropped, a well-formed one beside them shows", async () => {
    const client = new FakeClient(ready);
    const bad = [
      { ...call(), tool: 7 },
      { ...call(), args: { repo: "x" } },
      { ...call(), accesses: "x" },
      "not a call",
      null,
    ];
    const good = call({ accesses: [{ kind: "fetch", target: "GET https://a.example/", allowed: true }, { kind: "shell", target: "evil", allowed: false } as never] });
    client.chat = [
      user,
      reply({ id: "2", text: "First.", tools: "nope" as never }),
      { id: "3", role: "user", text: "again", blocks: [], activities: [], at: "t", task: "t1" },
      reply({ id: "4", text: "Second.", tools: [...bad, good] as never }),
    ];
    render(<HarnessApp client={client} />);
    await clickStart();
    await screen.findByText("Second.");
    expect(screen.getByText("First.")).toBeTruthy();
    const lines = [...document.querySelectorAll(".hh-tool-call > button")];
    expect(lines.map((b) => b.textContent)).toEqual(["pr-ci · 12 items · 0.3 s · 0 tokens"]);
    // The access with an unknown kind is dropped; the well-formed one stays.
    expect([...document.querySelectorAll(".hh-tool-call li")].map((li) => li.textContent)).toEqual(["fetch GET https://a.example/"]);
  });

  it("a tool line outside a turn never takes the reply's place: its choices stay answerable", async () => {
    const client = new FakeClient(ready);
    client.chat = [user, reply({ text: "Pick one.", blocks: [{ name: "choices", data: { options: [{ label: "Tell me more" }] } }] })];
    client.tasks = { current: { id: "t1", status: "waiting" }, actions: {}, notes: [] };
    render(<HarnessApp client={client} />);
    await clickStart();
    await screen.findByText("Pick one.");
    client.emit({ type: "tool-call", call: call() });
    await screen.findByRole("button", { name: "pr-ci · 12 items · 0.3 s · 0 tokens" });
    const more = screen.getByRole("button", { name: "Tell me more" }) as HTMLButtonElement;
    await waitFor(() => expect(more.disabled).toBe(false));
    fireEvent.click(more);
    await waitFor(() => expect(client.chosenTasks).toEqual(["t1"]));
  });

  it("a failed turn keeps its error and Try again after a tool line outside a turn", async () => {
    const client = new FakeClient(ready);
    client.chat = [
      { id: "1", role: "user", text: "earlier question", blocks: [], activities: [], at: "t" },
      { id: "2", role: "assistant", text: "", blocks: [], activities: [], at: "t", error: { code: "agent-crashed" } },
    ];
    render(<HarnessApp client={client} />);
    await clickStart();
    await screen.findByRole("button", { name: "Try again" });
    client.emit({ type: "tool-call", call: call() });
    await screen.findByRole("button", { name: /^pr-ci/ });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(client.sent).toEqual(["earlier question"]));
  });

  it("Tools off: the chat's top line says so when state.tools.off is the crash reason", async () => {
    const client = new FakeClient(ready);
    client.state.tools = { ids: ["pr-ci"], off: "Tools are off after repeated crashes" };
    client.chat = [user, reply()];
    render(<HarnessApp client={client} />);
    await clickStart();
    const line = await screen.findByText("Tools are off after repeated crashes. Restart the app to turn them on.");
    expect(line.getAttribute("role")).toBe("status");
  });

  it("Tools off for another reason (not built) shows no top line", async () => {
    const client = new FakeClient(ready);
    client.state.tools = { ids: ["pr-ci"], off: "Tools are not built: run humanharness build" };
    client.chat = [user, reply()];
    render(<HarnessApp client={client} />);
    await clickStart();
    await screen.findByText("Done.");
    expect(screen.queryByText(/Restart the app to turn them on/)).toBeNull();
  });

  it("the top line appears when main says tools went off while the app runs", async () => {
    const client = new FakeClient(ready);
    client.state.tools = { ids: ["pr-ci"] };
    client.chat = [user, reply()];
    render(<HarnessApp client={client} />);
    await clickStart();
    await screen.findByText("Done.");
    expect(screen.queryByText(/Restart the app/)).toBeNull();
    client.toolsChanged({ ids: ["pr-ci"], off: "Tools are off after repeated crashes" });
    await screen.findByText("Tools are off after repeated crashes. Restart the app to turn them on.");
  });
});
