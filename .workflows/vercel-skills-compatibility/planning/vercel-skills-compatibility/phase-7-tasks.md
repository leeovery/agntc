# Phase 7: `@` selects skills; versions move to `#` — 12 tasks

## vercel-skills-compatibility-7-1

### Task vercel-skills-compatibility-7-1: `#` carries constraints, tags and branches

**Problem**: agntc reads a version or ref after `@`: `owner/repo@^1.0` is a semver constraint and `owner/repo@v2.0.0` a tag or branch (`classifyRefOrConstraint` in `src/source-parser.ts`, reached from `parseGitHubShorthand`, from `parseSshUrl`, and from `parseHttpsUrl` through `extractRef`). Vercel's grammar gives `@` to skill selection and carries a ref after `#` (§2.3, §2.4), and agntc reads no `#` at all: `owner/repo#v2.0.0` reaches `parseGitHubShorthand` with `repo#v2.0.0` as the repository name. Once `@` selects skills (tasks 7-3, 7-10), no line could name a version unless `#` carries it, and neither the versioned `add` lines agntc prints (§14.1) nor the `#` lines its refusals point at (§2.3) would be accepted.

**Solution**: The `#` fragment holds what `@` held before (§2.4). A fragment starting with `^` or `~` is a semver constraint: the add installs the best matching tag and records the constraint, which `update` stays within. Any other fragment is a ref, read as a tag or branch the way `@` was read before: an exact tag installs that tag with no constraint recorded, and a branch installs that branch. The fragment is read on every git source form (the prefix, path, URL and SSH forms as on `owner/repo`), so the versioned `add` lines agntc prints for those forms, and the `#` lines a refused version-shaped `@` points at, are accepted. A line with no fragment is a bare add and keeps agntc's default.

**Outcome**: Every version and ref a line names is written after `#`, on every git source form, and installs and updates as the `@` form did.

**Acceptance Criteria**:
- [ ] Given a repository tagged `v1.0.0`, `v1.4.0` and `v2.0.0` with a root SKILL.md, when `add owner/repo#^1.0` runs, it installs `v1.4.0` and the entry records the constraint `^1.0`; when `v1.5.0` is tagged later and `update owner/repo` runs, the entry moves to `v1.5.0` and not to `v2.0.0` (§1.4, §2.4)
- [ ] Given a repository tagged `v1.2.0`, `v1.2.3` and `v1.3.0`, when `add owner/repo#~1.2` runs, it installs `v1.2.3` and the entry records `~1.2` (§2.4)
- [ ] Given the first repository, `add owner/repo#v1.0.0` installs `v1.0.0` and records no constraint though `v2.0.0` is newer, and `add owner/repo#main` installs the head of branch `main` and records no constraint (§2.4)
- [ ] Given `github:owner/repo#v1.0.0`, `gitlab:owner/repo#v1.0.0` and `owner/repo/skills/foo#v1.0.0`, each installs from the repository and path the same line without its fragment names, at `v1.0.0` with no constraint recorded, keyed as that line would key it (§2.4, §14.1)
- [ ] Given `https://gitlab.com/acme/platform/skills#^1.0`, `https://dev.azure.com/org/project/_git/repo#v1.0.0`, `git@github.com:owner/repo.git#v1.0.0`, `ssh://git@git.example.com/team/repo.git#main` and `https://git.example.com/team/repo.git#v1.0.0`, each clones the repository the same line without its fragment names, installs at the constraint, tag or branch its fragment names, and keys the entry as that line would (§2.3, §2.4, §14.1)
- [ ] Given an entry `owner/repo` installed at `v1.0.0` for Claude and Cursor, when `add owner/repo#v2.0.0` runs and only Cursor is ticked at the agent prompt, it reinstalls at `v2.0.0` for Claude and Cursor (§8.4)
- [ ] Given a repository tagged `v1.0.0` and `v1.2.0`, `add owner/repo` installs `v1.2.0` and records `^1.2.0`; given a repository with no semver tags, `add owner/repo` installs the default branch and records no constraint (§2.5)

**Do**:
- Read a fragment starting with `^` or `~` as a constraint and any other fragment as a ref, the way the `@` suffix is read today (`classifyRefOrConstraint` in `src/source-parser.ts`) (§2.4).
- Where the work lives: `parseSource` and the per-form readings in `src/source-parser.ts` (`parseGitHubShorthand`, `parseSshUrl`, `parseHttpsUrl`, and the prefix, path, `ssh://`, GitLab and Azure Repos readings Phase 5 adds); the version resolution in `resolveTagConstraint` (`src/commands/add.ts`); the clone at a ref in `cloneSource` (`src/git-clone.ts`).

**Context**:
> - §2.4: "The `#` fragment holds what `@` held before": `#^1.0`, `#~1.2` — "Semver constraint. Resolves the best matching tag and is recorded for constrained update"; `#v2.0.0` — "Exact tag. No constraint is recorded"; `#main` — "That branch". "A fragment that does not start with `^` or `~` is a ref (a tag or a branch), read the way `@` was read before."
> - §2.5: a bare add, "one that names no ref or version in either place", installs the newest semver tag and records `^X.Y.Z`, or the default branch when the repository has no semver tags. "A ref carried in the URL itself (a GitHub tree URL's `<ref>`, a GitLab `/-/tree/<ref>/`, an Azure Repos `?version=`) is read the way the same `#` fragment would be" (Phase 5).
> - §14.1: printed `add` commands name the source in the form the install came from (the `gitlab:` prefix, a GitLab or Azure Repos URL, a GitHub Enterprise URL, a `.git` URL, an SSH address or `ssh://` URL), name a plugin member by its path (`owner/repo/<path>`), and "put versions after `#`". §2.3: a refused version-shaped `@` points at the same line with `#` in place of that `@`.
> - §8.4: "A version-only re-add, such as `owner/repo#v2.0.0`, reinstalls for every recorded agent." Earlier phases' tasks (task 4-6) write a version re-add as `owner/repo@v2.0.0`, the version form `add` takes until this phase.
> - Related work elsewhere: `#ref@skill` is task 7-4; what `@` means is tasks 7-3, 7-9 and 7-10; `update`'s printed advice is task 7-2; a bare add's fallbacks to the default branch are tasks 5-13, 7-11 and 7-12.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §2.3, §2.4, §2.5, §8.4, §14.1

## vercel-skills-compatibility-7-2

### Task vercel-skills-compatibility-7-2: Update's upgrade advice puts the version after `#`

