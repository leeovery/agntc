---
status: in-progress
created: 2026-02-22
cycle: 2
phase: Plan Integrity Review
topic: Plugin Authoring
---

# Review Tracking: Plugin Authoring - Integrity

## Findings

### 1. All Phase 2 tasks missing required Tests field

**Severity**: Important
**Plan Reference**: Phase 2 / tasks 2-1 through 2-5 (tick-e6b318, tick-ca0f0a, tick-640df5, tick-01d772, tick-d1d22a)
**Category**: Task Template Compliance
**Change Type**: add-to-task

**Details**:
All five Phase 2 tasks are missing the required Tests field. Per task-design.md, every task must include "At least one test name; include edge cases, not just happy path." The Tests field provides concrete test names that guide the TDD cycle -- without them, an implementer must invent test names from the Acceptance Criteria, which adds a design decision that the plan should have made.

Phase 1 and Phase 3 (except 3-4) have well-written Tests sections. Phase 2 tasks have Acceptance Criteria but no Tests.

**Current**:
Task tick-e6b318 (Scaffold plugin files and directories) -- no Tests field.
Task tick-ca0f0a (Plugin preview and success message) -- no Tests field.
Task tick-640df5 (Scaffold collection structure) -- no Tests field.
Task tick-01d772 (Collection preview and success message) -- no Tests field.
Task tick-d1d22a (End-to-end type routing) -- no Tests field.

**Proposed**:
Add the following Tests sections to each task:

**tick-e6b318** (Scaffold plugin files and directories) -- append after Edge Cases:

**Tests**:
- "creates all four items in empty directory" -- scaffold in clean temp dir, verify agntc.json, skills/my-skill/SKILL.md, agents/, hooks/ all exist
- "writes agntc.json with selected agents" -- verify JSON content matches { agents: ["claude"] } with 2-space indent
- "writes SKILL.md with spec template" -- verify content matches frontmatter template exactly
- "skips agntc.json when it already exists" -- pre-create agntc.json, scaffold, verify original content unchanged and filename in skipped
- "skips SKILL.md when it already exists inside skills/my-skill/" -- pre-create the nested file, scaffold, verify unchanged
- "creates SKILL.md when skills/ exists but SKILL.md does not" -- create skills/my-skill/ directory only, scaffold, verify SKILL.md created
- "skips agents/ when it already exists" -- pre-create agents/, scaffold, verify in skipped
- "skips hooks/ when it already exists" -- pre-create hooks/, scaffold, verify in skipped
- "created and skipped arrays account for all four items" -- scaffold with some items existing, verify created.length + skipped.length === 4

**tick-ca0f0a** (Plugin preview and success message) -- append after Edge Cases:

**Tests**:
- "builds plugin preview lines matching spec tree format" -- verify buildPluginPreviewLines() returns lines with agntc.json, skills/, my-skill/, SKILL.md, agents/, hooks/ at correct indentation
- "preview is shown before confirmation prompt" -- mock @clack/prompts, verify note/log called before confirm
- "success message is 'Done. Add your skills, agents, and hooks.'" -- verify the exact string
- "reports created items when all items are new" -- pass scaffold result with all created, verify output shows success without skipped section
- "reports mixed created and skipped items" -- pass scaffold result with some created and some skipped, verify both sections present
- "cancelling at confirm returns false" -- mock confirm returning Symbol("cancel"), verify return is false

**tick-640df5** (Scaffold collection structure) -- append after Edge Cases:

**Tests**:
- "creates my-plugin/ subtree in empty directory" -- scaffold in clean temp dir, verify my-plugin/agntc.json, my-plugin/skills/my-skill/SKILL.md, my-plugin/agents/, my-plugin/hooks/ all exist
- "does not create root agntc.json" -- scaffold, verify no agntc.json at root directory
- "my-plugin/agntc.json content matches agent selection" -- verify JSON content matches { agents: ["claude", "codex"] }
- "my-plugin/skills/my-skill/SKILL.md matches spec template" -- verify content matches frontmatter template exactly
- "skips my-plugin/agntc.json when it already exists" -- pre-create, scaffold, verify unchanged and in skipped
- "checks items individually when my-plugin/ already exists" -- pre-create my-plugin/ with partial contents, scaffold, verify only missing items created
- "return paths all prefixed with my-plugin/" -- verify every entry in created and skipped starts with "my-plugin/"

**tick-01d772** (Collection preview and success message) -- append after Edge Cases:

**Tests**:
- "builds collection preview lines with my-plugin/ at root" -- verify buildCollectionPreviewLines() returns lines with my-plugin/ first, then indented agntc.json, skills/, etc.
- "preview shows correct 2-space indentation" -- verify indentation levels match spec
- "success message is 'Done. Rename `my-plugin/` and duplicate for each plugin in your collection.'" -- verify exact string
- "reports created items when all items are new" -- pass scaffold result with all created, verify output shows success without skipped section
- "reports mixed created and skipped with my-plugin/ prefixed paths" -- pass result with some skipped, verify paths shown with prefix
- "cancelling at confirm returns false" -- mock confirm returning Symbol("cancel"), verify return is false

**tick-d1d22a** (End-to-end type routing) -- append after Edge Cases:

**Tests**:
- "routes plugin type through plugin scaffold" -- mock type->plugin, agents->["claude"], confirm->true; verify scaffoldPlugin called, scaffoldSkill NOT called
- "routes collection type through collection scaffold" -- mock type->collection, agents->["claude"], confirm->true; verify scaffoldCollection called
- "skill type continues to work" -- mock type->skill; verify scaffoldSkill called (Phase 1 regression check)
- "passes agent selection to scaffoldPlugin" -- mock agents->["claude","codex"]; verify scaffoldPlugin receives correct agents
- "passes agent selection to scaffoldCollection" -- mock agents->["codex"]; verify scaffoldCollection receives correct agents
- "cancel at type selection exits cleanly for all types" -- mock type->null; verify no scaffold function called
- "cancel at agent selection exits cleanly" -- mock type->plugin, agents->null; verify scaffoldPlugin NOT called
- "cancel at confirm exits cleanly" -- mock type->collection, agents->["claude"], confirm->false; verify scaffoldCollection NOT called
- "displays correct success message for plugin" -- verify outro contains "Done. Add your skills, agents, and hooks."
- "displays correct success message for collection" -- verify outro contains "Done. Rename `my-plugin/`..."

**Resolution**: Pending
**Notes**:

---

### 2. Task 3-4 missing required Tests field

**Severity**: Important
**Plan Reference**: Phase 3 / plugin-authoring-3-4 (tick-1010d8)
**Category**: Task Template Compliance
**Change Type**: add-to-task

**Details**:
Task 3-4 "Output report distinguishes overwritten from created and skipped" is missing the required Tests field. Same issue as Finding 1 but separated because it is a different phase.

**Current**:
Task tick-1010d8 -- no Tests field. Ends after Edge Cases section.

**Proposed**:
Add the following Tests section to task tick-1010d8, after Edge Cases:

**Tests**:
- "renders created files with creation indicator" -- pass result with created entries, verify output contains the positive indicator
- "renders skipped files with skip indicator and label" -- pass result with skipped entries, verify "(skipped)" label present
- "renders overwritten files with overwrite indicator and label" -- pass result with overwritten entries, verify "(overwritten)" label present
- "all three statuses are visually distinguishable" -- pass result with all three statuses, verify each uses a different indicator
- "fresh-run report has no overwritten section" -- pass result with empty overwritten array, verify no overwrite indicator in output
- "reconfigure report renders mixed statuses correctly" -- pass result with one overwritten, one skipped, one created; verify all three appear with correct labels
- "works for skill type scaffold result" -- pass a skill-shaped result, verify rendering
- "works for plugin type scaffold result" -- pass a plugin-shaped result with directories, verify rendering
- "report entries appear in scaffold processing order" -- pass result with specific ordering, verify output preserves order

**Resolution**: Pending
**Notes**:

---

### 3. Plan.md Phase 3 task table name for 3-1 does not match tick title

**Severity**: Minor
**Plan Reference**: Phase 3 task table in plan.md / tick-7a71b4
**Category**: Task Template Compliance
**Change Type**: update-task

**Details**:
The plan.md task table lists task 3-1 as "Pre-check detection, orchestrator wiring, and cancel behavior" but the tick title for tick-7a71b4 is "Pre-check detection and reconfigure-or-cancel prompt". These should be consistent. The plan.md name better describes the expanded scope (from cycle 1 review), so the tick title should be updated to match.

**Current**:
Tick title for tick-7a71b4: "Pre-check detection and reconfigure-or-cancel prompt"

**Proposed**:
Update tick title for tick-7a71b4 to: "Pre-check detection, orchestrator wiring, and cancel behavior"

**Resolution**: Pending
**Notes**: The plan.md name was updated as part of cycle 1 fixes to reflect the absorbed orchestrator wiring from removed task 3-2. The tick title was not updated to match.

---
