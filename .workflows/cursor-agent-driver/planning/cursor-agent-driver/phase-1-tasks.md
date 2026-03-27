---
phase: 1
phase_name: Cursor Driver and Agent Selection Overhaul
total: 4
---

## cursor-agent-driver-1-1 | approved

### Task 1: CursorDriver Implementation

**Problem**: agntc currently supports two agents (Claude and Codex). The Cursor editor (2.4+) natively reads SKILL.md files in `.cursor/skills/`, but there is no `CursorDriver` to detect Cursor's presence or route skill files to its directory. Without this driver, users cannot install skills for Cursor.

**Solution**: Create a new `CursorDriver` class in `src/drivers/cursor-driver.ts` implementing the `AgentDriver` interface with three-tier detection (project `.cursor/` directory, `which cursor` CLI check, `~/.cursor/` home directory fallback) and a `Partial<Record<AssetType, string>>` TARGET_DIRS mapping that only includes `skills: ".cursor/skills"`.

**Outcome**: A fully tested `CursorDriver` class exists that detects Cursor via three tiers with early-return short-circuiting, returns `".cursor/skills"` for the skills asset type, and returns `null` for agents, hooks, and unknown asset types.

**Do**:
- Create `src/drivers/cursor-driver.ts` modelled on the `ClaudeDriver` pattern (three-tier detection) but with Cursor-specific paths and CLI name
- Define `TARGET_DIRS` as `Partial<Record<AssetType, string>>` with only `{ skills: ".cursor/skills" }` — same shape as `CodexDriver`
- Implement `detect(projectDir: string)` with three tiers:
  1. `projectHasCursor(projectDir)` — check `access(join(projectDir, ".cursor"))`
  2. `whichCursorSucceeds()` — `execFile("which", ["cursor"], ...)`
  3. `homeDirHasCursor()` — check `access(join(homedir(), ".cursor"))`
- Each tier returns `true` immediately on success (early-return short-circuiting), only proceeding to the next tier on failure
- Implement `getTargetDir(assetType: AssetType): string | null` returning `TARGET_DIRS[assetType] ?? null`
- Create `tests/drivers/cursor-driver.test.ts` following the exact mock patterns from `claude-driver.test.ts` (mock `node:fs/promises` and `node:child_process`)
- All private methods should follow the same naming convention: `projectHasCursor`, `whichCursorSucceeds`, `homeDirHasCursor`

**Acceptance Criteria**:
- [ ] `src/drivers/cursor-driver.ts` exports a `CursorDriver` class implementing `AgentDriver`
- [ ] `detect()` returns `true` when `.cursor/` exists at project level
- [ ] `detect()` returns `true` when `which cursor` succeeds (and project dir check failed)
- [ ] `detect()` returns `true` when `~/.cursor/` exists (and both prior checks failed)
- [ ] `detect()` returns `false` when all three tiers fail
- [ ] `detect()` short-circuits: when project dir check succeeds, `execFile` is never called and only one `fs.access` call is made
- [ ] `detect()` short-circuits: when `which cursor` succeeds, `homeDirHasCursor` is never called
- [ ] `getTargetDir("skills")` returns `".cursor/skills"`
- [ ] `getTargetDir("agents")` returns `null`
- [ ] `getTargetDir("hooks")` returns `null`
- [ ] `getTargetDir("unknown")` returns `null`
- [ ] All tests pass in `tests/drivers/cursor-driver.test.ts`

**Tests**:
- `"returns true when .cursor/ exists in project"` — mock `fs.access` to resolve, verify `detect()` returns `true` and `fs.access` was called with `join(projectDir, ".cursor")`
- `"skips system fallback on project match"` — mock `fs.access` to resolve once, verify `execFile` was never called and `fs.access` was called exactly once
- `"returns true when which cursor succeeds"` — mock `fs.access` to reject (project check), mock `execFile` callback with `null` error, verify `detect()` returns `true`
- `"returns true when ~/.cursor/ exists"` — mock project access to reject, `execFile` to fail, second `fs.access` to resolve, verify `detect()` returns `true` and `fs.access` was called with `join(homedir(), ".cursor")`
- `"returns false when all checks fail"` — mock all three tiers to fail, verify `detect()` returns `false`
- `"does not throw on check failures"` — mock all checks to fail, verify `detect()` resolves (not rejects) to `false`
- `"does not check home directory when which succeeds"` — mock project access to reject, `execFile` to succeed, verify `fs.access` was called exactly once (project check only, no home dir check)
- `"returns .cursor/skills for skills asset type"` — verify `getTargetDir("skills")` returns `".cursor/skills"`
- `"returns null for agents asset type"` — verify `getTargetDir("agents")` returns `null`
- `"returns null for hooks asset type"` — verify `getTargetDir("hooks")` returns `null`
- `"returns null for unknown asset type"` — verify `getTargetDir("unknown" as any)` returns `null`

