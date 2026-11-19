# Phase 1: Skills install as skills, under their declared names — 9 tasks

## vercel-skills-compatibility-1-1

### Task vercel-skills-compatibility-1-1: Root skill installs under its declared name

**Problem**: agntc never reads SKILL.md frontmatter: nothing in `src/` parses frontmatter or depends on a YAML library (§3). A repository that is itself a skill installs into a folder named after the repository. Vercel's CLI, skills.sh and the `--skill` lines authors publish name a skill by the `name` its frontmatter declares, and the two often differ. The same skill therefore lands in a different folder under agntc than under Vercel's CLI.

**Solution**: `add` reads the root SKILL.md's frontmatter as plain data and installs the skill into a folder named by its declared `name`. When no usable name is declared, the skill goes by its folder name. For a whole-repo skill that is the repository name it installs under today. The key stays `owner/repo`, and `update` reinstalls the skill into the same folder.

**Outcome**: A repository whose root SKILL.md declares `name: foo-skill` installs into each chosen agent's `<skills dir>/foo-skill/` under key `owner/repo` and stays there across updates. A SKILL.md with no usable name installs exactly as it does today, with no warning.

**Acceptance Criteria**:
- [ ] Given `owner/repo` whose root SKILL.md declares `name: foo-skill`, when it is added for Claude, Codex and Cursor, the skill lands in `.claude/skills/foo-skill/`, `.agents/skills/foo-skill/` and `.cursor/skills/foo-skill/`, no `repo/` folder is created in any of them, and the manifest holds one entry, `owner/repo`, recorded as a skill (§1.6, §4.1, §4.3)
- [ ] Given a root SKILL.md with no frontmatter, with frontmatter whose `name` is missing, not a string (e.g. `name: 42`) or an empty string, with YAML that fails to parse, or with a fence that is not YAML (e.g. `---toml`), when it is added, it installs into `.claude/skills/repo/` under key `owner/repo` and no warning is shown (§3.2)
- [ ] Given frontmatter that uses a YAML feature which constructs objects or runs code (e.g. a `!!js/function` tag), or a `---js` fence whose body would write a marker file, when the skill is added, it installs and nothing in its frontmatter runs: no marker file appears (§3.3)
- [ ] Given a local-path source whose root SKILL.md declares `name: foo-skill`, when it is added, it installs into `.claude/skills/foo-skill/` under the key a local path gets today; given one that declares no name, it installs under its directory's name as it does today (§3.2, §4.3)
- [ ] Given a root skill installed into `.claude/skills/foo-skill/` whose declared name is unchanged upstream, when `update owner/repo` or `update` with no argument runs, it reinstalls into `.claude/skills/foo-skill/` under key `owner/repo` and no `repo/` folder appears; a local-path install updated by its key does the same (§1.2, §4.3)
- [ ] Given untracked files already in `.claude/skills/foo-skill/`, when the root skill declaring `foo-skill` is added for Claude at a terminal, the untracked-files prompt lists that folder (§4.2, §13)
- [ ] Given that root skill installed into `.claude/skills/foo-skill/`, when `remove owner/repo` runs, the folder and the entry are both removed (§1.2)

**Do**:
- Parse frontmatter as plain data. No YAML feature that executes code or constructs objects during parsing is used (§3.3).
- Where the work lives: the standalone install name comes from `basename(parsed.manifestKey)` in `runAdd` (`src/commands/add.ts`). The paths the collision and untracked-files checks predict come from `computeIncomingFiles` (`src/compute-incoming-files.ts`). Update's re-copy names the folder `basename(options.key)` in `replayRecordedSkill` (`src/nuke-reinstall-pipeline.ts`), which single-key update, all-mode update (`src/update-groups.ts`) and `list`'s update actions all reach.

**Context**:
> - agntc reads three frontmatter fields and uses them only for selecting and displaying skills (§3.1). Frontmatter never decides a source's type or whether a skill is valid. Every skill installs whatever its frontmatter holds, which keeps lenient validity (§1.4).
> - Only `name` is needed here. Phase 2 reads `metadata.internal`, and Phase 10 reads `description` (§3.1).
> - §3.2: a skill with no usable name "has no description and installs normally, with no warning, as it does today". A whole-repo skill's folder is the repository, so its fallback is the repository name it installs under today. A local path's fallback is its directory's name.
> - Sanitizing install folders is task 1-2. Cleaning escapes, line breaks and surrounding whitespace out of names is task 1-9. This task's examples are already clean.
> - Installs recorded before this feature move to their declared-name folder in Phase 4 (§4.4). The same goes for a skill whose declared name changes upstream after install (§12.6).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §1.4, §1.6, §3, §3.1, §3.2, §3.3, §4.1, §4.2, §4.3, §13

