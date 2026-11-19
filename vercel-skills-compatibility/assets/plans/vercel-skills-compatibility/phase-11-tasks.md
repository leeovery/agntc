# Phase 11: Unattended `add` — 14 tasks

## vercel-skills-compatibility-11-1

### Task vercel-skills-compatibility-11-1: `-y` installs a unit with no prompt

**Problem**: Since Phase 10 every attended `add` ends with "Proceed with installation?" (§11.1). Even a line that names its skills with `@`/`--skill` and its agents with `-a` stops for that prompt. An AI agent caller can make choices but cannot see a prompt (§10), and `add` has no flag that answers one: `add owner/repo -y` stops with `error: unknown option '-y'` on today's build. Vercel's `-y` answers its prompts.

**Solution**: `add` takes `-y`/`--yes` (§9.1). Under `-y` nothing is asked (§10.2):
- "Proceed with installation?" is answered yes, and the pre-install summary is still printed ahead of the install (§10.6, §11.1);
- a unit carrying hooks installs like any other unit, with no extra gate, and the summary lists its hooks by name (§10.6);
- `-a` beside `-y` targets the agents it names rather than the detected ones, so a line stating its agents installs for exactly those (§8.1, §10.4, §14.1);
- with no terminal, `-y` opens no prompt and the add installs (§10.4).

`--list -y` lists, installs nothing and exits 0 (§11.2). The clash prompts are not answered by `-y` (§10.3).

**Outcome**: A line carrying `-y` installs with no prompt, at a terminal or without one, after printing the summary.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds a single skill declaring `foo`, when `add owner/repo -a claude -y` runs at a terminal, no prompt is shown, the summary naming `foo` and Claude as the target agent is printed, `foo` installs into `.claude/skills/foo/` under the entry `owner/repo`, and the command exits 0 (§10.2, §11.1)
- [ ] Given the same repository, `add owner/repo -a claude --yes` installs and records exactly what `add owner/repo -a claude -y` does (§9.1)
- [ ] Given the same repository and stdin that is not a terminal, whether at end of input or held open and silent, `add owner/repo -a claude -y` installs `foo` and exits 0 without waiting on input (§10.2, §10.4)
- [ ] Given a plugin repository with no semver tags holding `skills/a/`, `agents/reviewer.md` and `hooks/format.sh`, `add owner/repo -a claude -y` shows no prompt, installs `a` into `.claude/skills/a/`, `reviewer.md` into `.claude/agents/` and `format.sh` into `.claude/hooks/`, and the summary printed before the install names `format.sh` (§10.6, §11.1)
- [ ] Given the single-skill repository and a project in which Claude and Cursor are detected, `add owner/repo -a codex -y` installs `foo` into `.agents/skills/foo/` alone, and the entry records Codex alone (§8.1, §10.4, §14.1)
- [ ] Given the single-skill repository, `add owner/repo --list -y` prints the listing, writes no file and no manifest entry, and exits 0 (§11.2)

**Do**:
- Declare `-y, --yes` on `add` (§9.1).
- Where the work lives: `addCommand` in `src/commands/add.ts`; the "Proceed with installation?" of task 10-1 and the summary of tasks 10-4 to 10-6, in `runAdd` and `runCollectionPipeline` there.

**Context**:
> - §10.2: "Under `-y`, nothing is asked: **Members:** every skill is picked. Internal skills are left out (§5.4), and units follow §6.3–§6.4. **Agents:** §8.3. **"Proceed with installation?":** answered yes. The clash prompts are not answered by `-y` (§10.3)."
> - §10.6: "A unit carrying hooks installs under `-y` like any other unit. The pre-install summary lists the hooks it lands (§11). The owner's look at an unattended install is the command line the calling agent asks permission to run. Vercel installs no hooks and has no hook gate."
> - §11.1, item 5: "Proceed with installation?" ends an attended `add`; "`-y` and a detected agent caller answer it (§10.2, §10.5)".
> - §10.4: `add`'s choices are answered by `-s`/`--skill`, `-a`/`--agent` and `-y`. §14.1: a printed `add` names the entry's recorded agents with `-a`, "so following the command installs for exactly those agents and adds none, at a terminal or from an agent caller (§8.4, §10.5)"; an agent caller behaves as `-y`.
> - §10: "An agent caller can make choices but cannot see a prompt. ... A line that states its choices can be reviewed there. A bare `-y` hides what the command will do."
> - Related work elsewhere:
>   - members and agents under `-y` are tasks 11-3 and 11-2, and a re-add under `-y` is task 11-4;
>   - what is in a unit's way under `-y` is tasks 11-5 to 11-7, and `--overwrite` is tasks 11-8 and 11-9;
>   - `--all` is shorthand for `--skill '*' --agent '*' -y`, and `--json` requires `-y` or `--all` (Phase 12, §9.1, §9.2).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §8.1, §9.1, §10, §10.2, §10.3, §10.4, §10.6, §11.1, §11.2, §14.1

## vercel-skills-compatibility-11-2

### Task vercel-skills-compatibility-11-2: `-y` targets the detected agents within each unit's ceiling

**Problem**: With no `-a`, the agent prompt chooses a unit's targets. It offers the agents within the unit's ceiling and pre-ticks those detected in the project (`selectAgents` in `src/agent-select.ts`; task 3-6). Under `-y` no prompt is shown, so the targets must be chosen another way. Vercel's `-y` installs to the detected agents, or to every agent it knows when none is detected, and has no ceiling (§8.3). Taken as it stands, it would install a unit for agents its author excludes (§1.4).

**Solution**: Under `-y`, with no agent named by `-a`, each unit targets the detected agents that fall within its ceiling (§8.3). When none qualifies, because no agent is detected or every detected agent falls outside the ceiling, the unit installs for every agent within its ceiling. A unit's ceiling is every ceiling it holds (§8.2):
- a bundle's includes each skill and plugin member it takes, and a plugin's those it takes from its `skills/` (§6.1, §6.2);
- a skill installed on its own carries its own `agntc.json` (§6);
- a pick from a unit installs within the unit's ceiling and its own, and the ceilings of the unit's other skills and members do not bind it (§6.5);
- a unit with no `agents` declaration anywhere may install for every agent agntc drives.

In a run of several units, each unit targets, and falls back, by its own ceiling. Agents are detected as `add` detects them today (`detectAgents` in `src/detect-agents.ts`).

**Outcome**: `-y` installs each unit for the detected agents its author allows, never for an agent its author excludes, and for every allowed agent when none of them is detected.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds a single skill declaring `foo` and no `agntc.json`, and a project in which Claude and Cursor are detected and Codex is not, `add owner/repo -y` installs `foo` into `.claude/skills/foo/` and `.cursor/skills/foo/`, writes nothing to `.agents/skills/`, and the entry records Claude and Cursor (§8.3)
- [ ] Given the same skill with an `agntc.json` listing `agents: ["claude", "codex"]`, and Claude and Cursor detected, `add owner/repo -y` installs `foo` for Claude only (§8.2, §8.3)
- [ ] Given the same skill with an `agntc.json` listing `agents: ["claude"]`, and only Cursor detected, `add owner/repo -y` installs `foo` for Claude (§8.3)
- [ ] Given the same skill with no `agntc.json` and no agent detected, `add owner/repo -y` installs `foo` for Claude, Codex and Cursor (§8.3)
- [ ] Given a repository with no semver tags whose root holds only `skills/a/` and `skills/b/`, with `skills/b/agntc.json` listing `agents: ["claude"]`, `add owner/repo --plugin -y` installs the bundle for Claude only when Claude and Cursor are detected, and for Claude only when no agent is detected (§6.2, §8.2, §8.3)
- [ ] Given the same repository and only Cursor detected, `add owner/repo -y` installs `a` for Cursor as `owner/repo/a` and `b` for Claude as `owner/repo/b`, and exits 0 (§6, §6.3, §8.3)
- [ ] Given a plugin repository with no semver tags holding `skills/x/`, `skills/y/` and `agents/reviewer.md`, whose root `agntc.json` lists `agents: ["claude", "codex"]` and whose `skills/y/agntc.json` lists `agents: ["codex"]`, and Claude, Codex and Cursor detected, `add owner/repo@x -y` installs `x` alone for Claude and Codex and not for Cursor (§6.5, §8.3)

