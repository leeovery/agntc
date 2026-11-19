---
status: complete
created: 2026-02-22
cycle: 1
phase: Plan Integrity Review
topic: Plugin Authoring
---

# Review Tracking: Plugin Authoring - Integrity

## Findings

### 1. Task 3-2 too granular -- merge into task 3-1

**Severity**: Important
**Plan Reference**: Phase 3 / plugin-authoring-3-2 (tick-df1d66) and plugin-authoring-3-1 (tick-7a71b4)
**Category**: Scope and Granularity
**Change Type**: remove-task

**Details**:
Task 3-2 "Cancel at pre-check exits cleanly" is too thin for a standalone TDD cycle. Its core behavior is: (1) wire preCheck() as the first call in the orchestrator, (2) if cancel, exit early. The wiring step is a single if-branch, and the cancel test is one mock + one assertion. Meanwhile, task 3-1 creates the preCheck function but stops short of integrating it -- meaning 3-1 produces a function that nothing calls, which isn't a complete vertical slice either.

Merging 3-2's orchestrator wiring into 3-1 produces a proper vertical slice: create the preCheck module AND wire it into the init orchestrator AND verify all three return paths (fresh proceeds, cancel exits, reconfigure proceeds with flag). This is one natural TDD cycle.

The cancel-specific AC and tests from 3-2 should be absorbed into 3-1. The reconfigure flag passing remains in 3-3 where the overwrite behavior is implemented.

**Current**:
Task tick-df1d66 "Cancel at pre-check exits cleanly":

**Problem**: When the user selects "Cancel" at the pre-check prompt (or presses Ctrl+C), the init command must exit immediately without writing any files or showing further prompts.

**Solution**: Wire the pre-check result into the init command orchestration so that a cancel status short-circuits the entire flow. The orchestrator calls preCheck() first; if the result is cancel, it calls @clack/prompts cancel() and returns without entering type selection.

**Outcome**: Selecting "Cancel" at the pre-check prompt exits the init command gracefully. No files are created, modified, or deleted. No subsequent prompts are shown.

**Do**:
- In init command orchestrator (src/commands/init.ts), add preCheck(cwd) as first call before prompt flow
- If preCheck returns { status: "cancel" }, call @clack/prompts cancel("Operation cancelled.") and return early
- If preCheck returns { status: "fresh" }, proceed with normal prompt flow
- If preCheck returns { status: "reconfigure" }, proceed with prompt flow but pass reconfigure: true flag to scaffold step
- Create tests verifying orchestrator exits cleanly on cancel

**Acceptance Criteria**:
- [ ] When pre-check returns cancel, no type selection prompt is shown
- [ ] When pre-check returns cancel, no files are written to disk
- [ ] When pre-check returns cancel, @clack/prompts cancel() is called
- [ ] When pre-check returns fresh, prompt flow proceeds as in Phase 1/2
- [ ] When pre-check returns reconfigure, prompt flow proceeds with reconfigure flag
- [ ] Process exits with code 0 on cancel

**Spec Reference**: .workflows/specification/plugin-authoring/specification.md -- Step 1: Pre-check

**Proposed**:
Remove task tick-df1d66. Its content is absorbed into the updated task 3-1 (see Finding 2).

**Resolution**: Fixed
**Notes**: This removal pairs with Finding 2, which updates task 3-1 to absorb the orchestrator wiring and cancel behavior.

---

### 2. Task 3-1 incomplete vertical slice -- absorb orchestrator wiring from 3-2

**Severity**: Important
**Plan Reference**: Phase 3 / plugin-authoring-3-1 (tick-7a71b4)
**Category**: Vertical Slicing
**Change Type**: update-task

**Details**:
Task 3-1 creates the preCheck module but does not wire it into the orchestrator. This means 3-1 produces a function that nothing calls -- not a complete vertical slice. The orchestrator wiring and cancel-path verification from task 3-2 should be merged into 3-1 so it delivers a complete, testable behavior: preCheck exists, is called by the orchestrator, and its three return paths (fresh, cancel, reconfigure) route correctly.

**Current**:
**Problem**: When a plugin author runs npx agntc init in a directory that already contains agntc.json, the flow currently has no guard. The spec requires detecting this state and presenting an explicit choice before any other prompts appear.

**Solution**: Create a pre-check module that tests for agntc.json existence at process.cwd() before entering the prompt flow. When found, display a @clack/prompts warning message ("This directory is already initialized.") and present a select prompt with "Reconfigure" and "Cancel" options.

**Outcome**: When agntc.json exists at cwd root, the user sees the warning and two options before any other prompts. The pre-check function returns a structured result that downstream orchestration can use.

