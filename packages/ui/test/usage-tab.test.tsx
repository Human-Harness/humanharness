// @vitest-environment happy-dom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState, EngineOption } from "../src/client";
import { SettingsSheet } from "../src/SettingsSheet";
import { UsageTab } from "../src/UsageTab";
import { compactTokens, formatReset } from "../src/usage";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

function Sheet({ client }: { client: FakeClient }) {
  const [state, setState] = useState<AppState>(client.state);
  return <SettingsSheet client={client} state={state} tab="usage" onTab={() => {}} onChange={setState} onClose={() => {}} onSetup={() => {}} />;
}

const in2h = () => new Date(Date.now() + 2 * 3600_000).toISOString();
const ACTIONS: AppState["actions"] = {
  research: { label: "Research", cost: "heavy" },
  tidy: { label: "Tidy up", cost: "medium" },
  note: { label: "Quick note", cost: "light" },
};

function claude(): FakeClient {
  const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
  client.state.engines = [{ ...client.state.engines[0], plansUrl: "https://claude.com/pricing" }];
  client.state.actions = ACTIONS;
  client.state.path = ["tidy", "research"];
  return client;
}

function codex(engine: Partial<EngineOption> = {}): FakeClient {
  const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "codex" });
  client.state.engines = [
    { ...client.state.engines[0], id: "codex", name: "Codex", provider: "OpenAI", reportsLimits: false, plansUrl: "https://chatgpt.com/pricing", ...engine },
  ];
  client.state.actions = ACTIONS;
  return client;
}

/** The visible text of a cell (screen-reader-only text left out). */
const visible = (cell: Element) => {
  const copy = cell.cloneNode(true) as Element;
  copy.querySelectorAll(".hh-sr-only").forEach((e) => e.remove());
  return copy.textContent;
};
/** Each body row as [topic, ...cells]. */
const rows = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((r) => [...r.querySelectorAll("th, td")].map(visible));
const headers = () => within(screen.getByRole("table")).getAllByRole("columnheader").map((c) => c.textContent);

