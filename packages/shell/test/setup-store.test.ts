import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type SetupFile, SetupStore, blockingSteps, cleanSetup, emptySetup, setupState, stepStatuses } from "../src/main/setup-store";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-setup-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const tmp = () => fs.mkdtempSync(path.join(root, "f-"));

const AT = "2026-10-27T10:00:00.000Z";
const steps = [
  { id: "conocerte", required: true },
  { id: "estilo", required: false },
  { id: "cuentas", required: true },
];
const ids = steps.map((s) => s.id);

describe("SetupStore", () => {
  it("reads null when there is no file; saves atomically and reads back", async () => {
    const folder = tmp();
    const store = new SetupStore(folder, ids);
    expect(await store.load()).toBeNull();
    const file: SetupFile = { version: 1, steps: { conocerte: { state: "done", at: AT } }, finishedAt: AT, known: ["conocerte"] };
    await store.save(file);
    expect(await store.load()).toEqual(file);
    expect(fs.readdirSync(path.join(folder, ".harness"))).toEqual(["setup.json"]);
  });

  it("sets a file that isn't JSON aside and reads null", async () => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    fs.writeFileSync(path.join(folder, ".harness", "setup.json"), "{");
    expect(await new SetupStore(folder, ids).load()).toBeNull();
    expect(fs.readdirSync(path.join(folder, ".harness")).some((f) => f.startsWith("setup.json.corrupt-"))).toBe(true);
  });

  it("keeps only the manifest's steps, known states and real dates", () => {
    const raw = {
      version: 1,
      steps: { conocerte: { state: "done", at: AT }, estilo: { state: "maybe", at: AT }, cuentas: { state: "skipped", at: "soon" }, gone: { state: "done", at: AT } },
      finishedAt: "never",
      known: ["conocerte", "gone", 3],
    };
    expect(cleanSetup(raw, ids)).toEqual({ version: 1, steps: { conocerte: { state: "done", at: AT } }, known: ["conocerte"] });
    expect(cleanSetup(null, ids)).toEqual(emptySetup());
    expect(cleanSetup({ steps: { constructor: { state: "done", at: AT } } }, ids)).toEqual(emptySetup());
  });
});

describe("statuses and blocking steps (spec §4, D5, §8 Q3)", () => {
  it("first run: every step is missing and every required one blocks, in manifest order", () => {
    expect(stepStatuses(emptySetup(), steps)).toEqual({ conocerte: "missing", estilo: "missing", cuentas: "missing" });
    expect(blockingSteps(emptySetup(), steps)).toEqual(["conocerte", "cuentas"]);
  });

  it("a done step never blocks; a skipped one is remembered; a skippable one never blocks", () => {
    const file: SetupFile = { version: 1, steps: { conocerte: { state: "done", at: AT }, estilo: { state: "skipped", at: AT } } };
    expect(stepStatuses(file, steps)).toEqual({ conocerte: "done", estilo: "skipped", cuentas: "missing" });
    expect(blockingSteps(file, steps)).toEqual(["cuentas"]);
  });

  it("after setup finished, a required step the person hasn't seen yet doesn't block; once seen, it does", () => {
    const finished: SetupFile = { version: 1, steps: { conocerte: { state: "done", at: AT } }, finishedAt: AT, known: ["conocerte", "estilo"] };
    expect(blockingSteps(finished, steps)).toEqual([]);
    expect(blockingSteps({ ...finished, known: ids }, steps)).toEqual(["cuentas"]);
  });

  it("a required step stored as skipped (it became required in an update) still blocks once seen", () => {
    const file: SetupFile = { version: 1, steps: { cuentas: { state: "skipped", at: AT } } };
    expect(blockingSteps(file, steps)).toEqual(["conocerte", "cuentas"]);
  });

  it("setupState is both", () => {
    expect(setupState(emptySetup(), steps)).toEqual({ steps: { conocerte: "missing", estilo: "missing", cuentas: "missing" }, blocking: ["conocerte", "cuentas"] });
  });
});