**Problem**: When an exact-pinned entry has newer tags, `update` prints a re-add command with the version after `@` (§14.2). The single-key path prints `To upgrade: npx agntc add <key>@<newest>` (`runSingleUpdate` in `src/commands/update.ts`), and all-mode prints `… To upgrade: npx agntc add <owner/repo>@<newest>` (`formatNewerTagsLine` in `src/update-render.ts`). Once `@` selects skills (§2.3), that command names a skill called `v2.0.0`, and following it is refused instead of upgrading.

**Solution**: Both advice sites put the version after `#`: `npx agntc add <target>#<newest>`. The rest of each command is unchanged by this task.

**Outcome**: The version in every upgrade command `update` prints is written in the form `add` accepts.

**Acceptance Criteria**:
- [ ] Given an entry `owner/repo` pinned to `v1.0.0` with `v1.1.0` and `v2.0.0` available, when `update owner/repo` runs, it lists the newer tags and prints `To upgrade: npx agntc add owner/repo#v2.0.0`, with no `@v2.0.0` in the command (§2.4, §14.2)
- [ ] Given the same entry, when `update` runs with no argument, its group's newer-tags line ends `To upgrade: npx agntc add owner/repo#v2.0.0`, with no `@v2.0.0` in the command (§2.4, §14.2)
- [ ] Given that entry a root skill installed for Claude, when the printed `npx agntc add owner/repo#v2.0.0` is run, it is accepted and reinstalls the skill at `v2.0.0` for Claude, recording no constraint (§2.4, §14.1)

**Do**:
- Where the work lives: the newer-tags branch of `runSingleUpdate` in `src/commands/update.ts`; `formatNewerTagsLine` in `src/update-render.ts`, called from `emitCollapsedGroupSummary` in `src/commands/update.ts`.

**Context**:
> - §14.2 lists these two of agntc's printed-command sites: "`src/update-render.ts` — All-mode exact pin with newer tags: `npx agntc add <target>@<newest>`" and "`src/commands/update.ts` — Single-key exact pin with newer tags: `npx agntc add <key>@<newest>`", and notes "The `@<newest>` suffix is also agntc's previous grammar (§2.3)."
> - §14.1: printed `add` commands "put versions after `#`, in the `#ref@skill` form where a skill is named (§2.4)". "Every command agntc prints is one agntc accepts, and following it reproduces the install it advises on."
> - The all-mode line's label prefix (`groupLabel`, which can carry an `@intent` suffix, task 6-5) is a display label, not a command, and is untouched here. The caret out-of-constraint footer (`src/summary.ts`) and the derive-before-delete abort (`src/clone-reinstall.ts`) print no version and are untouched here.
> - Related work elsewhere: Phase 15 makes these commands name the source in the form the entry records, a skill by `@skill`/`--skill` and a plugin member by its path, carry `--plugin` and the recorded agents with `-a`, and cover exactly the entries a bulk line speaks for (§14.1). Until then the single-key command still names the entry's key, which for a collection member is not a source line.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §2.3, §2.4, §14.1, §14.2

## vercel-skills-compatibility-7-3

### Task vercel-skills-compatibility-7-3: `@` selects a skill by its declared name

**Problem**: Vercel's `owner/repo@skill` selects the skill named `skill` (§2.3). agntc reads `@X` as a ref, or as a semver constraint when `X` starts with `^` or `~` (`classifyRefOrConstraint` in `src/source-parser.ts`). A pasted Vercel line `owner/repo@some-skill` therefore fails on a missing ref, or installs the wrong thing when a branch or tag of that name exists (§2.3).

**Solution**: On the `owner/repo` shorthand and on `github:owner/repo`, the forms on which Vercel reads `@` as a skill (§2.3), `@name` selects the skill whose declared name matches `name`, case-insensitively and exactly (§7.1). A skill that declares no name is matched by its folder name; a skill that declares one is not matched by its folder name. The selected skill installs alone with no member prompt, wherever discovery found it, into the install folder and under the key a menu pick gives it (§4.2, §4.3). A repository whose root holds a SKILL.md offers that single skill (§5.1), matched by its declared name and keyed `owner/repo`. On these forms `@` is never read as a ref or a version.

**Outcome**: A pasted Vercel `owner/repo@skill` line installs exactly that skill, as Vercel's CLI would.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags whose `skills/taste-skill/SKILL.md` declares `design-taste-frontend`, beside other skills, when `add owner/repo@Design-Taste-Frontend` runs installing for Claude, no member prompt is shown and that skill alone installs into `.claude/skills/design-taste-frontend/` under key `owner/repo/design-taste-frontend` (§4.3, §7.1)
- [ ] Given the same repository, `add owner/repo@taste-skill` (its folder name) and `add owner/repo@design-taste` (part of its declared name) each install nothing and exit non-zero (§7.1)
- [ ] Given the same repository also holding `skills/frontend/react/SKILL.md` declaring `react`, `add owner/repo@react` installs it flat into `.claude/skills/react/` under `owner/repo/react` (§4.2, §4.3, §5.2)
- [ ] Given `skills/plain/SKILL.md` with no frontmatter, `add owner/repo@plain` installs it into `.claude/skills/plain/` under `owner/repo/plain` (§3.2, §7.1)
- [ ] Given a repository with no semver tags whose default branch holds a skill declaring `docs`, and which also has a branch named `docs` holding different content, `add owner/repo@docs` installs the skill from the default branch and records no ref `docs` (§2.3)
- [ ] Given `github:owner/repo@design-taste-frontend`, it installs that skill under `owner/repo/design-taste-frontend`, as `owner/repo@design-taste-frontend` does (§2.3, §4.3)
- [ ] Given a repository whose root SKILL.md declares `foo-skill`, `add owner/repo@foo-skill` installs it into `.claude/skills/foo-skill/` under key `owner/repo` (§4.3, §5.1)

**Do**:
- Read `@` as a skill selection on the shorthand and `github:` forms, as Vercel v1.7.0 does (`src/source-parser.ts:378`, `:529`) (§2.3). Match names case-insensitively and exactly, as Vercel's `filterSkills` (`src/skills.ts`) does (§7.1).
- Where the work lives: `parseGitHubShorthand` and `classifyRefOrConstraint` in `src/source-parser.ts`, and the `github:` reading Phase 5 adds; the menu path `runCollectionPipeline` in `src/commands/add.ts`, which offers the menu through `selectCollectionPlugins` (`src/collection-select.ts`); member keys from `memberKey` in `src/commands/add.ts`.