## vercel-skills-compatibility-1-2

### Task vercel-skills-compatibility-1-2: Install folders are sanitized from the skill's identity

**Problem**: Once a skill's install folder comes from its declared name (task 1-1), an author-supplied name such as `..` or `../x` could install outside the agent's skills directory. Names with capitals, spaces or punctuation would also land in folders Vercel's CLI never uses, so the two tools would not meet on the same folder.

**Solution**: Every skill's install folder is derived from its identity through Vercel's five sanitizing steps. The identity is the declared name, or the folder name when the skill declares none, so both go through the same steps.

**Outcome**: No declared name places a skill anywhere but directly inside the agent's skills directory, and every install folder is the one Vercel's CLI derives from the same name.

**Acceptance Criteria**:
- [ ] Given root skills declaring `../x`, `My Skill!!`, `---` and `..`, each added for Claude into an empty project, they install into `.claude/skills/x/`, `.claude/skills/my-skill/`, `.claude/skills/unnamed-skill/` and `.claude/skills/unnamed-skill/` respectively, and nothing is written outside `.claude/skills/` (§4.2)
- [ ] Given a root skill whose declared name is 300 `a` characters, when it is added, it installs into a folder named with 255 `a` characters (§4.2)
- [ ] Given a repository `owner/My_Repo` whose root SKILL.md declares no name, when it is added, it installs into `.claude/skills/my_repo/`; given a local-path skill in a directory `My Skill Dir/` that declares no name, it installs into `.claude/skills/my-skill-dir/` (§4.1, §4.2)
- [ ] Given a root skill declaring `My Skill!!`, when it is added, its manifest key is still `owner/repo` (§4.3)
- [ ] Given a root skill installed into `.claude/skills/my-skill/`, when `update` runs with its declared name unchanged upstream, it reinstalls into `.claude/skills/my-skill/` (§4.2)
- [ ] Rule: whatever a skill declares, its install folder is a single path segment directly inside each agent's skills directory, for Claude, Codex and Cursor alike (§4.2)

**Do**:
- Apply §4.2's steps in this order: lowercase the name; replace every run of characters outside `[a-z0-9._]` with a single `-`; strip leading and trailing `.` and `-`; cap the result at 255 characters; use `unnamed-skill` if nothing remains.
- Where the work lives: every place a skill's install folder is named — add's copy, the paths its collision and untracked-files checks predict, and update's re-copy (the sites task 1-1 lists).

**Context**:
> - §4.2: "Sanitizing keeps a declared name such as `..` or `../x` from installing outside the agent's skills directory."
> - Sanitizing applies to the identity however it was reached, whether a declared name or the folder-name fallback (§4.1, §4.2).
> - The sanitized folder name is also the `<folder>` in a skill's key `owner/repo/<folder>` (§4.3, task 1-3 on). A whole-repo skill keeps the key `owner/repo`.
> - Vercel's CLI applies the same steps. A skill both tools install for Claude or Codex therefore lands on the same folder, which surfaces as a clash through agntc's untracked-files path (§4.2, §13).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.1, §4.2, §4.3, §13

## vercel-skills-compatibility-1-3

### Task vercel-skills-compatibility-1-3: Menu-picked skills install and key by declared name

**Problem**: A skill picked from the `add` menu is labelled, installed and keyed by its folder's basename (`owner/repo/taste-skill`). When the folder `taste-skill` declares `design-taste-frontend`, agntc gives the skill a different folder and key from the name Vercel's CLI and skills.sh use. The same skill reached another way can also end up with a second key (§4.3).

**Solution**: The menu lists each member skill by its declared name. A picked skill installs into its sanitized declared-name folder under key `owner/repo/<folder>`, whether its source folder sits at the repo root or under `skills/`. `update` keeps reinstalling it from its source folder into the same place, for cloned and local-path sources alike.

**Outcome**: The `taste-skill` example installs into `.claude/skills/design-taste-frontend/` under `owner/repo/design-taste-frontend`, and `update` reinstalls it from `taste-skill/` into that folder.