**Do**:
- Create src/init/pre-check.ts exporting async preCheck(cwd: string) function
- Use node:fs/promises access() to check for agntc.json at the given path
- If agntc.json does not exist, return { status: "fresh" }
- If agntc.json exists, use @clack/prompts log.warn() to display warning then use select() for Reconfigure/Cancel
- If user selects "Reconfigure", return { status: "reconfigure" }
- If user selects "Cancel" or cancels (isCancel), return { status: "cancel" }
- Define and export PreCheckResult type
- Create tests/init/pre-check.test.ts

**Acceptance Criteria**:
- [ ] When agntc.json exists at cwd, warning "This directory is already initialized." is displayed
- [ ] When agntc.json exists, select prompt with "Reconfigure" and "Cancel" options shown
- [ ] Selecting "Reconfigure" returns { status: "reconfigure" }
- [ ] Selecting "Cancel" returns { status: "cancel" }
- [ ] When agntc.json does not exist, returns { status: "fresh" } with no prompts
- [ ] Empty or malformed agntc.json still triggers pre-check (existence check only)
- [ ] Collection directories with no root agntc.json do not trigger pre-check

**Spec Reference**: .workflows/specification/plugin-authoring/specification.md -- Step 1: Pre-check

**Proposed**:
**Problem**: When a plugin author runs npx agntc init in a directory that already contains agntc.json, the flow currently has no guard. The spec requires detecting this state and presenting an explicit choice before any other prompts appear. The pre-check must also be wired into the init orchestrator so it gates the entire flow.

**Solution**: Create a pre-check module that tests for agntc.json existence at process.cwd() before entering the prompt flow. When found, display a @clack/prompts warning message ("This directory is already initialized.") and present a select prompt with "Reconfigure" and "Cancel" options. Wire preCheck() into the init command orchestrator as the first call, routing on its result.

**Outcome**: When agntc.json exists at cwd root, the user sees the warning and two options before any other prompts. Selecting "Cancel" exits immediately without writing files or showing further prompts. Selecting "Reconfigure" enters the full prompt flow with a reconfigure flag. When agntc.json does not exist, the prompt flow proceeds unchanged.

**Do**:
- Create src/init/pre-check.ts exporting async preCheck(cwd: string) function
- Use node:fs/promises access() to check for agntc.json at the given path
- If agntc.json does not exist, return { status: "fresh" }
- If agntc.json exists, use @clack/prompts log.warn() to display warning then use select() for Reconfigure/Cancel
- If user selects "Reconfigure", return { status: "reconfigure" }
- If user selects "Cancel" or cancels (isCancel), return { status: "cancel" }
- Define and export PreCheckResult type
- In src/commands/init.ts runInit(), add preCheck(process.cwd()) as the first call before any prompt flow
- If preCheck returns { status: "cancel" }, call p.cancel("Operation cancelled.") and throw new ExitSignal(0)
- If preCheck returns { status: "fresh" }, proceed with existing prompt flow unchanged
- If preCheck returns { status: "reconfigure" }, proceed with prompt flow but pass reconfigure: true flag through to scaffold step (reconfigure overwrite behavior is implemented in task 3-3)
- Create tests/init/pre-check.test.ts for the preCheck module
- Create or extend tests/commands/init.test.ts to verify orchestrator routing on preCheck results

**Acceptance Criteria**:
- [ ] When agntc.json exists at cwd, warning "This directory is already initialized." is displayed
- [ ] When agntc.json exists, select prompt with "Reconfigure" and "Cancel" options shown
- [ ] Selecting "Reconfigure" returns { status: "reconfigure" }
- [ ] Selecting "Cancel" returns { status: "cancel" }
- [ ] When agntc.json does not exist, returns { status: "fresh" } with no prompts
- [ ] Empty or malformed agntc.json still triggers pre-check (existence check only)
- [ ] Collection directories with no root agntc.json do not trigger pre-check
- [ ] When pre-check returns cancel, no type selection prompt is shown
- [ ] When pre-check returns cancel, no files are written to disk
- [ ] When pre-check returns cancel, p.cancel() is called and process exits with code 0
- [ ] When pre-check returns fresh, prompt flow proceeds as in Phase 1/2
- [ ] When pre-check returns reconfigure, prompt flow proceeds with reconfigure flag

