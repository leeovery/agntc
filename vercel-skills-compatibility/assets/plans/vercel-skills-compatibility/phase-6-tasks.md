# Phase 6: Repository identity across forms and hosts — 7 tasks

## vercel-skills-compatibility-6-1

### Task vercel-skills-compatibility-6-1: The entry records the source form it was given

**Problem**: An entry records only the address it clones from (`cloneUrl`, set through `deriveCloneUrlForManifest` and `buildAddEntry` in `src/commands/add.ts`). An entry from an older manifest records none (the read-side backfill in `readManifest`, `src/manifest.ts`), and `update` reads that as github.com (`buildParsedSourceFromKey` and `deriveCloneUrlFromKey` in `src/source-parser.ts`). Since Phase 5, `gitlab:owner/repo` and `https://gitlab.com/owner/repo` clone from the same address, so the entry cannot tell which form the user wrote. The specification records the full source with the entry, for cloning and for the `add` commands agntc prints, which name the form an install came from (§4.3, §14.1). Recording the form brings a risk with it: were `update` to read the recorded form again as a source line, an install from `https://<GH_HOST>/owner/repo` would read as a website source in any shell where `GH_HOST` is unset (§2.2, §4.3).

**Solution**: Every entry an add writes records the source form the line gave. `gitlab:owner/repo` records that form and `https://gitlab.com/owner/repo` records the URL, though both clone the same repository. A re-add records the form it was given in place of the one recorded, and each entry a menu run installs records the form the run was given. `update`, by key, with no argument and from `list`, clones each entry from what it records, never reading it again as a source line, and keeps the recorded form when it rewrites the entry. Entries recorded before this change keep their keys and update from what they recorded, and a local-path install keys as it does today.

**Outcome**: Each entry carries the form it was installed from, and every entry, old or new, keeps updating from the repository it records.

**Acceptance Criteria**:
- [ ] Given a gitlab.com repository `owner/repo` with a root SKILL.md, when it is added as `gitlab:owner/repo`, the manifest entry `owner/repo` records `gitlab:owner/repo` as its source; when it is added instead as `https://gitlab.com/owner/repo`, the entry records that URL; both adds clone the same gitlab.com repository (§4.3)
- [ ] Given the entry added as `gitlab:owner/repo`, when it is re-added as `https://gitlab.com/owner/repo`, the entry records the URL in place of `gitlab:owner/repo` (§4.3)
- [ ] Given `git@github.com:owner/repo.git`, a skills-only repository, when skills `a` and `b` are picked from its menu, the entries `owner/repo/a` and `owner/repo/b` each record `git@github.com:owner/repo.git` (§4.3)
- [ ] Given the entry added as `gitlab:owner/repo`, when the repository changes and `update owner/repo`, `update` with no argument, or `list`'s update action runs, it re-clones from gitlab.com and reinstalls the change, and the entry still records `gitlab:owner/repo` (§1.2, §4.3)
- [ ] Given an entry installed from `https://ghe.example.com/owner/repo` with `GH_HOST=ghe.example.com`, when the repository changes and `update owner/repo` or `update` with no argument runs with `GH_HOST` unset, it re-clones from ghe.example.com, reinstalls the change, and is never refused as a website source (§4.3)
- [ ] Given an entry for `owner/repo` recorded before this change, and one from an older manifest that records no clone address, when `update` runs, each keeps its key and re-clones `owner/repo` from github.com; given an entry recorded before this change from `https://gitlab.com/owner/repo`, it keeps its key and re-clones from gitlab.com (§4.3)
- [ ] Given a skill added from a local path, its entry keys as it does today and `update` reinstalls it from that path (§4.3)

**Do**:
- Record the full source with the entry. `update` clones the entry from the source as recorded and never reads it again as a source line under §2.2 (§4.3).
- Where the work lives:
  - what an add records: `buildAddEntry` and `deriveCloneUrlForManifest` in `src/commands/add.ts`; `ManifestEntry`, `buildManifestEntry` and the read-side backfill in `readManifest` in `src/manifest.ts`;
  - update's clone from the entry: `cloneRepoOnce` (`src/clone-reinstall.ts`) through `buildParsedSourceFromKey` (`src/source-parser.ts`), used by the single-key update and by `list`'s update action (`src/commands/list-update-action.ts`); `deriveCloneUrlFromKey` (`src/source-parser.ts`) as `groupEntriesForUpdate` (`src/update-groups.ts`), `checkForUpdate` (`src/update-check.ts`) and `list`'s change-version action (`src/commands/list-change-version-action.ts`) use it;
  - the entry an update rewrites: `buildSuccess` in `src/nuke-reinstall-pipeline.ts`, which carries `cloneUrl` over from the existing entry today.

