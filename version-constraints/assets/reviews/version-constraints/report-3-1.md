TASK: Constrained update check in update-check

ACCEPTANCE CRITERIA:
- Constrained entry with newer tag within bounds returns constrained-update-available with tag and commit
- Constrained entry where current ref is best within bounds returns constrained-up-to-date
- Constrained entry where no tags satisfy constraint returns constrained-no-match
- Out-of-constraint detected when absolute latest exceeds within-constraint best
- Pre-1.0 caret semantics work correctly (^0.2.3)
- Non-constrained entries completely unaffected

STATUS: Complete

SPEC CONTEXT: The spec defines a constrained update flow (section "Constrained Update Flow" and "Out-of-Constraint Detection"): when `constraint` is present in a manifest entry, fetch tags via ls-remote, resolve best match within constraint bounds via `semver.maxSatisfying`, compare against current ref. Same tag = up to date; newer tag = update available; no satisfying tag = error. Additionally, detect absolute latest stable tag and include it when it exceeds the within-constraint best.

IMPLEMENTATION:
- Status: Implemented
- Location: /Users/leeovery/Code/agntc/src/update-check.ts:6-19 (UpdateCheckResult type with constrained statuses), :52-54 (constraint routing guard in checkForUpdate), :147-195 (checkConstrained function), :147-152 (detectLatestOverall helper)
- Notes:
  - The `UpdateCheckResult` discriminated union correctly extends with three new constrained statuses: `constrained-update-available`, `constrained-up-to-date`, and `constrained-no-match`.
  - The `checkForUpdate` function correctly routes to `checkConstrained` when `entry.constraint !== undefined` (line 52), placed before the `isTagRef` heuristic check, preventing constrained entries from falling into the old tag logic.
  - `checkConstrained` fetches tags via `fetchRemoteTagRefs`, builds a tagCommitMap for SHA lookup, calls `resolveVersion` for within-constraint resolution, calls `detectLatestOverall` for out-of-constraint detection.
  - `detectLatestOverall` uses `resolveLatestVersion` (which is `resolveVersion("*", tags)`) and returns null when the absolute latest equals the best within-constraint tag, correctly omitting unnecessary out-of-constraint info.
  - Error handling wraps the entire function in try/catch returning `check-failed` status.
  - No drift from what was planned.

TESTS:
- Status: Adequate
- Coverage:
  - `/Users/leeovery/Code/agntc/tests/update-check-constrained.test.ts` (239 lines) covers:
    - constrained-update-available: newer tag within bounds (line 24-48)
    - constrained-update-available with latestOverall when absolute latest exceeds constraint best (line 50-74)
    - constrained-up-to-date: current ref is best within constraint (line 78-99)
    - constrained-up-to-date with latestOverall out-of-constraint detection (line 101-124)
    - constrained-no-match: no tags satisfy constraint (line 128-148)
    - Pre-1.0 caret semantics: ^0.2.3 correctly bounded to <0.3.0 (line 152-177)
    - Non-constrained entries unaffected: tag ref routes through old tag check (line 180-194), branch ref routes through old branch check (line 196-213)
    - Error handling: ls-remote failure returns check-failed (line 217-237)
  - `/Users/leeovery/Code/agntc/tests/update-check-unconstrained-regression.test.ts` (234 lines) provides thorough regression coverage:
    - Tag ref without constraint returns `newer-tags` not `constrained-update-available` (line 23-44)
    - Tag ref without constraint returns `up-to-date` not `constrained-up-to-date` (line 46-61)
    - Verifies `resolveVersion` and `resolveLatestVersion` are never called for non-constrained entries: tag (line 63-84), branch (line 126-143), HEAD (line 185-202), local (line 218-232)
    - Branch ref routes through refs/heads, not --tags (line 107-124)
    - HEAD-tracking routes through HEAD ref, not --tags (line 166-183)
  - Tests would fail if the feature broke (they test specific status values and payload shapes).
  - Edge cases from the plan are covered: no tags satisfy constraint, pre-1.0 caret, ls-remote failure.
  - The "current ref tag deleted from remote" edge case from the plan edge case column is implicitly handled: if the current tag is deleted, `resolveVersion` still resolves against available tags and would return a different (or same) best match, resulting in either update-available or no-match. This isn't explicitly tested but the behavior is correct by construction since the comparison is `best.tag === currentRef`.
  - The "all tags are pre-release" edge case is not explicitly tested (resolveLatestVersion with `*` would return null for all pre-release tags per semver spec, so latestOverall would be null). This is a minor gap but covered by the resolveVersion unit tests.

CODE QUALITY:
- Project conventions: Followed. Uses vitest, proper mocking patterns, shared test helpers (factories.ts, git-mocks.ts), discriminated union types for results.
- SOLID principles: Good.
  - Single responsibility: `checkConstrained` handles only the constrained path; `detectLatestOverall` is extracted as a focused helper.
  - Open/closed: The `UpdateCheckResult` union is extended additively without modifying existing variants.
  - Dependency inversion: Relies on `resolveVersion`/`resolveLatestVersion` abstractions from version-resolve.ts rather than calling semver directly.
- Complexity: Low. The `checkConstrained` function has a single linear flow with early returns. `detectLatestOverall` is a trivial 3-line helper.
- Modern idioms: Yes. Proper use of TypeScript discriminated unions, `Map` for tag-commit lookup, async/await with try/catch, optional chaining.
- Readability: Good. Function names clearly communicate intent. The routing logic in `checkForUpdate` (lines 46-64) reads top-to-bottom: local -> constrained -> head -> tag -> branch. The constraint check is positioned before the `isTagRef` heuristic, which is correct and clear.
- Issues: None found.

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- Could add an explicit test for the "all tags are pre-release" edge case mentioned in the plan (e.g., constraint `^1.0` with only `v1.0.0-beta.1` and `v2.0.0-alpha.1` tags), verifying `constrained-no-match` is returned and `latestOverall` is null. This is a very minor gap since pre-release exclusion is handled by the semver library and tested in the version-resolve unit tests.
- The `detectLatestOverall` helper is a module-private function. Its logic is simple and correct, but it could be slightly more explicit by naming the "same tag" check: the comparison `latest.tag === bestTag` works because both are original tag names (not cleaned versions). This is fine as-is but worth noting for maintainability.
