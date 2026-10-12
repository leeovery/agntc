# Phase 5: Vercel's source forms and hosts — 13 tasks

## vercel-skills-compatibility-5-1

### Task vercel-skills-compatibility-5-1: `owner/repo/<path>` installs what that folder holds

**Problem**: Vercel reads `owner/repo/<path>` as GitHub shorthand followed by a path into the repository (§2.1). agntc refuses it: `parseGitHubShorthand` in `src/source-parser.ts` rejects shorthand with more than one slash as "too many slashes" (`grep -n "too many slashes" src/source-parser.ts` → line 365). A pasted Vercel line naming one folder of a repository fails, and a GitHub tree URL is the only way to name a folder.

**Solution**: `owner/repo/<path>` installs from the GitHub repository `owner/repo` and reads the folder at `<path>` by its shape (§5.1), as a tree URL naming the same folder is read. A skill installs as that skill, a skills-only pack installs whole, a category folder offers the skills discovery finds there, and `--plugin` narrows a bundle to the folder. The line names no ref, so it is a bare add (§2.5). The path is always a path into the repository and never a manifest key, and a path escaping the repository with `..` is refused by copy-safety. The entry updates from the folder it was installed from.

**Outcome**: A Vercel line naming a folder of a GitHub repository installs what that folder holds, under the key a menu pick or a tree URL gives the same thing, and `update` keeps reinstalling it from that folder.

**Acceptance Criteria**:
- [ ] Given a GitHub repository with no semver tags whose `skills/taste-skill/SKILL.md` declares `design-taste-frontend`, when `add owner/repo/skills/taste-skill` runs for Claude, no menu is shown and the skill installs from the default branch into `.claude/skills/design-taste-frontend/` under key `owner/repo/design-taste-frontend`; today the line is refused as "too many slashes" (§2.1, §2.5, §4.2, §4.3)
- [ ] Given `design-taste-frontend` installed from the menu of `add owner/repo`, when it is re-added as `owner/repo/skills/taste-skill`, the manifest holds one entry for it, `owner/repo/design-taste-frontend`, and `.claude/skills/` holds one copy of it (§4.3)
- [ ] Given `skills/pack/` holding only `skills/` with skills inside, when `add owner/repo/skills/pack` runs, no menu is shown and the pack installs whole as one entry keyed `owner/repo/skills/pack`, its skills flat in their declared-name folders; given `skills/frontend/`, a category folder holding `react/SKILL.md` and `vue/SKILL.md`, `add owner/repo/skills/frontend` offers `react` and `vue`, and a picked `react` installs into `.claude/skills/react/` under `owner/repo/react` (§4.3, §5.1, §5.3)
- [ ] Given that repository also holding `skills/backend/sql/SKILL.md`, when `add owner/repo/skills/frontend --plugin` runs, `react` and `vue` install as one entry keyed `owner/repo/skills/frontend` and `sql` is not installed; when `add owner/repo/skills/frontend/react --plugin` runs, the command exits non-zero and writes no file and no manifest entry (§1.5, §4.3, §6.2, §6.5, §6.6)
- [ ] Given `add owner/repo/../outside` or `add owner/repo/skills/../../outside`, the command exits non-zero, its message names the path as escaping the repository, and no file or manifest entry is written (§1.5, §2.1)
- [ ] Given `design-taste-frontend` installed from `skills/taste-skill/` under `owner/repo/design-taste-frontend`, in a repository with no semver tags and no folder named `design-taste-frontend`, when `add owner/repo/design-taste-frontend` runs, the line is read as a path into the repository: the command exits non-zero, and the installed entry and its files are unchanged (§1.5, §2.1, §4.3)
- [ ] Given the skill installed through `owner/repo/skills/taste-skill` and the pack through `owner/repo/skills/pack`, when both folders change upstream and `update` runs by key or with no argument, each reinstalls from its own folder under its unchanged key (§1.2, §4.3)

**Do**:
- Read the line as Vercel v1.7.0 reads it: GitHub shorthand followed by a path into the repository (§2.1).
- The `..` refusal is copy-safety's (§2.1): the lexical guard `assertSubpathWithinClone` in `src/copy-safety.ts`, which `runAdd` (`src/commands/add.ts`) already runs on a tree URL's path before the folder is read.
- Where the work lives: `parseSource` and `parseGitHubShorthand` in `src/source-parser.ts`; the unit folder `runAdd` derives for a path (`unitDir`) and the direct-path branch of `runCollectionPipeline` in `src/commands/add.ts`; update's source lookup through `resolveGuardedSourceDir` (`src/source-parser.ts`).

**Context**:
> - §2.1: "`owner/repo/path` is a path into the repository. In a source string this is always a path into the repo, never a manifest key (§4). A path that escapes the repo with `..` is refused by copy-safety."
> - §4.3: "The key is the same however the skill was selected: from the menu, by `@name`, by `--skill`, by a subpath, or by a tree URL." A plugin member and a bundle narrowed by a path key `owner/repo/<path>`. "A key is never an install source."
> - §5.1: "Shape is read at the root of what the source points at: the repo root, or the path the source names."
> - The same folder named by a GitHub tree URL already installs this way: a skill (task 1-4), a plugin member (tasks 1-5 to 1-7), a pack or a category folder (task 2-7), and a narrowed bundle (task 3-3). A path naming nothing installable is refused as task 2-8 refuses it.
> - Related work elsewhere: which version a bare add with a path installs, and its fallback to the default branch, is task 5-13. `@` and `#` on this form are Phase 7. A path landing inside a unit without `--plugin` is Phase 8. Printing this form for a plugin member is Phase 15.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §1.5, §2.1, §2.5, §4.2, §4.3, §5.1, §5.3, §6.2, §6.5, §6.6

## vercel-skills-compatibility-5-2

### Task vercel-skills-compatibility-5-2: `github:` and `gitlab:` prefixes clone from their hosts

**Problem**: Vercel accepts `github:owner/repo` and `gitlab:owner/repo` (§2.1). agntc has no prefix handling (`grep -n "gitlab\|github:" src/source-parser.ts` → no hits). Either line reaches `parseGitHubShorthand` in `src/source-parser.ts`, which takes `github:owner` or `gitlab:owner` as the owner and looks for it on github.com. Neither installs, and a `gitlab:` line is never sent to GitLab.

**Solution**: `github:` names a github.com repository and `gitlab:` a gitlab.com repository, each prefix parsed as Vercel parses it. Each installs from its host as the same repository named any other way on that host would, keyed `owner/repo` (§4.3). A bare add resolves tags against that host (§2.5), and `update` clones the entry from its own host. Keys recorded today for `owner/repo` installs are unchanged.

**Outcome**: Lines written with either prefix install from the host they name under the key `owner/repo`, and update from that host.

