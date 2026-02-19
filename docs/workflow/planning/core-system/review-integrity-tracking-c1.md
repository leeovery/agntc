---
status: in-progress
created: 2026-02-19
cycle: 1
phase: Plan Integrity Review
topic: Core System
---

# Review Tracking: Core System - Integrity

## Findings

### 1. No Task Dependencies Set Across Entire Plan

**Severity**: Critical
**Plan Reference**: All phases, all tasks
**Category**: Dependencies and Ordering
**Change Type**: update-task

**Details**:
Every task in the plan has an empty `blocked_by` list and identical priority (2). This makes it impossible for an implementer to determine execution order from the dependency graph alone. Within each phase, there are clear sequential dependencies that must be modeled:

Phase 1: cs-1-10 (integration) depends on cs-1-2 through cs-1-9. cs-1-7 depends on cs-1-4 (declared agents) and cs-1-6 (driver registry). cs-1-8 depends on cs-1-6 (getTargetDir). cs-1-11 depends on cs-1-9 (readManifest).

Phase 2: cs-2-2 depends on cs-2-1 (copyPluginAssets). cs-2-4 depends on cs-2-3 (selectCollectionPlugins) and cs-2-1. cs-2-5 depends on cs-2-4 (collection flow exists).

Phase 3: cs-3-3 depends on cs-3-1 (Codex registered). cs-3-7 depends on cs-3-4 (HTTPS parsing). cs-3-8 depends on cs-3-6 (local path parsing). cs-3-11 depends on cs-3-9 and cs-3-10.

Phase 4: cs-4-2 depends on cs-4-1 (parameterized remove infrastructure). cs-4-4 depends on cs-4-3 (checkForUpdate). cs-4-5, cs-4-6, cs-4-7 depend on cs-4-4. cs-4-8 depends on cs-4-4/cs-4-5/cs-4-6/cs-4-7. cs-4-10 depends on cs-4-1 and cs-4-4.

Phase 5: cs-5-2 depends on cs-5-1 (checkAllForUpdates). cs-5-3 depends on cs-5-2. cs-5-4/cs-5-5/cs-5-6 depend on cs-5-3. cs-5-7 depends on cs-5-2 through cs-5-6. cs-5-9 depends on cs-5-8. cs-5-10 depends on cs-5-8/cs-5-9.

Priority should also differentiate: foundation tasks (priority 1), happy-path tasks (priority 2), edge-case/refinement tasks (priority 3).

This is a critical issue because without dependencies, `tick ready` will return all tasks as ready simultaneously, and an implementer could attempt tasks in any order, leading to failures.

**Current**:
All tasks have `blocked_by: []` and `priority: 2`.

**Proposed**:
Set the following blocked_by relationships and priorities via tick commands. The complete dependency graph:

**Phase 1** (tick-dea5ee):
- cs-1-1 (tick-0ba43c): priority 0, blocked_by []
- cs-1-2 (tick-be4c96): priority 1, blocked_by [cs-1-1]
- cs-1-3 (tick-3dff00): priority 1, blocked_by [cs-1-1]
- cs-1-4 (tick-5024dd): priority 1, blocked_by [cs-1-1]
- cs-1-5 (tick-3f9f32): priority 1, blocked_by [cs-1-4]
- cs-1-6 (tick-cc248f): priority 1, blocked_by [cs-1-1]
- cs-1-7 (tick-e86117): priority 1, blocked_by [cs-1-4, cs-1-6]
- cs-1-8 (tick-601f31): priority 1, blocked_by [cs-1-6]
- cs-1-9 (tick-aaa446): priority 1, blocked_by [cs-1-1]
- cs-1-10 (tick-d7ffd9): priority 2, blocked_by [cs-1-2, cs-1-3, cs-1-4, cs-1-5, cs-1-6, cs-1-7, cs-1-8, cs-1-9]
- cs-1-11 (tick-15542a): priority 2, blocked_by [cs-1-9]

**Phase 2** (tick-aed71e):
- cs-2-1 (tick-a4cc6d): priority 1, blocked_by []
- cs-2-2 (tick-456e1a): priority 2, blocked_by [cs-2-1]
- cs-2-3 (tick-46b8a2): priority 1, blocked_by []
- cs-2-4 (tick-f68023): priority 2, blocked_by [cs-2-1, cs-2-3]
- cs-2-5 (tick-5820dd): priority 2, blocked_by [cs-2-4]

