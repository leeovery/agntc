TASK: Version resolver with constraint matching

ACCEPTANCE CRITERIA:
- resolveVersion("^1.0", ["v1.0.0", "v1.1.0", "v2.0.0"]) returns { tag: "v1.1.0", version: "1.1.0" }
- resolveVersion("~1.0.0", ["v1.0.0", "v1.0.5", "v1.1.0"]) returns { tag: "v1.0.5", version: "1.0.5" }
- resolveVersion("^3.0", ["v1.0.0", "v2.0.0"]) returns null
- resolveVersion("^0.2.3", ["v0.2.3", "v0.2.5", "v0.3.0"]) returns { tag: "v0.2.5", version: "0.2.5" }
- resolveVersion("^0.0.3", ["v0.0.3", "v0.0.4", "v0.1.0"]) returns { tag: "v0.0.3", version: "0.0.3" }
- resolveVersion("^1", ["v1.0.0", "v1.5.0", "v2.0.0"]) returns { tag: "v1.5.0", version: "1.5.0" }
- resolveLatestVersion(["v1.0.0", "v2.0.0", "v2.0.0-beta.1"]) returns { tag: "v2.0.0", version: "2.0.0" }
- resolveLatestVersion(["alpha", "beta"]) returns null
- Pre-release tags excluded by maxSatisfying for non-pre-release constraints
- Returned tag is original git ref name (e.g., "v1.1.0", not "1.1.0")

STATUS: Complete

SPEC CONTEXT: The spec defines a resolution algorithm: (1) fetch refs via ls-remote, (2) filter to semver-valid tags, (3) normalize with semver.clean(), (4) pass to semver.maxSatisfying(). Pre-1.0 caret semantics (^0.x, ^0.0.x) are handled automatically by the semver package. For bare-add, use maxSatisfying with "*" to find highest stable version. When multiple tags clean to the same version, prefer v-prefixed form. No match returns null.

IMPLEMENTATION:
- Status: Implemented
- Location: /Users/leeovery/Code/agntc/src/version-resolve.ts:31-53
- Notes: The implementation simplifies the plan's two-step API (normalize-then-resolve) into a single-step API where resolveVersion() internalizes normalization. Field names differ from plan (tag/version vs original/cleaned) but match the acceptance criteria as stated in the task. resolveLatestVersion elegantly delegates to resolveVersion("*", tags). All spec requirements are met: clean() is used (not coerce()), v-prefix preference is implemented, pre-release exclusion is handled by maxSatisfying default behavior.

TESTS:
- Status: Adequate
- Coverage: All 14 required tests are present and match the specified test descriptions exactly. Covers caret, tilde, partial constraints, pre-1.0 semantics (both minor-bounded and patch-bounded), pre-release exclusion, null returns (no match, empty list), original tag name preservation, mixed v-prefixed/bare tags, and resolveLatestVersion (highest stable, no semver tags, pre-release exclusion).
- Notes: Tests are well-structured, focused, and non-redundant. Each test verifies a distinct behavior. The normalizeTags tests (lines 8-72) belong to task vc-1-6 and are appropriately separated in their own describe block. No over-testing detected.

CODE QUALITY:
- Project conventions: Followed. Uses named imports from semver, vitest for testing, .js extension in imports.
- SOLID principles: Good. Single responsibility -- resolveVersion does version resolution, normalizeTags does normalization. resolveLatestVersion reuses resolveVersion via delegation rather than duplication.
- Complexity: Low. resolveVersion is 15 lines with a single linear flow. resolveLatestVersion is a one-liner. No branching complexity.
- Modern idioms: Yes. Uses Map, spread operator, nullish checks.
- Readability: Good. Function names are self-documenting. The ResolvedVersion interface clearly communicates what tag vs version mean.
- Issues: None.

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- The plan specified a two-step API where callers normalize once then pass NormalizedTag[] to both resolveVersion and resolveLatestVersion. The implementation internalizes normalization, meaning it runs twice when both functions are called with the same tag list (as in update-check.ts:148,164 and add.ts:59,70). This is a minor inefficiency for small tag lists but could be revisited if performance matters for repos with very large tag counts.
- The plan specified field names "original" and "cleaned" on ResolvedVersion; the implementation uses "tag" and "version". The implementation names are arguably clearer and more conventional. This is purely cosmetic drift from the plan, not a functional issue.
