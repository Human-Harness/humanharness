// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type BlockProps, type HarnessAppProps, HarnessApp } from "../src";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const L = (en: string) => ({ es: en, en });
const TITLE = "What do you want to understand?";
const locales = { en: { title: TITLE, faq: { own: "How do I build my own harness?" }, hint: "Answers can be wrong." } };

function flowClient() {
  const client = new FakeClient(ready);
  client.state.actions = {
    manifest: { label: L("The manifest"), description: L("What a harness declares."), cost: "medium" },
    engines: { label: L("Engines"), cost: "medium" },
    turn: { label: L("A turn"), cost: "medium" },
  };
  client.state.path = ["manifest", "engines", "turn"];
  client.state.references = [{ id: "source", label: L("Source"), path: "~/code/humanharness" }];
  return client;
}

async function startWork(client: FakeClient, props: Partial<HarnessAppProps> = {}) {
  render(<HarnessApp client={client} locales={locales} startView={{ title: "title", faq: ["faq.own"], hint: "hint" }} {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Start Demo" }));
}
/** The start view, once the conversation has loaded (its topics are enabled). */
async function startRegion() {
  const region = await screen.findByRole("region", { name: TITLE });
  await waitFor(() => expect(within(region).getAllByRole("button").every((b) => !(b as HTMLButtonElement).disabled)).toBe(true));
  return region;
}
const answer = (client: FakeClient, text: string, blocks: { name: string; data: unknown }[] = []) =>
  act(() => {
    client.emit({ type: "text", delta: text });
    for (const b of blocks) client.emit({ type: "block", ...b });
    client.emit({ type: "done", ok: true });
  });
const tasks = (client: FakeClient, view: Partial<FakeClient["tasks"]>) => act(() => client.emitTasks({ ...client.tasks, ...view }));
const choices = (...options: object[]) => ({ name: "choices", data: { options } });
const GROUP = "How do we continue?";
const t1 = (status: "running" | "waiting" | "closing") => ({ id: "t1", action: "manifest", status });
const in2h = () => new Date(Date.now() + 2 * 3600_000).toISOString();
const NOTES = [
  { slug: "manifest", title: "The manifest", action: "manifest", date: "2026-10-12T11:20:00.000Z", summary: ["It declares everything", "It is validated"], decisions: [], path: ".harness/notes/manifest.md" },
  { slug: "q-chats", title: "Where chats live", date: "2026-10-11T10:00:00.000Z", summary: ["In .harness/chats"], decisions: [], path: ".harness/notes/q-chats.md" },
];

describe("flow mode", () => {
  it("opens on the start view: topics, the read-only folder, questions and the composer hint", async () => {
    const client = flowClient();
    client.tasks = { current: null, actions: { manifest: "done" }, notes: [] };
    await startWork(client);
    const start = await startRegion();
    expect(within(start).getByRole("button", { name: /The manifest/ }).textContent).toContain("Done");
    expect(within(start).getByRole("button", { name: /Engines/ }).textContent).toContain("Next on the path");
    expect(within(screen.getByRole("list", { name: "Guided path" })).getByRole("button", { name: /Engines/ }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("~/code/humanharness")).toBeTruthy();
    expect(screen.getByText("Answers can be wrong.")).toBeTruthy();
    expect(screen.getByPlaceholderText("Or ask something…")).toBeTruthy();
  });

  it("starts a topic: sends its label with the action and shows only that task", async () => {
    const client = flowClient();
    client.chat = [{ id: "old", role: "user", text: "an older topic", blocks: [], activities: [], at: "t", task: "t0" }];
    await startWork(client);
    fireEvent.click(within(await startRegion()).getByRole("button", { name: /Engines/ }));
    await waitFor(() => expect(client.sent).toEqual(["Engines"]));
    expect(client.sentOptions).toEqual([{ action: "engines" }]);
    expect(screen.queryByRole("region", { name: TITLE })).toBeNull();
    expect(screen.queryByText("an older topic")).toBeNull();
    answer(client, "Engines are detected on every start.");
    expect(screen.getByText("Engines are detected on every start.", { selector: ".hh-message p" })).toBeTruthy();
  });

  it("picks options: a follow-up stays on the task, next starts the next topic", async () => {
    const client = flowClient();
    await startWork(client);
    fireEvent.click(within(await startRegion()).getByRole("button", { name: /The manifest/ }));
    tasks(client, { current: t1("running") });
    answer(client, "It declares everything.", [choices({ label: "Go deeper", followUp: "Tell me more" }, { label: "Next topic →", next: true })]);
    tasks(client, { current: t1("waiting") });
    fireEvent.click(within(screen.getByRole("group", { name: GROUP })).getByRole("button", { name: "Go deeper" }));
    await waitFor(() => expect(client.chosen).toEqual([{ label: "Go deeper", followUp: "Tell me more" }]));
    expect(client.chosenTasks).toEqual(["t1"]);
    expect(screen.getByText("Go deeper", { selector: ".hh-message.user p" })).toBeTruthy();
    answer(client, "More detail.", [choices({ label: "Next topic →", next: true })]);
    const groups = screen.getAllByRole("group", { name: GROUP });
    expect((within(groups[0]).getAllByRole("button")[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(groups.at(-1)!).getByRole("button", { name: "Next topic →" }));
    await waitFor(() => expect(client.chosen).toHaveLength(2));
    expect(screen.queryByText("It declares everything.")).toBeNull();
    expect(screen.getByText("Engines", { selector: ".hh-message.user p" })).toBeTruthy();
  });

  it("closes the last topic without starting another, then goes back to the topics", async () => {
    const client = flowClient();
    client.state.path = ["manifest"];
    await startWork(client);
    fireEvent.click(within(await startRegion()).getByRole("button", { name: /The manifest/ }));
    tasks(client, { current: t1("running") });
    answer(client, "It declares everything.", [choices({ label: "Done →", next: true })]);
    tasks(client, { current: t1("waiting") });
    fireEvent.click(screen.getByRole("button", { name: "Done →" }));
    await waitFor(() => expect(client.chosen).toEqual([{ label: "Done →", next: true }]));
    expect(screen.queryAllByText("Done →", { selector: ".hh-message.user p" })).toHaveLength(0);
    tasks(client, { current: { id: "t1", action: "manifest", status: "closing" } });
    expect(screen.getByText("Saving what's clear…")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Ask about this topic…"), { target: { value: "too soon" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(client.sent).toEqual(["The manifest"]);
    tasks(client, { current: null, actions: { manifest: "done" } });
    fireEvent.click(screen.getByRole("button", { name: "See the topics" }));
    expect(within(await startRegion()).getByRole("button", { name: /The manifest/ }).textContent).toContain("Done");
  });

  it("lists notes in the side panel and opens them: resume and open the file", async () => {
    const client = flowClient();
    client.tasks = {
      current: null,
      actions: { manifest: "done" },
      notes: NOTES,
    };
    await startWork(client);
    await startRegion();
    fireEvent.click(within(screen.getByRole("list", { name: "What's clear so far" })).getByRole("button", { name: "Where chats live" }));
    const panel = screen.getByRole("dialog", { name: "What's clear so far" });
    expect(within(panel).getByText("In .harness/chats")).toBeTruthy();
    expect(within(panel).getByText(/2 key points/)).toBeTruthy();
    client.openResult = false;
    fireEvent.click(within(panel).getByRole("button", { name: "Open the file" }));
    await waitFor(() => expect(client.opened).toEqual([".harness/notes/q-chats.md"]));
    await within(panel).findByRole("alert");
    fireEvent.click(within(panel).getByRole("button", { name: "Pick this topic up again" }));
    await waitFor(() => expect(client.sent).toEqual(['Let\'s pick up "Where chats live" again.']));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks a free question from the start view and follows up while the task waits", async () => {
    const client = flowClient();
    await startWork(client);
    fireEvent.click(within(await startRegion()).getByRole("button", { name: "How do I build my own harness?" }));
    await waitFor(() => expect(client.sent).toEqual(["How do I build my own harness?"]));
    expect(client.sentOptions).toEqual([{}]);
    answer(client, "Copy the demo.");
    tasks(client, { current: { id: "t1", status: "waiting" } });
    fireEvent.change(screen.getByPlaceholderText("Ask about this topic…"), { target: { value: "And the locales?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(client.sent).toHaveLength(2));
    expect(screen.getByText("Copy the demo.")).toBeTruthy();
  });

  it("asks before a heavy next topic; Not now leaves the options usable, and Continue sends the pick", async () => {
    const client = flowClient();
    client.state.actions.engines.cost = "heavy";
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.75, resetsAt: in2h() }], estimates: { engines: 0.08 } };
    await startWork(client);
    fireEvent.click(within(await startRegion()).getByRole("button", { name: /The manifest/ }));
    tasks(client, { current: t1("running") });
    answer(client, "It declares everything.", [choices({ label: "Next topic →", next: true })]);
    tasks(client, { current: t1("waiting") });
    const next = () => screen.getByRole("button", { name: "Next topic →" }) as HTMLButtonElement;
    fireEvent.click(next());
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(next().disabled).toBe(false);
    expect(next().getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(next());
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(client.chosen).toEqual([{ label: "Next topic →", next: true }]));
    expect(client.chosenTasks).toEqual(["t1"]);
  });

  it("at the end of the path, a pick the app refuses shows the error and can be picked again", async () => {
    const client = flowClient();
    client.state.path = ["manifest"];
    await startWork(client);
    fireEvent.click(within(await startRegion()).getByRole("button", { name: /The manifest/ }));
    tasks(client, { current: t1("running") });
    answer(client, "It declares everything.", [choices({ label: "Done →", next: true })]);
    tasks(client, { current: t1("waiting") });
    client.chooseError = new Error("A turn is already running");
    fireEvent.click(screen.getByRole("button", { name: "Done →" }));
    await screen.findByRole("alert");
    const done = screen.getByRole("button", { name: "Done →" }) as HTMLButtonElement;
    expect(done.disabled).toBe(false);
    client.chooseError = null;
    fireEvent.click(done);
    await waitFor(() => expect(client.chosen).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("Try again after a failed follow-up option picks that option again", async () => {
    const client = flowClient();
    await startWork(client);
    fireEvent.click(within(await startRegion()).getByRole("button", { name: /The manifest/ }));
    tasks(client, { current: t1("running") });
    answer(client, "It declares everything.", [choices({ label: "Go deeper", followUp: "Tell me more" })]);
    tasks(client, { current: t1("waiting") });
    fireEvent.click(screen.getByRole("button", { name: "Go deeper" }));
    await waitFor(() => expect(client.chosen).toHaveLength(1));
    act(() => client.emit({ type: "done", ok: false, error: { code: "agent-crashed" } }));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(client.chosen).toEqual([{ label: "Go deeper", followUp: "Tell me more" }, { label: "Go deeper", followUp: "Tell me more" }]));
    expect(client.sent).toEqual(["The manifest"]);
    expect(client.chosenTasks).toEqual(["t1", "t1"]);
  });

  it("opens another note from the side panel while the panel is open, and gives focus back on Escape", async () => {
    const client = flowClient();
    client.tasks = { current: null, actions: { manifest: "done" }, notes: NOTES };
    await startWork(client);
    await startRegion();
    const side = screen.getByRole("list", { name: "What's clear so far" });
    const chats = within(side).getByRole("button", { name: "Where chats live" });
    chats.focus();
    fireEvent.click(chats);
    const panel = screen.getByRole("dialog", { name: "What's clear so far" });
    expect(within(panel).getByText("In .harness/chats")).toBeTruthy();
    fireEvent.click(within(side).getByRole("button", { name: "The manifest" }));
    expect(within(panel).getByText("It is validated")).toBeTruthy();
    expect(within(panel).queryByText("In .harness/chats")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(chats);
  });

  it("opening the history closes the notes panel, so one Escape closes the one on top", async () => {
    const client = flowClient();
    client.tasks = { current: null, actions: { manifest: "done" }, notes: NOTES };
    await startWork(client);
    await startRegion();
    fireEvent.click(within(screen.getByRole("list", { name: "What's clear so far" })).getByRole("button", { name: "Where chats live" }));
    const history = screen.getByRole("button", { name: "History" });
    history.focus();
    fireEvent.click(history);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "What's clear so far" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(history);
  });

  it("gives harness blocks a way to open files", async () => {
    const client = flowClient();
    const Files = ({ data, open }: BlockProps) => <button onClick={() => void open(data.path)}>open it</button>;
    await startWork(client, { blocks: { files: Files } });
    fireEvent.click(within(await startRegion()).getByRole("button", { name: /A turn/ }));
    answer(client, "Here.", [{ name: "files", data: { path: "packages/ui/src/ChatView.tsx" } }]);
    fireEvent.click(screen.getByRole("button", { name: "open it" }));
    await waitFor(() => expect(client.opened).toEqual(["packages/ui/src/ChatView.tsx"]));
  });

  it("comes back to a task that is still open", async () => {
    const client = flowClient();
    client.chat = [
      { id: "1", role: "user", text: "Engines", blocks: [], activities: [], at: "t", task: "t1", action: "engines" },
      { id: "2", role: "assistant", text: "Engines are detected.", blocks: [], activities: [], at: "t", task: "t1" },
    ];
    client.tasks = { current: { id: "t1", action: "engines", status: "waiting" }, actions: {}, notes: [] };
    await startWork(client);
    await screen.findByText("Engines are detected.");
    expect(screen.queryByRole("region", { name: TITLE })).toBeNull();
  });
});

describe("choices of an earlier task", () => {
  const entries = (task: string) => [
    { id: "1", role: "user" as const, text: "hi", blocks: [], activities: [], at: "t", task },
    { id: "2", role: "assistant" as const, text: "Pick one.", blocks: [choices({ label: "Tell me more" })], activities: [], at: "t", task },
  ];

  it("are disabled when the block's task is not the waiting one", async () => {
    const client = new FakeClient(ready);
    client.chat = entries("t1");
    client.tasks = { current: { id: "t2", status: "waiting" }, actions: {}, notes: [] };
    render(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start Demo" }));
    await screen.findByText("Pick one.");
    await waitFor(() => expect(client.tasks.current?.id).toBe("t2"));
    expect((screen.getByRole("button", { name: "Tell me more" }) as HTMLButtonElement).disabled).toBe(true);
    tasks(client, { current: null });
    expect((screen.getByRole("button", { name: "Tell me more" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("send the task the block was shown for", async () => {
    const client = new FakeClient(ready);
    client.chat = entries("t1");
    client.tasks = { current: { id: "t1", status: "waiting" }, actions: {}, notes: [] };
    render(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start Demo" }));
    await screen.findByText("Pick one.");
    const more = screen.getByRole("button", { name: "Tell me more" }) as HTMLButtonElement;
    await waitFor(() => expect(more.disabled).toBe(false));
    fireEvent.click(more);
    await waitFor(() => expect(client.chosenTasks).toEqual(["t1"]));
  });
});