**Context**:
> - §4.3: "The full source is recorded with the entry for cloning and for printed `add` commands (§14.1). `update` clones the entry from the source as recorded and never reads it again as a source line under §2.2. So an install from the `GH_HOST` host updates whether or not `GH_HOST` is set when `update` runs."
> - §4.3: "A re-add from the same repository is a re-add (§4.4, §8.4), and the entry records the form the re-add was given." "Every key recorded today for a two-segment repository is unchanged." "A local path keys as it does today."
> - §14.1: the `owner/repo` shorthand is printed only for an install that came from GitHub over https; "Any other install prints the form it came from: the `gitlab:` prefix or the GitLab or Azure Repos URL, the GitHub Enterprise URL, the `.git` URL, the SSH address or `ssh://` URL …, or the local path."
> - Task 5-10 already makes an Enterprise install update from its host whatever `GH_HOST` holds when `update` runs, cloning from the address recorded today. This task keeps that true once the entry records the form.
> - Related work elsewhere: task 6-3 makes a re-add from any form naming the installed entry's repository reach that entry; task 6-5 groups all-mode updates by the address each entry clones from; Phase 15 prints the recorded form (§14.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §2.2, §4.3, §14.1

## vercel-skills-compatibility-6-2

### Task vercel-skills-compatibility-6-2: An add onto a key an install from another repository holds meets the clash prompt

**Problem**: Two different repositories can share a key: a GitHub repository and its `GH_HOST` Enterprise mirror, the same `owner/repo` on GitHub and GitLab, or two GitLab subgroups both ending `tools/skills` (§4.3). Phase 5 lets every one of these be added. `add` reads whatever entry sits on its own key as the install it is replacing. It finds that entry by key (`manifest[parsed.manifestKey]` in `runAdd`, `currentManifest[pluginManifestKey]` in `runCollectionPipeline`, `src/commands/add.ts`), removes its files, and its collision check skips that key (`checkFileCollisions` in `runConflictChecks`). Task 4-9 tells the same install from a different unit by the skill the entry's recorded folder holds in the source being added, and an entry from another repository whose recorded folder holds a same-named skill there passes that test. So adding `gitlab:owner/repo` over a GitHub `owner/repo` install silently replaces it, even when none of their files overlap. Read as a re-add, the new install would also keep the replaced install's recorded agents (§8.4).

**Solution**: Two sources name the same repository when host and repository path match (§4.3). An entry from another repository on the key an add lands on is another managed install in the way, whether or not any of its files overlap and whatever its skill declares. It is never read as a re-add and never silently replaced. At a terminal the add meets "Remove <key> and continue". Accepting removes the holder with its files and entry, and the new install takes the key, recording only the agents it names. Declining or cancelling leaves the holder and its files as they were, and nothing of the new install is written. A menu pick landing on such a key meets the same prompt, and so does a re-add moving an old-rule install onto a key another repository's install holds.

**Outcome**: No add from one repository replaces another repository's install unless the user agrees to remove it.

**Acceptance Criteria**:
- [ ] Given a root skill declaring `foo` installed for Claude from GitHub `owner/repo` under key `owner/repo`, when `gitlab:owner/repo`, whose root SKILL.md declares `bar`, is added at a terminal for Claude, the add meets "Remove owner/repo and continue", though none of the GitHub install's files lies in the GitLab skill's path (§4.3, §10.1)
- [ ] Given that prompt declined or cancelled, `.claude/skills/foo/` and the GitHub entry are unchanged and nothing of the GitLab skill is written. Given it accepted, `.claude/skills/foo/` and the GitHub entry are removed, the GitLab skill installs into `.claude/skills/bar/`, and the entry `owner/repo` records `gitlab:owner/repo` (§4.3, §10.1, §10.3)
- [ ] Given the GitHub install recorded for Claude and Codex, when `gitlab:owner/repo` is added choosing only Cursor and the prompt is accepted, the entry `owner/repo` records Cursor alone, and neither skill has a copy left for Claude or Codex (§4.3, §8.4)
- [ ] Given `GH_HOST=ghe.example.com` and an install from GitHub `owner/repo`, when `https://ghe.example.com/owner/repo` is added at a terminal, it meets "Remove owner/repo and continue"; given an install from `https://gitlab.com/a/tools/skills`, when `https://gitlab.com/b/tools/skills` is added, it meets "Remove tools/skills and continue"; in each, declining leaves the existing install and its entry as they were (§4.3, §10.1)
- [ ] Given `foo` picked from the menu of GitHub `owner/repo` and installed as `owner/repo/foo`, when `foo` is picked from the menu of `gitlab:owner/repo`, a skills-only repository whose `skills/foo/` also declares `foo`, the pick meets "Remove owner/repo/foo and continue"; declining leaves the GitHub install and its entry as they were and installs nothing of the GitLab `foo` (§4.3, §10.1)
- [ ] Given `composition-patterns` installed for Claude from GitHub `owner/repo` under the old rules as `owner/repo/composition-patterns`, whose `skills/composition-patterns/` declares `vercel-composition-patterns`, and `owner/repo/vercel-composition-patterns` held by an install from `gitlab:owner/repo`, when `vercel-composition-patterns` is picked again from the menu of `owner/repo` at a terminal, it meets "Remove owner/repo/vercel-composition-patterns and continue"; declining leaves `.claude/skills/composition-patterns/`, the GitLab install and both entries as they were (§4.3, §4.4, §10.1)

