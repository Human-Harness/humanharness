# Decisions — mods-1b-finish

Plan: /Users/marcozanger/.claude/arkimedes/approvals/humanharness/mods-1b-finish/v1/plan.md · approved 2026-11-24 · closed 2026-11-26
Jobs: 6 merged, 0 blocked · Decisions: 9 worker, 0 reviewer, 10 arkimedes

## ui-slots — merged

- **D1** · `RowPlace`, `ReviewVerdict` and `ComposerReviewer` stay unexported from mod-sdk, although they appear in `hh.d.ts` inside `UiCtx`. The shell's AGENTS.md text does not yet document the new slots. · _author: worker (T2)_
  <details><summary>more</summary>

  Why: AGENTS.md must name every exported name, and its source (`manual.ts`) was outside the job's area.
  Rejected: exporting the types and leaving `manual.test` red.
  See: https://github.com/Human-Harness/humanharness/pull/226 · report `runs/humanharness/mods-1b-finish/ui-slots.report.md`
  </details>

- **D2** · A mod's Settings tab uses the name the mod gives as its id, and sits before Mods. · _author: worker (T2)_
  <details><summary>more</summary>

  Why: search's open-settings command opens tabs by id.
  Rejected: `mod:<id>/<name>` ids, which needed a protocol change outside the area.
  See: https://github.com/Human-Harness/humanharness/pull/226 · report `runs/humanharness/mods-1b-finish/ui-slots.report.md`
  </details>

## move-task-ui — merged

- **D3** · q1: Marco allowed the job to change `en.json` and `packages/ui/src/index.ts`, for neutral review wording, new exports and a task-view context. The proposal he approved only added keys and exports. · _author: arkimedes_
  <details><summary>more</summary>

  Why: the core wording used `sidekick.*` keys, so the done check could not pass. The moved components also needed pieces that `@humanharness/ui` did not export.
  Rejected: blocking the job. No other job had either file in its area.
  See: https://github.com/Human-Harness/humanharness/pull/227 · report `runs/humanharness/mods-1b-finish/move-task-ui.report.md`
  </details>

- **D4** · q2: Marco accepted a temporary bridge. ChatView kept an unused `onSidekickSettings` prop as an exception to the done check, and the toggle test moved to the mod with its assertions unchanged. · _author: arkimedes_
  <details><summary>more</summary>

  Why: `HarnessApp.tsx` belonged to the live move-settings-ui job. Marco also granted `meter-pills.test.tsx`. q4 later allowed move-settings-ui to drop the prop.
  Rejected: editing `HarnessApp.tsx` from this job.
  See: https://github.com/Human-Harness/humanharness/pull/227 · report `runs/humanharness/mods-1b-finish/move-task-ui.report.md`
  </details>

- **D5** · q3: the area widen was refused because some files belonged to ui-slots, and Marco's "ok to proposal" went to the worker. The delivered fix differs from that proposal: all four guide pieces, including `ICON_NAMES` and `IconName`, are exported outside `./guide`, and `hh.d.ts` matches the base. · _author: arkimedes_
  <details><summary>more</summary>

  Why: the new exports had changed the public mod contract and turned the integration gate red. According to the report, keeping the pieces core-only restored `hh.d.ts` and made `manual.test.ts` pass. The report also mentions load timeouts in CLI tests, including a later integration failure in `tool-test`; those files passed alone and on a rerun.
  Rejected: the proposal published `Button` and `Segmented`, regenerated the contract files and removed the two icon exports. The report does not explain why it was not followed.
  See: https://github.com/Human-Harness/humanharness/pull/227 · report `runs/humanharness/mods-1b-finish/move-task-ui.report.md`
  </details>

- **D6** · `mark.tsx`, `PresetOffer.tsx` and `useSidekick.ts` were copied into the mod, and the `hh-sk-*` CSS stayed in the core. · _author: worker (T2)_
  <details><summary>more</summary>

  Why: the Settings tab, excluded from this job, still used the core copies and CSS, and screenshots had to stay unchanged.
  Rejected: `git mv`, which would have broken the tab.
  See: https://github.com/Human-Harness/humanharness/pull/227 · report `runs/humanharness/mods-1b-finish/move-task-ui.report.md`
  </details>

