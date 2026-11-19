TASK: Extract downgrade prevention helper with safe fallback

ACCEPTANCE CRITERIA:
- Single source of truth for the downgrade prevention comparison
- Non-semver refs cause the guard to return false (allow update) rather than comparing as 0.0.0
- Both single-plugin and batch update paths use the same helper

STATUS: Complete

SPEC CONTEXT: The specification (section "Constrained Update Flow", step 3) states that when comparing resolved tags against current ref, an older tag should never cause a downgrade — "never downgrade". The helper encapsulates this comparison. The spec also notes that semver.clean() returns null for non-semver strings, which this helper now handles explicitly rather than falling back to "0.0.0".

IMPLEMENTATION:
- Status: Implemented
- Location: src/version-resolve.ts:55-64 (isAtOrAboveVersion function definition)
- Location: src/commands/update.ts:28 (import)
- Location: src/commands/update.ts:159 (single-plugin path call site)
- Location: src/commands/update.ts:502 (batch update path call site)
- Notes: Implementation is clean and correct. The function accepts `currentRef: string | null` and `candidateTag: string`, uses `semver.clean()` on both, returns `false` when either is null (non-parseable), and uses `semver.gte()` for the actual comparison. The old fragile `"0.0.0"` fallback pattern (`gte(clean(entry.ref) ?? "0.0.0", clean(result.tag) ?? "0.0.0")`) has been completely eliminated — no occurrences of `"0.0.0"` remain in src/. The `gte(clean(...))` pattern only exists inside the helper itself. Both call sites in update.ts use the extracted helper identically.

TESTS:
- Status: Adequate
- Coverage: All four acceptance criteria tests are present, plus three additional edge cases
  - v1.3.0 > v1.2.0 returns true (at or above)
  - v1.2.0 < v1.3.0 returns false (below)
  - "main" vs v1.0.0 returns false (non-semver current ref)
  - null vs v1.0.0 returns false (null ref)
  - v1.0.0 = v1.0.0 returns true (equal — boundary case)
  - v1.0.0 vs "latest" returns false (non-semver candidate)
  - "main" vs "develop" returns false (both non-semver)
- Notes: Tests are focused and well-structured. Each test verifies one specific behavior. The additional tests beyond acceptance criteria (equality, non-semver candidate, both non-semver) are valuable edge cases that would catch regressions — not over-tested.

CODE QUALITY:
- Project conventions: Followed — function is exported from version-resolve.ts alongside related version resolution utilities, follows the project's modular pattern
- SOLID principles: Good — single responsibility (one comparison), cohesive placement with related version utilities
- Complexity: Low — four lines of logic, linear control flow, no branching beyond early returns
- Modern idioms: Yes — uses semver library functions correctly, null-check pattern is idiomatic TypeScript
- Readability: Good — function name clearly communicates intent, parameter names are descriptive, early-return pattern is clean
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- None