**Acceptance Criteria**:
- [ ] Given `github:owner/repo`, a GitHub repository with a root SKILL.md declaring `foo-skill`, when it is added for Claude, it clones from github.com and installs into `.claude/skills/foo-skill/` under key `owner/repo` (§2.1, §4.3)
- [ ] Given `gitlab:owner/repo`, a gitlab.com repository with a root SKILL.md, when it is added, it clones from gitlab.com, never github.com, and installs under key `owner/repo` (§2.1, §4.3)
- [ ] Given `gitlab:owner/repo` whose gitlab.com repository carries tags `v1.0.0` and `v1.2.0`, when it is added, it installs `v1.2.0` and records the constraint `^1.2.0`, as a bare add from GitHub does (§2.5)
- [ ] Given an entry installed from `gitlab:owner/repo`, when the repository changes on gitlab.com and `update owner/repo` or `update` with no argument runs, it re-clones from gitlab.com and reinstalls the change; an entry installed from `github:owner/repo` updates from github.com the same way (§1.2)
- [ ] Given an entry installed from `owner/repo` before this change, when `update` runs, its key stays `owner/repo` and it still clones from github.com (§4.3)

**Do**:
- Parse each prefix as Vercel v1.7.0 parses it (§2.1).
- Where the work lives: `parseSource` in `src/source-parser.ts`; the bare-add tag lookup in `resolveTagConstraint` (`src/commands/add.ts`), which asks `fetchRemoteTags` (`src/git-utils.ts`) for the tags at the source's clone URL; update's clone from the entry's recorded clone URL through `cloneRepoOnce` (`src/clone-reinstall.ts`) and, in all-mode, `deriveCloneUrlFromKey` (`src/source-parser.ts`), which assumes github.com when an entry records no clone URL.

**Context**:
> - §2.1: "`github:owner/repo` and `gitlab:owner/repo` prefixes. agntc today has no prefix handling." "Each form is parsed the way Vercel parses it."
> - §4.3: "GitHub, a `GH_HOST` Enterprise host and a two-segment gitlab.com repository key `owner/repo`, as today." "Every key recorded today for a two-segment repository is unchanged."
> - §2.5: a bare add installs the newest semver tag and records `^X.Y.Z`, or installs the default branch when the repository has no semver tags.
> - Related work elsewhere: Phase 6 decides that `github:owner/repo` and `owner/repo` name the same repository (a re-add, the entry recording the form given), and that `gitlab:owner/repo` added over a GitHub `owner/repo` install is a clash, never a silent replacement (§4.3). `@` and `#` on these forms are Phase 7. Printing the `gitlab:` form an entry came from is Phase 15.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §2.1, §2.5, §4.3

## vercel-skills-compatibility-5-3

### Task vercel-skills-compatibility-5-3: A GitHub tree URL without a path installs the whole repository at its ref

**Problem**: Vercel's GitHub tree URL takes an optional path, so `https://github.com/owner/repo/tree/<ref>` names the whole repository at that ref (§2.1). agntc requires a path: `parseDirectPath` in `src/source-parser.ts` refuses the URL with "invalid tree URL: missing plugin path after ref". A pasted tree URL to a branch or a tag fails.

**Solution**: A tree URL with no path after its ref installs the whole repository at that ref. The repository is read by its shape at the root (§5.1), as a whole-repository add reads it, and keyed the same way. The ref is read the way the same `#` fragment would be (§2.4, §2.5): a branch installs that branch, a tag installs that tag, and no constraint is recorded.

**Outcome**: A tree URL naming only a ref installs the repository at that ref, under the keys a whole-repository add gives it.

**Acceptance Criteria**:
- [ ] Given a repository with a root SKILL.md declaring `foo-skill`, when `https://github.com/owner/repo/tree/main` is added for Claude, it installs from `main` into `.claude/skills/foo-skill/` under key `owner/repo` with no constraint recorded; today it is refused "missing plugin path after ref" (§2.1, §2.5, §4.3)
- [ ] Given a repository tagged `v1.0.0` and `v2.0.0`, when `https://github.com/owner/repo/tree/v1.0.0` is added, it installs `v1.0.0` and records no constraint, though `v2.0.0` is newer (§2.4, §2.5)
- [ ] Given a skills-only repository, when `https://github.com/owner/repo/tree/main` is added, the menu offers its skills, and a picked skill installs from `main` under `owner/repo/<folder>` (§4.3, §5.1)
- [ ] Given a plugin repository holding `skills/` beside `agents/`, when `https://github.com/owner/repo/tree/main` is added, it installs whole as one entry keyed `owner/repo`, its agents in `.claude/agents/` (§5.1, §6.1)
- [ ] Given the root skill installed from `https://github.com/owner/repo/tree/main`, when `main` moves upstream and `update owner/repo` runs, it reinstalls from the new `main` (§1.2, §2.4)

**Do**:
- Where the work lives: `hasTreePath` and `parseDirectPath` in `src/source-parser.ts`, and the unit folder `runAdd` derives for a path source (`unitDir` in `src/commands/add.ts`), which is the repository root when the URL names no path.

**Context**:
> - §2.1: "GitHub tree URLs, `https://github.com/owner/repo/tree/<ref>[/<path>]`. The path is optional, as in Vercel; agntc today requires one."
> - §2.5: "A ref carried in the URL itself (a GitHub tree URL's `<ref>`, …) is read the way the same `#` fragment would be (§2.4)." §2.4: `#v2.0.0` is an exact tag with no constraint recorded, and `#main` is that branch.
> - §4.3: a whole-repository root skill or plugin keys `owner/repo`; a skill picked from a menu keys `owner/repo/<folder>`.
> - Related work elsewhere: tree URLs with a path were settled in Phases 1–3 (tasks 1-4, 2-7, 3-3); a tree URL on the `GH_HOST` Enterprise host is task 5-10.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §2.1, §2.4, §2.5, §4.3, §5.1, §6.1

## vercel-skills-compatibility-5-4

### Task vercel-skills-compatibility-5-4: gitlab.com URLs clone their whole repository path

**Problem**: A GitLab repository can sit in nested groups, as `https://gitlab.com/acme/platform/skills` does. agntc keeps only the last two path segments of an https URL as owner/repo (`parseHttpsUrl` in `src/source-parser.ts`), so that URL clones `https://gitlab.com/platform/skills.git`, the wrong path (§2.1).

**Solution**: A gitlab.com URL is a git source with or without `.git` (§2.2), cloned from its whole repository path. Its key's repository part is the last two segments of that path (§4.3): `https://gitlab.com/acme/platform/skills` keys `platform/skills`, and a skill picked from it keys `platform/skills/<folder>`. A two-segment gitlab.com URL keys `owner/repo`, as today. `update` re-clones the same whole path, and `remove` takes the key.

**Outcome**: A nested-group GitLab repository installs from the right repository under a two-segment repository key, updates from that repository and removes by that key, while two-segment GitLab installs keep their keys.

**Acceptance Criteria**:
- [ ] Given `https://gitlab.com/acme/platform/skills`, a repository with a root SKILL.md declaring `lint`, when it is added for Claude, it clones `acme/platform/skills` from gitlab.com, installs into `.claude/skills/lint/`, and keys the entry `platform/skills`; today it clones `platform/skills` (§2.1, §4.3)
- [ ] Given the same URL with `.git` appended, it clones the same repository and keys `platform/skills` (§2.2, §4.3)
- [ ] Given `https://gitlab.com/acme/platform/tools`, a skills-only repository, when `lint` is picked from its menu, it installs under `platform/tools/lint` (§4.3)
- [ ] Given an entry installed from `https://gitlab.com/acme/platform/skills`, when the repository changes and `update platform/skills` or `update` with no argument runs, it re-clones `acme/platform/skills` and reinstalls the change; `remove platform/skills` then removes the entry and its files (§1.2, §4.3)
- [ ] Given `https://gitlab.com/owner/repo`, it clones from gitlab.com and keys `owner/repo`; an entry installed from that URL before this change keeps the key `owner/repo` after `update` and still updates from gitlab.com (§4.3)