## move-settings-ui — merged

- **D7** · q4: Marco widened the job to extend the mod slot API generically. Tabs can say when they show and change their label, and tabs and rows receive the client and state they need. · _author: arkimedes_
  <details><summary>more</summary>

  Why: the plan says a job that changes the mod API owns the API files. The grant also covered the contract files, generated docs and removal of the dead ChatView prop. `UiCtx.call/on` had to stay optional.
  Rejected: always registering the tab, statics, casts and Sidekick-specific additions.
  See: https://github.com/Human-Harness/humanharness/pull/228 · report `runs/humanharness/mods-1b-finish/move-settings-ui.report.md`
  </details>

- **D8** · q5: after the area check refused files already allowed in q4, Marco told the worker to change no code, confirm a clean committed tree and let the check run again. · _author: arkimedes_
  <details><summary>more</summary>

  Why: Marco attributed the refusal to a runner bug in which a merged job still owned its area, fixed in arkimedes PR #145.
  Rejected: stopping the job. The runner also could not grant Euklides's proposed widen.
  See: https://github.com/Human-Harness/humanharness/pull/228 · report `runs/humanharness/mods-1b-finish/move-settings-ui.report.md`
  </details>

- **D9** · The mod gets `Group`, `Row` and `SectionHead` through core-only exports that are not part of the public `hh.d.ts`. · _author: worker (T2)_
  <details><summary>more</summary>

  Why: publishing them would widen the third-party API more than the job needed and require AGENTS.md entries.
  Rejected: public exports, or a new file outside the area.
  See: https://github.com/Human-Harness/humanharness/pull/228 · report `runs/humanharness/mods-1b-finish/move-settings-ui.report.md`
  </details>

- **D10** · Core tests lost their Sidekick-specific parts. The Usage assertion moved to the mod's tests, the plugins-tab expectation changed from "after Sidekick" to "after Mods", and the four-argument `taskRows` unit case was dropped. · _author: worker (T2)_
  <details><summary>more</summary>

  Why: the core no longer knows Sidekick. The dropped case's parameter is gone, and the report says a rendered test covers the row.
  Rejected: loading the Sidekick mod into core tests.
  See: https://github.com/Human-Harness/humanharness/pull/228 · report `runs/humanharness/mods-1b-finish/move-settings-ui.report.md`
  </details>

## channels-rename — merged

- **D11** · q6: Marco approved changing one type import in `overlay.test.tsx` to point at the Sidekick mod. The runner then allowed the file as a companion file. · _author: arkimedes_
  <details><summary>more</summary>

  Why: the type had moved and the job's new test barred the client from declaring it, so typecheck failed. The question also listed gaps against the plan (`AppState.sidekick`, the `app-channels.ts` stub, stale mod-sdk comments). The answer, "ok a la proposal", does not say whether those gaps were accepted or need a follow-up.
  Rejected: leaving the typecheck red.
  See: https://github.com/Human-Harness/humanharness/pull/229 · report `runs/humanharness/mods-1b-finish/channels-rename.report.md`
  </details>

- **D12** · `AppState.sidekick` stays, typed inline, although the brief said it should go. `app-channels.ts` also remains as a no-op stub. · _author: worker (T2)_
  <details><summary>more</summary>

  Why: files outside the area still set the state and call the stub, and Settings' synchronous `shown(state)` depends on the state.
  Rejected: removing the state, which needed those outside files.
  See: https://github.com/Human-Harness/humanharness/pull/229 · report `runs/humanharness/mods-1b-finish/channels-rename.report.md`
  </details>

- **D13** · A core mod's own calls have no time limit and get no strikes. No mod, including a core mod, may now register an `hh:` channel. · _author: worker (T2)_
  <details><summary>more</summary>

  Why: a review waits for a model turn, and the old Sidekick channels had no limit, so call behaviour is unchanged.
  Rejected: a longer time limit for every mod.
  See: https://github.com/Human-Harness/humanharness/pull/229 · report `runs/humanharness/mods-1b-finish/channels-rename.report.md`
  </details>