**Do**:
- Two sources name the same repository when host and repository path match, whatever form names them (§4.3).
- An entry from another repository on the add's key is another managed install in the way, whether or not files overlap (§4.3). It is met through today's "Remove <key> and continue" prompt (`resolveCollisions` in `src/collision-resolve.ts`, which §10.1 cites), which removes the holder's files and entry when accepted (§10.3).
- Where the work lives: the existing-entry handling in `runAdd` and `runCollectionPipeline`, and `runConflictChecks`, in `src/commands/add.ts`, where task 4-9 already tells the same install from another unit of the same repository; `checkFileCollisions` (`src/collision-check.ts`), which skips the add's own key.

**Context**:
> - §4.3: "Two different repositories can share a key: a GitHub repository and its Enterprise mirror, the same `owner/repo` on GitHub and GitLab, or two GitLab subgroups both ending `tools/skills`. An install from another repository onto a key an existing install holds is a clash with another managed install (§10.3). It is never read as a re-add of the existing install and never silently replaces it. At a terminal it meets "Remove <key> and continue"; under `-y` or from an agent caller it stops that unit unless `--overwrite` is given. Removing the existing install, either way, hands the key to the new one."
> - §4.3: "A skill being added from the same repository is the same install when it shares that identity". Identity by declared name applies only within one repository.
> - §10.1: only the two clash prompts delete anything when answered yes, and cancelling at any prompt leaves every existing install and file as it was.
> - §8.4: a re-add keeps every recorded agent. An install from another repository is not a re-add of the holder, so it has no recorded agents to keep.
> - Related work elsewhere:
>   - task 6-1 records the form the add was given;
>   - task 6-3 covers the forms that name one repository, whose adds stay re-adds, and task 6-4 the addresses of one Azure Repos repository;
>   - task 6-7 is the update-side counterpart;
>   - Phase 10 adds "Proceed with installation?", which must also be answered yes before what a clash prompt agreed to delete is removed (§10.1);
>   - Phase 11 stops the unit under `-y` and for agent callers unless `--overwrite` is given.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §4.4, §8.4, §10.1, §10.3

## vercel-skills-compatibility-6-3

### Task vercel-skills-compatibility-6-3: Every form naming one repository re-adds its install

**Problem**: One repository can be named in many forms. A GitHub repository is `owner/repo`, `github:owner/repo`, its https URL with or without `.git`, its SSH address or its `ssh://` URL. A GitLab repository is its URL, a `/-/tree/` URL into it or its SSH address. A self-hosted repository is its `.git` URL, with or without a user in it, its SSH address, or its `ssh://` URL, with or without a port. These forms record different sources (task 6-1), some clone from different addresses, and entries recorded before this change record only the address they clone from, or none. A same-repository test that compared what was recorded, rather than the repository named, would meet a re-add written in another form as a clash from another repository (task 6-2), and accepting it would drop the recorded agents. It would also miss an install still under its old key or folder, so the re-add would install a second copy beside it (§4.4). The test must not overreach either: an add from another repository whose skill declares the same name must never reach an old-rule install as if it were the same install (§4.3).

**Solution**: Sources name the same repository when host and repository path match, whatever form names them: `.git` is dropped, a `/-/tree/` URL's repository path is everything before `/-/`, and the host is compared without user or port (§4.3). An entry recorded before this change is from the repository it updates from (task 6-1). A re-add from any form naming the installed entry's repository is a re-add. It shows no clash prompt, keeps every recorded agent and adds the chosen ones (§8.4), and the entry records the form the re-add was given, which the next update clones from. An install still under its old key or folder is reached by a re-add from any form naming its repository (§4.4). It is never reached by an add from another repository, even one whose skill declares the same name.

**Outcome**: However a user writes a repository, adding from it again re-adds the install already there, and an add from another repository never does.

