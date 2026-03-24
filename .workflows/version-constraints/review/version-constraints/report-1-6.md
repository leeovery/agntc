TASK: Tag normalization pipeline (vc-1-6)

ACCEPTANCE CRITERIA:
- normalizeTags(["v1.2.3"]) returns Map { "1.2.3" => "v1.2.3" }
- normalizeTags(["1.0.0"]) returns Map { "1.0.0" => "1.0.0" }
- normalizeTags(["v1.2.3", "1.2.3"]) returns Map { "1.2.3" => "v1.2.3" } (v-prefix preferred)
- normalizeTags(["1.2.3", "v1.2.3"]) returns Map { "1.2.3" => "v1.2.3" } (v-prefix preferred regardless of order)
- normalizeTags(["release-candidate", "latest", "nope"]) returns empty Map
- normalizeTags([]) returns empty Map
- normalizeTags(["v1.0.0", "v2.0.0", "latest"]) returns Map with 2 entries
- Tags with extra whitespace are cleaned

STATUS: Complete

SPEC CONTEXT:
The specification defines a Tag Normalization Pipeline in the "Version Resolution" section: (1) collect tag names from ls-remote, (2) attempt semver.clean(tag) on each, (3) discard null results, (4) pass cleaned versions to semver.maxSatisfying(), (5) map back to original tag name, (6) store original tag in ref. The spec explicitly requires v-prefix preference for duplicates and prohibits use of semver.coerce().

IMPLEMENTATION:
- Status: Implemented with deliberate deviation from plan's return type
- Location: /Users/leeovery/Code/agntc/src/version-resolve.ts:3-23
- Notes:
  - The plan specified returning `NormalizedTag[]` (array of `{ original: string; cleaned: string }`) and exporting a `NormalizedTag` interface. The implementation returns `Map<string, string>` (cleaned version -> original tag) instead. Neither the `NormalizedTag` interface nor the array return type exist.
  - This is a deliberate simplification, not a bug. The `Map<string, string>` is functionally equivalent and arguably more ergonomic for the actual use case: `resolveVersion()` at line 31-49 calls `normalizeTags(tags)` internally, extracts keys as cleaned versions, and uses `normalized.get(matched)` for the reverse lookup. This is cleaner than searching an array.
  - The plan also specified that `resolveVersion` and `resolveLatestVersion` should accept pre-normalized `NormalizedTag[]` from callers. Instead, both functions accept raw `string[]` tags and call `normalizeTags` internally. This simplifies the public API -- callers (update-check.ts:164, add.ts) pass raw tags directly.
  - The deviation is internally consistent: all downstream consumers work correctly with the simplified API. No caller ever needs the `NormalizedTag` type.
  - Core algorithm matches spec exactly: uses `semver.clean()` (not coerce), filters nulls, deduplicates with v-prefix preference via `trimStart().startsWith("v")` check.
  - The v-prefix preference logic at lines 15-19 correctly handles both orderings: when processing the v-prefixed tag, if the existing entry is non-v-prefixed, it overwrites. When processing a non-v-prefixed tag and a v-prefixed entry already exists, it keeps the existing entry.

TESTS:
- Status: Adequate
- Coverage:
  - All 10 specified tests are present with matching names:
    1. "normalizes v-prefixed tag to clean semver" (line 9)
    2. "keeps bare semver tag as-is" (line 14)
    3. "prefers v-prefixed tag when duplicate versions exist" (line 19)
    4. "prefers v-prefixed tag regardless of input order" (line 24)
    5. "excludes non-semver tags" (line 29)
    6. "handles empty tag list" (line 34)
    7. "filters mixed semver and non-semver tags" (line 39)
    8. "handles no semver tags at all" (line 49)
    9. "strips whitespace from tags via clean()" (line 54)
    10. "handles pre-release tags" (line 64)
  - Tests adapted to use Map assertions instead of array assertions, matching the actual return type
  - Tests are focused and non-redundant -- each verifies a distinct behavior
  - The whitespace test (line 54-62) correctly verifies that the Map values retain the original whitespace-containing strings while keys are cleaned. This is important because the original tag is needed as the git ref, and it should match what ls-remote returned.
  - The pre-release test verifies both a pre-release and a stable tag coexist as separate Map entries
- Notes:
  - Test file also contains resolveVersion and resolveLatestVersion tests (lines 75-157), which belong to task vc-1-7 but are co-located in the same file since both are in version-resolve.ts. This is appropriate.
  - Would the tests fail if the feature broke? Yes -- each test makes specific assertions on Map contents, not just type checks.

CODE QUALITY:
- Project conventions: Followed -- uses tab indentation, .js import extensions for NodeNext module resolution, named exports, vitest for testing
- SOLID principles: Good -- normalizeTags has single responsibility (normalize and deduplicate tags), is pure (no side effects), and the Map return type provides a clean interface
- Complexity: Low -- single loop with two conditional branches; cyclomatic complexity ~3
- Modern idioms: Yes -- uses Map, const, arrow-free for loop, clean early-continue pattern
- Readability: Good -- function is 20 lines, self-documenting. The v-prefix preference logic at lines 15-19 is clear: check if new tag starts with "v" and existing does not
- Issues: None significant

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- The return type deviation from plan (Map<string, string> vs NormalizedTag[]) is a pragmatic improvement. The Map provides O(1) lookup by cleaned version, which is exactly what resolveVersion needs. The plan's NormalizedTag[] would have required a linear search or a secondary Map construction. This is a case where implementation improved on the plan.
- The `trimStart()` call in the v-prefix check (line 16-17) handles the edge case where whitespace-padded tags like "  v1.2.3  " should still be recognized as v-prefixed. This is a nice detail that aligns with the spec's whitespace-cleaning requirement.
