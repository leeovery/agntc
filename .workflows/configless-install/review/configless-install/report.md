# Implementation Review: Configless Install

**Plan**: configless-install
**QA Verdict**: Approve

## Summary

A strong, spec-faithful implementation, now complete across the full review surface. All **53 tasks** (25 plan tasks across 5 phases + 26 analysis-cycle tasks across cycles 1–11 + 2 Phase-11 review-remediation tasks) are implemented and verified **Complete with zero outstanding blocking issues**. The governing posture — "missing info → lenient default; contradictory info → loud error" — is realised consistently: `readConfig` is fully lenient (no `ConfigError` path remains), structural detection is config-presence-independent with a single override layer, the `KNOWN_AGENTS` agent default replaces the `return []` footgun, manifest type lifecycle replays the recorded type with derive-before-delete validation, and the copy-safety guards (path-traversal + symlink-escape) run pre-flight before any mutation on both `add` and `update`. The one blocking item from the prior review cycle — the missing integration scenario for the production update-time symlink-escape pipeline seam — was fixed in Phase 11 (review-1-1) and now drives `executeNukeAndReinstall` → `checkEscapingSymlinks` → `blocked` end-to-end with install-intact + manifest-unchanged assertions. The recurring stale `mapCloneFailure` JSDoc (review-1-2) was corrected. Analysis cycles 7–11 then hardened the feature on three real-defect fronts and consolidated test scaffolding: skills-only enumeration was made the flag-free default **and** made updatable end-to-end (persisted `sourceSubpath`), update's `resolveAgents` reached `add` parity on the lenient empty-agents case, the update source-derived subpath gained the same path-traversal pre-check as `add`, and six test files' copy-safety/clack mocks plus the two list-action harnesses were extracted to shared helpers. Build health independently re-verified green: `tsc --noEmit` clean, **1521/1521 tests passing** across 66 files, working tree clean.

## QA Verification

### Specification Compliance

Implementation aligns with the specification across all sections verified per-task:

- **Config Model / leniency** — `readConfig` returns a usable `{agents, type?}` or `null`, never throws for config problems; `ConfigError` fully removed. Update's `resolveAgents` now treats a re-cloned `{ agents: [], type }` (defined-but-empty) as the lenient no-restriction default, matching `add` and the spec's "No valid constraint — unified across three cases" (analysis-10-1).
- **Structural Type Detection** — single structural path; config presence is not a detection input; bare `SKILL.md` installs; `--plugin` > config `type` > structure resolves only the skills-only ambiguity; contradiction on an unambiguous structure is a pre-flight `TypeConflictError`. The skills-only flag-free default now **enumerates inner `skills/<name>` units as a collection menu** (analysis-8-1) — the Vercel-compatible anchor case, previously an empty menu.
- **Agent Selection** — `KNOWN_AGENTS` default, detected pre-ticked, always-prompt, no auto-select in the no-constraint path; declared-single-detected auto-select preserved; `selectAgents` returns a discriminated `cancelled | selected` result. The empty-agents leniency now holds on `update` as well as `add`.
- **Collection Membership & Lifecycle** — structural membership; per-member agent resolution; nested-collection one-level backstop; stray-root-`agntc.json` guarded. Skills-only members install as basename-keyed bare skills (`owner/repo/<name>`) **and update successfully** via the persisted optional `sourceSubpath` segment that relocates the member's true `skills/<name>` source on re-clone (analysis-9-1) — closing a regression introduced by the cycle-8 enumeration fix. The legacy pre-fix skills-only member is a loud, install-intact `aborted` (documented remove+add remedy), not a silent break.
- **Manifest Keying & Lifecycle** — optional `type` field; legacy backfill from local `files`; `update` replays recorded type with derive-before-delete; per-entry abort granularity with partial-success non-zero exit. New optional `sourceSubpath` field is backward-compatible (omitted when it equals the basename; legacy manifests still load).
- **Copy-Safety** — path-traversal guard ahead of any read on `add`; symlink-escape pre-flight on `add` and `update` re-copy with clone-root boundary; update symlink-escape has its own `blocked` outcome distinct from derive-before-delete `aborted`. The update path's source-derived `sourceSubpath` now gets the same lexical containment pre-check as `add`'s selector subpath (analysis-10-2), restoring Phase-5 symmetry.