**Acceptance Criteria**:
- [ ] Given a repo whose member folder `taste-skill/` holds a SKILL.md declaring `name: design-taste-frontend`, when `add owner/repo` runs at a terminal, the menu lists it as `design-taste-frontend`; picking it for Claude installs it into `.claude/skills/design-taste-frontend/` under key `owner/repo/design-taste-frontend`, with no `taste-skill/` folder and no `owner/repo/taste-skill` entry (§4.1, §4.2, §4.3)
- [ ] Given a skills-only repo whose `skills/taste-skill/` declares the same name, when it is picked from the menu, its key is `owner/repo/design-taste-frontend`, never `owner/repo/taste-skill` or `owner/repo/skills/taste-skill` (§4.3)
- [ ] Given a member skill declaring `My Skill!!`, when it is picked, it installs into `my-skill/` under `owner/repo/my-skill`; given a member folder `Helper_Tool/` that declares no name, it installs into `helper_tool/` under `owner/repo/helper_tool` (§3.2, §4.2, §4.3)
- [ ] Given `design-taste-frontend` installed from the menu with its declared name unchanged upstream, when `update owner/repo/design-taste-frontend` or `update` with no argument runs, it reinstalls from `taste-skill/` (or `skills/taste-skill/`) into `.claude/skills/design-taste-frontend/` and its key is unchanged (§1.2, §4.3)
- [ ] Given a local-path source whose member folder `taste-skill/` declares `design-taste-frontend`, when it is picked from the menu and later updated by its key, it installs into `.claude/skills/design-taste-frontend/` and the update reinstalls it there from `taste-skill/` (§1.2, §4.3)
- [ ] Given `design-taste-frontend` installed, when `add owner/repo` runs again, the menu marks it installed, and picking it again leaves one entry under `owner/repo/design-taste-frontend` and one copy in `.claude/skills/` (§4.3)
- [ ] Given untracked files already in `.claude/skills/design-taste-frontend/`, when the skill is picked from the menu for Claude at a terminal, the untracked-files prompt lists that folder (§4.2, §13)

**Do**:
- Where the work lives: the menu's labels and installed hints come from `selectCollectionPlugins` (`src/collection-select.ts`). Member keys come from `memberKey` in `src/commands/add.ts`, which keys by the folder basename today, and `memberSourceSubpath` there records where a member's source sits when that differs from its key. The menu path calls `copyUnit` and `toComputeInput` (`src/copy-unit.ts`) with no skill name, so a member installs under `basename(pluginDir)` (`src/copy-bare-skill.ts`, `src/compute-incoming-files.ts`). `update` finds a remote member's source through `resolveUpdateSourceDir` and `resolveGuardedSourceDir` (`src/source-parser.ts`), and treats a local-path entry's key as its source directory (`prepareReinstall` in `src/clone-reinstall.ts`).

**Context**:
> - A skill's identity is its declared name, or its folder name when it declares none. This replaces agntc's directory-basename identity (§4.1). Observed: 4 of 9 skills in `vercel-labs/agent-skills` and 10 of 13 in `leonxlnx/taste-skill` declare a name that differs from their folder; skills.sh lists the declared name and prints it in `--skill` lines.
> - A skill installed on its own has exactly one key, `owner/repo/<folder>`, where `<folder>` is its install folder name (§4.2), however it was selected (§4.3). The tree-URL route is task 1-4; `@name` and `--skill` arrive in Phase 7.
> - A local path keys its repository part as it does today (§4.3).
> - Plugin members are keyed by their path, not by a name (task 1-5).
> - Phase 2 offers only once the installables whose names, install folders or keys coincide (§5.2). Phase 4 re-keys entries recorded under their old folder key (§4.4).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §3.2, §4.1, §4.2, §4.3, §13

## vercel-skills-compatibility-1-4

### Task vercel-skills-compatibility-1-4: A tree URL to a skill keys it the way the menu does

**Problem**: A GitHub tree URL to a skill folder keys the install by its full subpath (`owner/repo/skills/composition-patterns`), because `parseDirectPath` in `src/source-parser.ts` builds the key from everything after the ref. It also installs the skill under its folder's basename. The menu keys and names the same skill another way, so one skill can end up with two keys and two copies depending on how it was selected (§4.3).

**Solution**: A tree URL naming a skill folder installs that skill into its sanitized declared-name folder under `owner/repo/<folder>`, the key the menu gives it. `update` reinstalls it from the URL's path at its recorded ref.

**Outcome**: Selecting a skill by tree URL or from the menu reaches the same single manifest entry and the same install folder.

