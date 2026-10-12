# Phase 4: Existing installs move to their new shape — 13 tasks

## vercel-skills-compatibility-4-1

### Task vercel-skills-compatibility-4-1: Update moves a skill to its declared-name folder and key

**Problem**: Installs made before this feature sit in folders named after a directory basename, under keys built from it. A menu pick keys `owner/repo/<folder>`, and a tree URL keys its full subpath, such as `owner/repo/skills/composition-patterns` (§4.3). Phase 1 installs new skills under their declared names, but update keeps the old folder: `replayRecordedSkill` in `src/nuke-reinstall-pipeline.ts` re-copies into `basename(options.key)`. An existing install would stay where neither Vercel's CLI nor a fresh add would put it, and a fresh add of the same skill would land a second copy beside it (§4.4). The same happens once a skill's declared name changes upstream after install (§12.6).

**Solution**: On its next update, an installed skill moves to the folder and key of the skill its recorded source folder now holds. That is the skill's declared name sanitized (§4.2), or its folder name when it declares none. Every recorded agent's copy moves, and nothing is left in the old folder. A skill installed on its own takes the key `owner/repo/<folder>`. A root skill keeps `owner/repo` and moves only its folder. The moved entry keeps updating from its source folder. A skill whose declared name changes upstream follows its source folder to the new name the same way.

**Outcome**: After `update`, an install of `skills/composition-patterns/` declaring `vercel-composition-patterns` sits in `vercel-composition-patterns/` under `owner/repo/vercel-composition-patterns` for every recorded agent. No old folder or old key is left, and later updates reinstall it from the same source folder.

**Acceptance Criteria**:
- [ ] Given a skill picked from the menu under the old rules, installed for Claude, Codex and Cursor in `composition-patterns/` under `owner/repo/composition-patterns`, whose source `skills/composition-patterns/SKILL.md` declares `vercel-composition-patterns`, with a newer commit upstream, when `update owner/repo/composition-patterns` or `update` with no argument runs, the outcome is (§4.3, §4.4, §12.5):
  - `.claude/skills/vercel-composition-patterns/`, `.agents/skills/vercel-composition-patterns/` and `.cursor/skills/vercel-composition-patterns/` hold the skill;
  - no `composition-patterns/` folder remains in any of the three skills directories;
  - the manifest holds `owner/repo/vercel-composition-patterns`, recorded for the same three agents, and no `owner/repo/composition-patterns`.
- [ ] Given the same skill installed under the old rules through `https://github.com/owner/repo/tree/main/skills/composition-patterns`, keyed `owner/repo/skills/composition-patterns`, when `update` runs, it moves the same way. The manifest holds `owner/repo/vercel-composition-patterns` and no `owner/repo/skills/composition-patterns` (§4.3, §4.4)
- [ ] Given a member skill whose folder `Helper Tool/` declares no name, installed in `.claude/skills/Helper Tool/` under `owner/repo/Helper Tool`, when `update` runs, it moves to `.claude/skills/helper-tool/` under `owner/repo/helper-tool` (§4.1, §4.2, §4.4)
- [ ] Given a root skill installed under the old rules in `.claude/skills/repo/` under `owner/repo`, whose SKILL.md declares `foo-skill`, when `update` runs, it moves to `.claude/skills/foo-skill/`, no `repo/` folder remains, and the key stays `owner/repo` (§4.3, §4.4)
- [ ] Given the skill from the first scenario already moved, upstream then changes the content of `skills/composition-patterns/`. When `update` runs again, the change lands in `.claude/skills/vercel-composition-patterns/` and the key is unchanged (§1.2, §4.4)
- [ ] Given a local-path skill at `/work/my-skill`, installed under the old rules in `.claude/skills/my-skill/`, whose SKILL.md declares `foo-skill`, when `update` runs by its key, it moves to `.claude/skills/foo-skill/` and no `my-skill/` folder remains (§1.2, §4.4)
- [ ] Given `design-taste-frontend` installed from `skills/taste-skill/` under `owner/repo/design-taste-frontend`, upstream then changes that SKILL.md's `name` to `taste-frontend`. When `update` runs, the skill lands in `.claude/skills/taste-frontend/` under `owner/repo/taste-frontend`, and `design-taste-frontend/` and the old key are gone. A root skill whose declared name changes upstream moves its folder the same way and keeps `owner/repo` (§4.3, §12.6)

**Do**:
- Move the entry to the declared name of the skill its recorded source folder holds (§4.3, §12.6). The folder and key are the ones Phase 1's add gives the same skill (tasks 1-1 to 1-4 and 1-9).
- Where the work lives:
  - `replayRecordedSkill` and `buildSuccess` in `src/nuke-reinstall-pipeline.ts`. The re-copy names its folder `basename(options.key)` today, and the new entry carries `sourceSubpath` over unchanged.
  - The manifest writes that key the result: `runUpdate` (`addEntry(updatedManifest, targetKey, …)`) and all-mode's `persistUnitOutcomes`, both in `src/commands/update.ts`.
  - Update's source lookup. For a cloned entry that is `resolveUpdateSourceDir` and `resolveGuardedSourceDir` (`src/source-parser.ts`) with `ManifestEntry.sourceSubpath` (`src/manifest.ts`). For a local-path entry, `prepareReinstall` (`src/clone-reinstall.ts`) reads the key as the source directory.

**Context**:
> - §4.4: "An existing install moves to its declared-name folder and key on its next update. If the target folder is already occupied, update handles it as §12 sets out."
> - §4.3: "A skill installed on its own has exactly one manifest key, `owner/repo/<folder>`, where `<folder>` is its install folder name (§4.2) ... A skill that is the whole repo (a root `SKILL.md`) keys as `owner/repo`, as it does today." And: "An installed skill is the skill its recorded source folder holds, in the source the add reads, known by that skill's declared name: the name an update would move it to (§4.4, §12.6)."
> - §12.6 lists "a skill's declared name changes upstream" among the ways an update writes into a folder it did not own before. §12.5: update replays the agents recorded at install.
> - Today the collection menu keys a member by its folder basename (`owner/repo/composition-patterns`). A tree URL keys it by its full subpath (`owner/repo/skills/composition-patterns`), because `parseDirectPath` in `src/source-parser.ts` builds the key from everything after the ref (§4.3).
> - Related work elsewhere:
>   - task 4-2 re-keys plugin members, and task 4-3 repairs skills recorded as plugins;
>   - task 4-4 makes these moves when no newer version is available;
>   - tasks 4-10 to 4-13 handle a declared-name folder or key that is already occupied;
>   - Phase 13 lets `remove` and `update` match an install not yet moved by its declared name as well as by its folder name and key (§4.4, §7.1);
>   - Phase 14 handles an old folder that has since become a symlink (§13).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §4.1, §4.2, §4.3, §4.4, §7.1, §12.5, §12.6, §13

## vercel-skills-compatibility-4-2

### Task vercel-skills-compatibility-4-2: Update re-keys a plugin member by its path

**Problem**: Under the old rules a plugin member picked from the menu is keyed by its folder basename. So `skills/foo/`, holding `agents/` and no SKILL.md, is recorded as `owner/repo/foo`, with its source path kept beside the key (`memberKey` and `memberSourceSubpath` in `src/commands/add.ts`). Phase 1 keys the same member `owner/repo/skills/foo`, by its path (task 1-5). An existing member would keep its old key, while a fresh menu pick or a tree URL to its folder gives the same member a different one (§4.3, §4.4).

