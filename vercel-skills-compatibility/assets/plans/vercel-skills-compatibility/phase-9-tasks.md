# Phase 9: Naming target agents with `-a` — 7 tasks

## vercel-skills-compatibility-9-1

### Task vercel-skills-compatibility-9-1: `-a` names the target agents in Vercel's or agntc's spelling

**Problem**: `add` takes one flag today, `--plugin` (§9). A pasted Vercel line that names its target agents, such as `npx agntc add owner/repo -a claude-code`, stops with `error: unknown option '-a'` and exits 1 (today's build). Agents can be chosen only at the agent prompt, which an AI agent caller cannot see, so no line can state its targets for the human to review at the caller's permission prompt (§10).

**Solution**: `add` takes `-a`/`--agent <agents…>`, variadic and repeatable as in Vercel (§8.1, §9.1). It accepts Vercel's identifiers `claude-code`, `codex` and `cursor`, and agntc's own `claude`: `claude-code` and `claude` both name Claude, where Vercel rejects `claude`. `'*'` names every agent agntc drives: Claude, Codex and Cursor. The named agents answer the agent prompt, so none is shown, on a single unit or on a menu run, where the member prompt is still shown (§10.1, §10.4). A unit installs for the named agents whether or not they are detected in the project (§8.2).

**Outcome**: A line naming its agents with `-a`, in either tool's spelling, installs for exactly those agents with no agent prompt.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds a single skill declaring `foo`, when `add owner/repo -a claude-code cursor` runs at a terminal, no agent prompt is shown, `foo` installs into `.claude/skills/foo/` and `.cursor/skills/foo/`, nothing is written to `.agents/skills/`, and the entry `owner/repo` records Claude and Cursor (§1.6, §8.1)
- [ ] Given the same repository, `add owner/repo -a claude` installs and records exactly what `add owner/repo -a claude-code` does (§8.1)
- [ ] Given the same repository, `add owner/repo -a codex -a cursor` and `add owner/repo --agent codex cursor` each install `foo` for Codex and Cursor and not for Claude (§8.1, §9.1)
- [ ] Given the same repository, `add owner/repo -a '*'` installs `foo` for Claude, Codex and Cursor with no agent prompt (§8.1)
- [ ] Given a project in which no agent is detected, `add owner/repo -a cursor` installs `foo` into `.cursor/skills/foo/` with no agent prompt (§8.2)
- [ ] Given a repository whose root holds only `skills/a/` and `skills/b/`, when `add owner/repo -a codex` runs at a terminal and both are picked at the member prompt, no agent prompt follows, and `a` and `b` install into `.agents/skills/` alone as `owner/repo/a` and `owner/repo/b`, each recording Codex (§10.1, §10.4)
- [ ] Given a plugin repository holding `skills/a/` and `agents/reviewer.md`, `add owner/repo -a claude-code` installs `a` into `.claude/skills/a/` and `reviewer.md` into `.claude/agents/` with no agent prompt (§8.1)

**Do**:
- Declare `-a, --agent <agents…>` on `add`, variadic and repeatable (§8.1, §9.1).
- Where the work lives: `addCommand` in `src/commands/add.ts`, which declares only `--plugin` today; the agent step of `runAdd` and the collection-wide agent prompt of `runCollectionPipeline` there, both of which call `selectAgents` (`src/agent-select.ts`); `KNOWN_AGENTS` in `src/config.ts`, the agents agntc drives.

**Context**:
> - §8.1: "`-a`/`--agent <agents…>` accepts Vercel's identifiers and agntc's own. Vercel's are `claude-code`, `codex` and `cursor`; agntc's own is `claude`. Vercel rejects `--agent claude`; agntc accepts both spellings. The flag is variadic and repeatable, as in Vercel." "`'*'` means every agent agntc drives."
> - §8.2: "A unit installs for the named agents that fall within its author's ceiling (the `agntc.json` `agents` list)." Detection decides targets only under `-y` (§8.3).
> - §10.4: `add`'s choices are answered by `-s`/`--skill`, `-a`/`--agent` and `-y`. §10: an agent caller "can make choices but cannot see a prompt. The human's last look is the agent's permission prompt, which shows the command line. A line that states its choices can be reviewed there."
> - §1.6: Claude installs into `.claude/skills/`, Codex into `.agents/skills/`, Cursor into `.cursor/skills/`.
> - Related work elsewhere: the ceiling narrowing the named agents is task 9-2; a re-add with `-a` is task 9-3; an agent agntc doesn't drive is refused (task 9-4); `-y` targets detected agents (Phase 11, §8.3); `--all` sets `--agent '*'` and is refused beside `-a` (Phase 12, §9.1); `remove -a` takes the same names (Phase 13, §12.3).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.6, §8.1, §8.2, §8.3, §9, §9.1, §10, §10.1, §10.4

## vercel-skills-compatibility-9-2

### Task vercel-skills-compatibility-9-2: A unit installs for the named agents its ceiling allows and names the rest

**Problem**: Until `-a`, agents were chosen only at the agent prompt, which offers only the agents a unit's ceiling allows (`selectAgents` in `src/agent-select.ts`; task 3-6), so an installer could never choose an agent the author excluded. `-a` names agents with no prompt (task 9-1). Applied as named, it would install a unit for an agent its author's `agntc.json` excludes, defeating the ceiling agntc keeps (§1.4). Vercel has no ceiling to follow (§8.2).

**Solution**: A unit installs for the named agents that fall within its ceiling, and the output names the named agents it left out (§8.2). A unit's ceiling is every ceiling it holds, the agents all of them allow: a bundle's is the source's own `agntc.json` and that of each skill and plugin member it takes, and a plugin's or plugin member's includes those of the skills and members it takes from its `skills/` (§6.1, §6.2). A skill installed on its own counts as a unit, its ceiling the `agents` list in its own `agntc.json` (§6). `-a '*'` names all three agents, so on a restricted unit it installs for those the ceiling allows and names the others. A unit installed for fewer agents than named is installed, not skipped, so it alone does not make the run exit non-zero (§9.2). Where the ceiling excludes every named agent, the single-unit refusal (task 9-5) and the multi-unit skip (task 9-6) apply instead.

**Outcome**: `-a` never installs a unit for an agent its author excluded, and the output says which named agents were left out.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds a single skill declaring `foo` and an `agntc.json` listing `agents: ["claude"]`, when `add owner/repo -a claude cursor` runs, `foo` installs into `.claude/skills/foo/` only, nothing is written to `.cursor/skills/`, the entry records Claude alone, the output names Cursor as left out, and the command exits 0 (§8.2, §9.2)
- [ ] Given the same repository, `add owner/repo -a '*'` installs `foo` for Claude only and the output names Codex and Cursor as left out (§8.1, §8.2)
- [ ] Given a repository whose root holds only `skills/a/` and `skills/b/`, with `skills/b/agntc.json` listing `agents: ["claude"]`, `add owner/repo --plugin -a claude cursor` installs the bundle for Claude only, with nothing of it in `.cursor/skills/`, and the output names Cursor as left out; a bundled plugin member whose own `agntc.json` restricts to Claude narrows the bundle the same way (§6.2, §8.2)
- [ ] Given a bundled source whose root `agntc.json` lists `agents: ["claude", "codex"]` and whose member `review/` has its own `agntc.json` listing `agents: ["codex", "cursor"]`, `add owner/repo --plugin -a '*'` installs the bundle for Codex alone and the output names Claude and Cursor as left out (§6.2, §8.2)
- [ ] Given a plugin repository (`skills/` beside `agents/`) whose `skills/x/agntc.json` lists `agents: ["claude"]`, or whose `skills/` holds a plugin member restricted to Claude, `add owner/repo -a claude cursor` installs the plugin for Claude only, with nothing of it in `.cursor/skills/`, and the output names Cursor as left out (§6.1, §8.2)
- [ ] Given a repository whose root holds only `skills/x/` and `skills/y/`, with `skills/x/agntc.json` listing `agents: ["claude"]`, `add owner/repo@x -a claude cursor` installs `x` into `.claude/skills/x/` only and the output names Cursor as left out (§6, §8.2)

**Do**:
- Where the work lives: the agent step of `runAdd` (`src/commands/add.ts`), which passes the root `agntc.json`'s agents to `selectAgents` today; the combined ceiling of task 3-6; the per-member ceiling filter of `runCollectionPipeline` (`src/commands/add.ts`); `readConfig` (`src/config.ts`).

**Context**:
> - §8.2: "A unit installs for the named agents that fall within its author's ceiling (the `agntc.json` `agents` list). The output names the agents it left out. Vercel has no ceiling." "A unit's ceiling is every ceiling it holds (§6.1, §6.2): the agents all of them allow."
> - §6: "Agent targeting (§8) and what is in the way (§10.3) are handled per installed entry, and there a skill installed on its own counts as a unit as well. Its ceiling is the `agents` list in its own `agntc.json`, as a single skill's is today."
> - §6.2: "The bundle installs within every agent ceiling it holds: the source's own `agntc.json`, and that of each skill and each plugin member it takes." §6.1: a plugin "installs within the ceilings of the skills and members it takes from its `skills/`, as a bundle does (§6.2)".
> - §9.2: "The command exits non-zero when any entry failed or was skipped. A skipped entry is, for example, a unit outside every named agent's ceiling (§8.2)."
> - An `agntc.json` with no usable `agents` list sets no ceiling, as today (`readConfig`, `src/config.ts`).
> - Related work elsewhere: a ceiling that excludes every named agent is tasks 9-5 (one unit) and 9-6 (several units); a pick's ceiling is task 9-7; a recorded agent the ceiling no longer allows on a re-add is task 9-3.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §6, §6.1, §6.2, §8.1, §8.2, §9.2

## vercel-skills-compatibility-9-3

### Task vercel-skills-compatibility-9-3: A re-add with `-a` adds the named agents and keeps the recorded ones

**Problem**: Before Phase 4, a re-add deleted the entry's files and reinstalled for the chosen agents only (`nukeManifestFiles` on the existing entry, `src/commands/add.ts`), so `add … -a cursor` on a Claude install would silently delete Claude's copy, where Vercel's `add -a cursor` adds Cursor and leaves Claude alone (§8.4). Task 4-6 makes a re-add keep every recorded agent and add those chosen at the agent prompt. `-a` names agents with no prompt (task 9-1); read as the re-add's whole target set, it would drop every recorded agent it leaves unnamed.

**Solution**: A re-add adds the agents `-a` names to the agents already recorded, as a re-add through the agent prompt does (task 4-6): how the agents are named makes no difference (§8.4). It never drops a recorded agent, except one the unit's ceiling as it stands no longer allows, which is dropped and named, as `update` names it (§8.4, §12.5; task 4-7). A re-add naming an agent the ceiling allows installs for it even when every recorded agent is dropped. Naming an agent already recorded reinstalls for every recorded agent. A re-add at another version with `-a` reinstalls at that version for the recorded agents and the named ones. Entries a menu run re-adds are handled the same way, while a unit the same run installs for the first time installs for the named agents alone. Taking an agent away is `remove -a` (§12.3).

**Outcome**: `-a` on a re-add only ever adds agents, short of an agent the author's ceiling now excludes, which it names.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds a single skill declaring `foo`, installed for Claude, when `add owner/repo -a cursor` runs, `.claude/skills/foo/` stays, `.cursor/skills/foo/` is installed, and the entry `owner/repo` records Claude and Cursor (§8.4)
- [ ] Given `foo` installed for Claude and Codex, `add owner/repo -a claude` reinstalls it for Claude and Codex, and the entry still records both (§8.4)
- [ ] Given a repository tagged `v1.0.0` and `v2.0.0` whose root holds the single skill `foo`, installed for Claude at `v1.0.0`, when `add owner/repo#v2.0.0 -a cursor` runs, `foo` reinstalls at `v2.0.0` into `.claude/skills/foo/` and `.cursor/skills/foo/`, and the entry records Claude and Cursor at `v2.0.0` (§2.4, §8.4)
- [ ] Given `foo` installed for Claude and Codex whose `agntc.json` upstream now lists `agents: ["claude", "cursor"]`, `add owner/repo -a cursor` installs for Claude and Cursor, `.agents/skills/foo/` is gone, the entry records Claude and Cursor, and the output names Codex as dropped (§8.4, §12.5)
- [ ] Given `foo` installed for Codex alone whose `agntc.json` upstream now lists `agents: ["claude"]`, `add owner/repo -a claude` installs for Claude, `.agents/skills/foo/` is gone, the entry records Claude alone, and the output names Codex as dropped (§8.4)
- [ ] Given a repository whose root holds only `skills/a/` and `skills/b/`, with `a` installed for Claude, when `add owner/repo -a codex` runs and `a` and `b` are picked at the member prompt, `a` reinstalls for Claude and Codex and its entry records both, while `b` installs for Codex alone (§8.4)

**Do**:
- Install for the recorded agents together with the agents `-a` names, as task 4-6 does for the agents chosen at the prompt, and narrow to the ceiling and name dropped agents as task 4-7 does (§8.4).
- Where the work lives: the re-add handling of tasks 4-6 and 4-7 in `runAdd` and `runCollectionPipeline` (`src/commands/add.ts`).

**Context**:
> - §8.4: "Re-adding an installed entry adds the agents the re-add names to the agents already recorded. It never drops a recorded agent. How the agents are named makes no difference: by `-a`, through the agent prompt, or through `-y`."
> - §8.4: "The re-add installs within the unit's ceiling as it stands at the re-add (§8.2), as `update` does (§12.5). A recorded agent the ceiling no longer allows is dropped, and the output names it, as `update` names an agent a unit no longer declares support for." The corrigendum grounding this cites `resolveAgents` in `src/nuke-reinstall-pipeline.ts` and `formatAgentsDroppedWarning` in `src/clone-reinstall.ts` as `update`'s narrowing and naming.
> - §8.4: "A version-only re-add, such as `owner/repo#v2.0.0`, reinstalls for every recorded agent. To take an agent away, use `remove -a` (§12)."
> - §8.4: "Today a re-add deletes the entry's files and reinstalls for the chosen agents only. Both the single-unit and the multi-unit paths call `nukeManifestFiles` on the existing entry (`src/commands/add.ts`). So `add … -a cursor` on a Claude install silently deletes Claude's copy. Vercel's `add -a cursor` adds Cursor and leaves Claude alone."
> - Related work elsewhere: a re-add whose named agents all fall outside the ceiling is refused (task 9-5), or skipped in a run of several units (task 9-6); an agent agntc doesn't drive refuses the re-add (task 9-4); a re-add under `-y` names the agents §8.3 targets (Phase 11).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §2.4, §8.2, §8.4, §12.3, §12.5

## vercel-skills-compatibility-9-4

### Task vercel-skills-compatibility-9-4: Naming an agent agntc doesn't drive is refused

**Problem**: `-a` takes names from the line (task 9-1). agntc drives three agents where Vercel drives 79 (§8), so a pasted Vercel line can name one agntc cannot install for, such as `windsurf`. Dropping that name and installing for the rest would silently ignore part of the line (§1.5).

**Solution**: A name `-a` carries that is none of `claude-code`, `claude`, `codex`, `cursor` or `'*'` refuses the command (§1.5, §8.1). The refusal is pre-flight: it exits non-zero, writes nothing and removes nothing, and its message names the unknown agent and lists the three agents agntc drives, Claude, Codex and Cursor. An unknown name beside known ones refuses the whole line, whether given in one `-a` or a repeated one: nothing installs for the known ones. On a re-add the existing install is left as it was. Vercel refuses a name it doesn't know the same way ("Invalid agents", exit 1).

**Outcome**: A line naming an agent agntc can't install for installs nothing and says which agents agntc drives.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds a single skill declaring `foo`, when `add owner/repo -a windsurf` runs, the command exits non-zero, writes no file and no manifest entry, and its message names `windsurf` and lists Claude, Codex and Cursor as the agents agntc drives (§1.5, §8.1)
- [ ] Given the same repository, `add owner/repo -a claude windsurf` and `add owner/repo -a claude -a windsurf` each exit non-zero with the same message, and nothing is written to `.claude/skills/` (§1.5, §8.1)
- [ ] Given a repository whose root holds only `skills/a/` and `skills/b/`, `add owner/repo --skill a b -a codex windsurf` exits non-zero and writes no file and no manifest entry for either skill (§1.5, §8.1)
- [ ] Given `foo` installed for Claude, `add owner/repo -a cursor windsurf` exits non-zero, `.claude/skills/foo/` and the entry `owner/repo` are unchanged, and nothing is written to `.cursor/skills/` (§1.5)

**Do**:
- Where the work lives: the reading of `-a` that task 9-1 adds to `add` (`src/commands/add.ts`).

**Context**:
> - §8.1: "Naming an agent agntc doesn't drive is refused (§1.5). The message lists the three agents it does drive. Vercel refuses a name it doesn't know the same way ("Invalid agents", exit 1)."
> - §1.5: a refusal exits non-zero, "writes nothing (no installed files, no manifest entry) and removes nothing", and "its message names what was refused". "No part of a line (a flag, a source form, a name) is silently dropped."
> - §8: "agntc drives three agents: Claude, Codex and Cursor. Vercel drives 79."
> - Related work elsewhere: `remove -a` refuses an agent agntc doesn't drive the same way (Phase 13, §12.3).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §8, §8.1

## vercel-skills-compatibility-9-5

### Task vercel-skills-compatibility-9-5: A single-unit run whose ceiling excludes every named agent is refused

**Problem**: Task 9-2 installs a unit for the named agents its ceiling allows. When the ceiling allows none of them, there is nothing to install for. Ending with nothing installed and exit 0 would read as success to an AI agent caller, which acts on the exit status rather than the text (§1.5).

**Solution**: A run installing one unit is refused when the unit's ceiling excludes every agent `-a` names (§8.2). The refusal is pre-flight: non-zero exit, no file and no manifest entry written, nothing removed, and the message names what was refused and the agents the ceiling allows, the way through (§1.5). The ceiling is every ceiling the unit holds, so a bundle holding a Claude-only member or skill, a plugin whose `skills/` holds one, and ceilings that together allow only agents the line does not name are refused the same way (§6.1, §6.2). So is a skill installed on its own whose own `agntc.json` excludes every named agent (§6). A re-add whose named agents all fall outside the ceiling is refused with its install left as it was (§8.2, §8.4).

**Outcome**: `-a` naming only agents a unit excludes installs nothing, exits non-zero, and names the agents that unit allows.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds a single skill declaring `foo` and an `agntc.json` listing `agents: ["claude"]`, when `add owner/repo -a cursor` runs, the command exits non-zero, writes no file and no manifest entry, and its message names the refusal and Claude as the agent the skill allows (§1.5, §8.2)
- [ ] Given a repository whose root holds only `skills/a/` and `skills/b/`, with `skills/b/agntc.json` listing `agents: ["claude"]`, `add owner/repo --plugin -a cursor` is refused the same way; so is a bundle whose plugin member restricts to Claude, and `add owner/repo -a codex cursor` on a plugin repository whose `skills/` holds a skill or member restricted to Claude (§6.1, §6.2, §8.2)
- [ ] Given a bundled source whose root `agntc.json` lists `agents: ["claude", "codex"]` and whose member `review/` has its own `agntc.json` listing `agents: ["codex", "cursor"]`, `add owner/repo --plugin -a claude cursor` exits non-zero, writes nothing, and its message names Codex as the agent the bundle allows (§6.2, §8.2)
- [ ] Given a repository whose root holds only `skills/x/` and `skills/y/`, with `skills/x/agntc.json` listing `agents: ["claude"]`, `add owner/repo@x -a cursor` exits non-zero and writes no file and no manifest entry (§6, §8.2)
- [ ] Given `foo` from the first repository installed for Claude, `add owner/repo -a cursor` exits non-zero, `.claude/skills/foo/` and the entry `owner/repo` are unchanged, and nothing is written to `.cursor/skills/` (§8.2, §8.4)

**Do**:
- Where the work lives: the agent step of `runAdd` (`src/commands/add.ts`), beside the refusal task 3-6 adds there for ceilings that together allow no agent.

**Context**:
> - §8.2: "A single-unit run where the ceiling excludes every named agent is refused (§1.5)."
> - §1.5: a refusal exits non-zero, writes nothing and removes nothing; "its message names what was refused, and the way through where one exists". "A refusal that exited 0 would read as success to an AI agent caller, which acts on the exit status rather than the text."
> - §6: "there a skill installed on its own counts as a unit as well. Its ceiling is the `agents` list in its own `agntc.json`".
> - §8.4: "Re-adding an installed entry adds the agents the re-add names to the agents already recorded." A re-add naming no agent is refused when the ceiling allows none of the recorded agents (task 4-7).
> - Task 3-6 refuses a unit whose ceilings together allow no agent at all; there is then no allowed agent to name.
> - Related work elsewhere: a run installing several units skips such a unit instead (task 9-6); a pick from a unit is judged against the pick's own ceilings (task 9-7); under `--json` a refusal emits one `failed` entry (Phase 12, §9.2).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §6, §6.1, §6.2, §8.2, §8.4

## vercel-skills-compatibility-9-6

### Task vercel-skills-compatibility-9-6: A run installing several units skips a unit whose ceiling excludes every named agent

**Problem**: A run installing several entries meets each entry's ceiling on its own (§6). Today the multi-unit path skips a member whose ceiling excludes every chosen agent ("skipped — author restricts to …, none selected", `runCollectionPipeline` in `src/commands/add.ts`) and exits 0; only a failed member exits non-zero (§8.2). An AI agent caller reading that exit status takes a run that left out a unit it asked for as a success.

**Solution**: In a run installing several units, a unit whose ceiling excludes every named agent is skipped with a message naming it; the run's other units install; and the command exits non-zero so a calling agent sees the partial result, the partial-success reporting `update` uses (§8.2). Each unit that installs for fewer than the named agents names the agents it left out (task 9-2). Agents chosen at the agent prompt are handled the same way as agents named by `-a`. This holds for picks from the menu, several `@`/`--skill` names and `'*'` alike, and a skill installed on its own is skipped by its own `agntc.json` while the run's other entries proceed (§6). A re-added entry whose ceiling excludes every named agent is skipped with its install left as it was, while the others proceed (§8.2, §8.4). So is a re-added entry in such a run that names no agent, nothing being ticked at the agent prompt, when its ceiling allows none of its recorded agents: where a single-unit re-add of that kind is refused (task 4-7), here it is skipped and the run exits non-zero (§8.4).

**Outcome**: A run that skips a unit for its ceiling still installs the rest and exits non-zero.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose root holds only `skills/a/`, `skills/b/` and `skills/c/`, with `skills/b/agntc.json` listing `agents: ["claude"]`, when `add owner/repo --skill a b c -a cursor` runs, the outcome is (§8.2):
  - `a` and `c` install into `.cursor/skills/` as `owner/repo/a` and `owner/repo/c`;
  - `b` is not installed, no `owner/repo/b` entry is written, and the output names `b` as skipped for its restriction to Claude;
  - the command exits non-zero (today 0).
- [ ] Given the same repository, `add owner/repo@a --skill b c -a cursor` and `add owner/repo --skill '*' -a cursor` install, skip and exit the same way (§6.3, §7.1, §8.2)
- [ ] Given the same repository, when `add owner/repo` runs at a terminal, `a`, `b` and `c` are picked at the member prompt and only Cursor is ticked at the agent prompt, the outcome is the same, the non-zero exit included (§8.2)
- [ ] Given the same repository, `add owner/repo --skill a b -a claude cursor` installs `a` for Claude and Cursor and `b` for Claude only, and the output names Cursor as left out for `b` (§8.2)
- [ ] Given a repository holding `skills/style/` and the top-level plugin member `tools/`, whose own `agntc.json` lists `agents: ["claude"]`, `add owner/repo --skill '*' -a cursor` installs `style` for Cursor, skips `tools` with a message and no `owner/repo/tools` entry, and exits non-zero (§6.4, §8.2)
- [ ] Given the first repository with `b` installed for Claude, `add owner/repo --skill a b -a cursor` installs `a` for Cursor, leaves `.claude/skills/b/` and the entry `owner/repo/b` unchanged, names `b` as skipped, and exits non-zero (§8.2, §8.4)
- [ ] Given the first repository, with `a` installed for Claude and `b` installed for Codex alone before `skills/b/agntc.json` came to restrict it to Claude, when `add owner/repo` runs at a terminal, `a` and `b` are picked at the member prompt and no agent is ticked, `a` reinstalls for Claude, `b` is named as skipped with `.agents/skills/b/` and the entry `owner/repo/b` unchanged, and the command exits non-zero (§8.4)

**Do**:
- Skip the unit with a message, as the multi-unit path skips a member today, and count the skip in the run's exit status (§8.2).
- Where the work lives: the per-member ceiling filter and the exit accounting of `runCollectionPipeline` (`src/commands/add.ts`), which exits non-zero only for a failed member today; the skipped tally of `renderCollectionAddSummary` (`src/summary.ts`).

**Context**:
> - §8.2: "A run installing several units handles that case per unit. A unit whose ceiling excludes every named agent is skipped with a message. The other units install, and the command exits non-zero so a calling agent sees the partial result. This is the same partial-success reporting `update` uses. Today the multi-unit path skips such a member ("skipped — author restricts to …, none selected", `src/commands/add.ts`) and exits 0. Only a failed member exits non-zero."
> - §6: "A clash, or a ceiling that excludes every named agent, stops that skill alone, and the run's other entries proceed."
> - §8.4: "A re-add that names no agent, such as a version-only re-add with no agent ticked, is refused (§1.5) when the ceiling allows none of the recorded agents. In a run that re-adds or installs several units, that entry is skipped with a message instead, the others proceed, and the command exits non-zero, as §8.2 handles a unit left with no agent." Task 4-6 makes ticking no agent on a re-add reinstall for the recorded agents rather than cancel.
> - A unit skipped this way writes nothing and takes no path, so a later entry's copy on that path installs (§6, task 8-15).
> - Related work elsewhere: under `--json` a skipped entry is `skipped` with a reason (Phase 12, §9.2); a pick skipped against the pick's own ceilings is task 9-7.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §6, §6.3, §6.4, §7.1, §8.2, §8.4, §9.2

## vercel-skills-compatibility-9-7

### Task vercel-skills-compatibility-9-7: A pick from a unit installs within the pick's own ceiling under `-a`

**Problem**: Task 8-4 binds a pick from a unit by the unit's own `agntc.json` and the picked skill's, never by the ceilings of the unit's other skills and members (§6.5), and applies those ceilings through the agent prompt. Under `-a` there is no prompt (task 9-1). Judged against the unit's combined ceiling (task 9-2), a sibling's Claude-only restriction would narrow or refuse a pick that does not install it; judged against the picked skill alone, the pick would escape the unit's ceiling.

**Solution**: Under `-a`, a pick, by name or by path, installs for the named agents its own ceilings allow: the unit's `agntc.json` and the picked skill's own, and for a skill inside a plugin member nested in a plugin's `skills/`, both units' (§6.5). A path naming a member nested in a plugin's `skills/` is bound by the plugin's ceiling and every ceiling the member holds, and a path pick and a `--plugin` bundle narrowed to a folder of a unit's skills are bound the same way (§6.5, §8.2). The ceilings of skills and members the pick does not install never bind it. The output names the named agents left out. A pick whose ceilings exclude every named agent is refused as a single-unit run is (task 9-5); in a run of several picks it is skipped while the others install, and the command exits non-zero (task 9-6).

**Outcome**: `-a` on a pick is judged against the ceilings of what the pick installs, and nothing else.

**Acceptance Criteria**:
- [ ] Given a plugin repository with no semver tags whose root `agntc.json` lists `agents: ["claude"]`, holding `skills/a/`, `skills/b/` and `agents/reviewer.md`, when `add owner/repo@a -a cursor` runs, the command exits non-zero and writes no file and no manifest entry; `add owner/repo@a -a claude cursor` installs `a` for Claude only, with the pick's warning, and the output names Cursor as left out (§6.5, §8.2)
- [ ] Given that plugin with no root `agntc.json`, and either `skills/b/agntc.json` listing `agents: ["claude"]` or a plugin member under its `skills/` restricted to Claude, `add owner/repo@a -a cursor` installs `a` into `.cursor/skills/a/` as `owner/repo/a` (§6.5)
- [ ] Given that plugin with no root `agntc.json` and with `skills/a/agntc.json` listing `agents: ["claude"]`, `add owner/repo@a -a cursor` exits non-zero and writes nothing (§6.5)
- [ ] Given a plugin whose root `agntc.json` lists `agents: ["claude", "codex"]` and whose member `skills/pack/` has its own `agntc.json` listing `agents: ["codex", "cursor"]` and holds `skills/x/`, `add owner/repo@x -a claude cursor` exits non-zero and writes nothing, and `add owner/repo@x -a '*'` installs `x` for Codex alone and names Claude and Cursor as left out (§6.1, §6.5)
- [ ] Given a plugin whose root `agntc.json` lists `agents: ["claude", "codex"]`, whose `skills/a/agntc.json` lists `agents: ["codex"]`, and whose member `skills/pack/` holds `skills/x/` with its own `agntc.json` listing `agents: ["claude", "cursor"]`, `add owner/repo/skills/pack -a codex` exits non-zero and writes nothing, and `add owner/repo/skills/pack -a '*'` installs the member for Claude alone and names Codex and Cursor as left out (§6.5, §8.2)
- [ ] Given the first plugin, `add owner/repo/skills/a -a cursor` exits non-zero and writes nothing, as `add owner/repo@a -a cursor` does (§6.5)
- [ ] Given a plugin repository (`skills/` beside `agents/`) holding `skills/frontend/react/`, `skills/frontend/vue/` and `skills/backend/sql/`, whose root `agntc.json` lists `agents: ["claude"]`, `add owner/repo/skills/frontend --plugin -a cursor` exits non-zero and writes nothing; with no root `agntc.json` and with `skills/backend/sql/agntc.json` listing `agents: ["claude"]`, the same line installs the bundle `owner/repo/skills/frontend` for Cursor (§6.2, §6.5)
- [ ] Given a repository holding `skills/style/` and the top-level member `tools/`, whose own `agntc.json` lists `agents: ["claude"]` and which holds `skills/lint/`, `add owner/repo --skill style lint -a cursor` installs `style` for Cursor, names `lint` as skipped with no `owner/repo/lint` entry written, and exits non-zero (§6.5, §8.2)

**Do**:
- Where the work lives: the pick ceilings of task 8-4 (a pick by name), task 8-5 (a path pick) and task 8-6 (a `--plugin` bundle narrowed to a folder of a unit's skills) in `src/commands/add.ts`, read against the agents `-a` names.

**Context**:
> - §6.5: "The picked skill installs within the unit's agent ceiling, the `agents` list in the unit's `agntc.json` (§8.2), and within its own `agntc.json`, the ceiling a skill installed on its own carries (§6). A skill inside a plugin member nested in a plugin's `skills/` sits inside both units, and both units' ceilings bind it. The ceilings of the unit's other skills and members do not: the pick installs none of them, and §8.2's combined ceiling is that of a unit installing what it holds. The output names the agents left out, and a pick whose named agents all fall outside that ceiling is refused, as it would be for the unit itself."
> - §6.5: a path naming a member nested in a plugin's `skills/` "installs that member whole under its member key (§4.3, §5.1), as a pick from the plugin: with the plugin's warning, within the plugin's ceiling and every ceiling the member holds (§8.2)".
> - §6.2, §6.5: a narrowed bundle installs within every ceiling it holds; as a pick (task 8-6) it installs within the enclosing unit's ceiling too, and not within those of the unit's skills and members outside its folder.
> - §8.2: a run installing several units skips a unit whose ceiling excludes every named agent and exits non-zero.
> - Related work elsewhere: the pick's warning is task 8-3; a pick from a unit declaring `"type": "plugin"` is refused (task 8-7).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §6, §6.1, §6.2, §6.5, §8.2
