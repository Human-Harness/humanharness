// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mermaidConfig } from "../src/mermaid-loader";

// The real Mermaid (no mock). Without "htmlLabels" in `secure`, this directive leaves htmlLabels true in the config.
describe("Mermaid's config against a diagram's directive", () => {
  it("an init directive can't turn HTML labels back on or loosen the security level", async () => {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize(mermaidConfig({}));
    const code = '%%{init: {"htmlLabels": true, "securityLevel": "loose", "flowchart": {"htmlLabels": true}}}%%\nflowchart LR\n  A["<b>x</b>"] --> B';
    // Drawing applies the directive to the config; happy-dom can't lay the diagram out, which doesn't matter here.
    await mermaid.render("hh-mermaid-test", code).catch(() => undefined);
    const config = mermaid.mermaidAPI.getConfig();
    expect(config.htmlLabels).toBe(false);
    expect(config.securityLevel).toBe("strict");
  });
});
