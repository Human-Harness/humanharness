// @vitest-environment happy-dom
import { cleanup, screen } from "@testing-library/react";
import { renderIn } from "./home-block";
import { afterEach, describe, expect, it } from "vitest";
import { ContextMeter } from "../../../ui/src/FlowSide";

afterEach(cleanup);

describe("the meter pills", () => {
  it("the context meter as a pill reads 'Context n%' and keeps its name and readout", async () => {
    await renderIn("en", <ContextMeter used={84_000} cap={200_000} onOpen={() => {}} pill />);
    const pill = screen.getByRole("button", { name: "What the AI takes into account" });
    expect(pill.className).toContain("hh-pill"); // a state pill, not a Button
    expect(pill.textContent).toContain("Context 42%");
    expect(screen.getByRole("meter", { name: "Context in use" }).getAttribute("aria-valuenow")).toBe("42");
  });
});
