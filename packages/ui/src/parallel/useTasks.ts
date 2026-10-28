import { useCallback, useEffect, useRef, useState } from "react";
import type { HarnessClient, TasksState } from "../client";

/**
 * The open tasks of a harness that declares `parallel` (spec §9.1): read once, then main's pushes. Without `enabled`
 * (plain mode, D0) it asks nothing and stays null; main would refuse every call anyway.
 */
export function useTasks(client: HarnessClient, enabled: boolean): TasksState | null {
  const [tasks, setTasks] = useState<TasksState | null>(null);
  useEffect(() => {
    if (!enabled) {
      setTasks(null);
      return;
    }
    let live = true;
    // A change that has arrived is newer than the first reply, which may have been in flight before it.
    let seen = false;
    const off = client.tasks.onChange((s) => {
      seen = true;
      if (live) setTasks(s);
    });
    client.tasks.list().then(
      (s) => {
        if (live && !seen) setTasks(s);
      },
      () => undefined,
    );
    return () => {
      live = false;
      off();
    };
  }, [client, enabled]);
  return tasks;
}

/**
 * Board mode: a count that changes whenever the chat on screen must become another task's (it keys the ChatView). It
 * moves only once main's tasks change shows the focus on a task that was already open (an inbox row, a notification
 * click in main), or when the window itself went to the start view (`toStart`, after `tasks.focus(null)` resolved). A
 * task this window has just started (its new lane takes the focus) keeps the chat, as does a focused task that ends:
 * the turn on screen goes on, as in plain mode. Null tasks (plain mode, D0): always 0.
 */
export function useFocusEpoch(tasks: TasksState | null): { epoch: number; toStart: () => void } {
  const [epoch, setEpoch] = useState(0);
  /** The focus the chat shows, and the tasks open at the last change. */
  const seen = useRef<{ focus: string | null; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (!tasks) return;
    const focus = tasks.tasks.find((t) => t.focused)?.id ?? null;
    const prev = seen.current;
    if (prev && focus !== null && focus !== prev.focus && prev.ids.has(focus)) setEpoch((e) => e + 1);
    // No focused task in the list: the start view, a lane whose task isn't saved yet, or one that ended. The chat stays.
    seen.current = { focus: focus ?? prev?.focus ?? null, ids: new Set(tasks.tasks.map((t) => t.id)) };
  }, [tasks]);
  const toStart = useCallback(() => {
    if (seen.current) seen.current.focus = null;
    setEpoch((e) => e + 1);
  }, []);
  return { epoch, toStart };
}
