# Implementation Review: Update Output Overhaul

**Plan**: update-output-overhaul
**QA Verdict**: Approve

## Summary

The feature is fully and correctly implemented. All 31 completed tasks across 8 phases pass independent verification with **zero blocking issues**; `tsc` is clean and the full suite is green at **1729 tests**. The three interlocking parts land as designed: (1) the structural clone/probe dedup pivot — group-first `runAllUpdates` grouping non-local entries by `(resolvedCloneUrl, versionIntent = constraint ?? ref)`, one resolve + one clone per group via `cloneRepoOnce` and a group orchestrator, with per-member categorization against the shared target, failure isolation, and per-group manifest persistence; (2) the two-granularity progress stream (group header + per-member outcome lines, trailing collapse to one line per group); and (3) the reword layers — tag-vs-hash version wording applied identically to both surfaces, and the actionable, mode-matched out-of-constraint footer. Security-sensitive constraints (the per-member `sourceSubpath` containment guard, now single-sourced via `resolveGuardedSourceDir`, and the `cloneRoot` copy-safety boundary) are preserved and cross-path regression-locked. Exit-code posture is unchanged and explicitly regression-tested across all nine ratified cells. Recommendations below are all non-blocking polish — no required changes.

## QA Verification

### Specification Compliance

Implementation aligns with the specification. Every observable acceptance criterion (spec §Testing & Acceptance 1–10) is met and directly tested:
- Group-first dedup: one clone + one probe per group; constrained group keyed on `constraint` (excludes the mutating `ref`) so a singly-updated member stays grouped and reports up-to-date while behind siblings update (genuine-state split preserved).
- Progress stream: per-member `✓ member → agents` under a group header carrying the shared version move; standalone/group-of-one collapse; divergent-old rule (target-only header + per-member parentheticals) implemented.
- Tag-vs-hash: rendered in tags only when both refs are semver tags **and** the ref moved, via a single `formatVersionMove` shared by single-key and all-mode; `clean()`-based `isVersionTag` closes the `v4`-branch and `v4.0.0`-branch-name traps.
- Trailing collapse: `up-to-date` / `newer-tags` / `check-failed` / `constrained-no-match` + out-of-constraint footer each collapse to one line per group (grouping key, Group-label disambiguated), never per bare repo.
- Failure model: clone-fatal → N `failed` outcomes (one enumerated grouped line, no manifest mutation, non-zero exit); check/resolve-fatal → N `check-failed` (all-mode exit 0); per-member reinstall failures isolated with today's remove-vs-intact semantics; shared clone torn down once in `finally`.
- Gating messaging: actionable footer names the **post-bump** current version, preserves the user's pinning mode (bare `npx agntc add owner/repo` for caret; `@<newest>` for exact-pin), exit stays 0. The naming-and-identity cross-cutting command wording binds correctly at both call sites.

Deviations found are all **intentional inter-phase evolution**, not drift: Phase-1/2 "interim" wording (hash-only moves, per-member enumerated check-failed lines) was superseded by later phases exactly as the seam-first build order prescribes, and the verifiers confirmed the final state.

### Plan Completion

- [x] Phase 1–8 acceptance criteria met (verified per task)
- [x] All completed tasks implemented and tested (31/31 `Complete`, 0 blocking)
- [x] No scope creep — the new modules `src/update-groups.ts` and `src/update-render.ts` are planned seams; `5-5` (bare-failed severity) was a legitimately-added analysis-cycle task
- [x] Deliberate scope decisions accounted for: **task 7-1 cancelled by explicit user decision** (commit `85e7e61`) — folding the never-downgrade guard into `categorizeMember` would break the intentional `hasNotableCategory` display coupling; the rule is already single-sourced in `version-resolve.ts`. Partial changes reverted to a green baseline. Not dropped scope.

### Code Quality

No issues found. The refactor cycles (Phases 5–8) measurably improved the surface: the `GroupTarget→(ref, commit)` projection is consolidated into one `groupTargetFacets` derivation; failure/skip member-line rendering is centralized in `failureOrSkipMemberLine`; `PluginOutcome` construction routes through `failedOutcome` / `isSuccessOutcome` (closing member.key drift); the containment guard is single-sourced in `resolveGuardedSourceDir`; and dead presentation residue was removed with byte-identical CLI output. Remaining notes are minor DRY/naming polish (below).

### Test Quality

Tests adequately verify requirements and are largely non-redundant. Coverage is strong on the hard cases — grouping key edge cases, genuine-state splits, clone/check fan-out, per-group persistence ordering, path-traversal rejection on both clone paths, the full exit-code matrix, and structural single-source guards (tests that feed a contradicting flag to prove neither side re-derives it). A handful of small gaps and two near-duplicate tests are captured as quick-fixes; none affects confidence in the verdict.

### Required Changes (if any)

None.

## Recommendations

### Do now

