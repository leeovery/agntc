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
  - the skills.sh blob fast path for allowlisted owners. agntc always clones, and the content is the publisher's repo either way;
  - Vercel's security-audit display: the advisory "Security Risk Assessments" table and the audit data behind `--json`'s `security` field, both fed by skills.sh's audit service. agntc calls no skills.sh service, and an advisory table changes nothing about the install (§1.6).

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
- SSH addresses (`git@host:path` and `ssh://` URLs) and `https://….git` URLs, cloned as given with the whole path kept. Vercel clones a `git@host:path` address, an `https://….git` URL and an `ssh://` URL on any other host this way (v1.7.0 `src/source-parser.ts:562–567`, the fallback `{ type: 'git', url: input }`). An `ssh://` URL on github.com or gitlab.com first matches Vercel's GitHub pattern (`:455`) or gitlab.com pattern (`:500`), and Vercel clones it over https instead (`ssh://git@github.com/owner/repo.git` → `https://github.com/owner/repo.git`). **This diverges from Vercel, to keep private repositories working with the user's own git credentials (§1.2):** agntc clones the `ssh://` URL as given. agntc today keeps only two path segments of each: the first two of an SSH address (`parseSshUrl` in `src/source-parser.ts`: `const owner = segments[0]!; const repo = segments[1]!;`) and the last two of an https URL (`parseHttpsUrl`). So `git@gitlab.com:group/subgroup/repo.git` clones `git@gitlab.com:group/subgroup.git`. agntc today also refuses an `ssh://` URL as "too many slashes" (`grep -n "too many slashes" src/source-parser.ts` → line 365, reached through `parseGitHubShorthand`).
- Local paths, as today.

agntc today keeps only the last two path segments of an https URL as owner/repo (`parseHttpsUrl` in `src/source-parser.ts`). So a GitLab subgroup URL or an Azure `_git` URL clones the wrong path.

#### 2.2 Reading an https URL

An http(s) URL is read in Vercel's order:

1. **Direct-download link, refused (§1.5).** These are hosted-artifact links:
   - raw.githubusercontent.com;
   - codeload.github.com;
   - objects.githubusercontent.com;
   - github.com paths under `/archive/`, `/raw/`, `/releases/download/` and `/releases/latest/download/`;
   - gitlab.com paths under `/-/archive/` and `/-/raw/`.

   They are checked first because every such GitHub link also matches the GitHub repo pattern. Read as git, a pasted raw `SKILL.md` link would clone the whole repo. Vercel v1.7.0 checks them at `src/source-parser.ts:398`, before its GitHub repo match at `:455`.
2. **Git source.** Any of these is cloned:
   - GitHub, including the `GH_HOST` host;
   - gitlab.com;
   - a `/-/tree/` URL on any host;
   - an Azure Repos `_git` URL;
   - any URL ending `.git`.
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

