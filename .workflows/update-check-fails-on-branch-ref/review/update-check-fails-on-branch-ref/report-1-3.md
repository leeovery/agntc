TASK: 1.3 — Confirm cross-surface recovery for the v4-style branch ref (internal ID update-check-fails-on-branch-ref-1-3)

ACCEPTANCE CRITERIA:
1. `update v4-branch-key` with checkForUpdate → up-to-date exits 0 (no ExitSignal), shows up-to-date message, does NOT hit check-failed exit-1.
2. `update` (all) with a v4-branch entry resolving to a real status emits no check-failed/"failed" warning for that entry.
3. `checkAllForUpdates` surfaces the real status for a v4-branch entry (map value is real status, not check-failed).
4. `list` detail view for a v4-branch entry with a real updateStatus renders that status and its normal actions.
5. `list` "change version" NOT offered for ref:"v4" (isVersionTag("v4") === false) — confirmed unchanged, out of scope.
6. Genuine check-failed behaviours stay intact: update <key> still exits 1; update (all) still notes real check-failed; list still disables change version on check-failed.
7. Full test suite green; adds NO production code beyond Task 1.2; src/commands/list-detail.ts gating (~line 133) UNCHANGED.

STATUS: Complete

SPEC CONTEXT:
Spec Overview establishes severity-by-surface for the v4-branch bug: `update <key>` was a hard exit-1 error, `update` (all) a loud non-fatal check-failed warning, `list` a permanent "✗ check failed" column + degraded detail. Spec Acceptance Criteria → Cross-surface: an entry that previously showed `Check failed — Tag 'v4' not found on remote` now reports a real status on update <key> (exit 0), emits no check-failed warning in update (all), and renders a real status in list — BUT "change version" stays gated by isVersionTag(entry.ref), which is false for a branch ref like "v4", so the action remains correctly disabled (out of scope). Task 1.3 is verification-and-lock-in of this emergent recovery; classification itself is proven in Task 1.2. This task adds only tests.

IMPLEMENTATION:
- Status: Implemented (tests-only, as intended).
- Location: Commit 85135fc touches exactly three test files (+ workflow metadata .tick/tasks.jsonl, manifest.json): tests/commands/list-detail.test.ts (+2 tests), tests/commands/update.test.ts (+2 tests), tests/update-check-all.test.ts (+1 test). No production source changed. Verified via `git show --stat 85135fc`.
- src/commands/list-detail.ts line 132-133 gating `const canChangeVersion = isVersionTag(entry.ref) && updateStatus.status !== "check-failed";` is UNCHANGED — `git blame` attributes it to commit 00fb38d7 (2026-06-10), predating this work unit. Confirmed the out-of-scope constraint is honoured.
- isVersionTag("v4") === false confirmed: src/version-resolve.ts:30-32 returns `ref !== null && clean(ref) !== null`; semver `clean("v4")` is null (not full major.minor.patch), so the branch ref is correctly non-tag. The gating assumption is sound.
- Diff is purely additive (no `-` lines against existing test bodies) — no existing test was modified or weakened.

TESTS:
- Status: Adequate.
- Coverage per acceptance criterion:
  - AC1 → update.test.ts:759 "single-key update of a v4-branch entry that is up-to-date exits 0": makeEntry({ ref:"v4", commit:INSTALLED_SHA }), checkForUpdate→up-to-date; asserts err undefined (no ExitSignal), outro "nuxt/ui is already up to date.", no cloneSource, no log.error. Directly locks the "not exit-1" recovery. Non-vacuous: would fail if runUpdate threw or logged an error.
  - AC2 → update.test.ts:384 "all-plugins update emits no check-failed warning for a v4-branch entry resolving to a real status": scans warn/message/info for "failed"/"Failed", asserts false, asserts up-to-date outro. Deliberate contrast with the retained "notes check-failed plugins in summary" (line 358). Non-vacuous.
  - AC3 → update-check-all.test.ts:208 "surfaces a real status (not check-failed) for a v4-branch entry": asserts map value {status:"up-to-date"} and checkForUpdate called with (key, entry).
  - AC4 → list-detail.test.ts:499 "renders a real status for a v4-branch entry": ref:"v4" + update-available; asserts actions [update, remove, back] (real status, Update offered, no degraded rendering).
  - AC5 → list-detail.test.ts:522 "does NOT offer Change version for a v4-branch ref (isVersionTag false, out of scope)": ref:"v4" + up-to-date; asserts actions [remove, back] (no change-version). This one genuinely exercises isVersionTag on the real ref (renderDetailView is NOT mocked), so it is the most load-bearing of the new tests.
  - AC6 (genuine check-failed intact) → all three original guards retained UNCHANGED: update.test.ts:780 single-key check-failed exits 1 (makeEntry default ref, not v4); update.test.ts:358 all-plugins notes check-failed; list-detail.test.ts:451 "does NOT offer Change version when check-failed". Confirmed additive-only diff leaves these intact.
- Would tests fail if the feature broke: Yes for the surface behaviours they assert (up-to-date handling, no failed-warning, action lists, gating). The list-detail v4 tests additionally fail if isVersionTag gating regressed.
- Over-tested note (non-blocking): Because update.test.ts and update-check-all.test.ts mock checkForUpdate, the `ref:"v4"` field is not causally exercised there — those surfaces branch on the returned status, not on entry.ref. update-check-all.test.ts:208 in particular is functionally a duplicate of the existing "returns single plugin check result" (line 29): checkAllForUpdates is a pass-through that never inspects ref, so the two cannot diverge. It adds value only as a named, documented regression-lock for the reported exemplar — which the task explicitly requested ("add a branch-ref case … assert the map value is up-to-date"). Acceptable and intentional; not redundant enough to remove.

CODE QUALITY:
- Project conventions: Followed. Tests use the established vitest patterns, module mocks, makeEntry/makeFakeDriver factories, and describe/it structure consistent with the surrounding files. No new helpers introduced where existing ones suffice.
- SOLID / DRY: N/A (test-only). No production abstraction added or duplicated.
- Complexity: Low. Each new test is a flat arrange-act-assert.
- Modern idioms: Consistent async/await, `.catch(e => e)` ExitSignal capture matching sibling tests.
- Readability: Good. Every new test carries an intent comment explaining the cross-surface recovery and (for AC5) why the gate stays disabled. Clear naming.
- Security/Performance: N/A.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [idea] tests/update-check-all.test.ts:208 — "surfaces a real status (not check-failed) for a v4-branch entry" exercises the same pass-through path as the existing "returns single plugin check result" (line 29); because checkForUpdate is mocked and checkAllForUpdates never inspects entry.ref, the v4 flavour cannot cause a distinct failure. Kept as a documented regression-lock per the task; consider whether the intent is better served solely by the Task 1.2 unit tests plus the two list-detail v4 tests (which do exercise the ref). No action required — decision only.