describe("Settings › Uso with an engine that reports limits", () => {
  it("shows each window, its bar and reset, and how many times each topic fits", async () => {
    const client = claude();
    const reset = in2h();
    client.usage = {
      limits: [
        { kind: "five_hour", utilization: 0.42, resetsAt: reset },
        { kind: "seven_day", utilization: 0.1, resetsAt: new Date(Date.now() + 3 * 86400_000).toISOString() },
      ],
      estimates: { research: 0.08, tidy: 0.004, questions: 0.03 },
      tokens: {},
      primary: "five_hour",
    };
    await renderIn("en", <Sheet client={client} />);
    expect(await screen.findByText("42% used")).toBeTruthy();
    expect(screen.getByText(`renews ${formatReset(reset, "en")}`)).toBeTruthy();
    expect(screen.getByText("Claude reports it with every reply")).toBeTruthy();
    expect(headers()).toEqual(["Topic", "Each time", "Enough for"]);
    // The table is named by its heading.
    expect(screen.getByRole("table", { name: "How much each topic uses" })).toBeTruthy();
    // Path order (tidy, research), then the other actions, then free questions.
    expect(rows()).toEqual([
      ["Tidy up", "≈ 1% of 5 h", "more than 50"],
      ["Research", "≈ 8% of 5 h", "about 13 times"],
      ["Quick note", "Low use · I'll tell you how much once you use it"],
      ["Free question", "≈ 3% of 5 h", "about 33 times"],
    ]);
    // A heavy action's share is in the warning colour.
    expect(screen.getByText("≈ 8% of 5 h").className).toBe("hh-warn");
    expect(screen.getByText("≈ 1% of 5 h").className).toBe("");
    expect(screen.getByText("'Enough for' assumes a whole 5-hour window and your plan today. It recalculates on its own if the model or your plan changes.")).toBeTruthy();
    // Below WARN_AT the plans link stays out.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says once and fifty, and drops the suffix for an unknown window", async () => {
    const client = claude();
    client.usage = { limits: null, estimates: { research: 0.9, tidy: 1 / 50 }, tokens: {}, primary: "rolling" };
    await renderIn("en", <Sheet client={client} />);
    await screen.findByRole("table");
    expect(rows().slice(0, 2)).toEqual([
      ["Tidy up", "≈ 2%", "about 50 times"],
      ["Research", "≈ 90%", "about once"],
    ]);
  });

  it("before any report: says the engine tells with the first reply, and shows the harness's hints", async () => {
    const client = claude();
    client.usage = { limits: null, estimates: {}, tokens: {}, primary: "five_hour" };
    await renderIn("en", <Sheet client={client} />);
    expect(await screen.findByText("I don't know how much you've used yet: Claude reports it with your first reply.")).toBeTruthy();
    expect(rows()).toEqual([
      ["Tidy up", "Medium use · I'll tell you how much once you use it"],
      ["Research", "High use · I'll tell you how much once you use it"],
      ["Quick note", "Low use · I'll tell you how much once you use it"],
      ["Free question", "— · I'll tell you how much once you use it"],
    ]);
    expect(
      screen.getByText("For now this is what the harness says about each topic. Once you use one, you'll see here how much it really used and how many times your plan has room for it."),
    ).toBeTruthy();
  });

  it("near the limit: counts what is left until the reset, and links the provider's plans", async () => {
    const client = claude();
    const reset = in2h();
    client.usage = {
      limits: [{ kind: "five_hour", utilization: 0.85, resetsAt: reset }],
      estimates: { research: 0.08, tidy: 0.05, questions: 0.002 },
      tokens: {},
      primary: "five_hour",
    };
    await renderIn("en", <Sheet client={client} />);
    expect((await screen.findByText("85% used")).className).toBe("hh-warn");
    expect(headers()).toEqual(["Topic", "Each time", `Until ${formatReset(reset, "en")}`]);
    expect(rows().map((r) => r[2])).toEqual(["3 more times", "1 more time", undefined, "more than 50"]);
    expect(screen.getByText("If you often run short, Anthropic has plans with more use.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "See Anthropic plans" });
    expect(link.getAttribute("href")).toBe("https://claude.com/pricing");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("near the limit: a topic that won't fit whole says so", async () => {
    const client = claude();
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.95, resetsAt: in2h() }], estimates: { research: 0.08 }, tokens: {}, primary: "five_hour" };
    await renderIn("en", <Sheet client={client} />);
    await screen.findByText("95% used");
    expect(rows()[1]).toEqual(["Research", "≈ 8% of 5 h", "won't fit whole"]);
  });

  it("leaves out windows that have already reset, and names an unknown one generically", async () => {
    const client = claude();
    client.usage = {
      limits: [
        { kind: "five_hour", utilization: 0.97, resetsAt: new Date(Date.now() - 60_000).toISOString() },
        { kind: "monthly", utilization: 0.3, resetsAt: new Date(Date.now() + 4 * 86400_000).toISOString() },
      ],
      estimates: {},
      tokens: {},
      primary: "five_hour",
    };
    await renderIn("en", <Sheet client={client} />);
    expect(await screen.findByText("30% used")).toBeTruthy();
    expect(screen.getByText("Limit")).toBeTruthy();
    expect(screen.queryByText("97% used")).toBeNull();
  });

  it("after every window has reset: says the window renewed, not that the first reply is still to come", async () => {
    const client = claude();
    client.usage = { limits: [], estimates: { research: 0.08 }, tokens: { research: 5000 }, primary: "five_hour" };
    await renderIn("en", <Sheet client={client} />);
    expect(await screen.findByText("Your window has renewed: Claude tells you how much you've used with your next reply.")).toBeTruthy();
    expect(screen.queryByText(/primera respuesta/)).toBeNull();
  });

  it("a topic that was used but never measured says it couldn't be measured yet", async () => {
    const client = claude();
    // tidy has tokens (it was used) but no estimate (no task of it could be measured against the window).
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.2, resetsAt: in2h() }], estimates: {}, tokens: { tidy: 3000 }, primary: "five_hour" };
    await renderIn("en", <Sheet client={client} />);
    await screen.findByRole("table");
    expect(rows().slice(0, 3)).toEqual([
      ["Tidy up", "Medium use · I couldn't measure it yet"],
      ["Research", "High use · I'll tell you how much once you use it"],
      ["Quick note", "Low use · I'll tell you how much once you use it"],
    ]);
  });
});