**Acceptance Criteria**:
- [ ] Given a root skill installed for Claude from `owner/repo`, when it is re-added at a terminal from any of `github:owner/repo`, `https://github.com/owner/repo`, `https://github.com/owner/repo.git`, `git@github.com:owner/repo.git` or `ssh://git@github.com/owner/repo.git`, choosing Cursor, no "Remove … and continue" prompt is shown, and the entry `owner/repo` records Claude and Cursor and the form the re-add was given. After the re-add from `git@github.com:owner/repo.git`, when the repository changes and `update owner/repo` runs, it re-clones over SSH from that address and reinstalls the change (§4.3, §8.4)
- [ ] Given a root skill installed for Claude from `owner/repo` before this change, its entry recording only the github.com address it clones from, or no address in an older manifest, when it is re-added from `owner/repo` or `git@github.com:owner/repo.git` choosing Cursor, no clash prompt is shown and the entry `owner/repo` records Claude and Cursor (§4.3, §8.4)
- [ ] Given `lint`, from `skills/lint/`, picked from the menu of `https://gitlab.com/acme/platform/agent-kit` and installed for Claude as `platform/agent-kit/lint`, when it is re-added through `https://gitlab.com/acme/platform/agent-kit/-/tree/main/skills/lint`, or picked from the menu of `git@gitlab.com:acme/platform/agent-kit.git`, choosing Cursor, no clash prompt is shown and the entry `platform/agent-kit/lint` records Claude and Cursor (§4.3, §8.4)
- [ ] Given a root skill installed for Claude from `https://git.example.com/team/repo.git`, when it is re-added from any of `git@git.example.com:team/repo.git`, `ssh://git@git.example.com/team/repo.git`, `https://deploy@git.example.com/team/repo.git` or `ssh://git@git.example.com:2222/team/repo.git`, choosing Cursor, no clash prompt is shown and the entry `team/repo` records Claude and Cursor (§4.3, §8.4)
- [ ] Given an old-rule install for Claude in `.claude/skills/composition-patterns/` under `owner/repo/composition-patterns`, installed from `owner/repo`, whose `skills/composition-patterns/` declares `vercel-composition-patterns`, when `vercel-composition-patterns` is picked from the menu of `git@github.com:owner/repo.git` choosing Cursor, the outcome is (§4.3, §4.4, §8.4):
  - `.claude/skills/vercel-composition-patterns/` and `.cursor/skills/vercel-composition-patterns/` hold the skill, and `.claude/skills/composition-patterns/` is gone;
  - the manifest holds one entry for it, `owner/repo/vercel-composition-patterns`, recording Claude, Cursor and `git@github.com:owner/repo.git`, and no `owner/repo/composition-patterns`.
- [ ] Given that old-rule install from GitHub, when `vercel-composition-patterns` is picked for Claude from the menu of `gitlab:owner/repo`, whose `skills/composition-patterns/` also declares `vercel-composition-patterns`, the GitHub install stays in `.claude/skills/composition-patterns/` under `owner/repo/composition-patterns`, unchanged, and the GitLab skill installs as its own entry `owner/repo/vercel-composition-patterns` (§4.3, §4.4)

**Do**:
- Two sources name the same repository when host and repository path match, whatever form names them: `.git` is dropped, a `/-/tree/` URL's repository path is everything before `/-/`, and the host is compared without user or port (§4.3).
- Apply that test wherever an add looks for the installed entry it re-adds: the entry on the key it lands on (task 6-2), and an install under its old key or folder, found by §4.3's identity as task 4-8 finds it (§4.4).
- Where the work lives: the existing-entry handling in `runAdd` and `runCollectionPipeline` (`src/commands/add.ts`); the host and repository path each form parses to, in `parseSource` and its branches (`src/source-parser.ts`).

**Context**:
> - §4.3: "Two sources name the same repository when host and repository path match, whatever form names them: `owner/repo`, its https URL and its SSH address are one repository. The host is compared without user or port, as a one-segment repository path names it: `https://git.example.com/team/repo.git`, `https://deploy@git.example.com/team/repo.git` and `ssh://git@git.example.com:2222/team/repo.git` are one repository. … A re-add from the same repository is a re-add (§4.4, §8.4), and the entry records the form the re-add was given."
> - §4.3: "A `/-/tree/` URL's repository path is everything before `/-/`." "An SSH address, an `ssh://` URL and a `.git` URL key the last two segments of the repository path, with `.git` dropped".
> - §4.3: "An installed skill is the skill its recorded source folder holds, in the source the add reads, known by that skill's declared name … A skill being added from the same repository is the same install when it shares that identity".
> - §4.4: "An install of the same skill from the same repository, made under its old key or folder, is the installed entry for that re-add (§8.4). It moves to its declared-name folder and key, as an update would move it, and keeps every recorded agent. A re-add never installs a second copy beside it."
> - Related work elsewhere:
>   - task 6-4 covers the addresses of one Azure Repos repository, whose hosts and paths differ;
>   - entries of one repository recording forms that clone from different addresses update in separate groups (task 6-5);
>   - the GitHub old-rule install left beside a GitLab install of the same declared name stops when its update would move onto the GitLab entry's key (task 6-7), and meets the clash prompt when re-added (task 6-2).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §4.4, §8.4

## vercel-skills-compatibility-6-4

### Task vercel-skills-compatibility-6-4: An Azure Repos repository is one repository from any of its addresses