**Solution**: On its next update, a plugin member recorded under its folder name is re-keyed `owner/repo/<path>`, its folder's path in the repository. It still installs whole and keeps every recorded agent. A skill pack holding only `skills/`, and a member holding SKILL.md in one of §5.1's plugin shapes, re-key the same way. A member whose folder sits at the repository's top level already keys by its path and keeps its key, and so does a repository that is itself a plugin. The re-keyed member keeps updating from its path.

**Outcome**: After `update`, the member at `skills/foo/` is recorded once, as `owner/repo/skills/foo`, the key a menu pick or a tree URL gives it now.

**Acceptance Criteria**:
- [ ] Given a skills-only repo whose member `skills/foo/` holds `agents/reviewer.md` and no SKILL.md, picked from the menu under the old rules and recorded for Claude as `owner/repo/foo`, with a newer commit upstream, when `update owner/repo/foo` or `update` with no argument runs, the outcome is (§4.3, §4.4, §5.3):
  - the manifest holds `owner/repo/skills/foo` and no `owner/repo/foo`;
  - `reviewer.md` is still in `.claude/agents/`;
  - the entry is still recorded for Claude.
- [ ] Given a skill pack `skills/pack/` holding only `skills/`, recorded under the old rules as `owner/repo/pack`, when `update` runs, it is re-keyed `owner/repo/skills/pack` and still installs as one entry (§4.3, §5.3)
- [ ] Given a member `skills/kit/` holding SKILL.md beside `skills/` and `agents/`, recorded under the old rules as the plugin `owner/repo/kit`, when `update` runs, it is re-keyed `owner/repo/skills/kit`, its agents are still in `.claude/agents/`, and its SKILL.md is not installed. A member `skills/kit/` holding SKILL.md beside `agents/`, whose own `agntc.json` declares `"type": "plugin"`, re-keys the same way (§4.3, §5.1, §5.3)
- [ ] Given a member whose folder `foo/` sits at the repository's top level, recorded as `owner/repo/foo`, or a repository that is itself a plugin, recorded as `owner/repo`, when `update` runs, the key is unchanged (§4.3)
- [ ] Given the member re-keyed `owner/repo/skills/foo`, upstream then adds `skills/foo/agents/triage.md`. When `update` runs again, `.claude/agents/triage.md` is installed and the key is unchanged (§1.2, §4.3)
- [ ] Given the member re-keyed `owner/repo/skills/foo`, when it is re-added through `https://github.com/owner/repo/tree/main/skills/foo`, the manifest still holds the one entry `owner/repo/skills/foo` (§4.3)

**Do**:
- Key the member by its folder's path in the repository, as Phase 1 keys a member picked today (task 1-5, §4.3).
- Where the work lives: `buildSuccess` in `src/nuke-reinstall-pipeline.ts`, which builds the updated entry; the manifest writes in `runUpdate` and `persistUnitOutcomes` (`src/commands/update.ts`), which key the result.

**Context**:
> - §4.4: "A plugin member recorded under its folder name moves to its path key on its next update."
> - §4.3: "A plugin member (§5.3) installed on its own has exactly one key, `owner/repo/<path>`, where `<path>` is its folder's path in the repository. The key is the same whether the member was picked from the menu or selected by its path in the source (§7.1). A plugin member at the repository root keys as it does today."
> - §5.3: a non-hidden folder with `skills/`, `agents/` or `hooks/` and no SKILL.md is a plugin member, a skill pack included. So is a folder in one of §5.1's plugin shapes, read against its own `agntc.json`.
> - Under the old rules the menu read members one level into the repo root or into `skills/` (`scanQualifyingChildDirs` in `src/type-detection.ts`) and keyed each by basename. A member under `skills/` recorded its source path as `sourceSubpath` (`memberSourceSubpath` in `src/commands/add.ts`, `ManifestEntry.sourceSubpath` in `src/manifest.ts`). A top-level member's key is already its path. A tree URL already keyed a member by its path.
> - A member's own skills land flat in their declared-name folders on every update (Phase 1, task 1-8).
> - Related work elsewhere:
>   - task 4-3 repairs a member holding SKILL.md beside `agents/` or `hooks/` with no `"type": "plugin"` into a skill;
>   - task 4-4 makes the re-key when no newer version is available;
>   - task 4-12 handles a path key that another unit already holds.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §4.3, §4.4, §5.1, §5.3, §7.1

## vercel-skills-compatibility-4-3

### Task vercel-skills-compatibility-4-3: Update repairs a skill recorded as a plugin

**Problem**: Under the old rule, a SKILL.md beside any asset folder was read as a plugin and the SKILL.md was dropped (`classifyStructure` in `src/type-detection.ts`). Installs made that way are recorded as plugins. Their `agents/` files sit in `.claude/agents/` as subagents, and the skill itself was never installed (§5.3). Update replays the recorded type and never re-derives it (`src/nuke-reinstall-pipeline.ts`: "The type is recorded, never re-derived from the clone"). Every update would keep the broken shape, while a fresh `add` of the same source installs a skill (§5.5).

**Solution**: On its next update, an entry recorded as a plugin is reinstalled as a skill when three things hold at the entry's unit root: a SKILL.md, no `skills/` folder, and no `"type": "plugin"` declaration in that folder's own `agntc.json`. The skill installs whole for every recorded agent, with its `agents/` and `hooks/` inside its folder. The entry's former agent and hook copies are removed. The entry is recorded as a skill and moves to its declared-name folder and key. The update's output says the entry was repaired. Real plugins are untouched, and so is a bundle made from a root SKILL.md beside `skills/` alone.

**Outcome**: A skill that the old rule turned into subagents is a working skill after one update, and the update says it repaired it.

**Acceptance Criteria**:
- [ ] Given a repo whose root SKILL.md, declaring `skill-creator`, sits beside `agents/analyzer.md` and `agents/grader.md`, installed under the old rules for Claude and Codex as the plugin `owner/repo`, with a newer commit upstream, when `update` runs, the outcome is (§4.3, §4.4, §5.3, §5.5, §12.5):
  - `.claude/skills/skill-creator/` and `.agents/skills/skill-creator/` each hold the SKILL.md with `agents/analyzer.md` and `agents/grader.md` inside;
  - `.claude/agents/analyzer.md` and `.claude/agents/grader.md` are gone;
  - the manifest records `owner/repo` as a skill, still for Claude and Codex;
  - the output says `owner/repo` was repaired.
- [ ] Given a root SKILL.md beside `hooks/check.sh`, recorded as a plugin, when `update` runs, it is repaired the same way: `check.sh` sits inside the skill folder and `.claude/hooks/check.sh` is gone (§5.5)
- [ ] Given a member `skills/skill-creator/`, holding SKILL.md declaring `skill-builder` beside `agents/analyzer.md`, picked from the menu under the old rules as the plugin `owner/repo/skill-creator`, when `update` runs, it is repaired into `.claude/skills/skill-builder/` with `agents/` inside, keyed `owner/repo/skill-builder`, and `owner/repo/skill-creator` is gone (§4.3, §4.4, §5.5)
- [ ] Given a plugin whose root holds `skills/` beside `agents/` (or `hooks/`), with or without a root SKILL.md, when `update` runs, it updates as a plugin: its agents stay in `.claude/agents/` and no repair is reported (§5.1, §5.5)
- [ ] Given a root SKILL.md beside `agents/` whose `agntc.json` declares `"type": "plugin"`, recorded as a plugin, when `update` runs, it updates as a plugin with its agents in `.claude/agents/`, the SKILL.md not installed and no repair reported. The same holds for a member folder holding SKILL.md beside `agents/` whose own `agntc.json` declares `"type": "plugin"` (§5.1, §5.3, §5.5)
- [ ] Given a `--plugin` bundle made from a root SKILL.md beside `skills/` alone, when `update` runs, it updates as that bundle, the root SKILL.md is still not installed, and no repair is reported (§5.5, §6.6)
- [ ] Given a repaired entry, when `update` runs again, it updates as a skill and no repair is reported (§5.5)