**Phase 3** (tick-ef070a):
- cs-3-1 (tick-3f18d0): priority 1, blocked_by []
- cs-3-2 (tick-947bd2): priority 1, blocked_by [cs-3-1]
- cs-3-3 (tick-1abe95): priority 2, blocked_by [cs-3-1]
- cs-3-4 (tick-d63c08): priority 1, blocked_by []
- cs-3-5 (tick-448957): priority 1, blocked_by []
- cs-3-6 (tick-db20a7): priority 1, blocked_by []
- cs-3-7 (tick-0b36b0): priority 1, blocked_by [cs-3-4]
- cs-3-8 (tick-d24318): priority 2, blocked_by [cs-3-6]
- cs-3-9 (tick-400db7): priority 1, blocked_by []
- cs-3-10 (tick-081566): priority 1, blocked_by []
- cs-3-11 (tick-f5b1ac): priority 2, blocked_by [cs-3-9, cs-3-10]

**Phase 4** (tick-d85f8a):
- cs-4-1 (tick-35621c): priority 1, blocked_by []
- cs-4-2 (tick-5bc8a9): priority 2, blocked_by [cs-4-1]
- cs-4-3 (tick-76e6c7): priority 1, blocked_by []
- cs-4-4 (tick-2a89a4): priority 2, blocked_by [cs-4-3]
- cs-4-5 (tick-a1ef32): priority 2, blocked_by [cs-4-4]
- cs-4-6 (tick-496cae): priority 2, blocked_by [cs-4-3]
- cs-4-7 (tick-027b1d): priority 2, blocked_by [cs-4-4]
- cs-4-8 (tick-7c0be9): priority 3, blocked_by [cs-4-4, cs-4-5, cs-4-6, cs-4-7]
- cs-4-9 (tick-4ec9ff): priority 2, blocked_by [cs-4-4]
- cs-4-10 (tick-32d35f): priority 3, blocked_by [cs-4-1, cs-4-4]

**Phase 5** (tick-71886c):
- cs-5-1 (tick-0f3e21): priority 1, blocked_by []
- cs-5-2 (tick-b0cb9a): priority 1, blocked_by [cs-5-1]
- cs-5-3 (tick-d19707): priority 2, blocked_by [cs-5-2]
- cs-5-4 (tick-9d07b8): priority 2, blocked_by [cs-5-3]
- cs-5-5 (tick-ba9807): priority 2, blocked_by [cs-5-3]
- cs-5-6 (tick-39a172): priority 2, blocked_by [cs-5-3]
- cs-5-7 (tick-bb6c3b): priority 3, blocked_by [cs-5-2, cs-5-3, cs-5-4, cs-5-5, cs-5-6]
- cs-5-8 (tick-95a48e): priority 1, blocked_by []
- cs-5-9 (tick-e908a4): priority 2, blocked_by [cs-5-8]
- cs-5-10 (tick-1028ba): priority 3, blocked_by [cs-5-8, cs-5-9]

**Resolution**: Skipped
**Notes**: tick ready returns tasks in correct order. Priorities and explicit dependencies not needed.

---

### 2. cs-3-3 Too Small for Standalone Task

**Severity**: Important
**Plan Reference**: Phase 3 / cs-3-3
**Category**: Scope and Granularity
**Change Type**: remove-task

**Details**:
cs-3-3 ("Agent Multiselect with Pre-Selection and Warnings") is described as: "Review src/agent-select.ts for two-agent correctness. Add/update tests for all two-agent combinations. Verify spec examples work. Fix any gaps found." This is not a TDD cycle producing new functionality -- it is verification that existing code (cs-1-7) works with a second agent now registered (cs-3-1). The tests from cs-1-7 already cover the multiselect logic generically (pre-selection, warnings, cancel). Adding two-agent test scenarios is a natural part of cs-3-1's verification.

Per task-design.md: "A task is probably too small if it only makes sense as a step within another task." The two-agent verification is a step within cs-3-1 (registering Codex and confirming the system works).

**Current**:
cs-3-3 as a standalone task (tick-1abe95):

**Problem**: Phase 1 selectAgents built with Claude only. Need to verify and enhance for two-agent scenarios.

**Solution**: Validate selectAgents with both agents registered. Verify pre-selection (declared intersection detected), unsupported warnings, edge cases.

**Outcome**: Multiselect correctly handles all two-agent declared/detected combinations.

**Do**:
1. Review src/agent-select.ts for two-agent correctness
2. Add/update tests for all two-agent combinations
3. Verify spec examples work
4. Fix any gaps found

**Proposed**:
Merge cs-3-3's test additions into cs-3-1 (Codex Agent Driver). Add to cs-3-1's Do section: "6. Add tests to agent-select.test.ts verifying two-agent pre-selection/warning combinations with both Claude and Codex registered." Add to cs-3-1's Tests: "two-agent pre-selection combinations match spec examples, unsupported warning on undeclared agent with both registered, empty declaredAgents warns both agents". Add to cs-3-1's Acceptance Criteria: "- Agent multiselect pre-selection works correctly with both agents registered per spec examples".

