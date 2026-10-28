import { describe, expect, it } from "vitest";
import { announcedPaths, commitAnnouncer, MAX_ANNOUNCED_PATHS } from "../src/main/file-ipc";
import { fileCommitListeners } from "../src/preload/file-commits";

describe("hh:fileCommits (file-timeline spec §6: a commit tells the window which files changed)", () => {
  it("main sends the paths, or null for a commit that changed too many to list", () => {
    expect(announcedPaths(["a.md", "b.md"])).toEqual(["a.md", "b.md"]);
    const many = Array.from({ length: MAX_ANNOUNCED_PATHS + 1 }, (_, i) => `f${i}.md`);
    expect(announcedPaths(many)).toBeNull();
  });

  it("a history's announcer stops when its runtime closes; another history's goes on", () => {
    type Listener = (c: { sha: string; paths: string[] }) => void;
    const fake = () => {
      const listeners = new Set<Listener>();
      return {
        listeners,
        onCommit: (l: Listener) => (listeners.add(l), () => void listeners.delete(l)),
        commit: (paths: string[]) => listeners.forEach((l) => l({ sha: "s", paths })),
      };
    };
    const sent: unknown[] = [];
    const announcer = commitAnnouncer((paths) => sent.push(paths));
    const closing = fake();
    const other = fake();
    announcer.watch(closing);
    announcer.watch(other);
    closing.commit(["a.md"]);
    announcer.stop(closing);
    announcer.stop(closing);
    closing.commit(["b.md"]);
    other.commit(["c.md"]);
    expect(sent).toEqual([["a.md"], ["c.md"]]);
    expect(closing.listeners.size).toBe(0);
    expect(other.listeners.size).toBe(1);
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
