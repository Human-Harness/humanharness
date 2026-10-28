import { useEffect, useState } from "react";
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
