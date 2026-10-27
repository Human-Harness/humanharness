// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp, type HarnessAppProps, type MaterialView } from "../src";
import { MaterialPanel } from "../src/MaterialPanel";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const info = { accepts: ["pdf", "text"], items: false, grounding: { default: "mixed" as const, personCanChange: true } };
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
  it("adds a file and a link", async () => {
    const client = await panel(view([]));
    fireEvent.click(await screen.findByRole("button", { name: "Add a file" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a link" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Link" }), { target: { value: "https://example.org/halves" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(client.materialCalls).toEqual(["add:fractions", "link:fractions:https://example.org/halves"]));
  });

  it("a waiting source: the estimate, the window, the privacy line, a page range", async () => {
    const client = await panel(view([src({ status: "pending", notice: "warn", pages: 180, estimate: 154000, fragments: 0 })]));
    expect(await screen.findByText("ch2.pdf has 180 pages. Checking and labelling it will use about 154,000 tokens.")).toBeTruthy();
    expect(screen.getByText("Your plan's five_hour window is at 42% now.")).toBeTruthy();
    expect(screen.getByText("Checking and labelling send parts of this material to Anthropic.")).toBeTruthy();
    fireEvent.change(screen.getByRole("spinbutton", { name: "From page" }), { target: { value: "40" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "To page" }), { target: { value: "62" } });
    fireEvent.click(screen.getByRole("button", { name: "Only these pages" }));
    fireEvent.click(screen.getByRole("button", { name: "All of it" }));
    await waitFor(() => expect(client.materialCalls).toEqual(["confirm:ch2", "confirm:ch2"]));
    expect(client.materialChoices).toEqual([{ pageRange: [40, 62] }, {}]);
  });

  it("at the hard limit only a page range goes on", async () => {
    await panel(view([src({ status: "pending", notice: "max", pages: 420, fragments: 0 })]));
    expect(await screen.findByRole("button", { name: "Only these pages" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "All of it" })).toBeNull();
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
    await work(plain);
    await screen.findByRole("navigation", { name: "Guided path" });
    expect(screen.queryByRole("heading", { name: "Material" })).toBeNull();
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

  it("a harness's own panel replaces the default", async () => {
    const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    client.state = { ...client.state, actions: { study: { label: "Study", cost: "light" } }, material: info };
    await work(client, { materialPanel: ({ scope }) => <p>Own panel for {scope}</p> });
    expect(await screen.findByText("Own panel for main")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Material" })).toBeNull();
  });
});
