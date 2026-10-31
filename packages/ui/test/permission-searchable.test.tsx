// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import { createI18n } from "@humanharness/i18n";
import { PermissionText } from "../src/plugins/PermissionReview";

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
});