**Acceptance Criteria**:
- [ ] Given `https://github.com/owner/repo/tree/main/skills/taste-skill`, where `taste-skill` declares `design-taste-frontend`, when it is added for Claude, the skill installs from `main` into `.claude/skills/design-taste-frontend/` under key `owner/repo/design-taste-frontend` (§4.3)
- [ ] Given `design-taste-frontend` installed from the menu, when the same skill is re-added through that tree URL, the manifest still holds one entry for it, under `owner/repo/design-taste-frontend`, and `.claude/skills/` holds one copy of it; re-adding in the opposite order gives the same result (§4.3)
- [ ] Given a tree URL to a skill nested deeper, e.g. `https://github.com/owner/repo/tree/main/tools/frontend/taste-skill`, when it is added, the key is still `owner/repo/design-taste-frontend` (§4.3)
- [ ] Given a tree URL to a skill folder `Helper_Tool` that declares no name, when it is added, it installs into `helper_tool/` under `owner/repo/helper_tool` (§3.2, §4.2, §4.3)
- [ ] Given a skill installed by tree URL whose declared name is unchanged upstream, when `update` runs by its key or with no argument, it reinstalls from `skills/taste-skill/` at the recorded ref into `.claude/skills/design-taste-frontend/` and its key is unchanged (§1.2, §4.3)

**Do**:
- Where the work lives: `parseDirectPath` in `src/source-parser.ts` (cited by the spec) builds today's key. The standalone install path in `runAdd` (`src/commands/add.ts`) takes both the key and the install name from that parse. Update's source lookup is the one task 1-3 names.

**Context**:
> - §4.3: "The key is the same however the skill was selected: from the menu, by `@name`, by `--skill`, by a subpath, or by a tree URL."
> - A tree URL's ref is read the way the same `#` fragment would be (§2.5), so a branch installs that branch with no constraint recorded, as today.
> - A tree URL to a plugin member keeps its path key (task 1-5). A tree URL with no path and the `owner/repo/<path>` shorthand arrive in Phase 5. A tree URL naming a skills-only pack is Phase 2. A path that lands at a folder of skills inside a unit is Phase 8.
> - Phase 4 moves existing tree-URL installs keyed by their full subpath to the new key (§4.4).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §2.5, §3.2, §4.2, §4.3

## vercel-skills-compatibility-1-5

### Task vercel-skills-compatibility-1-5: Plugin members key by their path in the repo

**Problem**: A plugin member under `skills/` (e.g. `skills/foo/` holding `agents/` and no SKILL.md) is keyed by its basename (`owner/repo/foo`) when picked from the menu, but by its path (`owner/repo/skills/foo`) when a tree URL names the same folder. The same member therefore gets two keys depending on how it was selected. A plugin member declares no name that could key it (§7.1).

**Solution**: A plugin member picked from the menu is keyed `owner/repo/<path>`, where `<path>` is its folder's path in the repository, the key a tree URL to that folder already gives it. The member still installs whole, as today. Members whose path is a single top-level folder, and a repository that is itself a plugin, keep the key they have today.

**Outcome**: `skills/foo/` keys `owner/repo/skills/foo` whether it was picked from the menu or named by a tree URL, and it updates from that path.

**Acceptance Criteria**:
- [ ] Given a skills-only repo whose `skills/foo/` holds `agents/reviewer.md` and no SKILL.md, when it is picked from the menu for Claude, it installs whole, with `reviewer.md` in `.claude/agents/`, under key `owner/repo/skills/foo` (§4.3, §5.3)
- [ ] Given that member installed from the menu, when it is re-added through `https://github.com/owner/repo/tree/main/skills/foo`, the manifest still holds one entry for it, under `owner/repo/skills/foo`; adding by tree URL first and then from the menu gives the same result (§4.3)
- [ ] Given a skill pack `skills/pack/` holding only `skills/`, when it is picked from the menu, it installs as one entry under `owner/repo/skills/pack` (§4.3, §5.3)
- [ ] Given a repo whose top-level folder `foo/` holds `agents/` and no SKILL.md, when it is picked from the menu, it keys `owner/repo/foo` as today; given a repo that is itself a plugin, it keys `owner/repo` as today (§4.3)
- [ ] Given `owner/repo/skills/foo` installed, when `update` runs by its key or with no argument, it reinstalls from `skills/foo/` and its key is unchanged (§1.2, §4.3)
- [ ] Given `owner/repo/skills/foo` installed, when `add owner/repo` runs again, the menu marks that member installed (§4.3)

**Do**:
- Where the work lives: member keys come from `memberKey` in `src/commands/add.ts`, which keys by the folder basename today. The menu's installed hint comes from `selectCollectionPlugins` (`src/collection-select.ts`).

**Context**:
> - §4.3: "A plugin member (§5.3) installed on its own has exactly one key, `owner/repo/<path>`, where `<path>` is its folder's path in the repository. The key is the same whether the member was picked from the menu or selected by its path in the source (§7.1). A plugin member at the repository root keys as it does today."
> - §5.3: a non-hidden folder with `skills/`, `agents/` or `hooks/` and no SKILL.md is a plugin member, installed whole. This includes a skill pack that holds only `skills/`.
> - A plugin member is not a skill, and no name matches it. It is selected by its path (§7.1).
> - Tasks 1-6 and 1-7 bring in the §5.1 plugin shapes that hold a SKILL.md, keyed by path the same way. Task 1-8 sets where a member's own skills land.
> - Phase 4 re-keys members recorded under their folder name (§4.4). Phase 2 finds members below today's one-level scan, and installs a tree URL naming a skills-only pack as that member.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §4.3, §5.3, §7.1

