# Plan: Cursor Agent Driver

## Phase 1: Cursor Driver and Agent Selection Overhaul
status: approved
approved_at: 2026-03-27

**Goal**: Add the Cursor agent driver and rework agent selection to filter by declared agents, show persistent not-detected hints, and auto-skip when unambiguous.

**Why this order**: The driver is the foundational new capability, and the selection changes are motivated by the third agent's existence. The spec explicitly states "Adding a third agent makes showing irrelevant options more noticeable." Both must land together to deliver correct behavior for single-plugin and standalone add flows. The driver alone would be too thin (create one file, update two lines in two files); the selection changes alone lack motivation without the third agent. Together they form a complete vertical slice: a new agent that works end-to-end with proper selection UX.

**Acceptance**:
- [ ] CursorDriver class exists at `src/drivers/cursor-driver.ts` implementing `AgentDriver` with three-tier detection (`.cursor/` project dir, `which cursor` CLI, `~/.cursor/` home fallback) and `TARGET_DIRS` of `{ skills: ".cursor/skills" }` (Partial, same shape as CodexDriver)
- [ ] `AgentId` union type in `src/drivers/types.ts` is `"claude" | "codex" | "cursor"`
- [ ] `KNOWN_AGENTS` in `src/config.ts` includes `"cursor"`
- [ ] Driver registry in `src/drivers/registry.ts` maps `"cursor"` to a `CursorDriver` instance; `getRegisteredAgentIds()` returns all three agent IDs
- [ ] `selectAgents()` only shows agents present in `declaredAgents` — undeclared agents are excluded from multiselect options entirely
- [ ] Declared agents that are not detected show `"(not detected in project)"` embedded in the option label (visible at all times, not only when highlighted)
- [ ] When exactly one declared agent is detected, `selectAgents()` auto-selects it, skips the prompt, and logs which agent was selected
- [ ] When one declared agent exists but is not detected, the prompt is shown with the not-detected hint
- [ ] When multiple agents are declared, the prompt is always shown regardless of detection status
- [ ] All existing driver, registry, config, agent-select, and detect-agents tests pass (updated where they assert on the two-agent set)
- [ ] New CursorDriver unit tests cover all three detection tiers (project dir, which, home dir), early-return short-circuiting, and `getTargetDir` for skills/agents/hooks/unknown asset types

## Phase 2: Collection Pipeline Silent Skip for Undeclared Agents
status: approved
approved_at: 2026-03-27

**Goal**: Replace the warn-and-install-anyway behavior in the collection pipeline with per-plugin agent filtering that silently skips undeclared agents.

**Why this order**: This phase operates on the collection-specific iteration logic in `runCollectionPipeline` (`src/commands/add.ts`), which is a separate code path from the single-plugin flow. It depends on Phase 1's filtered agent selection being in place so the `selectAgents` call already shows only declared agents. The collection pipeline's per-plugin filtering is an independent concern: it determines what happens *after* selection when iterating over multiple plugins with different agent declarations.

**Acceptance**:
- [ ] Collection pipeline filters `selectedAgents` to each plugin's declared agents before copying files — no files are copied for agents a plugin does not declare
- [ ] The "does not declare support for ... Installing at your own risk" warning code is removed entirely
- [ ] Manifest entry for each plugin records only the agents it was actually installed for (intersection of selected and declared), not the full `selectedAgents` array
- [ ] Plugins with zero applicable agents after filtering are silently skipped — no manifest entry, no file copy, no summary line
- [ ] The union of declared agents across all selected plugins still drives the `selectAgents` prompt correctly (existing union behavior preserved)
- [ ] Existing collection pipeline tests updated and passing; new tests cover the per-plugin filtering and silent-skip scenarios
