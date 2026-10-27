// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp, type HarnessAppProps, type MaterialView } from "../src";
import { MaterialPanel } from "../src/MaterialPanel";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const info = { accepts: ["pdf", "text"], items: false, grounding: { default: "mixed" as const, personCanChange: true }, maxPages: 300 };
const src = (over: Partial<MaterialView["sources"][number]>): MaterialView["sources"][number] => ({
  id: "ch2",
  name: "ch2.pdf",
  status: "ready",
  pages: 12,
  estimate: 9000,
  issues: [],
  fixes: [],
  fragments: 18,
  failed: false,
  asks: [],
  ...over,
});
const view = (sources: MaterialView["sources"]): MaterialView => ({
  scope: "fractions",
  sources,
  grounding: { mode: "mixed", canChange: true },
  provider: "Anthropic",
  window: { kind: "five_hour", utilization: 0.42 },
});

async function panel(v: MaterialView) {
  const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
  client.materialViews.fractions = v;
  await renderIn("en", <MaterialPanel client={client} scope="fractions" info={info} disabled={false} />);
  return client;
}

describe("MaterialPanel (material spec §11)", () => {
  it("remove asks first; Cancel on a waiting card removes it", async () => {
    const client = await panel(view([src({}), src({ id: "w", name: "w.pdf", status: "pending", notice: "warn", fragments: 0 })]));
    expect(screen.queryByRole("button", { name: "Remove w.pdf" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Remove ch2.pdf" }));
    expect(screen.getByText("Remove ch2.pdf? Its file goes to the Trash.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    // The confirmation closes once the removal went through.
    await waitFor(() => expect(screen.queryByText("Remove ch2.pdf? Its file goes to the Trash.")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(client.materialCalls).toEqual(["remove:ch2", "remove:w"]));
  });

  it("the confirmation's Cancel keeps the source", async () => {
    const client = await panel(view([src({})]));
    fireEvent.click(await screen.findByRole("button", { name: "Remove ch2.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Remove ch2.pdf? Its file goes to the Trash.")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove ch2.pdf" })).toBeTruthy();
    expect(client.materialCalls).toEqual([]);
  });

  it("adds a file and a link", async () => {
    const client = await panel(view([]));
    fireEvent.click(await screen.findByRole("button", { name: "Add a file" }));
    // Adding waits for the add in flight.
    const link = screen.getByRole("button", { name: "Add a link" }) as HTMLButtonElement;
    await waitFor(() => expect(link.disabled).toBe(false));
    fireEvent.click(link);
    fireEvent.change(screen.getByRole("textbox", { name: "Link" }), { target: { value: "https://example.org/halves" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(client.materialCalls).toEqual(["add:fractions", "link:fractions:https://example.org/halves"]));
  });

  it("a waiting source: the estimate, the window, the privacy line, a page range", async () => {
    const client = await panel(view([src({ status: "pending", notice: "warn", pages: 180, estimate: 154000, fragments: 0 })]));
    expect(await screen.findByText("ch2.pdf has 180 pages. Checking and labelling it will use about 154,000 tokens.")).toBeTruthy();
    expect(screen.getByText("Your plan's 5-hour window is at 42% now.")).toBeTruthy();
    expect(screen.getByText("Checking and labelling send parts of this material to Anthropic.")).toBeTruthy();
    fireEvent.change(screen.getByRole("spinbutton", { name: "From page" }), { target: { value: "40" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "To page" }), { target: { value: "62" } });
    fireEvent.click(screen.getByRole("button", { name: "Only these pages" }));
    const all = screen.getByRole("button", { name: "All of it" }) as HTMLButtonElement;
    await waitFor(() => expect(all.disabled).toBe(false));
    fireEvent.click(all);
    await waitFor(() => expect(client.materialCalls).toEqual(["confirm:ch2", "confirm:ch2"]));
    expect(client.materialChoices).toEqual([{ pageRange: [40, 62] }, {}]);
  });

  it("at the hard limit only a page range shorter than the limit goes on", async () => {
    const client = await panel(view([src({ status: "pending", notice: "max", pages: 420, fragments: 0 })]));
    expect(await screen.findByText("ch2.pdf has 420 pages: too many to process whole. Choose up to 299 pages you need.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "All of it" })).toBeNull();
    const range = screen.getByRole("button", { name: "Only these pages" }) as HTMLButtonElement;
    fireEvent.change(screen.getByRole("spinbutton", { name: "To page" }), { target: { value: "420" } });
    expect(range.disabled).toBe(true);
    fireEvent.change(screen.getByRole("spinbutton", { name: "To page" }), { target: { value: "300" } });
    expect(range.disabled).toBe(true);
    fireEvent.change(screen.getByRole("spinbutton", { name: "To page" }), { target: { value: "299" } });
    expect(range.disabled).toBe(false);
    fireEvent.click(range);
    await waitFor(() => expect(client.materialChoices).toEqual([{ pageRange: [1, 299] }]));
  });

  it("a confirm that doesn't go through says so, and the buttons wait while it runs", async () => {
    const client = await panel(view([src({ status: "pending", notice: "warn", pages: 180, estimate: 154000, fragments: 0 })]));
    client.materialConfirmResult = { ok: false, reason: "invalid" };
    const all = (await screen.findByRole("button", { name: "All of it" })) as HTMLButtonElement;
    fireEvent.click(all);
    expect(all.disabled).toBe(true);
    expect(await screen.findByText("That didn't go through. Try again.")).toBeTruthy();
    expect(all.disabled).toBe(false);
    cleanup();
    const rejecting = await panel(view([src({ status: "pending", notice: "warn", pages: 180, estimate: 154000, fragments: 0 })]));
    rejecting.materialConfirmResult = new Error("ipc");
    fireEvent.click(await screen.findByRole("button", { name: "All of it" }));
    expect(await screen.findByText("That didn't go through. Try again.")).toBeTruthy();
  });

  it("a confirm in flight says so; one that failed offers Try again, which sends the same answer", async () => {
    const client = await panel(view([src({ status: "pending", notice: "warn", pages: 180, estimate: 154000, fragments: 0 })]));
    let finish = () => {};
    client.material.confirm = (_scope, id, choice) => {
      client.materialCalls.push(`confirm:${id}`);
      client.materialChoices.push(choice);
      return new Promise((resolve) => {
        finish = () => resolve({ ok: false, reason: "invalid" });
      });
    };
    fireEvent.click(await screen.findByRole("button", { name: "All of it" }));
    expect(await screen.findByText("Sending your answer…")).toBeTruthy();
    finish();
    expect(await screen.findByText(/That didn't go through/)).toBeTruthy();
    expect(screen.queryByText("Sending your answer…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(client.materialChoices).toEqual([{}, {}]));
  });

  it("a full review waits with its own text: check all of it, or go on without it", async () => {
    const client = await panel(view([src({ status: "pending", notice: "full-review", estimate: 30000, fragments: 24 })]));
    expect(
      await screen.findByText("The check of ch2.pdf found problems that may go beyond what it looked at. Checking all 24 fragments will use about 30,000 tokens."),
    ).toBeTruthy();
    expect(screen.getByText("Checking and labelling send parts of this material to Anthropic.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "All of it" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Only these pages" })).toBeNull();
    const all = screen.getByRole("button", { name: "Check all of it" }) as HTMLButtonElement;
    fireEvent.click(all);
    await waitFor(() => expect(all.disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Go on without it" }));
    await waitFor(() => expect(client.materialCalls).toEqual(["confirm:ch2", "decide:ch2:-:use"]));
    expect(client.materialChoices).toEqual([{}]);
  });

  it("a waiting card waits while a turn runs", async () => {
    const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    client.materialViews.fractions = view([src({ status: "pending", notice: "warn", pages: 180, estimate: 154000, fragments: 0 })]);
    await renderIn("en", <MaterialPanel client={client} scope="fractions" info={info} disabled={true} />);
    expect(((await screen.findByRole("button", { name: "All of it" })) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Only these pages" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a big spreadsheet: summary and first rows, or all of it", async () => {
    const client = await panel(view([src({ name: "data.xlsx", status: "pending", notice: "rows", rows: 4000, fragments: 0 })]));
    expect(await screen.findByText("data.xlsx has 4,000 rows. Checking and labelling all of it will use about 9,000 tokens.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Only these pages" })).toBeNull();
    expect(screen.getByRole("button", { name: "All of it" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Summary and first rows" }));
    await waitFor(() => expect(client.materialChoices).toEqual([{ sheets: "summary" }]));
  });

  it("without a usage window, no window line", async () => {
    await panel({ ...view([src({ status: "pending", notice: "warn", pages: 180, estimate: 154000, fragments: 0 })]), window: null });
    await screen.findByText("Checking and labelling send parts of this material to Anthropic.");
    expect(screen.queryByText(/window is at/)).toBeNull();
  });

  it("the grounding toggle, only when the person may change it", async () => {
    const client = await panel(view([src({})]));
    expect(((await screen.findByRole("radio", { name: "The material first" })) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Only the material" }));
    await waitFor(() => expect(client.materialCalls).toContain("grounding:strict"));
    cleanup();
    await panel({ ...view([src({})]), grounding: { mode: "mixed", canChange: false } });
    await screen.findByText("ch2.pdf: ready, 18 fragments");
    expect(screen.queryByRole("radio", { name: "Only the material" })).toBeNull();
  });

  it("status lines", async () => {
    await panel(
      view([
        src({ id: "a", name: "a.pdf", status: "validating", stage: "review" }),
        src({ id: "b", name: "b.pdf", status: "validating", stage: "label" }),
        src({ id: "c", name: "c.pdf", status: "ready" }),
        src({ id: "d", name: "d.mp3", status: "refused", refusal: "media" }),
        src({ id: "e", name: "e.pdf", status: "ready", failed: true }),
        src({ id: "f", name: "f.pdf", status: "converting" }),
        src({ id: "g", name: "g.pdf", status: "removed" }),
      ]),
    );
    expect(await screen.findByText("a.pdf: checking the conversion…")).toBeTruthy();
    expect(screen.getByText("b.pdf: labelling…")).toBeTruthy();
    expect(screen.getByText("c.pdf: ready, 18 fragments")).toBeTruthy();
    expect(screen.getByText("d.mp3: the app only works with files that have text.")).toBeTruthy();
    expect(screen.getByText("e.pdf: ready, not checked by the AI")).toBeTruthy();
    expect(screen.getByText("f.pdf: converting…")).toBeTruthy();
    // A removed source is gone for the person.
    expect(screen.queryByText(/g\.pdf/)).toBeNull();
  });

  it("a source the AI couldn't check offers Try again; others don't", async () => {
    const client = await panel(view([src({ id: "e", name: "e.pdf", status: "ready", failed: true }), src({ id: "c", name: "c.pdf", status: "ready" })]));
    const retry = await screen.findAllByRole("button", { name: "Try again" });
    expect(retry).toHaveLength(1);
    fireEvent.click(retry[0]);
    await waitFor(() => expect(client.materialCalls).toEqual(["retry:e"]));
  });

  it("follows the main process's updates", async () => {
    const client = await panel(view([]));
    client.pushMaterial(view([src({})]));
    expect(await screen.findByText("ch2.pdf: ready, 18 fragments")).toBeTruthy();
  });

  it("refused files and a failed link are reported", async () => {
    const client = await panel(view([]));
    client.materialAddResult = { ok: true, added: [], refused: [{ name: "song.mp3", message: "The app only works with files that have text." }] };
    fireEvent.click(await screen.findByRole("button", { name: "Add a file" }));
    expect(await screen.findByText("song.mp3: The app only works with files that have text.")).toBeTruthy();
    client.materialAddResult = { ok: false, reason: "fetch" };
    fireEvent.click(screen.getByRole("button", { name: "Add a link" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Link" }), { target: { value: "https://example.org/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("The page couldn't be read. Check the link and try again.")).toBeTruthy();
    // The form and the link stay, to fix and send again.
    expect((screen.getByRole("textbox", { name: "Link" }) as HTMLInputElement).value).toBe("https://example.org/x");
    client.materialAddResult = { ok: true, added: ["x"], refused: [] };
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Checking and labelling send parts of this material to Anthropic.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Link" })).toBeNull();
  });

  it("an add that fails, or doesn't answer, says so", async () => {
    const client = await panel(view([]));
    client.materialAddResult = { ok: false, reason: "not-ready" };
    fireEvent.click(await screen.findByRole("button", { name: "Add a file" }));
    expect(await screen.findByText("Couldn't add it. Try again.")).toBeTruthy();
    cleanup();
    const other = await panel(view([]));
    other.materialAddResult = new Error("ipc");
    fireEvent.click(await screen.findByRole("button", { name: "Add a file" }));
    expect(await screen.findByText("Couldn't add it. Try again.")).toBeTruthy();
  });

  it("the link form: expanded state, focus, Cancel", async () => {
    await panel(view([]));
    const toggle = await screen.findByRole("button", { name: "Add a link" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const input = screen.getByRole("textbox", { name: "Link" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "https://example.org/y" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "Link" })).toBeNull();
    fireEvent.click(toggle);
    expect((screen.getByRole("textbox", { name: "Link" }) as HTMLInputElement).value).toBe("");
  });

  it("Try again waits while it runs", async () => {
    const client = await panel(view([src({ id: "e", name: "e.pdf", status: "ready", failed: true })]));
    let finish = () => {};
    client.material.retry = (_scope: string, id: string) => {
      client.materialCalls.push(`retry:${id}`);
      return new Promise((resolve) => {
        finish = () => resolve({ ok: true });
      });
    };
    const retry = (await screen.findByRole("button", { name: "Try again" })) as HTMLButtonElement;
    fireEvent.click(retry);
    expect(retry.disabled).toBe(true);
    finish();
    await waitFor(() => expect(retry.disabled).toBe(false));
  });
});

describe("questions and results (§6.2, §11)", () => {
  it("a question about a fragment, and one about the whole source", async () => {
    const client = await panel(
      view([
        src({ id: "a", name: "a.pdf", asks: [{ fragment: "a-005", question: "Is this table right?", choices: ["keep", "drop"] }] }),
        src({ id: "b", name: "b.pdf", status: "needs-person", asks: [{ question: "The AI couldn't make b.pdf readable.", choices: ["use", "remove"] }] }),
      ]),
    );
    expect(await screen.findByText("Is this table right?")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Is this table right?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Drop it" }));
    fireEvent.click(screen.getByRole("button", { name: "Use it as it is" }));
    await waitFor(() => expect(client.materialCalls).toEqual(["decide:a:a-005:drop", "decide:b:-:use"]));
    expect(screen.getByText("b.pdf: needs your decision")).toBeTruthy();
  });

  it("a refused repair offers the program's version", async () => {
    const client = await panel(view([src({ asks: [{ fragment: "ch2-003", question: "The fix changed too many words.", choices: ["program", "drop"] }] })]));
    fireEvent.click(await screen.findByRole("button", { name: "Keep the program's version" }));
    await waitFor(() => expect(client.materialCalls).toEqual(["decide:ch2:ch2-003:program"]));
  });

  it("an answer in flight waits; one that didn't go through offers Try again", async () => {
    const client = await panel(view([src({ asks: [{ fragment: "ch2-005", question: "Is this table right?", choices: ["keep", "drop"] }] })]));
    client.materialDecideResult = { ok: false, reason: "invalid" };
    const keep = (await screen.findByRole("button", { name: "Keep it" })) as HTMLButtonElement;
    fireEvent.click(keep);
    expect(keep.disabled).toBe(true);
    expect(await screen.findByText("That didn't go through. Try again.")).toBeTruthy();
    expect(keep.disabled).toBe(false);
    client.materialDecideResult = { ok: true };
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(client.materialCalls).toEqual(["decide:ch2:ch2-005:keep", "decide:ch2:ch2-005:keep"]));
    await waitFor(() => expect(screen.queryByText("That didn't go through. Try again.")).toBeNull());
  });

  it("questions wait while a turn runs", async () => {
    const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    client.materialViews.fractions = view([src({ asks: [{ fragment: "ch2-005", question: "Is this table right?", choices: ["keep", "drop"] }] })]);
    await renderIn("en", <MaterialPanel client={client} scope="fractions" info={info} disabled />);
    expect(((await screen.findByRole("button", { name: "Keep it" })) as HTMLButtonElement).disabled).toBe(true);
  });

  it("what the check found and fixed, folded under the status line", async () => {
    await panel(view([src({ verdict: "usable-with-fixes", issues: ["Two fragments cut mid-sentence"], fixes: ["Merged ch2-001 and ch2-002"] })]));
    const found = await screen.findByText("What the check found");
    expect(found.closest("details")?.open).toBe(false);
    fireEvent.click(found);
    expect(screen.getByText("Two fragments cut mid-sentence")).toBeTruthy();
    expect(screen.getByText("Merged ch2-001 and ch2-002")).toBeTruthy();
  });

  it("nothing found, nothing folded", async () => {
    await panel(view([src({})]));
    expect(await screen.findByText("ch2.pdf: ready, 18 fragments")).toBeTruthy();
    expect(screen.queryByText("What the check found")).toBeNull();
  });

  it("the items no fragment covers yet; none listed, no line", async () => {
    await panel({ ...view([src({})]), uncovered: ["Decimals", "Percent"] });
    expect(await screen.findByText("No material yet for: Decimals, Percent")).toBeTruthy();
    cleanup();
    await panel({ ...view([src({})]), uncovered: [] });
    await screen.findByText("ch2.pdf: ready, 18 fragments");
    expect(screen.queryByText(/No material yet for/)).toBeNull();
  });
});

describe("where the panel goes", () => {
  async function work(client: FakeClient, props: Partial<HarnessAppProps> = {}) {
    render(<HarnessApp client={client} {...props} />);
    const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
  }

  it("in the flow side panel with material and an open scope; never without material (D0)", async () => {
    const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    client.state = { ...client.state, actions: { study: { label: "Study", cost: "light" } }, material: info };
    await work(client);
    expect(await screen.findByRole("heading", { name: "Material" })).toBeTruthy();
    cleanup();
    const plain = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    plain.state = { ...plain.state, actions: { study: { label: "Study", cost: "light" } } };
    const list = vi.spyOn(plain.material, "list");
    const onChange = vi.spyOn(plain.material, "onChange");
    await work(plain);
    await screen.findByRole("navigation", { name: "Guided path" });
    expect(screen.queryByRole("heading", { name: "Material" })).toBeNull();
    // D0: the window never asks for material.
    expect(list).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a scope switch starts the panel fresh", async () => {
    const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    client.state = { ...client.state, actions: { study: { label: "Study", cost: "light" } }, material: info, scopes: { label: "topic", plural: "topics" } };
    client.scopeList = [
      { id: "fractions", title: "Fractions", createdAt: "c", archived: false },
      { id: "decimals", title: "Decimals", createdAt: "c", archived: false },
    ];
    client.openScope = "fractions";
    client.materialViews.fractions = view([src({ status: "pending", notice: "warn", pages: 180, estimate: 154000, fragments: 0 })]);
    client.materialViews.decimals = { ...view([src({ status: "pending", notice: "warn", pages: 90, estimate: 50000, fragments: 0 })]), scope: "decimals" };
    await work(client);
    fireEvent.click(await screen.findByRole("button", { name: "Add a link" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Link" }), { target: { value: "https://example.org/z" } });
    fireEvent.change(await screen.findByRole("spinbutton", { name: "From page" }), { target: { value: "7" } });
    fireEvent.change(await screen.findByRole("combobox", { name: "Choose topic" }), { target: { value: "decimals" } });
    expect(await screen.findByText("ch2.pdf has 90 pages. Checking and labelling it will use about 50,000 tokens.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Link" })).toBeNull();
    expect((screen.getByRole("spinbutton", { name: "From page" }) as HTMLInputElement).value).toBe("1");
  });

  it("with scopes: only once a scope is open, and that scope's", async () => {
    const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    client.state = { ...client.state, actions: { study: { label: "Study", cost: "light" } }, material: info, scopes: { label: "topic", plural: "topics" } };
    client.scopeList = [{ id: "fractions", title: "Fractions", createdAt: "c", archived: false }];
    await work(client, { materialPanel: ({ scope }) => <p>Own panel for {scope}</p> });
    await screen.findByRole("navigation", { name: "Guided path" });
    expect(screen.queryByText(/Own panel for/)).toBeNull();
    fireEvent.change(await screen.findByRole("combobox", { name: "Choose topic" }), { target: { value: "fractions" } });
    expect(await screen.findByText("Own panel for fractions")).toBeTruthy();
  });

  it("without actions the panel has its own side panel", async () => {
    const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    client.state = { ...client.state, material: info };
    await work(client);
    expect(await screen.findByRole("navigation", { name: "Material" })).toBeTruthy();
  });

  it("citations in the chat: the source and location, which open the original; literal text without material (D0)", async () => {
    const entry = { id: "a1", role: "assistant" as const, text: "Same amount [[frag:ch2-001]].", blocks: [], activities: [], at: "t" };
    const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    client.state = { ...client.state, material: info };
    client.chat = [entry];
    client.citeLabels = { "ch2-001": "ch2.pdf, p.4" };
    await work(client);
    fireEvent.click(await screen.findByRole("button", { name: "ch2.pdf, p.4" }));
    await waitFor(() => expect(client.materialCalls).toContain("open:ch2-001"));
    cleanup();
    const plain = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    plain.chat = [entry];
    const cite = vi.spyOn(plain.material, "cite");
    await work(plain);
    expect(await screen.findByText("Same amount [[frag:ch2-001]].")).toBeTruthy();
    expect(cite).not.toHaveBeenCalled();
  });

  it("a harness's own panel replaces the default", async () => {
    const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    client.state = { ...client.state, actions: { study: { label: "Study", cost: "light" } }, material: info };
    await work(client, { materialPanel: ({ scope }) => <p>Own panel for {scope}</p> });
    expect(await screen.findByText("Own panel for main")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Material" })).toBeNull();
  });
});