## vercel-skills-compatibility-1-6

### Task vercel-skills-compatibility-1-6: A skill carrying agents/ or hooks/ installs as a skill

**Problem**: agntc reads a SKILL.md beside any asset folder as a plugin and drops the SKILL.md (`classifyStructure` in `src/type-detection.ts`: "SKILL.md found alongside asset dirs — treating as plugin, SKILL.md will be ignored"). The menu path does the same to members: any member holding an asset folder is forced to a plugin. Real skills carry `agents/` for two unrelated reasons: OpenAI's `agents/openai.yaml` metadata convention, and helper prompts the skill reads itself (e.g. `skill-creator`'s `analyzer.md` and `grader.md`). agntc copies those files into `.claude/agents/` as subagents, loses the skill, and still reports "Installed". In an exploratory run against ten skills.sh leaderboard repos, 61 of 258 skill folders carried `agents/` (§5.3).

**Solution**: A folder holding SKILL.md is a skill wherever it sits. It is copied whole into the agent's skills directory, `agents/` and `hooks/` included, and nothing in it is routed as a plugin asset. Two shapes stay plugins, read the same way at the source root and in a member folder, each against its own `agntc.json`: SKILL.md beside `skills/` and `agents/`/`hooks/`, and SKILL.md beside `agents/`/`hooks/` whose `agntc.json` declares `"type": "plugin"`. Their SKILL.md is not installed, and a member folder of either shape is a plugin member keyed by its path. `--plugin` on a root SKILL.md beside `agents/`/`hooks/` without that declaration is refused.

**Outcome**: A skill with `agents/openai.yaml` installs as a skill with the file inside its folder and is recorded as a skill. Genuine plugins install as they do today.

**Acceptance Criteria**:
- [ ] Given a repo whose root SKILL.md sits beside `agents/openai.yaml`, when it is added for Claude and Codex, `.claude/skills/<declared name>/` and `.agents/skills/<declared name>/` each hold the SKILL.md and `agents/openai.yaml`, nothing is written to `.claude/agents/`, and the manifest records `owner/repo` as a skill; a SKILL.md beside `hooks/` installs the same way, with nothing written to `.claude/hooks/` (§5.1, §5.3)
- [ ] Given a skills-only repo whose `skills/skill-creator/` holds SKILL.md beside `agents/analyzer.md` and `agents/grader.md`, when it is picked from the menu, it installs as a skill with `agents/` inside its declared-name folder, keyed `owner/repo/<folder>`, and nothing lands in `.claude/agents/` (§4.3, §5.3)
- [ ] Given a root SKILL.md beside `skills/` and `agents/` (or `hooks/`), when it is added, it installs as a plugin: its agents in `.claude/agents/` (or hooks in `.claude/hooks/`), its skills in the skills directory, the root SKILL.md not installed, the entry recorded as a plugin (§5.1)
- [ ] Given a root SKILL.md beside `agents/` whose `agntc.json` declares `"type": "plugin"`, when it is added, it installs as a plugin with its agents in `.claude/agents/` and the root SKILL.md not installed; adding it with `--plugin` installs the same (§5.1, §6.6)
- [ ] Given a member folder of either plugin shape (SKILL.md beside `skills/` and `agents/`, or SKILL.md beside `agents/` with its own `agntc.json` declaring `"type": "plugin"`), when it is picked from the menu or named by a tree URL, it installs whole as a plugin with its agents in `.claude/agents/` and its SKILL.md not installed, keyed `owner/repo/<path>` either way (§4.3, §5.3)
- [ ] Given a root SKILL.md beside `agents/` or `hooks/` with no `"type": "plugin"`, when it is added with `--plugin`, the command exits non-zero, writes no files and no manifest entry, and its message names the refusal (§1.5, §6.6)
- [ ] Given a skill carrying `agents/` installed as a skill, when `update` runs, it reinstalls as a skill with `agents/` inside its folder and nothing in `.claude/agents/` (§5.3)

**Do**:
- A member folder is classified by the same §5.1 rules as the source root, reading its own `agntc.json` (§5.3).
- Where the work lives: `classifyStructure` in `src/type-detection.ts` (cited by the spec); `detectType` there, which raises today's `TypeConflictError` for `--plugin` on a skill; and the menu install path in `runCollectionPipeline` (`src/commands/add.ts`), which forces any member holding an asset folder to a plugin (`memberHasAssetDirs`).