**Problem**: An Azure Repos repository has three addresses: `https://dev.azure.com/org/project/_git/repo`, the older `https://org.visualstudio.com/project/_git/repo`, and the SSH address `git@ssh.dev.azure.com:v3/org/project/repo`. Their hosts and paths differ, so the host-and-path test (task 6-3) would read them as three repositories, though all three key `project/repo`. A re-add from another of its addresses would then meet the install as a clash from another repository (task 6-2), and accepting it would drop the recorded agents. The older URL does not install correctly today: agntc keeps the last two path segments of an https URL (`parseHttpsUrl` in `src/source-parser.ts`), so it clones `https://org.visualstudio.com/_git/repo.git` under the key `_git/repo`.

**Solution**: An Azure Repos repository is named by its organisation, project and repository, whichever of its addresses names it. The SSH address's `v3` is a marker, as `_git` is, and not part of the name (§4.3). The `visualstudio.com` URL is an Azure Repos `_git` URL and so a git source (§2.2): it clones from that repository and keys `project/repo`, as the SSH address does. A re-add from any of the three addresses over an install from another is a re-add. It shows no clash prompt and keeps every recorded agent while adding the chosen ones (§8.4). The entry records the address the re-add was given, and the next update clones from it. An address naming the same project and repository in another organisation names another repository that shares the key `project/repo`, and meets "Remove project/repo and continue" (task 6-2).

**Outcome**: An Azure Repos install is re-added in place from any of its addresses, and never confused with a same-named repository in another organisation.

**Acceptance Criteria**:
- [ ] Given `https://org.visualstudio.com/project/_git/repo`, a repository with a root SKILL.md declaring `lint`, when it is added for Claude, it clones that repository, installs into `.claude/skills/lint/` and keys the entry `project/repo`; today it clones `https://org.visualstudio.com/_git/repo.git` under `_git/repo` (§2.2, §4.3)
- [ ] Given that skill installed for Claude from `https://dev.azure.com/org/project/_git/repo`, when it is re-added at a terminal from `git@ssh.dev.azure.com:v3/org/project/repo` or from `https://org.visualstudio.com/project/_git/repo`, choosing Cursor, no clash prompt is shown, and the entry `project/repo` records Claude and Cursor and the address the re-add was given (§4.3, §8.4)
- [ ] Given the entry re-added from `git@ssh.dev.azure.com:v3/org/project/repo`, when the repository changes and `update project/repo` runs, it re-clones from that SSH address and reinstalls the change (§4.3)
- [ ] Given the skill installed for Claude from `git@ssh.dev.azure.com:v3/org/project/repo`, when it is re-added from `https://dev.azure.com/org/project/_git/repo` choosing Cursor, no clash prompt is shown and the entry records Claude and Cursor (§4.3, §8.4)
- [ ] Given the install from `https://dev.azure.com/org/project/_git/repo`, when `https://dev.azure.com/other/project/_git/repo` or `git@ssh.dev.azure.com:v3/other/project/repo` is added at a terminal, it meets "Remove project/repo and continue"; declining leaves the `org` install and its entry as they were, and accepting removes them and the new install takes `project/repo` (§4.3, §10.1)

**Do**:
- Name an Azure Repos repository by its organisation, project and repository, whichever address names it; `v3` in the SSH address is a marker, as `_git` is (§4.3).
- Where the work lives: `parseSource`, `parseHttpsUrl` and `parseSshUrl` in `src/source-parser.ts`; the same-repository test tasks 6-2 and 6-3 apply in `src/commands/add.ts`.

**Context**:
> - §4.3: "An Azure Repos repository is named by its organisation, project and repository whichever of its addresses names it: `https://dev.azure.com/org/project/_git/repo`, the older `https://org.visualstudio.com/project/_git/repo` and the SSH address `git@ssh.dev.azure.com:v3/org/project/repo` are one repository, the SSH address's `v3` being a marker as `_git` is. A re-add from the same repository is a re-add (§4.4, §8.4), and the entry records the form the re-add was given."
> - §4.3: "An Azure Repos URL keys the project and the repository; `_git` is a URL marker, not a namespace". An SSH address keys the last two segments of its repository path, so `git@ssh.dev.azure.com:v3/org/project/repo` keys `project/repo` (task 5-5).
> - §2.2 lists "an Azure Repos `_git` URL" among git sources.
> - Related work elsewhere: task 5-9 reads the `dev.azure.com` URL with `?path=` and `?version=`; task 6-6 reaches the entries of one Azure Repos repository together by `project/repo` and refuses that key over two organisations' entries; Phase 15 prints the address an entry records (§14.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §2.2, §4.3, §8.4, §10.1

## vercel-skills-compatibility-6-5

### Task vercel-skills-compatibility-6-5: Update with no argument updates each group from its own address under its own label

