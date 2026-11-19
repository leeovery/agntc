TASK: Extract droppedAgents suffix formatter in summary.ts

ACCEPTANCE CRITERIA:
- All four droppedSuffix constructions use the shared helper
- Output strings are identical to current behavior for both styles

STATUS: Complete

SPEC CONTEXT: The specification does not directly address the droppedAgents suffix formatting; this is an internal code quality refactor (DRY) identified during analysis cycle 1 (analysis-tasks-c1.md, Task 5). The four inline blocks in summary.ts each constructed a suffix from a droppedAgents array with two wording variants: sentence style (period-prefixed, period-terminated) and inline style (em-dash-prefixed, no trailing period). The refactor consolidates these into a single helper.

IMPLEMENTATION:
- Status: Implemented
- Location: src/summary.ts:6-16 (formatDroppedAgentsSuffix helper)
- Call sites:
  - src/summary.ts:160-163 (renderGitUpdateSummary, "sentence")
  - src/summary.ts:177-180 (renderLocalUpdateSummary, "sentence")
  - src/summary.ts:202-205 (renderUpdateOutcomeSummary git-update branch, "inline")
  - src/summary.ts:209-212 (renderUpdateOutcomeSummary local-update branch, "inline")
- Notes: All four original inline constructions have been replaced with single-line calls to the helper. No inline droppedSuffix construction logic remains. The helper is exported (the plan suggested "private" but exporting it is necessary for direct unit testing and is a reasonable deviation). The function handles the empty-array case by returning an empty string, preserving the original behavior where no suffix was appended when droppedAgents was empty.

TESTS:
- Status: Adequate
- Coverage:
  - Direct unit tests for formatDroppedAgentsSuffix (tests/summary.test.ts:523-552):
    - Empty array for both styles returns ""
    - Single agent, sentence style: `. codex support removed by plugin author.`
    - Multiple agents, sentence style: `. claude, codex support removed by plugin author.`
    - Single agent, inline style: ` [em-dash] codex support removed by plugin author`
    - Multiple agents, inline style: ` [em-dash] claude, codex support removed by plugin author`
  - Indirect coverage through existing rendering tests that pass droppedAgents to renderGitUpdateSummary, renderLocalUpdateSummary, and renderUpdateOutcomeSummary (tests/summary.test.ts:334-344, 385-393, 408-435, 499-520)
  - Tests verify exact string output including the em-dash character (U+2014)
- Notes: Test coverage is well-balanced. The direct tests verify both styles with single and multiple agents plus the empty case. The existing integration-level tests verify the helper produces correct output when composed into the larger rendering functions. No over-testing observed.

CODE QUALITY:
- Project conventions: Followed. Uses TypeScript string literal union type for the style parameter, consistent with the project's pattern of using discriminated types. Export style and function signature match existing helpers in the file (capitalizeAgentName, formatRefLabel, etc.).
- SOLID principles: Good. Single responsibility (one function, one concern: formatting dropped agents suffix). Open/closed (new styles could be added without modifying existing call sites).
- Complexity: Low. Simple conditional with early return for empty array. No nesting beyond the single if/return.
- Modern idioms: Yes. Uses template literals, string literal union types, early return pattern.
- Readability: Good. Function name clearly describes its purpose. The style parameter ("sentence" vs "inline") is self-documenting.
- Issues: None.

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- The plan suggested a "private helper" but the function is exported. This is the right call since it enables direct unit testing and follows the pattern of other utility functions in the same file.
