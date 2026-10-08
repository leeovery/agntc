# Specification: Vercel Skills Compatibility

## Specification

### 1. Scope and Governing Rules

#### 1.1 What this feature is

agntc becomes a like-for-like replacement for Vercel's `skills` CLI for adding, updating and removing skills in a project. A line written for Vercel's CLI works when the binary is swapped (`npx skills add owner/repo` → `npx agntc add owner/repo`), with the same source formats and flags, unattended runs, and a pre-install summary. The resulting install behaves the same as Vercel's (§1.6). agntc keeps the capabilities that are its reason to exist (§1.4). The main one is installing several skills as one unit, including `--plugin` bundling of a repo of skills published to be installed one by one through Vercel's CLI.

The reference is Vercel's `skills` CLI v1.7.0 (npm `skills@1.7.0`, commit `7407f389`, 2026-09-17). "Vercel's behaviour" throughout this specification means that version.

#### 1.2 In scope

- Vercel syntax parity for `add`, `update` and `remove`: their source grammar, flags, aliases and positional arguments.
- Installing into the project (project scope only) from git repositories and local paths. Supported hosts are GitHub, GitLab (including nested groups), Azure Repos, GitHub Enterprise and self-hosted git servers (§2). Private repositories work wherever the user's own git credentials work; agntc does not adopt Vercel's credential chain.
- Unattended runs (§10) and the pre-install summary (§11).
- The structural breakage that stops Vercel-directory repos installing correctly today: skills carrying their own `agents/` folder, and skills nested in category folders (§5).
- Whatever agntc must record so `update` and `remove` keep working on what the new syntax installs (§4, §12).
- Printed commands that agntc itself refuses, or that change an install's shape when followed (§14).

#### 1.3 Out of scope

- **Roadmapped, decided later:**
  - global installs (`-g`), roadmap item `global-skill-installs`;
  - website (well-known-endpoint) sources, roadmap item `website-skill-sources`.
- **Not built:**
  - Vercel's other commands (`find`/`search`, `use`, `init`, `experimental_install`, `experimental_sync`);
  - skills.sh packs;
  - Notion sources;
  - direct links to a single `SKILL.md` or an archive;
  - Vercel's canonical `.agents/skills` store with symlink fan-out (§1.6);
  - the skills.sh blob fast path for allowlisted owners. agntc always clones, and the content is the publisher's repo either way.

A line that needs any of these is refused (§1.5), with a message naming the capability agntc doesn't support. It is never silently treated as something agntc does support.

#### 1.4 Syntax follows Vercel; capabilities stay agntc's

agntc's own syntax may change to match Vercel's. Every change must leave these capabilities reachable, because they are what agntc does that Vercel's CLI can't:

- **Units:** skills plus agents and hooks, installed, updated and removed as one; and `--plugin` bundling of a skills-only source.
- **The author's agent ceiling:** an `agntc.json` `agents` list restricts which agents a unit installs for.
- **Semver constraints with constrained update.**
- **Lenient validity:** a skill installs whatever its frontmatter holds, with no frontmatter gate.
- **Copy-safety:** path-traversal and symlink-escape guards run before any copy.

Vercel's behaviour is the default at every point of parity, edge cases included. agntc diverges only in three cases:
- Vercel's behaviour would remove a kept capability.
- It would override a position the owner holds.
- It would silently ignore part of a line (§1.5).

Each divergence in this specification is marked as one and names what it guards. Where this specification says nothing about a Vercel-syntax edge case, Vercel's behaviour is the answer, under the same test.

#### 1.5 Refusals

A **refusal** in this specification is always pre-flight:
- the command exits non-zero;
- it writes nothing (no installed files, no manifest entry) and removes nothing;
- its message names what was refused, and the way through where one exists.

A refusal that exited 0 would read as success to an AI agent caller, which acts on the exit status rather than the text.

**Never silently ignore.** No part of a line (a flag, a source form, a name) is silently dropped. Where Vercel ignores or drops something without saying so, agntc refuses instead: unknown flags (§9) and names that match nothing or only partly match (§7).

