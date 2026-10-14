// @vitest-environment happy-dom
import { cleanup, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState, EngineOption } from "../src/client";
import { SettingsSheet } from "../src/SettingsSheet";
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
  research: { label: { es: "Investigar", en: "Research" }, cost: "heavy" },
  tidy: { label: { es: "Ordenar", en: "Tidy up" }, cost: "medium" },
  note: { label: { es: "Nota", en: "Quick note" }, cost: "light" },
};

function claude(): FakeClient {
  const client = new FakeClient({ language: "es", folder: "/Users/me/Documents/Demo", engineId: "claude" });
  client.state.engines = [{ ...client.state.engines[0], plansUrl: "https://claude.com/pricing" }];
  client.state.actions = ACTIONS;
  client.state.path = ["tidy", "research"];
  return client;
}

function codex(engine: Partial<EngineOption> = {}): FakeClient {
  const client = new FakeClient({ language: "es", folder: "/Users/me/Documents/Demo", engineId: "codex" });
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
    await renderIn("es", <Sheet client={client} />);
    expect(await screen.findByText("42 % usado")).toBeTruthy();
    expect(screen.getByText(`se renueva ${formatReset(reset, "es")}`)).toBeTruthy();
    expect(screen.getByText("lo informa Claude en cada respuesta")).toBeTruthy();
    expect(headers()).toEqual(["Tema", "Cada vez", "Te alcanza para"]);
    // The table is named by its heading.
    expect(screen.getByRole("table", { name: "Cuánto usa cada tema" })).toBeTruthy();
    // Path order (tidy, research), then the other actions, then free questions.
    expect(rows()).toEqual([
      ["Ordenar", "≈ 1 % de 5 h", "más de 50"],
      ["Investigar", "≈ 8 % de 5 h", "unas 13 veces"],
      ["Nota", "Uso bajo · te digo cuánto después de usarlo"],
      ["Pregunta libre", "≈ 3 % de 5 h", "unas 33 veces"],
    ]);
    // A heavy action's share is in the warning colour.
    expect(screen.getByText("≈ 8 % de 5 h").className).toBe("hh-warn");
    expect(screen.getByText("≈ 1 % de 5 h").className).toBe("");
    expect(screen.getByText("'Te alcanza para' es con una ventana de 5 horas entera y tu plan de hoy. Se recalcula solo si cambia el modelo o tu plan.")).toBeTruthy();
    // Below WARN_AT the plans link stays out.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says once and fifty, and drops the suffix for an unknown window", async () => {
    const client = claude();
    client.usage = { limits: null, estimates: { research: 0.9, tidy: 1 / 50 }, tokens: {}, primary: "rolling" };
    await renderIn("es", <Sheet client={client} />);
    await screen.findByRole("table");
    expect(rows().slice(0, 2)).toEqual([
      ["Ordenar", "≈ 2 %", "unas 50 veces"],
      ["Investigar", "≈ 90 %", "una vez"],
    ]);
  });

  it("before any report: says the engine tells with the first reply, and shows the harness's hints", async () => {
    const client = claude();
    client.usage = { limits: null, estimates: {}, tokens: {}, primary: "five_hour" };
    await renderIn("es", <Sheet client={client} />);
    expect(await screen.findByText("Todavía no sé cuánto usaste: Claude lo informa con tu primera respuesta.")).toBeTruthy();
    expect(rows()).toEqual([
      ["Ordenar", "Uso medio · te digo cuánto después de usarlo"],
      ["Investigar", "Uso alto · te digo cuánto después de usarlo"],
      ["Nota", "Uso bajo · te digo cuánto después de usarlo"],
      ["Pregunta libre", "— · te digo cuánto después de usarlo"],
    ]);
    expect(
      screen.getByText("Por ahora es lo que dice el harness de cada tema. Cuando uses uno, acá aparece cuánto usó de verdad y cuántas veces te alcanza."),
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
    await renderIn("es", <Sheet client={client} />);
    expect((await screen.findByText("85 % usado")).className).toBe("hh-warn");
    expect(headers()).toEqual(["Tema", "Cada vez", `Hasta las ${formatReset(reset, "es")}`]);
    expect(rows().map((r) => r[2])).toEqual(["3 veces más", "1 vez más", undefined, "más de 50"]);
    expect(screen.getByText("Si te quedás corto seguido, Anthropic tiene planes con más uso.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Ver planes de Anthropic" });
    expect(link.getAttribute("href")).toBe("https://claude.com/pricing");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("near the limit: a topic that won't fit whole says so", async () => {
    const client = claude();
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.95, resetsAt: in2h() }], estimates: { research: 0.08 }, tokens: {}, primary: "five_hour" };
    await renderIn("es", <Sheet client={client} />);
    await screen.findByText("95 % usado");
    expect(rows()[1]).toEqual(["Investigar", "≈ 8 % de 5 h", "no entra entero"]);
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
    await renderIn("es", <Sheet client={client} />);
    expect(await screen.findByText("30 % usado")).toBeTruthy();
    expect(screen.getByText("Límite")).toBeTruthy();
    expect(screen.queryByText("97 % usado")).toBeNull();
  });

  it("after every window has reset: says the window renewed, not that the first reply is still to come", async () => {
    const client = claude();
    client.usage = { limits: [], estimates: { research: 0.08 }, tokens: { research: 5000 }, primary: "five_hour" };
    await renderIn("es", <Sheet client={client} />);
    expect(await screen.findByText("Tu ventana se renovó: Claude te dice cuánto usaste con tu próxima respuesta.")).toBeTruthy();
    expect(screen.queryByText(/primera respuesta/)).toBeNull();
  });

  it("a topic that was used but never measured says it couldn't be measured yet", async () => {
    const client = claude();
    // tidy has tokens (it was used) but no estimate (no task of it could be measured against the window).
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.2, resetsAt: in2h() }], estimates: {}, tokens: { tidy: 3000 }, primary: "five_hour" };
    await renderIn("es", <Sheet client={client} />);
    await screen.findByRole("table");
    expect(rows().slice(0, 3)).toEqual([
      ["Ordenar", "Uso medio · no pude medirlo todavía"],
      ["Investigar", "Uso alto · te digo cuánto después de usarlo"],
      ["Nota", "Uso bajo · te digo cuánto después de usarlo"],
    ]);
  });
});