**Edge Cases**:
- Home directory fallback (`~/.cursor/`): This is the third and final detection tier, only reached when both project dir and CLI checks fail. Uses `homedir()` from `node:os` like `ClaudeDriver`. Must be tested by mocking the first two tiers to fail and the third to succeed.
- Early-return short-circuiting: Each tier returns `true` immediately without running subsequent tiers. Test by asserting that later mocks are never called when an earlier tier succeeds.
- `getTargetDir` returns `null` for agents, hooks, and unknown asset types: Cursor has no agents or hooks system per the spec. The `Partial<Record<AssetType, string>>` with nullish coalescing (`?? null`) handles this.

**Context**:
> The CursorDriver follows the ClaudeDriver pattern (three-tier detection) rather than the CodexDriver pattern (two-tier, no home fallback). The spec explicitly states "Three-tier detection, matching the Claude driver pattern (Codex uses two tiers -- no home directory fallback)." TARGET_DIRS is `Partial<Record<AssetType, string>>` (not full `Record`) because Cursor only supports skills — same shape as CodexDriver. Cursor 2.4+ natively reads SKILL.md files so no format conversion is needed. The `.cursor/skills/` path is a first-class Cursor skill directory confirmed via Cursor documentation.

**Spec Reference**: `.workflows/cursor-agent-driver/specification/cursor-agent-driver/specification.md` — sections "Cursor Driver", "Detection", "Asset Types", "Target Directory"

## cursor-agent-driver-1-2 | approved

### Task 2: Integrate Cursor into Type System and Registry

**Problem**: The `AgentId` union type is `"claude" | "codex"`, `KNOWN_AGENTS` is `["claude", "codex"]`, and the driver registry only maps those two. The `CursorDriver` from Task 1 exists but is not wired into the system — it cannot be selected, detected, or used for file routing. Additionally, `identifyFileOwnership()` in `src/drivers/identify.ts` will not recognize `.cursor/skills/` paths because the cursor driver is not registered.

**Solution**: Add `"cursor"` to the `AgentId` union in `src/drivers/types.ts`, to `KNOWN_AGENTS` in `src/config.ts`, and register a `CursorDriver` instance in `src/drivers/registry.ts`. Update all tests that assert on the two-agent set to expect three agents.

**Outcome**: TypeScript recognizes `"cursor"` as a valid `AgentId`. The config parser accepts `"cursor"` in `agntc.json` `agents` arrays. The driver registry returns a `CursorDriver` for `"cursor"` and `getRegisteredAgentIds()` returns all three IDs. `identifyFileOwnership()` correctly identifies `.cursor/skills/` paths as cursor/skills ownership.

**Do**:
- In `src/drivers/types.ts`: change `AgentId` from `"claude" | "codex"` to `"claude" | "codex" | "cursor"`
- In `src/config.ts`: change `KNOWN_AGENTS` from `["claude", "codex"]` to `["claude", "codex", "cursor"]`
- In `src/drivers/registry.ts`: import `CursorDriver` from `./cursor-driver.js`, add `cursor: new CursorDriver()` to `DRIVER_REGISTRY`. The registry type is `Record<AgentId, AgentDriver>` — TypeScript will enforce that all three keys are present
- Update `tests/drivers/registry.test.ts`:
  - Import `CursorDriver` from `../../src/drivers/cursor-driver.js`
  - Add test: `"returns cursor driver for 'cursor'"` verifying `getDriver("cursor")` is `instanceof CursorDriver`
  - Update existing test `"lists registered agent IDs including both claude and codex"` to expect `["claude", "codex", "cursor"]` and rename it to include cursor
