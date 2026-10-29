import { describe, expect, it } from "vitest";
import { classifyError } from "../src/classify";

describe("classifyError", () => {
  it.each([
    ["Invalid API key · Please run /login", "session-expired"],
    ["Not logged in", "session-expired"],
    ["OAuth token has expired", "session-expired"],
    ["HTTP 401 Unauthorized", "session-expired"],
    ["Claude AI usage limit reached|1760000000", "out-of-quota"],
    ["You've hit your usage limit", "out-of-quota"],
    ["Rate limit exceeded (429)", "out-of-quota"],
    ["Segmentation fault", "agent-crashed"],
    ["", "agent-crashed"],
  ])("%s → %s", (text, code) => {
    expect(classifyError(text)).toBe(code);
  });
});