**Do**:
- Under `-y`, target each unit as §8.3 sets out: the detected agents within its ceiling, or every agent within its ceiling when none qualifies.
- Where the work lives: the agent step of `runAdd`, and the collection-wide agent prompt and per-member ceiling filter of `runCollectionPipeline` (`src/commands/add.ts`); `selectAgents` (`src/agent-select.ts`); `detectAgents` (`src/detect-agents.ts`); the combined ceiling of task 3-6 and the pick ceiling of task 8-4.

**Context**:
> - §8.3: "`-y` targets the detected agents that fall within each unit's ceiling. When none qualifies, the unit installs for every agent within its ceiling. That covers two cases: no agent is detected, or every detected agent is outside the ceiling. This is Vercel's `-y` adapted to the ceiling. With no agent detected, Vercel installs to every agent it knows."
> - §8.2: "A unit's ceiling is every ceiling it holds (§6.1, §6.2): the agents all of them allow."
> - §6: "Agent targeting (§8) and what is in the way (§10.3) are handled per installed entry, and there a skill installed on its own counts as a unit as well. Its ceiling is the `agents` list in its own `agntc.json`, as a single skill's is today."
> - §6.5: "The picked skill installs within the unit's agent ceiling, the `agents` list in the unit's `agntc.json` (§8.2), and within its own `agntc.json` ... The ceilings of the unit's other skills and members do not".
> - An `agntc.json` with no usable `agents` list sets no ceiling, as today (`readConfig` and `KNOWN_AGENTS` in `src/config.ts`).
> - Related work elsewhere: `-a` beside `-y` targets the agents it names (task 11-1); a re-add under `-y` adds these targets to its recorded agents (task 11-4); `--all` sets `--agent '*'` (Phase 12, §9.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §6, §6.1, §6.2, §6.3, §6.5, §8.2, §8.3, §10.2

## vercel-skills-compatibility-11-3

### Task vercel-skills-compatibility-11-3: `-y` picks every skill and installs each unit whole

**Problem**: When a source offers several skills or plugin members, `add` shows the member prompt (`selectCollectionPlugins` in `src/collection-select.ts`), which an AI agent caller cannot answer (§10). Vercel's `-y` installs every skill it finds. Read as picking every skill one by one, it would split a plugin or a declared bundle that agntc installs whole (§6.4).

**Solution**: Under `-y` the member prompt is answered as "all" (§10.2). `-y` is one of the "all" forms, beside `'*'` and `--all` (§5.4):
- on a skills-only source, each skill that is not internal installs as its own entry with no member prompt (§6.3), and internal skills are left out (§5.4);
- a source that reads as a plugin, or declares `"type": "plugin"`, installs whole as one entry (§6.4);
- a menu mixing loose skills and plugin members installs each skill as its own entry and each plugin member whole (§6.4);
- `--plugin -y` installs the whole bundle, internal skills included (§5.4, §6.2);
- a source whose only skills are internal finds nothing installable and is refused (§5.1, §5.4).

A line that names its skills by `@` or `--skill` shows no member prompt, and under `-y` installs only those skills, an internal one included when named (§5.4, §7.1, §10.4).

**Outcome**: `-y` installs everything a source offers without a member prompt, never splitting a unit and never installing an internal skill nobody named.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds only `skills/a/`, `skills/tools/b/` and `skills/c/`, where `c`'s frontmatter sets `metadata.internal: true`, `add owner/repo -a claude -y` shows no member prompt, installs `a` and `b` into `.claude/skills/a/` and `.claude/skills/b/` as the entries `owner/repo/a` and `owner/repo/b`, does not install `c`, and exits 0 (§5.4, §6.3, §10.2)
- [ ] Given a plugin repository with no semver tags holding `skills/a/`, `skills/b/` and `agents/reviewer.md`, `add owner/repo -a claude -y` installs one entry, `owner/repo`, holding `a`, `b` and `reviewer.md`; given a repository whose root holds only `skills/a/` and `skills/b/` and whose `agntc.json` declares `"type": "plugin"`, `add owner/repo -a claude -y` installs one bundle entry, `owner/repo`, holding both (§6.2, §6.4)
- [ ] Given a repository with no semver tags holding `skills/a/` and the top-level plugin member `tools/` (holding `agents/helper.md` and `skills/fmt/`), `add owner/repo -a claude -y` installs `a` as `owner/repo/a` and `tools/` whole as `owner/repo/tools`, with `helper.md` in `.claude/agents/` and `fmt` in `.claude/skills/fmt/` (§4.3, §6.4)
- [ ] Given the first repository, `add owner/repo --plugin -a claude -y` installs one entry, `owner/repo`, holding `a`, `b` and `c` (§5.4, §6.2)
- [ ] Given a repository with no semver tags whose only skills, `skills/a/` and `skills/b/`, are both internal, `add owner/repo -a claude -y` exits non-zero, writes nothing, and says nothing installable was found (§5.1, §5.4)
- [ ] Given the first repository, `add owner/repo@a -a claude -y` and `add owner/repo --skill a -a claude -y` each install `a` alone, and `add owner/repo --skill c -a claude -y` installs the internal `c` (§5.4, §7.1)

**Do**:
- Answer the member prompt under `-y` as `'*'` answers it (§5.4, §10.2).
- Where the work lives: `selectCollectionPlugins` (`src/collection-select.ts`) and its call in `runCollectionPipeline` (`src/commands/add.ts`); the `'*'` selection of tasks 7-6, 8-1 and 8-2.

**Context**:
> - §10.2: "**Members:** every skill is picked. Internal skills are left out (§5.4), and units follow §6.3–§6.4."
> - §5.4: "A skill whose frontmatter sets `metadata.internal: true` is left out of "all" (`'*'`, `--all`, `-y`) and out of the menu. It still installs when named. A bundle (`--plugin` or `"type": "plugin"`, §6.2) includes it". "A source whose only skills are internal therefore finds nothing installable and is refused (§5.1)".
> - §6.3: "On a skills-only source, `-y`, `--skill '*'` and `--all` install each skill as its own entry, as Vercel does." §6.4: "In a menu that mixes skills and plugin members (§5.3), "all" installs each skill as its own entry and each plugin member whole."
> - §10.4: `add`'s choices are answered by `-s`/`--skill`, `-a`/`--agent` and `-y`.
> - Related work elsewhere: the same-path rule across the entries of an "all" run (tasks 8-12 to 8-15) applies under `-y`; agent targeting under `-y` is task 11-2.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §5.1, §5.4, §6.2, §6.3, §6.4, §7.1, §10.2, §10.4

## vercel-skills-compatibility-11-4

### Task vercel-skills-compatibility-11-4: A re-add under `-y` adds the agents `-y` targets

**Problem**: Since Phase 4 a re-add installs for its recorded agents together with the agents it names (§8.4), and since Phase 9 those can be named with `-a` (task 9-3). Under `-y` no agent is ticked at a prompt and none need be named with `-a`. Read as naming no agent, a re-add under `-y` would reinstall for the recorded agents only and ignore the agents the project now uses, though §8.4 makes how the agents are named make no difference.

**Solution**: Under `-y`, a re-add names the agents §8.3 targets, as a fresh add does: the detected agents within the unit's ceiling, or every agent within the ceiling when none qualifies (§8.4). It installs for those together with the recorded agents, and never drops a recorded agent except one the ceiling no longer allows, which is dropped and named as `update` names it (§8.4, §12.5). A re-add at another version reinstalls for the recorded and the targeted agents. In a menu run under `-y`, installed entries are re-added this way while units not yet installed install for the targeted agents (§10.2). The summary names as target agents the recorded agents the ceiling still allows together with the targeted ones (§11.1).

**Outcome**: A re-add under `-y` keeps every agent the install had and adds the agents `-y` targets.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds a single skill declaring `foo`, installed for Claude, and a project in which Claude and Cursor are detected, `add owner/repo -y` names Claude and Cursor as the target agents in its summary, keeps `.claude/skills/foo/`, installs `.cursor/skills/foo/`, and the entry records Claude and Cursor (§8.3, §8.4, §11.1)
- [ ] Given the same Claude install and a project in which no agent is detected, `add owner/repo -y` installs `foo` for Codex and Cursor beside Claude's copy, and the entry records all three (§8.3, §8.4)
- [ ] Given a repository tagged `v1.0.0` and `v2.0.0` whose root holds a single skill declaring `foo`, installed for Claude from `owner/repo#v1.0.0`, and a project in which only Cursor is detected, `add owner/repo#v2.0.0 -y` reinstalls `foo` at `v2.0.0` for Claude and Cursor, and the entry records `v2.0.0` and both agents (§8.4)
- [ ] Given `foo` installed for Claude and Codex whose `agntc.json` now lists `agents: ["claude"]`, and a project in which Claude and Codex are detected, `add owner/repo -y` reinstalls `foo` for Claude only, `.agents/skills/foo/` is gone, the entry records Claude alone, and the output names Codex as dropped (§8.4, §12.5)
- [ ] Given a repository with no semver tags whose root holds only `skills/a/` and `skills/b/`, with `a` installed for Claude as `owner/repo/a`, and a project in which only Cursor is detected, `add owner/repo -y` reinstalls `a` for Claude and Cursor, installs `b` for Cursor alone as `owner/repo/b`, and exits 0 (§8.4, §10.2)

**Do**:
- Where the work lives: the re-add handling of tasks 4-6 to 4-8 in `runAdd` and `runCollectionPipeline` (`src/commands/add.ts`), together with the `-y` targeting of task 11-2.

**Context**:
> - §8.4: "Re-adding an installed entry adds the agents the re-add names to the agents already recorded. It never drops a recorded agent. How the agents are named makes no difference: by `-a`, through the agent prompt, or through `-y`. With `-y`, the re-add names the agents §8.3 targets, as a fresh add does: the detected agents within the ceiling, or every agent within the ceiling when none qualifies."
> - §8.4: "The re-add installs within the unit's ceiling as it stands at the re-add (§8.2), as `update` does (§12.5). A recorded agent the ceiling no longer allows is dropped, and the output names it". "A version-only re-add, such as `owner/repo#v2.0.0`, reinstalls for every recorded agent."
> - §11.1, item 4: "On a re-add they are the recorded agents the ceiling still allows together with those the re-add names, and a recorded agent the ceiling no longer allows is named as dropped (§8.4)."
> - Related work elsewhere: a re-add with `-a` is task 9-3, and `-a` beside `-y` names the targets outright (task 11-1); a re-add under `-y` whose move to its declared-name folder meets untracked files stops (task 11-7).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §8.2, §8.3, §8.4, §10.2, §11.1, §12.5

## vercel-skills-compatibility-11-5

### Task vercel-skills-compatibility-11-5: Under `-y`, another install's files in a unit's way stop that unit

**Problem**: When a unit's files land on files another managed install holds, `add` asks "Remove <key> and continue" (`resolveCollisions` in `src/collision-resolve.ts`). Answered yes, that prompt deletes the other install, so `-y` does not answer it (§10.2), and an unattended run needs another outcome. Vercel never prompts on a clash: it lists the existing folders as `overwrites:` and replaces them (§10.3), removing another install that nobody agreed to remove.

**Solution**: Under `-y` without `--overwrite`, a clash with another managed install whose files are in a unit's way stops that unit (§10.3):
- no prompt is shown;
- nothing is written for the unit, and the other install's files and manifest entry stay as they were;
- the message names `--overwrite`, and the command exits non-zero, a single-unit run included;
- the run's other units install.

A stopped unit writes nothing and takes no path, so a later member's copy on a path the stopped unit would have written installs (§6). At a terminal without `-y` or `--overwrite`, "Remove <key> and continue" is shown as before, and a deliberate cancel exits 0 (§10.3, §10.4).

**Outcome**: An unattended add never removes another install; it stops the unit in the way, names how to go ahead, and exits non-zero.

**Acceptance Criteria**:
- [ ] Given `other/repo`, a single skill declaring `foo`, installed for Claude into `.claude/skills/foo/`, and a repository `owner/repo` with no semver tags whose root holds a single skill also declaring `foo`, `add owner/repo -a claude -y` shows no prompt, leaves `.claude/skills/foo/` holding `other/repo`'s files and the `other/repo` entry unchanged, writes no `owner/repo` entry, names `--overwrite`, and exits non-zero (§10.3)
- [ ] Given `other/repo` installed the same way and a repository with no semver tags whose root holds only `skills/foo/` (declaring `foo`) and `skills/bar/`, `add owner/repo -a claude -y` installs `bar` as `owner/repo/bar`, stops `foo` naming `--overwrite`, leaves `other/repo`'s files and entry as they were, and exits non-zero (§10.3)
- [ ] Given a repository with no semver tags holding the top-level plugin member `pack/` (shipping `agents/helper.md` and `agents/reviewer.md`) and the plugin member `skills/kit/` (shipping `agents/reviewer.md`), with `.claude/agents/helper.md` held by the plugin `other/repo`, `add owner/repo -a claude -y` stops `pack/` naming `--overwrite`, installs `skills/kit/` whole with its `reviewer.md` in `.claude/agents/reviewer.md`, leaves `other/repo`'s `helper.md` and entry as they were, and exits non-zero (§6, §10.3)
- [ ] Given the first setup at a terminal, `add owner/repo -a claude` shows "Remove other/repo and continue" as before, and cancelling it exits 0 with nothing written or removed (§10.3, §10.4)

**Do**:
- Under `-y` without `--overwrite`, stop the unit in place of showing "Remove <key> and continue" (§10.3).
- Where the work lives: `runConflictChecks` (`src/commands/add.ts`) and `resolveCollisions` (`src/collision-resolve.ts`); the single-unit path of `runAdd`, and the per-unit outcome and closing exit status of `runCollectionPipeline` (`src/commands/add.ts`); the same-path rule of tasks 8-12 to 8-15.

**Context**:
> - §10.3: "**This diverges from Vercel, to keep the owner's stop-and-come-back position.** Vercel never prompts on a clash. It lists the existing folders as `overwrites:` and replaces them." "**Under `-y` (or a detected agent caller, §10.5) without `--overwrite`:** a clash with another managed install, or with untracked files, stops that unit. Nothing is written for it, and what was in the way stays as it was. The message names `--overwrite`, and the command exits non-zero. Other units in the same run proceed." "**At a terminal without `-y` or `--overwrite`:** the clash prompts work as they do today."
> - §10.2: "The clash prompts are not answered by `-y` (§10.3)." §10.1: "Only the two clash prompts delete anything when answered yes."
> - §6: "An earlier entry the run skips, stops, or leaves out after a declined clash prompt writes nothing and takes no path."
> - §10.1: a unit left out by a decline at a terminal does not make the run exit non-zero (task 10-3); §10.3 makes a stop under `-y` exit non-zero.
> - Related work elsewhere: `--overwrite` is declared on `add` in task 11-8; a key another install holds is task 11-6, and untracked files task 11-7; a detected agent caller meets the same stop (task 11-13); with no terminal and no `-y`, the clash prompt refuses the whole command (task 11-12).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §6, §10.1, §10.2, §10.3, §10.4

## vercel-skills-compatibility-11-6

### Task vercel-skills-compatibility-11-6: Under `-y`, a key another install holds stops that unit

**Problem**: Since Phases 4 and 6, an add landing on a key another install holds meets "Remove <key> and continue" even when none of its files overlap. The holder is either an install from another repository that shares the key, or another entry from the same repository holding it as a different unit (§4.3; tasks 4-9 and 6-2). Under `-y` that prompt is not answered (§10.2), and the add must never replace the holder unasked (§4.3).

**Solution**: Under `-y` without `--overwrite`, a unit landing on a key another install holds stops (§4.3, §10.3). This holds:
- for a holder from another repository: a GitHub install met by `add gitlab:owner/repo -y`, a GitHub install met by its `GH_HOST` Enterprise mirror, or an install from one GitLab subgroup ending `tools/skills` met by another;
- for another entry from the same repository holding the key as a different unit, such as the top-level plugin member `foo/` met by a skill declaring `foo`.

The unit stops even when none of the holder's files overlap. The holder's files and entry stay as they were, the message names `--overwrite`, the run's other units install, and the command exits non-zero. A re-add from the same repository, whatever form names it, is not a clash, and installs (§4.3, §8.4).

**Outcome**: Under `-y`, no install takes a key another install holds; the unit stops and names `--overwrite`.

**Acceptance Criteria**:
- [ ] Given a single skill declaring `foo` installed for Claude from GitHub `owner/repo`, keyed `owner/repo`, and a GitLab repository `owner/repo` with no semver tags whose root holds a single skill declaring `bar`, `add gitlab:owner/repo -a claude -y` shows no prompt, leaves `.claude/skills/foo/` and the entry `owner/repo` as they were, writes nothing of `bar`, names `--overwrite`, and exits non-zero (§4.3, §10.3)
- [ ] Given `GH_HOST=ghe.example.com` and the same GitHub install, `add https://ghe.example.com/owner/repo -a claude -y` stops the same way; given an install from `https://gitlab.com/a/tools/skills`, keyed `tools/skills`, `add https://gitlab.com/b/tools/skills -a claude -y` stops the same way (§4.3, §10.3)
- [ ] Given a repository with no semver tags whose top-level plugin member `foo/` (holding `agents/reviewer.md`) is installed for Claude as `owner/repo/foo`, `add https://github.com/owner/repo/tree/main/skills/bar -a claude -y`, where `skills/bar/SKILL.md` declares `foo`, leaves the member's `.claude/agents/reviewer.md` and entry as they were, writes nothing to `.claude/skills/foo/`, names `--overwrite`, and exits non-zero (§4.3, §10.3)
- [ ] Given `owner/repo/a` installed for Claude from GitHub, and a GitLab repository `owner/repo` with no semver tags whose root holds only `skills/a/` and `skills/b/`, `add gitlab:owner/repo -a claude -y` installs `b` as `owner/repo/b`, stops `a` with the GitHub install as it was, names `--overwrite`, and exits non-zero (§4.3, §10.3)
- [ ] Given a single skill declaring `foo` installed for Claude from `owner/repo`, `add https://github.com/owner/repo -a cursor -y` is a re-add: no unit stops, Claude's copy stays, `.cursor/skills/foo/` is installed, the entry records Claude and Cursor, and the command exits 0 (§4.3, §8.4)

**Do**:
- Under `-y` without `--overwrite`, stop a unit landing on a held key as task 11-5 stops a unit, whether or not any of the holder's files overlap (§4.3, §10.3).
- Where the work lives: the key clashes of tasks 4-9 and 6-2 in `runConflictChecks`, `runAdd` and `runCollectionPipeline` (`src/commands/add.ts`); the repository identity of tasks 6-3 and 6-4, which tells a re-add from a clash.

**Context**:
> - §4.3: "Two different repositories can share a key: a GitHub repository and its Enterprise mirror, the same `owner/repo` on GitHub and GitLab, or two GitLab subgroups both ending `tools/skills`. An install from another repository onto a key an existing install holds is a clash with another managed install (§10.3). It is never read as a re-add of the existing install and never silently replaces it. At a terminal it meets "Remove <key> and continue"; under `-y` or from an agent caller it stops that unit unless `--overwrite` is given."
> - §4.3: "The same holds for a key another entry from the same repository holds as a different unit ... That entry is another managed install in the way (§10.3, §12.6) even when none of its files overlap. It is never read as the same install and never silently replaced."
> - §4.3: "Two sources name the same repository when host and repository path match, whatever form names them: `owner/repo`, its https URL and its SSH address are one repository. ... A re-add from the same repository is a re-add (§4.4, §8.4)".
> - Related work elsewhere: `--overwrite` removes the holder and hands its key to the new install (task 11-8); with no terminal and no `-y`, the clash refuses the whole command (task 11-12); `update`'s counterparts are tasks 4-12 and 6-7.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §8.4, §10.2, §10.3

## vercel-skills-compatibility-11-7

### Task vercel-skills-compatibility-11-7: Under `-y`, untracked files in a unit's way stop that unit

**Problem**: Untracked files in a unit's target meet "Overwrite all — replace these files", confirmed a second time (`resolveUnmanagedConflicts` in `src/unmanaged-resolve.ts`). Answered yes, that prompt overwrites them, so `-y` does not answer it (§10.2). Vercel lists such folders as `overwrites:` and replaces them (§10.3), overwriting unasked the user's own copy or one Vercel's CLI installed, which agntc does not manage (§13).

**Solution**: Under `-y` without `--overwrite`, untracked files in a unit's way stop that unit (§10.3):
- no prompt is shown;
- the files stay as they were and nothing is written for the unit;
- the message names `--overwrite`, the run's other units install, and the command exits non-zero.

A re-add that would move an install to its declared-name folder stops the same way when untracked files occupy that folder, leaving the install in its old folder under its old key (§4.4). A unit stopped by untracked files writes nothing and takes no path (§6). At a terminal without `-y` or `--overwrite`, the untracked-files prompt is shown as before (§10.3).

**Outcome**: Under `-y`, no untracked file is overwritten unless the line says `--overwrite`.

**Acceptance Criteria**:
- [ ] Given an untracked `.claude/skills/foo/` holding the user's own `SKILL.md`, and a repository with no semver tags whose root holds a single skill declaring `foo`, `add owner/repo -a claude -y` shows no prompt, leaves the user's `SKILL.md` unchanged, writes no entry, names `--overwrite`, and exits non-zero (§10.3)
- [ ] Given the same untracked folder and a repository with no semver tags whose root holds only `skills/foo/` and `skills/bar/`, `add owner/repo -a claude -y` installs `bar` as `owner/repo/bar`, stops `foo` naming `--overwrite` with the untracked folder unchanged, and exits non-zero (§10.3)
- [ ] Given a repository with no semver tags whose `skills/composition-patterns/` declares `vercel-composition-patterns`, installed for Claude under the old rules into `.claude/skills/composition-patterns/` and keyed `owner/repo/composition-patterns`, and an untracked `.claude/skills/vercel-composition-patterns/`, `add owner/repo@vercel-composition-patterns -y` leaves the install in `.claude/skills/composition-patterns/` under its old key, leaves the untracked folder unchanged, names `--overwrite`, and exits non-zero (§4.4, §10.3)
- [ ] Given a repository with no semver tags holding the top-level plugin member `pack/` (shipping `skills/x/` and `agents/reviewer.md`) and the plugin member `skills/kit/` (shipping `agents/reviewer.md`), and an untracked `.claude/skills/x/`, `add owner/repo -a claude -y` stops `pack/`, installs `skills/kit/` with its `reviewer.md` in `.claude/agents/reviewer.md`, and exits non-zero (§6, §10.3)
- [ ] Given the first setup at a terminal, `add owner/repo -a claude` shows the untracked-files prompt listing `.claude/skills/foo/`, as before (§10.3)

**Do**:
- Under `-y` without `--overwrite`, stop the unit in place of showing "Overwrite all" (§10.3).
- Where the work lives: `checkUnmanagedConflicts` (`src/unmanaged-check.ts`) and `resolveUnmanagedConflicts` (`src/unmanaged-resolve.ts`), reached through `runConflictChecks` (`src/commands/add.ts`); the stop of task 11-5; the re-add move of task 4-8.

**Context**:
> - §10.3: "**Under `-y` (or a detected agent caller, §10.5) without `--overwrite`:** a clash with another managed install, or with untracked files, stops that unit. Nothing is written for it, and what was in the way stays as it was. The message names `--overwrite`, and the command exits non-zero. Other units in the same run proceed."
> - §10.1: the untracked-files prompt is "Overwrite all", confirmed twice; only the two clash prompts delete anything when answered yes.
> - §4.4: "A re-add reaches an existing install the same way. An install of the same skill from the same repository, made under its old key or folder, is the installed entry for that re-add (§8.4). It moves to its declared-name folder and key, as an update would move it".
> - §13: "Skills installed by Vercel are files agntc does not manage. They take the untracked-files path: the prompt at a terminal, or `--overwrite` when unattended (§10.3)."
> - §6: an entry the run stops "writes nothing and takes no path".
> - Related work elsewhere: `--overwrite` overwrites untracked files (task 11-9); a target that is a symlink into Vercel's canonical copy, and the Cursor two-copies warning, are Phase 14 (§13).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.4, §6, §10.1, §10.2, §10.3, §13

## vercel-skills-compatibility-11-8

### Task vercel-skills-compatibility-11-8: `--overwrite` removes an install in a unit's way without a prompt

**Problem**: Tasks 11-5 and 11-6 stop a unit that another install blocks and name `--overwrite`, but `add` takes no such flag; today it declares only `--plugin` (§9). An unattended caller has no way to replace the install in the way, and at a terminal the only way is "Remove <key> and continue", which an agent caller cannot answer. §10.3 makes the replacement something the line states, so the owner approves it at the caller's permission prompt.

**Solution**: `add` takes `--overwrite` (§9.1). With it, "Remove <key> and continue" is not shown (§10.3). A managed install in a unit's way is removed with all its files and its manifest entry, as that prompt removes it, and the new install takes its place. This covers:
- an install whose files the unit's files land on;
- an install holding the key the unit lands on, whether from another repository or another entry from the same repository as a different unit; its key passes to the new install (§4.3).

Under `-y` this happens with no prompt at all. At a terminal without `-y`, "Proceed with installation?" is still asked (§11.1), and the install in the way is removed only once it is answered yes: answering no, or cancelling, leaves it as it was (§10.1). `--list --overwrite` lists, installs and removes nothing, and exits 0 (§11.2).

**Outcome**: A line carrying `--overwrite` replaces the install in its way, and says on the command line that it does.

**Acceptance Criteria**:
- [ ] Given `other/repo`, a single skill declaring `foo`, installed for Claude into `.claude/skills/foo/`, and a repository `owner/repo` with no semver tags whose root holds a single skill also declaring `foo`, `add owner/repo -a claude -y --overwrite` shows no prompt, removes `other/repo`'s files and entry, installs `owner/repo`'s `foo` into `.claude/skills/foo/` under the entry `owner/repo`, and exits 0 (§10.3)
- [ ] Given a single skill declaring `foo` installed for Claude from GitHub `owner/repo`, keyed `owner/repo`, and a GitLab repository `owner/repo` whose root holds a single skill declaring `bar`, `add gitlab:owner/repo -a claude -y --overwrite` removes the GitHub install's `.claude/skills/foo/` and its entry, and the GitLab install takes the key `owner/repo` (§4.3, §10.3)
- [ ] Given a repository with no semver tags whose top-level plugin member `foo/` (holding `agents/reviewer.md`) is installed for Claude as `owner/repo/foo`, `add https://github.com/owner/repo/tree/main/skills/bar -a claude -y --overwrite`, where `skills/bar/SKILL.md` declares `foo`, removes `.claude/agents/reviewer.md` and the member's entry, and the skill installs into `.claude/skills/foo/` as `owner/repo/foo` (§4.3, §10.3)
- [ ] Given the first setup at a terminal, `add owner/repo -a claude --overwrite` shows no "Remove other/repo and continue" and asks "Proceed with installation?"; answering no, or cancelling, exits 0 with `other/repo`'s files and entry unchanged, and answering yes replaces it (§10.1, §10.3, §11.1)
- [ ] Given the first setup, `add owner/repo --list --overwrite` prints the listing, writes nothing, leaves `other/repo`'s files and entry unchanged, and exits 0 (§11.2)

**Do**:
- Declare `--overwrite` on `add` (§9.1).
- Remove a managed install in the way as "Remove <key> and continue" removes it: all its files and its manifest entry (`resolveCollisions` in `src/collision-resolve.ts`) (§10.3).
- Where the work lives: `addCommand`, `runConflictChecks`, `runAdd` and `runCollectionPipeline` in `src/commands/add.ts`; the wait for "Proceed with installation?" of task 10-2; the stops of tasks 11-5 and 11-6.

**Context**:
> - §9.1: "`--overwrite` | agntc's own: replace what is in an install's way | §10".
> - §10.3: "**With `--overwrite`:** what is in the way is replaced, and no clash prompt is shown. A clashing managed install is removed, as "Remove <key> and continue" removes it. Untracked files are overwritten. The replacement is then stated in the command line the owner approves."
> - §4.3: "Removing the existing install, either way, hands the key to the new one."
> - §10.1: "What they agree to delete is removed only once "Proceed with installation?" is answered yes. Answering no there, or cancelling at any prompt, leaves every existing install and file as it was."
> - §11.2: "`-y`, `--overwrite` and `--copy` are accepted: a listing shows no prompt and writes nothing, so there is nothing for them to answer or replace".
> - Related work elsewhere: `--overwrite` on untracked files is task 11-9; with no terminal, `--overwrite` without `-y` is refused at "Proceed with installation?" (task 11-11); `update --overwrite` is task 4-13; a target that is a symlink is replaced as a link, never written through (Phase 14, §13).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §9, §9.1, §10.1, §10.3, §11.1, §11.2

## vercel-skills-compatibility-11-9

### Task vercel-skills-compatibility-11-9: `--overwrite` replaces untracked files in a unit's way without a prompt

**Problem**: Task 11-7 stops a unit whose target holds untracked files and names `--overwrite`, and task 11-8 makes the flag replace a managed install in the way. Untracked files still meet "Overwrite all" and its second confirmation (`resolveUnmanagedConflicts` in `src/unmanaged-resolve.ts`), which an agent caller cannot answer, so an unattended caller has no way past them.

**Solution**: With `--overwrite`, the untracked-files prompt and its second confirmation are not shown, and untracked files in a unit's way are overwritten (§10.3). Under `-y` this happens with no prompt. At a terminal without `-y`, "Proceed with installation?" is still asked (§11.1), and answering no leaves the files as they were (§10.1). A re-add moving an install into a declared-name folder that untracked files occupy overwrites them and completes the move (§4.4).

**Outcome**: A line carrying `--overwrite` gets past untracked files in its way with no prompt, and says on the command line that it does.

**Acceptance Criteria**:
- [ ] Given an untracked `.claude/skills/foo/SKILL.md` that is the user's own, and a repository with no semver tags whose root holds a single skill declaring `foo`, `add owner/repo -a claude -y --overwrite` shows no prompt, `.claude/skills/foo/SKILL.md` becomes `owner/repo`'s, the entry `owner/repo` is recorded, and the command exits 0 (§10.3)
- [ ] Given the same setup at a terminal, `add owner/repo -a claude --overwrite` shows neither "Overwrite all" nor its confirmation and asks "Proceed with installation?"; answering no exits 0 with the user's `SKILL.md` unchanged, and answering yes replaces it (§10.1, §10.3, §11.1)
- [ ] Given a repository with no semver tags whose `skills/composition-patterns/` declares `vercel-composition-patterns`, installed for Claude under the old rules into `.claude/skills/composition-patterns/` and keyed `owner/repo/composition-patterns`, and an untracked `.claude/skills/vercel-composition-patterns/`, `add owner/repo@vercel-composition-patterns -a claude -y --overwrite` installs the skill into `.claude/skills/vercel-composition-patterns/`, removes `.claude/skills/composition-patterns/`, re-keys the entry `owner/repo/vercel-composition-patterns`, and exits 0 (§4.4, §10.3)
- [ ] Given a repository with no semver tags whose root holds only `skills/a/` and `skills/b/`, with `.claude/skills/a/` held by `other/repo` and an untracked `.claude/skills/b/`, `add owner/repo -a claude -y --overwrite` removes `other/repo` with its files and entry, overwrites the untracked files in `.claude/skills/b/`, records `owner/repo/a` and `owner/repo/b`, and exits 0 (§10.3)

**Do**:
- Where the work lives: `checkUnmanagedConflicts` (`src/unmanaged-check.ts`), `resolveUnmanagedConflicts` (`src/unmanaged-resolve.ts`) and `runConflictChecks` (`src/commands/add.ts`); the flag declared in task 11-8; the wait for "Proceed with installation?" of task 10-2.

**Context**:
> - §10.3: "**With `--overwrite`:** what is in the way is replaced, and no clash prompt is shown. ... Untracked files are overwritten. The replacement is then stated in the command line the owner approves."
> - §10.1: "What they agree to delete is removed only once "Proceed with installation?" is answered yes."
> - §4.4: a re-add moves an existing install under its old key or folder to its declared-name folder and key, "as an update would move it".
> - §13: skills installed by Vercel's CLI take the untracked-files path: "the prompt at a terminal, or `--overwrite` when unattended (§10.3)".
> - Related work elsewhere: a target that is a symlink is replaced as a link and never written through (Phase 14, §13); `update --overwrite` is task 4-13.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.4, §10.1, §10.3, §11.1, §13

## vercel-skills-compatibility-11-10

### Task vercel-skills-compatibility-11-10: Without a terminal, a member or agent prompt refuses the add

**Problem**: With no terminal, `add` exits 0 with nothing installed and no message, which reads as success to an agent caller (§10.4). At end of input its first prompt never resolves, because agntc's prompt library (`@clack/prompts`) registers no end-of-input listener: the cancel branch never runs, and the process exits once nothing is left running. With stdin held open but silent, it hangs until killed. A refusal placed on a prompt's cancel branch would therefore never fire.

**Solution**: When the member prompt or the agent prompt cannot be shown, the add is refused (§1.5, §10.4): it exits non-zero, writes nothing and removes nothing, and its message names what answers the prompt: `-s`/`--skill`, `-a`/`--agent` and `-y`. Whether a prompt can be shown is decided from the terminal itself, before the prompt is opened, so the run never waits on input, whether stdin is at end of input or held open and silent. A line naming its skills but no agents is refused at the agent prompt the same way. A re-add that would show the agent prompt is refused with its install left as it was (§8.4). Under `-y` nothing is asked and the add installs (§10.2). At a terminal, a deliberate cancel still exits 0.

**Outcome**: Without a terminal, an `add` that needs a choice names the flags that make it, exits non-zero, changes nothing, and never hangs.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds only `skills/a/` and `skills/b/`, and stdin that is not a terminal, `add owner/repo` exits non-zero, writes nothing under `.claude/`, `.agents/` or `.cursor/` and no manifest, and its message names `-s`/`--skill`, `-a`/`--agent` and `-y` (§1.5, §10.4)
- [ ] Given the same repository, `add owner/repo` ends with that refusal both when stdin is at end of input and when stdin is held open and silent, without waiting on input (§10.4)
- [ ] Given the same repository and no terminal, `add owner/repo@a` and `add owner/repo --skill a b` are each refused at the agent prompt: they exit non-zero, write nothing, and the message names `-a`/`--agent` and `-y` (§10.4)
- [ ] Given a repository with no semver tags whose root holds a single skill declaring `foo` and no `agntc.json`, `add owner/repo` with no terminal is refused at the agent prompt the same way (§10.4)
- [ ] Given that skill installed for Claude, and Claude and Cursor detected, `add owner/repo` with no terminal is refused, and `.claude/skills/foo/` and the entry `owner/repo` are unchanged (§8.4, §10.4)
- [ ] Given the first repository, no terminal and Claude detected, `add owner/repo -y` installs `a` and `b` for Claude and exits 0 (§10.2, §10.4)
- [ ] Given the first repository at a terminal, cancelling the member prompt, or the agent prompt that follows it, exits 0 with nothing written (§10.4)

**Do**:
- Decide whether a prompt can be shown from the terminal itself, before the prompt is opened (§10.4).
- Where the work lives: `selectCollectionPlugins` (`src/collection-select.ts`) and `selectAgents` (`src/agent-select.ts`), called from `runAdd` and `runCollectionPipeline` (`src/commands/add.ts`).

**Context**:
> - §10.4: "When a prompt cannot be shown, the command is refused (§1.5). Nothing is written or removed. The message names what answers the prompt". Its table: "`add`'s choices | `-s`/`--skill`, `-a`/`--agent`, `-y`". "On `add`, every attended run ends with "Proceed with installation?" (§11.1), which only `-y` answers. ... a refusal at the member or agent prompt names `-y` among its answers as the table does."
> - §10.4: "Whether a prompt can be shown is decided from the terminal itself, so a run never waits on silent input. A deliberate cancel at a terminal still exits 0." "A refusal hung on a prompt's cancel branch would therefore never fire. Whether a prompt can be shown must be decided before the prompt is opened."
> - §10.4: "Vercel stops with "Interactive prompt required but stdin is not a TTY. Nothing was installed." and "Use --agent <name> (or --agent '*') and -y to run non-interactively.", and exits 1." Where the specification says nothing about a Vercel-syntax edge case, Vercel's behaviour is the answer (§1.4).
> - §1.5: "A refusal that exited 0 would read as success to an AI agent caller, which acts on the exit status rather than the text."
> - Related work elsewhere: the refusal at "Proceed with installation?" is task 11-11, and at a clash prompt task 11-12; a detected agent caller never meets this refusal for a choice `-y` answers (task 11-13, §10.5); `--list` needs no terminal (task 10-7); `remove`'s picker and confirmation without a terminal are Phase 13 (§10.4).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §1.5, §8.4, §10.2, §10.4

## vercel-skills-compatibility-11-11

### Task vercel-skills-compatibility-11-11: Without a terminal, "Proceed with installation?" refuses the add

**Problem**: A line that answers every choice on the command line, such as `add owner/repo@x -a claude`, still ends with "Proceed with installation?" (§11.1), which only `-y` answers. So does a single unit whose ceiling is one detected agent, which meets no agent prompt (§10.1), and a line carrying `--overwrite`, which meets no clash prompt (§10.3). Without a terminal, that confirmation would leave the run waiting on input or ending silently, as every prompt does today (§10.4).

**Solution**: When "Proceed with installation?" cannot be shown, the add is refused (§10.4): it exits non-zero, writes and removes nothing, and its message names `-y`, the one answer to a confirmation. It never waits on input. This holds for:
- a line naming its skills and its agents;
- a single unit whose ceiling is exactly one detected agent, which meets no agent prompt (§10.1);
- a line carrying `--overwrite` without `-y`, which shows no clash prompt and replaces nothing (§10.3);
- a re-add, whose install stays as it was (§8.4).

**Outcome**: Without a terminal, a line that states every choice but not `-y` is refused naming `-y`, with nothing changed.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds only `skills/x/` and `skills/y/`, and stdin that is not a terminal, whether at end of input or held open and silent, `add owner/repo@x -a claude` exits non-zero without waiting on input, writes nothing, and its message names `-y` (§10.4, §11.1)
- [ ] Given a repository with no semver tags whose root holds a single skill and an `agntc.json` listing `agents: ["claude"]`, Claude detected and no terminal, `add owner/repo` shows no agent prompt and is refused at the confirmation, its message naming `-y` (§10.1, §10.4, §11.1)
- [ ] Given `other/repo`, a single skill declaring `x`, installed for Claude into `.claude/skills/x/`, and no terminal, `add owner/repo@x -a claude --overwrite` is refused naming `-y`, and `other/repo`'s files and entry are unchanged (§10.1, §10.3, §10.4)
- [ ] Given a repository tagged `v1.0.0` and `v2.0.0` holding `skills/x/` and `skills/y/`, with `x` installed for Claude from `owner/repo#v1.0.0@x`, `add owner/repo#v2.0.0@x -a claude` with no terminal is refused naming `-y`, and `.claude/skills/x/` and the entry still hold `v1.0.0` (§8.4, §10.4)
- [ ] Given the first repository and no terminal, `add owner/repo@x -a claude -y` installs `x` and exits 0 (§10.2)

**Do**:
- Where the work lives: the "Proceed with installation?" of task 10-1 in `runAdd` and `runCollectionPipeline` (`src/commands/add.ts`); the terminal check of task 11-10.

**Context**:
> - §11.1, item 5: ""Proceed with installation?" This ends an attended `add`, even when no other prompt was shown. At a terminal, a single skill installs without a member prompt. So does a plugin whose one declared agent is detected (§10.1). ... `-y` and a detected agent caller answer it (§10.2, §10.5)."
> - §10.4's table: "A confirmation | `-y`". "On `add`, every attended run ends with "Proceed with installation?" (§11.1), which only `-y` answers."
> - §10.1: the agent prompt "is skipped when that ceiling is exactly one agent and that agent is detected"; what a clash prompt agrees to delete "is removed only once "Proceed with installation?" is answered yes".
> - §10.3: "**With `--overwrite`:** what is in the way is replaced, and no clash prompt is shown."
> - Related work elsewhere: the refusal at the member or agent prompt is task 11-10, and at a clash prompt task 11-12; a detected agent caller answers the confirmation as `-y` does (task 11-13).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §8.4, §10.1, §10.2, §10.3, §10.4, §11.1

## vercel-skills-compatibility-11-12

### Task vercel-skills-compatibility-11-12: Without a terminal, a clash prompt refuses the add, naming `--overwrite` and `-y`

**Problem**: Without a terminal, "Remove <key> and continue" and the untracked-files prompt cannot be shown. §10.4's table names `--overwrite` as what answers a clash, but every attended `add` ends with "Proceed with installation?", which only `-y` answers (§11.1). A message naming `--overwrite` alone would point at a line refused again at the confirmation.

**Solution**: When a clash prompt cannot be shown, the add is refused (§10.4). This holds for another install's files in the way, for a key another install holds with none of its files overlapping, whether from another repository or another entry from the same repository as a different unit (§4.3), and for untracked files in the way. The message names `--overwrite` and `-y` together, the line that runs. What was in the way stays as it was, nothing is written, and the command never waits on input. In a run installing several units, a clash on one unit refuses the whole command with nothing written for any unit, where under `-y` only that unit stops (§10.3). A re-add moving an install into a declared-name folder that untracked files occupy is refused the same way, its install left as it was (§4.4).

**Outcome**: Without a terminal, an add that meets something in its way is refused whole, naming the line that would run.

**Acceptance Criteria**:
- [ ] Given `other/repo`, a single skill declaring `foo`, installed for Claude into `.claude/skills/foo/`, a repository `owner/repo` with no semver tags whose root holds a single skill also declaring `foo`, and stdin that is not a terminal, `add owner/repo -a claude` exits non-zero without waiting on input, leaves `other/repo`'s files and entry unchanged, writes nothing of `owner/repo`, and its message names `--overwrite` and `-y` together (§10.4)
- [ ] Given a repository with no semver tags whose top-level plugin member `foo/` is installed for Claude as `owner/repo/foo`, and no terminal, `add https://github.com/owner/repo/tree/main/skills/bar -a claude`, where `skills/bar/SKILL.md` declares `foo`, is refused the same way with the member's files and entry unchanged; so is `add gitlab:owner/repo -a claude`, a GitLab single skill declaring `bar`, over a GitHub single skill declaring `foo` keyed `owner/repo` (§4.3, §10.4)
- [ ] Given an untracked `.claude/skills/foo/` holding the user's own `SKILL.md`, and no terminal, `add owner/repo -a claude` is refused naming `--overwrite` and `-y`, and the user's `SKILL.md` is unchanged (§10.4)
- [ ] Given a repository with no semver tags whose root holds only `skills/a/` and `skills/b/`, an untracked `.claude/skills/a/`, and no terminal, `add owner/repo --skill a b -a claude` exits non-zero with nothing written for `b` either, no file and no manifest entry; `add owner/repo --skill a b -a claude -y` instead installs `b`, stops `a` and exits non-zero (§10.3, §10.4)
- [ ] Given a repository with no semver tags whose `skills/composition-patterns/` declares `vercel-composition-patterns`, installed for Claude under the old rules into `.claude/skills/composition-patterns/` and keyed `owner/repo/composition-patterns`, an untracked `.claude/skills/vercel-composition-patterns/`, and no terminal, `add owner/repo@vercel-composition-patterns -a claude` is refused naming `--overwrite` and `-y`, leaving the install in its old folder under its old key and the untracked folder unchanged (§4.4, §10.4)

**Do**:
- Where the work lives: `resolveCollisions` (`src/collision-resolve.ts`) and `resolveUnmanagedConflicts` (`src/unmanaged-resolve.ts`), reached through `runConflictChecks`, `runAdd` and `runCollectionPipeline` (`src/commands/add.ts`); the key clashes of tasks 4-9 and 6-2; the terminal check of task 11-10.

**Context**:
> - §10.4: "When a prompt cannot be shown, the command is refused (§1.5). Nothing is written or removed." Its table: "A clash | `--overwrite`". "On `add`, every attended run ends with "Proceed with installation?" (§11.1), which only `-y` answers. A refusal at a clash prompt therefore names `--overwrite` and `-y` together, the line that runs".
> - §10.3: under `-y` without `--overwrite`, a clash "stops that unit. ... Other units in the same run proceed."
> - §4.3: a key held by another repository's install, or by another entry from the same repository as a different unit, is another managed install in the way "even when none of its files overlap".
> - §1.5: a refusal's message "names what was refused, and the way through where one exists".
> - Related work elsewhere: the stops under `-y` are tasks 11-5 to 11-7; a detected agent caller meets §10.3's stop rather than this refusal (task 11-13).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §4.3, §4.4, §10.1, §10.3, §10.4, §11.1

## vercel-skills-compatibility-11-13

### Task vercel-skills-compatibility-11-13: An `add` run from a detected AI agent behaves as `-y`

**Problem**: An AI agent running `npx agntc add` in the middle of a task can make choices but cannot see a prompt (§10). Without `-y` on its line it meets the no-terminal refusals of tasks 11-10 to 11-12, or, where it runs under a terminal, prompts nobody sees. Vercel detects such a caller and installs non-interactively (§10.5).

**Solution**: When agntc runs inside an AI agent, `add` behaves as if `-y` were given (§10.5). The agent caller is detected as Vercel detects it: with `@vercel/detect-agent`, plus Vercel's refinement for Cursor (task 11-14). On detecting one, `add` prints "Agent detected — installing non-interactively" in place of its banner. Then:
- members, agents and "Proceed with installation?" are answered as under `-y` (§10.2), so with or without a terminal it installs rather than being refused for a choice `-y` answers (§10.4);
- anything in a unit's way still stops that unit unless `--overwrite` is given, and the message names `--overwrite` (§10.3);
- a re-add adds the agents `-y` targets and keeps the recorded ones (§8.4);
- `--list` lists, installs nothing and exits 0 (§11.2).

`update` is unchanged: Vercel's `update` does not detect agent callers (§10.5).

**Outcome**: An AI agent running `add` gets the unattended install `-y` gives, and is told so in place of the banner.

**Acceptance Criteria**:
- [ ] Given an environment that `@vercel/detect-agent` identifies as an AI agent, such as Claude Code's, stdin that is not a terminal, Claude detected in the project, and a repository with no semver tags whose root holds only `skills/a/` and `skills/b/`, `add owner/repo` prints "Agent detected — installing non-interactively" in place of the banner, shows no prompt, installs `a` and `b` for Claude as `owner/repo/a` and `owner/repo/b`, and exits 0 (§10.2, §10.5)
- [ ] Given the same environment at a terminal, `add owner/repo` installs the same way, with no member prompt, agent prompt or "Proceed with installation?" (§10.2, §10.5)
- [ ] Given the same environment and `.claude/skills/a/` held by `other/repo`, `add owner/repo` installs `b`, stops `a` naming `--overwrite` with `other/repo`'s files and entry unchanged, and exits non-zero; `add owner/repo --overwrite` instead removes `other/repo` with its files and entry and installs both (§10.3, §10.5)
- [ ] Given the same environment, `a` installed for Claude, and Claude and Cursor detected, `add owner/repo@a` keeps Claude's copy, installs `.cursor/skills/a/`, and the entry records Claude and Cursor (§8.4, §10.5)
- [ ] Given the same environment, `add owner/repo --list` prints the listing, writes nothing, and exits 0 (§11.2)
- [ ] Given the same environment and an entry installed for Claude, with Cursor also detected, `update` prints the banner as it does without an agent caller and updates the entry for Claude alone (§10.5, §12.5)
- [ ] Given an environment in which `@vercel/detect-agent` identifies no AI agent, `add owner/repo` at a terminal prints the banner and shows the member prompt, as before (§10.5)

**Do**:
- Detect the agent caller with `@vercel/detect-agent` (§10.5), a new dependency in `package.json`.
- Where the work lives: the banner printed before parsing in `src/cli.ts` (`renderBanner`, `src/banner.ts`); `runAdd` and `runCollectionPipeline` (`src/commands/add.ts`), where the `-y` of tasks 11-1 to 11-9 applies.

**Context**:
> - §10.5: "When agntc runs inside an AI agent, `add` and `remove` behave as if `-y` were given. The agent caller is detected as Vercel detects it: with `@vercel/detect-agent`, plus Vercel's refinement for Cursor." "When it detects an agent caller, `add` says so in place of its banner, as Vercel does: "Agent detected — installing non-interactively"." "**`add`:** agntc's `-y` (§10.2). Anything in the way still stops the unit unless `--overwrite` is given (§10.3)." "**`update`:** unchanged. Vercel's `update` does not detect agent callers." "A detected agent caller therefore never meets §10.4's refusal for a choice that `-y` answers."
> - §10: "Two kinds of caller run agntc unattended. One is the owner at a terminal. The other is an AI agent running `npx agntc add` in the middle of a task."
> - Today the banner is printed for every command except a bare version query, before commander parses the line (`src/cli.ts`).
> - §12.5: `update` replays the agents recorded at install.
> - Related work elsewhere: Cursor's refinement is task 11-14; `remove` from a detected agent caller asks no confirmation (Phase 13, §10.5).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §8.4, §10, §10.2, §10.3, §10.4, §10.5, §11.2, §12.5

## vercel-skills-compatibility-11-14

### Task vercel-skills-compatibility-11-14: Cursor counts as an agent caller only when its agent runs agntc

**Problem**: `CURSOR_TRACE_ID` is set in Cursor's integrated terminal for ordinary users, not only when Cursor's agent runs a command (§10.5). Read as an agent caller, a person typing `add` in Cursor's terminal would get an unattended install: no member prompt, no agent prompt and no "Proceed with installation?", and no chance to back out (§10.1, §11.1). Vercel refines Cursor's detection for this reason (Vercel's `src/detect-agent.ts`).

**Solution**: Cursor counts as an agent caller only when `CURSOR_AGENT` is set or `CURSOR_EXTENSION_HOST_ROLE` is `agent-exec` (§10.5). With only `CURSOR_TRACE_ID` set, the run is attended: the banner shows and the prompts are asked, and with no terminal the add is refused as an attended one is (§10.4). With `CURSOR_AGENT` set, or `CURSOR_EXTENSION_HOST_ROLE` set to `agent-exec`, `add` behaves as an agent caller (task 11-13); any other value of `CURSOR_EXTENSION_HOST_ROLE` does not make it one.

**Outcome**: A person running `add` in Cursor's terminal gets the attended run; only Cursor's agent gets the unattended one.

**Acceptance Criteria**:
- [ ] Given `CURSOR_TRACE_ID` set and no other agent signal, a terminal, and a repository with no semver tags whose root holds only `skills/a/` and `skills/b/`, `add owner/repo` prints the banner, not "Agent detected — installing non-interactively", and shows the member prompt (§10.5)
- [ ] Given only `CURSOR_TRACE_ID` set and stdin that is not a terminal, `add owner/repo` exits non-zero, writes nothing, and names `-s`/`--skill`, `-a`/`--agent` and `-y`, as an attended run without a terminal does (§10.4, §10.5)
- [ ] Given `CURSOR_TRACE_ID` and `CURSOR_AGENT` set, `add owner/repo` prints "Agent detected — installing non-interactively" and installs `a` and `b` with no prompt (§10.5)
- [ ] Given `CURSOR_TRACE_ID` set and `CURSOR_EXTENSION_HOST_ROLE=agent-exec`, `add owner/repo` behaves as an agent caller the same way; given `CURSOR_TRACE_ID` set and `CURSOR_EXTENSION_HOST_ROLE` set to any other value, such as `user`, it behaves as an attended run (§10.5)

**Do**:
- Apply Vercel's refinement for Cursor to what `@vercel/detect-agent` reports (§10.5; Vercel's `src/detect-agent.ts`).
- Where the work lives: the agent-caller detection of task 11-13.

**Context**:
> - §10.5: "The agent caller is detected as Vercel detects it: with `@vercel/detect-agent`, plus Vercel's refinement for Cursor. Cursor counts as an agent caller only when `CURSOR_AGENT` is set or `CURSOR_EXTENSION_HOST_ROLE` is `agent-exec`. The reason is that `CURSOR_TRACE_ID` is also present in Cursor's integrated terminal for ordinary users (Vercel's `src/detect-agent.ts`)."
> - §10.4: with no terminal, an attended `add` is refused naming what answers its prompt (task 11-10).
> - Related work elsewhere: what a detected agent caller does on `add` is task 11-13.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §10.1, §10.4, §10.5, §11.1