- Update `tests/config.test.ts`:
  - Change `"contains claude and codex"` test to expect `["claude", "codex", "cursor"]`
  - Add a test `"parses valid config with cursor agent"` with `{ agents: ["cursor"] }`
  - Add a test `"parses valid config with all three agents"` with `{ agents: ["claude", "codex", "cursor"] }`
- Update `tests/drivers/identify.test.ts`:
  - Add test: `"identifies .cursor/skills/foo as cursor skills"` — verify `identifyFileOwnership(".cursor/skills/foo")` returns `{ agentId: "cursor", assetType: "skills" }`
  - Add test: `"identifies .cursor/skills/foo/SKILL.md as cursor skills"` — verify nested path works
  - Add test: `"returns null for .cursor/agents/ path"` — since cursor has no agents target dir, `.cursor/agents/foo` should return `null` (no match)
- Verify existing tests still pass (the `agent-select.test.ts` and `detect-agents` tests mock the registry, so they won't break from the registry change)

**Acceptance Criteria**:
- [ ] `AgentId` type in `src/drivers/types.ts` is `"claude" | "codex" | "cursor"`
- [ ] `KNOWN_AGENTS` in `src/config.ts` is `["claude", "codex", "cursor"]`
- [ ] `DRIVER_REGISTRY` in `src/drivers/registry.ts` has entries for all three agents
- [ ] `getDriver("cursor")` returns a `CursorDriver` instance
- [ ] `getRegisteredAgentIds()` returns `["claude", "codex", "cursor"]`
- [ ] `readConfig()` accepts `"cursor"` in the agents array without warning
- [ ] `identifyFileOwnership(".cursor/skills/foo")` returns `{ agentId: "cursor", assetType: "skills" }`
- [ ] `identifyFileOwnership(".cursor/agents/foo")` returns `null` (cursor has no agents target dir)
- [ ] `Record<AgentId, AgentDriver>` in the registry enforces all three keys at compile time
- [ ] All updated tests in `registry.test.ts`, `config.test.ts`, and `identify.test.ts` pass

**Tests**:
- `"returns cursor driver for 'cursor'"` — verify `getDriver("cursor")` is `instanceof CursorDriver`
- `"lists registered agent IDs including claude, codex, and cursor"` — verify `getRegisteredAgentIds()` returns `["claude", "codex", "cursor"]`
- `"KNOWN_AGENTS contains claude, codex, and cursor"` — verify array equality
- `"parses valid config with cursor agent"` — mock `fs.readFile` to return `{ agents: ["cursor"] }`, verify result is `{ agents: ["cursor"] }`
- `"parses valid config with all three agents"` — mock `fs.readFile` to return `{ agents: ["claude", "codex", "cursor"] }`, verify all three are returned
- `"identifies .cursor/skills/foo as cursor skills"` — verify `identifyFileOwnership` returns `{ agentId: "cursor", assetType: "skills" }`
- `"identifies .cursor/skills/foo/SKILL.md as cursor skills"` — verify nested path identification
- `"returns null for .cursor/agents/ path"` — cursor has no agents dir, so `.cursor/agents/foo` is unrecognized

**Edge Cases**:
- `identify.ts` must recognize `.cursor/skills/` paths: The `identifyFileOwnership` function iterates `getRegisteredAgentIds()` and calls `getTargetDir()` for each asset type. Since `CursorDriver.getTargetDir("skills")` returns `".cursor/skills"`, paths starting with `.cursor/skills` will match. No code change to `identify.ts` is needed — it automatically picks up new drivers from the registry.
- `readConfig` must accept `"cursor"` in `agntc.json` agents array: The config parser checks `KNOWN_AGENTS` set membership. Adding `"cursor"` to the const array is sufficient — no other config code changes needed.
- `Record<AgentId, AgentDriver>` requires all three keys: TypeScript will produce a compile error if the cursor entry is missing from the registry. This is the intended exhaustiveness check the spec references.

**Context**:
> The spec states: "Add 'cursor' to the explicit AgentId union type ('claude' | 'codex' | 'cursor') and to the KNOWN_AGENTS const array. Keep the explicit union -- three members is still small, compile-time exhaustiveness checking is valuable, and a plugin-based architecture is premature." The `identifyFileOwnership()` function requires no code change -- it dynamically queries the registry. However, its test suite needs new cases to verify `.cursor/skills/` paths are correctly identified.

**Spec Reference**: `.workflows/cursor-agent-driver/specification/cursor-agent-driver/specification.md` — sections "AgentId Type", "Implementation", "Asset Routing (updated)"

## cursor-agent-driver-1-3 | approved

### Task 3: Filter selectAgents to Declared Agents with Not-Detected Hint

**Problem**: Currently `selectAgents()` shows all registered agents as multiselect options. Undeclared agents get a `hint` property ("not declared by plugin"), but `@clack/prompts` only renders hints when the option is highlighted — users can still select agents the plugin does not declare. With three agents, showing irrelevant options is more noticeable and confusing.

**Solution**: Modify `selectAgents()` in `src/agent-select.ts` to filter the multiselect options to only agents present in `declaredAgents`. Undeclared agents are excluded entirely. For declared agents that are not detected in the project, embed a `"(not detected in project)"` hint directly in the option `label` string (not the `hint` property) so it is visible at all times regardless of highlight state.

**Outcome**: The multiselect prompt only shows agents the plugin declares. Declared-but-not-detected agents display `"(not detected in project)"` persistently in their label. Undeclared agents never appear. Pre-selection logic (initialValues) continues to select only agents that are both declared AND detected.

**Do**:
- In `src/agent-select.ts`, change the `options` array construction:
  - Replace `const allAgents = getRegisteredAgentIds()` filtering with `const options` built from `input.declaredAgents` only
  - For each declared agent, check if it is in `detectedSet`. If not detected, set `label` to `"${id} (not detected in project)"`. If detected, set `label` to just `id`
  - Remove the old `hint: "not declared by plugin"` logic entirely — undeclared agents are no longer shown
  - Keep `initialValues` as `declaredAgents.filter(id => detectedSet.has(id))` (same logic, but now only within declared scope)
  - Remove the `getRegisteredAgentIds()` import if it is no longer used in this function (it may still be needed elsewhere — check before removing)
- Update `tests/agent-select.test.ts`:
  - **Remove or rewrite** tests that assert undeclared agents appear in options (e.g., `"shows all registered agents"`, `"adds warning hint on undeclared agents"`)
  - **Remove or rewrite** the `"two-agent spec examples"` tests that verify undeclared-agent hints — these scenarios now result in the agent being excluded entirely
  - **Add**: `"only shows declared agents in options"` — with `declaredAgents: ["claude"]` and registry returning three agents, verify options array contains only claude
  - **Add**: `"excludes undeclared agents entirely"` — with `declaredAgents: ["claude"]`, verify codex and cursor are not in options values
  - **Add**: `"shows not-detected hint in label for declared but undetected agent"` — with `declaredAgents: ["claude", "codex"]` and `detectedAgents: ["claude"]`, verify codex option label contains `"(not detected in project)"`
  - **Add**: `"does not show hint in label for detected agent"` — verify claude label is just `"claude"` with no parenthetical
  - **Add**: `"all declared agents not detected shows all with hint"` — with `declaredAgents: ["claude", "codex"]` and `detectedAgents: []`, verify both labels contain the hint text
  - **Add**: `"empty declaredAgents yields zero options"` — with `declaredAgents: []`, verify options array is empty. Note: `@clack/prompts` multiselect with zero options may need special handling — verify behavior and add guard if needed
  - **Keep** tests for cancel handling, zero selection, valid selection return, and `required: false` — these are unchanged
  - **Update** pre-selection tests to use declared-only scope

**Acceptance Criteria**:
- [ ] `selectAgents()` multiselect options only contain agents from `declaredAgents`
- [ ] Undeclared agents are completely absent from the options array
- [ ] Declared agents not in `detectedAgents` have label `"${id} (not detected in project)"` (persistent, not highlight-dependent)
- [ ] Declared agents in `detectedAgents` have label equal to just the agent id string
- [ ] `initialValues` only contains agents that are both declared AND detected (unchanged logic, narrower scope)
- [ ] The old `"not declared by plugin"` hint property is removed
- [ ] Cancel still returns `[]`
- [ ] Zero selection still returns `[]` with info log
- [ ] All updated `agent-select.test.ts` tests pass

**Tests**:
- `"only shows declared agents in options"` — mock registry to return `["claude", "codex", "cursor"]`, call with `declaredAgents: ["claude", "cursor"]`, verify options values are `["claude", "cursor"]`
- `"excludes undeclared agents entirely"` — mock registry to return three agents, call with `declaredAgents: ["claude"]`, verify options values do not include `"codex"` or `"cursor"`
- `"shows not-detected hint in label for declared but undetected agent"` — call with `declaredAgents: ["claude", "codex"]`, `detectedAgents: ["claude"]`, verify codex option label is `"codex (not detected in project)"`
- `"does not show hint in label for detected agent"` — same inputs, verify claude option label is `"claude"`
- `"all declared agents not detected shows all with hint"` — call with `declaredAgents: ["claude", "codex"]`, `detectedAgents: []`, verify both labels contain `"(not detected in project)"`
- `"empty declaredAgents yields zero options"` — call with `declaredAgents: []`, verify multiselect receives empty options array (or that selectAgents returns `[]` immediately without prompting)
- `"pre-selects declared AND detected agents"` — call with `declaredAgents: ["claude", "codex"]`, `detectedAgents: ["claude"]`, verify `initialValues` is `["claude"]`
- `"returns empty array on cancel"` — unchanged behavior
- `"returns empty array on zero selection"` — unchanged behavior
- `"returns selected AgentId[] on valid selection"` — unchanged behavior

**Edge Cases**:
- Empty `declaredAgents` yields zero options: When `declaredAgents` is `[]`, the options array will be empty. The function should either pass an empty options array to multiselect (which may or may not work gracefully with `@clack/prompts`) or short-circuit and return `[]` immediately without prompting. Test both paths — if `@clack/prompts` does not handle empty options well, add a guard: `if (options.length === 0) return []`.
- All declared agents not detected: All options show with the `"(not detected in project)"` hint in the label, none are pre-selected. The user can still select any of them.
- Undeclared agents excluded entirely from multiselect: No option, no hint, no way to select. This is the core behavioral change from the current implementation.

**Context**:
> The spec states: "selectAgents() filters the multiselect to only agents present in the plugin's declaredAgents set. Undeclared agents are excluded entirely -- no hint needed because they're not shown." For the persistent hint: "Achieve this by embedding the hint directly in the option label (e.g., 'codex (not detected in project)') since @clack/prompts multiselect hint only renders when highlighted." The rationale: "Plugin authors declare specific agents intentionally -- a Claude-only skill may use features like sub-agents that don't exist in other agents. Respecting the declaration is correct. Adding a third agent makes showing irrelevant options more noticeable."

**Spec Reference**: `.workflows/cursor-agent-driver/specification/cursor-agent-driver/specification.md` — section "Agent Selection: Filter to Declared Agents"

## cursor-agent-driver-1-4 | approved

### Task 4: Auto-Skip Agent Selection When Unambiguous

**Problem**: When a plugin declares a single agent and that agent is detected locally, `selectAgents()` presents a multiselect prompt with one pre-checked option. This is unnecessary friction — the answer is unambiguous. However, if that single declared agent is NOT detected, the user should still be prompted to consciously opt in.

**Solution**: Add auto-skip logic to `selectAgents()` in `src/agent-select.ts` that bypasses the multiselect prompt when the result is unambiguous: exactly one declared agent and that agent is detected. In all other cases (one declared but not detected, multiple declared, zero declared), show the prompt as normal. When auto-skipping, log which agent was auto-selected.

**Outcome**: When a plugin declares one agent and it is detected, `selectAgents()` returns `[thatAgent]` without prompting and logs the auto-selection. When one agent is declared but not detected, the prompt appears with the `"(not detected in project)"` hint. When multiple agents are declared, the prompt always appears. Zero declared agents returns `[]` immediately (from Task 3's empty-options guard).

**Do**:
- In `src/agent-select.ts`, add auto-skip logic BEFORE the multiselect call (after building options, or before if simpler):
  - Check: `if (input.declaredAgents.length === 1 && detectedSet.has(input.declaredAgents[0]))` then auto-select
  - When auto-skipping: call `log.info(...)` with a message like `"Auto-selected agent: ${input.declaredAgents[0]}"` (use `@clack/prompts` `log.info`)
  - Return `[input.declaredAgents[0]]` immediately without calling `multiselect`
- Do NOT auto-skip when:
  - One declared agent is NOT detected — the user should see the prompt with the not-detected hint and consciously choose
  - Multiple declared agents — always show prompt regardless of how many are detected
  - Zero declared agents — already handled by Task 3's empty guard
- Update `tests/agent-select.test.ts`:
  - **Add**: `"auto-selects when one declared agent is detected"` — call with `declaredAgents: ["claude"]`, `detectedAgents: ["claude"]`, verify `multiselect` was NOT called, result is `["claude"]`, and `log.info` was called with a message containing `"claude"`
  - **Add**: `"shows prompt when one declared agent is not detected"` — call with `declaredAgents: ["claude"]`, `detectedAgents: []`, verify `multiselect` WAS called, and the option label contains `"(not detected in project)"`
  - **Add**: `"shows prompt when multiple declared agents with one detected"` — call with `declaredAgents: ["claude", "codex"]`, `detectedAgents: ["claude"]`, verify `multiselect` WAS called
  - **Add**: `"shows prompt when multiple declared agents all detected"` — call with `declaredAgents: ["claude", "codex"]`, `detectedAgents: ["claude", "codex"]`, verify `multiselect` WAS called
  - **Add**: `"returns empty array for zero declared agents without prompting"` — call with `declaredAgents: []`, verify `multiselect` was NOT called and result is `[]`
  - **Update** existing tests that call with `declaredAgents: ["claude"]` and `detectedAgents: ["claude"]`: these will now auto-skip, so tests that expected `multiselect` to be called need to be updated or their inputs changed to trigger the prompt (e.g., use two declared agents)

**Acceptance Criteria**:
- [ ] One declared + detected: `selectAgents()` returns `[agent]` without calling `multiselect`
- [ ] One declared + detected: `log.info` is called with a message indicating which agent was auto-selected
- [ ] One declared + NOT detected: `multiselect` is called, option shows `"(not detected in project)"` in label
- [ ] Multiple declared (any detection state): `multiselect` is always called
- [ ] Zero declared: returns `[]` without calling `multiselect`
- [ ] All updated `agent-select.test.ts` tests pass
- [ ] Existing cancel and zero-selection behavior unchanged for prompted cases

**Tests**:
- `"auto-selects when one declared agent is detected"` — `declaredAgents: ["claude"]`, `detectedAgents: ["claude"]`, verify no multiselect call, result `["claude"]`, log.info called
- `"logs auto-selected agent name"` — same scenario, verify `log.info` message contains the agent id
- `"shows prompt when one declared agent is not detected"` — `declaredAgents: ["codex"]`, `detectedAgents: []`, verify multiselect called with codex option having `"(not detected in project)"` in label
- `"shows prompt when multiple declared with one detected"` — `declaredAgents: ["claude", "codex"]`, `detectedAgents: ["claude"]`, verify multiselect called
- `"shows prompt when multiple declared all detected"` — `declaredAgents: ["claude", "codex"]`, `detectedAgents: ["claude", "codex"]`, verify multiselect called
- `"shows prompt when multiple declared none detected"` — `declaredAgents: ["claude", "codex"]`, `detectedAgents: []`, verify multiselect called
- `"returns empty array for zero declared agents without prompting"` — `declaredAgents: []`, `detectedAgents: ["claude"]`, verify no multiselect call, result `[]`

**Edge Cases**:
- One declared but not detected still shows prompt: The spec is explicit — "The 'not detected' edge case warrants user confirmation -- the user should consciously opt in to installing for an agent not present in the project." Even though there is only one option, the prompt must appear.
- Multiple declared with only one detected still shows prompt: The auto-skip rule is strictly "one declared AND detected." Multiple declared agents always show the prompt regardless of detection state. This gives the user control over which subset to install for.
- Zero declared agents: Returns `[]` immediately. This is handled by the empty-options guard from Task 3 but should also be tested here to confirm the auto-skip logic does not interfere.

**Context**:
> The spec defines three rules: "One declared, detected -> auto-select, skip prompt, log which agent was selected. One declared, NOT detected -> show prompt with '(not detected in project)' hint. Multiple declared -> always show prompt." The rationale: "Only fires when completely unambiguous. The 'not detected' edge case warrants user confirmation." This modifies the same `selectAgents()` function changed in Task 3 — it adds a pre-check before the multiselect call. The logging uses `@clack/prompts` `log.info` which is already imported in the file.

**Spec Reference**: `.workflows/cursor-agent-driver/specification/cursor-agent-driver/specification.md` — section "Agent Selection: Auto-Skip When Unambiguous"
