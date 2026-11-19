---
topic: configless-install
cycle: 3
total_proposed: 2
---
# Analysis Tasks: configless-install (Cycle 3)

Discarded (low, report-level): symlink scan+catch 3-site DRY (borderline rule-of-three, defer until a 4th site); config non-object returns null without onWarn (observability-only, spec-correct); manifestTypeFromDetected vs deriveTypeFromFiles two-site drift (real but low, spec-acceptable, no current defect).

## Task 1: Give update's symlink-escape its own copy-safety outcome and message
status: approved
severity: medium
sources: architecture

**Problem**: On update, a `SymlinkEscapeError` raised by the pre-flight scan in `executeNukeAndReinstall` (src/nuke-reinstall-pipeline.ts:84-95) is mapped to `status: "aborted"` carrying `recordedType: existingEntry.type ?? "skill"` and `reason: err.message`. That structured cause is fed to `buildAbortMessage` (src/clone-reinstall.ts:213-223), which is hard-wired to phrase every abort as a derive-before-delete type mismatch: "`<key>` was installed as a skill, but its source no longer supports that type (symlink "x" points outside the clone)... To migrate: npx agntc remove ... then npx agntc add ...". This conflates two structurally distinct causes: a recorded-type incompatibility (where remove+add is the correct remedy) and an escaping/malicious symlink in the source (where remove+add just re-trips the same guard, so the migrate remedy is wrong). The add path already keeps these separate (SymlinkEscapeError gets its own identity-prefixed cancel at add.ts:313-321), so the two install paths diverge. Flagged as a 5-4 follow-up candidate; independently re-surfaced in cycle 3.

**Solution**: Stop overloading the `aborted` (derive-before-delete) channel for the symlink-escape case. Introduce a dedicated discriminated outcome for the copy-safety violation on the update path and route the symlink-escape catch to it. The reporting layer emits a copy-safety message stating the source contains a symlink that escapes the clone, the update is blocked, and the existing install is left intact — NOT the type-migration remove+add remedy. Keep the install-intact posture; only the classification and message change.

**Outcome**: Update on an escaping symlink shows a copy-safety/blocked message correctly describing the escape and affirming the install is unchanged — no misleading "type no longer supported" wording, no incorrect remove+add remedy. The `aborted`/`buildAbortMessage` channel stays reserved for genuine recorded-type mismatches. Add and update report the same violation consistently.

**Do**:
1. In src/clone-reinstall.ts, add a new discriminated variant to `CloneReinstallResult` for the copy-safety/symlink-escape case (e.g. `status: "blocked"` or `failed` with a dedicated `failureReason`), carrying the escape detail/`reason`. Keep `CloneReinstallAborted` reserved for derive-before-delete.
2. In src/nuke-reinstall-pipeline.ts:84-95, change the `SymlinkEscapeError` catch to return the new copy-safety variant (passing `err.message`) instead of `status: "aborted"`.
3. Add a builder beside `buildAbortMessage` that produces the copy-safety message (source contains a symlink escaping the clone; update blocked; install unchanged), mirroring the add path's framing.
4. Update the failure dispatch (`mapCloneFailure`/`isCloneReinstallFailure` + consumers in update.ts:223-230 and the list actions) to handle the new variant and emit the copy-safety message rather than `buildAbortMessage`.
5. Confirm `buildAbortMessage` is now only reached for true recorded-type mismatches.

**Acceptance Criteria**:
- An escaping symlink on update produces a copy-safety/blocked message describing the symlink escape, not a "type no longer supported" / remove+add message.
- The existing install is left intact (no nuke, no copy, manifest entry unchanged) for the symlink-escape case (posture unchanged).
- `buildAbortMessage`/`aborted` is exercised only for genuine derive-before-delete recorded-type mismatches.
- Add and update describe the same symlink-escape violation with consistent copy-safety framing.

**Tests**:
- Update where the source contains a symlink escaping the clone root: assert the new copy-safety variant, the message describes a symlink escape (no "no longer supports that type", no remove+add remedy), install/manifest unchanged.
- Update where the source genuinely diverges from the recorded type: still routes through `aborted`/`buildAbortMessage` with the recorded-type-mismatch wording + remove+add remedy.
- Regression: add path symlink-escape still cancels with its identity-prefixed message; add and update framings are consistent.

## Task 2: Extract a shared CloneReinstallFailure-to-message helper for the two list actions
status: approved
severity: medium
sources: duplication

**Problem**: The list update action (src/commands/list-update-action.ts:38-77) and the list change-version action (src/commands/list-change-version-action.ts:90-127) duplicate the entire tail of the reinstall flow: `prepareReinstall` (identical not-ok message `Path ${key} does not exist or is not a directory`), `cloneAndReinstall`, then `isCloneReinstallFailure` + `mapCloneFailure` with a handler object mapping every failure case to the action's result type. The two handler objects are structurally identical — `onCloneFailed`/`onNoAgents`/`onCopyFailed`/`onUnknown` each return `{ <flag>: false, message: msg }` and `onAborted` returns `{ <flag>: false, message: buildAbortMessage(key, recordedType, reason) }`. The only real differences are the result discriminator key (`success` vs `changed`) and a change-version-only `stripConstraint` on the success path. Independently-authored copy-paste; drift risk whenever abort/failure presentation changes or a new `CloneReinstallFailure` variant is added (including Task 1's new variant).

**Solution**: Extract a shared helper in src/clone-reinstall.ts (beside `mapCloneFailure`) that collapses any `CloneReinstallFailure` to a single `{ ok: false; message: string }`. Each list action calls it and wraps the message in its own result shape, keeping only its distinct success-path logic (change-version's `stripConstraint`) local. `update.ts`'s `processUpdateForAll` keeps its own richer handler and is out of scope.

**Outcome**: One shared function maps a `CloneReinstallFailure` to a user-facing message; both list actions delegate to it, differing only in discriminator + success-path post-processing. A failure-variant change (e.g. Task 1's copy-safety variant) requires one edit; the two list actions cannot drift.

**Do**:
1. In src/clone-reinstall.ts, add `failureMessage(result: CloneReinstallFailure, key: string): string` beside `mapCloneFailure` covering all current failure variants — pass-through `msg` for clone-failed/no-agents/copy-failed/unknown, `buildAbortMessage(key, recordedType, reason)` for aborted (and Task 1's copy-safety variant if it landed first).
2. In list-update-action.ts, replace the inline handler with a call to the helper, wrapping `{ success: false, message }`.
3. In list-change-version-action.ts, same, wrapping `{ changed: false, message }`, keeping `stripConstraint` on success unchanged.
4. Leave `processUpdateForAll` untouched.
5. Both actions still emit the same `Path ${key} does not exist or is not a directory` on prepareReinstall not-ok.

**Acceptance Criteria**:
- Both list actions produce identical failure messages for every `CloneReinstallFailure` variant, from the single shared helper.
- Change-version success still calls `stripConstraint`; update success does not.
- Result discriminators (`success` vs `changed`) and success messages unchanged.
- `processUpdateForAll` unchanged.
- No duplicated `mapCloneFailure` handler object remains across the two list action files.

**Tests**:
- For each `CloneReinstallFailure` variant, assert both list actions surface the same helper-produced message.
- Change-version success: `stripConstraint` runs, `changed: true` returned.
- Update success: no constraint strip, `success: true` returned.
- Failure-path regression for both actions returns the correct discriminator with the helper message.