Remove cs-3-3 as a standalone task.

**Resolution**: Pending
**Notes**:

---

### 3. cs-4-9 Overlaps Significantly with cs-1-3 Retry Logic

**Severity**: Important
**Plan Reference**: Phase 4 / cs-4-9
**Category**: Scope and Granularity
**Change Type**: update-task

**Details**:
cs-1-3 already implements the full retry logic (3x transient, immediate abort on auth) inside cloneSource. cs-4-9 ("Update Command: Network Retry") re-verifies this same retry logic works during update, but cloneSource is the same function called in both contexts. The only unique content in cs-4-9 is handling post-nuke clone failure context messaging -- after files have been nuked, a clone failure leaves the plugin in a degraded state and the error should communicate this.

This unique concern (post-nuke error context) is better placed in cs-4-4 (Single Plugin Nuke-and-Reinstall), which already orchestrates the nuke-then-clone sequence and would naturally handle clone failure after nuke.

**Current**:
cs-4-9 (tick-4ec9ff) as standalone task with Do:
1. Ensure cloneSource errors after nuke caught with context message
2. Post-nuke clone failure: surface git error clearly with context that files have been removed
3. Verify 3x retry applies during update
4. Verify auth failure immediate abort
5. Create update-specific clone failure tests

**Proposed**:
Merge cs-4-9's unique content into cs-4-4. Add to cs-4-4's Do section: "7. Handle clone failure after nuke: catch cloneSource errors with context message indicating files have been removed and the plugin is in a degraded state. Surface git error clearly."

Add to cs-4-4's Acceptance Criteria:
- Post-nuke clone failure surfaces git error with context that files have been removed
- Temp dir cleaned on clone failure during update

Add to cs-4-4's Tests:
- clone failure after nuke surfaces error with degraded-state context
- post-nuke clone failure cleans temp dir
- all-plugins mode continues after one plugin's clone failure

Remove cs-4-9 as a standalone task.

**Resolution**: Pending
**Notes**:

---

### 4. cs-5-10 and cs-4-10 Have Overlapping Scope

**Severity**: Important
**Plan Reference**: Phase 4 / cs-4-10 and Phase 5 / cs-5-10
**Category**: Scope and Granularity
**Change Type**: update-task

**Details**:
cs-4-10 creates output formatting for update and remove commands. cs-5-10 creates a unified summary renderer module (renderAddSummary, renderUpdateSummary, renderRemoveSummary) and wires it into "all commands replacing inline summary code." This means cs-5-10 will rewrite the formatting built in cs-4-10. An implementer following the plan sequentially will build output formatting in cs-4-10, then rebuild it in cs-5-10.

cs-4-10 should focus on getting the output correct inline, and cs-5-10 should clarify it is a refactoring task that extracts and unifies existing formatting code rather than building from scratch. This makes the relationship clear and avoids wasted work.

**Current**:
cs-5-10 Problem: "Summary output across commands inconsistent. Need unified rendering for all outcome combinations."
cs-5-10 Solution: "Create summary renderer module: renderAddSummary, renderUpdateSummary, renderRemoveSummary. Handles per-plugin outcomes, per-agent counts (non-zero only), all status variants. Wire into all commands."

**Proposed**:
Update cs-5-10's Problem to: "Summary output is implemented inline across add (cs-1-10, cs-2-2, cs-2-4), update (cs-4-10), and remove (cs-4-1, cs-4-2) commands. Code is duplicated and formatting may have diverged. Need to extract into a single module for consistency and maintainability."

Update cs-5-10's Solution to: "Extract existing inline summary formatting from all commands into a shared src/summary.ts module with renderAddSummary, renderUpdateSummary, renderRemoveSummary. Unify formatting patterns. Wire back into all commands, replacing inline code. No new output behaviour -- this is a refactoring task ensuring consistency with spec examples."

**Resolution**: Pending
**Notes**:

---

### 5. cs-1-1 Do Section Exceeds Scope Signal (12 Steps)

**Severity**: Minor
**Plan Reference**: Phase 1 / cs-1-1
**Category**: Scope and Granularity
**Change Type**: update-task

**Details**:
Task-design.md says a task is "probably too big" if the Do section exceeds 5 concrete steps. cs-1-1 has 12 steps. However, this is project scaffolding -- inherently setup-heavy boilerplate with no meaningful split point. Splitting it would create tasks that fail the "too small" test (single line changes, mechanical housekeeping). The task is correctly scoped as a single unit but the Do section should be condensed to reduce apparent complexity.

