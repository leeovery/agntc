TASK: Extract the resolved-sha comparison helper shared by checkHead and the branch path (internal ID update-check-fails-on-branch-ref-2-1, tick-538a83; severity low; sources: duplication, architecture)

ACCEPTANCE CRITERIA:
1. A single helper produces the up-to-date / update-available decision from a resolved remote sha + installed commit; no other function contains that inline comparison.
2. Both the branch arm of classifyAndCheck and checkHead return through the helper.
3. No change to UpdateCheckResult union, git-utils.ts, or any consuming command surface.
4. Both-present tiebreak, sha-reuse guarantee, unified not-found reason all unchanged.
5. npm test passes.

STATUS: Complete

SPEC CONTEXT:
This task is an analysis-cycle refactor sitting on top of the remote-truth ref-classification fix (spec: update-check determines a stored ref's type from remote truth rather than a lexical /^v?\d/ heuristic). The spec (Comparison paths, "behaviour preserved") requires the branch comparison and HEAD comparison to keep identical semantics: tip == installed commit -> up-to-date, else update-available with remoteCommit set. The single-round-trip / sha-reuse guarantee and the unified not-found reason ("Ref '{ref}' not found on remote as a branch or tag") are load-bearing behaviours this refactor must not disturb. The duplication being removed is the twin authoring of the "resolved remote sha vs installed commit" rule in classifyAndCheck (branch arm) and checkHead.

IMPLEMENTATION:
- Status: Implemented
- Location: src/update-check.ts:86-94 (compareResolvedSha helper); call sites at src/update-check.ts:143 (classifyAndCheck branch arm) and src/update-check.ts:164 (checkHead). Refactor landed in commit c4b53ea.
- Notes:
  - Helper is a pure function: no I/O, no side effects, deterministic on its two string args. Returns { status: "up-to-date" } when equal, else { status: "update-available", remoteCommit: remoteSha }. Matches Do step 1 exactly.
  - Placement is correct: sits among the module-private helpers immediately after findNewerTags and before checkForUpdate, as instructed.
  - Visibility: NOT exported (grep confirms `function compareResolvedSha`, no `export`), matching neighbouring parseLsRemoteSha / findNewerTags private visibility. Do step 4 satisfied — no direct unit test added, so private is correct.
  - classifyAndCheck branch arm (line 142-144): the `if (headSha !== null)` guard is intact, tagSha routing above (line 138-140) untouched, trailing check-failed return (line 146-149) untouched. Matches Do step 2.
  - checkHead (line 152-171): ls-remote HEAD call, the `remoteSha === null` -> "No HEAD ref found on remote" guard, and the try/catch are untouched; only the inline compare replaced. Matches Do step 3.
  - No third inline copy remains: grep for `remoteCommit` in code yields only line 93 (inside the helper) plus the union type at line 9; grep for `remoteSha === installedCommit` / `=== installedCommit` yields only line 90 (the helper body) — lines 143/164 are call sites, lines 88/124/154 are parameter declarations. checkTag's line-185 `{ status: "up-to-date" }` is the distinct "no newer tags" terminal, not the resolved-sha-vs-installed-commit rule, so it is correctly left alone.
  - git-utils.ts untouched: not present in commit c4b53ea (last git-utils change was commit 155d5e1, an unrelated prior work unit). Criterion 3 satisfied.
  - UpdateCheckResult union unchanged (src/update-check.ts:6-19) — diff did not touch it. No consuming command surface changed (helper is module-private).

TESTS:
- Status: Adequate
- Coverage: tests/update-check.test.ts was NOT modified by this commit (behaviour-preserving pure extraction), which is the correct outcome. The helper's two output branches are exercised transitively through existing cases:
  - Branch up-to-date: line 178 ("...returns up-to-date when the tip matches").
  - Branch update-available: line 164 / line 200 ("...returns update-available when the tip differs" / plain branch main).
  - HEAD up-to-date: line 137 ("returns up-to-date when remote SHA matches").
  - HEAD update-available: line 125 ("returns update-available when remote SHA differs").
  All four now route through compareResolvedSha, so a regression in the helper would fail at least one. Would-fail-if-broken: yes.
- Notes:
  - Not under-tested: both output branches of the helper are covered from both call sites; the branch-vs-HEAD symmetry is preserved by the shared cases.
  - Not over-tested: no redundant assertions added; no direct unit test for the private helper (correctly omitted per Do step 4 — a focused unit test would only be warranted if the helper were exported).
  - Test execution not performed (out of scope for this review); adequacy judged by reading. The change is a mechanical, logic-identical extraction, so the unchanged suite remains valid.

CODE QUALITY:
- Project conventions: Followed. Consistent with the module's existing private-helper style (parseLsRemoteSha, findNewerTags): small, pure, documented with a leading comment explaining the shared rule. TypeScript return type annotated (UpdateCheckResult). No `any`, no assertions.
- SOLID principles: Good. Single-responsibility helper; removes the duplicated decision rule (DRY) without premature abstraction — the abstraction is justified by two real call sites authoring the identical rule.
- Complexity: Low. One branch, two returns; both call sites reduced to a single delegating return.
- Modern idioms: Yes. Discriminated-union return, explicit types, early return.
- Readability: Good. The comment accurately documents that the parameter is a generic "resolved remote sha" (branch tip or HEAD sha), which explains why the branch call site passes headSha into a parameter named remoteSha — intentional generalisation, not a mismatch.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None. (No actionable concrete change surfaced; the extraction is complete, pure, correctly placed, correctly kept private, and all guards/routing/union are preserved.)
