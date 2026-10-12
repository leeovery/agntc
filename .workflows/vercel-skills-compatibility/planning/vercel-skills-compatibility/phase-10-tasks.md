# Phase 10: Pre-install summary and `--list` — 10 tasks

## vercel-skills-compatibility-10-1

### Task vercel-skills-compatibility-10-1: An attended add ends with its target agents and "Proceed with installation?"

**Problem**: After its prompts, an attended `add` goes straight to deleting and writing, with no final look at what is about to happen. A re-add removes the existing entry's files (`nukeManifestFiles` at step 10 of `runAdd`, and per member in `runCollectionPipeline`, `src/commands/add.ts`), then copies and writes the manifest. Some adds show no prompt at all: a single skill needs no member prompt, a unit whose ceiling is one detected agent skips the agent prompt (`selectAgents`, `src/agent-select.ts`), and since Phase 9 `-a` names the agents outright. In those runs whatever `add` shows scrolls past mid-install, and the installer has no point at which to back out (§11.1).

**Solution**: An attended `add` ends by showing its target agents and asking "Proceed with installation?" (§11.1, items 4 and 5). The question ends the run: it comes after the member, agent and clash prompts and before anything is deleted or written (§10.1). It is asked even when no other prompt was shown: a single skill whose agents `-a` names or whose one declared agent is detected, and a plugin whose one declared agent is detected (§10.1, §11.1). The target agents shown are the ones the add targets: chosen at the agent prompt, auto-selected, or named by `-a` (§11.1). Answering yes installs. Answering no, or cancelling the question, writes nothing, leaves every existing install and file as it was, and exits 0 (§10.1, §10.4). A re-add answered no keeps its existing files and manifest entry, an install the re-add would move to its declared-name folder and key included (§4.4, §8.4).

**Outcome**: No attended `add` deletes or writes anything until the installer has seen the target agents and answered yes.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds a single skill declaring `foo`, with Claude and Cursor detected, when `add owner/repo` runs at a terminal and Claude and Cursor are chosen at the agent prompt, the output names Claude and Cursor as the target agents and then asks "Proceed with installation?"; answering yes installs `foo` into `.claude/skills/foo/` and `.cursor/skills/foo/` and records the entry `owner/repo` (§11.1)
- [ ] Given the same repository and a project with no manifest, when "no" is answered at "Proceed with installation?", the command exits 0, nothing is written to any agent's skills directory, and no manifest is written; cancelling the question does the same (§10.1, §10.4)
- [ ] Given the same repository, `add owner/repo -a codex` at a terminal shows no member or agent prompt, names Codex as the target agent, and still asks "Proceed with installation?" before writing anything (§11.1)
- [ ] Given a single skill whose `agntc.json` lists `agents: ["claude"]`, and a plugin (`skills/a/` beside `agents/reviewer.md`) whose `agntc.json` lists `agents: ["claude"]`, each added at a terminal with Claude detected, no agent prompt is shown, Claude is named as the target agent, and "Proceed with installation?" is still asked (§10.1, §11.1)
- [ ] Given a repository with no semver tags whose root holds only `skills/a/` and `skills/b/`, when `add owner/repo` runs at a terminal, both are picked and Claude is chosen, "Proceed with installation?" is asked once, after the member and agent prompts; answering no installs neither and writes no manifest entry (§10.1, §11.1)
- [ ] Given a repository tagged `v1.0.0` and `v2.0.0` whose root holds a single skill declaring `foo`, installed for Claude from `owner/repo#v1.0.0`, when `add owner/repo#v2.0.0` re-adds it and "no" is answered, `.claude/skills/foo/` still holds the `v1.0.0` files and the entry still records `v1.0.0` and Claude (§8.4, §10.1)
- [ ] Given a repository with no semver tags whose `skills/composition-patterns/` declares `vercel-composition-patterns`, installed under the old rules into `.claude/skills/composition-patterns/` and keyed `owner/repo/composition-patterns`, when `add owner/repo@vercel-composition-patterns` re-adds it and "no" is answered, it stays in `.claude/skills/composition-patterns/` under its old key, and no `.claude/skills/vercel-composition-patterns/` folder appears (§4.4, §10.1)

