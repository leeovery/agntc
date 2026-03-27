TASK: Auto-Skip Agent Selection When Unambiguous

ACCEPTANCE CRITERIA:
- [x] One declared + detected: selectAgents() returns [agent] without calling multiselect
- [x] One declared + detected: log.info is called with a message indicating which agent was auto-selected
- [x] One declared + NOT detected: multiselect is called, option shows "(not detected in project)" in label
- [x] Multiple declared (any detection state): multiselect is always called
- [x] Zero declared: returns [] without calling multiselect
- [x] All updated agent-select.test.ts tests pass
- [x] Existing cancel and zero-selection behavior unchanged for prompted cases

STATUS: Complete

SPEC CONTEXT: The specification states that when a plugin declares a single agent and that agent is detected locally, the multiselect prompt with one pre-checked option is unnecessary friction. The auto-skip rule is strictly "one declared AND detected" -- if the single declared agent is NOT detected, the prompt must still appear so the user consciously opts in. Multiple declared agents always show the prompt regardless of detection state.

IMPLEMENTATION:
- Status: Implemented
- Location: /Users/leeovery/Code/agntc/src/agent-select.ts:18-26
- Notes: The auto-skip logic is clean and correct. It checks three conditions: (1) exactly one declared agent, (2) the agent value exists (noUncheckedIndexedAccess safety), and (3) the agent is in the detected set. On match, it logs the auto-selection and returns early before multiselect is reached. The function signature is unchanged so callers in add.ts require no modifications.

TESTS:
- Status: Adequate
- Coverage: All 7 required test cases present and passing:
  - "auto-selects when one declared agent is detected" (line 149)
  - "logs auto-selected agent name" (line 159)
  - "shows prompt when one declared agent is not detected" (line 170)
  - "shows prompt when multiple declared with one detected" (line 186)
  - "shows prompt when multiple declared all detected" (line 197)
  - "shows prompt when multiple declared none detected" (line 208)
  - "returns empty array for zero declared agents without prompting" (line 219)
- Notes: Tests are focused and behavioral. Each covers a distinct scenario. The logging test (line 159) smartly uses "codex" rather than "claude" to verify the agent name is dynamic. Mocking is minimal and appropriate (only @clack/prompts). No over-testing -- no redundant assertions. Tests would fail if the feature broke (they check both return values and whether multiselect was/wasn't called).

CODE QUALITY:
- Project conventions: Followed -- uses interface for input shape, proper typing, consistent with existing codebase patterns
- SOLID principles: Good -- single responsibility maintained; selectAgents handles one concern (agent selection with smart skip)
- Complexity: Low -- simple conditional check with early return; cyclomatic complexity unchanged for the multiselect path
- Modern idioms: Yes -- Set for O(1) lookup, template literal for log message, noUncheckedIndexedAccess guard on array access
- Readability: Good -- the auto-skip block at lines 18-26 is self-explanatory; the condition reads naturally as "one declared and that one is detected"
- Issues: None

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- (none)
