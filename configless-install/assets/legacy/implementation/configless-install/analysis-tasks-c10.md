---
topic: configless-install
cycle: 10
total_proposed: 2
---
# Analysis Tasks: Configless Install (Cycle 10)

## Task 1: Treat empty re-cloned `agents` array as lenient default in `update`'s `resolveAgents`
status: approved
severity: medium
sources: standards

**Problem**: On `update`, `resolveAgents` (src/nuke-reinstall-pipeline.ts:256-269) special-cases only `configAgents === undefined` as the lenient "no restriction, keep recorded agents" branch. A re-cloned `agntc.json` of shape `{ agents: [], type: <string> }` produces a non-null config with a defined-but-empty `agents` array: `readConfig` (src/config.ts:57-58) returns `{ agents: [], type: rawType }` whenever `type` is a string but `agents` is empty or all-unknown. That empty `[]` flows past the `=== undefined` guard into `computeAgentChanges`, intersects the entry's recorded agents with the empty set, yields zero effective agents, and returns `{ status: "no-agents" }` (consumed at line 130-132) — surfacing "no longer supports any of your installed agents" and skipping the update. This diverges from the spec's Agent Selection "No valid constraint — unified across three cases" (specification.md ~lines 282-290), which makes "config present but `agents: []` (empty)" a lenient case: an invalid/unusable agents declaration carries no usable author intent and must be treated identically to no config at all, with no hard errors for config problems. The same `{ agents: [], type }` shape is already handled leniently on `add` (`config?.agents ?? []` → `[]` triggers the KNOWN_AGENTS default), so `add` and `update` are inconsistent.

**Solution**: In `resolveAgents`, treat an empty `configAgents` array the same as `undefined` — impose no restriction and keep the entry's recorded agents. This makes the empty/unusable-agents case lenient on `update`, restoring parity with `add` and conforming to the spec's unified "empty agents → no usable constraint → lenient default" rule. Crucially, this must NOT change the LEGITIMATE no-agents skip: a VALID NON-EMPTY config that genuinely excludes all of the user's installed agents must still produce `{ status: "no-agents" }` and skip the update.

**Outcome**: An `update` against a re-cloned `{ agents: [], type: "plugin" }` (or any `type`) config succeeds and preserves the entry's recorded agents, matching `add` behaviour for the same config shape and the spec's lenient empty-agents rule. A valid non-empty config that excludes all recorded agents still skips with the no-agents outcome. No other update behaviour changes.

**Do**:
1. In `src/nuke-reinstall-pipeline.ts`, change the guard in `resolveAgents` (currently lines 256-269) from `if (configAgents === undefined)` to also cover the empty-array case: `if (configAgents === undefined || configAgents.length === 0)`, returning `{ status: "ok", effectiveAgents: entryAgents, droppedAgents: [] }`.
2. Leave the subsequent non-empty path (`computeAgentChanges` → `effective.length === 0` → `{ status: "no-agents" }`) untouched, so a valid non-empty config that drops every recorded agent still yields the no-agents skip.
3. Update the `resolveAgents` doc comment (lines 251-255) to state that both a null/absent config AND a defined-but-empty `agents` array impose no restriction (recorded agents kept unchanged), and only a non-empty config narrows by intersection.

**Acceptance Criteria**:
- `resolveAgents(entryAgents, [])` returns `{ status: "ok", effectiveAgents: entryAgents, droppedAgents: [] }` (no restriction).
- `resolveAgents(entryAgents, undefined)` continues to return the recorded agents unchanged.
- A re-cloned config `{ agents: [], type: "plugin" }` produces an update SUCCESS preserving the recorded agents (status is the success/replay outcome, not `no-agents`).
- A valid non-empty config whose `agents` set is disjoint from the entry's recorded agents STILL yields `{ status: "no-agents" }` and the update skips.
- `add` behaviour for `{ agents: [], type }` is unchanged.

**Tests**:
- Pipeline test: re-cloned config `{ agents: [], type: "plugin" }` → `runPipeline`/nuke-reinstall succeeds preserving recorded agents (assert success outcome, recorded agents retained, NOT `no-agents`).
- Regression test: a valid non-empty config that excludes all recorded agents (e.g. recorded `["claude"]`, config `{ agents: ["codex"] }`) STILL yields `no-agents` and the update skips.
- Unit test on `resolveAgents`: `[]` argument → `{ status: "ok", effectiveAgents: entryAgents, droppedAgents: [] }`; `undefined` argument → same recorded-agents-preserved result.

## Task 2: Add path-traversal containment guard to `update`'s stored `sourceSubpath` join
status: approved
severity: low
sources: standards