**Tests**:
- "returns fresh when agntc.json does not exist" -- verify no prompts shown, returns { status: "fresh" }
- "displays warning when agntc.json exists" -- verify log.warn called with "This directory is already initialized."
- "returns reconfigure when user selects Reconfigure" -- mock select returning "reconfigure", verify result
- "returns cancel when user selects Cancel" -- mock select returning "cancel", verify result
- "returns cancel when user presses Ctrl+C" -- mock select returning Symbol("cancel"), verify result
- "triggers for empty agntc.json" -- create empty file, verify pre-check still fires
- "does not trigger when agntc.json absent" -- clean directory, verify returns fresh
- "orchestrator exits cleanly on cancel" -- mock preCheck returning cancel, verify scaffoldSkill/Plugin/Collection NOT called, ExitSignal(0) thrown
- "orchestrator proceeds normally on fresh" -- mock preCheck returning fresh, verify type selection prompt is called
- "orchestrator passes reconfigure flag on reconfigure" -- mock preCheck returning reconfigure, verify prompt flow enters with reconfigure context

**Edge Cases**:
- agntc.json exists but is empty or malformed: pre-check triggers (existence check only, no parsing)
- Collection directories with no root agntc.json: pre-check returns fresh, no warning shown
- Ctrl+C at the Reconfigure/Cancel prompt: treated as cancel

**Spec Reference**: .workflows/specification/plugin-authoring/specification.md -- Step 1: Pre-check

**Resolution**: Fixed
**Notes**: This update pairs with Finding 1, which removes task 3-2. The plan.md task table for Phase 3 must be updated to remove the plugin-authoring-3-2 row. Phase 3 acceptance criteria remain unchanged since they already cover the cancel behavior.

---

### 3. Task 3-3 spans too many files and layers

**Severity**: Important
**Plan Reference**: Phase 3 / plugin-authoring-3-3 (tick-36fae5)
**Category**: Scope and Granularity
**Change Type**: update-task

**Details**:
Task 3-3 modifies three scaffold functions (scaffoldSkill, scaffoldPlugin, scaffoldCollection), extends the ScaffoldResult type to add an "overwritten" status, and wires the reconfigure flag from the orchestrator through to scaffold calls. That is four files across two architectural layers (scaffold modules + orchestrator), exceeding the "one TDD cycle" guideline. The task also introduces the type change -- extending ScaffoldResult -- which is a shared interface that task 3-4 also depends on.

Split the type extension and skill reconfigure into this task (the first TDD cycle that proves the pattern), then have the plugin/collection reconfigure be a second task that applies the established pattern. This keeps each task to one clear TDD cycle.

However, given that applying the reconfigure flag to scaffoldPlugin and scaffoldCollection is mechanical repetition of the same pattern established in scaffoldSkill, the counterargument is that splitting this across two tasks creates a task that's "too small" (just repeating a pattern). The Do section has 5 steps, which is at the boundary.

On balance, the task is large but not critically so. The real issue is that the Do section should be more explicit about the shared type change and its location. Narrowing the scope to make the type change and pattern explicit improves implementation readiness without requiring a split.

**Current**:
**Problem**: When a user chooses "Reconfigure", the scaffolding step must change overwrite semantics for exactly one file: agntc.json. In fresh-run mode, all existing files are skipped. In reconfigure mode, agntc.json must be overwritten while every other file retains skip-if-exists behavior.

**Solution**: Add a reconfigure?: boolean flag to the scaffold functions (scaffoldSkill, scaffoldPlugin, scaffoldCollection). When reconfigure is true, the agntc.json write uses overwrite instead of skip-if-exists. All other writes remain unchanged. The scaffold result gains a third state: "overwritten".

**Outcome**: Running reconfigure produces a new agntc.json reflecting new selections, even if it already existed. All other existing files are untouched.

**Do**:
- Extend scaffold result type to support three statuses: "created", "skipped", "overwritten"
- Modify scaffoldSkill to accept reconfigure?: boolean. When true and agntc.json exists, overwrite and report "overwritten"
- Apply same modification to scaffoldPlugin and scaffoldCollection
- The agntc.json overwrite is full write (not merge) -- always {"agents": [...]} from current selection
- Wire reconfigure flag from orchestrator through to scaffold call
- Create tests/init/scaffold-reconfigure.test.ts

**Acceptance Criteria**:
- [ ] In reconfigure mode, agntc.json is overwritten with new selections
- [ ] In reconfigure mode, SKILL.md is skipped if it exists
- [ ] In reconfigure mode, skills/, agents/, hooks/ directories are skipped if they exist
- [ ] In fresh mode (reconfigure=false), behavior identical to Phase 1/2
- [ ] Scaffold result tags agntc.json as "overwritten" when it was overwritten
- [ ] Overwritten agntc.json contains only {"agents": [...]} from current selections (full replace)
- [ ] Works for all three types: skill, plugin, collection