**Do**:
- Ask "Proceed with installation?" as the prompt that ends an attended `add`: after the member, agent and clash prompts, and before any removal, copy or manifest write (§10.1, §11.1).
- Where the work lives: `runAdd` in `src/commands/add.ts` (its agent step, step 10's removal of the existing entry's files, the copy and the manifest write) and `runCollectionPipeline` there (its collection-wide agent prompt, the per-member removal of re-added members' files, the copy loop and the single manifest write); `selectAgents` (`src/agent-select.ts`), which auto-selects a single detected declared agent.

**Context**:
> - §11.1: "4. **The target agents.** 5. **"Proceed with installation?"** This ends an attended `add`, even when no other prompt was shown. At a terminal, a single skill installs without a member prompt. So does a plugin whose one declared agent is detected (§10.1). Without this confirmation, the summary would scroll past mid-install. `-y` and a detected agent caller answer it (§10.2, §10.5)."
> - §10.1 lists the prompts an `add` can meet: members, agents, the two clash prompts, and "Proceed with installation?", which "is new". "Answering no there, or cancelling at any prompt, leaves every existing install and file as it was." A cancel "exits 0 (§10.4)".
> - §8.4: a re-add installs for the recorded agents plus the named ones (Phase 4); §4.4: a re-add moves an install under its old key or folder to its declared-name folder and key (Phase 4). Neither may happen before the question is answered yes.
> - Related work elsewhere:
>   - what a clash prompt agrees to delete waits for this question (task 10-2), and a cancel at a clash prompt ends the run (task 10-3);
>   - the summary's items 1–3, shown ahead of the target agents, are tasks 10-4 to 10-6;
>   - `-y` and a detected agent caller answer the question, and a run with no terminal whose only remaining prompt is this one is refused naming `-y` (Phase 11, §10.2, §10.4, §10.5).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.4, §8.4, §10.1, §10.4, §11, §11.1

## vercel-skills-compatibility-10-2

### Task vercel-skills-compatibility-10-2: An install a clash prompt agreed to remove stays until "Proceed" is answered yes

**Problem**: Choosing "Remove <key> and continue" removes the other install's files and manifest entry on the spot (`resolveCollisions` calls `nukeManifestFiles`, `src/collision-resolve.ts`). Once task 10-1 adds "Proceed with installation?", a "no" there, or a cancel at a later prompt, would leave that install already deleted with nothing installed in its place. Untracked files agreed to "Overwrite all" must likewise survive a "no". §10.1: "What they agree to delete is removed only once "Proceed with installation?" is answered yes."

**Solution**: What a clash prompt agrees to delete is removed or overwritten only once "Proceed with installation?" is answered yes (§10.1). This covers a managed install agreed at "Remove <key> and continue", whether its files overlap the new install's or it holds the key the new install lands on with none of its files overlapping (§4.3), and untracked files agreed at "Overwrite all". Answering no at "Proceed", or cancelling there or at a later clash prompt of the same unit, leaves what was agreed as it was and exits 0 (§10.1, §10.4). In a menu run every unit's agreement waits for the one confirmation. Answering yes removes the agreed install with its files and entry and overwrites the agreed files, and the new install takes their place (§10.3). At a terminal the clash prompts otherwise work as they do today (§10.3): an install agreed for removal is not presented again as untracked files.

**Outcome**: Agreeing at a clash prompt deletes nothing by itself; only the final yes does.

**Acceptance Criteria**:
- [ ] Given `other/repo`, a single skill declaring `foo`, installed for Claude into `.claude/skills/foo/`, and a repository `owner/repo` with no semver tags whose root holds a single skill also declaring `foo`, when `add owner/repo` runs at a terminal for Claude, "Remove other/repo and continue" is chosen and "no" is answered at "Proceed with installation?", the command exits 0, `.claude/skills/foo/` still holds `other/repo`'s files, the `other/repo` entry is unchanged, and no `owner/repo` entry is written (§10.1)
- [ ] Given the same setup, when "yes" is answered instead, the `other/repo` entry and its files are removed, `.claude/skills/foo/` holds `owner/repo`'s copy, and the entry `owner/repo` is recorded (§10.1, §10.3)
- [ ] Given an untracked folder `.claude/skills/foo/` holding the user's own `SKILL.md`, when `add owner/repo` runs at a terminal for Claude, "Overwrite all" is chosen and confirmed, and "no" is answered at "Proceed with installation?", the folder and the user's `SKILL.md` are unchanged and the command exits 0; answering "yes" instead replaces them with `owner/repo`'s copy (§10.1)
- [ ] Given a repository with no semver tags whose top-level plugin member `foo/` (holding `agents/helper.md`) is installed for Claude as `owner/repo/foo`, when `https://github.com/owner/repo/tree/main/skills/bar` (whose SKILL.md declares `foo`) is added at a terminal for Claude, "Remove owner/repo/foo and continue" is chosen and "no" is answered at "Proceed with installation?", `.claude/agents/helper.md` and the entry `owner/repo/foo` are unchanged (§4.3, §10.1)
- [ ] Given `other/repo` installed for Claude into `.claude/skills/foo/` and an untracked folder `.cursor/skills/foo/`, when `add owner/repo` runs for Claude and Cursor, "Remove other/repo and continue" is chosen and the untracked-files prompt that follows is cancelled, the command exits 0, nothing is written, and `other/repo`'s files and entry are unchanged; cancelling at "Proceed with installation?" instead leaves them the same way (§10.1, §10.4)
- [ ] Given a repository with no semver tags whose root holds only `skills/a/` and `skills/b/`, with `.claude/skills/a/` held by `other/repo` (a single skill declaring `a`) and an untracked folder `.claude/skills/b/`, when both are picked for Claude, "Remove other/repo and continue" and "Overwrite all" (confirmed) are chosen, and "no" is answered at "Proceed with installation?", `other/repo`'s files and entry and the untracked `.claude/skills/b/` are all unchanged; answering "yes" instead replaces both and records `owner/repo/a` and `owner/repo/b` (§10.1)
- [ ] Given the first setup, once "Remove other/repo and continue" is chosen, no untracked-files prompt lists `other/repo`'s files in `.claude/skills/foo/` (§10.3)

**Do**:
- Remove what a clash prompt agreed to delete only after "Proceed with installation?" is answered yes (§10.1).
- Where the work lives: `resolveCollisions` (`src/collision-resolve.ts`), which removes the holder's files and entry as soon as "Remove <key> and continue" is chosen; `resolveUnmanagedConflicts` (`src/unmanaged-resolve.ts`); `runConflictChecks`, `runAdd` and `runCollectionPipeline` in `src/commands/add.ts`, where the key clashes of tasks 4-9 and 6-2 meet the same prompt; `checkUnmanagedConflicts` (`src/unmanaged-check.ts`), which counts any file on disk that no manifest entry tracks as untracked.

**Context**:
> - §10.1: "Only the two clash prompts delete anything when answered yes. What they agree to delete is removed only once "Proceed with installation?" is answered yes. Answering no there, or cancelling at any prompt, leaves every existing install and file as it was."
> - §10.3: "At a terminal without `-y` or `--overwrite`: the clash prompts work as they do today." Today the holder's files are deleted before the untracked-files check runs, so they are never listed there.
> - §4.3: a key held by another unit from the same repository, or by an install from another repository, is another managed install in the way even when none of its files overlap; it meets "Remove <key> and continue", and "Removing the existing install, either way, hands the key to the new one."
> - Related work elsewhere: a cancel at a clash prompt in a run installing several units ends the whole run, and declining one leaves that unit out (task 10-3); under `-y` or from an agent caller a clash stops the unit unless `--overwrite` is given (Phase 11, §10.3); a target that is a symlink is replaced as a link (Phase 14, §13).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §10.1, §10.3, §10.4

## vercel-skills-compatibility-10-3

### Task vercel-skills-compatibility-10-3: A cancel at a clash prompt ends the whole run; declining it leaves that unit out

**Problem**: The clash prompts do not tell a cancel from a decline. Cancelling "Remove <key> and continue" or the untracked-files prompt returns the same unresolved result as choosing the prompt's own decline option ("Cancel installation", "Cancel this plugin's install") or answering no at "Overwrite all"'s second confirmation (`resolveCollisions` in `src/collision-resolve.ts`, `resolveUnmanagedConflicts` in `src/unmanaged-resolve.ts`). In a run installing several units, `runCollectionPipeline` (`src/commands/add.ts`) then records that one unit as skipped and installs the rest. A cancel is the installer stopping the command, and §10.1 makes a cancel at any prompt end it, as Vercel ends a run cancelled at any of its prompts. A decline, recorded today as a skip, sits beside the skips that since tasks 8-14 and 9-6 make a run exit non-zero, though a decline is the installer's own choice and not something the tool left out.

**Solution**: In a run installing several units, a cancel at any unit's clash prompt ends the command and exits 0, where today it leaves only that unit out and the run goes on (§10.1, §10.4). Nothing is written for any unit of the run, and nothing another unit's clash prompt agreed to delete is removed. A cancel at "Overwrite all"'s second confirmation ends the command the same way. Choosing a clash prompt's own decline option, or answering no at "Overwrite all"'s second confirmation, is a decline, not a cancel: that unit is left out with what was in its way as it was, and the run's other units go on to "Proceed with installation?" (§10.1, §10.3). A unit left out by a decline does not make the command exit non-zero: the run exits 0 unless another entry fails or is skipped. A single-unit run declined at its clash prompt installs nothing and exits 0, as today (§10.1, §10.4).

**Outcome**: Cancelling a clash prompt stops the whole run with nothing changed; declining one leaves only that unit out, and the exit status does not count the decline against the run.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds only `skills/a/` and `skills/b/`, with `.claude/skills/a/` held by `other/repo` (a single skill declaring `a`) and an untracked folder `.claude/skills/b/`, when both are picked at a terminal for Claude, "Remove other/repo and continue" is chosen for `a` and the untracked-files prompt for `b` is cancelled, the command exits 0 with no further prompt, nothing of `a` or `b` is written, no manifest entry is added, and `other/repo`'s files and entry remain (§10.1, §10.4)
- [ ] Given the same setup, when the clash prompt for `a` is cancelled, the command ends there and exits 0, with no further prompt shown and nothing written (§10.1, §10.4)
- [ ] Given the same setup, when "Overwrite all" is chosen for `b` and its second confirmation is cancelled, the command ends the same way, exiting 0 with `other/repo` and `.claude/skills/b/` as they were (§10.1)
- [ ] Given the same setup, when the clash prompt's own decline option (today "Cancel installation") is chosen for `a`, `a` is left out with `other/repo`'s files and entry as they were, and the run goes on to `b`'s prompt and to "Proceed with installation?"; confirming "Overwrite all" and answering yes installs `b` alone, and the command exits 0 (§10.1, §10.3)
- [ ] Given the same setup, when "no" is answered at the second confirmation of "Overwrite all" for `b`, or the untracked-files prompt's own decline option (today "Cancel this plugin's install") is chosen, `b` is left out with `.claude/skills/b/` as it was, and the run goes on to "Proceed with installation?"; answering yes installs `a` in place of `other/repo`, and the command exits 0 (§10.1)
- [ ] Given a repository with no semver tags whose root holds only `skills/a/`, `skills/b/` and `skills/c/`, where `skills/c/agntc.json` lists `agents: ["codex"]` and `.claude/skills/a/` holds untracked files, when all three are picked at a terminal, Claude alone is chosen, and `a`'s untracked-files prompt is declined, `b` installs, `c` is skipped with a message, and the command exits non-zero (§8.2, §10.1)
- [ ] Given a repository with no semver tags whose root holds a single skill declaring `foo`, and `.claude/skills/foo/` held by `other/repo`, when `add owner/repo` runs at a terminal for Claude and the clash prompt's own decline option is chosen, nothing is installed, `other/repo`'s files and entry are unchanged, and the command exits 0 (§10.1, §10.4)

**Do**:
- Where the work lives: `resolveCollisions` (`src/collision-resolve.ts`) and `resolveUnmanagedConflicts` (`src/unmanaged-resolve.ts`), which return one unresolved result today for a cancel and for a decline; `runConflictChecks` and the single-unit stop in `runAdd` ("Cancelled — conflict not resolved", exit 0) in `src/commands/add.ts`; the per-member pass of `runCollectionPipeline` there, which records a member with an unresolved conflict as skipped and continues, and the run's closing exit status.

**Context**:
> - §10.1: "A cancel at any prompt ends the command, a clash prompt in a run installing several units included, so nothing another unit's clash prompt agreed to delete is removed; it exits 0 (§10.4), as Vercel ends a run cancelled at any of its prompts. Declining a clash prompt through its own option is not a cancel: in a run installing several units it leaves that unit out (§6) and the run's other units proceed, as the clash prompts do today (§10.3). A unit left out by a decline is the installer's own choice, not a partial result, so it does not make the command exit non-zero: the run exits 0 unless another entry fails or is skipped, and a single-unit run whose clash prompt is declined installs nothing and exits 0, as today, the way a deliberate cancel does (§10.4)."
> - §6: "An earlier entry the run skips, stops, or leaves out after a declined clash prompt writes nothing and takes no path." A later member's copy on that path installs (task 8-15).
> - §8.2: a unit whose ceiling excludes every named agent "is skipped with a message. The other units install, and the command exits non-zero" (task 9-6); §6 skips a picked entry left with nothing to install the same way (task 8-14).
> - §10.4: "A deliberate cancel at a terminal still exits 0."
> - Related work elsewhere: what an earlier unit's clash prompt agreed to delete waits for "Proceed with installation?" (task 10-2); under `-y` or from an agent caller the clash prompts are never shown (Phase 11, §10.3).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §6, §8.2, §10.1, §10.3, §10.4

## vercel-skills-compatibility-10-4

### Task vercel-skills-compatibility-10-4: The summary names the source and the version being installed

**Problem**: After cloning, `add` reports "Cloned successfully" and goes to its prompts (`runAdd`, `src/commands/add.ts`). The version it installs appears only in the headline printed once the install is done (`Installed owner/repo@<ref>`, `renderAddSummary` in `src/summary.ts`). A bare add chooses that version itself: the newest semver tag, or the default branch where the repository has none, and since Phases 5 and 7 it falls back to the default branch when the newest tag lacks what the line names or holds nothing installable (§2.5). The installer would answer "Proceed with installation?" without knowing which version is going in.

**Solution**: After cloning, the summary names the source and the version being installed (§11.1, item 1), ahead of the shape, the skills and the target agents. For a bare add the version is the newest semver tag it resolved, or the default branch where the repository has no semver tags (§2.5). A fallback to the default branch is named as one, whether the newest tag lacked a skill or path the line names or held nothing installable (§2.5). A ref given by `#` or in the URL shows that tag or branch, and a constraint shows the tag it resolved to (§2.4, §2.5).

**Outcome**: Before agreeing to install, the installer sees which version is going in and whether a bare add fell back to the default branch.

**Acceptance Criteria**:
- [ ] Given a repository tagged `v1.0.0` and `v1.2.0` whose root holds a single skill, when `add owner/repo` runs at a terminal, after cloning the output names the source `owner/repo` and the version `v1.2.0`, names no fallback, and does so ahead of "Proceed with installation?" (§2.5, §11.1)
- [ ] Given a repository with no semver tags whose root holds a single skill, `add owner/repo` names the default branch as the version (§2.5, §11.1)
- [ ] Given a repository whose newest tag `v1.2.0` lacks `skills/new-skill/` while its default branch holds it, `add owner/repo@new-skill` names the default branch as the version and says the add fell back to it from the newest tag; `add owner/repo/skills/new-skill` does the same (§2.5, §11.1)
- [ ] Given a repository whose newest tag holds nothing installable while its default branch holds `skills/a/`, `add owner/repo` names the default branch and says the add fell back to it (§2.5, §11.1)
- [ ] Given a repository tagged `v1.0.0`, `v1.4.0` and `v2.0.0` with a `develop` branch, `add owner/repo#v1.0.0` names `v1.0.0`, `add owner/repo#develop` and `https://github.com/owner/repo/tree/develop` name `develop`, and `add owner/repo#^1.0` names `v1.4.0`, none of them naming a fallback (§2.4, §2.5, §11.1)

**Do**:
- Where the work lives: `resolveTagConstraint` in `src/commands/add.ts`, which resolves a bare add's newest tag and a constraint's best match, and the default-branch fallbacks tasks 5-13, 7-11 and 7-12 add beside it; `runAdd`, after its clone.

**Context**:
> - §11.1: "The display follows Vercel's order and is sized for agntc's three agents rather than Vercel's 79-agent list." Item 1: "**The source and the version** being installed. For a bare add this is the resolved tag, or the default branch, which includes the fallback of §2.5."
> - §11: "After cloning, `add` today goes straight to its prompts with little context. ... What remains is the information shown after the clone."
> - §2.5: a bare add "installs the newest semver tag and records a caret constraint", or "the default branch when the repo has no semver tags". "In two cases the bare add installs from the default branch instead, says so in its output, and records no constraint: The newest tag lacks something the line names: a skill selected by `@` or `--skill`, or the path in the source. The newest tag holds nothing installable".
> - §2.4: `#^1.0`/`#~1.2` resolve the best matching tag; `#v2.0.0` is that tag; `#main` is that branch. A ref carried in the URL is read the way the same `#` fragment would be (§2.5).
> - Where this specification is silent on how the display looks, Vercel's behaviour is the answer (§1.4).
> - Related work elsewhere: `--list` prints the same item (task 10-7).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §2.4, §2.5, §11, §11.1

## vercel-skills-compatibility-10-5

### Task vercel-skills-compatibility-10-5: The summary shows the source's shape with its skills, agents and hooks

**Problem**: After cloning, nothing `add` shows describes what the source holds beyond the menu's labels. A plugin's agents and hooks install with no prompt that names them, and hooks get no extra gate (§10.6): the pre-install summary listing them is the owner's look at what lands. The only account of a unit's contents today is the post-install summary, which counts assets per agent once they are copied (`formatPluginSummary`, `src/summary.ts`).

**Solution**: After cloning, the summary shows the source's detected shape (§11.1, item 2). A single skill is shown under its declared name (§4.1). A plugin is shown with its skills, agents and hooks by name, its skills being the ones discovery finds under its `skills/` (§6.1). Otherwise the source is N skills, and each plugin member among them is listed by its path with its contents, its hooks by name (§5.3, §7.1, §10.6). A `--plugin` or `"type": "plugin"` bundle is shown as one unit with the skills, agents and hooks it takes (§6.2). Each unit is shown with its skills the way the `add` miss message shows it (§7.2, §11.2). Internal loose skills are not listed when no skill is named, while a plugin, plugin member or bundle lists the internal skills it takes (§5.4, §6.1, §6.2).

**Outcome**: Before agreeing to install, the installer sees what the source holds: its skills, and every agent and hook a unit lands.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose `skills/taste-skill/` declares `design-taste-frontend`, `add owner/repo/skills/taste-skill` at a terminal shows a single skill named `design-taste-frontend`, not `taste-skill` (§4.1, §11.1)
- [ ] Given a plugin repository with no semver tags holding `skills/a/`, `skills/tools/b/` (a category folder), a loose `skills/README.md`, `agents/reviewer.md` and `hooks/format.sh`, `add owner/repo` shows a plugin whose skills are `a` and `b`, with neither `README.md` nor `tools` among them, and names its agent from `agents/reviewer.md` and its hook from `hooks/format.sh` (§6.1, §10.6, §11.1)
- [ ] Given a repository with no semver tags holding `skills/react/` and the top-level plugin member `tools/` (holding `agents/helper.md`, `hooks/lint.sh` and `skills/fmt/`), when `add owner/repo` runs at a terminal and both are picked, the summary shows `react` as a skill and `owner/repo/tools` as a plugin member with its skill `fmt` and its agent and hook by name (§5.3, §7.1, §10.6, §11.1)
- [ ] Given the same repository, the summary shows each unit with its skills as `add owner/repo --skill nope` lists them in its refusal (§7.2, §11.2)
- [ ] Given a repository with no semver tags whose root holds only `skills/a/` and `skills/tools/b/`, `add owner/repo --plugin` shows one unit holding `a` and `b`, and so does `add owner/repo` once the root `agntc.json` declares `"type": "plugin"`; the repository of the third criterion added with `--plugin` shows one unit holding `react` and `fmt`, with the agent and hook of `tools/` by name (§6.2, §11.1)
- [ ] Given a repository with no semver tags whose root holds only `skills/a/` and `skills/hidden/`, whose frontmatter sets `metadata.internal: true`, `add owner/repo` lists `a` and not `hidden`, while `add owner/repo --plugin` lists both; a plugin whose `skills/` holds `hidden`, and a plugin member whose `skills/` holds it, list it among their skills (§5.4, §6.1, §6.2)

**Do**:
- Where the work lives: discovery in `src/type-detection.ts`, which yields the skills, plugin members and bundle contents (Phases 2 and 3); the display of units that the miss message of task 8-11 uses (`src/commands/add.ts`); `runAdd` and `runCollectionPipeline` there, after the clone.

**Context**:
> - §11.1, item 2: "**The detected shape:** a single skill; a plugin, with its skills, agents and hooks; or N skills. Plugin members (§5.3) are listed with their contents." And: "Hooks a unit installs appear in the summary by name (§10.6)." The display "carries no security-risk table (§1.3)".
> - §10.6: "A unit carrying hooks installs under `-y` like any other unit. The pre-install summary lists the hooks it lands (§11). The owner's look at an unattended install is the command line the calling agent asks permission to run."
> - §7.1: a plugin member "is selected by its path in the source (`owner/repo/<path>`) ... `--list` (§11.2) and the miss message (§7.2) show each plugin member with that path." §7.2: on a miss, "each unit is shown with its skills as `--list` shows it (§11.2)".
> - §6.1: "A plugin's skills are the skills discovery finds under its `skills/`"; "nothing else in `skills/` installs, neither a loose file nor a folder holding no skill".
> - §5.4: an internal skill "is left out of "all" ... and out of the menu"; a bundle includes it.
> - Where this specification is silent on how the display looks, Vercel's behaviour is the answer (§1.4).
> - Related work elsewhere: each skill's description is task 10-6; `--list` prints this display (task 10-7); how a member's path prints for a source not on GitHub is Phase 15 (§14.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §4.1, §5.3, §5.4, §6.1, §6.2, §7.1, §7.2, §10.6, §11.1, §11.2

## vercel-skills-compatibility-10-6

### Task vercel-skills-compatibility-10-6: Each skill's description is shown as Vercel reads it

**Problem**: agntc reads only `name` (task 1-1) and `metadata.internal` (task 2-9) from a skill's frontmatter, so nothing tells the installer what a skill does before it lands; Vercel's CLI shows each skill's description. A description is author-supplied text: printed as it stands, its terminal escape sequences and control characters reach the terminal, and its line breaks split it across lines (§3.2, §3.3).

**Solution**: Each skill the summary lists shows its one-line description, read from its SKILL.md frontmatter (§3.1, §11.1, item 3), a unit's skills included. It is read as Vercel reads it: terminal escapes stripped, line breaks turned into spaces, leading and trailing whitespace trimmed (§3.2), with control characters and terminal escapes stripped before printing (§3.3). A `description` that is absent or not a string shows none. A skill that goes by its folder name because its SKILL.md has no frontmatter, no string `name` (an empty `name` included), YAML that fails to parse, or a fence that is not YAML has no description (§3.2). A skill with no description installs as any other does, with no warning (§3.2, §5.4).

**Outcome**: The installer sees what each skill does, as one clean line.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds `skills/a/`, declaring `name: a` and `description: Formats code`, and `skills/b/`, declaring `name: b` and `description: Lints code`, when `add owner/repo` runs at a terminal and both are picked, the summary shows `a` with `Formats code` and `b` with `Lints code` (§11.1)
- [ ] Given a plugin whose `skills/x/` declares `description: Reviews diffs`, and a repository whose plugin member `tools/` holds `skills/fmt/` declaring `description: Formats code`, the summary shows each description beside its skill (§11.1)
- [ ] Given a skill whose `description` is `42`, is a list, or is absent, the summary shows it with no description (§3.2)
- [ ] Given a SKILL.md declaring `description: Formats code` beside no `name`, beside `name: ""`, in YAML that fails to parse, or under a `---toml` fence, the skill is shown under its folder name with no description; a SKILL.md with no frontmatter is shown the same way (§3.2)
- [ ] Given a description `"\e[31mRed\e[0m alert\x07"`, it is shown as `Red alert`, with no escape sequence or control character reaching the terminal (§3.2, §3.3)
- [ ] Given a description `"  Formats\ncode  "`, it is shown as `Formats code` on one line (§3.2)
- [ ] Given a skill with no description, it installs as any other skill does and no warning is shown (§3.2, §5.4)
- [ ] Rule: no description text `add` prints carries a terminal escape sequence or a control character (§3.3)

**Do**:
- Read `description` as Vercel v1.7.0's `sanitizeMetadata` reads it (Vercel's `src/sanitize.ts:61–65`): strip terminal escapes, turn line breaks into spaces, and trim leading and trailing whitespace. A `description` that is not a string counts as none (§3.2).
- Strip control characters and terminal escape sequences from a description before printing it, as Vercel does (§3.3).
- Where the work lives: the frontmatter read task 1-1 adds and the name cleaning task 1-9 adds; the summary display of task 10-5.

**Context**:
> - §3.1: `description` is used for "The one-line description in the pre-install summary and `--list` (§11)". Frontmatter "never decides a source's type or whether a skill is valid".
> - §3.2: "The skill goes by its folder name when its `SKILL.md` has any of the following: no frontmatter; frontmatter with no string `name`; YAML that fails to parse; a fence that is not YAML. In each case the skill has no description and installs normally, with no warning, as it does today. A `description` that is not a string counts as no description." "A `name` that is an empty string counts as no `name`."
> - §3.3: "Frontmatter is parsed as plain data." "Before agntc prints frontmatter text (names and descriptions), it strips control characters and terminal escape sequences, as Vercel does."
> - §5.4: "A skill without a `name` or `description` still installs. It is named by its folder (§3.2) and no warning is shown." This diverges from Vercel, which skips such skills.
> - Where this specification is silent on an edge of this reading, Vercel's behaviour is the answer (§1.4).
> - Related work elsewhere: `--list` prints the same descriptions (task 10-7).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §3.1, §3.2, §3.3, §5.4, §11.1

## vercel-skills-compatibility-10-7

### Task vercel-skills-compatibility-10-7: `-l`/`--list` prints the listing and installs nothing

**Problem**: An AI agent caller can make choices but cannot see a prompt (§10). To choose skills with `--skill` and agents with `-a`, it needs to see what a repository holds, and nothing shows it: `add` takes no listing flag (`add owner/repo --list` stops with `error: unknown option '--list'` and exits 1 on today's build), and with no terminal `add` exits 0 with nothing installed and no message (§10.4). Vercel's CLI answers this with `--list`.

**Solution**: `add` takes `-l`/`--list` (§9.1). It prints the summary's items 1–3: the source and version, the shape, and each skill with its description (§11.1, §11.2). It shows no target agents and does not ask "Proceed with installation?". It installs nothing: no file and no manifest entry are written, and existing installs are unchanged. It opens no prompt, needs no terminal, and exits 0 (§11.2). It lists the version the same line without `--list` would install: a `#` ref or constraint lists the tag or branch it names or resolves to (§2.4), and a bare `--list` whose newest tag holds nothing installable lists the default branch and names the fallback (§2.5). A source where discovery finds nothing installable is refused (§5.1).

**Outcome**: Any caller, with or without a terminal, can see what a line would install before choosing, and nothing is written.

**Acceptance Criteria**:
- [ ] Given a repository tagged `v1.0.0` and `v1.2.0` whose root holds `skills/a/` (declaring `description: Formats code`) and `skills/b/`, `add owner/repo --list` prints the source `owner/repo`, the version `v1.2.0`, the shape, and `a` with `Formats code` and `b`; it shows no prompt, names no target agents, does not ask "Proceed with installation?", and exits 0 (§11.1, §11.2)
- [ ] Given the same repository, `add owner/repo -l` prints the same listing (§9.1)
- [ ] Given a project with no manifest, after `add owner/repo --list` nothing has been written under `.claude/`, `.agents/` or `.cursor/` and no manifest exists; given `a` already installed from the same repository, its files and its entry are unchanged (§11.2)
- [ ] Given stdin that is not a terminal, at end-of-input or held open and silent, `add owner/repo --list` prints the listing and exits 0 without waiting on input (§10.4, §11.2)
- [ ] Given a plugin repository holding `skills/a/`, `agents/reviewer.md` and `hooks/format.sh`, `add owner/repo --list` lists the plugin with its skill, agent and hook as the summary shows them (§11.1, §11.2)
- [ ] Given a repository tagged `v1.0.0`, `v1.4.0` and `v2.0.0` with a `develop` branch, `add owner/repo#v1.0.0 --list` lists `v1.0.0`, `add owner/repo#^1.0 --list` lists `v1.4.0`, and `add owner/repo#develop --list` lists `develop` (§2.4, §11.2)
- [ ] Given a repository whose newest tag holds nothing installable while its default branch holds `skills/a/`, `add owner/repo --list` lists the default branch, names the fallback, and lists `a` (§2.5, §11.2)
- [ ] Given a repository with no semver tags in which discovery finds nothing installable, `add owner/repo --list` exits non-zero and says nothing installable was found (§1.5, §5.1)

**Do**:
- Declare `-l, --list` on `add` (§9.1).
- Print the same display as the summary's items 1–3 (§11.2).
- Where the work lives: `addCommand` and `runAdd` in `src/commands/add.ts`; the displays of tasks 10-4 to 10-6.

**Context**:
> - §11.2: "`-l`/`--list` prints the same shape and skill list as §11.1, items 1–3. It installs nothing and exits 0. It needs no terminal, and it is how an agent caller sees a repo's contents before choosing with `--skill` and `-a`."
> - §10: "An agent caller can make choices but cannot see a prompt."
> - §10.4: "Today, with no terminal, `add` exits 0 with nothing installed and no message ... At end-of-input its first prompt never resolves ... With stdin held open but silent, it hangs until killed."
> - §5.1: "A source where discovery finds nothing installable is refused (§1.5)."
> - Related work elsewhere:
>   - `--list` with a choice of skills or agents is refused (task 10-10); `--plugin` and `--full-depth` shape the listing (task 10-8), and so does a path in the source (task 10-9);
>   - `--list` with `-y` or `--overwrite`, or run from a detected agent caller, lists and installs nothing (Phase 11, §11.2);
>   - `--list` with `--json` or `--all` is refused and `--list --copy` lists (Phase 12, §9.2, §11.2).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §2.4, §2.5, §5.1, §9.1, §10, §10.4, §11.1, §11.2

## vercel-skills-compatibility-10-8

### Task vercel-skills-compatibility-10-8: `--plugin` and `--full-depth` shape what `--list` lists

**Problem**: `--list` is how a caller sees what a line installs before running it (§11.2). `--plugin` turns a skills-only menu into one bundle (§6.2), and `--full-depth` turns off the root early-out and walks the whole source (§5.1, §5.2). A listing that ignored them would show something other than what the same line installs, and a line that `add` refuses would list as if it were valid.

**Solution**: `--plugin` and `--full-depth` shape what `--list` lists (§11.2). `--plugin` on a skills-only source lists one bundle holding every skill it takes, internal skills included (§5.4, §6.2). On a root SKILL.md beside `skills/` alone it lists the bundle of `skills/` without the root SKILL.md, and on a plugin it lists the plugin unchanged (§6.6). The listing is refused where §6.6 refuses the line, exiting non-zero and writing nothing (§1.5): `--plugin` on a lone root SKILL.md, `--plugin` on a root SKILL.md beside `agents/` or `hooks/` with no `"type": "plugin"`, `--plugin` together with `--full-depth`, and `--full-depth` on a source declaring `"type": "plugin"`. `--full-depth` lists a root SKILL.md as a skill of its own beside the skills found below it (§5.2).

**Outcome**: `--list` with `--plugin` or `--full-depth` shows exactly what the same line without `--list` would install, and refuses what it would refuse.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds only `skills/a/`, `skills/tools/b/` and `skills/hidden/` (whose frontmatter sets `metadata.internal: true`), `add owner/repo --plugin --list` lists one bundle holding `a`, `b` and `hidden`, writes nothing and exits 0, while `add owner/repo --list` lists `a` and `b` as separate skills and not `hidden` (§5.4, §6.2, §11.2)
- [ ] Given a repository with no semver tags whose root SKILL.md declares `root` beside `skills/a/` alone, `add owner/repo --plugin --list` lists a bundle holding `a` and not `root`, while `add owner/repo --list` lists the single skill `root` (§5.1, §6.6, §11.2)
- [ ] Given a plugin repository with no semver tags (`skills/a/` beside `agents/reviewer.md`), `add owner/repo --plugin --list` prints the same listing as `add owner/repo --list` (§6.6, §11.2)
- [ ] Given a repository whose root holds only a SKILL.md, and one whose root SKILL.md sits beside `agents/` with no `"type": "plugin"`, `add owner/repo --plugin --list` exits non-zero, writes nothing, and names `--plugin` as refused on that source (§1.5, §6.6, §11.2)
- [ ] Given a skills-only repository, `add owner/repo --plugin --full-depth --list` exits non-zero, writes nothing, and names `--plugin` and `--full-depth` as not combining; given a repository whose `agntc.json` declares `"type": "plugin"`, `add owner/repo --full-depth --list` is refused the same way (§6.6, §9.1, §11.2)
- [ ] Given a repository with no semver tags whose root SKILL.md declares `root` beside `skills/a/` and `tools/x/SKILL.md`, `add owner/repo --full-depth --list` lists `root` as a skill of its own beside `a` and `x`, while `add owner/repo --list` lists the single skill `root` (§5.1, §5.2, §11.2)

**Do**:
- Where the work lives: the `--plugin` handling of `runAdd` in `src/commands/add.ts` and `detectType`'s `forcePlugin` (`src/type-detection.ts`), with the refusals of tasks 1-6 and 3-7; the `--full-depth` walk of tasks 2-5 and 2-6; the listing of task 10-7.

**Context**:
> - §11.2: "`--plugin` and `--full-depth` shape what is listed (§6.2, §5.2), and `--plugin` is refused where §6.6 refuses it."
> - §6.6: `--plugin` on a single skill (a root SKILL.md) is refused, except a root SKILL.md beside `skills/` alone, which bundles `skills/` and leaves the root SKILL.md out; `--plugin` on a plugin "is redundant and changes nothing"; "`--plugin` together with `--full-depth` is refused (§1.5), and so is `--full-depth` on a source whose `agntc.json` declares `"type": "plugin"` ... The message names the two as not combining."
> - §6.2: a bundle holds every skill discovery finds and internal skills (§5.4).
> - §5.2: "Under `--full-depth`, a root `SKILL.md` is offered as a skill of its own (keyed `owner/repo`, §4.3) beside the skills found below it".
> - Related work elsewhere: a path in the source shaping the listing, `--plugin` with a path included, is task 10-9.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §5.1, §5.2, §5.4, §6.2, §6.6, §9.1, §11.2

## vercel-skills-compatibility-10-9

### Task vercel-skills-compatibility-10-9: A path in the source narrows what `--list` lists

**Problem**: A path in the source narrows an install to the folder it names: one skill, one plugin member, a category folder of skills, or a pick inside a unit (§5.1, §6.2, §6.5). A listing of the whole repository for such a line would show skills the line never installs. And a line `add` refuses, such as a path into a unit whose `agntc.json` declares `"type": "plugin"`, would list as if it were valid.

**Solution**: A path in the source narrows the listing to what it names, as it narrows an install (§11.2). A path at a loose skill lists that skill alone. A path naming a plugin member that sits in no plugin lists that member with its contents (§5.1, §5.3). A path naming a category folder of loose skills lists the skills discovery finds there (§5.1). A tree URL, a GitLab `/-/tree/` URL and an Azure Repos `?path=` URL narrow it the same way (§2.1). `--plugin` with a path at a folder lists the bundle narrowed to that folder, while `--plugin` with a path at one skill is refused (§6.2, §6.6). A bare `--list` whose newest tag lacks the path lists the default branch and names the fallback, and a path that neither the newest tag nor the default branch holds is refused (§2.5, §5.1). A path landing inside a unit lists what that pick installs (§6.5), and the line is refused wherever §6.5 refuses that pick, a unit declaring `"type": "plugin"`; the message names the listing of the whole unit (§11.2).

**Outcome**: `--list` with a path shows exactly what the same line without `--list` would install, and refuses what it would refuse.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds only `skills/a/` (declaring `description: Formats code`) and `skills/b/`, `add owner/repo/skills/a --list` lists `a` alone, with its description, and exits 0 (§5.1, §11.2)
- [ ] Given a repository with no semver tags holding `skills/react/` and the top-level plugin member `tools/` (holding `agents/helper.md`, `hooks/lint.sh` and `skills/fmt/`), `add owner/repo/tools --list` lists `owner/repo/tools` with `fmt` and its agent and hook, and lists nothing of `react` (§5.1, §5.3, §11.2)
- [ ] Given a repository with no semver tags whose root holds only `skills/frontend/react/`, `skills/frontend/vue/` and `skills/backend/go/`, `add owner/repo/skills/frontend --list` lists `react` and `vue` and not `go`; `add https://github.com/owner/repo/tree/main/skills/frontend --list` lists the same, and so do `https://gitlab.com/group/repo/-/tree/main/skills/frontend` and `https://dev.azure.com/org/project/_git/repo?path=/skills/frontend` into repositories of the same shape (§2.1, §5.1, §11.2)
- [ ] Given the same repository, `add owner/repo/skills/frontend --plugin --list` lists one bundle holding `react` and `vue`, while `add owner/repo/skills/frontend/react --plugin --list` exits non-zero and writes nothing (§6.2, §6.6, §11.2)
- [ ] Given a repository whose newest tag `v1.0.0` lacks `skills/new/` while its default branch holds it, `add owner/repo/skills/new --list` lists the default branch, names the fallback, and lists `new`; `add owner/repo/skills/nope --list`, a path neither holds, exits non-zero (§2.5, §5.1, §11.2)
- [ ] Given a plugin repository with no semver tags holding `skills/x/`, `skills/y/` and `agents/reviewer.md`, with no `"type": "plugin"`, `add owner/repo/skills/x --list` lists `x` alone, and `add owner/repo/skills --list` lists `x` and `y` (§6.5, §11.2)
- [ ] Given the same plugin with a root `agntc.json` declaring `"type": "plugin"`, `add owner/repo/skills/x --list` exits non-zero, writes nothing, and its message names the listing of the whole unit, `add owner/repo --list`; given a top-level member `tools/` whose own `agntc.json` declares `"type": "plugin"`, `add owner/repo/tools/skills/fmt --list` is refused naming `add owner/repo/tools --list` (§6.5, §11.2)

**Do**:
- Where the work lives: the path handling `runAdd` (`src/commands/add.ts`) reaches through tasks 2-7, 5-1, 5-8 and 5-9; the picks inside a unit of tasks 8-5 and 8-6 and their refusal in task 8-7; the path fallback of task 5-13; the listing of task 10-7.

**Context**:
> - §11.2: "A path in the source narrows the listing to what it names, as it narrows an install. A path landing inside a unit lists what that pick installs (§6.5), and the line is refused wherever §6.5 refuses that pick, a unit declaring `"type": "plugin"`; the message names the listing of the whole unit."
> - §5.1 rule 3: "A path into the repository that names a non-hidden folder of this shape names a skill pack, a plugin member (§5.3), and not a menu. It installs that member whole under its member key (§4.3)".
> - §6.5: a path landing inside a unit, "either at one of its skills ... or at a folder of its skills", is handled as a pick by name; "the line is refused when the unit declares `"type": "plugin"`". A path naming a plugin member nested in a plugin's `skills/` is a pick from the plugin.
> - §6.6: "A path in the source is not a pick, and it works with `--plugin` (§6.2)"; `--plugin` on a single skill is refused.
> - §2.5: a bare add falls back to the default branch when "The newest tag lacks something the line names: ... the path in the source".
> - Related work elsewhere: `--list` with `@skill` or `--skill`, which name a pick rather than shape the source, is refused (task 10-10).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §2.1, §2.5, §5.1, §5.3, §6.2, §6.5, §6.6, §11.2

## vercel-skills-compatibility-10-10

### Task vercel-skills-compatibility-10-10: `--list` with a choice of skills or agents is refused

**Problem**: A listing installs nothing, so a skill named by `@` or `--skill`, or an agent named by `-a`, has nothing to choose. Vercel v1.7.0 lists every skill and exits 0 before it reads `--skill` or `-a` (`src/add.ts`), dropping them without saying so (§11.2). A caller that wrote `add owner/repo@foo -a claude --list` meaning to install would get a listing and an exit 0, which reads as success to an agent caller (§1.5).

**Solution**: `--list` together with a choice of skills or agents is refused (§1.5, §11.2): `@skill` (in `#ref@skill` too), `-s`/`--skill` (`'*'` included) and `-a`/`--agent` (`'*'` included). The command exits non-zero and writes nothing. The message names the two ways through: the listing without the choice, and the install without `--list`.

**Outcome**: A `--list` line that also chooses skills or agents never silently drops the choice; it stops and says which line was meant.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds only `skills/foo/` and `skills/bar/`, `add owner/repo@foo --list` exits non-zero, writes nothing, and its message names the listing without the choice, `add owner/repo --list`, and the install without `--list`, `add owner/repo@foo` (§1.5, §11.2)
- [ ] Given a repository tagged `v2.0.0` holding the same skills, `add owner/repo#v2.0.0@foo --list` is refused the same way, its message naming `add owner/repo#v2.0.0 --list` and `add owner/repo#v2.0.0@foo` (§2.4, §11.2)
- [ ] Given the first repository, `add owner/repo --list --skill foo`, `add owner/repo -l -s foo` and `add owner/repo --list --skill '*'` are each refused, the message naming the listing without the `--skill` names and the install without `--list` (§11.2)
- [ ] Given the first repository, `add owner/repo --list -a claude` and `add owner/repo --list --agent '*'` are each refused, the message naming the listing without `-a` and the install without `--list` (§11.2)
- [ ] Given `foo` already installed from the first repository, a refused `--list` line leaves its files and its entry unchanged (§1.5)

**Do**:
- Where the work lives: `addCommand` and `runAdd` in `src/commands/add.ts`, where the `--list` of task 10-7 meets the `@` names of task 7-3, the `--skill` names of task 7-5 and the `-a` agents of task 9-1.

**Context**:
> - §11.2: "Nor does it take a choice of skills or agents: `--list` with `@skill`, `-s`/`--skill` (`'*'` included), `-a`/`--agent` or `--all` is refused (§1.5). A listing installs nothing for them to choose, and the message names the two ways through: the listing without them, or the install without `--list`. **This diverges from Vercel, under never-silently-ignore (§1.5).** Vercel v1.7.0 lists every skill and exits 0 before it reads `--skill` or `-a` (`src/add.ts`), dropping them without saying so."
> - §1.5: a refusal exits non-zero, writes nothing and removes nothing, and its message "names what was refused, and the way through where one exists". "A refusal that exited 0 would read as success to an AI agent caller".
> - §14.1: "Every command agntc prints is one agntc accepts".
> - Related work elsewhere: a path in the source is not a choice and shapes the listing (task 10-9); `--list --all` and `--list --json` are refused once `--all` and `--json` exist (Phase 12, §9.2, §11.2); `-y`, `--overwrite` and `--copy` are accepted with `--list` (Phases 11 and 12, §11.2).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §2.4, §11.2, §14.1
