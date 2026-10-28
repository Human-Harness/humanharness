// @vitest-environment happy-dom
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovedDiff } from "../src/ApprovedDiff";
import type { TimelineEntry } from "../src/client";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const DOC = "docs/cache.md";
const V1 = "c".repeat(40);
const approval = (lastApproved: boolean): TimelineEntry => ({
  kind: "approval",
  author: { kind: "person", label: "You" },
  label: "v1 approved",
  at: "2026-10-28T10:00:00.000Z",
  from: "d".repeat(40),
  to: V1,
  version: 1,
  ...(lastApproved ? { lastApproved: true as const } : {}),
  commits: [{ id: V1, subject: `Approved: ${DOC}`, at: "2026-10-28T10:00:00.000Z" }],
});
const added = (after: string) => ({ ok: true as const, kind: "markdown" as const, same: false, truncated: false, blocks: [{ type: "paragraph" as const, status: "added" as const, after }], source: [] });
const NONE = "The approved version can't be read any more, so there is nothing to compare.";

describe("ApprovedDiff ('See what changed', file-timeline spec §9)", () => {
  it("no approval the record holds on the timeline: says so", async () => {
    const client = new FakeClient();
    client.timelines[DOC] = [approval(false)];
    await renderIn("en", <ApprovedDiff client={client} path={DOC} />);
    expect(await screen.findByText(NONE)).toBeTruthy();
  });

  it("a reload that fails keeps the approval it had", async () => {
    const client = new FakeClient();
    client.timelines[DOC] = [approval(true)];
    client.diffs[`${DOC}|${V1}|current`] = added("Since v1.");
    await renderIn("en", <ApprovedDiff client={client} path={DOC} />);
    await screen.findByText("Since v1.");
    delete client.timelines[DOC];
    act(() => client.emitFileCommit([DOC]));
    await waitFor(() => expect(client.fileCalls.filter((c) => c.op === "timeline")).toHaveLength(2));
    expect(screen.getByText("Since v1.")).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
  });
});
