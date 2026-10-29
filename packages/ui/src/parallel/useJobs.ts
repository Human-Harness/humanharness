import { useEffect, useState } from "react";
import type { HarnessClient, JobSummary } from "../client";

/**
 * The jobs × scopes of a harness that declares jobs (parallel spec §9.1): read once, then main's pushes. Without
 * `enabled` (no jobs, D0) it asks nothing and stays empty; main would refuse every call anyway.
 */
export function useJobs(client: HarnessClient, enabled: boolean): JobSummary[] {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  useEffect(() => {
    if (!enabled) {
      setJobs([]);
      return;
    }
    let live = true;
    // A change that has arrived is newer than the first reply, which may have been in flight before it.
    let seen = false;
    const off = client.jobs.onChange((list) => {
      seen = true;
      if (live) setJobs(list);
    });
    client.jobs.list().then(
      (list) => {
        if (live && !seen) setJobs(list);
      },
      () => undefined,
    );
    return () => {
      live = false;
      off();
    };
  }, [client, enabled]);
  return jobs;
}