**Context**:
> - §5.1's order: a folder holding SKILL.md is a single skill. The exceptions are SKILL.md beside `skills/` and `agents/`/`hooks/`, and SKILL.md beside `agents/`/`hooks/` whose `agntc.json` declares `"type": "plugin"`: those are plugins, and their SKILL.md is ignored. This diverges from Vercel to keep units (§1.4): Vercel's root early-out would install such a repo as a single skill.
> - §6.6: today `detectType` installs a root SKILL.md beside `agents/` or `hooks/` as a plugin and the flag changes nothing. That one case is now refused. `--plugin` on a plugin stays redundant and changes nothing.
> - A refusal is pre-flight (§1.5): the command exits non-zero, writes nothing, and its message names what was refused.
> - A skill installed on its own keeps its own `agntc.json` `agents` ceiling, as a single skill's is today (§6).
> - SKILL.md beside `skills/` alone is task 1-7. Where a plugin's skills land is task 1-8.
> - Phase 4 repairs entries recorded as plugins under the old rule into skills on their next update (§5.5). Phase 2's deeper walks reach such folders below the first level.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §1.5, §4.3, §5.1, §5.3, §6, §6.6

## vercel-skills-compatibility-1-7

### Task vercel-skills-compatibility-1-7: A SKILL.md beside skills/ alone reads as one skill

**Problem**: agntc reads a folder holding SKILL.md beside `skills/` alone as the ambiguous skills-only shape. By default it offers a menu of the children of `skills/` and drops the SKILL.md. Under the first rule of §5.1, Vercel's root early-out, that folder is a single skill.

**Solution**: Such a folder installs whole as one skill, at the source root or as a member, with its `skills/` folder copied inside it and no menu shown. Two things keep the bundle instead: the folder's own `agntc.json` declaring `"type": "plugin"`, or `--plugin` on the source root. Either one bundles the skills under `skills/` as one unit and leaves the SKILL.md out. A member folder bundled by its own declaration is a plugin member keyed by its path.

**Outcome**: `add` on a root SKILL.md beside `skills/` installs a single skill with no menu. Lines written today with `--plugin`, and bundles already made from that shape, keep working.

**Acceptance Criteria**:
- [ ] Given a repo whose root SKILL.md sits beside `skills/` alone, with no `"type": "plugin"`, when `add owner/repo` runs, no member menu is shown, and the skill installs into `.claude/skills/<declared name>/` with `skills/` inside it, under key `owner/repo`, recorded as a skill (§5.1)
- [ ] Given the same repo with an `agntc.json` declaring `"type": "plugin"`, when it is added, it installs as one plugin entry under `owner/repo` holding the skills under `skills/`, and the root SKILL.md is not installed (§5.1)
- [ ] Given the same repo without the declaration, when it is added with `--plugin`, it installs the same bundle: one entry, the skills under `skills/`, no root SKILL.md (§6.6)
- [ ] Given a `--plugin` bundle made from that shape, when `update` runs, it reinstalls as the same bundle, still without the root SKILL.md (§6.6)
- [ ] Given a member folder holding SKILL.md beside `skills/` alone, with no `agntc.json` of its own declaring `"type": "plugin"`, when it is picked from the menu, it installs as one skill with `skills/` inside its declared-name folder, keyed `owner/repo/<folder>` (§4.3, §5.3)
- [ ] Given a member folder of that shape whose own `agntc.json` declares `"type": "plugin"`, when it is picked from the menu or named by a tree URL, it installs as one plugin member bundling its `skills/`, without its SKILL.md, keyed `owner/repo/<path>` either way (§4.3, §5.3)

**Do**:
- A member folder is classified by the same §5.1 rules as the source root, reading its own `agntc.json` (§5.3).
- Where the work lives: `classifyStructure` and its skills-only branch in `src/type-detection.ts`, where a SKILL.md beside `skills/` alone reads as skills-only today and `scanSkillsOnlyMembers` (cited by the spec) enumerates the inner skills for the menu. `detectType` there resolves `--plugin` and the config `type`.

**Context**:
> - §6.6's excepted shape: "`--plugin` on a root `SKILL.md` beside `skills/` alone bundles the skills under `skills/` and leaves the root `SKILL.md` out, as it does today. Without the flag, or an `agntc.json` declaring `"type": "plugin"` (§5.1), that root reads as a single skill. The flag is the installer's explicit request for the bundle, so lines written today and the bundles already made from that shape keep working."
> - Override precedence is unchanged: `--plugin` over the config `type` over structure.
> - The root early-out means skills nested inside a skill's folder are not offered separately. Phase 2's `--full-depth` turns the early-out off (§5.1, §5.2).
> - The folder each bundled skill lands in, and what else under `skills/` is left out, is task 1-8 (§6.1). Phase 3 settles what a `--plugin` bundle holds beyond `skills/` (§6.2).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §5.1, §5.3, §6.1, §6.6

