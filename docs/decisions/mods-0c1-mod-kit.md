# Decisions — mods-0c1-mod-kit

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/mods-0c1-mod-kit/plan.md · approved 2026-11-13 · closed 2026-11-15
Jobs: 1 merged, 2 blocked · Decisions: 1 worker, 0 reviewer, 4 arkimedes

## mcp-server — merged

- **D1** · The `claude` config snippet shell-quotes its paths, so paths with spaces or `'` work when pasted into a shell. · _worker (T2)_
  <details><summary>more</summary>

  Why: the snippet is meant to be pasted into a shell.
  Rejected: printing the paths raw.
  See: https://github.com/Human-Harness/humanharness/pull/164 · report `runs/humanharness/mods-0c1-mod-kit/mcp-server.report.md`
  </details>

- **D2** · The integration gate was red on load-sensitive `packages/shell` timing tests that also fail on the base (backend-process B8, documents, plugin-fixture-mode, outside-code). Marco chose to run the integration gate with `--maxWorkers=4` instead of having a worker fix the tests. A separate task on master makes those tests robust. · _arkimedes_
  <details><summary>more</summary>

  Why: the failing files are outside this job's area, and base fix 1 turned 1 failing test into 5 while base fix 2 timed out. The base fails the same way, so the code was not at fault (q1, q2, q3).
  Rejected: more base-fix workers inside this run. Marco also asked about running only the tests this job touches (q3).
  See: https://github.com/Human-Harness/humanharness/pull/164 · report `runs/humanharness/mods-0c1-mod-kit/mcp-server.report.md`
  </details>

- **D3** · The job gate (`vitest run packages/cli`, 42 files) kept failing on different timing and watcher tests at a machine load of about 28-43. Each failing file passes alone. Marco accepted head 80d0a96e on the `--changed` gate (17 files, 323 tests, green) with `--maxWorkers=4`. · _arkimedes_
  <details><summary>more</summary>

  Why: the code was finished and reviewed clean, and the job was already at $18.61 of $12. Another worker attempt would only spend money on the same flakes (q4).
  Rejected: re-running the full gate with a new worker.
  See: https://github.com/Human-Harness/humanharness/pull/164 · report `runs/humanharness/mods-0c1-mod-kit/mcp-server.report.md`
  </details>

- **D4** · The runner cannot override a job's gate, so attempts 7 and 8 started new workers despite Marco's approval of the `--changed` acceptance in q5 and q6. Cost reached $35.33 of $12. The run was stopped so the plan's gates for mcp-server and mod-tools could be edited. Both then use the `--changed` form with `--maxWorkers=4`, and the integration gate gets `--maxWorkers=4` too. · _arkimedes_
  <details><summary>more</summary>

  Why: the fallback Marco approved in q6 was to stop, change the gates in the plan, then resume. Editing the plan after approval held the run until Marco re-approved it (q7, q9). Attempt 9 then passed the job gate, a clean review, and the integration gate on 7c7a2ed1, and the job merged.
  Rejected: another worker attempt, which failed the same way twice.
  See: https://github.com/Human-Harness/humanharness/pull/164 · report `runs/humanharness/mods-0c1-mod-kit/mcp-server.report.md`
  </details>

## mod-tools — blocked

- **D5** · Marco ended the run at q8 (answer `stop`) rather than approving the plan text that had changed after approval. The job never started because it depended on mcp-server. · _arkimedes_
  <details><summary>more</summary>

  Why: the retry reopened the run and held it on the plan change. Marco chose `stop`. The run was re-approved on 2026-11-15, but mcp-server was the only job retried, so mod-tools stayed blocked.
  Rejected: restoring the approved text or approving the new text at q8.
  See: no PR · no report
  </details>

## manual-e2e — blocked

- **D6** · This job stayed blocked behind mod-tools. Marco ended the run (q8) before either started, and only mcp-server was retried afterwards. · _arkimedes_
  <details><summary>more</summary>

  Why: its dependency chain was manual-e2e → mod-tools → mcp-server, and mod-tools never ran.
  Rejected: none recorded.
  See: no PR · no report
  </details>