#### 1.6 Equivalence means behaving the same

An agntc install is equivalent to Vercel's when the skill behaves the same for the agent. The files do not have to sit where Vercel would put them. agntc keeps a real copy per agent in each agent's own directory:
- Claude: `.claude/skills/`
- Codex: `.agents/skills/`
- Cursor: `.cursor/skills/` (Vercel uses `.agents/skills/`)

Vercel instead keeps one canonical copy in `.agents/skills/` with symlinks from each agent's directory; agntc does not.

### 2. Source Grammar

#### 2.1 Source forms

agntc accepts Vercel's source forms as well as the forms it already reads. Each form is parsed the way Vercel parses it.

- `owner/repo` is GitHub shorthand.
- `owner/repo/path` is a path into the repository.
  - In a source string this is always a path into the repo, never a manifest key (§4).
  - A path that escapes the repo with `..` is refused by copy-safety.
  - agntc today refuses this form as "too many slashes" (`grep -n "too many slashes" src/source-parser.ts` → line 365).
- `github:owner/repo` and `gitlab:owner/repo` prefixes. agntc today has no prefix handling (`grep -n "gitlab\|github:" src/source-parser.ts` → no hits).
- GitHub tree URLs, `https://github.com/owner/repo/tree/<ref>[/<path>]`. The path is optional, as in Vercel; agntc today requires one.
- GitLab URLs, including nested groups (`https://gitlab.com/group/subgroup/repo`) and `/-/tree/<ref>/<path>` URLs.
- Azure Repos `_git` URLs, with `?path=` and `?version=`.
- A GitHub Enterprise host named by the `GH_HOST` environment variable, read as GitHub.
- SSH addresses, `https://….git` URLs and local paths, as today.

agntc today keeps only the last two path segments of an https URL as owner/repo (`parseHttpsUrl` in `src/source-parser.ts`). So a GitLab subgroup URL or an Azure `_git` URL clones the wrong path.

#### 2.2 Reading an https URL

An http(s) URL is read in Vercel's order:

1. **Git source.** Any of these is cloned:
   - GitHub, including the `GH_HOST` host;
   - gitlab.com;
   - a `/-/tree/` URL on any host;
   - an Azure Repos `_git` URL;
   - any URL ending `.git`.
2. **Direct-download link, refused (§1.5).** These are GitHub's hosted-artifact links:
   - raw.githubusercontent.com;
   - codeload.github.com;
   - objects.githubusercontent.com;
   - github.com paths under `/archive/`, `/raw/`, `/releases/download/` and `/releases/latest/download/`.
3. **Website source, refused (§1.3).** This is every other http(s) URL. The message names website sources as unsupported.

This changes agntc's own syntax. Today any `https://host/owner/repo` is cloned as git. Under this order, a self-hosted URL without `.git` is a website source. Self-hosted git servers are reached with a `.git` URL or an SSH address.

The other out-of-scope source forms from §1.3 are recognised by shape and refused the same way:
- skills.sh pack links (`https://skills.sh/p/<id>`);
- Notion sources;
- direct links to a single `SKILL.md` or an archive.

#### 2.3 `@` selects a skill

`owner/repo@skill` selects the skill named `skill`. A skill's name is its declared name (§3), and §7 covers how names match. This is Vercel's grammar: `@` never carries a version or a ref.

agntc today reads `@X` as a ref, or as a semver constraint when `X` starts with `^` or `~` (`classifyRefOrConstraint` in `src/source-parser.ts`). A pasted Vercel line `owner/repo@some-skill` therefore either fails on a missing ref, or installs the wrong thing when a branch or tag of that name exists.

Some `@` values look like a version: a `^`/`~` range, or a semver-shaped tag such as `v2.0.0`. Such a value that matches no skill is refused (§1.5), and the message points at the `#` form (§2.4). This is the migration path for lines written in agntc's previous grammar.

#### 2.4 `#` carries versions and refs

The `#` fragment holds what `@` held before:

| Fragment | Meaning |
|---|---|
| `#^1.0`, `#~1.2` | Semver constraint. Resolves the best matching tag and is recorded for constrained update. |
| `#v2.0.0` | Exact tag. No constraint is recorded. |
| `#main` | That branch. |

A fragment that does not start with `^` or `~` is a ref (a tag or a branch), read the way `@` was read before. `#ref@skill` combines a ref with a skill selection, for example `owner/repo#v2.0.0@skill`.

#### 2.5 Version a bare add installs

**This diverges from Vercel, to protect semver constraints (§1.4).** Vercel has no version concept and always installs the default branch HEAD. A bare add, meaning one with no `#` fragment, keeps agntc's default:

- It installs the newest semver tag and records a caret constraint (`^X.Y.Z`), so updates stay within that major version.
- It installs the default branch when the repo has no semver tags.

A branch is always one explicit fragment away (`#main`).

**Fallback to the default branch.** In two cases the bare add installs from the default branch instead, says so in its output, and records no constraint:
- The newest tag lacks something the line names: a skill selected by `@` or `--skill`, or the path in the source.
- The newest tag holds no skills at all.

The fallback keeps two cases working: a pasted pick for a skill added after the repo's last release, and a repo whose tags predate its skills.

### 3. Reading SKILL.md Frontmatter

agntc reads a skill's `SKILL.md` frontmatter for the first time. Today nothing in `src/` parses frontmatter or depends on a YAML library (`grep -rln "frontmatter\|yaml\|gray-matter" src/ | grep -v "\.test\.ts"` → no hits).

#### 3.1 What is read, and for what

agntc reads three fields, and uses them only for selecting and displaying skills:

| Field | Used for |
|---|---|
| `name` | The skill's declared name: selection (§7), identity and install folder (§4) |
| `description` | The one-line description in the pre-install summary and `--list` (§11) |
| `metadata.internal` | Marking a skill as internal (§5) |

Frontmatter never decides a source's type or whether a skill is valid. Structure decides type, and every skill installs whatever its frontmatter holds (§5).

#### 3.2 Fallback to the folder

The skill goes by its folder name when its `SKILL.md` has any of the following:
- no frontmatter;
- frontmatter with no string `name`;
- YAML that fails to parse;
- a fence that is not YAML.

In each case the skill has no description and installs normally, with no warning, as it does today. A `description` that is not a string counts as no description.

#### 3.3 Reading safely

- Frontmatter is parsed as plain data. YAML features that execute code or construct objects during parsing are not used.
- Before agntc prints frontmatter text (names and descriptions), it strips control characters and terminal escape sequences, as Vercel does.

### 4. Skill Identity

#### 4.1 Identity is the declared name

A skill's identity is its declared name (§3), or its folder name when it declares none. This is Vercel's rule, and it replaces agntc's directory-basename identity.

In Vercel-directory repos the declared name and the folder name often differ. Observed in an exploratory run against skills.sh leaderboard repos: 4 of 9 skills in `vercel-labs/agent-skills` differ, and 10 of 13 in `leonxlnx/taste-skill`. For example, the folder `taste-skill` declares `design-taste-frontend`, and skills.sh lists that declared name and prints it in `--skill` lines.

#### 4.2 Install folder

A skill installs into a folder named after its identity, sanitized the way Vercel sanitizes it:

1. Lowercase the name.
2. Replace every run of characters outside `[a-z0-9._]` with a single `-`.
3. Strip leading and trailing `.` and `-`.
4. Cap the result at 255 characters.
5. Use `unnamed-skill` if nothing remains.

Sanitizing keeps a declared name such as `..` or `../x` from installing outside the agent's skills directory.

When a skill is installed by both agntc and Vercel's CLI, both land on the same folder. This shows up as a visible clash through the untracked-files path (§13), not as two copies the agent sees side by side.

#### 4.3 One key per skill

A skill installed on its own has exactly one manifest key, `owner/repo/<folder>`, where `<folder>` is its install folder name (§4.2). The key is the same however the skill was selected: from the menu, by `@name`, by `--skill`, by a subpath, or by a tree URL. A skill that is the whole repo (a root `SKILL.md`) keys as `owner/repo`, as it does today.

