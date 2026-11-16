// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "../src/ChatView";
import type { ChatEntry } from "../src/client";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const said = (id: string, text: string): ChatEntry => ({ id, role: "assistant", text, blocks: [], activities: [], at: "2026-11-15T10:00:00.000Z" });

/** The conversation card with a scroll box the DOM can't lay out: 1000 high, 300 shown. */
function metrics(el: HTMLElement) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 1000 });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 300 });
}

async function chat() {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  client.chat = [said("a1", "Hello")];
  await renderIn("en", <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} />);
  await screen.findByText("Hello");
  const card = screen.getByRole("region", { name: "Conversation" });
  metrics(card);
  return { client, card };
}

/** A message the app adds on its own (a notice outside a turn): one more entry in the conversation. */
function arrives(client: FakeClient) {
  act(() => client.emit({ type: "task-notice", notice: { kind: "resume-failed" } }));
}

function scrollTo(card: HTMLElement, top: number) {
  card.scrollTop = top;
  fireEvent.scroll(card);
}

describe("the jump pill (task view one column)", () => {
  it("scrolled up, two messages arrive: '2 new messages ↓' shows inside the card; a click goes to the end and hides it", async () => {
    const { client, card } = await chat();
    scrollTo(card, 100);
    expect(screen.queryByRole("button", { name: /new message/ })).toBeNull();
    arrives(client);
    arrives(client);
    const pill = screen.getByRole("button", { name: "2 new messages ↓" });
    expect(pill.classList.contains("hh-jump-pill")).toBe(true);
    expect(card.contains(pill)).toBe(true);
    fireEvent.click(pill);
    expect(card.scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: /new message/ })).toBeNull();
  });

  it("one message says so in the singular", async () => {
    const { client, card } = await chat();
    scrollTo(card, 100);
    arrives(client);
    expect(screen.getByRole("button", { name: "1 new message ↓" })).toBeTruthy();
  });

  it("scrolling to the end by hand hides it", async () => {
    const { client, card } = await chat();
    scrollTo(card, 100);
    arrives(client);
    arrives(client);
    expect(screen.getByRole("button", { name: "2 new messages ↓" })).toBeTruthy();
    scrollTo(card, 700);
    expect(screen.queryByRole("button", { name: /new message/ })).toBeNull();
  });

  it("at the end, new messages show no pill", async () => {
    const { client, card } = await chat();
    scrollTo(card, 700);
    arrives(client);
    expect(screen.queryByRole("button", { name: /new message/ })).toBeNull();
  });
});
