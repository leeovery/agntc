AGENT: duplication
CYCLE: 8
STATUS: findings
FINDINGS_COUNT: 1

FINDINGS:

- FINDING: Local-path validation message re-authored across three reinstall entry points
  SEVERITY: low
  FILES: src/commands/update.ts:207, src/commands/list-update-action.ts:45, src/commands/list-change-version-action.ts:96
  DESCRIPTION: All three callers of `prepareReinstall` that surface a failed local-path check hand-author the same literal `Path ${key} does not exist or is not a directory` (update.ts appends a period). `prepareReinstall` already returns `{ ok: false, reason }`, where `reason` is the precise cause from `validateLocalSourcePath` ("path is not a directory" vs "path does not exist"). These three sites discard that `reason` and re-derive a less-specific, parallel string. The fourth entry point, `processUpdateForAll` (update.ts:303), instead consumes `prepared.reason` directly — so the four reinstall callers already disagree on how to render the same failure, which is exactly the copy-paste drift that re-authoring invites. This is a Rule-of-Three near-duplicate (three independent copies of one user-facing string) layered on top of an abstraction that already computes the better value.
  RECOMMENDATION: Have the three sites surface `prepared.reason` (the value the abstraction already returns), matching `processUpdateForAll`. If a uniform "Path ... does not exist or is not a directory" framing is intentionally wanted for these flows, lift it into a single shared helper beside `prepareReinstall` in src/clone-reinstall.ts (e.g. `localPathFailureMessage(key, reason)`) and call it from all three, so the wording cannot drift and the per-caller period inconsistency is removed.

SUMMARY: The implementation is already heavily consolidated (shared prepareReinstall, mapCloneFailure, failureMessage, buildAddEntry, memberKey, toComputeInput, copyUnit, and the mockClack/mockCopySafety test helpers). The only remaining cross-file duplication is one low-impact local-path validation string re-authored in three reinstall callers that already have the precise `reason` available from prepareReinstall. (Note: this is a known recurrence of the path-failure-message observation discarded in c7 and prior cycles as below-threshold.) Deliberately NOT flagged: tests/clone-reinstall.test.ts:6-19 inline clack-mock subset (only stubs spinner+log, below proportional extraction threshold).