**Do**:
- Where the work lives: `parseHttpsUrl` in `src/source-parser.ts` (cited by the spec); update's clone from the entry's recorded clone URL, through `cloneRepoOnce` (`src/clone-reinstall.ts`) for a single key and through `groupEntriesForUpdate` (`src/update-groups.ts`) and `deriveCloneUrlFromKey` (`src/source-parser.ts`) in all-mode; `remove`'s key matching in `resolveTargetKeys` (`src/resolve-target-keys.ts`).

**Context**:
> - §2.1: "GitLab URLs, including nested groups (`https://gitlab.com/group/subgroup/repo`)". "agntc today keeps only the last two path segments of an https URL as owner/repo (`parseHttpsUrl` in `src/source-parser.ts`). So a GitLab subgroup URL or an Azure `_git` URL clones the wrong path."
> - §2.2 lists gitlab.com among git sources, so no `.git` is needed.
> - §4.3: "A GitLab nested group keys the last two segments of its repository path: `https://gitlab.com/acme/platform/skills` → `platform/skills`." "Every key recorded today for a two-segment repository is unchanged. A nested-group or Azure source clones the wrong path today (§2.1), so no working install carries a key from one."
> - Related work elsewhere: `/-/tree/` URLs are task 5-8 and the `gitlab:` prefix is task 5-2. A gitlab.com URL carrying a `/-/` segment other than `/-/tree/` is refused (tasks 5-11, 5-12). Phase 6 decides that two different repositories landing on one key, such as two GitLab subgroups both ending `tools/skills`, clash rather than replace each other, and that a `remove` or `update` key reaching both is refused (§4.3, §12.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §2.1, §2.2, §4.3

## vercel-skills-compatibility-5-5

### Task vercel-skills-compatibility-5-5: SSH addresses and `.git` URLs clone as given with their whole path

**Problem**: agntc keeps two path segments of an SSH address and of an https URL: the first two of `git@host:path` (`parseSshUrl` in `src/source-parser.ts`: `const owner = segments[0]!; const repo = segments[1]!;`) and the last two of an https URL (`parseHttpsUrl`). So `git@gitlab.com:group/subgroup/repo.git` clones `git@gitlab.com:group/subgroup.git`, and `https://git.example.com/org/team/repo.git` clones `https://git.example.com/team/repo.git` (§2.1). A nested or self-hosted repository reached this way clones the wrong path.

**Solution**: A `git@host:path` address and an `https://….git` URL are cloned exactly as given, the whole path kept, as Vercel's fallback clones them. The key's repository part is the last two segments of the repository path with `.git` dropped (§4.3). `update` clones from the same address, and `remove` takes the key.

**Outcome**: A repository reached by SSH address or `.git` URL installs from exactly the repository written, under a two-segment repository key, and updates from the same address.

**Acceptance Criteria**:
- [ ] Given `git@gitlab.com:group/subgroup/repo.git`, a repository with a root SKILL.md, when it is added for Claude, it clones `git@gitlab.com:group/subgroup/repo.git` and keys the entry `subgroup/repo`; today it clones `git@gitlab.com:group/subgroup.git` (§2.1, §4.3)
- [ ] Given `git@github.com:owner/repo.git`, it clones that address over SSH and keys `owner/repo`, as today (§4.3)
- [ ] Given `https://git.example.com/team/repo.git`, it clones that URL as given and keys `team/repo` (§2.1, §2.2, §4.3)
- [ ] Given `https://git.example.com/org/team/repo.git`, it clones that URL as given, where today it clones `https://git.example.com/team/repo.git`, and keys `team/repo` (§2.1, §4.3)
- [ ] Given an entry installed from `git@gitlab.com:group/subgroup/repo.git`, when the repository changes and `update subgroup/repo` or `update` with no argument runs, it re-clones from that same address and reinstalls the change; `remove subgroup/repo` then removes the entry and its files (§1.2, §4.3)

**Do**:
- Clone the address or URL as given, as Vercel v1.7.0's fallback does (Vercel's `src/source-parser.ts:562–567`, `{ type: 'git', url: input }`) (§2.1).
- Where the work lives: `parseSshUrl` and `parseHttpsUrl` in `src/source-parser.ts` (cited by the spec); update's clone from the entry's recorded clone URL through `cloneRepoOnce` (`src/clone-reinstall.ts`); `remove`'s key matching in `resolveTargetKeys` (`src/resolve-target-keys.ts`).