**Problem**: All-mode `update` groups entries by the address they clone from and their version intent (`groupEntriesForUpdate` in `src/update-groups.ts`). It labels each group by the `owner/repo` of its first member's key, adding the version intent only when one `owner/repo` yields several groups (`groupLabel` and `repoOf` in `src/update-render.ts`). Two kinds of group can now share an `owner/repo`: entries from two repositories, such as `owner/repo/a` from GitHub and `owner/repo/b` from GitLab (§4.3), and entries of one repository recording forms that clone from different addresses (task 6-1). Such groups update separately, but at the same version intent they print identical labels. The user sees two `Updating owner/repo …` headers, or two identical up-to-date lines, and cannot tell which repository or address each one means (§12.1). At different version intents their labels still never say which repository or address each group is from.

**Solution**: Each group updates from the address its entries record. Entries from two repositories sharing `owner/repo` update each from its own repository, and entries of one repository recording forms that clone from different addresses update in separate groups, each from its own address. Labels follow §12.1. Where the groups of an `owner/repo` clone from more than one address, each is named instead by the address its entries are cloned from, and by its version intent too where that address yields several groups. The groups of an `owner/repo` that clones from one address keep today's labels: the bare `owner/repo`, or with the version intent where it yields several groups. Entries whose forms clone from one address, such as `owner/repo` and `github:owner/repo`, stay one group. No two groups print the same label on any line that names a group.

**Outcome**: A bulk update never mixes two repositories or two addresses in one group, and every group line says which one it means.

**Acceptance Criteria**:
- [ ] Given `owner/repo/a` installed from GitHub `owner/repo` and `owner/repo/b` from `gitlab:owner/repo`, each behind upstream in its own repository, when `update` runs with no argument, `a` re-clones from github.com and reinstalls GitHub's change, and `b` re-clones from gitlab.com and reinstalls GitLab's change (§4.3)
- [ ] Given those two entries at the same version intent and both behind, the two groups' `Updating …` headers differ, one naming the github.com address `a` clones from and the other the gitlab.com address `b` clones from; today both print `owner/repo` with the same version-intent suffix (§12.1)
- [ ] Given those two entries both up to date, the trailing summary prints one up-to-date line for each group, each naming its group's address, and the two lines differ (§12.1)
- [ ] Given `owner/repo/a` and `owner/repo/b` recording `owner/repo`, and `owner/repo/c` re-added from `git@github.com:owner/repo.git`, all at the same version intent and behind upstream, when `update` runs with no argument, `a` and `b` update in one group cloned from github.com over https, `c` updates in another cloned over SSH from `git@github.com:owner/repo.git`, and each group's header names the address it clones from (§4.3, §12.1)
- [ ] Given `owner/repo/a` from GitHub `owner/repo` at `^1.0.0`, `owner/repo/b` from GitHub `owner/repo` pinned to `v2.0.0`, and `owner/repo/c` from `gitlab:owner/repo` at `^1.0.0`, the two GitHub groups are each named by the github.com address with their version intent, `^1.0.0` and `v2.0.0` respectively, and the GitLab group by its gitlab.com address alone (§12.1)
- [ ] Given `owner/repo/a` recording `owner/repo` and `owner/repo/b` recording `github:owner/repo` at one version intent, they update as one group under the bare label `owner/repo`; given entries of that repository at `^1.0.0` and pinned to `v2.0.0`, all cloning from github.com over https, they print today's labels, `owner/repo@^1.0.0` and `owner/repo@v2.0.0` (§12.1)
- [ ] Rule: no two groups in one run print the same label on any line that names a group: the `Updating …` header, the up-to-date, newer-tags, check-failed and constrained-no-match summary lines, the clone-failure line and the out-of-constraint footer (§12.1)

**Do**:
- Where two groups would share a label, name each by the address its entries are cloned from, and by its version intent too where one address yields several groups (§12.1).
- Where the work lives: `groupLabel` and `repoOf` in `src/update-render.ts`; `groupEntriesForUpdate` in `src/update-groups.ts`; the label's callers in `src/commands/update.ts`, in `runAllUpdates` and its streamed group headers, trailing summary and out-of-constraint footer.

**Context**:
> - §12.1: "`update` with no argument labels the entries it clones together by their `owner/repo`, as today. Two such groups can share that label: entries from two repositories sharing `owner/repo` (§4.3), or entries of one repository recording forms that clone from different addresses. Where they would, each group is named instead by the address its entries are cloned from, and by its version intent too where one address yields several groups, so no two groups print the same label."
> - §4.3: two different repositories can share a key, such as the same `owner/repo` on GitHub and GitLab.
> - The corrigendum that settled §12.1's labels rests on grouping by clone address and version intent, which makes that pair unique to each group, and on the tree's own judgement on `groupLabel` that identical labels for distinct groups are a correctness bug.
> - Related work elsewhere: a group's newer-tags line and the out-of-constraint footer also print an `npx agntc add …` command. Phase 7 moves its version after `#`, and Phase 15 makes it name the form the entries record (§14.1). This task changes the label those lines print, not the command.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §12.1