**Context**:
> - §2.3: "`owner/repo@skill` selects the skill named `skill`. A skill's name is its declared name (§3), and §7 covers how names match. This is Vercel's grammar: `@` never carries a version or a ref."
> - §7.1: on `add`, "A name matches a skill's declared name (§3). For a skill that declares no name, it matches the folder name." "Names are matched case-insensitively and exactly, as Vercel matches them."
> - §4.3: a skill installed on its own keys `owner/repo/<folder>`, its install folder, "however the skill was selected: from the menu, by `@name`, by `--skill`, by a subpath, or by a tree URL. A skill that is the whole repo (a root `SKILL.md`) keys as `owner/repo`."
> - §3.2: the declared name is read as Vercel reads it, escapes stripped, line breaks as spaces and trimmed (task 1-9); names match against that cleaned name.
> - Until this task, `add` reads a version after `@` on the shorthand; task 7-1 gives versions `#`.
> - Related work elsewhere: the message for a name that matches nothing, and plugin members matching no name, are task 7-8; version-shaped `@` values are tasks 7-9 and 7-10, and `@` after an SSH address, an https URL, `gitlab:` or `ssh://` is task 7-10 (those forms take no `@skill`, §14.1); `--skill` is task 7-5; the version a bare add with `@skill` installs, and its fallback to the default branch, is task 7-11. A pick that lands inside a plugin or plugin member, and `--plugin` with a named skill, are Phase 8 (§6.5, §6.6).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §2.3, §3.2, §4.2, §4.3, §5.1, §5.2, §7.1

## vercel-skills-compatibility-7-4

### Task vercel-skills-compatibility-7-4: `#ref@skill` installs the named skill at that ref

**Problem**: With `@` selecting a skill (task 7-3) and `#` carrying the version (task 7-1), a line that names both needs one form. Without it, a pick of one skill at a pinned tag, a constraint or a branch has no line, and the form agntc prints for a versioned skill pick (`owner/repo#<ref>@<skill>`, §14.1) would not be accepted.

**Solution**: A fragment `#<ref>@<skill>` carries both (§2.4). The part before `@` is read as any fragment is (task 7-1), and the part after selects a skill as `@` does (task 7-3). `#v2.0.0@skill` installs that skill at that tag with no constraint recorded, `#^1.0@skill` installs it at the best matching tag and records the constraint, and `#main@skill` installs it from that branch.

**Outcome**: One line names a skill and the version to install it at.

**Acceptance Criteria**:
- [ ] Given a repository tagged `v1.0.0`, `v1.4.0` and `v2.0.0`, each holding `skills/taste-skill/` declaring `design-taste-frontend` beside other skills, when `add owner/repo#v1.0.0@design-taste-frontend` runs installing for Claude, no member prompt is shown and that skill alone installs at `v1.0.0` into `.claude/skills/design-taste-frontend/` under `owner/repo/design-taste-frontend`, with no constraint recorded (§2.4, §4.3)
- [ ] Given the same repository, `add owner/repo#^1.0@design-taste-frontend` installs the skill at `v1.4.0` and records `^1.0`; when `v1.5.0` is tagged later and `update` runs, the entry moves to `v1.5.0` and not to `v2.0.0` (§1.4, §2.4)
- [ ] Given the same repository, `add owner/repo#main@design-taste-frontend` installs the skill from branch `main` and records no constraint (§2.4)
- [ ] Given `github:owner/repo#v1.0.0@design-taste-frontend`, it installs the same skill at `v1.0.0` under the same key (§2.3, §2.4)

**Do**:
- Where the work lives: `parseGitHubShorthand` and the `github:` reading in `src/source-parser.ts`, beside the fragment reading of task 7-1 and the `@` selection of task 7-3.

**Context**:
> - §2.4: "`#ref@skill` combines a ref with a skill selection, for example `owner/repo#v2.0.0@skill`."
> - §14.1: printed `add` commands "name a single skill the way a user selects it, by `@skill` (`owner/repo@skill`)" and "put versions after `#`, in the `#ref@skill` form where a skill is named (§2.4)". Where the source form takes no `@skill`, the skill is named with `--skill` (task 7-5). Phase 15 prints these lines.
> - Related work elsewhere: an add naming a `#` ref or constraint never falls back to the default branch, so a skill the named ref lacks is a miss (task 7-11).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §2.3, §2.4, §4.3, §14.1

## vercel-skills-compatibility-7-5

### Task vercel-skills-compatibility-7-5: `--skill` names the skills to install

**Problem**: Vercel's `add` selects skills by name with `-s`/`--skill <skills…>`, and its `@` and `--skill` names combine into one list (§7.1, §9.1). `add` takes one flag today (`--plugin`, on `addCommand` in `src/commands/add.ts`), so a Vercel line using `--skill` is rejected. The source forms that take no `@skill`, such as an SSH address or a `gitlab:` line, have no way at all to select a skill (§14.1).

**Solution**: `add` takes `-s`/`--skill` with one or more names. Each name matches as an `@` name does (§7.1). Names from `@` and `--skill` form one list, and each named skill installs as its own entry with no member prompt, keyed as a menu pick is (§4.3). `--skill` works on every source form, including those that take no `@skill`, and together with a `#` version.

**Outcome**: A Vercel line selecting skills with `--skill` installs exactly those skills, from any source form.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags holding skills declaring `a`, `b`, `c` and `d`, when `add owner/repo --skill a b` runs installing for Claude, no member prompt is shown, `a` and `b` install as two entries, `owner/repo/a` and `owner/repo/b`, and nothing else installs (§4.3, §7.1, §9.1)
- [ ] Given the same repository, `add owner/repo -s a` installs `a` alone (§9.1)
- [ ] Given the same repository, `add owner/repo@a --skill b c` installs exactly `a`, `b` and `c`, as three entries (§7.1)
- [ ] Given a skill in folder `skills/taste-skill/` declaring `design-taste-frontend`, `--skill DESIGN-TASTE-FRONTEND` installs it under `owner/repo/design-taste-frontend`, and `--skill taste-skill` installs nothing and exits non-zero (§4.3, §7.1)
- [ ] Given a repository tagged `v1.0.0` and `v2.0.0` holding `a`, `b` and `c`, `add owner/repo#v1.0.0 --skill a b` installs `a` and `b` at `v1.0.0` with no constraint recorded (§2.4, §14.1)
- [ ] Given `git@github.com:owner/repo.git --skill a` and `gitlab:owner/repo --skill a`, each installs `a` alone under `owner/repo/a` (§7.1, §14.1)