describe("Settings › Uso with an engine that reports no limits", () => {
  it("compares each topic's tokens with the average, with the tokens in a tooltip, and links the plans", async () => {
    const client = codex();
    client.state.actions = {
      ...ACTIONS,
      a: { label: { es: "A", en: "A" }, cost: "light" },
      b: { label: { es: "B", en: "B" }, cost: "light" },
    };
    // Six measured topics adding up to 6000: the average is 1000.
    client.usage = { limits: null, estimates: {}, tokens: { research: 2400, tidy: 1000, note: 500, a: 700, b: 1340, questions: 60 } };
    await renderIn("es", <Sheet client={client} />);
    expect(
      await screen.findByText(
        "Codex no le dice a la app cuánto te queda, así que no puedo calcular cuántas veces te alcanza. Si llegás al límite, Codex te avisa cuándo se renueva.",
      ),
    ).toBeTruthy();
    expect(headers()).toEqual(["Tema", "Cada vez"]);
    expect(rows()).toEqual([
      ["Investigar", "2,4 veces el promedio"],
      ["Ordenar", "como el promedio"],
      ["Nota", "la mitad del promedio"],
      ["A", "un poco menos que el promedio"],
      ["B", "1,3 veces el promedio"],
      ["Pregunta libre", "la mitad del promedio"],
    ]);
    const cell = screen.getByText("2,4 veces el promedio").closest("td")!;
    expect(cell.getAttribute("title")).toBe(`≈ ${compactTokens(2400, "es")} tokens cada vez`);
    // The same detail reaches the keyboard and screen readers as hidden text.
    expect(cell.querySelector(".hh-sr-only")!.textContent).toBe(` (≈ ${compactTokens(2400, "es")} tokens cada vez)`);
    // The bar is relative to the largest topic.
    const bar = (text: string) => (screen.getByText(text).closest("td")!.querySelector(".hh-usage-bar > span") as HTMLElement).style.width;
    expect(bar("2,4 veces el promedio")).toBe("100%");
    expect(bar("como el promedio")).toBe("42%");
    expect(screen.getByText("Sale de tus últimas veces con cada tema. Pasá el mouse para ver los tokens.")).toBeTruthy();
    expect(screen.getByText("Si te quedás corto seguido, OpenAI tiene planes con más uso.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver planes de OpenAI" }).getAttribute("href")).toBe("https://chatgpt.com/pricing");
  });

  it("says a bit more than the average just above 1.33×", async () => {
    const client = codex();
    client.state.actions = { a: ACTIONS.note, b: ACTIONS.tidy };
    // Average 1000: a is 1335 (1.335×), b and questions make up the rest.
    client.usage = { limits: null, estimates: {}, tokens: { a: 1335, b: 1000, questions: 665 } };
    await renderIn("es", <Sheet client={client} />);
    await screen.findByRole("table");
    expect(rows()[0]).toEqual(["Nota", "un poco más que el promedio"]);
  });

  it("before any use: shows the hints alone", async () => {
    const client = codex();
    await renderIn("es", <Sheet client={client} />);
    await screen.findByRole("table");
    expect(rows()).toEqual([
      ["Investigar", "Uso alto"],
      ["Ordenar", "Uso medio"],
      ["Nota", "Uso bajo"],
      ["Pregunta libre", "—"],
    ]);
    expect(screen.getByText(/^Por ahora es lo que dice el harness/)).toBeTruthy();
  });

  it("without a plans page there is no link", async () => {
    await renderIn("es", <Sheet client={codex({ plansUrl: undefined })} />);
    await screen.findByRole("table");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/tiene planes con más uso/)).toBeNull();
  });
});

describe("Settings › Uso in mock mode", () => {
  it("keeps the test-mode line, compares tokens, and has no plans link", async () => {
    const client = claude();
    client.state.engines = [{ ...client.state.engines[0], name: "IA simulada", plansUrl: undefined, reportsLimits: false, mock: true }];
    client.usage = { limits: null, estimates: {}, tokens: { tidy: 1000, research: 1000 } };
    await renderIn("es", <Sheet client={client} />);
    expect(await screen.findByText("Modo prueba: no gasta tu plan.")).toBeTruthy();
    expect(rows().slice(0, 2)).toEqual([
      ["Ordenar", "como el promedio"],
      ["Investigar", "como el promedio"],
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