**Do**:
- Repair on exactly §5.5's test, read at the entry's unit root: a SKILL.md, no `skills/`, and no `"type": "plugin"` in that folder's own `agntc.json` (§5.1, §5.5).
- Where the work lives:
  - `executeNukeAndReinstall` in `src/nuke-reinstall-pipeline.ts` (the spec cites this file), which picks `replayRecordedSkill` or `replayRecordedPlugin` from the recorded `type`, and `buildSuccess` there, which records the type;
  - the update's output: `renderGitUpdateSummary` and `renderLocalUpdateSummary` (`src/summary.ts`) for a single key, and the all-mode member lines in `src/commands/update.ts` and `src/update-render.ts`.

**Context**:
> - §5.5: "An entry recorded as a plugin is reinstalled as a skill on its next update when its source has a `SKILL.md` at the entry's unit root, no `skills/` folder there, and no `"type": "plugin"` declaration (§5.1). The update says so in its output. Real plugins are untouched." And: "A repaired entry also moves to its declared-name folder and key (§4.4)."
> - §5.3: "Today a `SKILL.md` beside any asset folder is read as a plugin, and the `SKILL.md` is dropped ... agntc copies those files into `.claude/agents/` as subagents and loses the skill, and still reports "Installed"."
> - §5.1 keeps two SKILL.md shapes as plugins: SKILL.md beside `skills/` and `agents/`/`hooks/`, and SKILL.md beside `agents/`/`hooks/` whose `agntc.json` declares `"type": "plugin"`. §6.6: the bundles already made from a root SKILL.md beside `skills/` alone keep working.
> - Agents and hooks are routed for Claude alone, so an old plugin recorded for Codex or Cursor installed nothing for them. After the repair, their skills directories hold the skill (§1.6, §12.5).
> - Related work elsewhere:
>   - task 4-4 makes the repair when no newer version is available;
>   - tasks 4-10 and 4-12 handle a repaired skill whose folder or key is already occupied;
>   - Phase 15 prints a repaired entry as a skill, with no `--plugin` (§14.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.6, §4.3, §4.4, §5.1, §5.3, §5.5, §6.6, §12.5, §14.1

## vercel-skills-compatibility-4-4

### Task vercel-skills-compatibility-4-4: Moves and repairs happen with no newer version

**Problem**: Update reinstalls an entry only when a newer version is in reach. A single-key update stops at "already up to date", at a pinned tag's newer-tags notice, or at a constrained entry whose newer tags all fall outside its range (`runSingleUpdate` in `src/commands/update.ts`). All-mode collapses such members into its trailing summary without cloning them (`splitMember` there). An install waiting to move, re-key or be repaired (tasks 4-1 to 4-3) would keep its old shape until upstream releases something new. For an entry pinned to a tag, that never happens (§4.4).

**Solution**: The next update makes the moves, re-keys and repair whether or not a newer version is available. An entry with one of them pending that is already at its target version is reinstalled at the version it has. That covers an entry up to date on its branch or the default branch, one pinned to an exact tag, and one whose newer tags all fall outside its constraint. Its ref and commit, and its pin, constraint or branch, stay as they were. This holds for update by key and for update with no argument.

**Outcome**: An install recorded under the old rules reaches its new shape on its next update, and none changes version to get there.

**Acceptance Criteria**:
- [ ] Given a skill installed under the old rules in `.claude/skills/composition-patterns/` under `owner/repo/composition-patterns`, whose source declares `vercel-composition-patterns`, tracking the default branch with no newer commit upstream, when `update owner/repo/composition-patterns` or `update` with no argument runs, the outcome is (§4.4):
  - the files move to `.claude/skills/vercel-composition-patterns/` and the old folder is gone;
  - the entry is re-keyed `owner/repo/vercel-composition-patterns`;
  - its recorded ref and commit are unchanged.
- [ ] Given the same install tracking the branch `main` with no newer commit, when `update` runs, it moves the same way and still tracks `main` (§4.4)
- [ ] Given the same install pinned to `v1.0.0` with `v1.1.0` and `v2.0.0` available, when `update` runs, it moves at `v1.0.0`. Its recorded ref and commit are still `v1.0.0`'s, and no constraint is recorded (§4.4)
- [ ] Given the same install at `v1.2.0` with the constraint `^1.2.0`, whose only newer tag is `v2.0.0`, when `update` runs, it moves at `v1.2.0` and keeps the constraint `^1.2.0` (§4.4)
- [ ] Given no newer version upstream, when `update` runs by key or with no argument, a plugin member recorded under its folder name is re-keyed by its path, and a skill recorded as a plugin that §5.5 repairs is repaired with the repair reported. Each stays at its recorded version (§4.4, §5.5)

**Do**:
- Where the work lives:
  - `runSingleUpdate` in `src/commands/update.ts`, with its up-to-date, newer-tags and constrained-up-to-date returns;
  - all-mode's `splitMember` and `categorizeGroups` there, which send only members with a newer version on to `processGroupUpdate` (`src/update-groups.ts`);
  - `prepareReinstall` and `cloneAndReinstall` (`src/clone-reinstall.ts`), which clone the entry's recorded ref unless given a new one.

**Context**:
> - §4.4: "The next update makes these moves, and the repair of §5.5, whether or not a newer version is available. An entry already at its target is reinstalled at the version it has: one that is up to date, pinned to an exact tag, or whose newer versions are all outside its constraint. Its pin, constraint or branch stays as it was."
> - All-mode groups entries by `(cloneUrl, versionIntent)` and clones each group once. Each member categorizes against the group's target by its own installed commit (`src/update-groups.ts`, `src/update-check.ts`).
> - Related work elsewhere: task 4-5 makes the same moves from `list`.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.4, §5.5

## vercel-skills-compatibility-4-5

### Task vercel-skills-compatibility-4-5: Updating from list moves an install as update does

**Problem**: `list`'s detail view offers "Update" only when a newer version is in reach (`getActions` in `src/commands/list-detail.ts`: `update-available`, `constrained-update-available` or `local`). An install waiting to move, re-key or be repaired with no newer version upstream could not be updated from `list`, though update by key or with no argument now moves it (task 4-4). The update and change-version actions also write their result back under the key they started from (`addEntry(manifest, key, …)` in `src/commands/list-update-action.ts` and `src/commands/list-change-version-action.ts`). A moved install would be recorded under its old key.

**Solution**: Updating from `list` makes the same moves, re-keys and repair as `update`, with or without a newer version. An install with one of them pending can be updated from `list` even when no newer version exists. Change-version reinstalls at the chosen tag and moves the install the same way. A repair made from `list` says so.

**Outcome**: However the user updates an install, by key, with no argument or from `list`, it ends in the same folder, under the same key, in the same shape.

**Acceptance Criteria**:
- [ ] Given a skill installed under the old rules in `.claude/skills/composition-patterns/` under `owner/repo/composition-patterns`, whose source declares `vercel-composition-patterns`, with no newer version upstream, when it is selected in `list` and updated from its detail view, the outcome is (§4.4):
  - the files move to `.claude/skills/vercel-composition-patterns/` and the old folder is gone;
  - the manifest holds `owner/repo/vercel-composition-patterns` and not the old key, with the recorded ref and commit unchanged;
  - `list` then shows the install under `owner/repo/vercel-composition-patterns`.
- [ ] Given the same install with a newer commit upstream, when it is updated from `list`, it moves the same way at the newer commit (§4.4)
- [ ] Given the same install pinned to `v1.0.0`, when `list`'s change-version moves it to `v1.1.0`, it lands in `.claude/skills/vercel-composition-patterns/` at `v1.1.0` under `owner/repo/vercel-composition-patterns`, and the old folder and key are gone (§4.4)
- [ ] Given a plugin member recorded under its folder name, when it is updated from `list`, it is re-keyed by its path (§4.4)
- [ ] Given a skill recorded as a plugin under the old rule, when it is updated from `list`, it is repaired into a skill as `update` repairs it, and `list`'s message says it was repaired (§5.5)

**Do**:
- Where the work lives:
  - `getActions` in `src/commands/list-detail.ts`;
  - `executeUpdateAction` (`src/commands/list-update-action.ts`) and `executeChangeVersionAction` (`src/commands/list-change-version-action.ts`), which reach the reinstall through `prepareReinstall` and `cloneAndReinstall` (`src/clone-reinstall.ts`);
  - the detail loop in `runListLoop` (`src/commands/list.ts`), which re-reads the entry by the key it was opened with.

**Context**:
> - §4.4: "The next update makes these moves, and the repair of §5.5, whether or not a newer version is available." The phase's acceptance names `list` beside update by key and update with no argument.
> - §5.5: "The update says so in its output."
> - Change-version pins to the chosen tag and drops any constraint, as today (`stripConstraint` in `src/commands/list-change-version-action.ts`).
> - Related work elsewhere: tasks 4-1 to 4-4 make these moves on `update`. Task 4-10 covers an update from `list` whose new path is occupied.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.4, §5.5

## vercel-skills-compatibility-4-6

### Task vercel-skills-compatibility-4-6: A re-add keeps every recorded agent and adds the chosen ones

**Problem**: A re-add deletes the entry's files and reinstalls for the chosen agents only. Both the single-unit and the multi-unit paths call `nukeManifestFiles` on the existing entry (`src/commands/add.ts`). So a re-add choosing Cursor on a Claude install silently deletes Claude's copy, where Vercel's `add -a cursor` adds Cursor and leaves Claude alone (§8.4). Ticking no agent at the prompt cancels the re-add with "Cancelled — no agents selected", so a re-add at another version has to name every recorded agent again to keep them.

**Solution**: Re-adding an installed entry installs for the agents already recorded plus the agents the re-add names. It never drops a recorded agent. This holds for a re-add of a single unit and for a re-add from the menu, whatever version the re-add names. Ticking no agent at the agent prompt names none: the re-add reinstalls for the recorded agents, and it is not a cancel. Cancelling the prompt is a cancel: it exits 0 and changes nothing.

**Outcome**: A re-add only ever adds agents. Choosing Cursor on a Claude install leaves Claude's copy in place and adds Cursor's.

**Acceptance Criteria**:
- [ ] Given the single skill `owner/repo` installed for Claude, when `add owner/repo` runs at a terminal and only Cursor is chosen at the agent prompt, `.claude/skills/<name>/` stays, `.cursor/skills/<name>/` is installed, and the entry records Claude and Cursor (§8.4)
- [ ] Given a skill installed for Claude and Codex, when it is re-added choosing only Claude, both copies stay and the entry still records Claude and Codex (§8.4)
- [ ] Given a skill picked from a repo's menu and installed for Claude, when `add owner/repo` runs again, the skill is picked again and only Codex is chosen, Claude's copy stays, Codex's is installed, and the entry records both. A plugin member re-added the same way keeps its `.claude/agents/` files (§8.4)
- [ ] Given a skill installed for Claude and Cursor at `v1.0.0`, when it is re-added at `v2.0.0` (`add owner/repo@v2.0.0`, the version form `add` accepts until Phase 7) and no agent is ticked at the prompt, it reinstalls at `v2.0.0` for Claude and Cursor, the entry records both, and no cancel is reported (§8.4)
- [ ] Given a Claude install, when it is re-added and the agent prompt is cancelled, the command exits 0, and the install's files and manifest entry are unchanged (§8.4, §10.4)

**Do**:
- Install for the recorded agents together with the agents the re-add names (§8.4).
- Where the work lives:
  - `runAdd` in `src/commands/add.ts`: its agent step, which cancels on an empty selection, and its step 10, which removes the existing entry's files;
  - `runCollectionPipeline` there, whose collection-wide agent prompt cancels on an empty selection, and which removes each re-added member's existing files;
  - `selectAgents` (`src/agent-select.ts`).

**Context**:
> - §8.4: "Re-adding an installed entry adds the agents the re-add names to the agents already recorded. It never drops a recorded agent. How the agents are named makes no difference: by `-a`, through the agent prompt, or through `-y`. ... Ticking no agent at the agent prompt names none, and the re-add reinstalls for the recorded agents. That is not a cancel. Cancelling the prompt is, and it exits 0 and changes nothing (§10.4)."
> - §8.4: "A version-only re-add, such as `owner/repo#v2.0.0`, reinstalls for every recorded agent. To take an agent away, use `remove -a` (§12)." Phase 7 moves versions from `@` to `#`. Until then `add` takes a version as `owner/repo@v2.0.0`.
> - §8.4: "Today a re-add deletes the entry's files and reinstalls for the chosen agents only. Both the single-unit and the multi-unit paths call `nukeManifestFiles` on the existing entry (`src/commands/add.ts`). So `add … -a cursor` on a Claude install silently deletes Claude's copy."
> - Related work elsewhere:
>   - task 4-7 narrows the recorded agents to the unit's ceiling as it stands;
>   - task 4-8 lets a re-add reach an install under its old key or folder;
>   - Phase 9 names agents with `-a`, Phase 11 adds `-y` and agent callers (§8.3), and Phase 13 adds `remove -a`.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §8.3, §8.4, §10.4, §12

## vercel-skills-compatibility-4-7

### Task vercel-skills-compatibility-4-7: A re-add installs within the unit's ceiling as it stands

**Problem**: A re-add now keeps every recorded agent (task 4-6), but the unit's author may have narrowed its `agntc.json` `agents` list since the install. Keeping a recorded agent the ceiling no longer allows would install the unit for an agent its author excludes, which is what the ceiling exists to prevent (§1.4, §8.2). `update` already narrows recorded agents to the ceiling and names those it drops (`resolveAgents` in `src/nuke-reinstall-pipeline.ts`, `formatAgentsDroppedWarning` in `src/clone-reinstall.ts`). A re-add does not.

**Solution**: A re-add installs within the unit's ceiling as it stands at the re-add, as `update` does. A recorded agent the ceiling no longer allows is dropped from the entry and its copy removed. The output names it, as `update` names an agent a unit no longer declares support for. The ceiling is every ceiling the unit holds, so a skill's or member's own `agntc.json` inside a bundle or plugin narrows the re-add too. A re-add that names an agent the ceiling allows installs for it, even when every recorded agent is dropped. A re-add that names no agent is refused when the ceiling allows none of the recorded agents, and it writes and removes nothing.

**Outcome**: A re-add never installs a unit for an agent its author now excludes, and it names the recorded agents it dropped.

**Acceptance Criteria**:
- [ ] Given a single skill installed for Claude and Codex whose `agntc.json` now restricts to Claude, when it is re-added at a terminal with Claude detected, the outcome is (§8.2, §8.4, §12.5):
  - it reinstalls for Claude only;
  - `.agents/skills/<name>/` is gone, and the entry records Claude alone;
  - the output names Codex as dropped.
- [ ] Given a `--plugin` bundle installed for Claude and Cursor, one of whose bundled skills now carries its own `agntc.json` restricting to Claude, when it is re-added with `--plugin`, it reinstalls for Claude only and the output names Cursor as dropped. A plugin whose `skills/` now holds a member restricted to Claude narrows the same way (§6.1, §6.2, §8.2, §8.4)
- [ ] Given a skill installed for Codex alone whose `agntc.json` now restricts to Claude, when it is re-added and Claude is chosen at the agent prompt, it installs for Claude. Codex's copy is gone, the entry records Claude alone, and the output names Codex as dropped (§8.2, §8.4)
- [ ] Given the same install, when it is re-added, or re-added at another version (`add owner/repo@v2.0.0`), and no agent is ticked at the agent prompt, the command exits non-zero. Codex's copy and the manifest entry are unchanged, nothing is written for Claude, and the message names what was refused (§1.5, §8.4)

**Do**:
- Narrow the entry's agents to the ceiling as `update` does, and name the dropped agents as `update` names them. The spec cites both pieces: `resolveAgents` in `src/nuke-reinstall-pipeline.ts` and `formatAgentsDroppedWarning` in `src/clone-reinstall.ts` (§8.4).
- Where the work lives: `runAdd` and `runCollectionPipeline` in `src/commands/add.ts`.

**Context**:
> - §8.4: "The re-add installs within the unit's ceiling as it stands at the re-add (§8.2), as `update` does (§12.5). A recorded agent the ceiling no longer allows is dropped, and the output names it, as `update` names an agent a unit no longer declares support for. That is the author's ceiling narrowing, not the re-add dropping an agent. A re-add that names no agent, such as a version-only re-add with no agent ticked, is refused (§1.5) when the ceiling allows none of the recorded agents."
> - §8.2: "A unit's ceiling is every ceiling it holds (§6.1, §6.2): the agents all of them allow. The agent prompt offers only those agents". Phase 3 builds that combined ceiling for add and update (task 3-6). §10.1: the prompt is skipped when the ceiling is exactly one agent and that agent is detected.
> - §1.5: a refusal exits non-zero, writes nothing and removes nothing, and its message names what was refused.
> - An `agntc.json` with no usable `agents` list sets no ceiling, as today (`readConfig` in `src/config.ts`, and `resolveAgents`).
> - Related work elsewhere: Phase 9 refuses a single-unit run whose ceiling excludes every agent named with `-a`, and Phase 11 targets agents under `-y`.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §1.5, §6.1, §6.2, §8.2, §8.4, §10.1, §12.5

## vercel-skills-compatibility-4-8

### Task vercel-skills-compatibility-4-8: A re-add reaches an install under its old key or folder

**Problem**: A re-add finds its existing entry by exact key (`manifest[parsed.manifestKey]` in `runAdd`, `currentManifest[pluginManifestKey]` in `runCollectionPipeline`, `src/commands/add.ts`). An install made under the old rules carries an old key: a menu pick its folder basename, a tree URL its full subpath, a plugin member its folder name. Re-adding the same skill under its new key would miss that entry. It would install a second copy in the declared-name folder beside the old one, under a second entry (§4.4). A skill whose folder has moved upstream is missed the same way.

**Solution**: An install of the same skill from the same repository, made under its old key or folder, is the installed entry for the re-add. It moves to its declared-name folder and key, as an update would move it, and keeps every recorded agent the ceiling allows. A plugin member recorded under its folder name moves to its path key the same way. A skill recorded as a plugin under the old rule reinstalls as a skill. "The same skill" is §4.3's identity. The installed skill is known by the declared name of the skill its recorded source folder holds, or by the name its key carries when that folder no longer holds a skill. The two are the same install when they share that name, or names that land on the same install folder. So a skill whose folder moved upstream with its name unchanged is re-added in place, and the entry records the folder it now comes from. A re-add never installs a second copy.

**Outcome**: Re-adding a skill installed under the old rules leaves one entry and one copy per agent, in the declared-name folder.

**Acceptance Criteria**:
- [ ] Given an old-rule menu pick in `.claude/skills/composition-patterns/` under `owner/repo/composition-patterns`, whose `skills/composition-patterns/` declares `vercel-composition-patterns`, when `add owner/repo` runs, `vercel-composition-patterns` is picked and Cursor is chosen, the outcome is (§4.4, §8.4):
  - `.claude/skills/vercel-composition-patterns/` and `.cursor/skills/vercel-composition-patterns/` hold the skill;
  - `.claude/skills/composition-patterns/` is gone;
  - the manifest holds one entry for it, `owner/repo/vercel-composition-patterns`, recording Claude and Cursor.
- [ ] Given the same skill recorded under its old tree-URL key `owner/repo/skills/composition-patterns`, when it is re-added through `https://github.com/owner/repo/tree/main/skills/composition-patterns`, or picked from the menu, it moves the same way and the old key is gone (§4.3, §4.4)
- [ ] Given a root skill in its old folder `.claude/skills/repo/` under `owner/repo`, whose SKILL.md declares `foo-skill`, when `add owner/repo` runs, it moves to `.claude/skills/foo-skill/`, `repo/` is gone, and the key stays `owner/repo` (§4.3, §4.4)
- [ ] Given the plugin member `skills/foo/` recorded under the old rules as `owner/repo/foo` for Claude, when it is picked again from the menu, the manifest holds `owner/repo/skills/foo` recording Claude, and no `owner/repo/foo` (§4.4)
- [ ] Given `skills/skill-creator/`, holding SKILL.md beside `agents/analyzer.md`, recorded under the old rule as the plugin `owner/repo/skill-creator`, when its skill is picked again from the menu, it installs as a skill with `agents/` inside its declared-name folder. `.claude/agents/analyzer.md` is gone, and the manifest holds one entry for it, recorded as a skill (§4.4, §5.3)
- [ ] Given `foo` installed from `skills/foo/` as `owner/repo/foo` for Claude, upstream then moves it to `skills/tools/foo/` with its name unchanged. When `foo` is re-added choosing Codex, the entry `owner/repo/foo` is re-added in place from `skills/tools/foo/`, recording Claude and Codex. A later `update` reinstalls it from `skills/tools/foo/` (§4.3, §8.4)
- [ ] Given an old-rule install whose declared-name folder `.claude/skills/vercel-composition-patterns/` holds untracked files, when it is re-added at a terminal, the untracked-files prompt lists that folder. Declining leaves the install in `.claude/skills/composition-patterns/`, under its old key, as it was (§10.1, §10.3)

**Do**:
- Find the re-add's installed entry by §4.3's identity rather than by exact key. Names are compared as §5.2 compares them: the same declared name, or names landing on the same install folder (§4.3).
- Move it as `update` moves it (tasks 4-1 to 4-3), keeping its recorded agents as task 4-6 keeps them.
- Where the work lives: `runAdd` and `runCollectionPipeline` in `src/commands/add.ts`.

**Context**:
> - §4.4: "A re-add reaches an existing install the same way. An install of the same skill from the same repository, made under its old key or folder, is the installed entry for that re-add (§8.4). It moves to its declared-name folder and key, as an update would move it, and keeps every recorded agent. A re-add never installs a second copy beside it." And: "A plugin member recorded under its folder name moves to its path key on its next update. A re-add reaches it under that old key the same way, and it keeps every recorded agent."
> - §4.3: "An installed skill is the skill its recorded source folder holds, in the source the add reads, known by that skill's declared name ... Where that folder no longer holds a skill, the install is known by the name its key carries. A skill being added from the same repository is the same install when it shares that identity: the same declared name, or a name landing on the same install folder (§5.2). So a skill whose folder moved upstream with its name unchanged is re-added in place, and the entry records the folder it now comes from."
> - §10.1: "Answering no there, or cancelling at any prompt, leaves every existing install and file as it was." Today the single-unit path removes the existing entry's files before its conflict checks run (`runAdd` step 10).
> - §8.4: a re-add keeps the recorded agents within the unit's ceiling as it stands (tasks 4-6 and 4-7).
> - Related work elsewhere:
>   - task 4-9 handles an add or re-add landing on a key another unit holds;
>   - Phase 6 reads sources of every form that name one repository as one;
>   - Phase 7 adds `@name` and `--skill`.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §4.4, §5.2, §5.3, §8.4, §10.1, §10.3

## vercel-skills-compatibility-4-9

### Task vercel-skills-compatibility-4-9: An add onto a key another unit from the same repository holds meets it as an install in the way

**Problem**: `add` treats whatever entry sits on its own key as the install it is replacing. The collision check skips the add's own key (`checkFileCollisions(incomingFiles, manifest, pluginKey)` in `src/collision-check.ts`), and the add removes that entry's files before installing (`src/commands/add.ts`). Under declared-name and path keys, two different units from one repository can land on one key. A skill declaring `foo` and the top-level plugin member `foo/` both key `owner/repo/foo`. A root skill and a `--plugin` bundle of the same repository both key `owner/repo`. Adding one would silently replace the other, even when none of their files overlap (§4.3).

**Solution**: An add, or a re-add moving an existing install to its declared-name or path key, can land on a key that another entry from the same repository holds as a different unit. That entry is another managed install in the way, even when none of its files overlap. It is never read as the same install and never silently replaced. At a terminal the add meets "Remove <key> and continue". Accepting removes the holder with its files and entry, and the new install takes the key. Declining or cancelling leaves the holder and its files as they were, and a re-added install as it was too. An entry recorded as a plugin that §5.5 repairs into the skill being added is the same install: it is reached as a re-add, not met as in the way.

**Outcome**: No add replaces a different unit's install unless the user agrees to remove it.

**Acceptance Criteria**:
- [ ] Given the top-level plugin member `foo/` installed as `owner/repo/foo`, holding `agents/reviewer.md`, when `https://github.com/owner/repo/tree/main/skills/bar` is added at a terminal, where `skills/bar/SKILL.md` declares `foo`, the add meets "Remove owner/repo/foo and continue", though none of the member's files lies in the skill's path (§4.3, §10.1)
- [ ] Given that prompt declined or cancelled, the member's `.claude/agents/reviewer.md` and its entry are unchanged and nothing of the skill is installed. Given it accepted, the member's files and entry are removed and the skill installs as `owner/repo/foo` (§4.3, §10.1, §10.3)
- [ ] Given skill folder `bar/` declaring `foo`, installed under the old rules as `owner/repo/bar` in `.claude/skills/bar/`, and the top-level plugin member `foo/` installed as `owner/repo/foo`, when the skill is re-added from the menu at a terminal, it meets "Remove owner/repo/foo and continue". The outcome is (§4.3, §4.4):
  - declining leaves both installs, `.claude/skills/bar/` included, and both entries as they were;
  - accepting removes the member, and the skill moves to `.claude/skills/foo/` as `owner/repo/foo`, with `owner/repo/bar` gone.
- [ ] Given a repo whose root SKILL.md sits beside `skills/` alone, installed as the root skill `owner/repo`, when `add owner/repo --plugin` runs at a terminal, the bundle meets "Remove owner/repo and continue". Given the `--plugin` bundle installed as `owner/repo`, when `add owner/repo` runs, the root skill meets the same prompt (§4.3, §6.6)
- [ ] Given `a/` installed as `foo` under `owner/repo/foo`, upstream then changes `a/`'s declared name to `bar` and adds `b/` declaring `foo`. When `b/`'s `foo` is added at a terminal, it meets "Remove owner/repo/foo and continue" rather than replacing `a/`'s install as a re-add (§4.3)
- [ ] Given `skills/foo/`, holding SKILL.md declaring `foo` beside `agents/`, recorded under the old rule as the plugin `owner/repo/foo`, when its skill is picked again from the menu, no "Remove" prompt is shown: it is re-added as that entry and reinstalled as a skill (§4.4, §5.5)

**Do**:
- Tell the same install from another by §4.3's identity, as task 4-8 reaches an install. Anything else on the key is another managed install in the way, met through today's "Remove <key> and continue" prompt (`resolveCollisions` in `src/collision-resolve.ts`, which §10.1 cites) whether or not files overlap (§4.3).
- Where the work lives: `runConflictChecks`, and the existing-entry handling in `runAdd` and `runCollectionPipeline` (`src/commands/add.ts`); `checkFileCollisions` (`src/collision-check.ts`), which skips the add's own key and reports only overlapping files today.

**Context**:
> - §4.3: "The same holds for a key another entry from the same repository holds as a different unit: a different skill, plugin member or bundle. An add, or an existing install moving to its declared-name or path key (§4.4), can land on such a key. ... That entry is another managed install in the way (§10.3, §12.6) even when none of its files overlap. It is never read as the same install and never silently replaced."
> - §4.3, of a held key: "At a terminal it meets "Remove <key> and continue"; under `-y` or from an agent caller it stops that unit unless `--overwrite` is given. Removing the existing install, either way, hands the key to the new one."
> - §4.3: "A skill folder `a/` installed as `foo` that now declares `bar` is `bar`: adding a new `foo` from `b/` meets it as a different skill in the way."
> - §10.1: only the two clash prompts delete anything when answered yes, and cancelling at any prompt leaves every existing install and file as it was.
> - Related work elsewhere:
>   - Phase 6 handles an install from a different repository onto a held key;
>   - Phase 10 adds "Proceed with installation?", which must also be answered yes before what a clash prompt agreed to delete is removed (§10.1);
>   - Phase 11 stops the unit under `-y` and for agent callers;
>   - task 4-12 is the update-side counterpart.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §4.4, §5.5, §6.6, §10.1, §10.3, §12.6

## vercel-skills-compatibility-4-10

### Task vercel-skills-compatibility-4-10: Untracked files in an update's new path stop that entry

**Problem**: An update can now write where its entry wrote nothing before (§12.6):
- a declared-name folder it moves to;
- the skill folder a repair creates;
- a skill, agent or hook its source gained;
- a new folder after its declared name changes upstream.

That path may already hold the user's own copy, or a copy Vercel's CLI installed. The update path has no check for it (§12.6: `grep -n "unmanaged\|collision" src/clone-reinstall.ts src/nuke-reinstall-pipeline.ts src/update-groups.ts src/commands/update.ts` → no hits), so it would write over files agntc does not manage.

**Solution**: Before it removes or writes anything, an update looks at the paths it would write that its entry does not already own. When untracked files occupy any of them and `--overwrite` is not given, that entry stops. Its files and manifest entry stay as they were. The output says why and names `--overwrite`, and the command exits non-zero. In an update with no argument, the other entries proceed. A path the entry already owns is never in the way.

**Outcome**: `update` never writes over files it does not manage unless told to, and it says which entry it stopped and how to go on.

**Acceptance Criteria**:
- [ ] Given a skill installed under the old rules in `.claude/skills/composition-patterns/`, whose source declares `vercel-composition-patterns`, and the user's own untracked `.claude/skills/vercel-composition-patterns/`, when `update owner/repo/composition-patterns` runs, the outcome is (§4.4, §12.6):
  - the install in `.claude/skills/composition-patterns/` and its manifest entry are unchanged;
  - the untracked folder is unchanged;
  - the output names the entry, says what is in its way, and names `--overwrite`;
  - the command exits non-zero.
- [ ] Given the same install recorded for Codex, and a `.agents/skills/vercel-composition-patterns/` that Vercel's CLI installed, the update stops the same way (§12.6, §13)
- [ ] Given untracked files at the new path of each of these, the entry stops the same way (§5.5, §6.2, §12.6):
  - a skill recorded as a plugin that §5.5 repairs, at `.claude/skills/<declared folder>/`;
  - a `--plugin` bundle whose source gained `skills/edit/`, at `.claude/skills/edit/`, or gained a member's `agents/triage.md`, at `.claude/agents/triage.md`;
  - a skill whose declared name changed upstream to `taste-frontend`, at `.claude/skills/taste-frontend/`.
- [ ] Given such a stopped entry and another entry with a newer version upstream, when `update` runs with no argument, the other entry updates, the stopped entry and the untracked files are unchanged, and the command exits non-zero (§12.6)
- [ ] Given a plugin installed with `.claude/agents/reviewer.md`, when `update` runs with `reviewer.md` still in its source, it updates without stopping: a path the entry already owns is never in the way (§12.6)
- [ ] Given the old-rule install with the untracked declared-name folder, when it is updated from `list`, that update stops with the install and the untracked folder unchanged, and the message says why (§12.6)

**Do**:
- Check before anything is removed, leaving the install intact as update's derive-before-delete stop does today (`src/nuke-reinstall-pipeline.ts`) (§12.6).
- Count as untracked what add's untracked-files check counts: files on disk that no manifest entry tracks (`checkUnmanagedConflicts` in `src/unmanaged-check.ts`). Update handles an occupied target "the way `add` does" (§12.6).
- Where the work lives:
  - `executeNukeAndReinstall` in `src/nuke-reinstall-pipeline.ts`, and the paths it would write, which `computeIncomingFiles` (`src/compute-incoming-files.ts`) predicts for add;
  - the stop's report and exit accounting: `mapCloneFailure` and `failureMessage` (`src/clone-reinstall.ts`), `runSinglePluginUpdate` and `hasFailedOutcome` (`src/commands/update.ts`), and `mapReinstallResultToOutcome` (`src/update-groups.ts`).

**Context**:
> - §12.6: "An update can write into a folder or file it did not own before. This happens when: an entry moves to its declared-name folder (§4.4); an entry is repaired from plugin to skill (§5.5); the source gains a skill, agent or hook the entry takes in (§6.2); a skill's declared name changes upstream. The target may already be occupied: by a copy Vercel installed, by the user's own copy, or by another entry's same-named skill. ... Without `--overwrite`: `update` stops that entry and leaves the existing install intact. It says why and exits non-zero. This is the partial success across entries that `update` reports today."
> - §13: a Vercel install keeps its canonical copy in `.agents/skills/<name>`, the folder agntc installs Codex skills into. "Skills installed by Vercel are files agntc does not manage. They take the untracked-files path".
> - §10.3: the message for a unit stopped by what is in its way names `--overwrite`.
> - Related work elsewhere:
>   - task 4-11 handles another entry's files in the way, and task 4-12 a key another unit holds;
>   - task 4-13 adds `update --overwrite`;
>   - Phase 8 covers a path a plugin member left out at install because another entry from the same repository holds it, which is never in the way (§6, §12.6);
>   - Phase 14 covers a target that is a symlink (§13).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.4, §5.5, §6, §6.2, §10.3, §12.6, §13

## vercel-skills-compatibility-4-11

### Task vercel-skills-compatibility-4-11: Another entry's files in an update's new path stop that entry

**Problem**: An update's new path can also be held by another managed install: another entry's same-named skill in the declared-name folder, or another entry's agent or hook on a path a bundle or plugin gains (§6.2, §12.6). The update path has no collision check (§12.6), so it would write over files another entry records, and a later update or `remove` of either entry would delete the other's copy. `add` meets the same case through "Remove <key> and continue" (`src/collision-resolve.ts`).

**Solution**: Before it removes or writes anything, an update checks the paths it would write against the files other entries record. When another entry holds any of them and `--overwrite` is not given, that entry stops. Its install stays intact, and the other install's files and entry stay as they were. The output says why and names `--overwrite`, and the command exits non-zero. In an update with no argument, the other entries proceed.

**Outcome**: An update never writes over another entry's files unless told to.

**Acceptance Criteria**:
- [ ] Given a skill installed under the old rules as `owner/repo/composition-patterns`, whose source declares `vercel-composition-patterns`, while another repository's entry `other/skills/vercel-composition-patterns` holds `.claude/skills/vercel-composition-patterns/`, when `update owner/repo/composition-patterns` runs, the outcome is (§12.6):
  - `owner/repo/composition-patterns` stays in its old folder with its entry unchanged;
  - `other/skills/vercel-composition-patterns`'s files and entry are unchanged;
  - the output says what is in the way and names `--overwrite`;
  - the command exits non-zero.
- [ ] Given a `--plugin` bundle whose source gains `review/agents/reviewer.md` while another repository's entry holds `.claude/agents/reviewer.md`, when `update` runs, the bundle stops the same way and the other entry's `reviewer.md` is unchanged. A plugin whose `hooks/` gains a hook on a path another repository's entry holds stops the same way (§6.2, §12.6)
- [ ] Given a skill whose declared name changes upstream to `lint`, while another repository's entry holds `.claude/skills/lint/`, when `update` runs, the skill stops the same way (§12.6)
- [ ] Given such a stopped entry and a third entry with a newer version upstream, when `update` runs with no argument, the third entry updates, both clashing installs are unchanged, and the command exits non-zero (§10.3, §12.6)

**Do**:
- Check before anything is removed, as task 4-10 does (§12.6).
- Count as another entry's what add's collision check counts: a path another manifest entry records (`checkFileCollisions` in `src/collision-check.ts`).
- Where the work lives: the places task 4-10 names, in `src/nuke-reinstall-pipeline.ts`, `src/clone-reinstall.ts`, `src/commands/update.ts` and `src/update-groups.ts`.

**Context**:
> - §12.6: "The target may already be occupied: by a copy Vercel installed, by the user's own copy, or by another entry's same-named skill. ... `update` handles this the way `add` does (§10.3): Without `--overwrite`: `update` stops that entry and leaves the existing install intact. It says why and exits non-zero."
> - §12.6: "A path a plugin member left out at install because another entry from the same repository holds it (§6) is not one of these." Phase 8 builds that case.
> - Related work elsewhere: task 4-12 handles a key another unit holds, and task 4-13's `update --overwrite` removes the other entry, as "Remove <key> and continue" does.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §6, §6.2, §10.3, §12.6

## vercel-skills-compatibility-4-12

### Task vercel-skills-compatibility-4-12: An update moving onto a key another unit holds stops that entry

**Problem**: A move can land an entry on a key that another entry from the same repository holds as a different unit. Skill folder `bar/` declaring `foo`, installed under the old rules as `owner/repo/bar`, moves onto `owner/repo/foo`, which the top-level plugin member `foo/` holds (§4.3). The manifest holds one entry per key, so writing the moved entry would replace the member's entry and leave the member's files on disk untracked. That happens even when none of the two installs' files overlap.

**Solution**: An update whose move, re-key or repair lands on a key another entry holds as a different unit meets that entry in its way, whether or not files overlap. The holder is never read as the same install. Without `--overwrite`, the moving entry stops. Its install stays where it was, under its old key, and the holder's files and entry stay as they were. The output says the key is held and names `--overwrite`, and the command exits non-zero. In an update with no argument, the other entries proceed.

**Outcome**: No update takes over a key another unit holds unless told to.

**Acceptance Criteria**:
- [ ] Given skill folder `bar/` declaring `foo`, installed under the old rules as `owner/repo/bar` in `.claude/skills/bar/`, and the top-level plugin member `foo/` installed as `owner/repo/foo`, none of whose files lies in `.claude/skills/foo/`, when `update owner/repo/bar` runs, the outcome is (§4.3, §12.6):
  - `.claude/skills/bar/` and the entry `owner/repo/bar` are unchanged;
  - the member's files and the entry `owner/repo/foo` are unchanged;
  - the output says `owner/repo/foo` is held by another install and names `--overwrite`;
  - the command exits non-zero.
- [ ] Given a skill installed as `owner/repo/lint` from `skills/lint/`, whose declared name changes upstream to `foo` while the top-level member `foo/` holds `owner/repo/foo`, when `update` runs, the skill stops the same way (§4.3, §12.6)
- [ ] Given the top-level folder `kit/`, holding SKILL.md declaring `foo` beside `agents/`, recorded under the old rule as the plugin `owner/repo/kit`, while the top-level member `foo/` holds `owner/repo/foo`, when `update` runs, the entry is not repaired. It stops the same way, with its agents still in `.claude/agents/` (§4.4, §5.5, §12.6)
- [ ] Rule: a plugin member whose re-key to its path key lands on a key another entry holds as a different unit stops the same way (§4.4, §12.6)
- [ ] Given the stopped skill and another entry with a newer version upstream, when `update` runs with no argument, the other entry updates, `owner/repo/bar` and `owner/repo/foo` are both unchanged, and the command exits non-zero (§12.6)

**Do**:
- Tell the same install from another by §4.3's identity, as add does (task 4-9). Anything else on the key is in the way, whether or not files overlap (§4.3, §12.6).
- Check before anything is removed, as task 4-10 does.
- Where the work lives: the places task 4-10 names, and the manifest writes that key a moved entry (`runUpdate` and `persistUnitOutcomes` in `src/commands/update.ts`).

**Context**:
> - §4.3: "An add, or an existing install moving to its declared-name or path key (§4.4), can land on such a key. For example, a skill folder `bar/` declaring `foo`, installed under the old rules as `owner/repo/bar`, moves onto `owner/repo/foo`, which the top-level plugin member `foo/` holds. That entry is another managed install in the way (§10.3, §12.6) even when none of its files overlap. It is never read as the same install and never silently replaced."
> - §12.6: "An entry moving to a key that another entry from the same repository holds as a different unit meets that entry in its way too (§4.3), even when none of its files overlap." Without `--overwrite`, update stops that entry, leaves its install intact, says why and exits non-zero.
> - Related work elsewhere: task 4-13's `update --overwrite` removes the holder, and the moved entry takes the key.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §4.4, §5.5, §10.3, §12.6

## vercel-skills-compatibility-4-13

### Task vercel-skills-compatibility-4-13: update --overwrite replaces what is in the way

**Problem**: Tasks 4-10 to 4-12 stop an entry whose update meets something in its way and name `--overwrite`, but `update` declares no such flag: it takes only `[key]` (`updateCommand` in `src/commands/update.ts`). A user who wants the update to go ahead has no way through but removing the occupant by hand (§12.4, §12.6).

**Solution**: `update` takes `--overwrite`, for the single-key update and for all-mode. With it, what is in an entry's way is replaced and no prompt is shown:
- untracked files are overwritten;
- a managed install whose files are in the way is removed with its files and its entry, as "Remove <key> and continue" removes it;
- an entry holding the key a move lands on is removed with its files and its entry, and the moved entry takes the key.

**Outcome**: `update --overwrite` completes the moves, repairs and gained paths that would otherwise stop, and leaves one entry per key.

**Acceptance Criteria**:
- [ ] Given a skill installed under the old rules as `owner/repo/composition-patterns`, whose source declares `vercel-composition-patterns`, and the user's own untracked `.claude/skills/vercel-composition-patterns/`, when `update owner/repo/composition-patterns --overwrite` runs, the outcome is (§10.3, §12.6):
  - `.claude/skills/vercel-composition-patterns/` holds the skill;
  - `.claude/skills/composition-patterns/` is gone, and the entry is re-keyed `owner/repo/vercel-composition-patterns`;
  - the command exits 0.
- [ ] Given that skill's declared-name folder held instead by another repository's entry `other/skills/vercel-composition-patterns`, when `update --overwrite` runs, that entry's files and manifest entry are removed and the moved skill takes the folder (§10.3, §12.6)
- [ ] Given a `--plugin` bundle whose gained `agents/reviewer.md` lands on a path another repository's entry holds, when `update --overwrite` runs, that entry is removed with all its files and the bundle's `reviewer.md` is installed (§10.3, §12.6)
- [ ] Given skill folder `bar/` declaring `foo`, recorded as `owner/repo/bar`, and the top-level member `foo/` holding `owner/repo/foo`, when `update owner/repo/bar --overwrite` runs, the member's files and entry are removed and the skill moves to `.claude/skills/foo/`. The manifest holds `owner/repo/foo` for the skill and no `owner/repo/bar` (§4.3, §10.3, §12.6)
- [ ] Given entries that `update` with no argument stops for each of these reasons, when `update --overwrite` runs with no argument, what is in each one's way is replaced and every entry updates (§12.4)

**Do**:
- Remove a managed install in the way as "Remove <key> and continue" removes it: all its files and its manifest entry (`resolveCollisions` in `src/collision-resolve.ts`) (§10.3).
- Where the work lives: the `updateCommand` declaration, `runUpdate` and `runAllUpdates` in `src/commands/update.ts`, and the stops tasks 4-10 to 4-12 add.

**Context**:
> - §12.4: "`--overwrite` | Replace what is in a target folder's way (§12.6). Applies to the single-key update and to all-mode."
> - §10.3: "With `--overwrite`: what is in the way is replaced, and no clash prompt is shown. A clashing managed install is removed, as "Remove <key> and continue" removes it. Untracked files are overwritten."
> - §12.6: "With `--overwrite`: `update` replaces what is in the way." §4.3: "Removing the existing install, either way, hands the key to the new one."
> - Related work elsewhere:
>   - Phase 11 adds `--overwrite` to `add`;
>   - Phase 13 adds `update`'s other flags and aliases (`-y`, `-p`, `upgrade`);
>   - Phase 14 replaces a symlink target as a link under `--overwrite`, never writing through it (§13).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §10.3, §12.4, §12.6, §13
