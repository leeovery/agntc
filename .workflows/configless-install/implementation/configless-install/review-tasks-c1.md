---
scope: configless-install review remediation
cycle: 1
source: review
total_proposed: 2
gate_mode: gated
---
# Review Tasks: Configless Install (Cycle 1)

## Task 1: Add integration scenario exercising the update-time symlink-escape pipeline seam (blocked-before-nuke)
status: pending
severity: high
sources: report (Required Change #1), report-analysis-1-3

**Problem**: analysis-1-3's Do-item 4 requires the production update pipeline to abort before nuke on an escaping-symlink source — i.e. exercise `executeNukeAndReinstall` → `checkEscapingSymlinks` → `"blocked"` outcome (`src/nuke-reinstall-pipeline.ts:103-109`) on an existing recorded install. The shipped scenario at `tests/integration/workflows.test.ts:729-772` instead calls `scanForEscapingSymlinks` + `copyBareSkill` directly and asserts `SymlinkEscapeError` before copy. This verifies the underlying guard and the "before any copy" ordering, but does NOT exercise the `executeNukeAndReinstall` `"blocked"` seam nor the "aborts before nuke / install left intact" property on an existing recorded install — the integration-level proof this task was scoped to cover. (Severity low/contained: the pipeline blocked-before-nuke path is already unit-tested in `nuke-reinstall-pipeline.test.ts` / `clone-reinstall.test.ts` per task 5-4, and the full suite is green — this is an integration-completeness gap, not a functional defect.)

**Solution**: Add a new integration scenario in `tests/integration/workflows.test.ts` that records a real install plus its manifest entry, places an escaping symlink in the re-cloned source, drives the production `executeNukeAndReinstall` pipeline, and asserts the `"blocked"` outcome with the existing install left fully intact — mirroring the install-intact assertions used in the existing derive-before-delete abort scenario (d, :609-670).

**Outcome**: The escaping-symlink-on-update behaviour is proven end-to-end through the real pipeline seam: `status === "blocked"`, existing files still on disk, and the manifest entry unchanged. The integration suite covers the production `executeNukeAndReinstall` → `checkEscapingSymlinks` → `blocked` path, closing the analysis-1-3 coverage gap.

**Do**:
1. In `tests/integration/workflows.test.ts`, add a new scenario (alongside the existing copy-safety block near :729-784) using the same no-mocks approach: real drivers, real production functions, tmpdir isolation + cleanup, and the existing `readRawManifest` helper (:79-85) to read the manifest directly off disk.
2. Arrange a real recorded install: perform a genuine bare-skill (or plugin) install so real files land on disk and a real manifest entry exists for the key.
3. Re-clone / stage the source tree the pipeline will re-copy from, and place a symlink whose target lexically/really escapes the clone root (an absolute path like `/etc/...` or a `..`-escape above the clone root), matching the boundary=clone-root predicate.
4. Capture the on-disk file set and the raw manifest entry BEFORE invoking the pipeline.
5. Call the production `executeNukeAndReinstall` (the same entry point the `update` command uses) against the existing recorded install.
6. Assert `status === "blocked"` on the result.
7. Assert the existing install files are still present on disk (no nuke occurred).
8. Assert the manifest entry is unchanged from the pre-call snapshot (read via `readRawManifest`).
9. Keep the existing guard-level scenario (e) at :729-772, and rename its `describe` to distinguish the guard-level check from the pipeline-level `blocked` outcome (folds in idea #17 from report-analysis-1-3).

**Acceptance Criteria**:
- A new integration scenario drives the production `executeNukeAndReinstall` pipeline (not `scanForEscapingSymlinks`/`copyBareSkill` directly) on an existing recorded install with an escaping symlink in the re-cloned source.
- The scenario asserts `status === "blocked"`.
- The scenario asserts the existing install files remain on disk (no nuke before the block).
- The scenario asserts the manifest entry is unchanged (verified via `readRawManifest`).
- The pre-existing guard-level scenario at :729-772 is retained with a `describe` rename distinguishing guard-level from pipeline-level `blocked`.
- No mocks introduced (consistent with the surrounding no-mocks integration scenarios); `tsc --noEmit` clean; full suite passes.

**Tests**:
- The new scenario IS the test deliverable: real-install-then-escaping-symlink-update asserting `blocked` + install intact + manifest entry unchanged.
- Confirm the renamed guard-level scenario still asserts `SymlinkEscapeError` before copy.

## Task 2: Remove the orphaned, now-incorrect JSDoc block above isCloneReinstallFailure
status: pending
severity: medium
sources: report (Do-now #1), report-analysis-1-6, report-analysis-2-4, report-analysis-3-1

**Problem**: An orphaned JSDoc block at `src/clone-reinstall.ts:126-133` (the "Routes a non-success clone-reinstall result…" comment) documents `mapCloneFailure` but is physically detached above `isCloneReinstallFailure` (which has its own comment), while the real `mapCloneFailure` at :151 has no leading doc. Worse than a mis-placement: its content is now factually wrong — it lists symlink-escape under `aborted`, the exact conflation that analysis-3-1 eliminated when it gave update's symlink-escape its own `blocked` outcome distinct from the derive-before-delete `aborted` channel. The same stale orphan was independently flagged by three reviews (analysis-1-6, analysis-2-4, analysis-3-1), and analysis-3-1 confirms the correctness defect.

**Solution**: Delete the orphaned block and fold an accurate summary into `mapCloneFailure`'s own doc comment, correctly describing the status-dispatched outcomes.

**Outcome**: `src/clone-reinstall.ts` carries no detached/misattached comment; `mapCloneFailure` has an accurate leading doc that correctly distinguishes the three status-dispatched outcomes — `aborted` (derive-before-delete), `blocked` (symlink-escape copy-safety), and `no-agents` (lenient skip) — with no conflation of symlink-escape and `aborted`.

**Do**:
1. In `src/clone-reinstall.ts`, delete the orphaned JSDoc block at :126-133 that currently sits between `CloneReinstallFailure` / `isCloneReinstallFailure` and wrongly documents `mapCloneFailure`'s dispatch (including the incorrect symlink-escape-under-`aborted` framing).
2. Add an accurate leading doc comment immediately above `mapCloneFailure` (at ~:151) summarising the status-dispatched cases: `aborted` = derive-before-delete (install intact); `blocked` = symlink-escape copy-safety (install intact); `no-agents` = lenient skip (not a hard error); and the `failed` family refined on `failureReason` (clone-failed / copy-failed / unknown).
3. Leave `isCloneReinstallFailure`'s own existing comment intact.

**Acceptance Criteria**:
- The orphaned block at the former :126-133 location is removed.
- `mapCloneFailure` has a leading doc comment that correctly lists `aborted` (derive-before-delete), `blocked` (symlink-escape copy-safety), and `no-agents` (lenient skip), with NO statement conflating symlink-escape with `aborted`.
- `isCloneReinstallFailure` retains its own (unchanged) doc comment.
- No code/behaviour change; `tsc --noEmit` clean; full suite passes (documentation-only edit).

**Tests**:
- No new tests required (comment-only change). Verify via `tsc --noEmit` and the existing suite (`npm test`) that nothing regresses.