## vercel-skills-compatibility-1-8

### Task vercel-skills-compatibility-1-8: A plugin's skills install under their declared-name folders

**Problem**: A plugin's skills are copied as the children of its `skills/` folder stand (`copyAssetDir` in `src/copy-plugin-assets.ts`). Each skill lands under its directory name rather than its declared name, a different folder from the one it takes installed on its own or by Vercel's CLI. A category folder lands one level deeper than agents load skills, and a loose file lands in the agent's skills directory (§6.1).

**Solution**: A plugin's skills are the skills discovery finds under its `skills/`. Category folders are walked the way §5.2 walks `skills/`, and each skill installs flat into its sanitized declared-name folder, or its sanitized folder name when it declares none. Nothing else in `skills/` installs, neither a loose file nor a folder holding no skill, and the output names what was left out. This holds for a source that reads as a plugin, a plugin member, and a source declaring `"type": "plugin"`, on `add` and on every update. The skills a `--plugin` bundle takes from `skills/` land flat in their declared-name folders the same way. Agents and hooks keep their names and destinations, and the paths the collision and untracked-files checks predict are the folders the install writes.

**Outcome**: A plugin whose `skills/frontend/taste-skill/` declares `design-taste-frontend` installs that skill into `<agent skills dir>/design-taste-frontend/` and keeps it there across updates. No category folder or loose file reaches an agent's skills directory.

**Acceptance Criteria**:
- [ ] Given a plugin repo (`skills/` beside `agents/`) whose `skills/taste-skill/` declares `design-taste-frontend`, when it is added for Claude and Codex, the skill lands in `.claude/skills/design-taste-frontend/` and `.agents/skills/design-taste-frontend/`, no `taste-skill/` folder is created, and its agents land in `.claude/agents/` as today; a skill declaring `My Skill!!` lands in `my-skill/`, and a skill folder `Helper_Tool/` declaring no name lands in `helper_tool/` (§3.2, §4.2, §6.1)
- [ ] Given a plugin whose `skills/` holds `frontend/react/SKILL.md` and `backend/sql/SKILL.md` (declaring `react` and `sql`), a loose `README.md`, and a folder `assets/` holding no skill, when it is added for Claude, `.claude/skills/react/` and `.claude/skills/sql/` are installed, no `frontend/`, `backend/`, `assets/` or `README.md` appears in `.claude/skills/`, and the output names `README.md` and `assets/` as left out (§6.1)
- [ ] Given a plugin member holding category folders and a loose file under its own `skills/` (e.g. `skills/pack/` in a skills-only repo), when it is picked from the menu, its skills land flat in their declared-name folders, the loose file is not installed, and the output names it as left out (§5.3, §6.1)
- [ ] Given a skills-only repo whose `agntc.json` declares `"type": "plugin"`, when it is added, its skills land flat in their declared-name folders, category-nested ones included, and its loose files are left out and named; given the same repo without the declaration added with `--plugin`, each bundled skill under `skills/`, category-nested ones included, lands flat in its declared-name folder (§6.1, §6.2)
- [ ] Given such a plugin installed, when `update` runs by its key or with no argument and the declared names are unchanged upstream, each skill reinstalls into the same flat folder, the loose file is still not installed, and the update's output names it again (§6.1)
- [ ] Given untracked files already in `.claude/skills/design-taste-frontend/`, when the plugin is added for Claude at a terminal, the untracked-files prompt lists that folder (§4.2, §13)

**Do**:
- Walk a plugin's `skills/` the way §5.2's discovery walks `skills/` (§6.1).
- Where the work lives: `copyAssetDir` in `src/copy-plugin-assets.ts` (cited by the spec) copies each child of `skills/` as it stands. `computePluginFiles` in `src/compute-incoming-files.ts` predicts the paths for the collision and untracked-files checks. `replayRecordedPlugin` in `src/nuke-reinstall-pipeline.ts` re-copies on update. Add's output comes from `renderAddSummary` and `renderCollectionAddSummary` (`src/summary.ts`); update's comes from `src/commands/update.ts` and `src/update-render.ts`.

