# Decisions — task-view-one-column

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/task-view-one-column/plan.md · approved 2026-11-16 · closed 2026-11-16
Jobs: 5 merged, 0 blocked · Decisions: 10 worker, 0 reviewer, 1 arkimedes

## backend-fixture — merged

- **D1** · The worker asked to widen the job's area to `packages/fake-agent/package.json` and `pnpm-lock.yaml` so the moved BackendPanel unit test could run there. Marco approved ("ok"). · _arkimedes_
  <details><summary>more</summary>

  Why: the moved `backend-panel.test.tsx` could not run in `packages/fake-agent`. That package lacked the test dependencies, and typecheck failed on the same import. Both in-area fixes failed. Moving the test back to `harnesses/demo/test` left Vite unable to find `@humanharness/ui`. Swapping the import with `vi.mock` failed too, because Vite errors first.
  Rejected: staying inside the area (no working fix was found); the answer's other options (`:stop`, or custom instructions to the worker) were not used.
  See: https://github.com/Human-Harness/humanharness/pull/195 · report `runs/humanharness/task-view-one-column/backend-fixture.report.md`
  </details>

- **D2** · The worker added only `@testing-library/react`, `happy-dom`, `react-dom` and `@types/react-dom` to `fake-agent`, not the approved `@humanharness/ui`. `BackendPanel` now takes `backend: UseBackend` (type import only), and `App.tsx` calls `useBackend(client)`. · _worker (T1)_
  <details><summary>more</summary>

  Why: the `@humanharness/ui` dependency created a node_modules symlink cycle (cli → fake-agent → ui → …). That cycle hung the recursive readdir in `packages/cli/test/init.test.ts`.
  Rejected: adding `@humanharness/ui` as a dependency, which Marco's approval had allowed.
  See: https://github.com/Human-Harness/humanharness/pull/195 · report `runs/humanharness/task-view-one-column/backend-fixture.report.md`
  </details>

- **D3** · The fixture panel reads its strings straight from `locales/en.json`, without react-i18next. The dock sits bottom-left. · _worker (T1)_
  <details><summary>more</summary>

  Why: the dock sits outside HarnessApp's `I18nextProvider`, so `t()` returned raw keys. The core's "helper stopped" card covers bottom-right and blocked the Restart click.
  Rejected: its own i18n provider (more dependencies); a bottom-right dock.
  See: https://github.com/Human-Harness/humanharness/pull/195 · report `runs/humanharness/task-view-one-column/backend-fixture.report.md`
  </details>

## one-bar — merged

- **D4** · With no task open, the top-bar slot still holds the scope picker, plugin chips and Sidekick toggle, placed after the spacer. The start view keeps its crumbs, Volver and gear. This came out of review round 1. · _worker (T2)_
  <details><summary>more</summary>

  Why: the old task header showed these on the start view, and the scopes, Sidekick and plugin tests rely on them there.
  Rejected: hiding them until a task opens.
  See: https://github.com/Human-Harness/humanharness/pull/199 · report `runs/humanharness/task-view-one-column/one-bar.report.md`
  </details>

- **D5** · "New task" shows in the switcher only for parallel harnesses. In parallel mode a focused task counts as open for both the bar and the rail's TASK group. · _worker (T2)_
  <details><summary>more</summary>

  Why: plain mode has no board, and main's `tasks.focus` throws without one; that code is outside the area. In parallel mode the chat may have no `tasks.current` while a task is focused, and the bar and rail must agree so Task settings stays reachable.
  Rejected: always showing "New task"; using only the chat's `tasks.current`.
  See: https://github.com/Human-Harness/humanharness/pull/199 · report `runs/humanharness/task-view-one-column/one-bar.report.md`
  </details>

## one-column — merged

- **D6** · The overlay CSS went into `styles.css`, not a new `task-view.css`. The overlays reuse existing i18n keys (`reader.path`, `reader.close`, `flow.count`, `sidekick.*`) instead of new `overlay.*` keys. · _worker (T2)_
  <details><summary>more</summary>

  Why: the style guard and the guide class list only scan `styles.css`, so a separate file would bypass the closed-world checks. `packages/i18n` is outside the job's area.
  Rejected: `task-view.css`; new `overlay.*` keys.
  See: https://github.com/Human-Harness/humanharness/pull/200 · report `runs/humanharness/task-view-one-column/one-column.report.md`
  </details>

- **D7** · The harness's side panel lives in Sidekick's overlay behind its Sidekick / Harness switch when Sidekick shows. Otherwise it goes after the path in the left overlay. · _worker (T2)_
  <details><summary>more</summary>

  Why: this keeps one overlay per side and leaves Sidekick's behaviour unchanged.
  Rejected: a third overlay for the harness side.
  See: https://github.com/Human-Harness/humanharness/pull/200 · report `runs/humanharness/task-view-one-column/one-column.report.md`
  </details>

## composer-line — merged

- **D8** · The "N new messages" pill counts only finished entries that are not the reader's own (role ≠ user). · _worker (T2)_
  <details><summary>more</summary>

  Why: in a flow task the question's own entry arrives during the turn and was being counted as new.
  Rejected: counting `shown`, which is empty during a flow's first turn.
  See: https://github.com/Human-Harness/humanharness/pull/201 · report `runs/humanharness/task-view-one-column/composer-line.report.md`
  </details>

- **D9** · The page-level working line shows wherever the conversation is hidden (Inbox, Jobs, History, Notes) but not on Task settings. · _worker (T2)_
  <details><summary>more</summary>

  Why: it is the simplest condition that matches "every task page".
  Rejected: a per-page opt-in.
  See: https://github.com/Human-Harness/humanharness/pull/201 · report `runs/humanharness/task-view-one-column/composer-line.report.md`
  </details>

## look-pass — merged

- **D10** · "Empty task" in the look spec is the demo's start view right after Start Demo, and the streaming shot is taken last. · _worker (T2)_
  <details><summary>more</summary>

  Why: the demo has no other empty task screen, and Stop ends the demo's topic, which would break the shots after it.
  Rejected: an empty task opened by a typed question, since the first message is sent at once and the task is never empty.
  See: https://github.com/Human-Harness/humanharness/pull/202 · report `runs/humanharness/task-view-one-column/look-pass.report.md`
  </details>

- **D11** · The composer's focus ring moved to the card (2 px `hh-ink`, offset 2), and its placeholder uses `hh-muted`. · _worker (T2)_
  <details><summary>more</summary>

  Why: these are values DESIGN.md already states. They fix a double frame around the composer and an AA contrast fail (dark placeholder was 3.5:1).
  Rejected: a softer border-colour focus, which fails the 3:1 contrast needed for a focus indicator.
  See: https://github.com/Human-Harness/humanharness/pull/202 · report `runs/humanharness/task-view-one-column/look-pass.report.md`
  </details>