No unjustified deviations. Later analysis tasks refactored earlier code (`resolveUpdateSourceDir` as a single shared rule, shared `copy-safety`/`clack`/list-action test harnesses) — each verified behaviour-preserving.

### Plan Completion

- [x] Phase 1–5 acceptance criteria met
- [x] Analysis cycle 1–11 + Phase-11 review-remediation task acceptance criteria met (53/53 fully)
- [x] All 53 tasks implemented (53/53 in manifest `completed_tasks`, 53/53 in `reviewed_tasks`)
- [x] No scope creep — changes confined to planned modules + their shared helpers; no unplanned features

### Code Quality

No blocking code-quality issues. Consistent project conventions throughout: discriminated unions with exhaustive dispatch, `Extract<DetectedType, …>` narrowing over runtime guards, single-source helpers (`findPresentAssetDirs`, `scanQualifyingChildDirs`, `buildManifestEntry`/`buildAddEntry`, `memberKey`/`memberSourceSubpath`, `copyUnit`, `resolveUpdateSourceDir`, `failureMessage`, `checkEscapingSymlinks`, `isCloneReinstallFailure`). Copy-safety predicates are boundary-correct (`relative()`-based) and pure. Test scaffolding consolidated into `tests/helpers/` (`copy-safety-mock.ts`, `clack-mock.ts`, `list-action-mocks.ts` + `list-action-mock-factories.ts`) with Vitest hoisting correctly respected.

### Test Quality

Tests adequately verify requirements and are well-balanced (behaviour-focused, both arms of each branch exercised). New end-to-end integration coverage closes the regressions that previously survived: skills-only member update success (case f), root-child fallback (case g), and the pipeline-level `blocked`-before-nuke seam (case e3). Build health independently verified: **tsc clean, 1521/1521 tests passing**. Remaining items are small coverage/scaffolding tidy-ups (Quick-fixes) and one stale test-helper type annotation (Bugs).

### Required Changes

