# Phase 8: Picks and "all" meet units — 17 tasks

## vercel-skills-compatibility-8-1

### Task vercel-skills-compatibility-8-1: `'*'` on a source that is a unit installs the whole unit

**Problem**: Phase 7 gives `--skill '*'` Vercel's meaning on a skills-only source: every skill installs as its own entry (task 7-6, §6.3). Vercel has no units. Applied as it stands to a source that is one (a plugin, or a repo whose `agntc.json` declares `"type": "plugin"`), the same reading would install each of its skills separately and drop its agents and hooks, splitting what the author published as one unit (§1.4, §6.4).

**Solution**: On a source that is a unit, `'*'` installs the whole unit, agents and hooks included, as one entry: what a plain add of the same source installs, under the same key (§4.3, §6.4). This covers a source that reads as a plugin, a skills-only source declaring `"type": "plugin"` (a bundle), `--plugin` with `--skill '*'` (the whole bundle, §6.6), and a path naming a plugin member (that member whole, §5.1). The unit's internal skills install with it, as they do in a plain add of the unit (§5.4, §6.1, §6.2). "Everything" is never read as picking every skill one by one.

**Outcome**: `--skill '*'` on a unit installs the unit, never its skills one by one.

**Acceptance Criteria**:
- [ ] Given a plugin repository with no semver tags holding `skills/a/`, `skills/b/`, `agents/reviewer.md` and `hooks/pre-commit.sh`, when `add owner/repo --skill '*'` runs for Claude, the manifest gains the one entry `owner/repo`, recorded as a plugin: `a` and `b` land in `.claude/skills/`, `reviewer.md` in `.claude/agents/` and `pre-commit.sh` in `.claude/hooks/`, and no `owner/repo/a` or `owner/repo/b` entry is written (§6.4)
- [ ] Given a skills-only repository holding `skills/a/` and `skills/b/` whose root `agntc.json` declares `"type": "plugin"`, `add owner/repo --skill '*'` installs `a` and `b` as the one bundle entry `owner/repo` (§6.2, §6.4)
- [ ] Given a skills-only repository holding `skills/a/` and `skills/b/` and no `agntc.json`, `add owner/repo --plugin --skill '*'` installs `a` and `b` as the one bundle entry `owner/repo`, as `add owner/repo --plugin` does (§6.6)
- [ ] Given a repository whose member `skills/pack/` holds `agents/helper.md` and `skills/x/`, `add owner/repo/skills/pack --skill '*'` installs the member whole as the one entry `owner/repo/skills/pack`, with `helper.md` in `.claude/agents/` and `x` in `.claude/skills/x/` (§4.3, §5.1, §6.4)
- [ ] Given the plugin repository also holding `skills/secret/`, whose frontmatter sets `metadata.internal: true`, `add owner/repo --skill '*'` installs `secret` with the rest of the plugin; given the `"type": "plugin"` skills-only repository holding it, the bundle installs it too (§5.4, §6.1, §6.2)
- [ ] Given each of these sources, the entry `--skill '*'` writes has the key, files and recorded type that `add` of the same line without `--skill '*'` writes (§4.3, §6.4)

**Do**:
- Where the work lives: the `'*'` reading of task 7-6 in `runAdd` and `runCollectionPipeline` (`src/commands/add.ts`); the shape `detectType` (`src/type-detection.ts`) reads for the source, and the unit install `runAdd` already takes for a plugin.

**Context**:
> - §6.4: "`--skill '*'` and `--all` on a source that is a unit install the whole unit, agents and hooks included. This covers a plugin and a repo declaring `"type": "plugin"`. "Everything" is never read as picking every skill one by one."
> - §6.6: "`--skill '*'` and `--all` name no skill, so with `--plugin` they install the whole bundle (§6.4)."
> - §5.1 rule 3: a path naming a non-hidden folder holding only `skills/` "names a skill pack, a plugin member (§5.3), and not a menu. It installs that member whole under its member key (§4.3)". A path naming any other plugin member installs it whole the same way (tasks 1-5 to 1-7, 2-7, 5-1).
> - §5.4: a bundle (`--plugin` or `"type": "plugin"`) "includes" internal skills. §6.1: a plugin's skills are "the skills discovery finds under its `skills/`, as a bundle's are (§6.2)", for a source that reads as a plugin, a plugin member and a source declaring `"type": "plugin"`.
> - `-y` (Phase 11) and `--all` (Phase 12) reach this behaviour through "all" (§6.4, §10.2).
> - Related work elsewhere: `'*'` on a menu mixing skills and plugin members is task 8-2; a name beside `'*'` that falls inside the unit is task 8-10; `--plugin --skill '*' x` is refused (task 8-8).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §4.3, §5.1, §5.4, §6.1, §6.2, §6.4, §6.6, §10.2

## vercel-skills-compatibility-8-2

### Task vercel-skills-compatibility-8-2: `'*'` on a menu of skills and plugin members installs each member whole

**Problem**: Discovery offers loose skills and plugin members in one menu (§5.2, §5.3). Task 7-6 makes `'*'` install every skill as its own entry, but a plugin member is not a skill (§7.1). Read as "every skill", `'*'` would either skip the members or split them into their inner skills, dropping their agents and hooks (§6.4).

**Solution**: In a menu that mixes skills and plugin members, `'*'` installs every entry the menu offers, with no member prompt. Each loose skill installs as its own entry keyed `owner/repo/<folder>`, and each plugin member installs whole as one entry keyed `owner/repo/<path>`, its skills, agents and hooks routed (§4.3, §6.4). A member installs whole wherever the walk reached it (at the top level, under `skills/` or in a category folder), and a skill pack holding only `skills/` installs whole too (§5.2, §5.3). Internal loose skills are left out (§5.4, §6.3), while a member installs with its internal skills, as a member always does (§6.1).

**Outcome**: `--skill '*'` on a mixed menu installs every loose skill as its own entry and every plugin member as one unit.

**Acceptance Criteria**:
- [ ] Given a skills-only repository with no semver tags holding `skills/a/`, `skills/b/` and the top-level member `tools/` (holding `agents/helper.md` and `skills/lint/`), when `add owner/repo --skill '*'` runs for Claude, no member prompt is shown and three entries are written, `owner/repo/a`, `owner/repo/b` and `owner/repo/tools`: `helper.md` lands in `.claude/agents/` and `lint` in `.claude/skills/lint/`, both recorded under `owner/repo/tools`, and no `owner/repo/lint` entry is written (§4.3, §6.3, §6.4)
- [ ] Given the same repository also holding the member `skills/review/pack/` (holding `hooks/pre-commit.sh` and `skills/check/`) and the skill pack `skills/bundles/kit/` (holding only `skills/one/` and `skills/two/`), the same line also writes `owner/repo/skills/review/pack` and `owner/repo/skills/bundles/kit`, each installed whole as one entry (§5.2, §5.3, §6.4)
- [ ] Given `skills/secret/`, whose frontmatter sets `metadata.internal: true`, beside the loose skills, `--skill '*'` does not install it; given `tools/skills/hidden/` marked internal, it installs as part of `owner/repo/tools` (§5.4, §6.1, §6.3)

**Do**:
- Where the work lives: the `'*'` reading of task 7-6 in `runCollectionPipeline` (`src/commands/add.ts`), which installs each selected menu entry as its own unit, over the entries the menu offers (`selectCollectionPlugins`, `src/collection-select.ts`).

**Context**:
> - §6.4: "In a menu that mixes skills and plugin members (§5.3), "all" installs each skill as its own entry and each plugin member whole."
> - §6.3: "On a skills-only source, `-y`, `--skill '*'` and `--all` install each skill as its own entry, as Vercel does. Internal skills are left out (§5.4)."
> - §5.3: "A non-hidden folder with `skills/`, `agents/` or `hooks/` (and no `SKILL.md`) is a plugin member, installed whole. This includes a skill pack that holds only `skills/`." §5.2: no walk enters a plugin member.
> - §4.3: a skill installed on its own keys `owner/repo/<folder>`, a plugin member `owner/repo/<path>`.
> - §6.1: a plugin member's skills are found under its `skills/` "as a bundle's are", and a bundle includes internal skills (§5.4).
> - §10.2: under `-y`, "every skill is picked. Internal skills are left out (§5.4), and units follow §6.3–§6.4" (Phase 11).
> - Related work elsewhere: when two of these entries would write the same path, tasks 8-12 to 8-15 apply; a name beside `'*'` that falls inside a member is task 8-10.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §5.2, §5.3, §5.4, §6.1, §6.3, §6.4, §7.1, §10.2

## vercel-skills-compatibility-8-3

### Task vercel-skills-compatibility-8-3: A name aimed at a skill inside a unit installs that skill alone, with a warning

**Problem**: Phase 7 matches `@` and `--skill` names against what a menu offers (tasks 7-3, 7-5). A skill inside a plugin or a plugin member is not offered on its own; the unit is (§5.2, §5.3). Vercel has no units, so a pasted line naming one of a unit's skills expects that skill alone. Without a pick, such a line misses. Installing the whole unit instead would install what the line never asked for (§6.5).

**Solution**: A name (`@x` or `--skill x`) also reaches the skills inside plugins and plugin members, wherever discovery finds them under the unit's `skills/`, category folders included (§6.1, §6.5, §7.2). A name aimed at such a skill installs that skill alone, as a skill, into its declared-name folder under `owner/repo/<folder>`, the key a menu pick of a loose skill gets (§4.3). A warning names what the install leaves out: the unit's agents, hooks and other skills. This applies to a source that reads as a plugin and to a plugin member found anywhere in the source. An internal skill inside a unit installs when named. The installed entry is a skill, and `update` reinstalls it alone from its folder.

**Outcome**: A Vercel line naming one skill of a unit installs that skill and says what of the unit it did not install.

**Acceptance Criteria**:
- [ ] Given a plugin repository with no semver tags holding `skills/a/`, `skills/b/`, `agents/reviewer.md` and `hooks/pre-commit.sh`, when `add owner/repo@a` runs for Claude, the outcome is (§4.3, §6.5):
  - `a` alone installs into `.claude/skills/a/` under key `owner/repo/a`, recorded as a skill;
  - nothing is written to `.claude/agents/` or `.claude/hooks/`, and `b` is not installed;
  - a warning names `reviewer.md`, `pre-commit.sh` and `b` as left out.
- [ ] Given the same repository, `add owner/repo --skill a` installs and warns the same way (§6.5, §7.1)
- [ ] Given the plugin's `skills/frontend/react/SKILL.md` declaring `react`, `add owner/repo@react` installs it flat into `.claude/skills/react/` under `owner/repo/react` (§4.2, §6.1, §6.5)
- [ ] Given a skills-only repository holding `skills/style/` and the top-level member `tools/` (holding `agents/helper.md`, `skills/lint/` and `skills/fmt/`), `add owner/repo@lint` installs `lint` alone under `owner/repo/lint`, and the warning names `helper.md` and `fmt` and nothing of `style`; the same holds for a member at `skills/review/pack/` (§5.3, §6.5)
- [ ] Given the plugin's `skills/secret/`, whose frontmatter sets `metadata.internal: true`, `add owner/repo@secret` installs it alone with the warning (§5.4, §6.5)
- [ ] Given `a` picked from the plugin and installed, when `skills/a/` changes upstream and `update owner/repo/a` runs, `a` alone reinstalls from `skills/a/`, and none of the plugin's agents, hooks or other skills is installed (§1.2, §4.3)

**Do**:
- Where the work lives: the name matching of tasks 7-3 and 7-5 in `runAdd` and `runCollectionPipeline` (`src/commands/add.ts`), over what discovery finds (`src/type-detection.ts`); the single-skill install (`copyUnit`, `src/copy-unit.ts`); add's output (`src/summary.ts`).

**Context**:
> - §6.5: "A pick by name (`@skill` or `--skill x`) aimed at a skill inside a unit installs that skill alone. A warning names what the install leaves out: the unit's agents, hooks and other skills. This applies to plugins and to plugin members (§5.3)." "Accepted risk: a repo whose skills depend on its agents or hooks can still be installed partially when its author never declares `"type": "plugin"`. The warning is the only guard in that case."
> - §7.2: on `add`, the skills inside plugins and plugin members are among the alternatives a miss lists, "since a name reaches those too (§6.5)".
> - §6.1: a unit's skills are those discovery finds under its `skills/`, category folders walked as discovery walks `skills/` (§5.2), each flat in its declared-name folder.
> - §4.3: a skill installed on its own has one key, `owner/repo/<folder>`, its install folder, "however the skill was selected".
> - §5.4: an internal skill "still installs when named".
> - Related work elsewhere: the ceiling a pick installs within is task 8-4; a path landing inside a unit is tasks 8-5 and 8-6; a pick from a unit declaring `"type": "plugin"` is refused (task 8-7); `--plugin` with a named skill is refused (task 8-8); a name reaching several skills is task 8-9; a miss lists the skills inside units (task 8-11).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §4.2, §4.3, §5.2, §5.3, §5.4, §6.1, §6.5, §7.1, §7.2

## vercel-skills-compatibility-8-4

### Task vercel-skills-compatibility-8-4: A skill picked from a unit installs within the unit's ceiling and its own

**Problem**: A unit's author restricts its agents with the `agents` list in the unit's `agntc.json`, and a skill can carry its own (§1.4, §6). A pick installs one skill out of a unit (task 8-3). Installing it within its own `agntc.json` alone would let a pick escape the unit's ceiling. Installing it within the unit's combined ceiling (§8.2) would let a sibling skill or member the pick never installs narrow it (§6.5).

**Solution**: The picked skill installs within the unit's own ceiling, the `agents` list in the unit's `agntc.json`, and within its own `agntc.json`. A skill inside a plugin member nested in a plugin's `skills/` sits inside both units, and both units' ceilings bind it. The ceilings of the unit's other skills and members do not. The agent prompt offers only the agents those ceilings together allow, and is skipped when that is exactly one agent and that agent is detected (§10.1). In a run picking several skills, each pick installs only for the chosen agents its own ceilings allow, and the output names the agents it left out. Ceilings that together allow no agent refuse the pick.

**Outcome**: A pick never installs for an agent its unit or the skill itself excludes, and is never narrowed by skills it does not install.

**Acceptance Criteria**:
- [ ] Given a plugin repository with no semver tags whose root `agntc.json` lists `agents: ["claude", "codex"]`, holding `skills/a/` and `skills/b/`, when `add owner/repo@a` runs at a terminal with no agent detected, the agent prompt offers Claude and Codex and not Cursor (§6.5, §8.2, §10.1)
- [ ] Given the same plugin with `skills/a/agntc.json` listing `agents: ["codex", "cursor"]`, the prompt for `@a` offers Codex alone; with Codex detected, no agent prompt is shown and `a` installs for Codex (§6.5, §10.1)
- [ ] Given the same plugin with no `agntc.json` in `skills/a/`, and either `skills/b/agntc.json` listing `agents: ["claude"]` or a member under its `skills/` restricted to Claude, the prompt for `@a` offers Claude and Codex: a sibling's restriction does not narrow the pick (§6.5, §8.2)
- [ ] Given a skills-only repository whose top-level member `tools/` has its own `agntc.json` listing `agents: ["claude"]` and holds `skills/lint/`, `add owner/repo@lint` with Claude detected installs `lint` for Claude only, with no agent prompt (§5.3, §6.5, §10.1)
- [ ] Given a plugin whose root `agntc.json` lists `agents: ["claude", "codex"]` and whose `skills/pack/` is a member with its own `agntc.json` listing `agents: ["codex", "cursor"]` and holding `skills/x/`, the prompt for `@x` offers Codex alone (§6.1, §6.5)
- [ ] Given the first plugin with `skills/a/agntc.json` listing `agents: ["cursor"]`, `add owner/repo@a` exits non-zero, writes no file and no manifest entry, and its message says the restrictions leave no agent to install for (§1.5, §6.5, §8.2)
- [ ] Given a skills-only repository holding `skills/style/` and the top-level member `tools/`, restricted to Claude and holding `skills/lint/`, when `add owner/repo --skill style lint` runs and Claude and Cursor are ticked, `style` installs for Claude and Cursor, `lint` installs for Claude only, and the output names Cursor as left out for `lint` (§6.5, §8.2)

**Do**:
- Offer only the agents the pick's ceilings together allow, as `selectAgents` (`src/agent-select.ts`) offers only the declared agents today and auto-selects a single detected one (§8.2, §10.1).
- Where the work lives: the pick of task 8-3 in `src/commands/add.ts`; `readConfig` in `src/config.ts`; the per-member ceiling filter in `runCollectionPipeline` (`src/commands/add.ts`), whose "skipped — author restricts to …" output §8.2 cites.

**Context**:
> - §6.5: "The picked skill installs within the unit's agent ceiling, the `agents` list in the unit's `agntc.json` (§8.2), and within its own `agntc.json`, the ceiling a skill installed on its own carries (§6). A skill inside a plugin member nested in a plugin's `skills/` sits inside both units, and both units' ceilings bind it. The ceilings of the unit's other skills and members do not: the pick installs none of them, and §8.2's combined ceiling is that of a unit installing what it holds. The output names the agents left out, and a pick whose named agents all fall outside that ceiling is refused, as it would be for the unit itself."
> - §10.1: the agent prompt "offers the agents within the unit's ceiling (§8.2), and is skipped when that ceiling is exactly one agent and that agent is detected."
> - §8.2: "A single-unit run where the ceiling excludes every named agent is refused (§1.5)." Task 3-6 refuses a unit whose ceilings together allow no agent.
> - An `agntc.json` with no usable `agents` list sets no ceiling, as today (`readConfig`, `src/config.ts`).
> - Related work elsewhere: naming agents with `-a` against a pick's ceiling, and the non-zero exit for an entry a multi-unit run skips for its ceiling, are Phase 9 (§8.1, §8.2); a path pick and a narrowed bundle pick install within the same ceilings (tasks 8-5, 8-6).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §1.5, §5.3, §6, §6.1, §6.5, §8.2, §10.1

## vercel-skills-compatibility-8-5

### Task vercel-skills-compatibility-8-5: A path landing inside a unit installs as a pick

**Problem**: A path in the source can point inside a unit: at one of its skills (`owner/repo/skills/x`, or a tree URL to that folder) or at a folder of its skills (`owner/repo/skills`) (§6.5). Shape is read at the folder the path names (§5.1), so on its own such a path installs a skill or offers a menu with no regard for the unit around it. No warning would name what of the unit is left out, and neither the unit's ceiling nor its `"type": "plugin"` declaration would be consulted.

**Solution**: A path that lands inside a unit is handled as a pick by name is (task 8-3). A path at one of the unit's skills installs that skill alone, keyed `owner/repo/<folder>`, with the warning naming the unit's agents, hooks and other skills left out. A path at a folder of the unit's skills (its `skills/`, or a category folder in it) offers that folder's skills, and each skill picked installs alone with the same warning. This holds for a source that reads as a plugin and for a plugin member, and for every path form: `owner/repo/<path>`, a GitHub tree URL, a GitLab `/-/tree/` URL and an Azure Repos `?path=` URL. The pick installs within the unit's ceiling and its own `agntc.json`, as a named pick does (task 8-4). A path at one skill inside a unit together with `--plugin` is refused, as `--plugin` on any single skill is (§6.6).

**Outcome**: A path into a unit installs what it names, warns what of the unit it leaves out, and stays within the unit's ceiling.

**Acceptance Criteria**:
- [ ] Given a plugin repository with no semver tags holding `skills/a/`, `skills/b/` and `agents/reviewer.md`, when `add owner/repo/skills/a` runs for Claude, `a` alone installs into `.claude/skills/a/` under `owner/repo/a`, nothing lands in `.claude/agents/`, and the warning names `reviewer.md` and `b` as left out; `https://github.com/owner/repo/tree/main/skills/a` installs and warns the same way (§4.3, §6.5)
- [ ] Given the same plugin also holding `skills/frontend/react/` and `skills/frontend/vue/`, `add owner/repo/skills` offers `a`, `b`, `react` and `vue`, and `add owner/repo/skills/frontend` offers `react` and `vue`; a picked `react` installs alone under `owner/repo/react`, with the warning naming `reviewer.md` and the plugin's skills it did not install (§5.1, §6.5)
- [ ] Given a skills-only repository whose top-level member `tools/` holds `agents/helper.md`, `skills/lint/` and `skills/fmt/`, `add owner/repo/tools/skills/lint` installs `lint` alone under `owner/repo/lint`, with the warning naming `helper.md` and `fmt` (§5.3, §6.5)
- [ ] Given the plugin repository at `https://gitlab.com/group/repo`, `https://gitlab.com/group/repo/-/tree/main/skills/a` installs `a` alone under `group/repo/a` with the warning; given it at `https://dev.azure.com/org/project/_git/repo`, that URL with a `?path=` naming `skills/a` installs `a` alone under `project/repo/a` with the warning (§2.1, §4.3, §6.5)
- [ ] Given the plugin's root `agntc.json` listing `agents: ["claude"]`, `add owner/repo/skills/a` installs `a` for Claude only, as `add owner/repo@a` does (§6.5)
- [ ] Given the plugin repository, `add owner/repo/skills/a --plugin` exits non-zero and writes no file and no manifest entry (§1.5, §6.5, §6.6)

**Do**:
- Where the work lives: the unit folder `runAdd` derives for a path (`unitDir` in `src/commands/add.ts`) and the shape `detectType` (`src/type-detection.ts`) reads there, both of which look only at the folder the path names today; `readConfig` (`src/config.ts`) for the enclosing unit's `agntc.json`; the pick and its warning from task 8-3.

**Context**:
> - §6.5: "A path in the source can also land inside a unit, either at one of its skills (`owner/repo/skills/x`, or a tree URL to that folder) or at a folder of its skills (`owner/repo/skills`). Such a path is handled as a pick by name is, with or without `--plugin`, except that a path at one skill together with `--plugin` is refused, as `--plugin` on any single skill is (§6.6). What it installs carries the same warning, and the line is refused when the unit declares `"type": "plugin"`."
> - §5.1: "Shape is read at the root of what the source points at: the repo root, or the path the source names." A folder of skills offers what discovery finds there (rule 4).
> - §4.3: a skill keys `owner/repo/<folder>` "however the skill was selected: ... by a subpath, or by a tree URL". A GitLab key's repository part is the last two segments of the repository path before `/-/`, and an Azure Repos key's is `project/repo` (Phase 5).
> - Related work elsewhere: `--plugin` with a path at a folder of a unit's skills is task 8-6; a path landing inside a unit declaring `"type": "plugin"` is refused (task 8-7); the path forms themselves are tasks 5-1, 5-8 and 5-9, and tree URLs Phases 1 and 2. A path at one skill of a skills-only source that is not a unit installs that skill with no warning (task 5-1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §2.1, §4.3, §5.1, §5.3, §6.5, §6.6

## vercel-skills-compatibility-8-6

### Task vercel-skills-compatibility-8-6: `--plugin` with a path at a folder of a unit's skills bundles that folder as a pick

**Problem**: A path narrows a `--plugin` bundle to one folder (§6.2), and a path landing inside a unit is a pick "with or without `--plugin`" (§6.5). With `--plugin`, a path at a folder of a plugin's skills, such as `owner/repo/skills/frontend` inside a plugin, must bundle that folder. Treated as a bundle alone, it would say nothing of the enclosing plugin's agents, hooks and other skills it leaves behind, and it would ignore the plugin's ceiling (§6.5).

**Solution**: `--plugin` with a path at a folder of a unit's skills bundles that folder as one entry keyed `owner/repo/<path>`, holding only what discovery finds in that folder (§4.3, §6.2). It is a pick from the enclosing unit, so the output carries the pick's warning naming the unit's agents, hooks and other skills left out (§6.5). It installs within the enclosing unit's ceiling as well as every ceiling the bundle holds (§6.2, §6.5). The ceilings of the unit's skills and members outside that folder do not bind it. An update reinstalls it from that folder, as a narrowed bundle updates (task 3-3).

**Outcome**: A folder of a plugin's skills installs as one entry, within the plugin's ceiling, and the plugin's parts it leaves out are named.

**Acceptance Criteria**:
- [ ] Given a plugin repository with no semver tags holding `skills/frontend/react/`, `skills/frontend/vue/`, `skills/backend/sql/` and `agents/reviewer.md`, when `add owner/repo/skills/frontend --plugin` runs for Claude, `react` and `vue` install as one entry keyed `owner/repo/skills/frontend`, `sql` and `reviewer.md` are not installed, and the warning names `reviewer.md` and `sql` as left out (§4.3, §6.2, §6.5)
- [ ] Given the same plugin's root `agntc.json` listing `agents: ["claude", "codex"]` and `skills/frontend/vue/agntc.json` listing `agents: ["codex", "cursor"]`, the bundle installs for Codex only, with no agent prompt when Codex is detected (§6.2, §6.5, §8.2, §10.1)
- [ ] Given instead only `skills/backend/sql/agntc.json`, listing `agents: ["cursor"]`, the agent prompt for the `skills/frontend` bundle offers all three agents: a ceiling outside the folder does not bind it (§6.5)
- [ ] Given the bundle installed, when upstream adds `skills/frontend/svelte/` and `skills/backend/go/` and `update` runs, `svelte` joins the entry `owner/repo/skills/frontend` and `go` is not installed (§6.2)

**Do**:
- Narrow and key the bundle as task 3-3 does for a tree URL to a folder (§4.3, §6.2).
- Where the work lives: the narrowed bundle of task 3-3 (`unitDir` in `runAdd`, `src/commands/add.ts`; `resolveGuardedSourceDir`, `src/source-parser.ts`); the enclosing-unit reading of task 8-5; the pick warning of task 8-3.

**Context**:
> - §6.5: a path landing inside a unit "is handled as a pick by name is, with or without `--plugin`, except that a path at one skill together with `--plugin` is refused". "What it installs carries the same warning".
> - §6.2: "A path in the source narrows the bundle to that folder." "The bundle installs within every agent ceiling it holds: the source's own `agntc.json`, and that of each skill and each plugin member it takes."
> - §6.5 on a pick's ceiling: the pick installs within the unit's ceiling and its own `agntc.json`; "The ceilings of the unit's other skills and members do not".
> - §4.3: "A bundle narrowed by a path (§6.2) keys the same way, `owner/repo/<path>`, where `<path>` is the folder the path names".
> - What a narrowed bundle leaves out of its own folder (a loose file, a skill-less folder) is named as task 3-4 names it (§6.2).
> - Related work elsewhere: the same line is refused when the unit declares `"type": "plugin"` (task 8-7); `--plugin` with a path at one skill inside a unit is refused (task 8-5).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §6.2, §6.5, §8.2, §10.1

## vercel-skills-compatibility-8-7

### Task vercel-skills-compatibility-8-7: A pick from a unit declaring `"type": "plugin"` is refused

**Problem**: An author whose skills only work together declares `"type": "plugin"` in the unit's `agntc.json` to keep them together (§6.5). The picks of tasks 8-3, 8-5 and 8-6 would still install one skill or folder out of such a unit and override the declaration. The declaration is the only guard an author has against a partial install, since the warning does not stop one (§6.5).

**Solution**: A pick is refused (§1.5) when the unit it lands in declares `"type": "plugin"` in its `agntc.json`. This covers a name (`@x` or `--skill x`) aimed at one of its skills, and a path landing inside it, with or without `--plugin`. It holds for a plugin declaring it, for a skills-only source declaring it (where the declaration keeps its meaning of bundle by default), and for a plugin member whose own `agntc.json` declares it. The message names the whole-unit install instead, as a line `add` accepts: the source for a whole-source unit, and a plugin member by its path (§7.1, §14.1). Nothing is written or removed.

**Outcome**: An author's `"type": "plugin"` keeps the unit whole against every pick, and the refusal says how to install it whole.

**Acceptance Criteria**:
- [ ] Given a plugin repository with no semver tags holding `skills/a/`, `skills/b/` and `agents/reviewer.md`, whose root `agntc.json` declares `"type": "plugin"`, when `add owner/repo@a` or `add owner/repo --skill a` runs, the command exits non-zero, writes no file and no manifest entry, and its message names the whole-unit install `owner/repo`; running `add owner/repo` installs the plugin whole (§1.5, §6.5)
- [ ] Given a skills-only repository holding `skills/a/` and `skills/b/` whose root `agntc.json` declares `"type": "plugin"`, `add owner/repo@a` is refused the same way, naming `owner/repo`, which bundles `a` and `b` as one entry when run (§6.5)
- [ ] Given a skills-only repository holding `skills/style/` and the top-level member `tools/` (holding `agents/helper.md` and `skills/lint/`) whose own `agntc.json` declares `"type": "plugin"`, `add owner/repo@lint` is refused naming `owner/repo/tools`, which installs the member whole when run, while `add owner/repo@style` installs `style` (§5.3, §6.5, §7.1)
- [ ] Given the plugin repository of the first scenario, `add owner/repo/skills/a`, `https://github.com/owner/repo/tree/main/skills/a`, `add owner/repo/skills` and `add owner/repo/skills --plugin` are each refused naming `owner/repo`, writing nothing; given the member of the third, `add owner/repo/tools/skills/lint` is refused naming `owner/repo/tools` (§6.5)
- [ ] Given `a` installed from that repository before the declaration was added upstream, when `add owner/repo@a` is refused, the installed entry and its files are unchanged (§1.5)

**Do**:
- Where the work lives: the pick paths of tasks 8-3, 8-5 and 8-6 in `src/commands/add.ts`, ahead of any write; `readConfig` (`src/config.ts`) for the unit's declared `type`.

**Context**:
> - §6.5: "**Exception: the pick is refused (§1.5) when the unit's `agntc.json` declares `"type": "plugin"`.** The message names the whole-unit install instead. The declaration means two things: On a plugin, `"type": "plugin"` means "keep this whole". On a skills-only repo it keeps its existing meaning (bundle by default), and the same refusal applies. An author whose skills only work together adds `"type": "plugin"` to keep them together." For a path landing inside a unit, "the line is refused when the unit declares `"type": "plugin"`", with or without `--plugin`.
> - §5.3: a folder is read by §5.1's rules against its own `agntc.json`; a folder whose own `agntc.json` declares `"type": "plugin"` is a plugin member keyed by its path.
> - §7.1: a plugin member "is selected by its path in the source (`owner/repo/<path>`), the form agntc prints for it (§14.1)". §14.1: "Every command agntc prints is one agntc accepts".
> - §1.5: a refusal exits non-zero, writes nothing, removes nothing, and names the way through where one exists.
> - Related work elsewhere: Phase 15 makes the whole-unit line accepted for every source form (§14.1); a name beside `'*'` that the whole unit's install covers is not a pick (task 8-10).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §5.3, §6.5, §7.1, §14.1

## vercel-skills-compatibility-8-8

### Task vercel-skills-compatibility-8-8: `--plugin` together with a named skill is refused

**Problem**: `--plugin` bundles the whole source as one unit (§6.2), while a named skill (`--skill x` or `@x`) asks for one skill (§7.1). A line carrying both asks for two different installs. Honouring either half would silently drop the other, which agntc never does (§1.5, §6.6).

**Solution**: `--plugin` together with a named skill is refused (§1.5, §6.6): `--plugin` with `--skill x`, with `@x`, and with a name beside `'*'` (`--plugin --skill '*' x`). The refusal holds on a source that already reads as a plugin, where `--plugin` is otherwise redundant. The message names the conflict. `--skill '*'` alone names no skill, so `--plugin --skill '*'` bundles the whole source (task 8-1). A path in the source is not a named skill, so `--plugin` with a path still narrows the bundle (§6.2).

**Outcome**: No line both bundles a source and picks a skill from it.

**Acceptance Criteria**:
- [ ] Given a skills-only repository with no semver tags holding `skills/a/` and `skills/b/`, when `add owner/repo --plugin --skill a` or `add owner/repo@a --plugin` runs, the command exits non-zero, writes no file and no manifest entry, and its message names `--plugin` and the named skill as not combining (§1.5, §6.6)
- [ ] Given the same repository, `add owner/repo --plugin --skill '*' a` is refused the same way, while `add owner/repo --plugin --skill '*'` installs `a` and `b` as the one bundle entry `owner/repo` (§6.4, §6.5, §6.6, §7.1)
- [ ] Given a plugin repository holding `skills/a/` beside `agents/reviewer.md`, `add owner/repo@a --plugin` is refused the same way (§6.6)
- [ ] Given a skills-only repository holding `skills/frontend/react/`, `skills/frontend/vue/` and `skills/backend/sql/`, `add owner/repo/skills/frontend --plugin` installs `react` and `vue` as the one entry `owner/repo/skills/frontend` (§6.2, §6.6)
- [ ] Given `owner/repo` installed as a bundle, when `add owner/repo@a --plugin` is refused, the bundle's entry and files are unchanged (§1.5)

**Do**:
- Where the work lives: `runAdd` in `src/commands/add.ts`, where the `--plugin` flag (`forcePlugin`) meets the name list of tasks 7-3 and 7-5.

**Context**:
> - §6.6: "`--plugin` together with a named skill (`--skill <name>` or `@skill`) is refused (§1.5). A bundle is the whole source. `--skill '*'` and `--all` name no skill, so with `--plugin` they install the whole bundle (§6.4). A name beside `'*'` is still a named skill, so `--plugin --skill '*' x` is refused. A path in the source is not a pick, and it works with `--plugin` (§6.2)." And: "`--plugin` on a plugin is redundant and changes nothing".
> - §6.5: "Under `--plugin` such a name [beside `'*'`] is still a named skill and refuses the line (§6.6)."
> - §7.1: `@skill` and `--skill` names combine into one list, and "Every other name in the list [beside `'*'`] is still matched as any name is".
> - §1.5: a refusal exits non-zero, writes nothing and removes nothing.
> - Related work elsewhere: `--plugin` with a path at one skill is refused as `--plugin` on a single skill is (tasks 3-3, 5-1, 8-5); `--plugin` with a path inside a unit is task 8-6; `--all` is Phase 12.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §6.2, §6.4, §6.5, §6.6, §7.1

## vercel-skills-compatibility-8-9

### Task vercel-skills-compatibility-8-9: A name reaching several skills selects the one Vercel's discovery would

**Problem**: A name can reach more than one skill: a loose skill and a skill inside a unit, or skills inside two units, all declaring that name (§6.5). Discovery's same-name rule keeps one of two installables it offers (§5.2), but the skills inside a unit are not offered on their own, so a name that reaches into units (task 8-3) can match several. Vercel's discovery knows no units and installs the first skill its walks reach. A pasted Vercel line must get that same skill (§1.4).

**Solution**: The name selects the skill Vercel's discovery would select: the first its walks reach, each plugin member entered as Vercel's walks enter it, within that search root's depth (§5.2). The walk of the source root goes one level, so it never reaches inside a top-level member, while the walks of `skills/` and the other three-level roots reach three levels below their root. Where no Vercel walk reaches any of the candidates, the name selects the first in agntc's priority order, a unit's skills taking the unit's place in the order its own walk of `skills/` reaches them (§6.1). A selected loose skill installs as a skill. A selection that lands inside a unit is a pick from it: it carries the pick's warning (task 8-3), and it is refused when that unit declares `"type": "plugin"` (task 8-7), with no other candidate installed in its place.

**Outcome**: A name that several skills declare installs the skill Vercel's CLI would install for the same line.

**Acceptance Criteria**:
- [ ] Given a skills-only repository with no semver tags holding `skills/x/` declaring `x` and the member `skills/a-pack/` (holding `agents/helper.md` and `skills/x/` declaring `x`), when `add owner/repo@x` runs for Claude, the `x` from `skills/a-pack/skills/x/` installs into `.claude/skills/x/` under `owner/repo/x`, with the warning naming `helper.md` as left out, and the loose `skills/x/` is not installed (§5.2, §6.5)
- [ ] Given a skills-only repository holding the top-level member `pack/` (holding `agents/helper.md` and `skills/x/` declaring `x`) and the loose `skills/x/` declaring `x`, `add owner/repo@x` installs the loose `skills/x/` under `owner/repo/x` with no warning, though agntc's own order reaches `pack/` first: Vercel's one-level walk of the source root never reaches inside `pack/` (§5.2, §6.5)
- [ ] Given a skills-only repository holding the member `skills/cat/pack/` (holding `agents/helper.md` and `skills/x/` declaring `x`), whose `x` lies beyond the three levels Vercel walks below `skills/`, and the loose `.claude/skills/x/` declaring `x`, `add owner/repo@x` installs the loose `.claude/skills/x/` (§5.2, §6.5)
- [ ] Given a skills-only repository holding `skills/y/` and the top-level members `alpha/` and `beta/`, each holding `agents/` and `skills/x/` declaring `x`, `add owner/repo@x` installs `alpha/`'s `x`, with the warning naming what of `alpha/` it leaves out, whatever order the filesystem lists the two in (§5.2, §6.1, §6.5)
- [ ] Given the first repository with `skills/a-pack/agntc.json` declaring `"type": "plugin"`, `add owner/repo@x` exits non-zero, writes no file and no manifest entry, and names `owner/repo/skills/a-pack`; the loose `skills/x/` is not installed in its place (§1.5, §6.5)
- [ ] Given each of these repositories, `add owner/repo --skill x` selects the same skill as `add owner/repo@x` (§7.1)

**Do**:
- Decide the first by Vercel v1.7.0's walks as §5.2 describes them (`discoverSkills`, `src/skills.ts`), entering plugin members as they do; otherwise by agntc's §5.2 priority order (tasks 2-11, 2-12) (§6.5).
- Where the work lives: discovery in `src/type-detection.ts`, beside task 2-5's test of whether the search roots found anything, which already walks a member as Vercel's walk enters it; the name matching of tasks 7-3 and 7-5 in `src/commands/add.ts`.

**Context**:
> - §6.5: "A name can reach more than one skill: a loose skill and a skill inside a unit, or skills inside two units, all declaring that name. It selects the one Vercel's discovery would select: the first in priority order with each plugin member entered as Vercel's walks enter it, within that root's depth (§5.2). Where no Vercel walk reaches any of them, it selects the first in agntc's priority order, a unit's skills taking the unit's place in the order its own walk of `skills/` reaches them (§6.1). A selection that lands inside a unit is a pick from it, with this section's warning and refusal."
> - §5.2: search roots in priority order: the source root walked one level; `skills/` and the three curated folders three levels each; the 30 agent directories three levels each; `.claude-plugin`-declared directories one level; then the fallback walk. Within a walk, depth-first, a folder before its children, children in name order.
> - Task 2-5 records that the walk of `skills/` reaches `skills/pack/skills/s/` within its three levels, while the source-root walk checks a top-level member's own folder and nothing inside it.
> - Related work elsewhere: the same-name rule for what the menu offers is tasks 2-11 and 2-12; a name beside `'*'` is task 8-10.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §1.5, §5.2, §6.1, §6.5, §7.1

## vercel-skills-compatibility-8-10

### Task vercel-skills-compatibility-8-10: A name beside `'*'` that a whole-unit install covers adds no entry

**Problem**: A name beside `'*'` is still matched as any name is (§7.1), and `'*'` installs a unit whole (tasks 8-1, 8-2). A name beside `'*'` that matches a skill inside such a unit would, read as a pick (task 8-3), add a second entry for a skill the unit's install already writes: two entries writing one folder.

**Solution**: A name beside `'*'` that matches a skill inside a unit `'*'` installs whole is satisfied by that install. It adds no entry of its own, and nothing is written twice (§6.5). On a source that is a unit, `--skill '*' x` with `x` inside it installs the unit whole as its one entry. On a menu, `x` inside a plugin member that `'*'` installs whole adds no entry beside the member's. The name counts as matched, so the line is not a miss. `@x` beside `--skill '*'` behaves the same way.

**Outcome**: `'*'` together with a name inside a unit installs the unit once and adds no entry for the name.

**Acceptance Criteria**:
- [ ] Given a plugin repository with no semver tags holding `skills/a/`, `skills/x/` and `agents/reviewer.md`, when `add owner/repo --skill '*' x` runs for Claude, the manifest gains the one entry `owner/repo`, `.claude/skills/x/` is written once as part of it, no `owner/repo/x` entry is written, and the command exits 0 (§6.4, §6.5)
- [ ] Given a skills-only repository holding `skills/a/` and `skills/x/` whose root `agntc.json` declares `"type": "plugin"`, `add owner/repo --skill '*' x` installs the one bundle entry `owner/repo` and no `owner/repo/x` entry (§6.4, §6.5)
- [ ] Given a skills-only repository holding `skills/y/` and the member `skills/pack/` (holding `agents/helper.md` and `skills/x/`), `add owner/repo --skill '*' x` writes the entries `owner/repo/y` and `owner/repo/skills/pack`, with `x` installed as part of the member, and no `owner/repo/x` entry (§6.4, §6.5)
- [ ] Given each of these repositories, `add owner/repo@x --skill '*'` writes the same entries (§7.1)

**Do**:
- Where the work lives: the `'*'` reading of tasks 7-6, 8-1 and 8-2 and the name matching of tasks 7-3 and 7-5 in `src/commands/add.ts`.

**Context**:
> - §6.5: "A name beside `'*'` (§7.1) that matches a skill inside a unit `'*'` installs whole is satisfied by that install: it adds no entry of its own, and nothing is written twice. Under `--plugin` such a name is still a named skill and refuses the line (§6.6)."
> - §7.1: "`'*'` anywhere in that list means all (§6.3, §6.4). Every other name in the list is still matched as any name is: one that matches nothing refuses the line as §7.3 does, and an internal skill named beside `'*'` installs with the rest (§5.4)."
> - §6.4: `'*'` on a source that is a unit (a plugin, or a repo declaring `"type": "plugin"`) installs the whole unit; on a menu it installs each plugin member whole.
> - Related work elsewhere: `--plugin --skill '*' x` is refused (task 8-8); a name beside `'*'` that matches nothing refuses the line (task 7-8).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §6.4, §6.5, §6.6, §7.1

## vercel-skills-compatibility-8-11

### Task vercel-skills-compatibility-8-11: A miss on `add` lists the skills inside units

**Problem**: A name that matches nothing is refused with a list of what the source offers (task 7-8, §7.2). Once names reach the skills inside plugins and plugin members (task 8-3), a list of the menu's entries alone would hide skills the name could have named. An agent caller that mistyped a skill inside a unit would have nothing to correct the name from.

**Solution**: On `add`, a miss lists the skills the source offers, the skills inside its plugins and plugin members among them (§7.2). Each unit is shown with its skills, as `--list` shows it (§11.2): a source that reads as a plugin with its skills, and each plugin member by its path (`owner/repo/<path>`) with the skills inside it (§7.1). When some names match and some don't, nothing installs and each unmatched name is listed with the same alternatives (§7.3).

**Outcome**: A miss shows every skill a name could have reached, each unit's skills shown with their unit.

**Acceptance Criteria**:
- [ ] Given a plugin repository with no semver tags holding `skills/a/`, `skills/b/` and `agents/reviewer.md`, when `add owner/repo@nope` runs, it exits non-zero, writes no file and no manifest entry, and its message names `nope` and lists `a` and `b` as the plugin's skills (§1.5, §6.5, §7.2)
- [ ] Given a skills-only repository holding `skills/react/` and the top-level member `tools/` (holding `agents/helper.md`, `skills/lint/` and `skills/fmt/`), `add owner/repo --skill nope` lists `react`, and `owner/repo/tools` with `lint` and `fmt` shown under it (§7.1, §7.2)
- [ ] Given the same repository, `add owner/repo --skill lint nope` installs nothing, `lint` included, and its message names `nope` with the same list (§7.3)
- [ ] Given the same repository also holding the member `skills/review/pack/` with `skills/check/`, the list shows `owner/repo/skills/review/pack` with `check` under it (§7.1, §7.2)

**Do**:
- Where the work lives: the miss refusal of task 7-8 in `src/commands/add.ts`, over what discovery finds (`src/type-detection.ts`).

**Context**:
> - §7.2: "A name that matches nothing is refused (§1.5). The message names the unmatched name and lists the alternatives: on `add`, the skills the source offers, the skills inside its plugins and plugin members among them, since a name reaches those too (§6.5); each unit is shown with its skills as `--list` shows it (§11.2), a plugin member by its path (§7.1)".
> - §7.1: "`--list` (§11.2) and the miss message (§7.2) show each plugin member with that path."
> - §11.1 and §11.2: `--list` shows "a plugin, with its skills, agents and hooks", and plugin members "with their contents". `--list` itself is Phase 10, whose acceptance shows each unit with its skills "the way the `add` miss message does".
> - §7.3: "When some of the names given match and some don't, the whole command is refused (§1.5). ... the message lists each unmatched name with what is available."
> - Related work elsewhere: a miss read at the default branch on a bare add is task 7-11; how a member's path prints for a source not on GitHub is Phase 15 (§14.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §6.5, §7.1, §7.2, §7.3, §11.1, §11.2

## vercel-skills-compatibility-8-12

### Task vercel-skills-compatibility-8-12: A member's skill on a folder an earlier entry in the run takes is left out and named

**Problem**: A run that installs several entries from one source, whether picked from the menu or selected by `'*'` (task 8-2), can include a loose skill and a plugin member whose own `skills/x/` installs into the same folder, or two members each shipping a skill that installs into one folder (§6). Each entry is checked against the manifest and copied separately (`runCollectionPipeline`, `src/commands/add.ts`). So the later copy writes over the earlier one and both entries record the folder, and removing either would delete the other's copy.

**Solution**: Within one run, two of the source's installables never write the same path (§6). When a member's skill lands on a folder that a skill or member earlier in priority order already takes in the run, the earlier one is kept and the member's skill is left out. The output names what was left out and the member it came from. "Earlier" is §5.2's priority order (search roots as listed, depth-first, a folder's children in name order), whatever order the filesystem lists folders in. The rest of the member installs as its own entry, and the kept copy stays the earlier entry's. Picks from the menu and `'*'` alike.

**Outcome**: No two entries of one run share a skill folder: the earlier one keeps it, and the installer is told what was left out.

**Acceptance Criteria**:
- [ ] Given a skills-only repository with no semver tags holding `skills/x/` declaring `x` and the member `skills/zpack/` (holding `agents/helper.md`, `skills/x/` declaring `x` and `skills/z/`), when both are picked from the menu of `add owner/repo` for Claude, the outcome is (§5.2, §6):
  - `.claude/skills/x/` holds the loose skill's content, recorded under `owner/repo/x`;
  - `skills/zpack` installs as its own entry with `helper.md` and `z`;
  - the output names `x` as left out and `skills/zpack` as the member it came from.
- [ ] Given the same repository, `add owner/repo --skill '*'` installs and names the same way (§6, §6.4)
- [ ] Given a skills-only repository holding the members `skills/apack/` and `skills/bpack/`, each holding `agents/` and `skills/x/` declaring `x`, both picked, `.claude/skills/x/` holds `apack`'s `x` and the output names `x` and `skills/bpack`, whatever order the filesystem lists the two in (§5.2, §6)
- [ ] Given the first install, when `remove owner/repo/skills/zpack` runs, `.claude/skills/x/` stays in place with the loose skill's content; when `remove owner/repo/x` runs, it is removed (§6, §12.6)

**Do**:
- Decide "earlier" by §5.2's priority order, as tasks 3-9 and 3-10 do inside one unit, a folder's children in name order (`names.sort()` in `src/type-detection.ts`) (§5.2, §6).
- Where the work lives: the per-member pass of `runCollectionPipeline` in `src/commands/add.ts`, where each selected entry's paths are computed (`computeIncomingFiles`, `src/compute-incoming-files.ts`), checked (`runConflictChecks`) and copied (`copyUnit`, `src/copy-unit.ts`); the left-out naming task 3-9 adds to add's output (`renderCollectionAddSummary`, `src/summary.ts`).

**Context**:
> - §6: "Within one run, two of the source's installables never write the same path. This applies to every run: inside a `--plugin` bundle (§6.2), and across the entries a run installs, whether they were picked from the menu or selected by "all" (§6.4). A plugin member's skill, agent or hook can land on a path that a skill or member earlier in priority order (§5.2) already takes. Examples are two members that each ship `agents/reviewer.md`, or a member's `skills/x/` beside a loose skill installing into `x`. In that case the earlier one is kept. The output names what was left out and the member it came from, as a pick from a unit names what it leaves out (§6.5)." "This is the one case where a plugin member installs less than whole."
> - §5.2: priority order is the search roots in the order listed, then the fallback walk; depth-first within a walk, a folder before its children; a folder's children in name order. "A plugin member's place in that order is where the walk reaches it."
> - §12.6: a path a member left out at install because another entry from the same repository holds it is never in the way of the member's later update (tasks 8-16, 8-17).
> - Related work elsewhere: the same rule inside one unit is tasks 3-9 and 3-10; a member's agent or hook is task 8-13; a loose skill left out for an earlier member, and an entry left with nothing to install, are task 8-14; what counts as taken is task 8-15.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §5.2, §6, §6.4, §6.5, §12.6

## vercel-skills-compatibility-8-13

### Task vercel-skills-compatibility-8-13: A member's agent or hook on a path an earlier entry in the run takes is left out and named

**Problem**: Members installed as separate entries in one run route their agents into one `.claude/agents/` and their hooks into one `.claude/hooks/`, and two members can each ship `agents/reviewer.md` (§6). Each entry is copied separately today, so the later member's copy writes over the earlier one's and both entries record the file.

**Solution**: As for a member's skill (task 8-12), when a member's agent or hook lands on a path that a member earlier in priority order already takes in the run, the earlier copy is kept and the later member's copy is left out. The output names the file and the member it came from. Each member stays its own entry, the rest of the later member installs, and the kept copy stays the earlier entry's. Picks from the menu and `'*'` alike.

**Outcome**: Each agent and hook path is written once per run, by the entry first in priority order, and the installer is told which member's copy was left out.

**Acceptance Criteria**:
- [ ] Given a skills-only repository with no semver tags holding the top-level member `review/` (holding `agents/reviewer.md`) and the member `skills/qa/` (holding `agents/reviewer.md`, `agents/tester.md` and `skills/check/`), when both are picked from the menu of `add owner/repo` for Claude, the outcome is (§5.2, §6):
  - `.claude/agents/reviewer.md` holds `review/`'s copy, recorded under `owner/repo/review`;
  - `skills/qa` installs as its own entry with `tester.md` and `check`;
  - the output names `reviewer.md` as left out and `skills/qa` as the member it came from.
- [ ] Given the two members each shipping `hooks/pre-commit.sh` instead, `.claude/hooks/pre-commit.sh` holds `review/`'s copy, and the output names `pre-commit.sh` and `skills/qa` the same way (§6)
- [ ] Given the first repository, `add owner/repo --skill '*'` installs and names the same way (§6, §6.4)
- [ ] Given the first install, when `remove owner/repo/skills/qa` runs, `.claude/agents/reviewer.md` stays in place with `review/`'s copy; when `remove owner/repo/review` runs, it is removed (§6, §12.6)

**Do**:
- Decide "earlier" as task 8-12 does, by §5.2's priority order (§5.2, §6).
- Where the work lives: the places task 8-12 names, and the agent and hook copy in `copyPluginAssets` (`src/copy-plugin-assets.ts`).

**Context**:
> - §6: "A plugin member's skill, agent or hook can land on a path that a skill or member earlier in priority order (§5.2) already takes. Examples are two members that each ship `agents/reviewer.md` ... In that case the earlier one is kept. The output names what was left out and the member it came from". The rule applies "across the entries a run installs, whether they were picked from the menu or selected by "all" (§6.4)".
> - §5.2: the source-root walk, which reaches top-level members, comes before the walk of `skills/`.
> - Agents and hooks are routed for Claude only, into `.claude/agents/` and `.claude/hooks/`.
> - Related work elsewhere: the same rule inside one unit is task 3-10; a member every one of whose skills, agents and hooks lands on a taken path is skipped (task 8-14); a member installed without Claude takes no path in `.claude/agents/` or `.claude/hooks/` (task 8-15).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §5.2, §6, §6.4, §12.6

## vercel-skills-compatibility-8-14

### Task vercel-skills-compatibility-8-14: A loose skill on a folder an earlier member takes is left out, and an entry left with nothing is skipped

**Problem**: The same-path rule holds whichever comes first (§6). The source-root walk reaches a top-level member `pack/` before the walk of `skills/` (§5.2). So when `pack/`'s `skills/x/` lands in `x` and a loose `skills/x/` declaring `x` is picked too, it is the loose skill that has nowhere to go. A loose skill is only its folder, so it is left with nothing to install. A member whose every skill, agent and hook lands on a taken path is left the same way. Recorded as installed, such an entry would claim files another entry owns, and a run that installed less than it was asked for would read as success.

**Solution**: A loose skill whose install folder a member earlier in priority order takes is left out, and the output names it with the member that takes its folder (§6). Across the entries of a run, a picked entry left with nothing to install is skipped with a message. No manifest entry is written for it, the run's other entries install, and the command exits non-zero, as §8.2 skips a unit left with no agent. A member every one of whose skills, agents and hooks lands on a taken path is skipped the same way. A skill left out for only some of its agents, because an earlier entry takes its folder for those agents alone, installs for the rest and still records every agent it was named for. Its left-out path is handled on update as a member's is (tasks 8-16, 8-17). Picks from the menu and `'*'` alike.

**Outcome**: A run never records an entry that installed nothing, and a run that left an entry with nothing exits non-zero.

**Acceptance Criteria**:
- [ ] Given a skills-only repository with no semver tags holding the top-level member `pack/` (holding `agents/helper.md` and `skills/x/` declaring `x`), the loose `skills/x/` declaring `x` and the loose `skills/y/`, when `pack`, `x` and `y` are picked from the menu of `add owner/repo` for Claude, the outcome is (§5.2, §6):
  - `.claude/skills/x/` holds `pack/`'s `x`, recorded under `owner/repo/pack`, and `y` installs as `owner/repo/y`;
  - the output names the loose `x` as left out with `pack` as the member that takes its folder, and says the loose `x` was skipped;
  - no `owner/repo/x` entry is written, and the command exits non-zero.
- [ ] Given the same repository, `add owner/repo --skill '*'` installs, names and exits the same way (§6, §6.4)
- [ ] Given a skills-only repository holding the loose `skills/x/` declaring `x` and the skill pack `skills/zpack/` holding only `skills/x/` declaring `x`, when both are picked, the loose `x` installs, `skills/zpack` is skipped with a message and no manifest entry, and the command exits non-zero (§6)
- [ ] Given the first repository with `pack/agntc.json` listing `agents: ["claude"]`, when `pack` and `x` are picked and Claude and Codex are ticked, `pack/`'s `x` installs into `.claude/skills/x/`, the loose `x` installs into `.agents/skills/x/` only, the entry `owner/repo/x` records Claude and Codex, and the output names the loose `x`'s Claude copy as left out with `pack` (§6, §8.4)

**Do**:
- Skip an entry left with nothing the way the multi-unit path skips a member with no agent today ("skipped — author restricts to …", `runCollectionPipeline` in `src/commands/add.ts`), with the non-zero exit §8.2 gives it (§6, §8.2).
- Where the work lives: the places task 8-12 names, and the run's exit accounting in `runCollectionPipeline` (`src/commands/add.ts`).

**Context**:
> - §6: "The rule holds whichever comes first. A loose skill whose install folder a member earlier in priority order already takes is left out the same way: `skills/x/` declaring `x`, beside a top-level member `pack/` whose `skills/x/` lands in `x`, is named as left out with the member that takes its folder. Across the entries of a run, a picked entry left with nothing to install is skipped with a message, and the command exits non-zero, as §8.2 skips a unit left with no agent. A skill left out for only some of its agents, because an earlier entry takes its folder for those agents alone, installs for the rest and still records every agent it was named for; the paths it left out are handled on update as a member's are."
> - §8.2: "A unit whose ceiling excludes every named agent is skipped with a message. The other units install, and the command exits non-zero so a calling agent sees the partial result."
> - §8.4: agntc never drops an agent the installer named; it grounds a partly left-out skill still recording every agent it was named for.
> - §5.2: the source-root walk, which reaches top-level members, comes before the walk of `skills/`.
> - Related work elsewhere: what counts as taken is task 8-15; the later update of a left-out path is tasks 8-16 and 8-17; under `--json` such an entry is `skipped` (Phase 12).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §5.2, §6, §6.4, §8.2, §8.4, §12.6

## vercel-skills-compatibility-8-15

### Task vercel-skills-compatibility-8-15: A path is taken only where an earlier entry writes it in the run

**Problem**: The same-path rule leaves out what an earlier entry takes (tasks 8-12 to 8-14). An earlier entry may write nothing, skipped because its ceiling excludes every chosen agent or because the installer declined a clash prompt, or may write only some agents' paths. Counting such paths as taken would leave a later entry's copy out for a folder or file nobody writes, and that skill, agent or hook would be installed nowhere (§6).

**Solution**: A path is taken only where an earlier installable writes it in the run (§6). An earlier entry the run skips, or leaves out after a declined "Remove <key> and continue" or untracked-files prompt, writes nothing and takes no path. An entry installed for some agents takes only those agents' paths: Codex's `.agents/skills/x` does not take Claude's `.claude/skills/x`, and a member installed without Claude takes no path in `.claude/agents/` or `.claude/hooks/`.

**Outcome**: The same-path rule leaves a copy out only where another entry of the run actually writes that path.

**Acceptance Criteria**:
- [ ] Given a skills-only repository with no semver tags holding the top-level member `pack/` (holding `skills/x/` declaring `x`, with its own `agntc.json` listing `agents: ["cursor"]`) and the loose `skills/x/` declaring `x`, when both are picked from the menu and only Claude is ticked, `pack` is skipped as restricted to Cursor and the loose `x` installs into `.claude/skills/x/` (§6, §8.2)
- [ ] Given that repository with no `agntc.json` in `pack/` and with `pack/` also holding `agents/helper.md`, while untracked files sit at `.claude/agents/helper.md`, when both are picked for Claude and the untracked-files prompt is declined, `pack` writes nothing and the loose `x` installs into `.claude/skills/x/`; the same holds when another repository's entry holds `.claude/agents/helper.md` and "Remove <key> and continue" is declined (§6, §10.1)
- [ ] Given `pack/agntc.json` listing `agents: ["codex"]`, when both are picked and Claude and Codex are ticked, `pack/`'s `x` installs into `.agents/skills/x/` and the loose `x` installs into `.claude/skills/x/` (§6)
- [ ] Given a skills-only repository holding the top-level member `review/` (holding `agents/reviewer.md` and `skills/r/`, with its own `agntc.json` listing `agents: ["codex"]`) and the member `skills/qa/` (holding `agents/reviewer.md`), when both are picked and Claude and Codex are ticked, `review` installs for Codex and `skills/qa`'s `reviewer.md` installs into `.claude/agents/reviewer.md` (§6)

**Do**:
- Where the work lives: the per-member pass of `runCollectionPipeline` (`src/commands/add.ts`), with its ceiling filter and its conflict prompts (`runConflictChecks`, with `resolveCollisions` in `src/collision-resolve.ts` and `resolveUnmanagedConflicts` in `src/unmanaged-resolve.ts`), and the same-path check of tasks 8-12 to 8-14.

**Context**:
> - §6: "A path is taken only where an earlier installable writes it in this run. An earlier entry the run skips, stops, or leaves out after a declined clash prompt writes nothing and takes no path. An entry installed for some agents takes only those agents' paths: Codex's `.agents/skills/x` does not take Claude's `.claude/skills/x`, and a member installed without Claude takes no path in `.claude/agents/` or `.claude/hooks/`."
> - §10.1: the clash prompts are "Remove <key> and continue" (`src/collision-resolve.ts`) and "Overwrite all", confirmed twice (`src/unmanaged-resolve.ts`). Declining or cancelling leaves every existing install and file as it was.
> - Agents and hooks are routed for Claude only; Codex and Cursor take skills alone.
> - Related work elsewhere: an entry an unattended run stops for what is in its way (§10.3) takes no path either (Phase 11).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §6, §8.2, §10.1, §10.3

## vercel-skills-compatibility-8-16

### Task vercel-skills-compatibility-8-16: An update leaves out what a member left out at install while another entry from the same repository holds it

**Problem**: A plugin member, or a skill, that the same-path rule left less than whole at install (tasks 8-12 to 8-14) is reinstalled from its source on every update (`executeNukeAndReinstall`, `src/nuke-reinstall-pipeline.ts`), and the source still holds what it left out. Re-copied, that skill, agent or hook would write over the copy another entry from the same repository holds. Met by update's checks for what is in the way (tasks 4-10, 4-11) instead, it would stop the entry on every update, and only `--overwrite` would get past, by removing the entry that rightly holds the path (§6, §12.6).

**Solution**: An update of such an entry leaves out the same paths for as long as another entry from the same repository holds them, and its output names them again (§6). Such a path is never treated as in the way: the update needs no `--overwrite`, and `update --overwrite` leaves the holder as it is (§12.6). This holds for a skill folder, an agent and a hook a member left out, and for the path a skill left out for some of its agents, which reinstalls for the rest and still records every agent it was named for (§6, §8.4). The holder counts as from the same repository whatever form its entry recorded (§4.3). Only paths left out at install are exempt: a path the entry gained upstream since install that another entry holds is in the way, as any path the entry did not own before is (§12.6). Single-key updates and `update` with no argument alike.

**Outcome**: An entry installed less than whole updates without disturbing the entry that holds what it left out, and says again what it left out.

**Acceptance Criteria**:
- [ ] Given a skills-only repository with no semver tags holding `skills/x/` declaring `x` and the member `skills/zpack/` (holding `agents/helper.md`, `skills/x/` declaring `x` and `skills/z/`), both installed for Claude in one run so that `zpack`'s `x` was left out (task 8-12), when `skills/zpack/` changes upstream and `update owner/repo/skills/zpack` runs, the outcome is (§6, §12.6):
  - `helper.md` and `z` reinstall at the new commit under `owner/repo/skills/zpack`;
  - `.claude/skills/x/` keeps the loose skill's content, and `owner/repo/x`'s entry still records it;
  - the output names `x` as left out again, and the command exits 0.
- [ ] Given the same install, `update` with no argument leaves `x` out of `owner/repo/skills/zpack` and names it the same way, exiting 0 with `.claude/skills/x/` holding the loose skill's content (§6)
- [ ] Given the same install, `update owner/repo/skills/zpack --overwrite` leaves `owner/repo/x`'s entry and `.claude/skills/x/` as they were, and still leaves `x` out and names it (§6, §12.6)
- [ ] Given the top-level member `review/` (holding `agents/reviewer.md`) and the member `skills/qa/` (holding `agents/reviewer.md`, `agents/tester.md` and `skills/check/`) installed in one run so that `qa`'s `reviewer.md` was left out (task 8-13), when `skills/qa/` changes upstream and `update owner/repo/skills/qa` runs without `--overwrite`, `.claude/agents/reviewer.md` keeps `review/`'s copy, the output names `reviewer.md` as left out, and the command exits 0; the same holds for a `hooks/pre-commit.sh` both members ship (§6, §12.6)
- [ ] Given the top-level member `pack/` (holding `skills/x/` declaring `x`, with its own `agntc.json` listing `agents: ["claude"]`) and the loose `skills/x/` installed in one run for Claude and Codex, so that the loose `x` went into `.agents/skills/x/` only (task 8-14), when `skills/x/` changes upstream and `update owner/repo/x` runs, `.agents/skills/x/` takes the new content, `.claude/skills/x/` keeps `pack/`'s copy, the output names the Claude copy as left out, and `owner/repo/x` still records Claude and Codex (§6, §8.4)
- [ ] Given the first install with `owner/repo/x`'s entry recording its source as `git@github.com:owner/repo.git`, `update owner/repo/skills/zpack` still leaves `x` out and names it, without stopping (§4.3, §6)
- [ ] Given the first repository also holding the top-level member `review/` (holding `agents/reviewer.md`), installed in the same run, when upstream adds `skills/zpack/agents/reviewer.md` and `update owner/repo/skills/zpack` runs without `--overwrite`, the update stops that entry with its install and `review/`'s copy intact, says `reviewer.md` is in the way, names `--overwrite`, and exits non-zero (§12.6)

**Do**:
- Judge "another entry from the same repository" by §4.3's repository identity, as task 6-3 does (§4.3).
- Meet a path the entry gained since install with update's checks for what is in the way (tasks 4-10, 4-11); the exemption reaches only the paths left out at install (§12.6).
- Where the work lives: `executeNukeAndReinstall` and `replayRecordedPlugin` in `src/nuke-reinstall-pipeline.ts`, with the update checks of tasks 4-10, 4-11 and 4-13; the manifest (`ManifestEntry`, `src/manifest.ts`), where agntc keeps what `update` needs to replay an install (§1.2); the update output in `src/commands/update.ts` and `src/update-render.ts`.

**Context**:
> - §6: "A later update of such a member, or of a skill that left out a path, leaves out the same paths for as long as another entry from the same repository holds them, and its output names them again. Such a path is never treated as in the way (§12.6)."
> - §12.6: an update writes into a path it did not own before when, among other cases, "the source gains a skill, agent or hook the entry takes in (§6.2)", and the target may already be occupied, including "by another entry's same-named skill". "A path a plugin member or a skill left out at install because another entry from the same repository holds it (§6) is not one of these while that entry holds it." Otherwise: "Without `--overwrite`: `update` stops that entry and leaves the existing install intact. It says why and exits non-zero."
> - §4.3: "Two sources name the same repository when host and repository path match, whatever form names them: `owner/repo`, its https URL and its SSH address are one repository."
> - §1.2 puts in scope whatever agntc must record so `update` and `remove` keep working on what the new syntax installs.
> - §8.4: agntc never drops an agent the installer named.
> - Related work elsewhere: the update once no entry from the same repository holds the path is task 8-17; update's checks for what is in the way are tasks 4-10 to 4-13.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §4.3, §6, §8.4, §12.6

## vercel-skills-compatibility-8-17

### Task vercel-skills-compatibility-8-17: An update installs a left-out path once no entry from the same repository holds it

**Problem**: The exemption of task 8-16 lasts only while another entry from the same repository holds the path (§6). Once that holder is removed, an update that kept leaving the path out would keep the entry less than whole for good. Once free, the path may also be occupied again, by an install from another repository or by untracked files, and an update that wrote into it unchecked would replace them without saying so (§12.6).

**Solution**: Once no entry from the same repository holds a left-out path, the next update installs it, meeting it as it meets any path the entry did not own before (§6, §12.6). The path joins the entry's install, and the output stops naming it as left out. An install from another repository or untracked files then occupying the path are in the way. Without `--overwrite` the update stops that entry, leaves the existing install intact, says why and exits non-zero. With `--overwrite` it replaces what is in the way, removing a clashing managed install as "Remove <key> and continue" removes it and overwriting untracked files, and installs the path (§10.3, §12.6). A skill folder, an agent and a hook alike, and the path a skill left out for some of its agents (§6).

**Outcome**: An entry left less than whole becomes whole at its next update after the holder goes, and never by silently replacing what took the path in the meantime.

**Acceptance Criteria**:
- [ ] Given a skills-only repository with no semver tags holding `skills/x/` declaring `x` and the member `skills/zpack/` (holding `agents/helper.md`, `skills/x/` declaring `x` and `skills/z/`), both installed for Claude in one run so that `zpack`'s `x` was left out (task 8-12), when `remove owner/repo/x` runs, `skills/zpack/` changes upstream and `update owner/repo/skills/zpack` runs, the outcome is (§6):
  - `zpack`'s `x` installs into `.claude/skills/x/`, recorded under `owner/repo/skills/zpack`;
  - the output no longer names `x` as left out, and the command exits 0;
  - a later `remove owner/repo/skills/zpack` removes `.claude/skills/x/`.
- [ ] Given the top-level member `review/` (holding `agents/reviewer.md`) and the member `skills/qa/` (holding `agents/reviewer.md`, `agents/tester.md` and `skills/check/`) installed in one run so that `qa`'s `reviewer.md` was left out (task 8-13), when `remove owner/repo/review` runs, `skills/qa/` changes upstream and `update owner/repo/skills/qa` runs, `qa`'s `reviewer.md` installs into `.claude/agents/reviewer.md` under `owner/repo/skills/qa`; the same holds for a left-out `hooks/pre-commit.sh` (§6)
- [ ] Given the loose `owner/repo/x` installed into `.agents/skills/x/` only because `owner/repo/pack` took `.claude/skills/x/` in the same run (task 8-14), when `remove owner/repo/pack` runs, `skills/x/` changes upstream and `update owner/repo/x` runs, `x` installs into both `.claude/skills/x/` and `.agents/skills/x/`, and the output no longer names the Claude copy as left out (§6)
- [ ] Given `owner/repo/x` and `owner/repo/skills/zpack` installed as in the first scenario, when `remove owner/repo/x` runs, `add other/skills@x` installs another repository's `x` into `.claude/skills/x/`, `skills/zpack/` changes upstream and `update owner/repo/skills/zpack` runs without `--overwrite`, the outcome is (§6, §10.3, §12.6):
  - `owner/repo/skills/zpack` and its files stay as they were;
  - `other/skills/x` and `.claude/skills/x/` are unchanged;
  - the message says what is in the way and names `--overwrite`, and the command exits non-zero.
- [ ] Given untracked files at `.claude/skills/x/` in place of `other/skills/x`, the update stops the same way and leaves the files as they were (§6, §12.6)
- [ ] Given either occupant, `update owner/repo/skills/zpack --overwrite` installs `zpack`'s `x` into `.claude/skills/x/` under `owner/repo/skills/zpack`: the entry `other/skills/x` is removed with its files, or the untracked files are overwritten (§10.3, §12.6)

**Do**:
- Meet the freed path with update's checks for what is in the way of a path the entry did not own before (tasks 4-10, 4-11), and replace what is in the way under `--overwrite` as task 4-13 does (§10.3, §12.6).
- Where the work lives: the places task 8-16 names.

**Context**:
> - §6: "Once no entry from the same repository holds it, the next update installs it, meeting it as it meets any path the entry did not own before (§12.6): an install from another repository or untracked files then occupying it are in the way, and without `--overwrite` the update stops that entry."
> - §12.6: "Without `--overwrite`: `update` stops that entry and leaves the existing install intact. It says why and exits non-zero. This is the partial success across entries that `update` reports today." "With `--overwrite`: `update` replaces what is in the way."
> - §10.3: "With `--overwrite`: what is in the way is replaced, and no clash prompt is shown. A clashing managed install is removed, as "Remove <key> and continue" removes it. Untracked files are overwritten."
> - "From the same repository" is §4.3's repository identity, as in task 8-16.
> - Related work elsewhere: the exemption while the path is held is task 8-16; update's checks for what is in the way are tasks 4-10 to 4-13.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §6, §10.3, §12.6