**Do**:
- The flag is `-s`, `--skill <skills…>`, as in Vercel (§9.1), and its names join the `@` names in one list, as in Vercel (§7.1).
- Where the work lives: `addCommand` and `runAdd` in `src/commands/add.ts`, and the menu path `runCollectionPipeline` there.

**Context**:
> - §9.1: "`-s`, `--skill <skills…>` — Select skills by name; `'*'` selects all — §6, §7".
> - §7.1: on `add`, names come "through `@skill`, `-s`/`--skill`"; "`@skill` and `--skill` names combine into one list, as in Vercel."
> - §4.3: a skill installed on its own has exactly one key, `owner/repo/<folder>`, "however the skill was selected: from the menu, by `@name`, by `--skill`, …".
> - §14.1: "Where that form takes no `@skill`, the skill is named with `--skill`"; a bulk line's skills "share one command, named with `--skill` (`owner/repo#v2.0.0 --skill a b c`)".
> - Related work elsewhere: `'*'` is task 7-6; naming an internal skill is task 7-7; names that match nothing are task 7-8; a bare add's fallback for a `--skill` name is task 7-11. `--plugin` with a named skill is refused, and a name landing inside a unit is a pick from it (Phase 8, §6.5, §6.6); the unknown-flag refusal is Phase 12 (§9.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §2.4, §4.3, §7.1, §9.1, §14.1

## vercel-skills-compatibility-7-6

### Task vercel-skills-compatibility-7-6: `'*'` selects every skill that is not internal

**Problem**: Vercel's `--skill '*'` selects every skill, which is how a line installs a whole skills-only repository as separate skills without a menu (§6.3, §7.1). Read as a name, `'*'` would match no skill and the line would be refused as a miss (task 7-8).

**Solution**: `'*'` anywhere in the combined `@`/`--skill` list means all (§7.1). On a skills-only source, each skill discovery finds installs as its own entry with no member prompt, internal skills left out (§5.4, §6.3). `'*'` names no skill (§6.6), so discovery runs as it does for an add that names no skill: internal skills are not found, they do not count toward running the fallback walk, and a source whose only skills are internal is refused as finding nothing installable (§5.1, §5.2, §5.4).

**Outcome**: `--skill '*'` installs every non-internal skill of a skills-only source as its own entry, as Vercel does.

**Acceptance Criteria**:
- [ ] Given a skills-only repository with no semver tags holding `skills/a/`, `skills/b/` and the category-nested `skills/frontend/react/`, when `add owner/repo --skill '*'` runs installing for Claude, no member prompt is shown, and `a`, `b` and `react` install as three entries, `owner/repo/a`, `owner/repo/b` and `owner/repo/react`, each flat in its own folder (§4.3, §6.3, §7.1)
- [ ] Given the same repository, `add owner/repo --skill a '*'` and `add owner/repo@a --skill '*'` install the same three entries (§7.1)
- [ ] Given `skills/secret/`, whose frontmatter sets `metadata.internal: true`, beside `skills/a/` and `skills/b/`, `add owner/repo --skill '*'` installs `a` and `b` and not `secret` (§5.4, §6.3)
- [ ] Given a source whose search roots hold only the internal `skills/secret/SKILL.md`, and which holds `docs/x/guide/SKILL.md` that only the fallback walk reaches, `add owner/repo --skill '*'` installs `guide` and not `secret` (§5.2, §5.4)
- [ ] Given a repository with no semver tags whose only skills are internal, `add owner/repo --skill '*'` exits non-zero, writes no file and no manifest entry, and says nothing installable was found (§1.5, §5.1, §5.4)

**Do**:
- Where the work lives: the name list of tasks 7-3 and 7-5 (`runAdd` and `runCollectionPipeline` in `src/commands/add.ts`); discovery's handling of internal skills when no skill is named, from task 2-9 (`src/type-detection.ts`).

**Context**:
> - §7.1: "`'*'` anywhere in that list means all (§6.3, §6.4)."
> - §6.3: "On a skills-only source, `-y`, `--skill '*'` and `--all` install each skill as its own entry, as Vercel does. Internal skills are left out (§5.4)." §6.6: "`--skill '*'` and `--all` name no skill".
> - §5.4: an internal skill "is left out of 'all' (`'*'`, `--all`, `-y`) and out of the menu." "When no skill is named, discovery does not find an internal skill at all … It does not count as found when deciding whether the fallback walk runs (§5.2)." "A source whose only skills are internal therefore finds nothing installable and is refused (§5.1)."
> - Related work elsewhere: `'*'` on a source that is a unit installs the whole unit, on a menu mixing skills and plugin members it installs each member whole (§6.4), and with `--plugin` it installs the whole bundle (§6.6): Phase 8. `-y` is Phase 11 and `--all` Phase 12. A bare add whose newest tag holds only internal skills falls back to the default branch (task 7-12).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §4.3, §5.1, §5.2, §5.4, §6.3, §6.6, §7.1

## vercel-skills-compatibility-7-7

### Task vercel-skills-compatibility-7-7: An internal skill installs when named

**Problem**: A skill whose frontmatter sets `metadata.internal: true` is hidden from the menu and from "all" (tasks 2-9, 2-10, 7-6), but Vercel installs it when it is named (§5.4). Without that, an internal skill could never be installed, and a repository whose root SKILL.md is internal could not install that skill at all.

**Solution**: When a line names skills by `@` or `--skill`, discovery finds internal skills, as Vercel's does when names are given (§5.4). An internal skill a name matches installs as any named skill does (§7.1). With a name given, a root SKILL.md marked internal is the root early-out again (§5.1): the repository offers that single skill, keyed `owner/repo`. Internal skills the search roots reach count as found when deciding whether the fallback walk runs (§5.2).

**Outcome**: Naming an internal skill installs it, while an add that names no skill still never offers it.

