TASK: Out-of-constraint info section in update output

ACCEPTANCE CRITERIA:
- No out-of-constraint versions = info section completely omitted from output
- Single constrained plugin with out-of-constraint version shows info line
- Multiple plugins with out-of-constraint versions all listed in section
- Within-constraint best equals absolute latest = no info line for that plugin
- Info tone (not warning) -- no exclamation marks, no colored warnings
- Section appears after all per-plugin results, not interleaved
- Works identically for single-plugin and batch update

STATUS: Complete

SPEC CONTEXT: The spec (Update Output UX) defines the exact output format for out-of-constraint info: a collated section at the end of update output showing "Newer versions outside constraints:" header followed by indented lines per plugin with latest version and constraint. Rules: always collated at end, show latest only, info tone not warning, omit entirely when no out-of-constraint versions exist. Same format for single-plugin and batch update.

IMPLEMENTATION:
- Status: Implemented
- Location:
  - src/summary.ts:225-243 -- `OutOfConstraintInfo` interface and `renderOutOfConstraintSection` function
  - src/commands/update.ts:45-48 -- `SingleUpdateResult` type includes `outOfConstraint` field
  - src/commands/update.ts:69-92 -- single-plugin mode collects and renders out-of-constraint info
  - src/commands/update.ts:95-113 -- `extractOutOfConstraint` helper extracts info from check results
  - src/commands/update.ts:471-482 -- batch mode collects out-of-constraint info
  - src/commands/update.ts:597,620 -- batch mode renders out-of-constraint info at end (both early-return and normal paths)
  - src/commands/update.ts:623-628 -- `renderOutOfConstraintOutput` bridges summary function to p.log.info
- Notes:
  - Minor deviation from plan: function returns `string[]` instead of `string | null`. The consumer iterates and calls `p.log.info` per line. Empty array means nothing is rendered -- functionally equivalent.
  - Interface named `OutOfConstraintInfo` instead of plan's `OutOfConstraintEntry`, and field named `latestOverall` instead of `latest`. Both names are more descriptive and consistent with the update-check types across the codebase.
  - Each line is rendered through a separate `p.log.info` call, meaning the @clack/prompts info icon appears on both the header and each entry line (rather than only on the header as the spec mockup shows). This is a minor visual difference driven by the @clack/prompts API -- the framework controls icon placement.

TESTS:
- Status: Adequate
- Coverage:
  - Unit tests (tests/summary-out-of-constraint.test.ts):
    - Empty array returns empty array (section omitted)
    - Single plugin formats correctly with header and entry line
    - Multiple plugins formats correctly with all entries under single header
    - Info tone verification (no exclamation marks, no warning language)
  - Integration tests (tests/commands/update.test.ts:3180-3437, "out-of-constraint info section" describe block):
    - Batch mode: renders info section when constrained plugin has out-of-constraint version
    - Batch mode: omits info section when no out-of-constraint versions exist (latestOverall: null)
    - Batch mode: multiple plugins listed in same section
    - Single-plugin mode: renders info section for constrained-update-available with out-of-constraint
    - Single-plugin mode: omits info section when no out-of-constraint version
    - Single-plugin mode: renders info section for constrained-up-to-date with out-of-constraint
    - Within-constraint best equals absolute latest: info section omitted (latestOverall: null)
  - All acceptance criteria have corresponding test cases
  - Tests verify correct method is called (p.log.info, not p.log.warn) implicitly through mock assertions
- Notes: Test coverage is thorough and well-balanced. No over-testing observed -- each test covers a distinct scenario from the acceptance criteria.

CODE QUALITY:
- Project conventions: Followed -- consistent with existing summary.ts patterns (exported interface + pure function, same naming conventions)
- SOLID principles: Good -- `renderOutOfConstraintSection` is a pure function with single responsibility (formatting). Integration logic (`extractOutOfConstraint`, `renderOutOfConstraintOutput`) is cleanly separated. Open/closed: new functionality added without modifying existing summary functions.
- Complexity: Low -- straightforward iteration with no branching beyond the empty-array guard
- Modern idioms: Yes -- uses const assertions, typed interfaces, for-of loops
- Readability: Good -- function names are self-documenting, the data flow from check result -> extract -> collect -> render is easy to follow
- Issues: None

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- The `renderOutOfConstraintOutput` wrapper in update.ts (lines 623-628) could potentially be co-located with the rendering function in summary.ts if the @clack/prompts dependency were acceptable there, but keeping it in the command layer is the correct architectural choice since summary.ts is a pure formatting module.
- The plan specified the info icon character (U+2139) in the header string, but the implementation omits it from the string itself and relies on @clack/prompts `p.log.info` to provide the icon. This is the correct approach since @clack/prompts handles icon rendering -- hardcoding it would produce a duplicate icon.
