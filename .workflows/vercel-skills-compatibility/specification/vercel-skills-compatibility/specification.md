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

---

## Working Notes
