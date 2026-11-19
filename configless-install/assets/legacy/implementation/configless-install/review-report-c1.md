---
scope: configless-install review remediation
cycle: 1
source: review
total_findings: 19
deduplicated_findings: 14
proposed_tasks: 2
---
# Review Report: Configless Install (Cycle 1)

## Summary
The review verdict is Request Changes with a single blocking finding — an integration-coverage gap in analysis-1-3, where the escaping-symlink scenario tests the guard directly instead of the production `executeNukeAndReinstall` → `blocked` pipeline seam it was scoped to cover (behaviour itself is already unit-tested; suite is green at 1487/1487). Beyond that, one non-blocking note clusters across three independent reviews (analysis-1-6, analysis-2-4, analysis-3-1): an orphaned, now-incorrect JSDoc block at `src/clone-reinstall.ts:126-133` that conflates symlink-escape with `aborted`. The remaining recommendations are isolated low-value tidy-ups (test dead-code, symmetric assertions, branch-coverage pinning, wording/refactor ideas) and are discarded per the severity/clustering filter.

## Discarded Findings
- List-action test dead code (report-analysis-1-1) — isolated low-value: unused `INSTALLED_SHA` constant and unused `vi.mocked` handles in two list-action test files; cosmetic, no behaviour impact.
- Symmetric `"type" in before` assertion at workflows.test.ts:597 (report-analysis-1-3) — isolated low-value test symmetry tweak; the backfill round-trip is already proven via raw read-then-write.
- `replayRecordedPlugin` JSDoc helper reference at nuke-reinstall-pipeline.ts:204-210 (report-analysis-1-4) — isolated doc-accuracy nit, no functional impact.
- Bare-skill message assertion fold-in at type-detection.test.ts:331-345 (report-1-4) — isolated test-symmetry tidy-up.
- Duplicate "aborted status" test at clone-reinstall.test.ts:418-442 (reports analysis-1-6, 4-6) — isolated test duplication; harmless, suite green. (Note: the do-now JSDoc item co-flagged in these same reports IS retained as Task 2.)
- Branch-coverage pinning unit tests (reports 4-4, analysis-1-4, 5-2, 1-4) — implicit branches already exercised via higher-level suites; net-new explicit tests, not remediation of a defect.
- Update summary status-map extraction at update.ts:586-607 (report 4-7) — refactor/footgun-prevention idea, not a found defect.
- Expose `isLocal` on `PrepareReinstallResult` at update.ts:200/:294 (report analysis-1-1) — refactor idea (avoid re-deriving `entry.commit === null`); no defect.
- Dead `pluginAIncoming` binding at workflows.test.ts:202-208 (report analysis-1-3) — pre-dates this work; isolated dead-code nit.
- Error-message wording/framing consistency cluster (reports 2-2, analysis-2-6, 3-6, analysis-3-2) — ideas-tagged framing/wording polish across add.ts/update.ts; cosmetic, no behavioural defect, spec defers exact wording to implementer judgement.
- `filterKnownAgents` non-string-entry warning at config.ts:75-81 (report 1-1) — open design question (warn vs silent drop), not a found defect; current behaviour is spec-lenient.
- Second `pathExists` clone at init/scaffold-utils.ts:16 (report analysis-1-5) — open DRY decision, intentionally may stay module-local; no defect.
- Route `replayRecordedPlugin` copy through `copyUnit` (report analysis-2-3) — optional refactor idea; current direct call is correct.
- `scanForEscapingSymlinks` parallelisation / depth caps at copy-safety.ts:88 (report 5-2) — spec explicitly defers size/depth caps; out of scope.
- Build full `outcomes` list up front at update.ts:531-568 (report 4-7) — latent-footgun refactor idea; correct today.
- Rename guard-level describe at workflows.test.ts:729-772 (report analysis-1-3, idea #17) — folded into Task 1 acceptance (rename once the pipeline scenario lands); not a standalone task.
- `CollectionPipelineInput` no-root-config direct assertion (report 3-5) — already verified behaviourally; optional belt-and-braces test.
- Combined member-kept-AND-nested-skipped fixture at type-detection.test.ts:202 (report 1-3) — both paths covered separately; optional combined fixture.