**Acceptance Criteria**:
- [ ] Given a skills-only repository with no semver tags holding `skills/a/` and `skills/secret/`, whose frontmatter sets `metadata.internal: true`, when `add owner/repo@secret` runs installing for Claude, `secret` alone installs into `.claude/skills/secret/` under `owner/repo/secret`; `add owner/repo --skill secret a` installs both, as two entries (§5.4, §7.1)
- [ ] Given a repository with no semver tags whose root SKILL.md declares `root-tool` and sets `metadata.internal: true`, and which also holds `skills/a/` and `skills/b/`, `add owner/repo@root-tool` and `add owner/repo --skill root-tool` each install it as a single skill into `.claude/skills/root-tool/` under key `owner/repo` (§4.3, §5.1, §5.4)
- [ ] Given the same repository, `add owner/repo@a` installs nothing and exits non-zero as a miss naming `a`, and the skills it lists are `root-tool` alone: with a name given, the root SKILL.md is the single skill the repository offers (§5.1, §5.4, §7.2)
- [ ] Given a repository with no semver tags whose search roots hold only the internal `skills/secret/SKILL.md`, and which holds `docs/x/guide/SKILL.md` that only the fallback walk reaches, `add owner/repo@secret` installs `secret`, while `add owner/repo@guide` installs nothing and exits non-zero: with a name given, `secret` counts as found and the fallback walk does not run (§5.2, §5.4)

**Do**:
- Find internal skills when names are given, as Vercel v1.7.0's discovery does (`src/skills.ts:117–122`) (§5.4).
- Where the work lives: discovery's internal-skill handling from task 2-9 and the internal root early-out from task 2-10 (`classifyStructure` in `src/type-detection.ts`), reached with the names of tasks 7-3 and 7-5.

**Context**:
> - §5.4: "Internal skills follow Vercel. A skill whose frontmatter sets `metadata.internal: true` is left out of "all" … and out of the menu. It still installs when named." "When no skill is named, discovery does not find an internal skill at all, as Vercel's does not (v1.7.0 `src/skills.ts:117–122`)." "A root `SKILL.md` marked internal is not installed by an add that names no skill. Discovery carries on past it into the search roots" (task 2-10).
> - §5.1: "The first case that matches decides: 1. A single skill. The folder holds a `SKILL.md`. This is Vercel's root early-out". Only an add that names no skill carries on past an internal root (§5.4).
> - §7.1: "An internal skill matches when named (§5.4)."
> - §5.2: "Whether the roots found anything is judged as Vercel judges it: by whether its walks of those roots would find a skill." The specification's corrigenda record Vercel v1.7.0's measurement: `src/skills.ts:117–122` returns no skill for an internal one unless names are given, and a returned skill is found.
> - §4.3: "A skill that is the whole repo (a root `SKILL.md`) keys as `owner/repo`."
> - Related work elsewhere: an add naming no skill hides internal skills (tasks 2-9, 2-10), and `'*'` names no skill (task 7-6). A `--plugin` bundle takes internal skills whether or not any is named (Phase 3). The miss refusal and its list are task 7-8.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §5.1, §5.2, §5.4, §7.1, §7.2

## vercel-skills-compatibility-7-8

### Task vercel-skills-compatibility-7-8: A name that matches nothing refuses the whole line

**Problem**: On `add`, Vercel refuses names that match nothing ("No matching skills found for: X" plus the available list, exit 1), but when only some names match it installs those and drops the rest silently, exiting 0 (§7.2, §7.3). agntc refuses wherever Vercel drops part of a line without saying so (§1.5). Without a refusal that lists the alternatives, a mistyped name gives an agent caller nothing to correct from, and a partial match installs part of what the line asked for and reads as success.

**Solution**: When any name in the combined `@`/`--skill` list matches nothing the source offers, the whole command is refused before anything is written or removed (§1.5, §7.3). The message names each unmatched name and lists the skills the source offers (§7.2). A plugin member is not a skill: no name matches one, not even its folder name, and the list shows it as `owner/repo/<path>`, the path that selects it (§7.1).

**Outcome**: Every name in an `add` line matches, or the line installs nothing and says what was available.

**Acceptance Criteria**:
- [ ] Given a repository with no semver tags holding skills declaring `react` and `vue`, when `add owner/repo --skill nope` runs, it exits non-zero, writes no file and no manifest entry, and its message names `nope` and lists `react` and `vue` (§1.5, §7.2)
- [ ] Given the same repository, `add owner/repo --skill react nope` installs nothing, `react` included, and its message names `nope` with `react` and `vue` as available; `add owner/repo@nope --skill react` and `add owner/repo@react --skill nope` are refused the same way (§7.1, §7.3)
- [ ] Given the same repository, `add owner/repo --skill nope missing` is refused and its message names both `nope` and `missing` (§7.3)
- [ ] Given a repository with no semver tags whose top-level folder `tools/` holds `agents/` and no SKILL.md, beside `skills/react/`, `add owner/repo@tools` and `add owner/repo --skill tools` are each refused, and the list shows `react` and `owner/repo/tools` (§5.3, §7.1, §7.2)
- [ ] Given a repository with no semver tags whose root SKILL.md declares `foo-skill` and which also holds `skills/a/SKILL.md`, `add owner/repo@a` is refused and the list names `foo-skill` (§5.1, §7.2)
- [ ] Given `react` already installed from that repository, when `add owner/repo --skill react nope` is refused, the installed `react`'s files and manifest entry are unchanged (§1.5, §7.3)

**Do**:
- Where the work lives: the name matching of tasks 7-3 and 7-5, ahead of the install steps of `runAdd` and `runCollectionPipeline` (`src/commands/add.ts`).