Today one skill can end up with two keys depending on how it was selected. The collection menu keys a member by its folder basename (`owner/repo/composition-patterns`). A tree URL keys it by its full subpath (`owner/repo/skills/composition-patterns`), because `parseDirectPath` in `src/source-parser.ts` builds the key from everything after the ref.

A key is never an install source. A path in a source string is always a path into the repo (§2.1), and agntc never prints a key as a source (§14). `remove` and `update` accept keys (§12).

#### 4.4 Existing installs move on their next update

An existing install moves to its declared-name folder and key on its next update. If the target folder is already occupied, update handles it as §12 sets out.

### 5. Discovery and Unit Shape

#### 5.1 Reading a source's shape

Shape is read at the root of what the source points at: the repo root, or the path the source names. The first case that matches decides:

1. **A single skill.** The folder holds a `SKILL.md`. This is Vercel's root early-out, and `--full-depth` turns it off (§5.2). There is one exception, below.
2. **A plugin, installed whole.** Either case below counts:
   - `skills/` beside `agents/` and/or `hooks/`;
   - `agents/` and/or `hooks/` with no `SKILL.md`.

   A folder that holds `SKILL.md` *and* `skills/` beside `agents/`/`hooks/` is a plugin. Its root `SKILL.md` is ignored. **This diverges from Vercel, to keep units (§1.4).** Vercel's root early-out would install such a repo as a single skill. Its agents and hooks would never be routed, and its inner skills would be nested where agents don't load them.
3. **`skills/` only.** By default this is a menu of the skills discovery finds (§5.2). `--plugin`, or `"type": "plugin"` in `agntc.json`, bundles it instead (§6).
4. **Anything else.** Discovery runs (§5.2), and its members form the menu.

A source where discovery finds nothing installable is refused (§1.5). Vercel likewise exits 1 when it finds no skills. Today a category-nested repo such as `mattpocock/skills` finds no members, because membership is read one level into `skills/` only (`scanSkillsOnlyMembers` in `src/type-detection.ts`). It then ends "Cancelled — no plugins selected" with exit 0.

#### 5.2 Discovery walk

agntc discovers members where Vercel's discovery finds skills (v1.7.0 `discoverSkills`, `src/skills.ts`), and as deep. Search roots, in priority order:

1. The source root, walked one level.
2. `skills/`, `skills/.curated`, `skills/.experimental` and `skills/.system`, each walked three levels.
3. Vercel's 30 agent directories, each walked three levels: `.agents/skills`, `.claude/skills`, `.cline/skills`, `.codebuddy/skills`, `.codex/skills`, `.commandcode/skills`, `.continue/skills`, `.factory/skills`, `.github/skills`, `.goose/skills`, `.grok/skills`, `.iflow/skills`, `.junie/skills`, `.kilo/skills`, `.kilocode/skills`, `.kimchi/skills`, `.kiro/skills`, `.minimax/skills`, `.mux/skills`, `.neovate/skills`, `.opencode/skills`, `.openhands/skills`, `.pi/skills`, `.posit/assistant/skills`, `.qoder/skills`, `.roo/skills`, `.trae/skills`, `.windsurf/skills`, `.zcode/skills`, `.zencoder/skills`. Measured in `vercel-labs/skills` at `v1.7.0`: `grep -c "^  '\." src/skills.ts` → 30.
4. Skill directories declared in `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json`, walked one level. These manifests are read only to find skills, never as a type signal.

When those roots find nothing, or when `--full-depth` is given, the whole source is walked recursively, five levels deep. That is Vercel's fallback.

Every walk follows these rules:

- It never descends into a member it has found (§5.3).
- It never enters `node_modules`, `.git`, `dist`, `build` or `__pycache__`.
- It never follows a symlinked directory.
- When two skills declare the same name, the first in priority order is kept.
- Skills in the source's own agent directories are skipped when the source's own `skills-lock.json` records them as installed. These are skills the author pulled in, not wrote, and Vercel skips them the same way. This is the only time agntc reads a `skills-lock.json` (§13).

