import { describe, expect, it } from "vitest";
import { CORE_LOCALES } from "../src";

const get = (path: string) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], CORE_LOCALES.en) as string;

/**
 * Every state says what happens next (UI refresh spec §6). These stand alone where they show: no line or control
 * beside them names the next step, so the string itself does (plan Task 28, case (b)).
 */
const STANDALONE = [
  "home.status.queued",
  "parallel.pausedTomorrow",
  "parallel.jobOff",
  "plugins.status.crashed",
  "plugins.keys.notStored",
  "connections.notSet",
];

describe("status copy", () => {
  it.each(STANDALONE)("%s names the next step", (key) => {
    const text = get(key);
    expect(text, key).toBeTruthy();
    expect(text, key).toMatch(/ · /);
  });

  it("matches the spec's examples", () => {
    expect(get("setupFlow.tileStatus.not-installed")).toBe("Not on this computer yet · we install it next");
    expect(get("inbox.board.startsWhen")).toBe("Starts when a slot frees up · {{cap}} tasks at once");
    expect(get("parallel.pausedTomorrow")).toBe("Paused until tomorrow · daily token cap reached");
    expect(get("plugins.status.crashed")).toBe("Turned off after crashes · turn it on to try again");
    expect(get("plugins.keys.notStored")).toBe("Not stored · paste the key to use {{plugin}}");
    expect(get("connections.notSet")).toBe("Not set · paste the key to use it");
  });

  it('says "Working" for a task the AI is on, everywhere (spec Q4)', () => {
    for (const key of ["home.status.working", "parallel.workingTitle"]) expect(get(key), key).toBe("Working");
  });
});