**This diverges from Vercel, to protect semver constraints (§1.4).** Vercel has no semver concept: its bare add installs the default branch HEAD, and a `#ref` or tree-URL ref installs that ref (v1.7.0 `src/git.ts:254`, `:301`, `--branch <ref>`). A ref carried in the URL itself (a GitHub tree URL's `<ref>`, a GitLab `/-/tree/<ref>/`, an Azure Repos `?version=`) is read the way the same `#` fragment would be (§2.4). A bare add, meaning one that names no ref or version in either place, keeps agntc's default:

- It installs the newest semver tag and records a caret constraint (`^X.Y.Z`), so updates stay within that major version.
- It installs the default branch when the repo has no semver tags.

A branch is always one explicit fragment away (`#main`).

**Fallback to the default branch.** In two cases the bare add installs from the default branch instead, says so in its output, and records no constraint:
- The newest tag lacks something the line names: a skill selected by `@` or `--skill`, or the path in the source.
- The newest tag holds nothing installable: no skill, and no agent or hook a plugin would install.

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

A `name` that is an empty string counts as no `name`. Vercel treats it as missing (v1.7.0 `src/skills.ts:100`, `!data.name`).

Names and descriptions are read as Vercel reads them (v1.7.0 `sanitizeMetadata`, `src/sanitize.ts:61–65`): terminal escapes are stripped, line breaks become spaces, and leading and trailing whitespace is trimmed. A `name` that is only whitespace therefore trims to an empty declared name and installs into `unnamed-skill` (§4.2), as Vercel's does.

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

When a skill is installed for Claude or Codex by both agntc and Vercel's CLI, both land on the same folder. This shows up as a visible clash through the untracked-files path (§13), not as two copies the agent sees side by side. Cursor is the exception: the two tools keep its copies in different folders (§13).

#### 4.3 One key per skill

A skill installed on its own has exactly one manifest key, `owner/repo/<folder>`, where `<folder>` is its install folder name (§4.2). The key is the same however the skill was selected: from the menu, by `@name`, by `--skill`, by a subpath, or by a tree URL. A skill that is the whole repo (a root `SKILL.md`) keys as `owner/repo`, as it does today.

A plugin member (§5.3) installed on its own has exactly one key, `owner/repo/<path>`, where `<path>` is its folder's path in the repository. The key is the same whether the member was picked from the menu or selected by its path in the source (§7.1). A plugin member at the repository root keys as it does today.

The `owner/repo` part of every key is two segments: the repository's own name and the namespace directly above it, whatever the host.
- GitHub, a `GH_HOST` Enterprise host and a two-segment gitlab.com repository key `owner/repo`, as today.
- A GitLab nested group keys the last two segments of its repository path: `https://gitlab.com/acme/platform/skills` → `platform/skills`. A `/-/tree/` URL's repository path is everything before `/-/`.
- An Azure Repos URL keys the project and the repository; `_git` is a URL marker, not a namespace: `https://dev.azure.com/org/project/_git/repo` → `project/repo`.
- An SSH address, an `ssh://` URL and a `.git` URL key the last two segments of the repository path, with `.git` dropped: `git@gitlab.com:group/subgroup/repo.git` → `subgroup/repo`.
- A local path keys as it does today.

Every key recorded today for a two-segment repository is unchanged. A nested-group or Azure source clones the wrong path today (§2.1), so no working install carries a key from one. The full source is recorded with the entry for cloning and for printed `add` commands (§14.1).

Two sources name the same repository when host and repository path match, whatever form names them: `owner/repo`, its https URL and its SSH address are one repository. A re-add from the same repository is a re-add (§4.4, §8.4), and the entry records the form the re-add was given.

Two different repositories can share a key: a GitHub repository and its Enterprise mirror, the same `owner/repo` on GitHub and GitLab, or two GitLab subgroups both ending `tools/skills`. An install from another repository onto a key an existing install holds is a clash with another managed install (§10.3). It is never read as a re-add of the existing install and never silently replaces it. At a terminal it meets "Remove <key> and continue"; under `-y` or from an agent caller it stops that unit unless `--overwrite` is given. Removing the existing install, either way, hands the key to the new one.

Today one skill can end up with two keys depending on how it was selected. The collection menu keys a member by its folder basename (`owner/repo/composition-patterns`). A tree URL keys it by its full subpath (`owner/repo/skills/composition-patterns`), because `parseDirectPath` in `src/source-parser.ts` builds the key from everything after the ref.

A key is never an install source. A path in a source string is always a path into the repo (§2.1), and agntc never prints a key as a source (§14). `remove` and `update` accept keys (§12).

#### 4.4 Existing installs move on their next update

An existing install moves to its declared-name folder and key on its next update. If the target folder is already occupied, update handles it as §12 sets out.

A re-add reaches an existing install the same way. An install of the same skill from the same repository, made under its old key or folder, is the installed entry for that re-add (§8.4). It moves to its declared-name folder and key, as an update would move it, and keeps every recorded agent. A re-add never installs a second copy beside it.

Before it moves, an existing install is still known by its skill's declared name. `remove` and `update` match it by that name as well as by its folder name and key (§7.1), and a printed `add` names it by that name (§14.1). So `remove vercel-composition-patterns` reaches an install still in `composition-patterns`.

A plugin member recorded under its folder name moves to its path key on its next update. A re-add reaches it under that old key the same way, and it keeps every recorded agent.

The next update makes these moves, and the repair of §5.5, whether or not a newer version is available. An entry already at its target is reinstalled at the version it has: one that is up to date, pinned to an exact tag, or whose newer versions are all outside its constraint. Its pin, constraint or branch stays as it was.

### 5. Discovery and Unit Shape

#### 5.1 Reading a source's shape

Shape is read at the root of what the source points at: the repo root, or the path the source names. The first case that matches decides:

1. **A single skill.** The folder holds a `SKILL.md`. This is Vercel's root early-out, and `--full-depth` turns it off (§5.2). There is one exception, below.
2. **A plugin, installed whole.** Either case below counts:
   - `skills/` beside `agents/` and/or `hooks/`;
   - `agents/` and/or `hooks/` with no `SKILL.md`.

   A folder that holds `SKILL.md` *and* `skills/` beside `agents/`/`hooks/` is a plugin, and its root `SKILL.md` is ignored. The same holds for a folder holding `SKILL.md` beside `agents/` and/or `hooks/` whose `agntc.json` declares `"type": "plugin"`: the author's declaration keeps it whole. A folder holding `SKILL.md` beside `skills/` alone whose `agntc.json` declares `"type": "plugin"` bundles the skills under `skills/` as one unit and leaves the root `SKILL.md` out, as `--plugin` does on that shape (§6.6). **This diverges from Vercel, to keep units (§1.4).** Vercel's root early-out would install such a repo as a single skill. Its agents and hooks would never be routed, and its inner skills would be nested where agents don't load them.
3. **`skills/` only.** By default this is a menu of the skills discovery finds (§5.2). `--plugin`, or `"type": "plugin"` in `agntc.json`, bundles it instead (§6). A path into the repository that names a non-hidden folder of this shape names a skill pack, a plugin member (§5.3), and not a menu. It installs that member whole under its member key (§4.3), as picking it from the menu does, and `--plugin` on it is redundant (§6.6). **This diverges from Vercel, to keep units (§1.4)**, as the member rule does.
4. **Anything else.** Discovery runs (§5.2), and its members form the menu. `--plugin`, or `"type": "plugin"` in `agntc.json`, bundles them instead (§6.2, §6.6).

A source where discovery finds nothing installable is refused (§1.5). Vercel likewise exits 1 when it finds no skills. Today a category-nested repo such as `mattpocock/skills` finds no members, because membership is read one level into `skills/` only (`scanSkillsOnlyMembers` in `src/type-detection.ts`). It then ends "Cancelled — no plugins selected" with exit 0.

#### 5.2 Discovery walk

agntc discovers members where Vercel's discovery finds skills (v1.7.0 `discoverSkills`, `src/skills.ts`), and as deep. Search roots, in priority order:

1. The source root, walked one level.
2. `skills/`, `skills/.curated`, `skills/.experimental` and `skills/.system`, each walked three levels.
3. Vercel's 30 agent directories, each walked three levels: `.agents/skills`, `.claude/skills`, `.cline/skills`, `.codebuddy/skills`, `.codex/skills`, `.commandcode/skills`, `.continue/skills`, `.factory/skills`, `.github/skills`, `.goose/skills`, `.grok/skills`, `.iflow/skills`, `.junie/skills`, `.kilo/skills`, `.kilocode/skills`, `.kimchi/skills`, `.kiro/skills`, `.minimax/skills`, `.mux/skills`, `.neovate/skills`, `.opencode/skills`, `.openhands/skills`, `.pi/skills`, `.posit/assistant/skills`, `.qoder/skills`, `.roo/skills`, `.trae/skills`, `.windsurf/skills`, `.zcode/skills`, `.zencoder/skills`. Measured in `vercel-labs/skills` at `v1.7.0`: `grep -c "^  '\." src/skills.ts` → 30.
4. Skill directories declared in `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json`, walked one level. These manifests are read only to find skills, never as a type signal.

When those roots find nothing, or when `--full-depth` is given, the whole source is walked recursively, five levels deep. That is Vercel's fallback. Under `--full-depth`, a root `SKILL.md` is offered as a skill of its own (keyed `owner/repo`, §4.3) beside the skills found below it, as Vercel offers it (v1.7.0 `src/skills.ts:236–250`).

Priority order is the order the walks reach things:
- the search roots in the order listed, then the fallback walk;
- within one walk, depth-first: a folder is checked for its own `SKILL.md` before the walk goes into it, as Vercel's walks do;
- a folder's children are taken in name order, as agntc's member scan takes them today (`names.sort()` in `src/type-detection.ts`), so "first" never depends on the order the filesystem lists folders in.

Every walk follows these rules:

- It never enters a plugin member (§5.3).
- The walks over the search roots never go below a skill they have found. A folder holding a `SKILL.md` stops them whether or not its skill is offered: an internal skill when no skill is named, a name already taken, or a skill the source's own `skills-lock.json` records all stop the walk there, as in Vercel (v1.7.0 `tryAddSkillAt`, `src/skills.ts:272–281`, returns true for any folder holding a `SKILL.md`). The fallback walk, as Vercel's does (`findSkillDirs`, Vercel's `src/skills.ts:135–153`), keeps descending into a skill's folder, and lists any skill nested inside it as a skill of its own.
- It never descends through `node_modules`, `.git`, `dist`, `build` or `__pycache__`. The walks over the search roots still check a folder of one of those names for a `SKILL.md` of its own, so `skills/build/SKILL.md` is a skill. The fallback walk skips those folders outright. This is how Vercel's walks apply the same list. Measured in `vercel-labs/skills` at `v1.7.0`: `grep -n "SKIP_DIRS" src/skills.ts` → `10` (the list), `149` (the fallback walk's filter, before it enters a folder), `296` (the container walks' test, after `tryAddSkillAt(childDir)` at `292` has checked the folder's own `SKILL.md`).
- It never follows a symlinked directory.
- When two skills declare the same name, the first in priority order is kept. Two installables from one source that would take the same install folder or the same key count as the same name, and the first in priority order is kept. This covers:
  - names that collide only once sanitized: `Foo Bar` and `foo-bar` both install into `foo-bar` (§4.2);
  - a skill and a plugin member that would share a key: a skill declaring `foo` and a member at path `foo` are both `owner/repo/foo` (§4.3).

  A plugin member's place in that order is where the walk reaches it.
- Skills in the source's own agent directories are skipped when the source's own `skills-lock.json` records them as installed. These are skills the author pulled in, not wrote, and Vercel skips them the same way. This is the only time agntc reads a `skills-lock.json` (§13).

#### 5.3 Members

Each folder the walk reaches is classified like this:

- **A folder with `SKILL.md` is a skill.** Everything in it, `agents/` included, is copied with it, and nothing in it is routed as a plugin asset. The exceptions are §5.1's plugin rules, which read a folder the same way wherever it sits, its own `agntc.json` included:
  - a folder that also has `skills/` beside `agents/`/`hooks/` is a plugin;
  - a folder holding `SKILL.md` beside `agents/`/`hooks/` whose own `agntc.json` declares `"type": "plugin"` is a plugin;
  - a folder holding `SKILL.md` beside `skills/` alone whose own `agntc.json` declares `"type": "plugin"` bundles its `skills/` as one unit and leaves its `SKILL.md` out.

  Each is a plugin member, keyed by its path (§4.3), whether it is picked from the menu or named by a path in the source.
- **A non-hidden folder with `skills/`, `agents/` or `hooks/` (and no `SKILL.md`) is a plugin member, installed whole.** This includes a skill pack that holds only `skills/`. Hidden folders are never plugin members, because a clone's `.git` holds `hooks/`. **This diverges from Vercel, to keep units (§1.4).** Vercel sees such folders only as loose skills, or misses them. A pick aimed at a skill inside a plugin member is a pick from a unit (§6).
- **Any other folder** is walked into, within the depth limits of §5.2.

Today a `SKILL.md` beside any asset folder is read as a plugin, and the `SKILL.md` is dropped (`classifyStructure` in `src/type-detection.ts`: "SKILL.md found alongside asset dirs — treating as plugin, SKILL.md will be ignored"). Real skills carry `agents/` for two unrelated reasons:
- OpenAI's `agents/openai.yaml` metadata convention;
- helper prompts the skill reads itself (e.g. `skill-creator`'s `analyzer.md` and `grader.md`).

agntc copies those files into `.claude/agents/` as subagents and loses the skill, and still reports "Installed". In an exploratory run against ten skills.sh leaderboard repos, 61 of 258 skill folders carried `agents/` (observed).

#### 5.4 Validity and internal skills

- **This diverges from Vercel, to keep lenient validity (§1.4).** A skill without a `name` or `description` still installs. It is named by its folder (§3.2) and no warning is shown. Vercel skips such skills with `⚠ Skipped`.
- **Internal skills follow Vercel.** A skill whose frontmatter sets `metadata.internal: true` is left out of "all" (`'*'`, `--all`, `-y`) and out of the menu. It still installs when named. A `--plugin` bundle includes it.
  - When no skill is named, discovery does not find an internal skill at all, as Vercel's does not (v1.7.0 `src/skills.ts:117–122`). It does not count as found when deciding whether the fallback walk runs (§5.2).
  - A source whose only skills are internal therefore finds nothing installable and is refused (§5.1), as Vercel exits 1 finding no skills.
  - A root `SKILL.md` marked internal is not installed by an add that names no skill. Discovery carries on past it into the search roots, as Vercel's does (`src/skills.ts:236–250`).

#### 5.5 Repairing installs made under the old rule

An entry recorded as a plugin is reinstalled as a skill on its next update when its source has a `SKILL.md` at the entry's unit root, no `skills/` folder there, and no `"type": "plugin"` declaration (§5.1). The update says so in its output. Real plugins are untouched.

Without this repair, update would replay the recorded plugin type and keep the broken shape. Today the recorded type is never re-derived (`src/nuke-reinstall-pipeline.ts`: "The type is recorded, never re-derived from the clone"). Meanwhile a fresh `add` of the same source would install differently. A repaired entry also moves to its declared-name folder and key (§4.4).

### 6. Units Under Vercel Selection

A **unit** is any of three things:
- a source that reads as a plugin (§5.1), or a plugin member (§5.3);
- a source whose `agntc.json` declares `"type": "plugin"`;
- a `--plugin` bundle.

A unit is one manifest entry. It is installed, updated, removed and version-pinned together. §12 covers updating and removing a skill that sits inside one. Vercel's selection syntax has no notion of a unit. This section is where the two meet.

Agent targeting (§8) and what is in the way (§10.3) are handled per installed entry, and there a skill installed on its own counts as a unit as well. Its ceiling is the `agents` list in its own `agntc.json`, as a single skill's is today. A clash, or a ceiling that excludes every named agent, stops that skill alone, and the run's other entries proceed.

Within one run, two of the source's installables never write the same path. This applies to every run: inside a `--plugin` bundle (§6.2), and across the entries a run installs, whether they were picked from the menu or selected by "all" (§6.4). A plugin member's skill, agent or hook can land on a path that a skill or member earlier in priority order (§5.2) already takes. Examples are two members that each ship `agents/reviewer.md`, or a member's `skills/x/` beside a loose skill installing into `x`. In that case the earlier one is kept. The output names what was left out and the member it came from, as a pick from a unit names what it leaves out (§6.5). This is the one case where a plugin member installs less than whole.

A later update of such a member leaves out the same paths for as long as another entry from the same repository holds them, and its output names them again. Such a path is never treated as in the way (§12.6). Once no entry holds it, the next update installs it.

#### 6.1 A plain add installs a unit whole

A source that reads as a plugin installs as one unit, agents and hooks included, as it does today. **This diverges from Vercel, to keep units (§1.4).** Vercel installs only the skills, each one separately.

A plugin's skills are the skills discovery finds under its `skills/`, as a bundle's are (§6.2):
- category folders are walked as discovery walks `skills/` (§5.2), and each skill installs flat in its declared-name folder (§4.2);
- a plugin member (§5.3) found under its `skills/` joins it as a bundle's members do (§6.2): the member's skills, agents and hooks are routed to their places;
- nothing else in `skills/` installs, neither a loose file nor a folder holding no skill, and the output names what was left out.

This holds for a source that reads as a plugin, a plugin member (§5.3) and a source declaring `"type": "plugin"`, on `add` and on every update. Today every child of `skills/` is copied as it stands (`copyAssetDir` in `src/copy-plugin-assets.ts`). A category folder then lands one level deeper than agents load skills, and a loose file lands in the agent's skills directory.

#### 6.2 `--plugin` bundles the whole source

`--plugin` bundles a skills-only source as one unit. Vercel-style repos count. The bundle holds:
- every skill discovery finds (§5.2), including skills nested in category folders;
- internal skills (§5.4).

The skills install flat, each in its own folder (§4.2). A path in the source narrows the bundle to that folder.

The bundle is reinstalled from the source on every update. A skill the author adds joins it, and a skill the author removes leaves it.

Anything in the bundled folder that the bundle does not take, a loose file or a folder holding no skill, is not installed, and the output names it, as for a plugin (§6.1). The manifest records a plugin and a bundle alike (§14.1), so `add` and `update` name the same things.

Today `--plugin` copies each child of `skills/` as it stands (`copyAssetDir` in `src/copy-plugin-assets.ts`). On a category-nested repo that would land category folders where skills belong. The bundle takes the skills discovery finds, wherever they sit.

A source that holds plugin members (§5.3) also bundles whole, under `--plugin` or `"type": "plugin"`. Each member's skills, agents and hooks join the bundle and are routed to their places. A bundle that holds agents and hooks is simply a plugin.

The bundle installs within every agent ceiling it holds: the source's own `agntc.json` and each member's. So a member restricted to Claude narrows the whole bundle to Claude.

Today such a member's folder is copied as it stands, so its agents land inside a skill folder, where no agent loads them.

#### 6.3 Without `--plugin`, "all" installs skills separately

On a skills-only source, `-y`, `--skill '*'` and `--all` install each skill as its own entry, as Vercel does. Internal skills are left out (§5.4).

#### 6.4 "All" never splits a unit

`--skill '*'` and `--all` on a source that is a unit install the whole unit, agents and hooks included. This covers a plugin and a repo declaring `"type": "plugin"`. "Everything" is never read as picking every skill one by one.

In a menu that mixes skills and plugin members (§5.3), "all" installs each skill as its own entry and each plugin member whole.

#### 6.5 Picking one skill from a unit

A pick by name (`@skill` or `--skill x`) aimed at a skill inside a unit installs that skill alone. A warning names what the install leaves out: the unit's agents, hooks and other skills. This applies to plugins and to plugin members (§5.3).

A path in the source can also land inside a unit, either at one of its skills (`owner/repo/skills/x`, or a tree URL to that folder) or at a folder of its skills (`owner/repo/skills`). Such a path is handled as a pick by name is, with or without `--plugin`, except that a path at one skill together with `--plugin` is refused, as `--plugin` on any single skill is (§6.6). What it installs carries the same warning, and the line is refused when the unit declares `"type": "plugin"`.

The picked skill installs within the unit's agent ceiling, the `agents` list in the unit's `agntc.json` (§8.2). The output names the agents left out, and a pick whose named agents all fall outside that ceiling is refused, as it would be for the unit itself.

**Exception: the pick is refused (§1.5) when the unit's `agntc.json` declares `"type": "plugin"`.** The message names the whole-unit install instead. The declaration means two things:
- On a plugin, `"type": "plugin"` means "keep this whole".
- On a skills-only repo it keeps its existing meaning (bundle by default), and the same refusal applies.

An author whose skills only work together adds `"type": "plugin"` to keep them together.

Accepted risk: a repo whose skills depend on its agents or hooks can still be installed partially when its author never declares `"type": "plugin"`. The warning is the only guard in that case.

#### 6.6 What `--plugin` refuses

- **`--plugin` together with a named skill (`--skill <name>` or `@skill`) is refused (§1.5).** A bundle is the whole source. `--skill '*'` and `--all` name no skill, so with `--plugin` they install the whole bundle (§6.4). A path in the source is not a pick, and it works with `--plugin` (§6.2).
- **`--plugin` on a plugin is redundant and changes nothing**, as today.
- **`--plugin` on a single skill (a root `SKILL.md`) is refused (§1.5).**
  - **One shape is excepted:** `--plugin` on a root `SKILL.md` beside `skills/` alone bundles the skills under `skills/` and leaves the root `SKILL.md` out, as it does today. Without the flag, or an `agntc.json` declaring `"type": "plugin"` (§5.1), that root reads as a single skill. The flag is the installer's explicit request for the bundle, so lines written today and the bundles already made from that shape keep working.
  - **What `detectType` does today** (`src/type-detection.ts`):
    - it refuses a single skill (`TypeConflictError`) only when its root `SKILL.md` has no `skills/`, `agents/` or `hooks/` beside it;
    - it bundles a root `SKILL.md` beside `skills/` alone;
    - it installs a root `SKILL.md` beside `agents/` or `hooks/` as a plugin, and the flag changes nothing;
    - it bundles a `skills/`-only source whatever its inner folders hold, plugin members included.
  - **One case changes and is now refused:** `--plugin` on a root `SKILL.md` beside `agents/` or `hooks/` that declares no `"type": "plugin"`.

  Any other source bundles whole (§6.2): skills wherever they sit, including folders at the repo's top level, and any plugin members. Today a source with member folders at its top level is refused ("its structure is a collection of N members — cannot bundle").

### 7. Name Matching

#### 7.1 What a name matches

Names are matched case-insensitively and exactly, as Vercel matches them (`filterSkills` in Vercel's `src/skills.ts`).

- **On `add`**, through `@skill`, `-s`/`--skill`:
  - A name matches a skill's declared name (§3). For a skill that declares no name, it matches the folder name.
  - `@skill` and `--skill` names combine into one list, as in Vercel.
  - `'*'` anywhere in that list means all (§6.3, §6.4).
  - An internal skill matches when named (§5.4).
  - A plugin member (§5.3) is not a skill, and no name matches it. It is selected by its path in the source (`owner/repo/<path>`), the form agntc prints for it (§14.1). `--list` (§11.2) and the miss message (§7.2) show each plugin member with that path.
- **On `remove` and `update`**, through positional names and `remove -s`:
  - A name matches an installed skill's declared name or its install folder name (§4.2).
  - A name can also be an agntc key (§12).
- **A name that matches installs from two different repos is refused (§1.5).** The message lists both keys.

A pick that lands inside a unit is covered elsewhere: §6.5 for `add`, §12 for `remove` and `update`.

#### 7.2 A name that matches nothing

A name that matches nothing is refused (§1.5). The message names the unmatched name and lists the alternatives:
- on `add`, the skills the source offers;
- on `remove` and `update`, the installs.

On `add`, Vercel behaves the same way ("No matching skills found for: X" plus the available list, exit 1). On `remove` and `update` it does not refuse: `remove` prints "No matching skills found for: X" with no list, `update` prints "No installed skills found matching: X", and both exit 0. **On `remove` and `update` this diverges from Vercel, under never-silently-ignore (§1.5):** an exit 0 reads as success to an agent caller, which acts on the exit status rather than the text. The version-shaped `@` refusal (§2.3) is a special case of this one, with its pointer to `#`.

On a bare add, a name the newest tag lacks but the default branch has is not a miss. The add falls back to the default branch instead (§2.5).

Today `remove` and `update` already exit 1 on a key that matches nothing. `resolveTargetKeys` in `src/resolve-target-keys.ts` reports "Plugin X is not installed."

#### 7.3 Some names match, some don't

When some of the names given match and some don't, the whole command is refused (§1.5). This applies to `add`, `remove` and `update`. Nothing is installed or removed, and the message lists each unmatched name with what is available.

**This diverges from Vercel, under never-silently-ignore (§1.5).** Vercel installs or removes the matches and drops the rest silently, exiting 0. Under `--json` it reports the dropped names as skipped and exits 1.

### 8. Agent Targeting

agntc drives three agents: Claude, Codex and Cursor. Vercel drives 79. Each agent's install path is set out in §1.6.

#### 8.1 Naming agents

- **`-a`/`--agent <agents…>` accepts Vercel's identifiers and agntc's own.** Vercel's are `claude-code`, `codex` and `cursor`; agntc's own is `claude`. Vercel rejects `--agent claude`; agntc accepts both spellings. The flag is variadic and repeatable, as in Vercel.
- **`'*'` means every agent agntc drives.**
- **Naming an agent agntc doesn't drive is refused (§1.5).** The message lists the three agents it does drive. Vercel refuses a name it doesn't know the same way ("Invalid agents", exit 1).

#### 8.2 The author's ceiling applies per unit

- A unit installs for the named agents that fall within its author's ceiling (the `agntc.json` `agents` list). The output names the agents it left out. Vercel has no ceiling.
- **A single-unit run where the ceiling excludes every named agent is refused (§1.5).**
- **A run installing several units handles that case per unit.** A unit whose ceiling excludes every named agent is skipped with a message. The other units install, and the command exits non-zero so a calling agent sees the partial result. This is the same partial-success reporting `update` uses. Today the multi-unit path skips such a member ("skipped — author restricts to …, none selected", `src/commands/add.ts`) and exits 0. Only a failed member exits non-zero.

#### 8.3 Agents under `-y`

`-y` targets the detected agents that fall within each unit's ceiling.

When none qualifies, the unit installs for every agent within its ceiling. That covers two cases: no agent is detected, or every detected agent is outside the ceiling.

This is Vercel's `-y` adapted to the ceiling. With no agent detected, Vercel installs to every agent it knows.

#### 8.4 A re-add adds agents and never drops them

Re-adding an installed entry adds the agents the re-add names to the agents already recorded. It never drops a recorded agent. How the agents are named makes no difference: by `-a`, through the agent prompt, or through `-y`. With `-y`, the detected agents within the ceiling are added (§8.3).

A version-only re-add, such as `owner/repo#v2.0.0`, reinstalls for every recorded agent. To take an agent away, use `remove -a` (§12).

Today a re-add deletes the entry's files and reinstalls for the chosen agents only. Both the single-unit and the multi-unit paths call `nukeManifestFiles` on the existing entry (`src/commands/add.ts`). So `add … -a cursor` on a Claude install silently deletes Claude's copy. Vercel's `add -a cursor` adds Cursor and leaves Claude alone.

### 9. `add` Flags

Today `add` takes one flag (`grep -rn "\.option(" src/ | grep -v "\.test\.ts"` → one hit, `src/commands/add.ts`, `--plugin`).

#### 9.1 The flag set

`add` takes Vercel's flags with Vercel's meanings, alongside agntc's own two:

| Flag | Meaning | Defined in |
|---|---|---|
| `-a`, `--agent <agents…>` | Target agents | §8 |
| `-s`, `--skill <skills…>` | Select skills by name; `'*'` selects all | §6, §7 |
| `-y`, `--yes` | Answer every prompt that deletes nothing | §10 |
| `--all` | Shorthand for `--skill '*' --agent '*' -y`, as in Vercel | §6.3, §6.4 |
| `-l`, `--list` | List the source's skills and install nothing | §11 |
| `--full-depth` | Turn off the root early-out and walk the whole source | §5.1, §5.2 |
| `--json` | Machine-readable result | §9.2 |
| `--copy` | Accepted with no effect, because agntc always copies (§1.6) | — |
| `--plugin` | agntc's own: bundle the whole source as one unit | §6 |
| `--overwrite` | agntc's own: replace what is in an install's way | §10 |

`add` also takes Vercel's aliases `a`, `i` and `install`.

**Refused (§1.5):**
- `-g`/`--global`, because global installs are out of scope (§1.3);
- `--subagent` and `--metadata`. Vercel documents them for installing to Eve subagents and for attaching JSON to its install telemetry (v1.7.0 `src/cli.ts`). agntc has neither, so accepting them would ignore them silently;
- `--all` together with `-a`/`--agent`, because `--all` already sets every agent. The message names the explicit form, `--skill '*' --agent <agents> -y`;
- any flag agntc does not recognise.

**This diverges from Vercel, under never-silently-ignore (§1.5).** Vercel silently ignores flags it does not know.

#### 9.2 `--json`

`--json` follows Vercel's contract:

- It requires `-y` or `--all`. Without one of them it is refused.
- It cannot be combined with `--list`, and that combination is refused too.
- stdout carries exactly one JSON array and nothing else. Human-facing progress and diagnostics go to stderr.
- The array holds one entry per skill, with Vercel's fields (`AddJsonResult` in Vercel's `src/add.ts`):
  - `name`;
  - `status`, one of `installed`, `skipped` or `failed`;
  - for installed skills, where the install came from and went to: `source`, `ref`, `hash` (the skill folder's content hash, as Vercel computes it), `path`, `scope` (always `project`), `agents`, `mode` (always `copy`) and `security` (always `null`, as Vercel emits it where it holds no security-audit data; the audit display is out of scope, §1.3);
  - for skipped skills, `reason`;
  - for failed skills, `error`.

  Skills installed as part of a unit appear as entries like any other skill.
- A refusal still emits the array, holding one `failed` entry that carries the error.
- The command exits non-zero when any entry failed or was skipped. A skipped entry is, for example, a unit outside every named agent's ceiling (§8.2).

### 10. Unattended Runs

Two kinds of caller run agntc unattended. One is the owner at a terminal. The other is an AI agent running `npx agntc add` in the middle of a task. CI is possible but is not the main case.

An agent caller can make choices but cannot see a prompt. The human's last look is the agent's permission prompt, which shows the command line. A line that states its choices can be reviewed there. A bare `-y` hides what the command will do.

#### 10.1 The prompts an `add` can meet

- Which members to install (`src/collection-select.ts`).
- Which agents (`src/agent-select.ts`). This prompt is skipped when the author declares exactly one agent and that agent is detected.
- A clash with another managed install: "Remove <key> and continue" (`src/collision-resolve.ts`).
- Untracked files in the way: "Overwrite all", confirmed twice (`src/unmanaged-resolve.ts`).
- "Proceed with installation?" (§11). This prompt is new.

Only the two clash prompts delete anything when answered yes. What they agree to delete is removed only once "Proceed with installation?" is answered yes. Answering no there, or cancelling at any prompt, leaves every existing install and file as it was.

#### 10.2 `-y` answers every prompt that deletes nothing

Under `-y`, nothing is asked:
- **Members:** every skill is picked. Internal skills are left out (§5.4), and units follow §6.3–§6.4.
- **Agents:** §8.3.
- **"Proceed with installation?":** answered yes.

The clash prompts are not answered by `-y` (§10.3).

#### 10.3 Replacing what is in the way needs `--overwrite`

**This diverges from Vercel, to keep the owner's stop-and-come-back position.** Vercel never prompts on a clash. It lists the existing folders as `overwrites:` and replaces them. agntc behaves like this instead:

- **Under `-y` (or a detected agent caller, §10.5) without `--overwrite`:** a clash with another managed install, or with untracked files, stops that unit. Nothing is written for it, and what was in the way stays as it was. The message names `--overwrite`, and the command exits non-zero. Other units in the same run proceed.
- **With `--overwrite`:** what is in the way is replaced, and no clash prompt is shown. A clashing managed install is removed, as "Remove <key> and continue" removes it. Untracked files are overwritten. The replacement is then stated in the command line the owner approves.
- **At a terminal without `-y` or `--overwrite`:** the clash prompts work as they do today.

`update` meets an occupied target folder the same way (§12).

#### 10.4 A prompt that cannot be shown stops the command

This rule applies to `add`, to `remove`, and to any prompt `update` reaches. When a prompt cannot be shown, the command is refused (§1.5). Nothing is written or removed. The message names what answers the prompt:

| Prompt | What answers it |
|---|---|
| A confirmation | `-y` |
| `remove`'s picker | Skill names, keys, or `--all` |
| `add`'s choices | `-s`/`--skill`, `-a`/`--agent`, `-y` |
| A clash | `--overwrite` |

Whether a prompt can be shown is decided from the terminal itself, so a run never waits on silent input. A deliberate cancel at a terminal still exits 0.

Today, with no terminal, `add` exits 0 with nothing installed and no message, which reads as success to an agent caller. At end-of-input its first prompt never resolves, because agntc's prompt library (`@clack/prompts`) registers no end-of-input listener. The cancel branch never runs, and the process exits once nothing is left running. With stdin held open but silent, it hangs until killed. `remove` likewise exits 0 with nothing removed and no message: its confirmation and no-argument picker never resolve, so their "Cancelled" branch never runs (`src/commands/remove.ts`). A refusal hung on a prompt's cancel branch would therefore never fire. Whether a prompt can be shown must be decided before the prompt is opened.

Vercel stops with "Interactive prompt required but stdin is not a TTY. Nothing was installed." and "Use --agent <name> (or --agent '*') and -y to run non-interactively.", and exits 1.

#### 10.5 Agent callers behave as `-y`

When agntc runs inside an AI agent, `add` and `remove` behave as if `-y` were given. The agent caller is detected as Vercel detects it: with `@vercel/detect-agent`, plus Vercel's refinement for Cursor. Cursor counts as an agent caller only when `CURSOR_AGENT` is set or `CURSOR_EXTENSION_HOST_ROLE` is `agent-exec`. The reason is that `CURSOR_TRACE_ID` is also present in Cursor's integrated terminal for ordinary users (Vercel's `src/detect-agent.ts`).

When it detects an agent caller, `add` says so in place of its banner, as Vercel does: "Agent detected — installing non-interactively".

- **`add`:** agntc's `-y` (§10.2). Anything in the way still stops the unit unless `--overwrite` is given (§10.3).
- **`remove`:** no confirmation is asked.
- **`update`:** unchanged. Vercel's `update` does not detect agent callers.

A detected agent caller therefore never meets §10.4's refusal for a choice that `-y` answers.

#### 10.6 Hooks get no extra gate

A unit carrying hooks installs under `-y` like any other unit. The pre-install summary lists the hooks it lands (§11). The owner's look at an unattended install is the command line the calling agent asks permission to run. Vercel installs no hooks and has no hook gate.

### 11. Pre-Install Summary

After cloning, `add` today goes straight to its prompts with little context. The branded banner has already shipped (`src/banner.ts`, commit `abfe6c9`). What remains is the information shown after the clone.

#### 11.1 What `add` shows

The display follows Vercel's order and is sized for agntc's three agents rather than Vercel's 79-agent list. It carries no security-risk table (§1.3):

1. **The source and the version** being installed. For a bare add this is the resolved tag, or the default branch, which includes the fallback of §2.5.
2. **The detected shape:**
   - a single skill;
   - a plugin, with its skills, agents and hooks;
   - or N skills. Plugin members (§5.3) are listed with their contents.
3. **Each skill's name and one-line description**, read from its `SKILL.md` (§3). Descriptions are stripped of terminal escapes (§3.3).
4. **The target agents.**
5. **"Proceed with installation?"** This ends an attended `add`, even when no other prompt was shown. At a terminal, a single skill installs without a member prompt. So does a plugin whose one declared agent is detected (§10.1). Without this confirmation, the summary would scroll past mid-install. `-y` and a detected agent caller answer it (§10.2, §10.5).

Hooks a unit installs appear in the summary by name (§10.6).

#### 11.2 `-l` / `--list`

`-l`/`--list` prints the same shape and skill list as §11.1, items 1–3. It installs nothing and exits 0. It needs no terminal, and it is how an agent caller sees a repo's contents before choosing with `--skill` and `-a`. It cannot be combined with `--json` (§9.2).

### 12. `update` and `remove`

Today each command takes one optional manifest key: `owner/repo` or `owner/repo/<member>` (`.argument("[key]", …)` in `src/commands/remove.ts` and `src/commands/update.ts`). Keys are matched by `resolveTargetKeys` in `src/resolve-target-keys.ts`. So a Vercel-style `npx agntc remove vercel-composition-patterns` fails today.

#### 12.1 What the arguments name

Both commands take one or more positional arguments. Each argument is a skill name or an agntc key, matched as §7 sets out. Keys keep today's matching. An entry with exactly that key is taken alone, and a key with no exact entry acts on every entry under it. So `remove owner/repo` removes every entry installed from that repository, unless the repository is itself a single skill keyed `owner/repo` (§4.3). A key that reaches entries from two different repositories (§4.3) is refused (§1.5), and the message lists their keys, as for a name that matches installs from two repositories (§7.1). Each entry stays reachable by its full key. With no argument, the behaviour is as today:
- `update` updates everything;
- `remove` shows its picker. Without a terminal, the picker is refused (§10.4).

#### 12.2 Skills inside a unit

- **`remove <skill>` is refused (§1.5) when the skill sits inside a unit.** This covers a plugin and a `--plugin` bundle. The message names the unit to remove. Units go in whole and come out whole. Vercel never meets this case, because it has no units.
- **`update <skill>` updates the whole unit when the skill sits inside one**, and the output names the unit. A unit is one entry (§6), so there is nothing to split.

#### 12.3 `remove` flags

| Flag | Meaning |
|---|---|
| `-s`, `--skill <skills…>` | Same as positional names. `-s '*'` selects every install but still asks for confirmation. |
| `-y`, `--yes` | Skip the confirmation. |
| `--all` | Remove every install. Implies `-y`, and cannot be combined with names. With `-a`, it removes every install from those agents only, as Vercel's does (v1.7.0 `src/remove.ts:413–415` and `:210–211`). |
| `-a`, `--agent <agents…>` | Remove from those agents only. The entry keeps its other agents. It takes the agent names `add` takes (§8.1) and refuses an agent agntc doesn't drive. |

Removing an entry from every agent it is installed for removes the entry. `remove` also takes the aliases `rm` and `r`. `-g` is refused (§1.3).

#### 12.4 `update` flags and aliases

| Flag | Meaning |
|---|---|
| `upgrade` | Alias of `update`. |
| `-y`, `--yes` | Accepted. |
| `-p` | Accepted with no effect, because project is the only scope. |
| `--overwrite` | Replace what is in a target folder's way (§12.6). Applies to the single-key update and to all-mode. |
| `-g` | Refused (§1.3). |

**`check` is not registered.** In Vercel, `check` is an undocumented alias that runs a full update rather than a read-only check. A pasted `check` is refused (§1.5): it changes nothing, and its message names `check` as not an agntc command. Today the root command takes the word as an extra argument. `node dist/cli.js check` → `error: too many arguments. Expected 0 arguments but got 1.` plus the help, exit 1, never naming `check`.

#### 12.5 `update` keeps the agents chosen at install

**This diverges from Vercel, to keep an update meaning "the same thing, newer".** `update` replays the agents recorded at install, as it does today. Vercel re-detects targets on every update, which means adding Cursor to a project later would quietly widen every later update. Changing targets stays an explicit `add` (§8.4) or `remove -a` (§12.3).

#### 12.6 An occupied target folder

An update can write into a folder or file it did not own before. This happens when:
- an entry moves to its declared-name folder (§4.4);
- an entry is repaired from plugin to skill (§5.5);
- the source gains a skill, agent or hook the entry takes in (§6.2);
- a skill's declared name changes upstream.

The target may already be occupied: by a copy Vercel installed, by the user's own copy, or by another entry's same-named skill. A path a plugin member left out at install because another entry from the same repository holds it (§6) is not one of these. `update` handles this the way `add` does (§10.3):
- **Without `--overwrite`:** `update` stops that entry and leaves the existing install intact. It says why and exits non-zero. This is the partial success across entries that `update` reports today.
- **With `--overwrite`:** `update` replaces what is in the way.

Today the update path has no clash check at all (`grep -n "unmanaged\|collision" src/clone-reinstall.ts src/nuke-reinstall-pipeline.ts src/update-groups.ts src/commands/update.ts` → no hits).

### 13. Coexistence with Vercel-Installed Skills

A project may already hold skills installed by Vercel's CLI. Such an install has three parts:
- a canonical copy in `.agents/skills/<name>`;
- relative symlinks from other agents' directories, for example `.claude/skills/<name>` → `.agents/skills/<name>`;
- a committed `./skills-lock.json`, keyed by declared name.

agntc installs Codex skills into `.agents/skills/` as well. Because identity is now the declared name (§4.2), agntc lands on the same folder names Vercel uses.

- **Skills installed by Vercel are files agntc does not manage.** They take the untracked-files path: the prompt at a terminal, or `--overwrite` when unattended (§10.3).
- **For Cursor the two tools' copies never meet, and agntc warns.** Vercel installs Cursor's copy into `.agents/skills/` (v1.7.0 `src/agents.ts`, cursor `skillsDir: '.agents/skills'`), while agntc installs it into `.cursor/skills/` (§1.6). Cursor reads both folders, so a skill both tools installed appears to it twice. agntc's untracked-files check covers only its own target files (`checkUnmanagedConflicts` in `src/commands/add.ts`), so nothing would say so. When agntc installs a skill for Cursor and `.agents/skills/` already holds a same-named skill agntc does not manage, it installs anyway and warns that Cursor will see two copies. It does not treat that copy as in the way: removing it would delete Vercel's shared copy, which Codex and Vercel's other agents also read.
- **The project's `skills-lock.json` is neither read nor written.** agntc's own manifest is its record. The only `skills-lock.json` agntc ever reads is a source repo's, during discovery (§5.2).
- **A target that is a symlink is replaced as a link, never written through.** Writing into a `.claude/skills/<name>` that links to `.agents/skills/<name>` would otherwise write into Vercel's canonical copy. When the link is replaced, agntc removes the link itself and writes a real copy in its place. The folder the link pointed to is left untouched.
- **Nothing agntc removes is deleted through a link.** A folder an entry recorded may since have been replaced with a link, for example by Vercel's CLI installing the same skill. Such a folder is no longer agntc's copy. `remove` drops the entry, leaves the link and the folder it points to as they are, and says so. `update` treats the link as in its way (§12.6): it stops the entry, or replaces the link as a link under `--overwrite`.

### 14. Printed Commands

#### 14.1 The rule

**Every command agntc prints is one agntc accepts, and following it reproduces the install it advises on.**

- **Printed `add` commands:**
  - name the source in a form that reaches the same repository. The `owner/repo` shorthand is used only for an install that came from GitHub over https: the shorthand itself, the `github:` prefix or a github.com URL. Any other install prints the form it came from: the `gitlab:` prefix or the GitLab or Azure Repos URL, the GitHub Enterprise URL, the `.git` URL, the SSH address or `ssh://` URL (on GitHub too, so a private repository reached only over SSH keeps cloning over SSH, §2.1), or the local path. Where that form takes no `@skill`, the skill is named with `--skill`;
  - carry `--plugin` whenever the entry is a plugin;
  - name the entry's recorded agents with `-a`, so following the command installs for exactly those agents and adds none, at a terminal or from an agent caller (§8.4, §10.5). One command covers only entries recorded for the same agents;
  - name a single skill the way a user selects it, by `@skill` (`owner/repo@skill`), never by manifest key (§4.3);
  - name a plugin member by its path in the repo (`owner/repo/<path>`);
  - where one printed line speaks for several entries, as a bulk update's per-group lines do, name every entry it covers and no other. The group's skills share one command, named with `--skill` (`owner/repo#v2.0.0 --skill a b c`). Each plugin member takes a command of its own, by its path;
  - put versions after `#`, in the `#ref@skill` form where a skill is named (§2.4).
- **Printed `remove` and `update` commands** name the entry the way those commands accept it, by key or skill name (§12.1). They carry no `--plugin`, which `remove` and `update` do not accept.

Carrying `--plugin` whenever the recorded type is plugin never misfires. The manifest records `type: "plugin"` for a plugin and for a `--plugin` bundle alike, without recording which. On a source that already reads as a plugin, `--plugin` is redundant and changes nothing (§6.6).

A recorded plugin that the update repair turns into a skill (§5.5) prints as a skill, with no `--plugin`. Its source now reads as a single skill, which `--plugin` refuses (§6.6).

#### 14.2 Where agntc prints commands today

`grep -rn "npx agntc " src/ | grep -v "\.test\.ts" | grep -v ":[0-9]*:[[:space:]]*\(\*\|//\)" | wc -l` → 7:

| Site | Prints |
|---|---|
| `src/summary.ts` | Caret out-of-constraint: `To upgrade: npx agntc add <repo>` |
| `src/update-render.ts` | All-mode exact pin with newer tags: `npx agntc add <target>@<newest>` |
| `src/commands/update.ts` | Single-key exact pin with newer tags: `npx agntc add <key>@<newest>` |
| `src/clone-reinstall.ts` | Derive-before-delete abort: `npx agntc remove <key> then npx agntc add <key>` |
| `src/commands/update.ts` | `No update performed. Run npx agntc remove <key> to clean up.` |
| `src/nuke-reinstall-pipeline.ts` | ``Run `npx agntc update <key>` to retry installation.`` |
| `src/commands/list.ts` | `Run npx agntc add owner/repo to get started.` (a placeholder, not advice on an install) |

The four `add` advice sites break the rule in two ways today:

- **None carries `--plugin`.** Following the advice for a `--plugin` bundle re-detects a skills-only source and takes the menu path. Its members collide with the bundle's files, and the collision prompt offers to remove the bundle. Completing it converts the bundle into separate members (code read, not run end-to-end).
- **The single-key and abort sites print a manifest key.** For a collection member that key is `owner/repo/<member>`. agntc's parser refuses it today ("too many slashes"). Under §2.1 it would read as a path into the repo, which may not exist. The `@<newest>` suffix is also agntc's previous grammar (§2.3).

---

## Working Notes

## Corrigenda

> **Corrigendum 2026-10-11** (from `planning/vercel-skills-compatibility`): the specification left open what key an install from a repository whose path is not two segments gets (GitLab nested groups, Azure Repos `_git`, SSH and `.git` URLs), and what happens when two different repositories land on one key — corrected: the `owner/repo` part of a key is the repository and the namespace directly above it (§4.3); sources naming the same host and repository path are one repository; an install from another repository onto a held key is a clash with another managed install (§4.3, §10.3); a `remove`/`update` key reaching entries from two repositories is refused (§12.1) — settled by: the decision in discussion `vercel-skills-compatibility`, "The Repository Part of a Key" (2026-10-11).

> **Corrigendum 2026-10-11** (from `planning/vercel-skills-compatibility`): the specification left open what happens when two installables from one source would take the same install folder or key (declared names that collide only once sanitized; a skill and a plugin member sharing `owner/repo/<x>`), or when a member's skill, agent or hook would write a path another installable in the same run takes — corrected: such installables count as the same name and the first in priority order is kept (§5.2); within one run, a member's colliding content is left out with the output naming it and its member (§6) — settled by: derivation from §5.2's first-in-priority-order rule for same-named skills, §4.2/§4.3 making the install folder and key the identity that lands, and §6.5's convention that whatever a unit install leaves out is named.

> **Corrigendum 2026-10-11** (from `planning/vercel-skills-compatibility`): "This applies inside a `--plugin` bundle (§6.2) and across the entries of an "all" run (§6.4)" — corrected: the same-path rule applies to every run, entries picked from the menu included (§6) — settled by: the paragraph's own opening ("Within one run, two of the source's installables never write the same path") and §5.2's priority order, which hold whatever the selection.

> **Corrigendum 2026-10-11** (from `planning/vercel-skills-compatibility`): the specification left open what a later update does with a plugin member installed less than whole — corrected: it leaves out the same paths while another entry from the same repository holds them, names them again, never treats them as in the way, and installs them once no entry holds them (§6, §12.6) — settled by: derivation from §12.5 (an update means the same thing, newer) and the same-path rule's priority ground, under which re-running the install would leave the same paths out.

> **Corrigendum 2026-10-11** (from `planning/vercel-skills-compatibility`): "The `owner/repo` shorthand is used only for GitHub" — corrected: shorthand is printed only for an install that came from GitHub over https; a GitHub install by SSH address or `ssh://` URL prints the form it came from (§14.1) — settled by: §14.1's own rule that following a printed command reproduces the install, §4.3 recording the full source for printed commands, and the decision in discussion `vercel-skills-compatibility`, "`ssh://` URLs on GitHub and GitLab" (private repositories work wherever the user's own git credentials work).

> **Corrigendum 2026-10-11** (from `planning/vercel-skills-compatibility`): "The one exception is §5.1's plugin rule: a folder that also has `skills/` beside `agents/`/`hooks/` is a plugin" — corrected: every §5.1 plugin rule applies to a member folder, its own `"type": "plugin"` included, and each such folder is a plugin member keyed by its path however selected (§5.3) — settled by: §5.1 stating its rules for "a folder", §5.1 rule 3 installing a folder named by a path as the menu pick does, and §4.3's one key however selected.

> **Corrigendum 2026-10-11** (from `planning/vercel-skills-compatibility`): the specification left open an empty or whitespace-only `name`, and whether names are trimmed — corrected: an empty `name` counts as no `name`; names and descriptions are stripped of escapes, have line breaks turned into spaces and are trimmed, so a whitespace-only name installs into `unnamed-skill` (§3.2) — settled by: measurement of Vercel v1.7.0 (`src/skills.ts:100` treats `!data.name` as missing; `src/sanitize.ts:61–65` `sanitizeMetadata` strips, joins lines and trims) under §1.4's rule that Vercel's behaviour is the default on edge cases.

> **Corrigendum 2026-10-12** (from `planning/vercel-skills-compatibility`): the specification left open what a plugin installs from its own `skills/` (§6.1 said only "as it does today") — corrected: a plugin's skills are the skills discovery finds under its `skills/`, as a bundle's are, each flat in its declared-name folder; nothing else in `skills/` installs, and the output names what was left out (§6.1) — settled by: the decision in discussion `vercel-skills-compatibility`, "A Plugin's Own `skills/`" (2026-10-12).

> **Corrigendum 2026-10-12** (from `planning/vercel-skills-compatibility`): the specification left open what happens to a plugin member nested inside a plugin's `skills/` — corrected: it joins the plugin as a bundle's members do, its skills, agents and hooks routed to their places (§6.1) — settled by: §6.1's "as a bundle's are (§6.2)" and §6.2's "Each member's skills, agents and hooks join the bundle and are routed to their places".

> **Corrigendum 2026-10-12** (from `planning/vercel-skills-compatibility`): the specification left open whether a `--plugin` bundle names what it leaves out — corrected: a loose file or a folder holding no skill in the bundled folder is not installed and the output names it, as for a plugin (§6.2) — settled by: §6.1 finding a plugin's skills "as a bundle's are", and §14.1's manifest recording a plugin and a bundle alike, so `add` and `update` could otherwise disagree for one entry.

> **Corrigendum 2026-10-12** (from `planning/vercel-skills-compatibility`): the specification left open how internal skills affect discovery when no skill is named — corrected: discovery does not find them, they do not count toward running the fallback walk, a source whose only skills are internal is refused, and an internal root `SKILL.md` is not installed by an add naming no skill (§5.4) — settled by: measurement of Vercel v1.7.0 (`src/skills.ts:117–122` returns no skill for an internal one unless names are given; `:236–250` carries on past a root skill it does not return).

> **Corrigendum 2026-10-12** (from `planning/vercel-skills-compatibility`): the specification left open the priority order within one search root, the fallback walk's rank, and whether `--full-depth` offers the root `SKILL.md` — corrected: roots in listed order then the fallback, depth-first within a walk, children in name order; under `--full-depth` the root `SKILL.md` is offered beside the nested skills (§5.2) — settled by: measurement of Vercel v1.7.0 (`walkSkillDirs` and `findSkillDirs` in `src/skills.ts` walk depth-first, a folder before its children; the fallback adds only names the roots did not see; `:236–250` keeps the root skill under `fullDepth`), and agntc's existing name-sorted member scan for an order Vercel leaves to the filesystem.

> **Corrigendum 2026-10-12** (from `planning/vercel-skills-compatibility`): the specification left open whether a folder whose skill is not offered (internal, a duplicate name, or recorded in the source's `skills-lock.json`) stops the search-root walks — corrected: any folder holding a `SKILL.md` stops them (§5.2) — settled by: measurement of Vercel v1.7.0 (`tryAddSkillAt`, `src/skills.ts:272–281`, returns true whenever the folder holds a `SKILL.md`, and the container walk does not descend below a true), under §1.4's rule that Vercel's behaviour is the default on edge cases.
