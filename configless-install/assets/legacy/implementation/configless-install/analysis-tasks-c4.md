---
topic: configless-install
cycle: 4
total_proposed: 2
---
# Analysis Tasks: Configless-Install (Cycle 4)

Discarded (with reasons): per-unit install-tail extraction [med] — hot-path refactor risk > value, sub-pieces already shared (buildManifestEntry/toComputeInput/copyUnit), paths legitimately diverge; forcePlugin-overload [med] — design clarity on a cycle-2-verified seam, edge case unrealizable (gated by memberHasAssetDirs), no current bug; check-failed exit divergence [low] — spec-unenumerated, already out-of-scope at 4-7, behaviour-changing; detectType standalone-invariant [low] — author-marked optional, benign/correct today.

## Task 1: Remove dead buildFailureMessage paralleling the centralised failureMessage
status: approved
severity: low
sources: duplication

**Problem**: buildFailureMessage (src/clone-reinstall.ts:199-212) hand-rolls a no-agents message plus a clone/copy/unknown passthrough — the exact dispatch that failureMessage (src/clone-reinstall.ts:184-197) already centralises via mapCloneFailure. It has no production caller (only tests/clone-reinstall.test.ts imports it). It is a parallel, unmaintained implementation that can silently drift. The same no-agents sentence ("Plugin ${key} no longer supports any of your installed agents") is also authored inline at clone-reinstall.ts:434 and update.ts:216.

**Solution**: Delete buildFailureMessage and its tests. Source the repeated no-agents sentence from a single shared constant/helper so the inline copies at clone-reinstall.ts:434 and update.ts:216 cannot drift.

**Outcome**: One message-derivation path (failureMessage + mapCloneFailure); no dead parallel implementation; the no-agents sentence has a single source of truth. No behaviour change.

**Do**:
1. Remove the buildFailureMessage function (src/clone-reinstall.ts:199-212).
2. Add a single exported helper for the no-agents message keyed by plugin key (e.g. noAgentsMessage(key) returning `Plugin ${key} no longer supports any of your installed agents`), co-located in src/clone-reinstall.ts.
3. Replace the inline no-agents sentence at clone-reinstall.ts:434 and update.ts:216 with calls to that helper. Verify failureMessage's onNoAgents arm (and mapCloneFailure's no-agents handler) also reads from the same helper so all three sources agree.
4. Remove the buildFailureMessage import and its describe("buildFailureMessage", ...) block from tests/clone-reinstall.test.ts. Ensure equivalent message assertions remain covered via failureMessage tests; add them if the deleted block was the only coverage.

**Acceptance Criteria**:
- buildFailureMessage no longer exists in the codebase and is not imported anywhere.
- The no-agents message string appears as a literal in exactly one place; clone-reinstall.ts:434, update.ts:216, and failureMessage all derive it from that single source.
- No production behaviour or emitted message text changes.
- Full test suite passes.

**Tests**:
- Existing failureMessage tests cover no-agents/clone-failed/copy-failed/unknown (migrate any unique assertions from the deleted buildFailureMessage block).
- A test asserting the no-agents helper returns the expected sentence for a given key.

## Task 2: Consolidate the symlink-escape scan-and-narrow block across the three install/replay sites
status: approved
severity: medium
sources: duplication

**Problem**: The "call scanForEscapingSymlinks, catch, narrow to SymlinkEscapeError, map to an outcome, rethrow otherwise" block is hand-authored three times: standalone add (src/commands/add.ts:313-321), collection-member add (src/commands/add.ts:593-607), and the update replay pipeline (src/nuke-reinstall-pipeline.ts:103-113). Each repeats the `if (err instanceof SymlinkEscapeError)` narrowing and the `throw err` fall-through, diverging only in how the violation is surfaced (cancel+ExitSignal / failed-result push+continue / blocked status). (Flagged low + discarded as borderline rule-of-three in cycle 3; now firmly at three sites.)

**Solution**: Extract a helper in src/copy-safety.ts that runs the scan and returns a discriminated `{ ok: true } | { ok: false; message: string }` instead of throwing. Each call site maps a value rather than re-authoring the try/catch + instanceof narrowing. Site-specific surfacing stays at the call site. Consolidation only — no behaviour change.

**Outcome**: The scan + SymlinkEscapeError-narrowing + rethrow logic lives in one place; the three callers each consume `{ ok }` and own only their distinct surfacing. Non-SymlinkEscapeError errors still propagate. No change to scan boundaries (clone root vs unit dir) or violation messages.

**Do**:
1. In src/copy-safety.ts, add a helper (e.g. checkEscapingSymlinks(unitDir, root): Promise<{ ok: true } | { ok: false; message: string }>) that calls scanForEscapingSymlinks(unitDir, root) inside a try/catch, returns { ok: false, message: err.message } for a SymlinkEscapeError, returns { ok: true } on success, and rethrows any other error.
2. Standalone add (add.ts:313-321): replace the try/catch with a call to the helper; on !ok, p.cancel(`${parsed.manifestKey}: ${result.message}`) and throw new ExitSignal(1) (preserve the identity prefix exactly).
3. Collection-member add (add.ts:593-607): replace with the helper; on !ok, push the { pluginName, status: "failed", copiedFiles: [], agents: [], errorMessage: result.message } result and continue (siblings unaffected, deferred non-zero exit unchanged).
4. Update replay (nuke-reinstall-pipeline.ts:103-113): replace with the helper; on !ok, return the existing blocked-status result with result.message.
5. Confirm each call site still passes the same scan target it passed before (standalone: unitDir, sourceDir; member: pluginDir, cloneRoot; pipeline: its existing args) — boundary semantics must not change.

**Acceptance Criteria**:
- A single helper in src/copy-safety.ts performs the scan + SymlinkEscapeError narrowing; the three call sites contain no instanceof SymlinkEscapeError check.
- Standalone violations still produce an identity-prefixed cancel and ExitSignal(1); member violations still push a failed result and continue without aborting siblings; pipeline violations still produce the blocked-status result.
- Non-SymlinkEscapeError errors still propagate from all three sites.
- Scan boundaries (clone root vs unit dir) are unchanged per site.
- Full test suite passes.

**Tests**:
- Helper unit tests: returns { ok: true } when no escaping symlink; returns { ok: false, message } for a SymlinkEscapeError; rethrows a non-SymlinkEscapeError.
- Existing integration tests for standalone add, collection-member add, and update replay covering the symlink-escape path still pass with identical surfacing (cancel+exit / failed-result+continue / blocked).