**Context**:
> - §6.1: "A plugin's skills are the skills discovery finds under its `skills/`, as a bundle's are (§6.2): category folders are walked as discovery walks `skills/` (§5.2), and each skill installs flat in its declared-name folder (§4.2); nothing else in `skills/` installs, neither a loose file nor a folder holding no skill, and the output names what was left out."
> - §5.2's walk of `skills/` goes three levels deep. It never enters a plugin member, never goes below a skill it has found, and never follows a symlinked directory. It never descends through `node_modules`, `.git`, `dist`, `build` or `__pycache__`, but still checks such a folder for a SKILL.md of its own, so `skills/build/SKILL.md` is a skill.
> - A skill folder carrying `agents/` or `hooks/` is copied whole as a skill (§5.3, task 1-6). A plugin's own `agents/` and `hooks/` install as they do today (§6.1).
> - Phase 3 keeps the first in priority order when two of a plugin's own skills would take the same folder, and names the other as left out (§5.2, §6). It also settles what a `--plugin` bundle holds beyond `skills/` (§6.2). Phase 2 reads `metadata.internal` (§5.4).
> - Phase 4 stops an update whose target folder is already occupied (§12.6).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §3.2, §4.2, §5.2, §5.3, §6.1, §6.2, §13

## vercel-skills-compatibility-1-9

### Task vercel-skills-compatibility-1-9: Declared names are read as Vercel reads them

**Problem**: A declared name is author-supplied text that agntc prints and turns into an install folder and a key. Read raw, its terminal escape sequences and control characters reach the terminal and distort the folder it installs into. Line breaks split it across lines, and surrounding whitespace makes it differ from the name Vercel's CLI reads.

**Solution**: A declared name is read the way Vercel's `sanitizeMetadata` reads it: terminal escapes stripped, line breaks turned into spaces, leading and trailing whitespace trimmed. The cleaned name is what agntc installs under, keys by and lists. Nothing agntc prints from a name carries a control character or a terminal escape sequence.

**Outcome**: The name agntc shows, installs under and keys by is the cleaned name Vercel's CLI reads.

**Acceptance Criteria**:
- [ ] Given a member skill whose declared name is `red-skill` wrapped in a terminal colour sequence (`"\e[31mred-skill\e[0m"`), when `add owner/repo` runs at a terminal, the menu lists it as `red-skill` with no escape sequence reaching the terminal, and picking it installs it into `.claude/skills/red-skill/` under `owner/repo/red-skill` (§3.2, §3.3, §4.2)
- [ ] Given a declared name containing a control character such as a bell (`\x07`), when the menu lists it, the control character is not printed (§3.3)
- [ ] Given a declared name `"Foo\nBar"`, when the menu lists it, it shows `Foo Bar` on one line, and picking it installs it into `foo-bar/` under `owner/repo/foo-bar` (§3.2, §4.2)
- [ ] Given a declared name `"  Foo  "`, when the menu lists it, it shows `Foo`, and picking it installs it into `foo/` under `owner/repo/foo` (§3.2, §4.2)
- [ ] Given a `name` that is only whitespace, when the skill is added, it installs into `unnamed-skill/` rather than under its folder name, keyed `owner/repo/unnamed-skill` when picked from the menu and `owner/repo` as a root skill; given a `name` that is an empty string, it installs under its folder name (§3.2, §4.2, §4.3)
- [ ] Rule: no text `add` prints from a declared name carries a terminal escape sequence or a control character (§3.3)

**Do**:
- Read names as Vercel v1.7.0's `sanitizeMetadata` reads them (`src/sanitize.ts:61–65`): strip terminal escapes, turn line breaks into spaces, and trim leading and trailing whitespace (§3.2).
- Apply the missing-name test to the raw `name`, before cleaning, as Vercel's `!data.name` does (`src/skills.ts:100`). An empty string falls back to the folder name. A whitespace-only name cleans to an empty declared name and installs into `unnamed-skill` (§3.2).
- Strip control characters and terminal escape sequences from frontmatter text before printing it, as Vercel does (§3.3).
- Where the work lives: the frontmatter read task 1-1 adds, and the places `add` prints a skill's name — the menu's labels (`selectCollectionPlugins` in `src/collection-select.ts`) and the install summaries (`src/summary.ts`).

**Context**:
> - The cleaned value is the declared name everywhere the name is used: identity (§4.1), install folder through §4.2's sanitizing, key (§4.3) and menu label (task 1-3). Phase 7 matches names against it (§7.1).
> - Where the specification is silent on an edge of this reading, such as exactly which sequences count as terminal escapes, Vercel's behaviour is the answer (§1.4).
> - Phase 10 applies the same cleaning to descriptions when it displays them (§3.2, §11.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §3.2, §3.3, §4.1, §4.2, §4.3, §7.1