1. `tests/update-groups.test.ts` — test wording + assertion cleanups
   - Fix stale test title `effectiveRef` → `cloneRef` at line 459 to match the renamed field (Report 5-2)
   - Reword stale `effectiveCommit` comment → `facets.commit` at line 766 (Report 5-2)
   - Add `expect(mockCleanupTempDir).toHaveBeenCalledTimes(1)` to the all-success 3-member test (line 734) so single-cleanup is asserted on the happy path, not only the throwing path (Report 1-4)
2. `src/commands/update.ts` — naming + doc staleness
   - Reword the stale `(reverse-newest)` doc parenthetical at line 966 now that the value comes from `newestTag` (tail of the ascending list) (Report 5-4)
   - Rename `renderOutcomeSummary` → `renderFailedOutcome` (it now handles only the `failed` status) and update the three doc references at lines 745/883/1004 (Report 5-5)
3. `tests/commands/update.test.ts:3995,4044` — in the aborted/blocked exit cells, assert entry-intact positively (`...manifest["owner/repo-a"]).toBeDefined()`) alongside the existing not-removed check (Report 4-3)

### Quick-fixes

4. `src/update-groups.ts:237` — drop the orphaned `reason` field on the `cloneFailed: true` arm of `GroupUpdateResult` (and its lone unit assertion): production builds the enumerated line from member names and the per-member `failedOutcome` summary already embeds the reason, so the field is never read (Reports 1-7, 2-6)
5. `src/version-resolve.ts:61-62` / `src/update-render.ts:167` — extract a `shortHash(commit)` helper; the `commit.slice(0, 7)` convention is inlined in three places across two files (Report 2-2)
6. `src/commands/update.ts:889-895,859-866` / `src/update-render.ts:196-201` — consolidate the re-declared inline version-move object shape onto the existing exported `VersionMoveInput` (widen or add a non-null `oldCommit` variant to match these sites) (Report 2-4)
7. Test coverage gaps — add/consolidate targeted tests
   - Interleaved-members grouping test (two intents, non-contiguous members) exercising first-seen position + late accumulation (`tests/update-groups.test.ts:250`) (Report 1-1)
   - Within-group aborted/blocked-intact-during-a-triggered-write assertion (`tests/commands/update.test.ts:1068`) (Report 1-6)
   - Multi-member write-before-first-`p.log.success` ordering assertion, currently pinned only for group-of-one (`tests/commands/update.test.ts:1659`) (Report 2-4)
   - Collapsed-path × tag-target composition test for a single-member constrained all-mode update (`tests/commands/update.test.ts` ~1441) (Report 3-2)
   - Multi-group `newer-tags` integration test locking the disambiguated prefix + bare single-`@` command wiring (`tests/commands/update.test.ts` ~2059) (Report 5-1)
   - Consolidate the two near-identical `unknown -> def4567` null-old-commit tests (`tests/summary.test.ts:386,483`) (Report 3-2)
   - Differentiate the duplicated out-of-constraint test to cover the `label`-set (all-mode) prefix path vs the key-only fallback (`tests/summary-out-of-constraint.test.ts:13-27`) (Report 4-1)

### Ideas

8. `src/update-groups.ts` — type/robustness judgment calls
   - Harden `groupTargetFacets`' default arm (currently returns `commit: ""`, provably unreachable today) — throw on an unexpected kind so a mis-routed target surfaces loudly vs keep the documented benign no-op (lines 294-296) (Report 1-4)
   - Narrow `failedOutcome`'s return to `Extract<PluginOutcome, { status: "failed" }>` for symmetry with `isSuccessOutcome` — consistency-vs-precision call, no caller needs it today (line 133) (Report 6-2)
   - Decide the lazy-vs-eager `summary` on updated/refreshed outcomes: it is eagerly computed then discarded for multi-member members. Honour plan criterion "summary dropped or lazy" via a thunk, or amend the plan to record the intentional eager retention (lines 198,211). Zero observable impact either way (Report 6-3)
9. `src/commands/update.ts:773-775,795-801,908-912` — reconcile the intentionally-unshared bare-`failed` fallback (each caller renders it) with task 5-3's literal "defined once" AC: either return a shared `{ level: "error", text }` for `failed`, or record the AC premise as superseded (Report 5-3)
10. `tests/update-groups.test.ts:444-457` — decide whether to keep the branch clone-ref pin test (documentation value for AC2, leaning keep) or fold it into the branch `toStrictEqual` case it duplicates (Report 5-2)

### Bugs

11. `src/commands/update.ts:519-537` — `groupOutOfConstraintInfo` unconditionally reports `current: target.tag` for the collapsed footer, but on a **group clone failure** a behind (constrained-update-available) member never reaches `target.tag`, so the footer claims a post-bump current the run did not land on — contradicting `OutOfConstraintInfo.current`'s "landed on" contract (`summary.ts:326-331`). Extreme edge (constrained caret-boundary group, a behind member, whose single clone fails); the `current` field is Phase 4's, flagged for that owner. Derive the collapsed `current` from the group's actual post-run landed ref (fall back to the pre-bump ref on clone-failure) (Report 2-7)