**Current**:
**Do**:
1. Create tsconfig.json -- ES2022/NodeNext, strict mode, rootDir src/, outDir dist/
2. Install deps: typescript, tsup, vitest (dev); commander, @clack/prompts (runtime)
3. Update package.json -- type: module, bin: { "agntc": "dist/cli.js" }, scripts for build/test
4. Create tsup.config.ts -- entry src/cli.ts, format esm, target node20, dts, shebang banner
5. Create src/cli.ts -- Commander program with add (required <source> arg) and list subcommands
6. Create src/index.ts -- empty barrel export
7. Create src/commands/add.ts -- stub with @clack/prompts intro/outro
8. Create src/commands/list.ts -- stub with @clack/prompts intro/outro
9. Create vitest.config.ts
10. Create tests/cli.test.ts -- smoke tests for CLI wiring
11. Ensure .gitignore covers dist/ and node_modules/
12. Build and verify

**Proposed**:
**Do**:
1. Scaffold TypeScript project: tsconfig.json (ES2022/NodeNext, strict), package.json (type: module, bin: dist/cli.js, build/test scripts), tsup.config.ts (esm, node20, dts, shebang), vitest.config.ts, .gitignore (dist/, node_modules/)
2. Install dependencies: typescript, tsup, vitest (dev); commander, @clack/prompts (runtime)
3. Create src/cli.ts with Commander program: add (required `<source>` arg) and list subcommands
4. Create src/commands/add.ts and src/commands/list.ts as stubs with @clack/prompts intro/outro
5. Create tests/cli.test.ts with smoke tests for CLI wiring, build and verify

**Resolution**: Pending
**Notes**:

---

### 6. cs-1-10 Do Section Exceeds Scope Signal (13 Steps)

**Severity**: Minor
**Plan Reference**: Phase 1 / cs-1-10
**Category**: Scope and Granularity
**Change Type**: update-task

**Details**:
Same concern as cs-1-1 but for the integration task. cs-1-10 has 13 Do steps. As an integration task wiring existing tested components, the steps are predominantly wiring calls, not distinct implementation work. The task is correctly scoped but the Do section should be condensed.

**Current**:
**Do**:
1. Rewrite src/commands/add.ts with full pipeline
2. @clack/prompts intro/outro, spinner for clone+copy
3. Parse source -> on error: cancel message, exit 1
4. Clone -> spinner, on error: git error message, cleanup, exit 1
5. Read config -> null: "Collections not yet supported", cleanup, exit 0. ConfigError: message, cleanup, exit 1
6. Detect type -> bare-skill: continue. plugin: "not yet supported", exit 0. not-agntc: warning, exit 0
7. Detect agents -> getRegisteredAgentIds + detect each
8. Agent multiselect -> empty: "Cancelled", cleanup, exit 0
9. Copy bare skill -> spinner, on error: cleanup, exit 1
10. Write manifest -> readManifest, addEntry, writeManifest. On error: cleanup, exit 1
11. Summary -> "Installed {key}@{ref}" with per-agent counts
12. Cleanup -> always in finally block, swallow cleanup errors
13. Create tests/commands/add.test.ts mocking all deps

**Proposed**:
**Do**:
1. Rewrite src/commands/add.ts with full pipeline: parse -> clone -> config -> detect type -> detect agents -> select agents -> copy -> manifest -> summary. Use @clack/prompts intro/outro and spinners for clone+copy.
2. Error handling at each step: cancel message + cleanup + exit 1. Null config or plugin type -> "not yet supported" + cleanup + exit 0. Empty agent selection -> "Cancelled" + cleanup + exit 0.
3. Write manifest via readManifest + addEntry + writeManifest. Summary shows key, ref, per-agent skill count.
4. Cleanup temp dir in finally block (swallow cleanup errors). Detect agents via getRegisteredAgentIds + per-agent detect().
5. Create tests/commands/add.test.ts mocking all dependencies: full happy path, error at each step, cleanup on all paths.

**Resolution**: Pending
**Notes**:

---

### 7. cs-3-6 Makes parseSource Async Without Noting Impact on Existing Callers

**Severity**: Minor
**Plan Reference**: Phase 3 / cs-3-6
**Category**: Task Self-Containment
**Change Type**: update-task

**Details**:
cs-3-6 step 6 says "Make parseSource async (fs.stat needed). Update callers." but the task doesn't enumerate which callers need updating or note that this is a breaking change to the function signature. An implementer needs to know that cs-1-2's synchronous parseSource used in cs-1-10's add command (and any tests) must be updated. This is important context for self-containment.

**Current**:
Do step 6: "Make parseSource async (fs.stat needed). Update callers."

**Proposed**:
Do step 6: "Make parseSource async (fs.stat needed for path validation). Update callers: src/commands/add.ts (await parseSource), and all parseSource tests in tests/source-parser.test.ts (async test functions, await calls). This is a signature change affecting the add command pipeline."

**Resolution**: Pending
**Notes**:
