# Plan: Vercel Skills Compatibility

## Phases

### Phase 1: Skills install as skills, under their declared names
status: draft

**Goal**: `add` reads each skill's SKILL.md frontmatter and installs it as Vercel names it. A skill folder (even one carrying its own `agents/`) installs as a skill, into a folder named by its sanitized declared name, under exactly one manifest key however it was selected.

**Why this order**: Declared-name identity and the skill-versus-plugin classification are the model every later phase selects against, displays, migrates and prints. Doing this first also fixes the most damaging breakage: a skill carrying `agents/` silently becomes subagents and is lost. It works on today's one-level membership scan, so it stands alone.

**Acceptance**:
- [ ] Given a repo whose member folder `taste-skill` has a SKILL.md declaring `name: design-taste-frontend`, when it is picked from the `add` menu for Claude, it lands in `.claude/skills/design-taste-frontend/` under manifest key `owner/repo/design-taste-frontend`, and a later `update` reinstalls it from `taste-skill` into the same folder
- [ ] Given a skill whose SKILL.md has no frontmatter, no string `name`, YAML that fails to parse, or a non-YAML fence, when it is added, it installs under its folder name with no warning
- [ ] Given a skill folder holding SKILL.md beside `agents/` (e.g. `agents/openai.yaml`), when it is added, the whole folder including `agents/` lands in the agent's skills directory, nothing is written to `.claude/agents/`, and the manifest records a skill
- [ ] Given a folder holding SKILL.md beside `skills/` and `agents/`, or SKILL.md beside `agents/` with `agntc.json` declaring `"type": "plugin"`, when it is added, it installs as a plugin with its agents routed to `.claude/agents/` and the root SKILL.md not installed
- [ ] Given skills declaring `../x`, `My Skill!!` and `---`, when each is installed, they land in `x`, `my-skill` and `unnamed-skill` inside the agent's skills directory and never outside it
- [ ] Given a skill installed from the menu, when the same skill is re-added through a GitHub tree URL to its folder, the manifest still holds one entry under `owner/repo/<folder>`
- [ ] Given a skills-only repo whose `skills/foo/` holds `agents/` and no SKILL.md, when it is picked from the menu, it installs whole under key `owner/repo/skills/foo`
- [ ] Given a repo with a root SKILL.md declaring `name: foo-skill`, when it is added, it installs into `.claude/skills/foo-skill/` under key `owner/repo`
- [ ] Given a declared name containing terminal escape sequences, when `add` prints it, escapes and control characters are stripped; given frontmatter using a YAML tag that would construct an object or run code, the skill installs and nothing in it executes
- [ ] Given existing plugin, root-skill and collection sources, when they are added and updated, they behave as before apart from folder naming

### Phase 2: Discovery finds skills where Vercel's does
status: draft

**Goal**: `add`'s menu offers every skill Vercel's discovery would find: category-nested skills, `.curated`/`.experimental`/`.system`, agent directories, plugin manifests, the five-level fallback and `--full-depth`. Plugin members are offered whole and internal skills are hidden. A source with nothing installable is refused.

**Why this order**: Extends Phase 1's skill model to every place Vercel looks. Dedup by declared name and the internal flag both come from Phase 1's frontmatter reading. Bundles, selection and the pre-install summary all build on the member set discovery produces.

**Acceptance**:
- [ ] Given a category-nested repo (`skills/<category>/<skill>/SKILL.md`, the shape of `mattpocock/skills`), when `add` runs, the menu offers every skill by declared name and a picked skill installs flat in its own folder (today: "Cancelled — no plugins selected", exit 0)
- [ ] Given skills only under `skills/.curated/`, under one of Vercel's agent directories such as `.claude/skills/`, or in a directory declared in `.claude-plugin/marketplace.json`, when `add` runs, the menu offers them
- [ ] Given a source whose own `skills-lock.json` records a skill in its own `.claude/skills/`, when `add` runs, that skill is not offered
- [ ] Given a source whose search roots find nothing and whose only SKILL.md sits four folders deep, when `add` runs, the fallback walk offers it; given `--full-depth` on a repo with a root SKILL.md and nested skills, the menu offers the nested skills (including one nested inside another skill's folder) instead of installing the root as a single skill
- [ ] Given two skills declaring the same name, the menu offers only the one first in priority order; given `skills/build/SKILL.md`, it is offered; skills reachable only through `node_modules/` or a symlinked directory are not
- [ ] Given a non-hidden folder with `skills/`, `agents/` or `hooks/` and no SKILL.md, the menu offers it as one entry and picking it installs it whole with agents and hooks routed; nothing under `.git/` is ever offered; given a tree URL naming such a folder (including a skills-only pack), it installs that member whole without a menu
- [ ] Given a skill whose frontmatter sets `metadata.internal: true`, it is absent from the menu
- [ ] Given a source where discovery finds nothing installable, when `add` runs, it exits non-zero, writes nothing, and says nothing installable was found
- [ ] Given a skill installed from a category-nested repo, when `update` runs after the source changes, it reinstalls from that skill's folder

### Phase 3: `--plugin` bundles everything discovery finds
status: draft

**Goal**: `--plugin` and `"type": "plugin"` bundle a whole source as one entry. Every discovered skill installs flat in its own folder, internal skills included, and plugin members' skills, agents and hooks are routed to their places. The bundle installs within every ceiling it holds, refuses only the shapes §6.6 refuses, and re-derives its contents on every update.

**Why this order**: A bundle is defined as every skill discovery finds, so this follows Phase 2 directly. It fixes what a bundle holds before Phase 4 migrates installs onto it and before Phase 7 decides how picks meet bundles.

**Acceptance**:
- [ ] Given a category-nested skills-only repo, when added with `--plugin`, the manifest gains one entry, every discovered skill (internal ones included) lands flat in its own declared-name folder, and no category folder appears in any agent's skills directory
- [ ] Given a tree URL to one category folder with `--plugin`, the bundle holds only that folder's skills
- [ ] Given a source with plugin member folders at its top level (today refused "collection of N members — cannot bundle"), when added with `--plugin` or with `agntc.json` declaring `"type": "plugin"`, it installs as one entry with each member's skills in the skills directory, agents in `.claude/agents/` and hooks in `.claude/hooks/`
- [ ] Given a bundle in which one member's `agntc.json` restricts to Claude, when Claude and Cursor are chosen, the bundle installs for Claude only and the output names Cursor as left out
- [ ] Given a lone root SKILL.md, or a root SKILL.md beside `agents/` with no `"type": "plugin"`, when added with `--plugin`, the command exits non-zero, writes nothing and names the refusal; given a root SKILL.md beside `skills/` alone, `--plugin` bundles the skills under `skills/` without the root SKILL.md; given a plugin, `--plugin` changes nothing
- [ ] Given an installed bundle whose source has since gained one skill and lost another, when `update` runs, the new skill is installed, the removed skill's files are gone, and the manifest still holds one entry

### Phase 4: Existing installs move to their new shape
status: draft

**Goal**: Installs recorded under the old rules reach their new shape on their next update or re-add: a declared-name folder and key for skills, a path key for plugin members, and skill shape for SKILL.md-plus-`agents/` installs recorded as plugins. Nothing is duplicated and no agent is lost. `update` stops on an occupied target unless given `--overwrite`, and a re-add never drops a recorded agent.

**Why this order**: Identity, classification and bundle contents are final after Phases 1–3, so existing installs migrate once, onto the finished model. Doing it before the syntax phases means every later phase works with a single identity model, and it closes the window in which a re-add could create a second copy.

**Acceptance**:
- [ ] Given an install in `.claude/skills/composition-patterns/` keyed `owner/repo/composition-patterns` whose SKILL.md declares `vercel-composition-patterns`, and no newer version upstream, when `update` runs (by key, with no argument, or from `list`), the files move to `.claude/skills/vercel-composition-patterns/`, the entry is re-keyed `owner/repo/vercel-composition-patterns`, the old folder is gone, and the recorded version is unchanged
- [ ] Given such an entry pinned to an exact tag, or whose newer tags all fall outside its constraint, when `update` runs, it moves at its current version and keeps its pin or constraint
- [ ] Given a plugin member recorded under its folder name, when `update` runs, its entry is re-keyed `owner/repo/<path>`
- [ ] Given an entry recorded as a plugin whose source has a SKILL.md at its unit root, no `skills/` there, and no `"type": "plugin"`, when `update` runs, it reinstalls as a skill (its `agents/` inside the skill folder, its former `.claude/agents/` copies gone), moves to its declared-name folder, and the output says it was repaired; a genuine plugin updates unchanged
- [ ] Given an update whose target folder is occupied by untracked files or by another entry's same-named skill, when `update` runs without `--overwrite`, that entry stops with its install intact, the message names `--overwrite`, other entries proceed, and the command exits non-zero; with `update --overwrite`, the occupant is replaced
- [ ] Given a skill installed under its old folder and key, when the same skill is re-added from the same repository, it moves to its declared-name folder and key, keeps every recorded agent, and no second copy is created
- [ ] Given a Claude install, when it is re-added choosing only Cursor at the agent prompt, Claude's copy stays and the entry records both agents; when it is re-added at another version, it reinstalls for every recorded agent

### Phase 5: Vercel's source forms and hosts
status: draft

**Goal**: `add` accepts and correctly clones every Vercel source form: path shorthand, `github:`/`gitlab:` prefixes, GitHub tree URLs with an optional path, GitLab nested groups and `/-/tree/`, Azure Repos `_git`, `GH_HOST`, and SSH/`ssh://`/`.git` URLs with their whole path. It reads https URLs in Vercel's order and refuses out-of-scope forms by name. `update` and `remove` keep working on what these forms install.

**Why this order**: Additive parsing work that doesn't depend on selection. It comes before the `@`/`#` change so the `owner/repo/<path>` form already exists when Phase 6's miss messages print it and Phase 7's paths into units rely on it.

**Acceptance**:
- [ ] Given `owner/repo/skills/foo` (today refused as "too many slashes"), when added, it installs the skill at that path; given a path that escapes the repo with `..`, the command exits non-zero and writes nothing
- [ ] Given `github:owner/repo` and `gitlab:owner/repo`, each clones from its host; given `https://github.com/owner/repo/tree/main` with no path, it installs from `main`
- [ ] Given `https://gitlab.com/group/subgroup/repo`, it clones `group/subgroup/repo`; given a GitLab `/-/tree/<ref>/<path>` URL or an Azure Repos `_git` URL with `?path=` and `?version=`, it installs that path at that ref with no constraint recorded
- [ ] Given `GH_HOST=ghe.example.com`, `https://ghe.example.com/owner/repo` clones as a GitHub source
- [ ] Given `git@gitlab.com:group/subgroup/repo.git`, it clones that full path (today `group/subgroup.git`); given `ssh://git@github.com/owner/repo.git`, it clones over SSH as given; given `https://git.example.com/team/repo.git`, it clones that URL
- [ ] Given a raw.githubusercontent.com, codeload.github.com or objects.githubusercontent.com link, a github.com `/archive/`, `/raw/` or `/releases/download/` link, or a gitlab.com `/-/archive/` or `/-/raw/` link, the command exits non-zero naming direct-download links as unsupported and clones nothing; given `https://example.com/owner/repo` (no `.git`), a skills.sh pack link or a Notion source, it exits non-zero naming that source kind as unsupported
- [ ] Given entries installed from a GitLab nested-group URL, an Azure Repos URL and an SSH address, when `update` and `remove` run on them, they act on that same repository

### Phase 6: `@` selects skills; versions move to `#`
status: draft

**Goal**: `@` and `-s/--skill` select skills by declared name: case-insensitive and exact, `'*'` for all, internal skills when named. `#` carries constraints, tags and branches, including `#ref@skill`. A bare add falls back to the default branch when the newest tag lacks the pick. Any unmatched name refuses the whole line and lists what's available.

**Why this order**: `@` can only become a skill selector once there are declared names to match (Phases 1–2) and path forms to list plugin members by (Phase 5). The version suffix moves to `#` in the same phase so no version line, and no upgrade advice agntc prints, is left without an accepted form.

**Acceptance**:
- [ ] Given a repo whose folder `taste-skill` declares `design-taste-frontend`, when `add owner/repo@Design-Taste-Frontend` runs, that skill alone installs with no member prompt
- [ ] Given `add owner/repo@a --skill b c`, exactly `a`, `b` and `c` install as separate entries; given `--skill '*'` on a skills-only repo, every non-internal skill installs as its own entry; given `--skill <internal-skill>`, that internal skill installs
- [ ] Given `owner/repo#^1.0`, the best matching tag installs and `^1.0` is recorded; `#v2.0.0` installs that tag with no constraint; `#main` installs that branch; `owner/repo#v2.0.0@skill` installs that skill at that tag
- [ ] Given `owner/repo@v2.0.0` or `owner/repo@^1.0` where no skill has that name, the command exits non-zero, installs nothing, and points at `owner/repo#v2.0.0`
- [ ] Given `--skill nope`, the command exits non-zero naming `nope` and listing the skills the source offers, with plugin members shown as `owner/repo/<path>`; given `--skill real nope`, nothing installs and the message lists `nope` with the alternatives
- [ ] Given a bare `add owner/repo@new-skill` where the newest tag lacks `new-skill` but the default branch has it, it installs from the default branch, says so, and records no constraint; the same holds when the newest tag holds nothing installable
- [ ] Given an exact-pinned entry with newer tags, when `update` prints its upgrade advice (single key or all-mode), the version appears after `#`, never after `@`

### Phase 7: Picks and "all" meet units
status: draft

**Goal**: Vercel's selection meets agntc's units. "All" never splits a unit. A named pick or a path that lands inside a unit installs that skill alone, with a warning naming what's left out, within the unit's ceiling. `"type": "plugin"` and `--plugin` refuse a named pick.

**Why this order**: Picks need name selection (Phase 6) and path forms (Phase 5). This phase defines how those picks meet the units and bundles settled in Phases 1–3.

**Acceptance**:
- [ ] Given a plugin source, or one declaring `"type": "plugin"`, when added with `--skill '*'`, the whole unit installs as one entry with its agents and hooks
- [ ] Given a menu mixing loose skills and plugin members, when added with `--skill '*'`, each skill installs as its own entry and each plugin member installs whole
- [ ] Given `owner/repo@x` where `x` sits inside a plugin or plugin member that declares no `"type": "plugin"`, `x` alone installs as a skill, a warning names the agents, hooks and other skills left out, and the agent prompt offers only the unit's ceiling
- [ ] Given the same pick when the unit's `agntc.json` declares `"type": "plugin"`, the command exits non-zero, installs nothing, and names the whole-unit install instead
- [ ] Given a path landing inside a unit (`owner/repo/skills/x`, a tree URL to that folder, or `owner/repo/skills`), it installs as a pick with the same warning and is refused when the unit declares `"type": "plugin"`; with `--plugin`, a path at one skill is refused while a path at a folder of skills bundles that folder
- [ ] Given `--plugin` with `--skill x` or `@x`, the command exits non-zero naming the conflict; given `--plugin` with `--skill '*'`, the whole bundle installs

### Phase 8: Naming target agents with `-a`
status: draft

**Goal**: `-a/--agent` names target agents in Vercel's or agntc's spellings (variadic, repeatable, `'*'`) and refuses agents agntc doesn't drive. Each unit installs within its author's ceiling. A single-unit run is refused when the ceiling excludes every named agent; a multi-unit run skips that unit and exits non-zero.

**Why this order**: The ceiling rules can only be exercised fully once agents are named explicitly. Multi-unit runs rely on Phase 6's multiple names, and Phase 7's picks inherit a unit's ceiling. Unattended runs in Phase 10 target detected agents through the same ceilings.

**Acceptance**:
- [ ] Given `-a claude-code cursor`, `-a claude`, `-a codex -a cursor` or `-a '*'`, the install targets exactly those agents (all three for `'*'`) with no agent prompt
- [ ] Given `-a windsurf`, the command exits non-zero, writes nothing, and lists Claude, Codex and Cursor as the agents agntc drives
- [ ] Given a unit whose `agntc.json` restricts to Claude, when added with `-a claude cursor`, it installs for Claude only and the output names Cursor as left out; with `-a cursor` alone, the command exits non-zero and writes nothing
- [ ] Given a pick inside a unit restricted to Claude, when added with `-a cursor`, the command exits non-zero and writes nothing
- [ ] Given a run installing several entries where one is restricted to Claude, when added with `-a cursor`, the others install, that entry is skipped with a message, and the command exits non-zero (today 0)
- [ ] Given a Claude install, when re-added with `-a cursor`, Cursor is added and Claude's copy stays

### Phase 9: Pre-install summary and `--list`
status: draft

**Goal**: After cloning, an attended `add` shows the source and version, the detected shape, each skill's name and description, any hooks, and the target agents. It then asks "Proceed with installation?" before anything is deleted or written. `-l/--list` prints the same listing, installs nothing and needs no terminal.

**Why this order**: The display draws on shape and names (Phases 1–3), versions and the default-branch fallback (Phase 6) and target agents (Phase 8). It introduces the final confirmation that Phase 10's `-y` answers.

**Acceptance**:
- [ ] Given a bare `add owner/repo` at a terminal, after cloning it shows the source and resolved tag (or the default branch, naming the fallback when it applied), the detected shape, each skill's name and one-line description, and the target agents, then asks "Proceed with installation?"; answering no writes nothing and leaves existing installs as they were
- [ ] Given a single skill, or a plugin whose one declared agent is detected, the confirmation is still asked though no other prompt is shown
- [ ] Given a plugin, the summary lists its skills, agents and hooks by name; plugin members in a menu are listed with their contents
- [ ] Given a clash prompt answered "Remove <key> and continue" followed by "no" at "Proceed with installation?", the other install remains intact
- [ ] Given `add owner/repo --list` with no terminal, it prints the source, version, shape and skills with descriptions, installs nothing, and exits 0

### Phase 10: Unattended `add`
status: draft

**Goal**: `add` runs without prompts under `-y` or when a detected AI agent is the caller. Anything in a unit's way stops that unit unless `--overwrite` is given. A prompt that cannot be shown refuses the command before anything opens, naming what answers it.

**Why this order**: `-y` answers the prompts that are complete as of Phase 9, and targets detected agents within Phase 8's ceilings. The no-terminal refusal can only name what answers each prompt once the full prompt set exists.

**Acceptance**:
- [ ] Given `add owner/repo -y` on a skills-only repo with Claude detected, every non-internal skill installs as its own entry for Claude with no prompts and exits 0; with no agent detected, they install for every agent within each entry's ceiling
- [ ] Given `-y` where an entry's target holds untracked files or another managed install, that entry stops, what was in the way stays, the message names `--overwrite`, other entries install, and the command exits non-zero
- [ ] Given `-y --overwrite` with the same clashes, the untracked files are overwritten and the clashing managed install is removed, with no prompt
- [ ] Given no terminal and no `-y`, `add owner/repo` exits non-zero without waiting on input, writes nothing, and names `-s/--skill`, `-a/--agent` and `-y`
- [ ] Given `add` run from within an AI agent (detected as Vercel detects it), "Agent detected — installing non-interactively" replaces the banner and it behaves as `-y`; given only `CURSOR_TRACE_ID` set, it behaves as an attended run
- [ ] Given a plugin carrying hooks under `-y`, it installs with its hooks and the summary lists them by name
- [ ] Given a terminal without `-y` or `--overwrite`, the clash prompts behave as today, and a deliberate cancel exits 0

### Phase 11: Vercel's full `add` flag set and `--json`
status: draft

**Goal**: `add` accepts Vercel's full flag set and aliases (`--all`, `--copy`, `a`/`i`/`install`). It refuses `-g`, `--subagent`, `--metadata`, `--all` together with `-a`, and unrecognised flags, naming each. `--json` follows Vercel's one-array contract.

**Why this order**: `--all` composes `--skill '*'` (Phase 6), `--agent '*'` (Phase 8) and `-y` (Phase 10), and `--json` requires `-y` or `--all`. Closing the flag set here means the unknown-flag refusal reflects the final set.

**Acceptance**:
- [ ] Given `npx agntc install owner/repo --all` (or the aliases `a` and `i`), it behaves as `--skill '*' --agent '*' -y`
- [ ] Given `--copy`, the install proceeds unchanged
- [ ] Given `-g`, `--subagent`, `--metadata` or an unrecognised flag, the command exits non-zero, writes nothing, and names the flag; given `--all -a claude`, it is refused and names `--skill '*' --agent <agents> -y`
- [ ] Given `add owner/repo --json -y`, stdout carries exactly one JSON array with one entry per skill (including skills installed as part of a unit) carrying Vercel's fields — `name`, `status`, `source`, `ref`, `hash`, `path`, `scope: "project"`, `agents`, `mode: "copy"`, `security: null` — and all progress goes to stderr
- [ ] Given `--json` without `-y` or `--all`, or together with `--list`, stdout still carries one array holding a `failed` entry with the error, and the command exits non-zero
- [ ] Given `--json -y` where one entry is skipped because its ceiling excludes every named agent, the array marks it `skipped` with a reason and the command exits non-zero

### Phase 12: `update` and `remove` take Vercel's arguments and flags
status: draft

**Goal**: `remove` and `update` take one or more skill names or keys, matched by declared name, install folder or key, including installs not yet moved. They refuse misses, partial matches and cross-repo ambiguity with the installs listed, and handle a skill inside a unit as that unit. They accept Vercel's flags and aliases and refuse `-g` and `check`.

**Why this order**: Reuses name matching (Phase 6), agent names (Phase 8), agent-caller detection and the no-terminal rule (Phase 10). It must reach installs both moved and not yet moved (Phase 4), so it follows all of them.

**Acceptance**:
- [ ] Given an install of `vercel-composition-patterns`, whether moved or still in its old `composition-patterns` folder, `remove vercel-composition-patterns` and `remove composition-patterns` each remove it; `remove a b` removes both; `remove owner/repo` removes every entry from that repository
- [ ] Given a name matching nothing, `remove` and `update` exit non-zero listing the installs; given one name matching and one not, nothing is removed or updated and the unmatched name is listed with the installs; given a name matching installs from two repositories, the command is refused listing both keys
- [ ] Given a skill inside a plugin or bundle, `remove <skill>` is refused naming the unit to remove, and `update <skill>` updates the whole unit and names it
- [ ] Given an entry for Claude and Cursor, `remove <name> -a cursor` removes only Cursor's copy and the entry keeps Claude; removing an entry's last agent removes the entry; `remove --all` removes every install without confirmation; `remove --all -a cursor` removes only Cursor's copies; `remove --all <name>` is refused; `remove -s '*'` asks for confirmation; `-y` skips it; `remove -a windsurf` is refused
- [ ] Given no terminal, `remove` with no argument is refused naming skill names, keys and `--all`, and `remove <name>` without `-y` is refused naming `-y`; run from a detected AI agent, `remove <name>` removes without confirmation
- [ ] Given `rm`, `r` or `upgrade`, they act as `remove` or `update`; `update -y` and `update -p` are accepted; `-g` on either command is refused; `agntc check` exits non-zero naming `check` as not an agntc command
- [ ] Given Cursor newly detected in the project, `update` still installs only for the agents recorded at install

### Phase 13: Coexistence with Vercel-installed skills
status: draft

**Goal**: agntc works alongside skills that Vercel's CLI installed in the same project. Vercel's copies take the untracked-files path. Symlinks are replaced as links and never written or deleted through. Cursor double-copies are warned about, and the project's `skills-lock.json` is never read or written.

**Why this order**: Needs `--overwrite` on `add` (Phase 10) and on `update` (Phase 4), declared-name folders that land where Vercel's do (Phase 1), and `remove`'s argument handling (Phase 12).

**Acceptance**:
- [ ] Given a Vercel install of `foo` (a real `.agents/skills/foo` and a `.claude/skills/foo` symlink to it), when `add owner/repo@foo -a claude -y` runs, that entry stops naming `--overwrite`; with `--overwrite`, `.claude/skills/foo` becomes a real copy and `.agents/skills/foo` is unchanged
- [ ] Given the same project at a terminal without `-y` or `--overwrite`, the clash meets the untracked-files prompt
- [ ] Given an unmanaged `.agents/skills/foo`, when agntc installs `foo` for Cursor, it installs into `.cursor/skills/foo`, warns that Cursor will see two copies, and leaves `.agents/skills/foo` untouched
- [ ] Given an agntc entry whose recorded folder has since become a symlink, `remove` drops the entry, leaves the link and its target in place, and says so; `update` stops that entry and exits non-zero; `update --overwrite` replaces the link with a real copy without touching its target
- [ ] Given a project `skills-lock.json`, it is byte-for-byte unchanged after `add`, `update` and `remove`

### Phase 14: Printed commands reproduce the install
status: draft

**Goal**: Every `add`, `remove` and `update` command agntc prints is one it accepts, and following it reproduces the install it advises on. That means the source in the form it came from, skills by `@skill`/`--skill` and members by path, versions after `#`, `--plugin` for plugins, `-a` naming exactly the recorded agents, and bulk lines that cover exactly their entries.

**Why this order**: The rule can hold only once every form it prints is accepted: source forms (Phase 5), `#`/`@`/`--skill` (Phase 6), `-a` (Phase 8), `--plugin` bundles (Phase 3) and `remove`/`update` arguments (Phase 12).

**Acceptance**:
- [ ] Given an exact-pinned `--plugin` bundle installed for Claude with a newer tag, the update advice prints `npx agntc add owner/repo#<newest> --plugin -a claude`, and running it reinstalls the bundle with no menu and no collision prompt
- [ ] Given an exact-pinned skill whose folder differs from its declared name, the advice names it `owner/repo#<newest>@<declared-name>` with its recorded agents, never by manifest key; a plugin member is named `owner/repo/<path>`
- [ ] Given an all-mode update group holding three pinned skills and one plugin member, the advice is one `--skill a b c` command for the skills and a separate command for the member, naming every covered entry and no other; entries recorded for different agents get separate commands; the caret out-of-constraint footer's command likewise reproduces the install
- [ ] Given entries installed from GitLab, Azure Repos, GitHub Enterprise, `.git`, SSH and local-path sources, each printed `add` uses the form it came from, naming the skill with `--skill` where that form takes no `@skill`
- [ ] Given a derive-before-delete abort or a failed reinstall, the printed `remove`, `update` and `add` commands are accepted by agntc, `remove`/`update` carry no `--plugin`, and following them reproduces the install
- [ ] Given a recorded plugin that the update repair turned into a skill, its advice prints it as a skill with no `--plugin`