describe("Settings › Uso with an engine that reports no limits", () => {
  it("compares each topic's tokens with the average, with the tokens in a tooltip, and links the plans", async () => {
    const client = codex();
    client.state.actions = {
      ...ACTIONS,
      a: { label: "A", cost: "light" },
      b: { label: "B", cost: "light" },
    };
    // Six measured topics adding up to 6000: the average is 1000.
    client.usage = { limits: null, estimates: {}, tokens: { research: 2400, tidy: 1000, note: 500, a: 700, b: 1340, questions: 60 } };
    await renderIn("en", <Sheet client={client} />);
    expect(
      await screen.findByText(
        "Codex doesn't tell the app how much you have left, so I can't work out how far your plan goes. If you reach the limit, Codex tells you when it renews.",
      ),
    ).toBeTruthy();
    expect(headers()).toEqual(["Topic", "Each time"]);
    expect(rows()).toEqual([
      ["Research", "2.4 times the average"],
      ["Tidy up", "about the average"],
      ["Quick note", "half the average"],
      ["A", "a bit less than the average"],
      ["B", "1.3 times the average"],
      ["Free question", "half the average"],
    ]);
    const cell = screen.getByText("2.4 times the average").closest("td")!;
    expect(cell.getAttribute("title")).toBe(`≈ ${compactTokens(2400, "en")} tokens each time`);
    // The same detail reaches the keyboard and screen readers as hidden text.
    expect(cell.querySelector(".hh-sr-only")!.textContent).toBe(` (≈ ${compactTokens(2400, "en")} tokens each time)`);
    // The bar is relative to the largest topic.
    const bar = (text: string) => (screen.getByText(text).closest("td")!.querySelector(".hh-usage-bar > span") as HTMLElement).style.width;
    expect(bar("2.4 times the average")).toBe("100%");
    expect(bar("about the average")).toBe("42%");
    expect(screen.getByText("From your last few times with each topic. Hover to see the tokens.")).toBeTruthy();
    expect(screen.getByText("If you often run short, OpenAI has plans with more use.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See OpenAI plans" }).getAttribute("href")).toBe("https://chatgpt.com/pricing");
  });

  it("says a bit more than the average just above 1.33×", async () => {
    const client = codex();
    client.state.actions = { a: ACTIONS.note, b: ACTIONS.tidy };
    // Average 1000: a is 1335 (1.335×), b and questions make up the rest.
    client.usage = { limits: null, estimates: {}, tokens: { a: 1335, b: 1000, questions: 665 } };
    await renderIn("en", <Sheet client={client} />);
    await screen.findByRole("table");
    expect(rows()[0]).toEqual(["Quick note", "a bit more than the average"]);
  });

  it("before any use: shows the hints alone", async () => {
    const client = codex();
    await renderIn("en", <Sheet client={client} />);
    await screen.findByRole("table");
    expect(rows()).toEqual([
      ["Research", "High use"],
      ["Tidy up", "Medium use"],
      ["Quick note", "Low use"],
      ["Free question", "—"],
    ]);
    expect(screen.getByText(/^For now this is what the harness says about each topic/)).toBeTruthy();
  });

  it("without a plans page there is no link", async () => {
    await renderIn("en", <Sheet client={codex({ plansUrl: undefined })} />);
    await screen.findByRole("table");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/has plans with more use/)).toBeNull();
  });
});

describe("Settings › Uso in mock mode", () => {
  it("keeps the test-mode line, compares tokens, and has no plans link", async () => {
    const client = claude();
    client.state.engines = [{ ...client.state.engines[0], name: "IA simulada", plansUrl: undefined, reportsLimits: false, mock: true }];
    client.usage = { limits: null, estimates: {}, tokens: { tidy: 1000, research: 1000 } };
    await renderIn("en", <Sheet client={client} />);
    expect(await screen.findByText("Test mode: uses none of your plan.")).toBeTruthy();
    expect(rows().slice(0, 2)).toEqual([
      ["Tidy up", "about the average"],
      ["Research", "about the average"],
    ]);
    expect(screen.queryByText(/no le dice a la app/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("speaks English too", async () => {
    const client = claude();
    client.state.config.language = "en";
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.2, resetsAt: in2h() }], estimates: { research: 0.1 }, tokens: {}, primary: "five_hour" };
    await renderIn("en", <Sheet client={client} />);
    expect(await screen.findByText("20% used")).toBeTruthy();
    expect(screen.getByRole("table", { name: "How much each topic uses" })).toBeTruthy();
    expect(rows()[1]).toEqual(["Research", "≈ 10% of 5 h", "about 10 times"]);
    expect(screen.getByText("'Enough for' assumes a whole 5-hour window and your plan today. It recalculates on its own if the model or your plan changes.")).toBeTruthy();
  });
});

describe("usage per scope", () => {
  it("lists the scopes by tokens used, most first", async () => {
    const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    client.state.scopes = { label: "topic", plural: "topics" };
    client.scopeList = [{ id: "fracciones", title: "Fractions", createdAt: "c", archived: false }];
    client.usage = { limits: null, estimates: {}, tokens: {}, scopes: { _app: 300, fracciones: 12_000 } };
    await renderIn("en", <UsageTab client={client} state={client.state} />);
    const list = await screen.findByRole("list", { name: "Usage by topics" });
    await waitFor(() => expect([...list.querySelectorAll("li")].map((li) => li.firstChild?.textContent)).toEqual(["Fractions", "App-wide"]));
  });
});

describe("Settings › Usage with material (material spec §11)", () => {
  it("shows the material's total tokens; without any, no such line", async () => {
    const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    client.usage = { limits: null, estimates: {}, tokens: {}, material: 12000 };
    await renderIn("en", <UsageTab client={client} state={client.state} />);
    expect(await screen.findByText("Material processing: about 12,000 tokens")).toBeTruthy();
    cleanup();
    const plain = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    plain.usage = { limits: null, estimates: {}, tokens: {} };
    await renderIn("en", <UsageTab client={plain} state={plain.state} />);
    await screen.findByText("How much each topic uses");
    expect(screen.queryByText(/Material processing/)).toBeNull();
  });
});
