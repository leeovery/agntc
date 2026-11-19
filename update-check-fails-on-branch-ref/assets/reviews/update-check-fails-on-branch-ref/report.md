# Implementation Review: Update Check Fails On Branch Ref

**Plan**: update-check-fails-on-branch-ref
**QA Verdict**: Approve

## Summary

The bugfix cleanly replaces the lexical `isTagRef` (`/^v?\d/`) dispatch in `checkForUpdate` with a remote-truth classifier, resolving the whole class of branch refs that lexically resemble tags (`v4`, `v3`, `4`, `2024`) and the symmetric latent case (`release-1.0`-style tags misrouted to the branch path). All four tasks across both phases are implemented exactly to spec: a pure exact-path probe parser (1.1), the probe-then-route classifier with tag-first tiebreak, branch sha-reuse, 15s timeout and a terminal unified `check-failed` (1.2), additive cross-surface recovery tests on all three surfaces (1.3), and the analysis-cycle extraction of the shared `compareResolvedSha` helper (2.1). `isTagRef`, `checkBranch`, and both per-type "not found" strings are gone; untouched paths (`local`, `checkConstrained`, `checkHead`) and the out-of-scope `isVersionTag` gating in `list-detail.ts:133` are confirmed unchanged. The change is confined to `src/update-check.ts` plus tests. Independently verified: `tsc --noEmit` clean, full suite green (1565 passed, 68 files). No blocking issues.

## QA Verification

### Specification Compliance

Implementation aligns fully with the specification. Every spec acceptance criterion (1–7) maps to implemented behaviour and a focused test: branch-that-looks-like-a-tag (`v4`) → branch comparison, never `Tag 'v4' not found`; real tag (`v4.9.0`) → tag path unchanged; symmetric `release-1.0` → tag path; plain `main` → branch; both-present → tag (tiebreak, falls out of tag-first ordering); neither → terminal unified `check-failed`; probe error → `check-failed` carrying the underlying message. The `UpdateCheckResult` union is preserved (no new variants), no manifest/`refType` change, no `add`-side change, and the branch case reuses the probed head sha with no second `refs/heads` lookup (asserted at `tests/update-check.test.ts:214`). The `{ timeout: 15_000 }` module standard is used (asserted at `:408`), not `execGit`'s 30s default.

### Plan Completion

- [x] Phase 1 acceptance criteria met (remote-truth classification, dead-code removal, cross-surface recovery)
- [x] Phase 2 acceptance criteria met (`compareResolvedSha` extraction, behaviour-preserving)
- [x] All tasks completed (1.1, 1.2, 1.3, 2.1)
- [x] No scope creep — change confined to `src/update-check.ts` + tests; `list-detail.ts:133` gating and `git-utils.ts` untouched

### Code Quality

No issues found. `parseRefProbe` and `compareResolvedSha` are small, pure, correctly-placed module-private helpers matching the style of neighbouring `parseLsRemoteSha` / `parseTagRefs` / `findNewerTags`. `classifyAndCheck` reads as a clean three-way router (tag → `checkTag`, branch → helper, neither → `check-failed`), with comments documenting the tiebreak rationale and why `checkTag`'s not-found branch is now unreachable. Low complexity, modern idioms (discriminated-union returns, optional chaining, explicit types), no `any`. Network-cost target honoured: branch case = 1 round-trip (sha reused), tag case = probe + `--tags` = 2.

### Test Quality

Tests adequately verify requirements and are well-balanced (not over-tested). `parse-ref-probe.test.ts` has all 8 required cases one-to-one with acceptance criteria, including the exact-match regression guards (peeled `^{}`, prefix cross-match, slash-in-name, line-order independence). `update-check.test.ts` covers every AC plus the sha-reuse and probe-then-tags call-sequence assertions; the old `ref type detection` heuristic block and per-type not-found assertions were correctly retired in favour of remote-truth and the unified reason. `git-mocks.ts` routes per invocation on `--tags` (spec mock-harness note satisfied) with realistic payloads. Cross-surface tests (1.3) are purely additive — the three genuine `check-failed` guards remain intact and unchanged. The behaviour-preserving 2.1 extraction correctly added no tests, relying on transitive coverage of both helper branches from both call sites.

### Required Changes (if any)

None.

## Recommendations

### Do now

1. `tests/update-check-unconstrained-regression.test.ts:107-124` — tighten the branch-case assertion to the combined-probe shape (Report 1-2)
   - The branch test asserts args contain `refs/heads/develop` and not `--tags`; under the new combined probe the args also include `refs/tags/develop`. Optionally add `expect(args).toContain("refs/tags/develop")` so the test documents the combined-probe shape rather than reading as a single-ref lookup. Assertion-only, zero logic risk; the task only required this file to keep passing (it does).

### Ideas

2. `tests/update-check-all.test.ts:208` — reconsider the v4 regression-lock (Report 1-3)
   - "surfaces a real status (not check-failed) for a v4-branch entry" exercises the same pass-through path as the existing "returns single plugin check result" (line 29); because `checkForUpdate` is mocked and `checkAllForUpdates` never inspects `entry.ref`, the v4 flavour cannot cause a distinct failure. Kept as a documented regression-lock per the task. Decision only — the intent may be adequately served by the Task 1.2 unit tests plus the two `list-detail` v4 tests (which do exercise the ref). No action required.
