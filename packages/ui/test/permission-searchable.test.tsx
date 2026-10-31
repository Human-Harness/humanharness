// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import { createI18n } from "@humanharness/i18n";
import { PermissionList, PermissionText } from "../src/plugins/PermissionReview";

afterEach(cleanup);

describe("the review's searchable line (search spec §7)", () => {
  it("names each searchable collection and its fields", async () => {
    render(
      <I18nextProvider i18n={await createI18n("en")}>
        <PermissionText line={{ kind: "searchable", collections: [{ name: "issues", fields: ["title", "body"] }] }} />
      </I18nextProvider>,
    );
    expect(screen.getByText(/Searchable:/).textContent).toBe("Searchable: issues (title, body)");
  });

  it("each collection and field name is isolated (B12): a right-to-left override can't reorder the line", async () => {
    const rlo = "\u202Eevil";
    const { container } = render(
      <I18nextProvider i18n={await createI18n("en")}>
        <PermissionText line={{ kind: "searchable", collections: [{ name: rlo, fields: ["title", `${rlo}2`] }, { name: "b", fields: ["x"] }] }} />
      </I18nextProvider>,
    );
    const isolated = [...container.querySelectorAll("bdi")].map((b) => b.textContent);
    expect(isolated).toEqual([rlo, "title", `${rlo}2`, "b", "x"]);
    expect(container.textContent).toBe(`Searchable: ${rlo} (title, ${rlo}2); b (x)`);
    for (const b of container.querySelectorAll("bdi")) expect(b.getAttribute("dir")).toBe("auto");
  });

  it("a plugin that asks for nothing still says so, and says what is searchable", async () => {
    render(
      <I18nextProvider i18n={await createI18n("en")}>
        <PermissionList lines={[{ kind: "searchable", collections: [{ name: "issues", fields: ["title"] }] }]} />
      </I18nextProvider>,
    );
    expect(screen.getByText("It asks for nothing beyond its own data.")).toBeTruthy();
    expect(screen.getByText(/Searchable:/).textContent).toBe("Searchable: issues (title)");
  });

  it("with permissions, the searchable line is one more in the list and the none sentence is not shown", async () => {
    render(
      <I18nextProvider i18n={await createI18n("en")}>
        <PermissionList lines={[{ kind: "tasks" }, { kind: "searchable", collections: [{ name: "issues", fields: ["title"] }] }]} />
      </I18nextProvider>,
    );
    expect(screen.queryByText("It asks for nothing beyond its own data.")).toBeNull();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Can propose agent tasks", "Searchable: issues (title)"]);
  });
});