**Proposed**:
**Problem**: When a user chooses "Reconfigure", the scaffolding step must change overwrite semantics for exactly one file: agntc.json. In fresh-run mode, all existing files are skipped. In reconfigure mode, agntc.json must be overwritten while every other file retains skip-if-exists behavior.

**Solution**: Add a reconfigure?: boolean flag to the scaffold functions (scaffoldSkill, scaffoldPlugin, scaffoldCollection). When reconfigure is true, the agntc.json write uses overwrite instead of skip-if-exists. All other writes remain unchanged. The scaffold result gains a third state: "overwritten".

**Outcome**: Running reconfigure produces a new agntc.json reflecting new selections, even if it already existed. All other existing files are untouched.

**Do**:
- In src/init/scaffold-skill.ts, extend ScaffoldResult to include an overwritten: string[] array alongside created and skipped (this is the shared type used by all three scaffold functions)
- Add reconfigure?: boolean to scaffoldSkill's options parameter
- When reconfigure is true and agntc.json exists: overwrite and add to overwritten array instead of skipped
- When reconfigure is false or agntc.json does not exist: behavior unchanged from Phase 1
- Apply the same reconfigure flag to scaffoldPlugin in src/init/scaffold-plugin.ts -- when reconfigure is true, agntc.json is overwritten; all other items (SKILL.md, agents/, hooks/) follow skip-if-exists
- Apply the same reconfigure flag to scaffoldCollection in src/init/scaffold-collection.ts -- when reconfigure is true, my-plugin/agntc.json is overwritten; all other items follow skip-if-exists
- The agntc.json overwrite is a full write (not merge) -- always {"agents": [...]} from current selection
- In src/commands/init.ts, pass the reconfigure flag from the orchestrator through to the scaffold call (the flag was threaded through in task 3-1)
- Create tests/init/scaffold-reconfigure.test.ts covering all three types

**Acceptance Criteria**:
- [ ] ScaffoldResult type includes overwritten: string[] alongside created and skipped
- [ ] In reconfigure mode, agntc.json is overwritten with new selections
- [ ] In reconfigure mode, SKILL.md is skipped if it exists
- [ ] In reconfigure mode, skills/, agents/, hooks/ directories are skipped if they exist
- [ ] In fresh mode (reconfigure=false), behavior identical to Phase 1/2 (overwritten array is empty)
- [ ] Scaffold result tags agntc.json as "overwritten" when it was overwritten
- [ ] Overwritten agntc.json contains only {"agents": [...]} from current selections (full replace)
- [ ] Works for all three types: skill, plugin, collection
- [ ] For collection, my-plugin/agntc.json is the file overwritten (not a root agntc.json)

**Tests**:
- "scaffoldSkill overwrites agntc.json when reconfigure is true" -- pre-create agntc.json with old content, scaffold with reconfigure: true, verify new content written
- "scaffoldSkill skips SKILL.md even in reconfigure mode" -- pre-create both files, scaffold with reconfigure: true, verify SKILL.md unchanged
- "scaffoldSkill reports agntc.json as overwritten" -- verify overwritten array contains "agntc.json"
- "scaffoldSkill in fresh mode is unchanged" -- reconfigure: false, verify identical to Phase 1 behavior
- "scaffoldPlugin overwrites agntc.json when reconfigure is true" -- pre-create plugin structure, scaffold with reconfigure: true, verify agntc.json updated and others unchanged
- "scaffoldCollection overwrites my-plugin/agntc.json when reconfigure is true" -- pre-create collection structure, scaffold with reconfigure: true, verify my-plugin/agntc.json updated
- "overwritten agntc.json is full replace not merge" -- pre-create with {"agents":["claude"]}, reconfigure with ["codex"], verify content is {"agents":["codex"]}
- "fresh mode returns empty overwritten array" -- scaffold with reconfigure: false, verify overwritten is []

**Edge Cases**:
- agntc.json read-only: let error propagate (filesystem permission errors are not caught)
- Type changes from skill to plugin on reconfigure: agntc.json overwritten, new directories created, old SKILL.md at root remains (not managed by plugin scaffold path)
- For collection reconfigure: my-plugin/agntc.json is overwritten, root remains free of agntc.json

**Spec Reference**: .workflows/specification/plugin-authoring/specification.md -- Step 5: Scaffold

**Resolution**: Fixed
**Notes**: The task is at the boundary of "too large" but splitting it would create a task that's too small (mechanically repeating a pattern). The improved Do section makes the scope explicit enough for an implementer to execute in one cycle.

---

### 4. Task 1-4 missing test for unsupported type handling