#### 5.3 Members

Each folder the walk reaches is classified like this:

- **A folder with `SKILL.md` is a skill.** Everything in it, `agents/` included, is copied with it, and nothing in it is routed as a plugin asset. The one exception is §5.1's plugin rule: a folder that also has `skills/` beside `agents/`/`hooks/` is a plugin.
- **A non-hidden folder with `skills/`, `agents/` or `hooks/` (and no `SKILL.md`) is a plugin member, installed whole.** This includes a skill pack that holds only `skills/`. Hidden folders are never plugin members, because a clone's `.git` holds `hooks/`. **This diverges from Vercel, to keep units (§1.4).** Vercel sees such folders only as loose skills, or misses them. A pick aimed at a skill inside a plugin member is a pick from a unit (§6).
- **Any other folder** is walked into, within the depth limits of §5.2.

Today a `SKILL.md` beside any asset folder is read as a plugin, and the `SKILL.md` is dropped (`classifyStructure` in `src/type-detection.ts`: "SKILL.md found alongside asset dirs — treating as plugin, SKILL.md will be ignored"). Real skills carry `agents/` for two unrelated reasons:
- OpenAI's `agents/openai.yaml` metadata convention;
- helper prompts the skill reads itself (e.g. `skill-creator`'s `analyzer.md` and `grader.md`).

agntc copies those files into `.claude/agents/` as subagents and loses the skill, and still reports "Installed". In an exploratory run against ten skills.sh leaderboard repos, 61 of 258 skill folders carried `agents/` (observed).

#### 5.4 Validity and internal skills

- **This diverges from Vercel, to keep lenient validity (§1.4).** A skill without a `name` or `description` still installs. It is named by its folder (§3.2) and no warning is shown. Vercel skips such skills with `⚠ Skipped`.
- **Internal skills follow Vercel.** A skill whose frontmatter sets `metadata.internal: true` is left out of "all" (`'*'`, `--all`, `-y`) and out of the menu. It still installs when named. A `--plugin` bundle includes it.

#### 5.5 Repairing installs made under the old rule

An entry recorded as a plugin is reinstalled as a skill on its next update when its source has a `SKILL.md` at the entry's unit root and no `skills/` folder there. The update says so in its output. Real plugins are untouched.

Without this repair, update would replay the recorded plugin type and keep the broken shape. Today the recorded type is never re-derived (`src/nuke-reinstall-pipeline.ts`: "The type is recorded, never re-derived from the clone"). Meanwhile a fresh `add` of the same source would install differently. A repaired entry also moves to its declared-name folder and key (§4.4).

### 6. Units Under Vercel Selection

A **unit** is any of three things:
- a source that reads as a plugin (§5.1), or a plugin member (§5.3);
- a source whose `agntc.json` declares `"type": "plugin"`;
- a `--plugin` bundle.

A unit is one manifest entry. It is installed, updated, removed and version-pinned together. §12 covers updating and removing a skill that sits inside one. Vercel's selection syntax has no notion of a unit. This section is where the two meet.

#### 6.1 A plain add installs a unit whole

A source that reads as a plugin installs as one unit, agents and hooks included, as it does today. **This diverges from Vercel, to keep units (§1.4).** Vercel installs only the skills, each one separately.

#### 6.2 `--plugin` bundles any skills-only source

`--plugin` bundles a skills-only source as one unit. Vercel-style repos count. The bundle holds:
- every skill discovery finds (§5.2), including skills nested in category folders;
- internal skills (§5.4).

The skills install flat, each in its own folder (§4.2). A path in the source narrows the bundle to that folder.

The bundle is reinstalled from the source on every update. A skill the author adds joins it, and a skill the author removes leaves it.

Today `--plugin` copies each child of `skills/` as it stands (`copyAssetDir` in `src/copy-plugin-assets.ts`). On a category-nested repo that would land category folders where skills belong. The bundle takes the skills discovery finds, wherever they sit.

#### 6.3 Without `--plugin`, "all" installs skills separately

On a skills-only source, `-y`, `--skill '*'` and `--all` install each skill as its own entry, as Vercel does. Internal skills are left out (§5.4).

#### 6.4 "All" never splits a unit

`--skill '*'` and `--all` on a source that is a unit install the whole unit, agents and hooks included. This covers a plugin and a repo declaring `"type": "plugin"`. "Everything" is never read as picking every skill one by one.

In a menu that mixes skills and plugin members (§5.3), "all" installs each skill as its own entry and each plugin member whole.

#### 6.5 Picking one skill from a unit

A pick by name (`@skill` or `--skill x`) aimed at a skill inside a unit installs that skill alone. A warning names what the install leaves out: the unit's agents, hooks and other skills. This applies to plugins and to plugin members (§5.3).

**Exception: the pick is refused (§1.5) when the unit's `agntc.json` declares `"type": "plugin"`.** The message names the whole-unit install instead. The declaration means two things:
- On a plugin, `"type": "plugin"` means "keep this whole".
- On a skills-only repo it keeps its existing meaning (bundle by default), and the same refusal applies.

An author whose skills only work together adds `"type": "plugin"` to keep them together.

Accepted risk: a repo whose skills depend on its agents or hooks can still be installed partially when its author never declares `"type": "plugin"`. The warning is the only guard in that case.

#### 6.6 What `--plugin` refuses

- **`--plugin` together with `--skill` or `@skill` is refused (§1.5).** A bundle is the whole source. A path in the source is not a pick, and it works with `--plugin` (§6.2).
- **`--plugin` on a plugin is redundant and changes nothing**, as today.
- **`--plugin` on a single skill (a root `SKILL.md`), or on a source whose members include a plugin member, is refused (§1.5)**, as today (`TypeConflictError` in `detectType`, `src/type-detection.ts`). A source whose members are all skills is skills-only, and `--plugin` bundles it (§6.2). That holds wherever the skills sit, including folders at the repo's top level. Today any source with member folders is refused ("its structure is a collection of N members — cannot bundle").

### 7. Name Matching

#### 7.1 What a name matches

Names are matched case-insensitively and exactly, as Vercel matches them (`filterSkills` in Vercel's `src/skills.ts`).

- **On `add`**, through `@skill`, `-s`/`--skill`:
  - A name matches a skill's declared name (§3). For a skill that declares no name, it matches the folder name.
  - `@skill` and `--skill` names combine into one list, as in Vercel.
  - `'*'` anywhere in that list means all (§6.3, §6.4).
  - An internal skill matches when named (§5.4).
- **On `remove` and `update`**, through positional names and `remove -s`:
  - A name matches an installed skill's declared name or its install folder name (§4.2).
  - A name can also be an agntc key (§12).
- **A name that matches installs from two different repos is refused (§1.5).** The message lists both keys.

A pick that lands inside a unit is covered elsewhere: §6.5 for `add`, §12 for `remove` and `update`.

#### 7.2 A name that matches nothing

A name that matches nothing is refused (§1.5). The message names the unmatched name and lists the alternatives:
- on `add`, the skills the source offers;
- on `remove` and `update`, the installs.

Vercel behaves the same way ("No matching skills found for: X" plus the available list, exit 1). The version-shaped `@` refusal (§2.3) is a special case of this one, with its pointer to `#`.

On a bare add, a name the newest tag lacks but the default branch has is not a miss. The add falls back to the default branch instead (§2.5).

Today `remove` and `update` already exit 1 on a key that matches nothing. `resolveTargetKeys` in `src/resolve-target-keys.ts` reports "Plugin X is not installed."

#### 7.3 Some names match, some don't

When some of the names given match and some don't, the whole command is refused (§1.5). This applies to `add`, `remove` and `update`. Nothing is installed or removed, and the message lists each unmatched name with what is available.

**This diverges from Vercel, under never-silently-ignore (§1.5).** Vercel installs or removes the matches and drops the rest silently, exiting 0. Under `--json` it reports the dropped names as skipped and exits 1.

---

## Working Notes