**Problem**: On `add`, every source-supplied subpath is gated by `assertSubpathWithinClone` before its first use (src/commands/add.ts:276-287). On `update`, the recorded `entry.sourceSubpath` is joined directly to the clone — `join(tempDir, entry.sourceSubpath)` (src/clone-reinstall.ts:362-364) — with no equivalent lexical containment assertion before the pipeline reads at that path. The comment at src/nuke-reinstall-pipeline.ts:99-102 justifies relying solely on the symlink-escape scan because update "replays a recorded manifest key ... not a fresh source-supplied selector" — reasoning that held before cycle-9 introduced `sourceSubpath`, which is now a second source-derived path component fed into the join. Real exploitability is effectively nil today: the value is agntc-internally derived (`skills/<name>`, never `..`) and the symlink-escape scan still runs. But the add path's defense-in-depth lexical pre-check for the one source-derived path segment that now varies on update is no longer mirrored, breaking the Phase-5 copy-safety symmetry.

**Solution**: In the remote branch of `cloneAndReinstall`, call `assertSubpathWithinClone(tempDir, entry.sourceSubpath)` before the `join`, mirroring add's step-2c pre-flight. Apply only when `sourceSubpath` is present (the existing function is already a no-op for null/undefined/empty). This restores defense-in-depth parity for the varying source-derived segment with no behavioural change for valid manifests.

**Outcome**: A recorded `sourceSubpath` that lexically escapes the clone (e.g. `../evil`) is rejected with the containment error before any read at the joined path, matching add's pre-flight posture. Valid manifests (internally-derived `skills/<name>` and key-fallback entries) are unaffected — no behavioural change.

**Do**:
1. In `src/clone-reinstall.ts`, in the remote (clone) branch of `cloneAndReinstall`, immediately before the `const sourceDir = entry.sourceSubpath ? join(tempDir, entry.sourceSubpath) : getSourceDirFromKey(tempDir, key)` at lines 362-364, add a containment pre-check: when `entry.sourceSubpath` is present, call `assertSubpathWithinClone(tempDir, entry.sourceSubpath)` (already a no-op for null/undefined/empty).
2. Map a thrown `PathTraversalError` to the same kind of pre-flight abort/failure the surrounding code uses (consistent with the clone-failed/failure result shape returned in this branch), so a violating manifest fails cleanly rather than throwing unhandled. Mirror add's intent: surface a clear containment-error message; do not nuke or copy.
3. Import `assertSubpathWithinClone` (and `PathTraversalError` if needed for the catch) from `src/copy-safety.ts` if not already imported in this module.
4. Update the comment at src/nuke-reinstall-pipeline.ts:99-102 (or leave a note at the new guard site) noting that the `sourceSubpath` segment introduced in cycle-9 now also gets the lexical containment pre-check, so the symlink scan is no longer the sole update pre-flight for source-derived path components.

**Acceptance Criteria**:
- When `entry.sourceSubpath` lexically escapes the clone root (e.g. `../evil`), `cloneAndReinstall` rejects with the containment error BEFORE reading at the joined path — no nuke, no copy.
- When `entry.sourceSubpath` is absent (null/undefined/empty), behaviour is unchanged (key-derived fallback, no error).
- A valid internally-derived `sourceSubpath` (e.g. `skills/<name>`) passes the guard and reinstalls exactly as before.
- Distinct, self-contained from Task 1 — no shared edit.

**Tests**:
- Unit test: a manifest entry with `sourceSubpath = "../evil"` causes `cloneAndReinstall` to reject with the containment/path-traversal error and no file mutation.
- Regression test: a valid `sourceSubpath = "skills/<name>"` entry reinstalls successfully (guard is a no-op for contained subpaths).
- Regression test: an entry with no `sourceSubpath` still uses the key-derived dir and is unaffected.

## Discarded findings (noted, not proposed)

- duplication MEDIUM "four reinstall entry points repeat prepare→clone→failure→write spine" — partial recurrence of c1 Task 1 (entry-point consolidation already done); residual spine is behaviour-neutral, repeatedly deferred.
- duplication LOW "path-not-ok message re-authored" — KNOWN RECURRENCE (c7/c8/c9), below-threshold.
- duplication LOW "isLocal predicate recomputed" — KNOWN RECURRENCE (c9), below-threshold.
- duplication LOW "commit-shortening duplicated in summary.ts" — KNOWN RECURRENCE (c9), below-threshold.
- architecture LOW "direct-path-into-collection miskeys/mis-locates member" — finding itself states it is contrived/near-unreachable, a latent inconsistency not an active bug; below the action bar.
- architecture LOW "triplicated GitHub clone-URL fallback" — missed composition, string stable; below bar.
