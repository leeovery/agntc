TASK: Filter selectAgents to Declared Agents with Not-Detected Hint

ACCEPTANCE CRITERIA:
- [x] selectAgents() multiselect options only contain agents from declaredAgents
- [x] Undeclared agents are completely absent from the options array
- [x] Declared agents not in detectedAgents have label "${id} (not detected in project)"
- [x] Declared agents in detectedAgents have label equal to just the agent id string
- [x] initialValues only contains agents that are both declared AND detected
- [x] The old "not declared by plugin" hint property is removed
- [x] Cancel still returns []
- [x] Zero selection still returns [] with info log
- [x] All updated agent-select.test.ts tests pass

STATUS: Complete

SPEC CONTEXT: The specification (section "Agent Selection: Filter to Declared Agents") requires selectAgents() to filter the multiselect to only agents present in the plugin's declaredAgents set. Undeclared agents are excluded entirely. For declared agents not detected in the project, a persistent "(not detected in project)" hint is embedded directly in the option label string (not the @clack/prompts hint property) so it is always visible regardless of highlight state. The rationale is that plugin authors declare specific agents intentionally and adding a third agent (cursor) makes showing irrelevant options more noticeable.

IMPLEMENTATION:
- Status: Implemented
- Location: src/agent-select.ts:1-54
- Notes: Implementation is clean and matches the spec precisely. Options are built from `input.declaredAgents.map(...)` (line 32-35), so only declared agents appear. The label ternary `detectedSet.has(id) ? id : \`${id} (not detected in project)\`` correctly handles both detected and not-detected cases. `initialValues` correctly filters to declared AND detected agents (line 28-30). The old `getRegisteredAgentIds()` import has been removed. No `hint` property is used on options. The empty `declaredAgents` guard at line 12-14 short-circuits without prompting. The `SelectAgentsInput` interface accepts `declaredAgents` and `detectedAgents` and both call sites in `src/commands/add.ts` (lines 218-221 and 414-417) pass the correct shape.

TESTS:
- Status: Adequate
- Coverage: All 10 required tests from the plan are present and correctly structured:
  1. "only shows declared agents in options" (line 21) - verifies options values match declared agents
  2. "excludes undeclared agents entirely" (line 34) - verifies cursor not in options when not declared
  3. "shows not-detected hint in label for declared but undetected agent" (line 47) - verifies label text
  4. "does not show hint in label for detected agent" (line 62) - verifies clean label
  5. "all declared agents not detected shows all with hint" (line 77) - verifies all labels have hint
  6. "empty declaredAgents yields zero options" (line 91) - verifies short-circuit, no prompt
  7. "pre-selects declared AND detected agents" (line 101) - verifies initialValues
  8. "returns empty array on cancel" (line 113) - verifies cancel behavior
  9. "returns empty array on zero selection with info log" (line 124) - verifies empty selection + log
  10. "returns selected AgentId[] on valid selection" (line 138) - verifies happy path
- Edge cases covered: empty declaredAgents (short-circuit), all declared not detected (all hints), undeclared excluded
- Notes: There is mild duplication between test at line 91 ("empty declaredAgents yields zero options") and line 219 ("returns empty array for zero declared agents without prompting") -- both verify the same behavior. The second is from task 1-4's test list. This is non-blocking; both are specified by their respective tasks and the duplication is minimal.

CODE QUALITY:
- Project conventions: Followed. Uses vitest with vi.mock pattern, @clack/prompts for UI, proper TypeScript types, interface for input params.
- SOLID principles: Good. Single function with single responsibility. Interface for input promotes dependency inversion.
- Complexity: Low. Linear flow: guard clause -> Set construction -> auto-skip check -> build options/initialValues -> multiselect -> handle cancel/empty/valid. No nested branches.
- Modern idioms: Yes. Set for O(1) lookup, Array.filter/map, template literals, nullish handling, destructured imports.
- Readability: Good. Clear variable names (detectedSet, options, initialValues), self-documenting logic, concise function body.
- Issues: None identified.

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- Tests at line 91-99 and line 219-227 are near-duplicates testing the same empty-declaredAgents behavior. This arose from being specified separately in task 1-3 and task 1-4. Could consolidate to a single test, but both are small and clear.