**Context**:
> - §7.2: "A name that matches nothing is refused (§1.5). The message names the unmatched name and lists the alternatives: on `add`, the skills the source offers". On `add`, Vercel behaves the same way ("No matching skills found for: X" plus the available list, exit 1).
> - §7.3: "When some of the names given match and some don't, the whole command is refused (§1.5). This applies to `add`, `remove` and `update`. Nothing is installed or removed, and the message lists each unmatched name with what is available." This diverges from Vercel under never-silently-ignore.
> - §7.1: "A plugin member (§5.3) is not a skill, and no name matches it. It is selected by its path in the source (`owner/repo/<path>`), the form agntc prints for it (§14.1). `--list` (§11.2) and the miss message (§7.2) show each plugin member with that path."
> - §5.1: a folder holding a SKILL.md reads as a single skill (Vercel's root early-out, turned off only by `--full-depth`), so a repository with a root SKILL.md offers that skill alone.
> - §1.5: a refusal exits non-zero, writes nothing and removes nothing, and its message names what was refused and the way through where one exists.
> - Related work elsewhere: on a bare add, a name the newest tag lacks but the default branch has is not a miss, and a miss is read at the default branch (task 7-11); a version-shaped `@` miss also points at `#` (tasks 7-9, 7-10). A name aimed at a skill inside a plugin or plugin member is a pick from that unit (Phase 8, §6.5). `remove` and `update` misses are Phase 13; under `--json` a refusal emits a `failed` entry (Phase 12); how a member's path prints for a source not on GitHub is Phase 15 (§14.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §5.1, §5.3, §7.1, §7.2, §7.3

## vercel-skills-compatibility-7-9

### Task vercel-skills-compatibility-7-9: A version-shaped `@` value that matches no skill points at `#`

**Problem**: Lines written for agntc's previous grammar carry a version after `@`: `owner/repo@v2.0.0`, `owner/repo@^1.0`. Once `@` selects skills (task 7-3), such a line is a miss, and a plain list of the source's skills gives its author no route to the version the line meant (§2.3).

**Solution**: On the forms where `@` selects a skill, the `owner/repo` shorthand and `github:`, an `@` value that looks like a version and matches no skill is refused, and the message points at the same line with `#` in place of the `@` (§2.3). A value looks like a version when it is a `^` or `~` range, or a semver-shaped tag: one agntc already reads as a version tag, so `v2.0.0` and `2.0.0` are while `v2` and `1.0` are not. The refusal is a miss like any other (§7.2), with the pointer added. A version-shaped value that a skill's declared name matches selects that skill. A value that is not version-shaped, such as `main`, `v2` or `1.0`, is a plain miss with no pointer.

**Outcome**: Every shorthand version line written for agntc's previous grammar is refused with the `#` line that installs it.

**Acceptance Criteria**:
- [ ] Given a repository tagged `v1.0.0` and `v2.0.0` whose tags and default branch hold skills declaring `react` and `vue`, and no skill named after a version, when `add owner/repo@v2.0.0` runs, it exits non-zero, writes no file and no manifest entry, and its message names `v2.0.0`, lists `react` and `vue`, and points at `owner/repo#v2.0.0` (§1.5, §2.3, §7.2)
- [ ] Given the same repository, `add owner/repo@2.0.0` points at `owner/repo#2.0.0`, `add owner/repo@^1.0` at `owner/repo#^1.0`, and `add owner/repo@~1.2` at `owner/repo#~1.2` (§2.3)
- [ ] Given the same repository, `add owner/repo@v2` and `add owner/repo@1.0` are each refused as a miss naming the value and listing `react` and `vue`, with no pointer at `#` (§2.3, §7.2)
- [ ] Given the same repository, which has a branch `main`, `add owner/repo@main` is refused as a miss naming `main` and listing `react` and `vue`, with no pointer at `#` (§2.3, §7.2)
- [ ] Given the same repository, `add github:owner/repo@v2.0.0` points at `github:owner/repo#v2.0.0` (§2.3)
- [ ] Given the same repository, when the line the message points at, `owner/repo#v2.0.0`, is run, it installs `v2.0.0` (§2.4, §14.1)
- [ ] Given a repository holding a skill whose declared name is `v2.0.0`, `add owner/repo@v2.0.0` installs that skill (§2.3, §7.1)

**Do**:
- A value is version-shaped when it starts with `^` or `~`, or when `isVersionTag` (`src/version-resolve.ts`) accepts it (§2.3).
- Where the work lives: the miss refusal of task 7-8, for the `@` values task 7-3 reads on the shorthand and `github:` forms (`src/source-parser.ts`, `src/commands/add.ts`).

**Context**:
> - §2.3: "Some `@` values look like a version: a `^`/`~` range, or a semver-shaped tag such as `v2.0.0`. A semver-shaped tag is one agntc already reads as a version tag (`isVersionTag` in `src/version-resolve.ts`, semver's `clean()`): `v2.0.0` and `2.0.0` are, while `v2` and `1.0` are not and take no pointer. Such a value that matches no skill is refused (§1.5), and the message points at the `#` form (§2.4). This is the migration path for lines written in agntc's previous grammar."
> - §7.2: "The version-shaped `@` refusal (§2.3) is a special case of this one, with its pointer to `#`." The miss lists the skills the source offers (task 7-8).
> - §14.1: "Every command agntc prints is one agntc accepts"; task 7-1 makes the pointed-at `#` line install.
> - Related work elsewhere: the same refusal after the repository path of an SSH address or https URL is task 7-10. On a bare add, a name is a miss only when neither the newest tag nor the default branch holds it, and the miss is read at the default branch (task 7-11).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §2.3, §2.4, §7.1, §7.2, §14.1

## vercel-skills-compatibility-7-10

### Task vercel-skills-compatibility-7-10: A version-shaped `@` after an SSH address or https URL points at `#`

**Problem**: agntc's previous grammar also read `@` as a ref or constraint after the repository path of an SSH address or an https URL (`parseSshUrl` and `extractRef` in `src/source-parser.ts`), so lines such as `git@github.com:owner/repo.git@v1.2.0` and `https://gitlab.com/group/repo@^1.0` are in use (§2.3). These forms take no `@skill` (§14.1). Vercel keeps such an `@` in the address and clones the line as given, so the clone fails without naming `#` (§2.3).

**Solution**: Diverging from Vercel, to keep the migration path for every line the previous grammar wrote (§1.4, §2.3): after the repository path of an SSH address (`git@host:path`, with or without `.git`) or of an https URL, a version-shaped `@` value (a `^` or `~` range, or a semver-shaped tag as task 7-9 reads it) is refused, and the message points at the same line with `#` in place of that `@`. Where that line would itself be refused as a website source (§2.2), as a self-hosted https URL without `.git` is, the message points instead at its `.git` URL with `#` in place of that `@`, the repository the previous grammar cloned at that ref. The value is never matched against the source's skills. The user part of an address (`git@`, `https://deploy@…`) belongs to the address and is not that `@`. A value that is not version-shaped, `v2` and `1.0` included, is no longer read as a ref and stays part of the address, as Vercel keeps it, and so does an `@` after the repository path of a form the previous grammar never read, such as `gitlab:` or `ssh://`.

**Outcome**: Every version line the previous grammar accepted after an SSH address or https URL is refused with the `#` line that installs it, and no `@` after a repository address is read as a ref any more.

**Acceptance Criteria**:
- [ ] Given `add git@github.com:owner/repo.git@v1.2.0`, the command exits non-zero, writes no file and no manifest entry, and its message points at `git@github.com:owner/repo.git#v1.2.0`; given `add git@github.com:owner/repo@v1.2.0`, it points at `git@github.com:owner/repo#v1.2.0` (§1.5, §2.3)
- [ ] Given `add https://gitlab.com/group/repo@^1.0`, it points at `https://gitlab.com/group/repo#^1.0`; `add https://github.com/owner/repo@~1.2` points at `https://github.com/owner/repo#~1.2`; `add https://git.example.com/team/repo.git@2.0.0` points at `https://git.example.com/team/repo.git#2.0.0` (§2.3)
- [ ] Given `add https://git.example.com/team/repo@v1.2.0`, it points at `https://git.example.com/team/repo.git#v1.2.0`, never at the website-source line `https://git.example.com/team/repo#v1.2.0` (§1.5, §2.2, §2.3, §14.1)
- [ ] Given the repository at `git@github.com:owner/repo.git` holding a skill whose declared name is `v1.2.0`, `add git@github.com:owner/repo.git@v1.2.0` is refused the same way and that skill is not installed (§2.3, §14.1)
- [ ] Given `add https://deploy@git.example.com/team/repo.git@v1.2.0`, it points at `https://deploy@git.example.com/team/repo.git#v1.2.0`; `add https://deploy@git.example.com/team/repo.git` clones that URL, user included, and is not refused (§2.3, §4.3)
- [ ] Given `add git@github.com:owner/repo.git@main` or `add git@github.com:owner/repo.git@v2`, the value is not read as a ref: the address is cloned as written, `@main` or `@v2` included, nothing is installed from branch `main` or tag `v2`, and no message points at `#` (§1.4, §2.3)
- [ ] Given `add gitlab:owner/repo@v1.2.0` or `add ssh://git@git.example.com/team/repo.git@v1.2.0`, `@v1.2.0` stays part of the address the same way, with no pointer at `#` (§1.4, §2.3)
- [ ] Given repositories tagged `v1.2.0`, the pointed-at lines `git@github.com:owner/repo.git#v1.2.0` and `https://git.example.com/team/repo.git#v1.2.0` each install `v1.2.0` (§2.4, §14.1)

**Do**:
- A value is version-shaped as task 7-9 reads it: it starts with `^` or `~`, or `isVersionTag` (`src/version-resolve.ts`) accepts it (§2.3).
- Where the work lives: `parseSshUrl`, `parseHttpsUrl` and `extractRef` in `src/source-parser.ts`, and the website-source reading of task 5-12.

**Context**:
> - §2.3: "That grammar also read `@` as a ref or constraint after the repository path of an SSH address (`git@host:path`) or an https URL (`parseSshUrl` and `extractRef` in `src/source-parser.ts`). Those forms take no `@skill` (§14.1), so a version-shaped value there is a line in the previous grammar too. `git@github.com:owner/repo.git@v1.2.0` and `https://gitlab.com/group/repo@^1.0` are refused, and the message points at the same line with `#` in place of that `@`. Where that line would itself be refused as a website source (§2.2), as a self-hosted https URL without `.git` is, the message points instead at its `.git` URL with `#` in place of that `@`, the repository the previous grammar cloned at that ref: `https://git.example.com/team/repo@v1.2.0` points at `https://git.example.com/team/repo.git#v1.2.0`."
> - §2.3: the divergence from Vercel, which "reads `@` as a skill only on the shorthand and `github:` forms (v1.7.0 `src/source-parser.ts:378`, `:529`), and elsewhere keeps it in the address and clones the line as given, so the clone fails without naming `#`." A semver-shaped tag is one `isVersionTag` accepts: `v2.0.0` and `2.0.0` are, `v2` and `1.0` are not and take no pointer.
> - The previous grammar had no reading of `gitlab:`, `ssh://` or `http://` lines (Phase 5 adds them): `ssh://` and `http://` lines were refused as "too many slashes", and `gitlab:owner/repo` was read as a GitHub repository under an owner named `gitlab:owner`, which never clones, so no working line in that grammar carries a version after `@` on these forms.
> - §2.2: an http(s) URL that is not a git source (GitHub, the `GH_HOST` host, gitlab.com, a `/-/tree/` URL, an Azure Repos `_git` URL, or a URL ending `.git`) is a website source and is refused (task 5-12).
> - §4.3: `https://deploy@git.example.com/team/repo.git` names the same repository as `https://git.example.com/team/repo.git`; the user is part of the address.
> - Related work elsewhere: a version-shaped `@` on the shorthand and `github:` forms is task 7-9; reading `#` on these forms is task 7-1; these forms name a skill with `--skill` (task 7-5).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §1.5, §2.2, §2.3, §2.4, §4.3, §14.1

## vercel-skills-compatibility-7-11

### Task vercel-skills-compatibility-7-11: A bare add falls back to the default branch when the newest tag lacks a named skill

**Problem**: A bare add installs the newest semver tag and records a caret constraint (`resolveTagConstraint` in `src/commands/add.ts`) (§2.5). A Vercel line naming a skill, such as `owner/repo@new-skill`, names a skill on the repository's default branch, which Vercel's bare add installs, and that skill may have been added after the last release. Installed at the newest tag, the name would miss, so a pick that works through Vercel's CLI would be refused by agntc.

**Solution**: When a bare add names skills, by `@` or `--skill`, and the newest tag lacks any of them, the add installs from the default branch instead, says so in its output, and records no constraint (§2.5). A name the newest tag lacks but the default branch has is not a miss (§7.2). When the newest tag holds every named skill, the add installs that tag and records its caret constraint. An add installs one version: once it moves to the default branch, every name is read there, so a name the default branch lacks too is a miss read at the default branch, and the message lists the skills the default branch offers (§7.2). A line naming one skill only the newest tag holds and one only the default branch holds therefore falls back for the second, misses the first at the default branch, and is refused whole (§7.3). An add naming a `#` ref or constraint is not a bare add and never falls back.

**Outcome**: A pasted pick for a skill added since the last release installs from the default branch and says so, picks of released skills keep agntc's newest-tag default, and every add installs from one version.

**Acceptance Criteria**:
- [ ] Given a repository whose newest tag `v1.0.0` holds `skills/old/` and `skills/legacy/`, and whose default branch holds `skills/old/` and `skills/new-skill/`, each declaring its folder name, when `add owner/repo@new-skill` runs installing for Claude, it installs `new-skill` from the default branch into `.claude/skills/new-skill/` under `owner/repo/new-skill`, its output says it installed from the default branch, and no constraint is recorded (§2.5, §7.2)
- [ ] Given the same repository, `add owner/repo --skill new-skill` falls back the same way, and `add owner/repo --skill old new-skill` installs both `old` and `new-skill` from the default branch, saying so and recording no constraint for either (§2.5)
- [ ] Given the same repository, `add owner/repo@old` installs `old` at `v1.0.0` and records `^1.0.0`, with no mention of the default branch, and `add owner/repo --skill old legacy` installs both at `v1.0.0` with `^1.0.0` (§2.5)
- [ ] Given the same repository, `add owner/repo#v1.0.0@new-skill` and `add owner/repo#^1.0 --skill new-skill` never install from the default branch: each exits non-zero as a miss naming `new-skill`, writing no file and no manifest entry (§1.5, §2.5, §7.2)
- [ ] Given the same repository, `add owner/repo@missing` exits non-zero, writes no file and no manifest entry, and its message names `missing` and lists `old` and `new-skill`, the skills the default branch offers (§1.5, §2.5, §7.2)
- [ ] Given the same repository, `add owner/repo --skill legacy new-skill` installs nothing, neither `legacy` nor `new-skill`, exits non-zero, and its message names `legacy` as unmatched and lists `old` and `new-skill` (§2.5, §7.2, §7.3)

**Do**:
- Where the work lives: the bare-add resolution in `resolveTagConstraint` (`src/commands/add.ts`), which picks the newest tag through `resolveLatestVersion` (`src/version-resolve.ts`) and sets the caret constraint; the path fallback task 5-13 adds there; the name matching of tasks 7-3 and 7-5 and the miss refusal of task 7-8.

**Context**:
> - §2.5: "A bare add, meaning one that names no ref or version in either place, keeps agntc's default: It installs the newest semver tag and records a caret constraint (`^X.Y.Z`) …" "**Fallback to the default branch.** In two cases the bare add installs from the default branch instead, says so in its output, and records no constraint: The newest tag lacks something the line names: a skill selected by `@` or `--skill`, or the path in the source. …" "The fallback keeps two cases working: a pasted pick for a skill added after the repo's last release, and a repo whose tags predate its skills."
> - §7.2: "On a bare add, a name the newest tag lacks but the default branch has is not a miss. The add falls back to the default branch instead (§2.5). A name the default branch lacks too is a miss read at the default branch, the version the add moved to, and the message lists the skills the default branch offers, as Vercel lists them, its bare add reading the default branch. An add installs one version: a line naming `a`, which only the newest tag holds, and `b`, which only the default branch holds, falls back for `b`, misses `a` at the default branch, and is refused whole (§7.3)."
> - The bare-add default diverges from Vercel, which installs the default branch HEAD, to protect semver constraints (§1.4, §2.5).
> - Related work elsewhere: task 5-13 is the same fallback for a path in the source, and task 7-12 the fallback for a newest tag that holds nothing installable; a version-shaped `@` miss read at the default branch also points at `#` (task 7-9); Phase 10's pre-install summary names the fallback when it applied (§11.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §1.5, §2.5, §7.2, §7.3, §11.1

## vercel-skills-compatibility-7-12

### Task vercel-skills-compatibility-7-12: A bare add falls back to the default branch when the newest tag holds nothing installable

**Problem**: A repository's tags can predate its skills: the newest tag holds no skill, and no agent or hook a plugin would install, while the default branch holds the skills Vercel's CLI installs. A bare add installs that newest tag (`resolveTagConstraint` in `src/commands/add.ts`) (§2.5), finds nothing installable, and is refused (§5.1, task 2-8).

**Solution**: When a bare add's newest tag holds nothing installable, no skill and no agent or hook a plugin would install, the add installs from the default branch instead, says so in its output, and records no constraint (§2.5). For an add that names no skill, a newest tag whose only skills are internal holds nothing installable, since such an add does not find internal skills (§5.4). A newest tag holding a plugin's agents or hooks is installable and does not fall back, and so is a newest tag of internal skills that a `--plugin` bundle takes (§5.4, §6.2). An add naming a `#` ref or constraint never falls back, and when the default branch holds nothing installable either, the add is refused.

**Outcome**: A repository whose releases predate its skills installs from its default branch and says so, while a newest tag holding anything installable keeps agntc's newest-tag default.

**Acceptance Criteria**:
- [ ] Given a repository whose only tag `v0.1.0` holds a README and no skill, and whose default branch holds `skills/a/` and `skills/b/`, when `add owner/repo` runs at a terminal, the menu offers `a` and `b`; a picked skill installs from the default branch, the output says it installed from the default branch, and no constraint is recorded (§2.5)
- [ ] Given a repository whose newest tag holds only the internal `skills/secret/`, and whose default branch also holds `skills/a/`, `add owner/repo` falls back to the default branch, says so, and offers `a` (§2.5, §5.4)
- [ ] Given a repository whose newest tag `v1.0.0` holds `agents/reviewer.md` and no skill, `add owner/repo` installs it as a plugin at `v1.0.0` and records `^1.0.0`, with no mention of the default branch (§2.5, §5.1)
- [ ] Given a repository whose newest tag `v1.0.0` holds only internal skills, `add owner/repo --plugin` bundles them at `v1.0.0` and records `^1.0.0`, with no fallback (§2.5, §5.4, §6.2)
- [ ] Given the first repository, `add owner/repo#v0.1.0` and `add owner/repo#^0.1` never install from the default branch: each exits non-zero as finding nothing installable, writing no file and no manifest entry (§1.5, §2.5, §5.1)
- [ ] Given a repository whose newest tag and default branch both hold nothing installable, `add owner/repo` exits non-zero, writes no file and no manifest entry, and says nothing installable was found (§1.5, §5.1)

**Do**:
- Where the work lives: the bare-add resolution in `resolveTagConstraint` (`src/commands/add.ts`), beside the fallbacks of tasks 5-13 and 7-11; the nothing-installable refusal task 2-8 places in `runAdd` (`src/commands/add.ts`).

**Context**:
> - §2.5: the bare add installs from the default branch, says so in its output and records no constraint when "The newest tag holds nothing installable: no skill, and no agent or hook a plugin would install." "The fallback keeps two cases working: a pasted pick for a skill added after the repo's last release, and a repo whose tags predate its skills."
> - §5.4: when no skill is named, discovery does not find an internal skill, and "A source whose only skills are internal therefore finds nothing installable"; a bundle includes internal skills, and "a source whose only skills are internal bundles them rather than being refused".
> - §5.1: `agents/` and/or `hooks/` with no SKILL.md reads as a plugin, installed whole; a source where discovery finds nothing installable is refused (§1.5).
> - Related work elsewhere: the fallback for a named skill is task 7-11 and for a path task 5-13; Phase 10's pre-install summary names the fallback when it applied (§11.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §2.5, §5.1, §5.4, §6.2, §11.1
