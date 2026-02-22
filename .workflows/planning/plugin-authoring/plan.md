---
topic: plugin-authoring
status: planning
format: tick
work_type: greenfield
ext_id:
specification: ../../specification/plugin-authoring/specification.md
cross_cutting_specs:
  - ../../specification/naming-and-identity/specification.md
spec_commit: 687cd14d57f8e5c2704c60c22274c5a4e9ce2629
created: 2026-02-22
updated: 2026-02-22
external_dependencies: []
task_list_gate_mode: gated
author_gate_mode: gated
finding_gate_mode: gated
planning:
  phase: 1
  task: ~
---

# Plan: Plugin Authoring

### Phase 1: Walking Skeleton -- Skill Scaffolding End-to-End
status: draft
ext_id:

**Goal**: A user can run `npx agntc init`, select "Skill" type, select agent(s), confirm, and get `agntc.json` + `SKILL.md` written to disk. This is the thinnest vertical slice through the complete init flow, threading through command registration in `src/cli.ts`, the interactive prompt sequence using `@clack/prompts`, file generation with skip-if-exists logic, and success output.

**Why this order**: The walking skeleton must come first. It proves the end-to-end architecture -- command wiring into the existing Commander setup, the multi-step `@clack/prompts` interaction pattern (type select, agent multiselect, preview/confirm), the scaffolding engine that writes files while respecting existing content, and the success summary. Skill is the simplest type (just two flat files), making it the ideal skeleton. Every subsequent phase reuses the prompt flow, scaffolding engine, and file-skip reporting established here.

**Acceptance**:
- [ ] `npx agntc init` is a registered command accepting no arguments and no flags
- [ ] Type selection prompt renders Skill / Plugin / Collection options; selecting Skill proceeds to agent selection
- [ ] Agent selection prompt renders Claude / Codex as multiselect; empty selection is rejected with re-prompt
- [ ] Preview displays the two files (`agntc.json`, `SKILL.md`) then asks confirm (y/n)
- [ ] On confirm: `agntc.json` written with `{"agents": [...]}` matching selection; `SKILL.md` written with frontmatter template (name, description fields)
- [ ] If either file already exists, it is skipped (not overwritten); output reports what was created vs skipped
- [ ] On cancel at any prompt step, exits cleanly without writing any files
- [ ] Success message: "Done. Edit `SKILL.md` to define your skill."
- [ ] All tests pass; existing test suite remains green

### Phase 2: Plugin and Collection Scaffolding
status: draft
ext_id:

**Goal**: Extend the init flow so selecting "Plugin" or "Collection" produces their correct directory structures and starter files, completing all three scaffolding paths specified in the spec.

**Why this order**: Phase 1 established the full prompt-to-scaffold pipeline for the simplest case. This phase extends the scaffolding engine to handle nested directory structures (`skills/my-skill/`, `agents/`, `hooks/`, and the collection wrapper `my-plugin/`). No new architectural layers are introduced -- the prompt flow, file-skip logic, and success output patterns from Phase 1 are reused and extended. Plugin and Collection are grouped together because they share the same directory structure (Collection is just Plugin nested inside a named directory with no root `agntc.json`).

**Acceptance**:
- [ ] Selecting "Plugin" scaffolds: `agntc.json`, `skills/my-skill/SKILL.md`, empty `agents/` directory, empty `hooks/` directory
- [ ] Selecting "Collection" scaffolds: `my-plugin/agntc.json`, `my-plugin/skills/my-skill/SKILL.md`, empty `my-plugin/agents/` directory, empty `my-plugin/hooks/` directory
- [ ] Collection produces no root-level `agntc.json`
- [ ] Agent multiselect values are correctly written into each type's `agntc.json`
- [ ] Preview output matches the exact format from the spec for each type (showing the file/directory tree)
- [ ] Existing files and directories are skipped; output reports created vs skipped
- [ ] Plugin success message: "Done. Add your skills, agents, and hooks."
- [ ] Collection success message: "Done. Rename `my-plugin/` and duplicate for each plugin in your collection."

### Phase 3: Pre-check and Reconfigure
status: draft
ext_id:

**Goal**: Detect when `agntc.json` already exists before the prompt flow begins, warn the user, and offer reconfigure-or-cancel. Reconfigure reruns the full init flow and overwrites `agntc.json` with new selections while all other files follow fresh-run skip-if-exists behaviour.

**Why this order**: Phases 1 and 2 cover the complete fresh-run path for all three types. This phase adds the re-entry edge case -- the pre-check gate that conditionally modifies flow entry and changes overwrite semantics for a single file (`agntc.json`). It depends on both prior phases being complete because reconfigure must work correctly for all three type paths. This is naturally the last phase: it hardens the existing flow for the "already initialized" scenario rather than adding new core functionality.

**Acceptance**:
- [ ] When `agntc.json` exists at cwd root, the warning "This directory is already initialized." is displayed before any other prompts
- [ ] User is presented with "Reconfigure" and "Cancel" options
- [ ] Selecting "Cancel" exits cleanly with no file changes
- [ ] Selecting "Reconfigure" enters the full prompt flow (type selection, agent selection, preview, confirm)
- [ ] On reconfigure confirm: `agntc.json` is overwritten with new selections
- [ ] On reconfigure: all files other than `agntc.json` follow fresh-run behaviour (skip if exists, do not overwrite)
- [ ] Output report correctly distinguishes overwritten files from created and skipped files
- [ ] Pre-check does not trigger for collection directories (which have no root `agntc.json`)