## vercel-skills-compatibility-6-6

### Task vercel-skills-compatibility-6-6: A key reaching entries from two repositories is refused

**Problem**: `remove` and `update` match their key argument through `resolveTargetKeys` (`src/resolve-target-keys.ts`): an entry with exactly that key is taken alone, and otherwise every entry under the key is taken. Once two repositories can share `owner/repo` (§4.3), a key with entries from both under it reaches installs from both. `remove owner/repo` would delete the other repository's installs along with the ones meant, and `update owner/repo` would update both.

**Solution**: Keys keep today's matching (§12.1). A key with no exact entry that reaches entries from two different repositories is refused (§1.5): the command exits non-zero, clones, removes and updates nothing, and its message lists the keys it reached, each of which still reaches its own entry. Repositories are told apart as an add tells them (tasks 6-2 to 6-4). Entries of one repository recorded in different forms, or recorded before this change, are one repository, so a key reaching only them acts on them all. The same holds for the entries of one Azure Repos repository recorded from its different addresses, while two organisations sharing `project/repo` are two repositories. An entry with exactly that key is taken alone, even with another repository's entries under it.

**Outcome**: One key never acts on two repositories' installs, and the refusal shows the key that reaches each entry.

**Acceptance Criteria**:
- [ ] Given `owner/repo/a` installed from GitHub `owner/repo` and `owner/repo/b` from `gitlab:owner/repo`, and no entry keyed `owner/repo`, when `remove owner/repo` runs, it exits non-zero, removes no file and no entry, and its message says the key reaches installs from more than one repository and lists `owner/repo/a` and `owner/repo/b` (§1.5, §12.1)
- [ ] Given the same entries, when `update owner/repo` runs, it exits non-zero, clones nothing, leaves both entries and their files as they were, and its message lists both keys (§1.5, §12.1)
- [ ] Given the same entries, `remove owner/repo/a` removes the GitHub entry and its files alone, and `update owner/repo/b` acts on the GitLab entry alone (§12.1)
- [ ] Given a root skill installed from GitHub `owner/repo` under `owner/repo`, and `owner/repo/x` picked from the menu of `gitlab:owner/repo`, `remove owner/repo` removes the GitHub root skill alone and leaves `owner/repo/x` and its files as they were (§12.1)
- [ ] Given `owner/repo/a` installed from `owner/repo` before this change and `owner/repo/b` recording `git@github.com:owner/repo.git`, `remove owner/repo` removes both, and `update owner/repo` updates both (§4.3, §12.1)
- [ ] Given `project/repo/a` installed from `https://dev.azure.com/org/project/_git/repo` and `project/repo/b` from `git@ssh.dev.azure.com:v3/org/project/repo`, `remove project/repo` removes both; given `project/repo/b` installed instead from `https://dev.azure.com/other/project/_git/repo`, `remove project/repo` is refused, listing both keys (§4.3, §12.1)

**Do**:
- Keys keep today's matching: an entry with exactly that key is taken alone, and a key with no exact entry acts on every entry under it (§12.1).
- Tell repositories apart as an add does (§4.3; tasks 6-2 to 6-4).
- Where the work lives: `resolveTargetKeys` (`src/resolve-target-keys.ts`), used by `runRemove` (`src/commands/remove.ts`) and `runUpdate` (`src/commands/update.ts`).

**Context**:
> - §12.1: "Keys keep today's matching. An entry with exactly that key is taken alone, and a key with no exact entry acts on every entry under it. So `remove owner/repo` removes every entry installed from that repository, unless the repository is itself a single skill keyed `owner/repo` (§4.3). A key that reaches entries from two different repositories (§4.3) is refused (§1.5), and the message lists their keys, as for a name that matches installs from two repositories (§7.1). Each entry stays reachable by its full key."
> - §1.5: a refusal is pre-flight: the command exits non-zero, writes and removes nothing, and its message names what was refused and the way through where one exists.
> - Related work elsewhere: Phase 13 lets `remove` and `update` take several arguments and skill names, and refuses a name matching installs from two repositories the same way (§7.1, §12.1). `list`'s update and remove actions act on one entry's own key.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §4.3, §7.1, §12.1

## vercel-skills-compatibility-6-7

### Task vercel-skills-compatibility-6-7: An update moving onto a key an install from another repository holds stops that entry

**Problem**: An update can move an entry onto a new key: a skill to its declared-name key, a plugin member to its path key, a repaired entry to its skill's key (§4.4, §5.5). Task 4-12 stops such a move when another entry from the same repository holds the key as a different unit. The key may instead be held by an install from another repository: skill folder `bar/` declaring `foo`, installed from GitHub under the old rules as `owner/repo/bar`, moves onto `owner/repo/foo` while an install from GitLab holds it. Read as the same skill because it declares the same name, the holder would be merged with the moving entry into one entry, or reported with it as one skill needing a merging re-add, as §4.4 treats two old-rule entries of one skill. Written over, the holder's entry would be lost and its files left untracked.

