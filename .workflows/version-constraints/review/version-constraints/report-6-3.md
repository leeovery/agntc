TASK: Add fetchRemoteTagRefs to git-utils.ts to expose full TagRef data

ACCEPTANCE CRITERIA:
- fetchRemoteTagRefs is exported from git-utils.ts
- fetchRemoteTags delegates to fetchRemoteTagRefs
- update-check.ts no longer calls execGit directly for tag fetching
- All existing tests pass unchanged

STATUS: Complete

SPEC CONTEXT: The specification requires tag fetching for constrained update resolution (ls-remote + semver matching). Both checkConstrained and checkTag need full TagRef data (tag name + SHA) from ls-remote. Previously they called execGit + parseTagRefs directly, bypassing the public API. This task consolidates tag fetching into a single public entry point.

IMPLEMENTATION:
- Status: Implemented
- Location: src/git-utils.ts:49-54 (fetchRemoteTagRefs), src/git-utils.ts:56-59 (fetchRemoteTags delegation)
- Notes:
  - fetchRemoteTagRefs is exported at line 49, calls execGit(["ls-remote", "--tags", url]) with 15s timeout, returns parseTagRefs(stdout) -- clean composition of IO + parsing.
  - fetchRemoteTags at line 56-59 delegates to fetchRemoteTagRefs and maps to tag names only: `const refs = await fetchRemoteTagRefs(url); return refs.map((r) => r.tag);`
  - update-check.ts imports fetchRemoteTagRefs at line 1 and uses it in:
    - checkTag (line 126): `const allTagRefs = await fetchRemoteTagRefs(url);` then derives `allTags` via `.map(r => r.tag)`
    - checkConstrained (line 160): `const parsed = await fetchRemoteTagRefs(url);` then builds tagCommitMap and tags array from the result
  - execGit is still imported in update-check.ts but only used for non-tag operations: checkHead (line 72, ls-remote HEAD) and checkBranch (line 97, ls-remote refs/heads/). No execGit calls exist for tag fetching.
  - parseTagRefs is not imported in update-check.ts -- all tag parsing goes through fetchRemoteTagRefs.

TESTS:
- Status: Adequate
- Coverage:
  - tests/git-utils.test.ts:139-196: 4 tests for fetchRemoteTagRefs covering happy path (returns full TagRef objects), ^{} filtering, empty output, and correct git args verification
  - tests/git-utils.test.ts:198-248: 4 tests for fetchRemoteTags confirming delegation works (same scenarios produce tag-name-only output)
  - tests/parse-tag-refs.test.ts: 6 tests for the underlying parseTagRefs function (edge cases: empty, whitespace, trailing newlines, mixed empty lines)
  - tests/update-check.test.ts:228-325: tag tracking tests verify checkTag path works through fetchRemoteTagRefs (ls-remote --tags call verified at line 275-279)
  - tests/update-check-constrained.test.ts: 7 tests for constrained update checks exercising the full path through fetchRemoteTagRefs with SHA data used for commit resolution
- Notes: Test coverage is well-balanced. The tests verify behavior at multiple layers (unit for parseTagRefs, integration for fetchRemoteTagRefs/fetchRemoteTags, and end-to-end for update-check paths). No over-testing -- each test verifies a distinct behavior or edge case.

CODE QUALITY:
- Project conventions: Followed -- consistent with existing patterns in git-utils.ts (async wrapper over execGit, typed return)
- SOLID principles: Good -- fetchRemoteTagRefs has a single responsibility (fetch + parse remote tags). fetchRemoteTags composes on top without duplication. Open for extension (callers choose the level of detail they need).
- Complexity: Low -- fetchRemoteTagRefs is 3 lines of straightforward async composition. fetchRemoteTags is a 2-line delegation.
- Modern idioms: Yes -- async/await, typed interfaces, clean map operations
- Readability: Good -- function names clearly communicate intent (fetchRemoteTagRefs returns TagRef[], fetchRemoteTags returns string[])
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- The execGit import in update-check.ts could be narrowed (only used by checkHead and checkBranch, not tag operations), but this is purely stylistic and does not affect correctness. The acceptance criterion "no longer calls execGit directly for tag fetching" is met -- the remaining execGit uses are for HEAD and branch ref lookups.
