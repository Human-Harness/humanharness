import { describe, expect, it } from "vitest";
import { announcedPaths, MAX_ANNOUNCED_PATHS } from "../src/main/file-ipc";
import { fileCommitListeners } from "../src/preload/file-commits";

describe("hh:fileCommits (file-timeline spec §6: a commit tells the window which files changed)", () => {
  it("main sends the paths, or null for a commit that changed too many to list", () => {
    expect(announcedPaths(["a.md", "b.md"])).toEqual(["a.md", "b.md"]);
    const many = Array.from({ length: MAX_ANNOUNCED_PATHS + 1 }, (_, i) => `f${i}.md`);
    expect(announcedPaths(many)).toBeNull();
  });

  it("one ipc listener for every onChange; each file's listeners hear only its commits, and every one hears null", () => {
    let subscribed = 0;
    let unsubscribed = 0;
    let send: (paths: unknown) => void = () => undefined;
    const hub = fileCommitListeners((listener) => {
      subscribed++;
      send = listener;
      return () => void unsubscribed++;
    });
    const heard: string[] = [];
    const offA = hub.onChange("a.md", () => heard.push("a"));
    const offA2 = hub.onChange("a.md", () => heard.push("a2"));
    const offB = hub.onChange("b.md", () => heard.push("b"));
    expect(subscribed).toBe(1);
    send(["a.md", "c.md", "a.md"]);
    expect(heard).toEqual(["a", "a2"]);
    send(null);
    expect(heard).toEqual(["a", "a2", "a", "a2", "b"]);
    send("nonsense");
    send([42]);
    expect(heard).toHaveLength(5);
    offA();
    offA2();
    send(["a.md", "b.md"]);
    expect(heard.slice(5)).toEqual(["b"]);
    offB();
    expect(unsubscribed).toBe(1);
    // A listener that throws doesn't stop the others.
    hub.onChange("a.md", () => {
      throw new Error("boom");
    });
    hub.onChange("a.md", () => heard.push("after"));
    expect(subscribed).toBe(2);
    send(["a.md"]);
    expect(heard.at(-1)).toBe("after");
  });
});