**Solution**: An install from another repository holding the key a move, re-key or repair lands on is another managed install in the way, whether or not files overlap (§4.3, §12.6). It is never the same skill, even when it declares the same name, so the two are never merged and never reported as one skill. Without `--overwrite`, the moving entry stops: its install stays under its old key, and the holder's files and entry stay as they were. The output says the key is held and names `--overwrite`, other entries proceed, and the command exits non-zero. When two entries from different repositories move onto one key in the same update, the second finds the first in its way. With `update --overwrite`, the holder is removed with its files and entry, and the moved entry takes the key.

**Outcome**: No update takes over, or merges into, another repository's install unless told to replace it.

**Acceptance Criteria**:
- [ ] Given skill folder `bar/` declaring `foo`, installed for Claude from GitHub `owner/repo` under the old rules as `owner/repo/bar` in `.claude/skills/bar/`, and `owner/repo/foo` held by a skill declaring `foo` installed for Codex alone from `gitlab:owner/repo`, so that none of the holder's files lies in `.claude/skills/foo/`, when `update owner/repo/bar` runs, the outcome is (§4.3, §4.4, §12.6):
  - `.claude/skills/bar/` and the entry `owner/repo/bar` are unchanged;
  - `.agents/skills/foo/` and the GitLab entry `owner/repo/foo` are unchanged;
  - the output says `owner/repo/foo` is held by another install and names `--overwrite`, and never says the two are the same skill or names a re-add that merges them;
  - the command exits non-zero.
- [ ] Given the top-level folder `kit/` in GitHub `owner/repo`, holding SKILL.md declaring `foo` beside `agents/`, recorded under the old rule as the plugin `owner/repo/kit`, while the GitLab install holds `owner/repo/foo`, when `update` runs, the entry is not repaired: it stops the same way, with its agents still in `.claude/agents/` (§4.4, §5.5, §12.6)
- [ ] Rule: a plugin member whose re-key to its path key lands on a key an install from another repository holds stops the same way (§4.4, §12.6)
- [ ] Given skill folder `bar/` in GitHub `owner/repo` and skill folder `baz/` in GitLab `owner/repo`, each declaring `foo` and recorded under the old rules as `owner/repo/bar` and `owner/repo/baz`, when `update` runs with no argument, one of them moves to `owner/repo/foo` and the other stops with its install intact under its old key and its message naming `--overwrite`; the two are never merged into one entry, and the command exits non-zero (§4.3, §4.4, §12.6)
- [ ] Given the stopped `owner/repo/bar` and a third entry with a newer version upstream, when `update` runs with no argument, the third entry updates, `owner/repo/bar` and the GitLab `owner/repo/foo` are both unchanged, and the command exits non-zero (§10.3, §12.6)
- [ ] Given the first scenario, when `update owner/repo/bar --overwrite` runs, the GitLab install's files and entry are removed and the skill moves to `.claude/skills/foo/`; the manifest holds `owner/repo/foo` for the GitHub skill and no `owner/repo/bar` (§4.3, §10.3, §12.6)

**Do**:
- Tell another repository's install from the same install as an add does (task 6-2). It is in the way whether or not files overlap (§4.3, §12.6), and §4.4's merge of two entries moving onto one key is for two entries of one skill from the same repository, never for entries from different repositories (§4.3, §4.4).
- Where the work lives: the held-key stop task 4-12 adds and the replacement task 4-13 adds under `--overwrite`, across `src/nuke-reinstall-pipeline.ts`, `src/clone-reinstall.ts`, `src/update-groups.ts` and `src/commands/update.ts` (`runUpdate`, `persistUnitOutcomes`).

**Context**:
> - §4.3: "An install from another repository onto a key an existing install holds is a clash with another managed install (§10.3). It is never read as a re-add of the existing install and never silently replaces it." And: "A skill being added from the same repository is the same install when it shares that identity".
> - §4.4: "Under the old rules one skill can hold two entries, keyed by its folder basename and by its full subpath (§4.3), each installed for different agents. Both move to the same declared-name key. … An update merges them when both record the same source and version … Where they differ, the update stops the second with its install intact, says the two are the same skill, names the re-add that merges them, and exits non-zero."
> - §12.6: "An entry moving to a key that another entry from the same repository holds as a different unit meets that entry in its way too (§4.3), even when none of its files overlap." Without `--overwrite`, `update` stops that entry, leaves its install intact, says why and exits non-zero; with it, `update` replaces what is in the way.
> - §10.3: a clashing managed install is removed under `--overwrite` as "Remove <key> and continue" removes it.
> - Related work elsewhere: tasks 4-10 and 4-11 stop an update on untracked files or another entry's files in its new path; task 6-2 is the add-side counterpart.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §4.4, §5.5, §10.3, §12.6