**Severity**: Minor
**Plan Reference**: Phase 1 / plugin-authoring-1-4 (tick-3bc6b7)
**Category**: Acceptance Criteria Quality
**Change Type**: add-to-task

**Details**:
Task 1-4's Do section says "Plugin and Collection file lists will be added in Phase 2, but define the branching structure now with placeholder arrays or throw for unsupported types." However, neither the Acceptance Criteria nor Tests cover what happens when type is "plugin" or "collection". An implementer needs to know whether to throw, return a placeholder, or skip. Adding one AC and one test makes the behavior explicit.

**Current**:
**Acceptance Criteria**:
- [ ] For type "skill", displays agntc.json and SKILL.md in the preview
- [ ] Confirming returns true
- [ ] Declining (answering no) returns false
- [ ] Cancelling (Ctrl+C) returns false
- [ ] Preview message includes "This will create:"

**Tests**:
- "displays agntc.json and SKILL.md for skill type" -- verify the note/log call contains both file names
- "returns true when user confirms" -- mock confirm returning true, verify return
- "returns false when user declines" -- mock confirm returning false, verify return
- "returns false when user cancels" -- mock confirm returning Symbol("cancel"), verify return
- "preview message includes 'This will create:'" -- verify the displayed text

**Proposed**:
**Acceptance Criteria**:
- [ ] For type "skill", displays agntc.json and SKILL.md in the preview
- [ ] Confirming returns true
- [ ] Declining (answering no) returns false
- [ ] Cancelling (Ctrl+C) returns false
- [ ] Preview message includes "This will create:"
- [ ] For type "plugin" or "collection", throws an error (these types are wired in Phase 2)

**Tests**:
- "displays agntc.json and SKILL.md for skill type" -- verify the note/log call contains both file names
- "returns true when user confirms" -- mock confirm returning true, verify return
- "returns false when user declines" -- mock confirm returning false, verify return
- "returns false when user cancels" -- mock confirm returning Symbol("cancel"), verify return
- "preview message includes 'This will create:'" -- verify the displayed text
- "throws for plugin type" -- call with type "plugin", verify it throws (placeholder until Phase 2)

**Resolution**: Fixed
**Notes**: Minor but improves implementation clarity. The orchestrator in task 1-6 already guards against plugin/collection types with a "coming soon" exit, so this throw would only fire if the guard is bypassed.

---

### 5. Plan.md task table for Phase 3 needs updating if task 3-2 is removed

**Severity**: Minor
**Plan Reference**: Phase 3 task table in plan.md
**Category**: Task Template Compliance
**Change Type**: update-task

**Details**:
If Finding 1 (remove task 3-2) is accepted, the Phase 3 task table in plan.md needs to be updated to remove the plugin-authoring-3-2 row and the Phase 3 edge case column for task 3-1 should reflect the absorbed cancel behavior.

**Current**:
#### Tasks
| ID | Name | Edge Cases | Status | Ext ID |
|----|------|------------|--------|--------|
| plugin-authoring-3-1 | Pre-check detection and reconfigure-or-cancel prompt | agntc.json exists but is empty or malformed, collection directory with no root agntc.json does not trigger pre-check | authored | tick-7a71b4 |
| plugin-authoring-3-2 | Cancel at pre-check exits cleanly | none | authored | tick-df1d66 |
| plugin-authoring-3-3 | Reconfigure overwrites agntc.json while skipping other files | agntc.json is read-only, other files already exist and are skipped, type changes from skill to plugin on reconfigure | authored | tick-36fae5 |
| plugin-authoring-3-4 | Output report distinguishes overwritten from created and skipped | mixed report with overwritten and skipped and created entries in same run | authored | tick-1010d8 |

**Proposed**:
#### Tasks
| ID | Name | Edge Cases | Status | Ext ID |
|----|------|------------|--------|--------|
| plugin-authoring-3-1 | Pre-check detection, orchestrator wiring, and cancel behavior | agntc.json exists but is empty or malformed, collection directory with no root agntc.json does not trigger pre-check, cancel at pre-check exits without writing files | authored | tick-7a71b4 |
| plugin-authoring-3-3 | Reconfigure overwrites agntc.json while skipping other files | agntc.json is read-only, other files already exist and are skipped, type changes from skill to plugin on reconfigure | authored | tick-36fae5 |
| plugin-authoring-3-4 | Output report distinguishes overwritten from created and skipped | mixed report with overwritten and skipped and created entries in same run | authored | tick-1010d8 |

**Resolution**: Fixed
**Notes**: Depends on Finding 1 being accepted. If Finding 1 is rejected, this finding should also be rejected.
