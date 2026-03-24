TASK: Consolidate ls-remote tag parsing into a single shared function

ACCEPTANCE CRITERIA:
- Only one function parses raw ls-remote tag output
- All existing callers produce identical results
- No new exports beyond parseTagRefs (or similar)

STATUS: Complete

SPEC CONTEXT: The specification requires fetching tags via ls-remote for constrained version resolution (section "Constrained Update Flow" step 1), out-of-constraint detection, and bare-add latest tag resolution. All these flows need parsed tag data from ls-remote --tags output. Having a single, correct parser ensures consistency across all tag-consuming code paths.

IMPLEMENTATION:
- Status: Implemented
- Location: src/git-utils.ts:29-58
  - TagRef interface at line 29-32
  - parseTagRefs() at line 34-47: single shared parser that handles newline splitting, empty line filtering, ^{} filtering, tab splitting, and refs/tags/ stripping
  - fetchRemoteTagRefs() at line 49-54: convenience wrapper (execGit + parseTagRefs)
  - fetchRemoteTags() at line 56-59: maps TagRef[] to string[] via fetchRemoteTagRefs
- Callers in src/update-check.ts:
  - checkTag() at line 126: uses fetchRemoteTagRefs, maps to tag names
  - checkConstrained() at line 160: uses fetchRemoteTagRefs, builds Map from TagRef[]
- Notes: The old parseAllTags and parseTagCommitMap functions are completely gone from source and test code. No duplicate parsing logic remains. The only occurrence of refs/tags/ stripping in src/ is the single parseTagRefs function.

TESTS:
- Status: Adequate
- Coverage:
  - tests/parse-tag-refs.test.ts: 6 focused tests covering standard v-prefixed tags, ^{} annotated ref filtering, empty string, whitespace-only string, trailing newline, and mixed empty lines
  - tests/git-utils.test.ts: fetchRemoteTagRefs tests (3 tests) and fetchRemoteTags tests (4 tests) verify the wrappers produce correct results through parseTagRefs
  - tests/update-check.test.ts: tag tracking and constrained tests exercise the full path through fetchRemoteTagRefs -> parseTagRefs
  - tests/update-check-constrained.test.ts: 8 tests verify constrained update flows that rely on the shared parser
- Notes: All edge cases from the task criteria are covered (normal tags, v-prefixed, annotated ^{} refs, empty lines). Tests would fail if parseTagRefs broke since all callers depend on it. No over-testing detected -- each test verifies a distinct scenario.

CODE QUALITY:
- Project conventions: Followed -- consistent with existing patterns in git-utils.ts
- SOLID principles: Good -- parseTagRefs has single responsibility (parse raw stdout to structured data); fetchRemoteTagRefs composes IO + parsing cleanly
- Complexity: Low -- parseTagRefs is a straightforward pipeline (trim, split, filter, filter, map)
- Modern idioms: Yes -- uses optional chaining, nullish coalescing, method chaining
- Readability: Good -- function names clearly communicate intent; TagRef interface is self-documenting
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- The parseTagRefs test suite does not include a test case with non-v-prefixed tag names (e.g., "1.0.0" without "v" prefix). The implementation handles this correctly since it just strips "refs/tags/" regardless, but a test would document that behavior explicitly. Very minor.