## manifest-key — merged

- **D14** · q7: Marco added `app-lifecycle.ts` and `app-state.ts` to the area so both read `harness.mods?.sidekick`. · _author: arkimedes_
  <details><summary>more</summary>

  Why: after the top-level key was removed, these reads caused typecheck errors, and the app would never have turned Sidekick on.
  Rejected: finishing within the original area.
  See: https://github.com/Human-Harness/humanharness/pull/230 · report `runs/humanharness/mods-1b-finish/manifest-key.report.md`
  </details>

- **D15** · A `z.preprocess` step rejects the old top-level `sidekick` key with a message naming `mods.sidekick`, so the `Harness` type no longer has the field. `harness-sdk/src/sidekick.ts` stays as a re-export. · _author: worker (T1)_
  <details><summary>more</summary>

  Why: stale `harness.sidekick` reads must not keep compiling, and tests outside the area still import from harness-sdk.
  Rejected: a `z.never()` field, silently dropping the key, deleting the re-export or renaming all of `manifest.ts`.
  See: https://github.com/Human-Harness/humanharness/pull/230 · report `runs/humanharness/mods-1b-finish/manifest-key.report.md`
  </details>

- **D16** · The first integration gate failed and went back to the worker, who moved the Sidekick cases unchanged from `check.test.ts` to `check-sidekick.test.ts`. · _author: arkimedes_
  <details><summary>more</summary>

  Why: `check.test.ts`, at 48.3 KB, exceeded the file size cap.
  Rejected: no alternative is recorded.
  See: https://github.com/Human-Harness/humanharness/pull/230 · report `runs/humanharness/mods-1b-finish/manifest-key.report.md`
  </details>

- **D17** · The integration gate on `abf83428` was recorded as flaky: it was red under load and green when rerun alone on the machine. The job then merged. · _author: arkimedes_
  <details><summary>more</summary>

  Why: the focus assertion at `packages/mods/home/test/inbox.test.tsx:430` failed at load 18. Euklides reported that it also failed on the integration branch without this job, and that the file passed 33/33 three times alone. The suggested fix is to wait inside `waitFor` for focus to reach the rail's Tasks; nothing here shows that it has been made.
  Rejected: treating the failure as a fault in this job.
  See: https://github.com/Human-Harness/humanharness/pull/230 · report `runs/humanharness/mods-1b-finish/manifest-key.report.md`
  </details>

## ratchet-e2e — merged

- **D18** · The first integration gate failed. The worker changed no code, and on the same head `d1d1a012` the later integration gate passed and the job merged. The cause of the failure remains unverified. · _author: arkimedes_
  <details><summary>more</summary>

  Why: the worker's full-suite rerun passed. The saved output named only a 15 s file-watcher timeout in `plugin-fixture-mode.test.ts:333`, although 3 files and 2 tests had failed. Load flakiness is likely but unproven, and the events do not record this gate as flaky. If it recurs, the full output is needed.
  Rejected: changing code without a reproduced failure.
  See: https://github.com/Human-Harness/humanharness/pull/231 · report `runs/humanharness/mods-1b-finish/ratchet-e2e.report.md`
  </details>

- **D19** · The "core alone" e2e turns Home and Sidekick off, uses a layout with an empty `home` column and detects mod UI through Sidekick's class names, labels and text. · _author: worker (T1)_
  <details><summary>more</summary>

  Why: Home is a mod block that is on by default, and slot parts have no generic DOM marker. Only Sidekick fills the slots. As a result, these slot checks are specific to Sidekick.
  Rejected: leaving Home on, using the default layout with its "Mod Home is off" notice, checking only layout blocks, or adding a marker, which needed a source change.
  See: https://github.com/Human-Harness/humanharness/pull/231 · report `runs/humanharness/mods-1b-finish/ratchet-e2e.report.md`
  </details>
