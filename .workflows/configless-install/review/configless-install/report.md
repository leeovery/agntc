# Implementation Review: Configless Install

**Plan**: configless-install
**QA Verdict**: Request Changes

## Summary

A strong, spec-faithful implementation. All 43 tasks (25 plan tasks across 5 phases + 18 analysis-cycle tasks) are implemented; 42 verified Complete with zero blocking issues and one (analysis-1-3) with a single blocking finding that is a **test-coverage completeness gap, not a functional defect**. The governing posture — "missing info → lenient default; contradictory info → loud error" — is realised consistently: `readConfig` is fully lenient (no `ConfigError` path remains), structural detection is config-presence-independent with a single override layer, the `KNOWN_AGENTS` agent default replaces the `return []` footgun, manifest type lifecycle replays the recorded type with derive-before-delete validation, and the copy-safety guards (path-traversal + symlink-escape) run pre-flight before any mutation on both `add` and `update`. The high-severity spec-conformance bug surfaced mid-implementation (skills-only collection members silently skipped at install) was correctly fixed and is now covered by a genuine real-detection test that exercises the actual bug path. Build health is verified green: `tsc --noEmit` clean, **1487/1487 tests passing** across 66 files, source tree unchanged. The single required change is to make one integration scenario exercise the production update-time symlink-escape pipeline path (its behaviour is already unit-tested elsewhere). A recurring stale doc comment and a set of small test/quality tidy-ups round out the recommendations.

## QA Verification

### Specification Compliance

Implementation aligns with the specification across all sections verified per-task:

- **Config Model / leniency** — `readConfig` returns a usable `{agents, type?}` or `null`, never throws for config problems; type-only configs retained; `ConfigError` fully removed (the never-throws contract is now reflected in the type surface). Non-ENOENT IO errors still propagate raw.
- **Structural Type Detection** — single structural path; config presence is no longer a detection input; bare `SKILL.md` (the `refero_skill` shape) now installs; the two-level override (`--plugin` > config `type` > structure) resolves only the skills-only ambiguity; contradiction on an unambiguous structure is a pre-flight `TypeConflictError`, correctly attributed to flag vs config.
- **Agent Selection** — `KNOWN_AGENTS` default with detected pre-ticked, always-prompt, no auto-select in the no-constraint path; declared-single-detected auto-select preserved; `selectAgents` now returns a discriminated `cancelled | selected` result (removing the emit-then-overwrite message bug).
- **Collection Membership** — structural membership replaces the `agntc.json`-presence enumeration; per-member agent resolution; nested-collection one-level backstop; stray-root-`agntc.json` guarded; **skills-only members now install as plugin members** (the high-severity fix).
- **Manifest Keying & Lifecycle** — optional `type` field; persisted on standalone + per-member install; legacy backfill from local `files` (anti-drift); `update` replays recorded type with derive-before-delete validation; per-entry abort granularity with partial-success non-zero exit.
- **Copy-Safety** — path-traversal guard hoisted ahead of any read (analysis-1-2); symlink-escape pre-flight on `add` and `update` re-copy with clone-root boundary; update symlink-escape given its own `blocked` outcome distinct from derive-before-delete `aborted` (analysis-3-1).

No unjustified deviations. Several tasks landed in a "converged final state" (later analysis tasks refactored earlier code, e.g. `buildAddEntry`, `copyUnit`, `checkEscapingSymlinks`, `prepareReinstall`, the discriminated-`status` failure model) — each verified behaviour-preserving and an improvement on the literal task wording.

### Plan Completion

- [x] Phase 1–5 acceptance criteria met
- [x] Analysis cycle 1–5 task acceptance criteria met (42/43 fully; analysis-1-3 has one integration-coverage gap)
- [x] All 43 tasks implemented (43/43 in manifest `completed_tasks`)
- [x] No scope creep — source tree changes are confined to the planned modules; no unplanned features

### Code Quality

