---
topic: update-check-fails-on-branch-ref
cycle: 1
total_proposed: 1
---
# Analysis Tasks: update-check-fails-on-branch-ref (Cycle 1)

## Task 1: Extract the resolved-sha comparison helper shared by checkHead and the branch path
status: pending
severity: low
sources: duplication, architecture

**Problem**: The single "is a resolved remote sha ahead of the installed commit?" rule is now authored in two places in `src/update-check.ts`. The new branch arm of `classifyAndCheck` (lines 129-134) reproduces, byte-identical in shape, the comparison already living in `checkHead` (lines 154-157): both take a remote sha plus an installed commit and produce the same `up-to-date` / `update-available` result, differing only in a local variable name (`headSha` vs `remoteSha`). This is the exact logic the removed `checkBranch` used to hold; folding it into `classifyAndCheck` carried the comparison across a task boundary rather than sharing it. The two copies must now stay in lockstep — e.g. if the `update-available` variant ever gains a field — and `classifyAndCheck` ends up owning a comparison inline while delegating the tag path to `checkTag`, breaking the symmetry of an otherwise one-line router. Both the duplication and architecture agents independently flagged this same duplication.

**Solution**: Introduce one small pure helper in `src/update-check.ts` that maps a resolved remote sha and the installed commit onto the shared `UpdateCheckResult`, and route both call sites through it. This is confined entirely to the bugfix's own file — no change to `git-utils.ts`, the `UpdateCheckResult` union, or any consuming surface.

**Outcome**: The resolved-sha "am I current?" decision is defined exactly once. `classifyAndCheck` reads as a clean three-way router (tag -> `checkTag`, branch -> helper, neither -> `check-failed`), restoring symmetry with the delegated tag path, and `checkHead` returns through the same helper. Behaviour is unchanged and all existing update-check tests still pass.

**Do**:
1. In `src/update-check.ts`, add a private pure helper, e.g.:
   ```ts
   function compareResolvedSha(
   	remoteSha: string,
   	installedCommit: string,
   ): UpdateCheckResult {
   	if (remoteSha === installedCommit) {
   		return { status: "up-to-date" };
   	}
   	return { status: "update-available", remoteCommit: remoteSha };
   }
   ```
   Place it near the other module-private helpers (e.g. beside `parseLsRemoteSha` / `findNewerTags`).
2. In the branch arm of `classifyAndCheck` (currently lines 129-134), replace the inline `if (headSha === installedCommit) { return { status: "up-to-date" }; } return { status: "update-available", remoteCommit: headSha };` with `return compareResolvedSha(headSha, installedCommit);`. Leave the enclosing `if (headSha !== null)` guard, the `tagSha` routing above it, and the trailing `check-failed` (not-found) return exactly as they are.
3. In `checkHead` (currently lines 154-157), after the existing `remoteSha === null` guard, replace the inline `if (remoteSha === installedCommit) { ... } return { status: "update-available", remoteCommit: remoteSha };` with `return compareResolvedSha(remoteSha, installedCommit);`. Leave the `ls-remote HEAD` call, the "No HEAD ref found on remote" guard, and the surrounding `try/catch` untouched.
4. Do not export the helper unless a direct unit test is added for it (see Tests) — keep it private if coverage through the existing call-site tests is preferred, matching the visibility of the neighbouring `parseLsRemoteSha`.
5. Run `npm test` and confirm the suite is green.

**Acceptance Criteria**:
- A single helper in `src/update-check.ts` produces the `up-to-date` / `update-available` decision from a resolved remote sha and the installed commit; no other function contains that inline comparison.
- Both the branch arm of `classifyAndCheck` and `checkHead` return through the helper.
- No change to the `UpdateCheckResult` union, `git-utils.ts`, or any consuming command surface (update single/all, list-detail).
- The both-present tiebreak (tag routing before the branch comparison), the sha-reuse guarantee (branch issues no second lookup), and the unified `Ref '{ref}' not found on remote as a branch or tag` reason are all unchanged.
- `npm test` passes.

**Tests**:
- All existing `update-check.test.ts` cases continue to pass unchanged — in particular the branch `up-to-date` (remote head == installed commit), branch `update-available` (remote head != installed commit), and the HEAD `up-to-date` / `update-available` cases, since these now exercise the shared helper.
- Optional: if the helper is exported, add a focused unit test asserting `compareResolvedSha(sha, sha)` returns `{ status: "up-to-date" }` and `compareResolvedSha(a, b)` (a != b) returns `{ status: "update-available", remoteCommit: a }`. If kept private, rely on the existing call-site coverage rather than adding an export solely for the test.