**Context**:
> - §2.1: "SSH addresses (`git@host:path` and `ssh://` URLs) and `https://….git` URLs, cloned as given with the whole path kept."
> - §2.2: "any URL ending `.git`" is a git source; "Self-hosted git servers are reached with a `.git` URL or an SSH address."
> - §4.3: "An SSH address, an `ssh://` URL and a `.git` URL key the last two segments of the repository path, with `.git` dropped: `git@gitlab.com:group/subgroup/repo.git` → `subgroup/repo`."
> - §1.2: private repositories work wherever the user's own git credentials work; agntc does not adopt Vercel's credential chain.
> - Related work elsewhere: `ssh://` URLs are task 5-6, and a repository path of one segment is task 5-7. Phase 6 decides that `owner/repo`, its https URL and its SSH address name one repository (§4.3). Phase 15 prints the SSH address or `.git` URL an entry came from (§14.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §2.1, §2.2, §4.3

## vercel-skills-compatibility-5-6

### Task vercel-skills-compatibility-5-6: `ssh://` URLs clone as given

**Problem**: agntc refuses an `ssh://` URL: the line reaches `parseGitHubShorthand`, which rejects it as "too many slashes" (`grep -n "too many slashes" src/source-parser.ts` → line 365) (§2.1). Vercel accepts the form, but clones an `ssh://` URL on github.com or gitlab.com over https instead (`ssh://git@github.com/owner/repo.git` → `https://github.com/owner/repo.git`). That breaks a user whose only access to a private repository is an SSH key.

**Solution**: An `ssh://` URL is cloned exactly as given, on every host. **This diverges from Vercel, to keep private repositories working with the user's own git credentials (§1.2):** on github.com and gitlab.com the URL is never rewritten to https. The key's repository part is the last two segments of the repository path with `.git` dropped (§4.3). A bare add reads the repository's tags through the same URL (§2.5), and `update` clones over SSH from it.

**Outcome**: A pasted `ssh://` line installs over SSH from exactly the repository written, and keeps updating over SSH.

**Acceptance Criteria**:
- [ ] Given `ssh://git@github.com/owner/repo.git`, a repository with a root SKILL.md, when it is added for Claude, it clones `ssh://git@github.com/owner/repo.git` over SSH, never `https://github.com/owner/repo.git`, and keys the entry `owner/repo`; today it is refused as "too many slashes" (§1.2, §2.1, §4.3)
- [ ] Given that URL's repository tagged `v1.0.0` and `v1.2.0`, the add reads the tags through `ssh://git@github.com/owner/repo.git`, installs `v1.2.0` and records `^1.2.0` (§2.5)
- [ ] Given `ssh://git@gitlab.com/group/subgroup/repo.git`, it clones that URL as given, never over https, and keys `subgroup/repo` (§2.1, §4.3)
- [ ] Given `ssh://git@git.example.com:2222/team/repo.git`, it clones that URL as given and keys `team/repo` (§2.1, §4.3)
- [ ] Given an entry installed from `ssh://git@github.com/owner/repo.git`, when the repository changes and `update owner/repo` or `update` with no argument runs, it re-clones from that same `ssh://` URL and reinstalls the change (§1.2)

**Do**:
- Clone the URL as given on every host, github.com and gitlab.com included (§2.1).
- Where the work lives: `parseSource` in `src/source-parser.ts`, where an `ssh://` URL falls through to `parseGitHubShorthand` today; the bare-add tag lookup in `resolveTagConstraint` (`src/commands/add.ts`); update's clone from the entry's recorded clone URL through `cloneRepoOnce` (`src/clone-reinstall.ts`).

**Context**:
> - §2.1: "An `ssh://` URL on github.com or gitlab.com first matches Vercel's GitHub pattern (`:455`) or gitlab.com pattern (`:500`), and Vercel clones it over https instead (`ssh://git@github.com/owner/repo.git` → `https://github.com/owner/repo.git`). **This diverges from Vercel, to keep private repositories working with the user's own git credentials (§1.2):** agntc clones the `ssh://` URL as given." Vercel's fallback clones an `ssh://` URL on any other host as given.
> - §4.3: "An SSH address, an `ssh://` URL and a `.git` URL key the last two segments of the repository path, with `.git` dropped."
> - Related work elsewhere: an `ssh://` URL whose repository path is one segment keys by its host (task 5-7). Phase 15 prints the `ssh://` form an install came from, on GitHub too (§14.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §2.1, §2.5, §4.3

## vercel-skills-compatibility-5-7

### Task vercel-skills-compatibility-5-7: A one-segment repository path keys by its host

**Problem**: A self-hosted git server can serve a repository at a one-segment path, such as `git@server:skills.git`. agntc requires two segments: `parseSshUrl` in `src/source-parser.ts` refuses that address as "invalid SSH URL: expected owner/repo path", `parseHttpsUrl` refuses `https://server/skills.git` as "invalid HTTPS URL: expected owner/repo path", and `ssh://git@server:2222/skills.git` is refused as "too many slashes". An https URL carrying a user, such as `https://deploy@server:8443/skills.git`, does not parse at all, because `extractRef` reads everything after its `@` as a ref. Vercel clones all of these as given (§2.1), but a repository with no namespace in its path leaves the key's `owner` half with nothing to name.

**Solution**: Each of these addresses is cloned as given. A repository path of one segment has no namespace above it in the path, so its host is that namespace, named without user or port (§4.3): every example above keys `server/skills`. A repository path of two or more segments keys by its own last two segments and never takes in the host. `update` clones from the same address, and `remove server/skills` removes the entry.

**Outcome**: A repository at a one-segment path on a self-hosted server installs under `<host>/<repo>`, and updates and removes like any other install.

**Acceptance Criteria**:
- [ ] Given `git@server:skills.git`, a repository with a root SKILL.md, when it is added for Claude, it clones `git@server:skills.git` as given and keys the entry `server/skills`; today it is refused "expected owner/repo path" (§2.1, §4.3)
- [ ] Given `https://server/skills.git`, it clones that URL as given and keys `server/skills`; today it is refused "expected owner/repo path" (§2.1, §2.2, §4.3)
- [ ] Given `ssh://git@server:2222/skills.git`, it clones that URL as given and keys `server/skills`, the user and the port left out (§2.1, §4.3)
- [ ] Given `https://deploy@server:8443/skills.git`, it clones that URL as given and keys `server/skills` (§4.3)
- [ ] Given `git@server:team/skills.git`, it keys `team/skills`, and no key from it names `server` (§4.3)
- [ ] Given an entry installed from `git@server:skills.git`, when the repository changes and `update server/skills` or `update` with no argument runs, it re-clones from that same address and reinstalls the change; `remove server/skills` then removes the entry and its files (§1.2, §4.3)

**Do**:
- Where the work lives: `parseSshUrl`, `parseHttpsUrl` and `extractRef`, and the `ssh://` reading in `parseSource` (`src/source-parser.ts`); update's clone from the entry's recorded clone URL through `cloneRepoOnce` (`src/clone-reinstall.ts`); `remove`'s key matching in `resolveTargetKeys` (`src/resolve-target-keys.ts`).

**Context**:
> - §4.3: "The `owner/repo` part of every key is two segments: the repository's own name and the namespace directly above it, whatever the host." "A repository path of one segment, as a self-hosted server's can be, has no namespace above it in the path, so its host is that namespace, named without user or port: `git@server:skills.git`, `ssh://git@server:2222/skills.git` and `https://server/skills.git` → `server/skills`."
> - §2.1: SSH addresses, `ssh://` URLs and `https://….git` URLs are "cloned as given with the whole path kept"; §2.2 makes any URL ending `.git` a git source.
> - Related work elsewhere: cloning SSH addresses, `.git` URLs and `ssh://` URLs as given is tasks 5-5 and 5-6. Phase 6 decides when two sources name the same repository: host and repository path match (§4.3).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §2.1, §2.2, §4.3

## vercel-skills-compatibility-5-8

### Task vercel-skills-compatibility-5-8: GitLab `/-/tree/<ref>/<path>` URLs install that path at that ref

**Problem**: GitLab names a folder at a ref as `https://<host>/<repository path>/-/tree/<ref>/<path>`, and Vercel accepts the form on any host (§2.1, §2.2). agntc reads it through its GitHub tree-URL parser, `parseDirectPath` in `src/source-parser.ts`, which takes the first two segments before `/tree/` as owner and repo. A nested-group URL such as `https://gitlab.com/acme/platform/agent-kit/-/tree/main/tools/lint` therefore clones `acme/platform`, the wrong repository.

**Solution**: A `/-/tree/` URL on any host is a git source. Its repository path is everything before `/-/`, nested groups included, cloned from that host. The segment after `tree/` is the ref, and the rest is the path into the repository. The ref is read the way the same `#` fragment would be (§2.4, §2.5), so no constraint is recorded. The folder the path names is read by its shape (§5.1), as a GitHub tree URL's is, and `--plugin` narrows a bundle to it. Keys take their repository part from the last two segments of the repository path (§4.3). A path that escapes the repository with `..` is refused by copy-safety.

**Outcome**: A GitLab folder link installs what that folder holds at that ref, from the right repository on whichever host serves it, and updates from that folder.

**Acceptance Criteria**:
- [ ] Given `https://gitlab.com/acme/platform/agent-kit/-/tree/main/tools/lint`, where `tools/lint/SKILL.md` declares `lint`, when it is added for Claude, it clones `acme/platform/agent-kit` from gitlab.com at `main`, installs into `.claude/skills/lint/` under key `platform/agent-kit/lint`, and records no constraint (§2.1, §2.5, §4.3)
- [ ] Given `https://git.example.com/team/repo/-/tree/v2.0.0/skills/pack` on a self-hosted server, where `skills/pack/` holds only `skills/`, when it is added, it clones `team/repo` from git.example.com at `v2.0.0`, shows no menu, installs the pack whole as one entry keyed `team/repo/skills/pack`, and records no constraint (§2.2, §2.5, §4.3, §5.1)
- [ ] Given `https://gitlab.com/acme/platform/agent-kit/-/tree/main/skills/frontend`, a category folder holding `react/SKILL.md` and `vue/SKILL.md`, the menu offers `react` and `vue`, and a picked `react` keys `platform/agent-kit/react`; with `--plugin`, `react` and `vue` install as one entry keyed `platform/agent-kit/skills/frontend` and nothing outside that folder is installed (§4.3, §5.1, §6.2)
- [ ] Given `https://gitlab.com/acme/platform/agent-kit/-/tree/main/../../outside`, the command exits non-zero and writes no file and no manifest entry (§1.5, §2.1)
- [ ] Given `lint` installed from the first URL, when `tools/lint/` changes on `main` and `update platform/agent-kit/lint` or `update` with no argument runs, it re-clones `acme/platform/agent-kit` and reinstalls from `tools/lint/` (§1.2, §4.3)

**Do**:
- Where the work lives: `hasTreePath` and `parseDirectPath` in `src/source-parser.ts`, which match `/tree/` anywhere in the path today; the path guard `assertSubpathWithinClone` (`src/copy-safety.ts`) that `runAdd` (`src/commands/add.ts`) runs on a tree URL's path before the folder is read; update's source lookup through `resolveGuardedSourceDir` (`src/source-parser.ts`).

**Context**:
> - §2.1: "GitLab URLs, including nested groups (`https://gitlab.com/group/subgroup/repo`) and `/-/tree/<ref>/<path>` URLs." §2.2 lists "a `/-/tree/` URL on any host" among git sources.
> - §4.3: "A `/-/tree/` URL's repository path is everything before `/-/`." The key's repository part is that path's last two segments; a skill keys `<repository part>/<folder>`, and a plugin member or a narrowed bundle `<repository part>/<path>`.
> - §2.5: "A ref carried in the URL itself (… a GitLab `/-/tree/<ref>/` …) is read the way the same `#` fragment would be (§2.4)."
> - The same folder shapes through a GitHub tree URL: tasks 1-4 to 1-7, 2-7 and 3-3. A path into a unit without `--plugin` is Phase 8. A `/-/tree/` path that the named ref lacks is refused, never falling back to the default branch (task 5-13). A `/-/blob/` link to a file is refused (task 5-11).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §1.5, §2.1, §2.2, §2.4, §2.5, §4.3, §5.1, §6.2

## vercel-skills-compatibility-5-9

### Task vercel-skills-compatibility-5-9: Azure Repos `_git` URLs install from their repository, path and version

**Problem**: Azure Repos names a repository `https://dev.azure.com/org/project/_git/repo`, with an optional `?path=` naming a folder and `?version=` naming a ref, and Vercel accepts the form (§2.1). agntc keeps the last two path segments of an https URL (`parseHttpsUrl` in `src/source-parser.ts`), so that URL clones `https://dev.azure.com/_git/repo.git`, the wrong path, and a query string is read as part of those segments.

**Solution**: An Azure Repos `_git` URL is a git source (§2.2), cloned from its repository. Its key's repository part is the project and the repository, `project/repo`, because `_git` is a URL marker and not a namespace (§4.3). `?path=` names a folder read by its shape (§5.1), and `--plugin` narrows a bundle to it. `?version=` names a ref read the way the same `#` fragment would be (§2.4, §2.5), so a tag or branch installs with no constraint recorded. Both parameters are read as Vercel reads them. Without `?version=`, the add is a bare add (§2.5). A `?path=` escaping the repository with `..` is refused by copy-safety.

**Outcome**: An Azure Repos link installs from the right repository, at the folder and ref it names, under keys starting `project/repo`, and updates and removes like any other install.

**Acceptance Criteria**:
- [ ] Given `https://dev.azure.com/org/project/_git/repo`, a repository with a root SKILL.md declaring `lint`, when it is added for Claude, it clones that repository, installs into `.claude/skills/lint/`, and keys the entry `project/repo`; today it clones `https://dev.azure.com/_git/repo.git` (§2.1, §4.3)
- [ ] Given that URL with a `?path=` naming `skills/pack`, a folder holding only `skills/`, and a `?version=` naming branch `main`, no menu is shown and the pack installs whole from `main` as one entry keyed `project/repo/skills/pack`, with no constraint recorded (§2.5, §4.3, §5.1)
- [ ] Given a `?version=` naming tag `v1.0.0` in a repository also tagged `v2.0.0`, it installs `v1.0.0` and records no constraint (§2.4, §2.5)
- [ ] Given a `?path=` naming `skills/frontend`, a category folder holding `react/SKILL.md` and `vue/SKILL.md`, the menu offers `react` and `vue`, and a picked `react` keys `project/repo/react`; with `--plugin`, `react` and `vue` install as one entry keyed `project/repo/skills/frontend` and nothing outside that folder is installed (§4.3, §5.1, §6.2)
- [ ] Given a `?path=` naming `../../outside`, the command exits non-zero and writes no file and no manifest entry (§1.5, §2.1)
- [ ] Given an entry installed from the first URL, when the repository changes and `update project/repo` or `update` with no argument runs, it re-clones the same Azure Repos repository and reinstalls the change; `remove project/repo` then removes the entry and its files (§1.2, §4.3)

**Do**:
- Read `?path=` and `?version=` as Vercel v1.7.0 reads them (§2.1).
- Where the work lives: `parseSource` and `parseHttpsUrl` in `src/source-parser.ts`; the unit folder `runAdd` derives for a path and its `assertSubpathWithinClone` guard (`src/commands/add.ts`, `src/copy-safety.ts`); update's clone from the entry's recorded clone URL through `cloneRepoOnce` (`src/clone-reinstall.ts`); `remove`'s key matching in `resolveTargetKeys` (`src/resolve-target-keys.ts`).

**Context**:
> - §2.1: "Azure Repos `_git` URLs, with `?path=` and `?version=`." "Each form is parsed the way Vercel parses it." §2.2 lists "an Azure Repos `_git` URL" among git sources.
> - §4.3: "An Azure Repos URL keys the project and the repository; `_git` is a URL marker, not a namespace: `https://dev.azure.com/org/project/_git/repo` → `project/repo`."
> - §2.5: a ref carried in "an Azure Repos `?version=`" is read the way the same `#` fragment would be (§2.4); a bare add names no ref or version "in either place".
> - The criteria name the folder or ref a parameter carries, not how it is spelled in the URL; the spelling is the one Vercel v1.7.0 reads.
> - Related work elsewhere: a `?path=` with no `?version=` that the newest tag lacks falls back to the default branch, and one carried with `?version=` never does (task 5-13). A path into a unit without `--plugin` is Phase 8. Phase 15 prints the Azure Repos URL an entry came from (§14.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §1.5, §2.1, §2.2, §2.4, §2.5, §4.3, §5.1, §6.2

## vercel-skills-compatibility-5-10

### Task vercel-skills-compatibility-5-10: The `GH_HOST` Enterprise host is read as GitHub

**Problem**: A GitHub Enterprise host serves the same `owner/repo` URLs as github.com on its own host, and Vercel reads the host named by the `GH_HOST` environment variable as GitHub (§2.1). Under the reading order this phase adopts, an https URL on a host other than github.com and gitlab.com is a git source only when it ends `.git` or is a `/-/tree/` or Azure Repos URL; every other one is a website source and is refused (§2.2, task 5-12). Unless agntc reads `GH_HOST`, a pasted `https://ghe.example.com/owner/repo` line, which it clones today, and the tree URLs on that host would be refused. And `GH_HOST` is a property of the shell, not of the install: were `update` to read an entry's recorded source as a source line again, an Enterprise install would stop updating in any shell where `GH_HOST` is unset (§4.3).

**Solution**: When `GH_HOST` names a host, URLs on that host are read as GitHub URLs. `https://<GH_HOST>/owner/repo` is a git source without `.git`, cloned from that host and keyed `owner/repo` (§4.3). A tree URL on that host is read as a GitHub tree URL, its path optional (task 5-3). A bare add resolves tags against that host (§2.5). `update` clones the entry from the source as recorded and never reads it again as a source line under §2.2, so an Enterprise install updates from its host whether or not `GH_HOST` is set when `update` runs (§4.3).

**Outcome**: With `GH_HOST` set, Enterprise lines install, key and update exactly as their github.com equivalents do, from the Enterprise host, and an installed entry keeps updating from that host in any shell.

**Acceptance Criteria**:
- [ ] Given `GH_HOST=ghe.example.com` and `https://ghe.example.com/owner/repo`, a repository with a root SKILL.md declaring `foo-skill`, when it is added for Claude, it clones `owner/repo` from ghe.example.com, installs into `.claude/skills/foo-skill/`, and keys the entry `owner/repo` (§2.1, §2.2, §4.3)
- [ ] Given `GH_HOST=ghe.example.com` and `https://ghe.example.com/owner/repo/tree/main/skills/taste-skill`, where `taste-skill` declares `design-taste-frontend`, it installs from `main` under `owner/repo/design-taste-frontend`; `https://ghe.example.com/owner/repo/tree/main` installs the whole repository from `main` under `owner/repo` (§2.1, §2.5, §4.3)
- [ ] Given `GH_HOST=ghe.example.com` and an Enterprise repository tagged `v1.0.0` and `v1.2.0`, when `https://ghe.example.com/owner/repo` is added, it installs `v1.2.0` and records `^1.2.0` (§2.5)
- [ ] Given an entry installed from `https://ghe.example.com/owner/repo` with `GH_HOST=ghe.example.com`, when the repository changes and `update owner/repo` or `update` with no argument runs with `GH_HOST=ghe.example.com`, it re-clones from ghe.example.com, never github.com, and reinstalls the change (§1.2)
- [ ] Given the same entry, when `update owner/repo` or `update` with no argument runs with `GH_HOST` unset, or naming another host, it still re-clones from ghe.example.com and reinstalls the change, and the entry is never refused as a website source (§4.3)

**Do**:
- Read the host the `GH_HOST` environment variable names as GitHub, parsing its URLs as Vercel v1.7.0 parses them (§2.1).
- `update` clones the entry from the source as recorded and never parses it again as a source line (§4.3).
- Where the work lives: `parseSource` and its https branches in `src/source-parser.ts` (`parseHttpsUrl`, `hasTreePath`, `parseDirectPath`); update's clone from the entry through `cloneRepoOnce` (`src/clone-reinstall.ts`) and `buildParsedSourceFromKey` (`src/source-parser.ts`); all-mode grouping and checks through `deriveCloneUrlFromKey` (`src/source-parser.ts`, used by `src/update-groups.ts` and `src/update-check.ts`); `list`'s change-version action (`src/commands/list-change-version-action.ts`), which reads the entry's clone URL the same way.

**Context**:
> - §2.1: "A GitHub Enterprise host named by the `GH_HOST` environment variable, read as GitHub." §2.2's git sources include "GitHub, including the `GH_HOST` host".
> - §4.3: "GitHub, a `GH_HOST` Enterprise host and a two-segment gitlab.com repository key `owner/repo`, as today." "The full source is recorded with the entry for cloning and for printed `add` commands (§14.1). `update` clones the entry from the source as recorded and never reads it again as a source line under §2.2. So an install from the `GH_HOST` host updates whether or not `GH_HOST` is set when `update` runs."
> - Today update clones a recorded entry without parsing its source again: `cloneRepoOnce` builds the clone source from the entry through `buildParsedSourceFromKey`.
> - §1.2: private repositories work wherever the user's own git credentials work; agntc does not adopt Vercel's credential chain.
> - Related work elsewhere: an Enterprise URL without `.git` whose host `GH_HOST` does not name is refused as a website source (task 5-12). A `/blob/` link on the `GH_HOST` host is refused (task 5-11), and so is one whose path runs past `owner/repo` without being a tree URL (task 5-12). Phase 6 decides that a GitHub repository and its Enterprise mirror sharing `owner/repo` clash rather than replace each other (§4.3). Phase 15 prints the Enterprise URL an entry came from (§14.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §2.1, §2.2, §2.5, §4.3

## vercel-skills-compatibility-5-11

### Task vercel-skills-compatibility-5-11: Direct-download links are refused

**Problem**: Hosted-artifact links, such as a raw file, a zip of a ref or a release download, are not repositories, and installing from a direct link to a single `SKILL.md` or an archive is out of scope (§1.3). Every such GitHub link also matches the GitHub repository pattern, so read as git, a pasted raw `SKILL.md` link would clone the whole repository (§2.2). A link to a single file in a repository's web view, such as `https://github.com/owner/repo/blob/main/skills/foo/SKILL.md`, is the same kind of line, and Vercel clones the whole repository for it, dropping the path (§2.2). agntc today reads all of these as https repository URLs and keeps their last two path segments (`parseHttpsUrl` in `src/source-parser.ts`), so such a line fails at clone, after retries, with a git error rather than the refusal §1.3 requires.

**Solution**: An http(s) URL is checked for a direct-download link first, before it is read as a git source, in Vercel's order (Vercel v1.7.0 `src/source-parser.ts:398`, before its GitHub repository match at `:455`). The hosted-artifact links §2.2 lists, and a direct link to a single `SKILL.md` or an archive recognised by its shape, are refused pre-flight: the command exits non-zero, clones nothing, writes nothing, and its message names direct-download links as a source agntc does not support. A github.com or `GH_HOST` link under `/blob/<ref>/<path>`, and a `/-/blob/<ref>/<path>` link on any host, are direct links to a single file, checked in the same step and refused the same way. That message names direct links to a single file as unsupported, and names the tree URL of the folder holding the file as the way through. **This diverges from Vercel, so that no part of a line is silently ignored (§1.5).**

**Outcome**: A pasted raw, archive, release-download or single-file link stops at once with a message saying agntc does not install from such links, a single-file link points at the tree URL that does install its folder, and no repository is cloned.

**Acceptance Criteria**:
- [ ] Given `https://raw.githubusercontent.com/owner/repo/main/skills/foo/SKILL.md`, `https://codeload.github.com/owner/repo/zip/refs/heads/main` or a link on `objects.githubusercontent.com`, when `add` runs, it exits non-zero without cloning, its message names direct-download links as unsupported, and no file or manifest entry is written or removed (§1.3, §1.5, §2.2)
- [ ] Given a github.com link under `/archive/`, `/raw/`, `/releases/download/` or `/releases/latest/download/`, such as `https://github.com/owner/repo/raw/main/skills/foo/SKILL.md` or `https://github.com/owner/repo/releases/latest/download/skills.zip`, it is refused the same way and `owner/repo` is never cloned (§2.2)
- [ ] Given a gitlab.com link under `/-/archive/` or `/-/raw/`, such as `https://gitlab.com/group/repo/-/raw/main/SKILL.md`, it is refused the same way (§2.2)
- [ ] Given a direct link on any other host to a single `SKILL.md` or to an archive, such as `https://example.com/skills/foo/SKILL.md` or `https://example.com/downloads/skills.zip`, it is refused the same way, its message naming direct links as unsupported (§1.3, §2.2)
- [ ] Given `https://github.com/owner/repo/blob/main/skills/foo/SKILL.md`, when `add` runs, it exits non-zero without cloning `owner/repo`, its message names direct links to a single file as unsupported and names `https://github.com/owner/repo/tree/main/skills/foo` as the way through, and nothing is written; with `GH_HOST=ghe.example.com`, `https://ghe.example.com/owner/repo/blob/main/skills/foo/SKILL.md` is refused the same way, naming `https://ghe.example.com/owner/repo/tree/main/skills/foo` (§1.5, §2.2)
- [ ] Given `https://gitlab.com/group/repo/-/blob/main/skills/foo/SKILL.md` or the self-hosted `https://git.example.com/team/repo/-/blob/v1.0.0/tools/lint/SKILL.md`, each is refused the same way, naming `https://gitlab.com/group/repo/-/tree/main/skills/foo` and `https://git.example.com/team/repo/-/tree/v1.0.0/tools/lint` respectively as the way through (§1.5, §2.2)

**Do**:
- Check an http(s) URL for a direct-download link or a link to a single file before reading it as a git source, in Vercel v1.7.0's order (§2.2).
- Where the work lives: `parseSource` in `src/source-parser.ts`, ahead of its https branches; `runAdd` (`src/commands/add.ts`) parses the source before it clones.

**Context**:
> - §1.3, not built: "direct links to a single `SKILL.md` or an archive". "A line that needs any of these is refused (§1.5), with a message naming the capability agntc doesn't support. It is never silently treated as something agntc does support."
> - §2.2 step 1 lists the hosted-artifact links and why they come first: "every such GitHub link also matches the GitHub repo pattern. Read as git, a pasted raw `SKILL.md` link would clone the whole repo." It adds: "A link to a single file in a repository's web view is a direct link to a single file (§1.3), checked here too and refused the same way: a github.com or `GH_HOST` path under `/blob/<ref>/<path>`, and a `/-/blob/<ref>/<path>` path on any host. The message names direct links to a single file as unsupported, and the tree URL of the folder holding that file as the way through." Its closing list: direct links to a single `SKILL.md` or an archive "are recognised by shape and refused the same way".
> - §1.5: a refusal is pre-flight; the command exits non-zero, writes and removes nothing, and names what was refused and the way through where one exists.
> - Related work elsewhere: the GitHub tree URL a `/blob/` refusal names is accepted with or without a path (task 5-3), on the `GH_HOST` host too (task 5-10), and the `/-/tree/` URL is task 5-8. Other GitHub and gitlab.com URLs that are neither a repository nor a tree URL, website sources, and skills.sh and Notion sources are task 5-12.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.3, §1.5, §2.2

## vercel-skills-compatibility-5-12

### Task vercel-skills-compatibility-5-12: Website sources and the other unsupported forms are refused by name

**Problem**: agntc clones any `https://host/owner/repo` as git (`parseHttpsUrl` in `src/source-parser.ts` appends `.git`) (§2.2). Vercel reads an http(s) URL that is not a git source as a website (well-known-endpoint) source and never clones it. Website sources are out of scope here, as are skills.sh pack links and Notion sources (§1.3). A GitHub or gitlab.com URL whose path runs past the repository, such as an issue, pull request or commit page, is cloned by Vercel as the whole repository, the rest of the path dropped (§2.2); agntc today keeps its last two segments, so `https://github.com/owner/repo/issues/12` tries to clone `https://github.com/issues/12.git`. A pasted line of any of these kinds ends today in a clone failure after retries, or a parse error, instead of a refusal naming what agntc does not support. An `http://` URL is not read as a URL at all: `parseSource` handles `https://` only, so an `http://` line falls through to the shorthand parser and is refused as "too many slashes".

**Solution**: An http(s) URL is read in Vercel's order (§2.2): a direct-download link or a link to a single file first (task 5-11), then a git source, and every other http(s) URL is a website source. A website source is refused pre-flight with a message naming website sources as unsupported, and naming a `.git` URL or an SSH address as the way to reach a self-hosted git server. A GitHub or `GH_HOST` URL is a git source only when its path names the repository (`owner/repo`) or is a tree URL; one whose path runs on past the repository in any other way is refused, its message naming it as neither a repository nor a tree URL, and a gitlab.com URL carrying a `/-/` segment other than `/-/tree/` is refused the same way. **This diverges from Vercel, so that no part of a line is silently ignored (§1.5).** skills.sh pack links and Notion sources are recognised by shape and refused naming their kind. An `http://` URL is read in the same order as an `https://` one. These rules read source lines given to `add`; `update` clones an entry from the source as recorded and never reads it again under §2.2 (§4.3), so an install made today from a self-hosted URL without `.git` keeps updating.

**Outcome**: A line naming a website, a skills.sh pack, a Notion source, or a GitHub or GitLab page that is not a repository stops before cloning with a message naming what agntc does not support, a self-hosted git user is told how to reach their server, and existing installs keep updating.

**Acceptance Criteria**:
- [ ] Given `https://git.example.com/team/repo`, a self-hosted URL without `.git` that agntc clones today, when `add` runs, it exits non-zero without cloning, its message names website sources as unsupported and names a `.git` URL or an SSH address as the way to reach a self-hosted git server, and no file or manifest entry is written or removed (§1.3, §1.5, §2.2)
- [ ] Given `https://example.com` or `https://example.com/docs/skills`, it is refused the same way; given `https://ghe.example.com/owner/repo` with `GH_HOST` unset, or naming another host, it is refused as a website source (§1.3, §2.2)
- [ ] Given `https://skills.sh/p/abc123`, it exits non-zero without cloning and names skills.sh packs as unsupported; given a Notion source in the form Vercel v1.7.0 recognises, it exits non-zero and names Notion sources as unsupported; neither writes anything (§1.3, §1.5, §2.2)
- [ ] Given `https://github.com/owner/repo/issues/12`, `https://github.com/owner/repo/pull/3` or `https://github.com/owner/repo/commit/abc1234`, when `add` runs, it exits non-zero without cloning `owner/repo`, its message names the URL as neither a repository nor a tree URL, and nothing is written; with `GH_HOST=ghe.example.com`, `https://ghe.example.com/owner/repo/pull/3` is refused the same way (§1.5, §2.2)
- [ ] Given `https://gitlab.com/group/repo/-/issues/4` or `https://gitlab.com/group/repo/-/merge_requests/2`, it is refused the same way, as neither a repository nor a tree URL (§1.5, §2.2)
- [ ] Given `http://example.com/owner/repo`, it is refused as a website source; given `http://git.example.com/team/repo.git`, it is read as a git source and cloned as given (§2.2)
- [ ] Given an entry installed before this change from `https://git.example.com/team/repo`, when the repository changes and `update team/repo` or `update` with no argument runs, it re-clones from the URL it recorded and reinstalls the change, and is never refused as a website source (§4.3)

**Do**:
- Read an http(s) URL in Vercel v1.7.0's order (§2.2): a direct-download link or a link to a single file (task 5-11); then a git source, meaning GitHub including the `GH_HOST` host, gitlab.com, a `/-/tree/` URL on any host, an Azure Repos `_git` URL, or any URL ending `.git`; then a website source.
- Recognise skills.sh pack links and Notion sources by shape, as Vercel v1.7.0 recognises them (§2.2).
- `update` clones an entry from the source as recorded and never parses it again as a source line (§4.3).
- Where the work lives: `parseSource` and `parseHttpsUrl` in `src/source-parser.ts`; `runAdd` (`src/commands/add.ts`) parses the source before it clones; update's clone from the entry through `cloneRepoOnce` (`src/clone-reinstall.ts`) and `deriveCloneUrlFromKey` (`src/source-parser.ts`).

**Context**:
> - §2.2 step 2: "A GitHub or `GH_HOST` URL is a git source when its path names the repository (`owner/repo`) or is a tree URL. One whose path runs on past the repository in any other way, such as an issue, pull request or commit page, is refused (§1.5), and the message names it as neither a repository nor a tree URL. A gitlab.com URL is refused the same way when its path carries a `/-/` segment other than `/-/tree/`." Step 3: "Website source, refused (§1.3). This is every other http(s) URL. The message names website sources as unsupported."
> - §2.2: "This changes agntc's own syntax. Today any `https://host/owner/repo` is cloned as git. Under this order, a self-hosted URL without `.git` is a website source. Self-hosted git servers are reached with a `.git` URL or an SSH address." "The other out-of-scope source forms from §1.3 are recognised by shape and refused the same way: skills.sh pack links (`https://skills.sh/p/<id>`); Notion sources; direct links to a single `SKILL.md` or an archive."
> - §1.3: website sources are roadmapped (`website-skill-sources`); skills.sh packs and Notion sources are not built. A line needing any of them is refused "with a message naming the capability agntc doesn't support".
> - §1.5: the refusal message "names what was refused, and the way through where one exists".
> - §4.3: "`update` clones the entry from the source as recorded and never reads it again as a source line under §2.2."
> - Related work elsewhere: direct-download links and links to a single file are task 5-11, and the `GH_HOST` host is task 5-10. gitlab.com `/-/archive/`, `/-/raw/` and `/-/blob/` links are refused in step 1 (task 5-11), before this step's `/-/` rule.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.3, §1.5, §2.2, §4.3

## vercel-skills-compatibility-5-13

### Task vercel-skills-compatibility-5-13: A bare add with a path the newest tag lacks installs from the default branch

**Problem**: A bare add installs the newest semver tag and records a caret constraint (`resolveTagConstraint` in `src/commands/add.ts`) (§2.5). A path pasted from a Vercel line names a folder on the repository's default branch, which Vercel installs, and that folder may have been added after the repository's last release. Installed at the newest tag, such a line finds nothing at its path, so a pick that works through Vercel's CLI fails through agntc.

**Solution**: When a bare add names a path that the newest tag lacks, it installs from the default branch instead, says so in its output, and records no constraint. A path the newest tag holds installs that tag with its caret constraint, and a repository with no semver tags installs the default branch, as today. An Azure Repos `?path=` with no `?version=` is a bare add and falls back the same way. A path carried with a ref (a tree URL, a `/-/tree/` URL or `?version=`) is not a bare add, and it never falls back. A path that neither the newest tag nor the default branch holds is refused.

**Outcome**: A pasted line naming a folder added since the last release installs that folder from the default branch and says so, while a line naming a released folder keeps agntc's newest-tag default.

**Acceptance Criteria**:
- [ ] Given a repository whose newest tag `v1.0.0` lacks `skills/new-skill/`, which the default branch holds, declaring `new-skill`, when `add owner/repo/skills/new-skill` runs for Claude, it installs from the default branch into `.claude/skills/new-skill/` under `owner/repo/new-skill`, its output says it installed from the default branch, and no constraint is recorded (§2.5)
- [ ] Given the same repository, when `add owner/repo/skills/old-skill` runs for a folder that `v1.0.0` holds, it installs `v1.0.0` and records `^1.0.0` (§2.5)
- [ ] Given a repository with no semver tags, `add owner/repo/skills/foo` installs from the default branch and records no constraint (§2.5)
- [ ] Given an Azure Repos URL with a `?path=` naming `skills/new-skill` and no `?version=`, for a repository whose newest tag lacks that folder and whose default branch holds it, the add falls back to the default branch the same way (§2.5)
- [ ] Given `https://github.com/owner/repo/tree/v1.0.0/skills/new-skill`, the same tag and path in a GitLab `/-/tree/` URL, or an Azure Repos URL whose `?version=` names `v1.0.0` and whose `?path=` names `skills/new-skill`, the command never installs from the default branch: it exits non-zero and writes no file and no manifest entry (§1.5, §2.5, §5.1)
- [ ] Given `add owner/repo/skills/missing`, a folder that neither the newest tag nor the default branch holds, the command exits non-zero and writes no file and no manifest entry (§1.5, §5.1)

**Do**:
- Where the work lives: the bare-add resolution in `resolveTagConstraint` (`src/commands/add.ts`), which picks the newest tag through `resolveLatestVersion` (`src/version-resolve.ts`) and sets the caret constraint; the clone in `cloneSource` (`src/git-clone.ts`); the unit folder `runAdd` derives for a path (`unitDir` in `src/commands/add.ts`).

**Context**:
> - §2.5: "A bare add, meaning one that names no ref or version in either place, keeps agntc's default: It installs the newest semver tag and records a caret constraint (`^X.Y.Z`) … It installs the default branch when the repo has no semver tags." "**Fallback to the default branch.** In two cases the bare add installs from the default branch instead, says so in its output, and records no constraint: The newest tag lacks something the line names: a skill selected by `@` or `--skill`, or the path in the source. …" "The fallback keeps two cases working: a pasted pick for a skill added after the repo's last release, and a repo whose tags predate its skills."
> - The bare-add default diverges from Vercel, which installs the default branch HEAD, to protect semver constraints (§1.4, §2.5).
> - §2.5: "A ref carried in the URL itself (a GitHub tree URL's `<ref>`, a GitLab `/-/tree/<ref>/`, an Azure Repos `?version=`) is read the way the same `#` fragment would be (§2.4)."
> - §5.1: a source where discovery finds nothing installable is refused (§1.5); task 2-8 refuses it.
> - Related work elsewhere: Phase 7 brings the same fallback for a skill named by `@` or `--skill` and for a newest tag that holds nothing installable (§2.5). Phase 10's pre-install summary names the fallback when it applied (§11.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §1.5, §2.4, §2.5, §5.1, §11.1