No blocking code-quality issues. Consistent project conventions throughout: discriminated unions with exhaustive dispatch, `Extract<DetectedType, …>` narrowing over runtime guards (the "missing a resolved type" runtime throw was made statically impossible and deleted), single-source helpers (`findPresentAssetDirs`, `buildManifestEntry`/`buildAddEntry`, `memberKey`, `copyUnit`/`toComputeInput`, `prepareReinstall`, `failureMessage`/`noAgentsMessage`, `checkEscapingSymlinks`, `isCloneReinstallFailure`). The copy-safety predicates are boundary-correct (`relative()`-based, not `startsWith`) and pure. One recurring non-blocking doc-staleness item (see Do-now #1).

### Test Quality

Tests adequately verify requirements and are well-balanced (behaviour-focused, not over-mocked; both arms of each branch exercised). The standout is the analysis-2-1 regression suite using a **real** skills-only member dir with `vi.importActual` detection — it genuinely fails against the pre-fix code. Build health independently verified: **tsc clean, 1487/1487 tests passing**. One genuine gap (Required Change #1) and a handful of small coverage/scaffolding tidy-ups (Quick-fixes).

### Required Changes

1. **analysis-1-3 — integration Do-item 4 tests the guard, not the production pipeline seam.** `tests/integration/workflows.test.ts:729-772` exercises the escaping-symlink case by calling `scanForEscapingSymlinks` + `copyBareSkill` directly and asserting `SymlinkEscapeError` before copy. The task's Do-item 4 requires the **pipeline** to abort before nuke — i.e. exercise `executeNukeAndReinstall` → `checkEscapingSymlinks` → `blocked` outcome (`src/nuke-reinstall-pipeline.ts:103-109`) on an *existing* recorded install, asserting `status === "blocked"`, existing files still on disk, and manifest entry unchanged (mirroring the derive-before-delete abort scenario's install-intact assertions). **Severity: low/contained** — the behaviour itself is already unit-tested (task 5-4, `nuke-reinstall-pipeline.test.ts` / `clone-reinstall.test.ts`) and the full suite is green; this is an integration-level completeness gap for the seam analysis-1-3 was scoped to cover. Add the missing scenario.

## Recommendations

### Do now

1. `src/clone-reinstall.ts:126-133` — remove the orphaned, now-stale JSDoc block (flagged independently by Reports analysis-1-6, analysis-2-4, analysis-3-1). It documents `mapCloneFailure` but sits above `isCloneReinstallFailure`, and its content is now wrong: it lists symlink-escape under `aborted`, the exact conflation analysis-3-1 eliminated. Delete it and fold an accurate summary into `mapCloneFailure`'s own doc — `aborted` (derive-before-delete), `blocked` (symlink-escape copy-safety), `no-agents` (lenient skip).
2. List-action test dead code (Report analysis-1-1):
   - `tests/commands/list-update-action.test.ts:136` and `tests/commands/list-change-version-action.test.ts:136` — remove the unused `INSTALLED_SHA` constant.
   - Same files — prune the unused `vi.mocked` handles (`mockCopyPluginAssets`, `mockRemoveEntry`).
3. `tests/integration/workflows.test.ts:597` — add the symmetric `expect("type" in before["owner/legacy-skill"]).toBe(false)` to match the (c) sanity assertion at :567 (Report analysis-1-3).
4. `src/nuke-reinstall-pipeline.ts:204-210` — update the `replayRecordedPlugin` JSDoc to reference the shared `findPresentAssetDirs` helper rather than describing the scan inline (Report analysis-1-4).
5. `tests/type-detection.test.ts:331-345` — fold a bare-skill message assertion into one throw test for symmetry with the member-count message test (Report 1-4).

### Quick-fixes

6. `tests/clone-reinstall.test.ts:418-442` — merge or differentiate the duplicate "aborted status" test, which is byte-equivalent in arrange + assertions to the preceding test at :391-416 (Reports analysis-1-6, 4-6).
7. Pin currently-implicit branch coverage with focused unit tests:
   - `tests/nuke-reinstall-pipeline.test.ts:144` — explicit `existingEntry.type` undefined → `?? "skill"` fallback path (Report 4-4).
   - `tests/commands/update.test.ts` (~2091/2554) — `replayRecordedPlugin` zero-asset-dirs → `aborted` (recordedType plugin, "no asset dir … remains" reason); currently only exercised via the all-updates suite (Report analysis-1-4).
   - `tests/copy-safety.test.ts:216` — fail-fast on the FIRST escaping symlink (valid inner link + later escaping link still rejects) (Report 5-2).
   - `tests/type-detection.test.ts:377` — explicit `configType: ""` ignored case (currently `'bundle'` stands in for all non-`'plugin'` values) (Report 1-4).
8. `src/commands/update.ts:586-607` — extract a single `status → {logLevel, countsAsFailure}` map so the per-plugin summary rendering and `hasFailedOutcome` (621-629) can't drift on a future outcome variant (Report 4-7).
9. `src/commands/update.ts:200`/`:294` — expose the computed `isLocal` on `PrepareReinstallResult` so callers read it instead of re-deriving `entry.commit === null` (Report analysis-1-1).
10. `tests/integration/workflows.test.ts:202-208` — remove the dead `pluginAIncoming` binding (pre-dates this work, same file) (Report analysis-1-3).

### Ideas

11. Error-message wording & framing consistency across the hard-error / not-found paths:
    - `src/commands/add.ts:284` — flag-attributed message double-states "cannot bundle" (wraps `err.message` which itself ends in it) (Report 2-2).
    - `src/commands/add.ts:282-285` — separator asymmetry between the flag-attributed (`{key}: …`) and config-attributed (`{key} declares …`) messages (Report analysis-2-6).
    - `src/commands/add.ts:487-491` — direct-path non-member throws a plain `Error` routed through the generic outer catch, unlike sibling pre-flight failures that emit an identity-prefixed `p.cancel` + `ExitSignal(1)` (Report 3-6).
    - `src/commands/update.ts:207` vs `list-update-action.ts:45` / `list-change-version-action.ts:96` — the "Path … does not exist or is not a directory" sentence is triplicated with a period inconsistency, and `prepareReinstall` already returns an unused structured `reason` (Report analysis-3-2).
12. `src/config.ts:75-81` — decide whether `filterKnownAgents` should warn on a non-string array entry (e.g. `agents:[123,"claude"]`), which is currently dropped silently while unknown strings warn (Report 1-1).
13. `src/init/scaffold-utils.ts:16` — a second `pathExists` clone of `src/fs-utils.ts:27` still exists; decide whether to collapse onto the single primitive or keep it intentionally module-local (Report analysis-1-5).
14. `src/copy-unit.ts:52` / `src/nuke-reinstall-pipeline.ts:233` — optionally route `replayRecordedPlugin`'s copy through `copyUnit` via a synthetic `{type:"plugin", assetDirs: presentAssetDirs}` unit, collapsing the last direct `copyPluginAssets` call mirroring `copyUnit`'s plugin arm (Report analysis-2-3).
15. `src/copy-safety.ts:88` — `scanForEscapingSymlinks` walks sibling directories sequentially; decide on parallelising descent or adding depth/file-count caps if large untrusted trees become a concern (spec defers size caps) (Report 5-2).
16. `src/commands/update.ts:531-568` — non-actionable category summaries are pushed into `outcomes` after the manifest-build loop; correct today, but a latent footgun if a future status needs manifest action. Consider building the full `outcomes` list up front, then running manifest-build/summary as pure consumers (Report 4-7).
17. `tests/integration/workflows.test.ts:729-772` — once Required Change #1 lands, rename this describe to distinguish the guard-level check from the pipeline-level `blocked` outcome (Report analysis-1-3).
18. `tests/commands/add.test.ts` (stray-root block) — optional direct assertion that `CollectionPipelineInput` carries no root-config field (currently verified behaviourally via test 3068) (Report 3-5).
19. `tests/type-detection.test.ts:202` — a combined "qualifying member kept AND nested-collection child skipped in one collection" fixture; the two paths are covered separately but not together (Report 1-3).