None. (The prior cycle's single Required Change — the update-time symlink-escape integration seam — is resolved by review-1-1.)

## Recommendations

### Do now

1. `tests/integration/workflows.test.ts:597` — add the symmetric `expect("type" in before["owner/legacy-skill"]).toBe(false)` to match the (c) sanity assertion at :567 (Report analysis-1-3).
2. `src/nuke-reinstall-pipeline.ts` (`replayRecordedPlugin` JSDoc) — reference the shared `findPresentAssetDirs` helper rather than describing the scan inline (Report analysis-1-4).
3. `tests/type-detection.test.ts` — fold a bare-skill message assertion into one throw test for symmetry with the member-count message test (Report 1-4).

### Quick-fixes

4. `tests/clone-reinstall.test.ts` — merge or differentiate the duplicate "aborted status" test, byte-equivalent in arrange + assertions to the preceding test (Reports analysis-1-6, 4-6).
5. Pin currently-implicit branch coverage with focused unit tests:
   - `tests/nuke-reinstall-pipeline.test.ts` — explicit `existingEntry.type` undefined → `?? "skill"` fallback path (Report 4-4).
   - `tests/commands/update.test.ts` — `replayRecordedPlugin` zero-asset-dirs → `aborted` ("no asset dir … remains"); currently only via the all-updates suite (Report analysis-1-4).
   - `tests/copy-safety.test.ts` — fail-fast on the FIRST escaping symlink (valid inner link + later escaping link still rejects) (Report 5-2).
   - `tests/type-detection.test.ts` — explicit `configType: ""` ignored case (currently a non-`'plugin'` value stands in for all) (Report 1-4).
6. `src/commands/update.ts:586-607` — extract a single `status → {logLevel, countsAsFailure}` map so per-plugin summary rendering and `hasFailedOutcome` can't drift on a future outcome variant (Report 4-7).
7. `src/commands/update.ts:200`/`:294` — expose the computed `isLocal` on `PrepareReinstallResult` so callers read it instead of re-deriving `entry.commit === null` (Report analysis-1-1; re-confirmed open).
8. `tests/integration/workflows.test.ts:203` — remove the dead `pluginAIncoming` binding (pre-dates this work; re-confirmed open) (Report analysis-1-3).
9. `tests/commands/add.test.ts` — add a collection-install assertion that a skills-only member (segment `skills/<name>`) drives `runCollectionPipeline` and persists `sourceSubpath="skills/<name>"` while a root-child member omits it; the install-path wiring (`memberSourceSubpath` → `buildAddEntry`) is currently covered only at unit granularity and via the inline-entry integration test (Report analysis-9-1).
10. `tests/helpers/list-action-mocks.ts:32` — `INSTALLED_SHA` is exported (named in the harness ACs) but neither consumer imports it; either drop it or reference it where the files rely on `makeEntry()`'s inline `"a".repeat(40)` commit (Report analysis-11-2).

### Ideas

11. Error-message wording & framing consistency across the hard-error / not-found paths:
    - `src/commands/add.ts` — flag-attributed type-conflict message double-states "cannot bundle" (wraps `err.message` which itself ends in it) (Report 2-2).
    - `src/commands/add.ts` — separator asymmetry between flag-attributed (`{key}: …`) and config-attributed (`{key} declares …`) messages (Report analysis-2-6).
    - `src/commands/add.ts` — direct-path non-member throws a plain `Error` through the generic outer catch, unlike sibling pre-flight failures that emit an identity-prefixed `p.cancel` + `ExitSignal(1)` (Report 3-6).
    - `src/commands/update.ts` vs `list-update-action.ts` / `list-change-version-action.ts` — the "Path … does not exist or is not a directory" sentence is triplicated with period inconsistency; `prepareReinstall` already returns an unused structured `reason` (Report analysis-3-2).
12. `src/config.ts:75-81` — decide whether `filterKnownAgents` should warn on a non-string array entry (e.g. `agents:[123,"claude"]`), currently dropped silently while unknown strings warn (Report 1-1).
13. `src/init/scaffold-utils.ts:16` — a second `pathExists` clone of `src/fs-utils.ts:27` still exists; collapse onto the single primitive or keep it intentionally module-local (Report analysis-1-5; re-confirmed open).
14. `src/copy-unit.ts` / `src/nuke-reinstall-pipeline.ts` — optionally route `replayRecordedPlugin`'s copy through `copyUnit` via a synthetic `{type:"plugin", assetDirs: presentAssetDirs}` unit, collapsing the last direct `copyPluginAssets` call (Report analysis-2-3).
15. `src/copy-safety.ts` — `scanForEscapingSymlinks` walks sibling directories sequentially; decide on parallelising descent or adding depth/file-count caps if large untrusted trees become a concern (spec defers size caps) (Report 5-2).
16. `src/commands/update.ts:531-568` — non-actionable category summaries are pushed into `outcomes` after the manifest-build loop; correct today but a latent footgun if a future status needs manifest action. Consider building the full `outcomes` list up front, then running manifest-build/summary as pure consumers (Report 4-7).
17. `tests/commands/add.test.ts` (stray-root block) — optional direct assertion that `CollectionPipelineInput` carries no root-config field (currently verified behaviourally) (Report 3-5).
18. `tests/type-detection.test.ts` — a combined "qualifying member kept AND nested-collection child skipped in one collection" fixture; the two paths are covered separately but not together (Report 1-3).
19. `tests/integration/workflows.test.ts` — add a symmetric recorded-**plugin** variant of the (e3) pipeline-level `blocked`-before-nuke scenario; the pre-flight runs before type dispatch so this is defensive breadth, not an uncovered gap (Report review-1-1).

### Bugs

20. `tests/helpers/clack-mock.ts:23` — `spinner: Mock<[], SpinnerHandle>` uses the removed vitest-2 two-arg tuple-args generic form; vitest 3 (installed ^3.0.5) takes a single function-type arg, so the correct form is `Mock<() => SpinnerHandle>`. Currently invisible (tsconfig excludes `tests/`, vitest does not type-check), but a wrong annotation that would surface under any future test type-checking step (Report analysis-7-2).
