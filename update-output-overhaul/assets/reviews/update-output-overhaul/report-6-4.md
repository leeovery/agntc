TASK: update-output-overhaul-6-4 — Remove dead git generality from the now-local-only update path (processUpdateForAll → processLocalUpdate)

ACCEPTANCE CRITERIA:
- processUpdateForAll no longer accepts `overrides` and no longer threads a synthetic `newRef`; the apologetic comment is gone.
- The local group-of-one update path produces the identical `refreshed` (local-update) outcome and summary as before.
- The git-update arm of `mapReinstallResultToOutcome` remains reachable and unchanged for the grouped path.
- Typecheck clean; full suite passes.

STATUS: Complete

SPEC CONTEXT:
Phase 6 (Analysis Cycle 2). After the Phase 1 group-first pivot, every git entry flows through streamGroupWork → processGroupUpdate. The sole remaining caller of the old processUpdateForAll is streamLocalWork, which passes a local entry (commit === null) and no overrides. The function was structurally mis-scoped: its `overrides?: VersionOverrides` param was dead (spread always `{}`), a local entry always takes the ref-free `refreshed` arm (git-update arm unreachable from this path), and an apologetic benign-lie comment laundered a fabricated `entry.ref` passed as `newRef`. Spec goal: narrow the function to exactly a local reinstall; keep the git-update generality only in the grouped path.

IMPLEMENTATION:
- Status: Implemented (matches acceptance criteria; optional rename also applied cleanly)
- Location: src/commands/update.ts:313-331 (processLocalUpdate), call site update.ts:816 (streamLocalWork); JSDoc-only touch-ups in src/update-groups.ts:87,126,153. Commit 3cbe378.
- Notes:
  - `overrides?: VersionOverrides` param removed from the function signature; the `prepareReinstall(key, entry, projectDir, { ...overrides })` call reduced to `prepareReinstall(key, entry, projectDir)`. Behaviorally identical: prepareReinstall's opts param defaults to `{}` (clone-reinstall.ts:55), and the old `{ ...overrides }` evaluated to `{}` when overrides was undefined (the only value the sole caller ever passed).
  - Fabricated `newRef` removed: now passes `null` to `mapReinstallResultToOutcome` (update.ts:327). Since a local entry has `commit === null`, mapReinstallResultToOutcome takes the `refreshed` arm (update-groups.ts:194-206), which never reads `newRef` — so the outcome and summary are unchanged. Choosing `null` over inlining the refreshed construction is the better of the two offered options: it keeps the shared failure-arm mapping (skipped-no-agents/copy-failed/aborted/blocked/failed) DRY rather than duplicating it.
  - Apologetic benign-lie comment deleted; replaced with a factual two-line comment stating the local entry always takes the ref-free refreshed arm.
  - Optional rename processUpdateForAll → processLocalUpdate applied; sole call site + three JSDoc references in update-groups.ts updated. No stale processUpdateForAll references remain anywhere in src/ or tests/.
  - VersionOverrides import (update.ts:61) is NOT orphaned — still used by runSinglePluginUpdate (update.ts:222, the single-key path).
  - Git-update arm of mapReinstallResultToOutcome (update-groups.ts:208-222) untouched; still reachable via reinstallMember (351) → processGroupUpdate (413). The commit changed only JSDoc comments in update-groups.ts, no executable logic.

TESTS:
- Status: Adequate
- Coverage:
  - All-mode local refreshed path (the exact function changed) is exercised by "local update summary includes dropped agent info in all-plugins mode" (tests/commands/update.test.ts:5048) — runs runUpdate() (no arg) → runAllUpdates → streamLocalWork → processLocalUpdate, and asserts the refreshed summary carries the dropped-agent notice. This locks the "identical refreshed outcome + summary" criterion.
  - The local bare-`failed` path (processLocalUpdate outer catch → renderOutcomeSummary at error level) is exercised by "renders a local `failed` red via p.log.error" (update.test.ts:6878+), whose comment was updated to name processLocalUpdate.
  - The grouped git-update arm stays exercised by the group-orchestrator tests elsewhere in the suite; unaffected because the arm's logic did not change.
- Notes: Pure dead-code removal producing byte-identical output correctly needs no new test — existing behavior-locking tests suffice. No over-testing: the only test-file change is a one-word comment reference update, no redundant assertions added.

CODE QUALITY:
- Project conventions: Followed. TypeScript is idiomatic; explicit `null` passed for the discriminating param.
- SOLID principles: Good. Single responsibility restored — the function now advertises exactly what it does (a local reinstall). The dead generality that misled the next editor is gone.
- Complexity: Low. Net simplification (fewer params, no spread, no fabricated value).
- Modern idioms: Yes.
- Readability: Good. The replacement comment is factual and accurate; the function name now matches its one real use.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None. Clean, minimal, behavior-preserving dead-code removal; all four acceptance criteria met and the grouped git-update path is left intact.
