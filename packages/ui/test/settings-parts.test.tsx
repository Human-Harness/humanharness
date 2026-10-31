// @vitest-environment happy-dom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionHead, SettingRow } from "../src/settings-parts";
import { renderIn } from "./render";

afterEach(cleanup);

describe("settings parts (UI refresh spec §5.5)", () => {
  it("a section opens with its title and one line on what it is for", async () => {
    await renderIn("en", <SectionHead title="Models" line="Choose how much power each task uses. Changes apply from the next task." />);
    expect(screen.getByRole("heading", { level: 2, name: "Models" })).toBeTruthy();
    expect(screen.getByText(/Changes apply from the next task/)).toBeTruthy();
  });
  it("a row puts label and hint left, control right", async () => {
    await renderIn(
      "en",
      <SettingRow label="Before you send" hint="Review prompts before they go out.">
        <button role="switch" aria-checked="true" aria-label="Before you send" />
      </SettingRow>,
    );
    expect(screen.getByText("Review prompts before they go out.").className).toContain("hh-caption");
  });
});
