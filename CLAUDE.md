# CLAUDE.md

## Project Overview

agntc is a CLI tool for installing Claude skills from git repos. Claude only: skills, agents and hooks install under `.claude/`, or `~/.claude/` with `-g`. The settled v2 design is `design/v2.md`.

## Commands

- `add <source>` — Install from git/local. Deep walk finds skills and declared packs; one thing installs directly, several give a menu. `--skill <names...>`, `--pack` (`--plugin` hidden alias), `--all`, `--list`, `--overwrite`, `--json`. Semver constraint auto-detection. `owner/repo/path` starts the walk at a folder.
- `remove [key]` — Remove entries (exact key, or every key under a prefix). Interactive picker if no arg. `-y` skips the confirmation.
- `update [key]` — Nuke-and-reinstall. Respects version constraints. Re-walks packs, follows moved skills, asks about entries gone upstream (`-y` removes). No arg = all, and a key naming several entries = those entries, both group-first (per-repo clone/probe dedup + streamed per-group progress); a key naming one entry takes the single-key path.
- `list` — Dashboard with update status + inline actions (update, remove, change version). Machine mode prints every entry with its status.
- `init [skill|pack]` — Scaffold a skill (`SKILL.md`) or a pack (`agntc.json` `{"type": "pack"}`, `skills/my-skill/SKILL.md`, `agents/my-agent.md`, `hooks/my-hook.sh`). `-y` skips the confirmation; without a terminal it needs the type and `-y`.
- `-g`/`--global` on `add`, `remove`, `update`, `list` — install root `~/` (assets under `~/.claude/`), manifest `~/.agntc/manifest.json`. Every command stays within one scope.

## Source Code Structure

```
src/
  cli.ts                    # Entry point, commander setup
  commands/                 # add, remove, update, list (+ list-*-action, list-detail), init
  init/                     # Skill and pack scaffolding, type select; init-render.ts: the row init asks under (the folder, the type, the files as a tree), a row per file created or already there, init's tally (a cut tree counts the files left out, its folders aside)
  command-action.ts         # Commander action wrapper: resolves mode (resolveMode), runs with the matching Ui, writes the machine document, maps ExitSignal to exit code
  ui.ts                     # Ui interface: interactiveUi (the terminal Ui) and MachineUi (JSON document); every word and prompt goes through it; a Block asks select, multiselect or confirm under its row or rows, fitted to the room the question and its options' share leave (children cut whole, `… N more` counted by noun, a tree's folders aside; several rows, `Rows`, as many as fit, then a `… N more <noun>` line at the rows' level, the first row's head when none fits whole; every line wrapped within the width, so a frame takes the lines the fit counts), erased with the question, as is the blank line any question after other lines opens with; a select's or multiselect's choices may carry cells, lined up in columns laid out from every choice (dropped in their `drop` order where the line is too narrow), and a footer of key hints and counts; `escape` names what esc does; stoppingUi (fail and cancel draw what the run owes first)
  message.ts                # Message (string | RichMessage), SubjectMessage, Advice, Remedy; plainText, isMachineOnly; machineOnly, sentence and failure word a plain string for both modes
  documents.ts              # JSON document bodies per command (addBody, listingBody, removeBody, listBody, updateBody)
  scope.ts                  # -g: project vs global install root; agntcCommand builds (and shell-quotes) every printed npx agntc line
  source-parser.ts          # Parse owner/repo[/path], HTTPS/SSH URLs[/path], local paths, tree URLs; key<->source-dir (repoFromKey, keySubpath, memberName, deriveCloneUrlFromKey, resolveGuardedSourceDir); addSourceFor/locateSource build the source a printed add command takes
  discover.ts               # Deep walk: skills, declared packs (with their support folders), strays; skillFolders (a pack's skills, then its support folders); walkableFolders (the folders the walk enters); matchSkills for --skill; PackConflictError / StartPathError
  frontmatter.ts            # SKILL.md frontmatter read (name, description); display + --skill matching only
  config.ts                 # Lenient agntc.json read (never throws on bad JSON); only `type`; declaresPack (`pack` or legacy `plugin`)
  choose-items.ts           # Flags -> Selection; chooseItems decides install / menu / refuse; stray notices; --list lines
  item-menu.ts              # The add multiselect, asked under the source's row
  add-render.ts             # add's rows: the source (key, ref and constraint, what it holds) with its items beneath, as listed, asked about (skills one installed pack holds counted on one line), stopped (unchanged, or failed once the copy began, with the skills it left out), or installed (`N of M installed` after a menu), each with what was cleared out of its way (an entry removed, files replaced); add's tally
  install-item.ts           # InstallItem (skill | pack); keyItem, the one key rule add and update share; keyItems refuses an item's own target clashes, then target and key clashes between items
  asset-targets.ts          # Claude asset routing (.claude/skills|agents|hooks), skillTarget; skillFolderName (the <name> of any path in .claude/skills/<name>/); hookEntryName (the top-level .claude/hooks/ entry a path is or lies in); isSafeSegment
  copy-item.ts              # Copy dispatch: skill vs pack; copyUnits (the folders a copy plans, each with its filter); checkItemLinks, the symlink-escape pre-flight over those units
  copy-bare-skill.ts        # Copy of one skill folder through planCopy/writeCopy (drops top-level agntc.json and .git, in any case, at any depth)
  copy-pack.ts              # Copy a pack: skills and support folders flat, agents/*.md, hooks/*; rollback on failure
  copy-rollback.ts          # Link-safe rollback of a partial copy
  copy-safety.ts            # Path-traversal guard; inspectSourcePath (lstat each segment of a source path); lexical symlink-escape pre-flight for one copied folder (source-root boundary; plans that folder's copy, filter and source kind included, so it reads what the copy reads and no more); planCopy/writeCopy, a copy of a CopyUnit that never follows a link (a clone's link elsewhere in the source copies its target in place, one level)
  compute-incoming-files.ts # Files an item would install; claims + target clashes
  install-paths.ts          # lstat-only inspection of install paths; assertNoLinkInTheWay; contained-path checks; installPathMatcher (paths equal with or without a trailing slash); isInstalledSkill (an installed `.claude/skills/<name>/` is a support folder only when it is a real folder holding no SKILL.md that isn't a folder; a linked SKILL.md, a linked or gone folder, or a path it can't read counts as a skill, never followed, never thrown)
  nuke-files.ts             # nukeManifestFiles: strict removal of recorded paths (recursion from the trailing slash); removePathsInTheWay: on-disk removal for approved replacements. Neither follows links; both refuse paths outside the root
  clear-conflicts.ts        # Files in the way under a ConflictPolicy (overwrite | ask | stop); what it cleared (`Clearance`: an entry removed, files agntc didn't install replaced); a question answered no stops the item on what's still in its way
  collision-check.ts        # Incoming files owned by other entries
  collision-resolve.ts      # Asks under each colliding entry's row (a local key home-shortened) whether to remove it, the question leaving the entry to the row; removes those approved
  unmanaged-check.ts        # Incoming files agntc didn't install (links found by lstat)
  unmanaged-resolve.ts      # Asks under the item's row (a local key home-shortened) whether to replace files agntc didn't install, then to be sure
  in-the-way-render.ts      # The rows files-in-the-way questions sit under: another entry (collisionRow) or an item with files agntc didn't install in its way (unmanagedRow), the files dim beneath
  absorb.ts                 # A pack taking over loose skills from its own source, through its skills only; skills already in an installed pack (installed there as skills)
  entry-source.ts           # SourceId / isSameSource; sourceKeyOf (the source key add gives an entry's source); reAddCommand + groupReAddCommands (path, --pack, --skill line); restoreCommand (a remedy's re-add at the entry's version intent)
  gone-upstream.ts          # settleGone: -y removes, terminal asks under the entry's gone-upstream row (its head from the caller, a local one's as it settles) (default no), machine keeps + reports
  clone-reinstall.ts        # reinstallEntry, one entry's clone and reinstall (`update <key>`, list's update and change version); cloneRepoOnce primitive + runPipeline for the grouped path; recordReinstall (an entry and its key move in one write); recordCopyFailure (the one place a copy failure drops the entry and what it took over); abort/blocked messages
  nuke-reinstall-pipeline.ts# Derive-before-delete replay (pack re-walk, moved skill, gone) + nuke-and-reinstall
  dropped-folders.ts        # droppedButInSource: recorded .claude/skills/<name>/ folders a reinstall won't write whose name is still in the item's source outside every folder it installs (a category of installed folders aside)
  manifest.ts               # Read/write .agntc/manifest.json; legacy normalization on read
  git-clone.ts              # Shallow clone through withGitRetry and isFinalGitError; each attempt clones into an emptied temp folder
  git-utils.ts              # execGit (a timed-out command's message opens `git <cmd> timed out after Ns`); withGitRetry, the one retry (GIT_ATTEMPTS, delays) clones and remote reads share; isFinalGitError, what isn't retried (HTTPS credential failures and timeouts; an SSH "Permission denied" is retried); lsRemote, every remote read (tags, default branch, update-check probes), each attempt under its own timeout
  update-check.ts           # Per-member categorization vs remote (categorizeMember, GroupTarget); constrained checks
  update-check-all.ts       # Checks for every entry (list)
  key-update.ts             # One entry's update under the row its caller opened (keyRowProgress, updateUnderRow: settle the row, then record), which `update <key>` and list's update and change version share; updatePlan; a throw is the caller's to take (list settles it as failedKey)
  update-outcomes.ts        # The per-unit boundaries every update path shares: reportOutcomes (notes, Next remedies) and persistUnitOutcomes (fold and write)
  update-groups.ts          # All-mode group-first dedup: group by (cloneUrl, versionIntent), resolve/clone once per group, orchestrate reinstalls (packs first); PluginOutcome model
  update-render.ts          # All-mode update output: group label, header, per-member/collapsed lines, tag-vs-hash move (re-exports formatVersionMove)
  version-resolve.ts        # Semver tag resolution (resolveVersion, resolveLatestVersion, newestTag); tag-vs-hash rule (isVersionTag, formatVersionMove)
  version.ts                # CLI version from package.json at runtime
  list-render.ts            # list's rows: the dashboard's options (grouped by source, cells for kind, ref and status) and footer counts, the detail view's row and its fields, the empty manifest's row and Next item; what an action changed, counted into the tally
  remove-render.ts          # The rows of a removal: the entry with its folders under each asset folder, then removed (with them) or failed; removalQuestion, the confirm worded by what the rows hold (`Remove it and its 11 folders?`, `Remove them and their 14 folders?`), which list's remove and gone upstream share; goneRow
  entry-assets.ts           # What an entry installs, counted and worded as add counts it (assetSummary, kindAndCounts)
  summary.ts                # Counts and labels (pack counts, ref label); add's item outcomes; update summary; actionable out-of-constraint footer
```

## Key Types

- `Mode`: `"interactive" | "machine"` — machine when `--json` or either of stdin/stdout isn't a TTY
- `Ui`: The single output/prompt surface; `MachineUi` turns prompts into failures and collects `warnings`/`notes`/`report` into one `MachineDocument`
- `AgntcConfig`: Shape of `agntc.json` — `{ type? }`; `"pack"` (or legacy `"plugin"`) declares a pack
- `Discovery`: `{ packs: FoundPack[], skills: FoundSkill[], strays: StrayAssets[] }` from `discover`
- `FoundSkill` / `FoundPack`: name (folder basename), repo-relative path; skill carries frontmatter name/description, pack its skills, `supportFolders` and qualifying `assetDirs`
- `SkillFolder`: `{ name, path }`, a folder installed whole as `.claude/skills/<name>/`; `FoundSkill` extends it, and a pack's support folders are plain ones
- `Selection`: `auto | skills | pack | all`, from the add flags
- `InstallItem`: `{ kind: "skill", skill } | { kind: "pack", pack }`; `KeyedItem` adds the manifest key and `sourceSubpath?`
- `ConflictPolicy`: `overwrite | ask | stop` — `--overwrite`, else ask at a terminal, else stop the item
- `ManifestEntry`: Per-entry tracking (ref, commit, installedAt, files, `type?: "skill" | "pack"`, cloneUrl, constraint?, `sourceSubpath?`, `localRoot?` — the folder a local entry was added from)
- `SourceId`: `remote(cloneUrl) | local(root, exact)` — what "the same source" means for absorption and for `add`'s key check. Remote matches on the repo the clone URL names (`host/owner/repo`; protocol, login, port and `.git` aside, so HTTPS and SSH of one repo match); two recorded local roots match only when equal (a checkout nested in another is its own source); a legacy derived root matches when either holds the other
- `UpdateCheckResult`: Union of update statuses including constrained variants
- `EntryGroup`: All-mode update group — non-local entries sharing `(cloneUrl, versionIntent = constraint ?? ref)`, resolved and cloned once
- `GroupTarget`: Per-group resolved target (`constrained | branch | head | tag | check-failed | constrained-no-match`) that each member categorizes against via `categorizeMember`
- `PluginOutcome`: Per-entry update result (`updated | refreshed | up-to-date | newer-tags | check-failed | failed | copy-failed | aborted | blocked | constrained-no-match | gone-kept | gone-removed | absorbed`) driving the streamed lines, JSON items and `hasFailedOutcome` exit accounting

## Discovery and Packs

`agntc.json` is **optional**. A skill is a folder with `SKILL.md`; a pack is always **declared**, never inferred from shape.

- **Walk.** From the added path (repo root, `owner/repo/path`, tree URL path or local path): `SKILL.md` → skill, not entered; `{"type": "pack"}` → pack, recorded, not entered; anything else descended, max depth 5. Skips hidden dirs, `node_modules`, `dist`, `build`, `vendor`. Symlinked dirs are never entered. `SKILL.md` + pack declaration → skill, with a warning.
- **Packs don't nest.** A pack holds every skill found inside it plus its own top-level `agents/` (`.md` files only), `hooks/` (every entry) and the support folders in its `skills/`. Inner pack declarations are plain folders.
- **Support folders.** Everything in a pack's own top-level `skills/` installs; shape decides only how. A folder with `SKILL.md` is a skill; one a skill the walk found sits under is a category, its folders read the same way; any other is a support folder (`FoundPack.supportFolders`), installed whole as `.claude/skills/<name>/` through `skillUnit` (hidden content kept, `.git` and a top-level `agntc.json` dropped). A folder the 5-level walk reached no skill under is a support folder. Loose files, links, hidden folders and the walk's skipped names are left out. A support folder claims its target as a skill does, so every clash, collision, unmanaged and link-in-the-way check applies, and a pack holding only support folders isn't empty. They aren't skills: never `--skill` matches, moved-skill candidates or entries, and never a loose skill's stand-in. A support folder landing on a loose skill from the pack's own source is a collision with another entry's files, not an absorption, and an installed pack's support folder doesn't make `--skill` leave a skill of that name out (the install tells them apart: a skill's folder holds its `SKILL.md`, `isInstalledSkill`). A skill taken from a pack installs without them, and its note names them. Same rule for a `--pack` folder.
- **Strays.** A non-pack folder with qualifying `agents/`/`hooks/` gets a notice with the `--pack` line that would install them. Agents and hooks install only as part of a pack.
- **Declaring.** Author: `{"type": "pack"}` (legacy `"plugin"` reads as pack). User: `--pack` bundles the added path; refused on a single skill or a path containing packs.
- **Choosing.** One offered item installs without a menu; several give a menu (packs by path, then loose skills by path; never splits a pack). `--skill` matches folder or frontmatter name anywhere, packs included; a skill taken from a pack installs loose with a note. Duplicate names are refused, listing paths. `--skill`/`--pack`/`--all` are mutually exclusive; `--list` combines only with `--pack`. Skills an installed pack from the same source holds are left out with a note.
- **Keys.** Root item → source key; loose skill → `<source>/<folder name>` (+ `sourceSubpath` when the path differs); pack → `<source>/<path>` (`keyItem`). `keyItems` refuses an item whose own folders claim one install path (`<item> can't be installed as it stands: …`, no choice offered, as none mends it), then two items claiming one install path, then two sharing a key (both `… — choose one`).
- **Identity = folder basename** throughout; frontmatter is display and `--skill` matching only.
- **Copy-safety** (`copy-safety.ts`, `install-paths.ts`, `nuke-files.ts`): path-traversal + symlink-escape guards before any copy on `add` and `update`; never write or delete through a symlink in the destination (a link in the way is unlinked as a link); recorded paths outside the install root are refused. Shared `.claude/<asset>` roots are not checked.
- **Links in a source.** A link at or above an item's path blocks it (`add` refuses the start path; `update` blocks before removing anything). A copy never follows a link; each is read from where it sits: out of the clone or local root → refused before anything is removed; to something inside the item the filters keep → a relative link; to something the filters drop, or below a folder they drop → left out; to the item itself or above it → an absolute link into a local source, left out of a clone (deleted once copied); elsewhere in the source → an absolute link into a local source, and in a clone a copy of what it leads to, one level: a file, or a folder whose own links are judged against it (inside it → relative, anything else left out, never copied in turn). A target in `.git` (any case), itself a link or below one, not named exactly as its folders list it (so a filesystem that ignores case can't reach `.git` or the item's own folders), missing or behind a folder that can't be listed, or neither file nor folder is left out; what's copied in is filtered as if it sat at the link's path, and the escape pre-flight reads it too (a local source's pre-flight doesn't, as its copy links instead). The pre-flight plans exactly the item's copy: each skill folder and hook folder with its filter, so a link in a folder the item doesn't install, one its filters drop, or one in `agents/` is never read. A refusal names the link where it sits below the source root. A link at the top of a pack's `hooks/` never installs. Sockets, FIFOs and devices are left out. A local source resolves to its real folder.

## Asset Routing

Claude only. Paths are relative to the install root (project dir, or `~` with `-g`).

| Asset | Target |
|-------|--------|
| skills | `.claude/skills/<folder>/` (flat, pack skills and support folders included) |
| agents | `.claude/agents/` (pack only, `.md` files) |
| hooks | `.claude/hooks/` (pack only) |

## Version Constraints

- `owner/repo` (bare add) — auto-resolves latest semver tag, stores `^major.minor.patch` constraint (0.x caret locks the minor, intended)
- `owner/repo@^1.0` — explicit constraint, resolves best match within range
- `owner/repo@v2.0.0` — exact tag, no constraint stored
- Constraints stored in `ManifestEntry.constraint`, used by `update` to stay within range
- `list` detail view shows out-of-constraint versions when available
- `list` detail counts what an entry installs as `add` counts and words it (a pack: `2 skills, 3 folders, 1 agent`), however many of its paths are recorded: each `.claude/skills/<name>/` once, each top-level `.claude/hooks/` entry once, each agent `.md` file. A pack's skills folder is a skill or a support folder by what the install holds (`isInstalledSkill`), as the manifest records both alike; a skill entry's is a skill, unprobed. Pack wording (skills always counted) only when the entry records something under `.claude/`; a legacy pack recording only `.agents/skills`/`.cursor/skills` paths shows `N other`
- "Change version" action in `list` strips constraint (pin to exact tag)

## Update Strategy

Nuke-and-reinstall: delete manifest `files`, re-clone, re-copy. Constrained entries resolve best match within constraint range.

- **Replays the recorded `type`.** A pack re-walks its path (`forcePack`), so additions arrive and removals go, support folders included; a pack path that is now a single skill reinstalls as a skill (with a note). A re-walk finding two of its folders installing to one place aborts (`sourceClash`) with no remedy, as `add` would refuse the pack too: `<key> can't be updated: in its source, <a> and <b> would both install to <target>, so it can't be installed as it stands. The existing install is left as it is.` A loose skill re-copies from its path; if `SKILL.md` is gone there, a whole-source walk follows it when exactly one skill has its name (note + new `sourceSubpath`), aborts when several do, carrying them (`candidates`, in path order, each the item as the remedy re-adds it, under the entry's source key): `<key> can't be updated: its SKILL.md is gone from <old> and N skills are now named <name>: <a>, <b>. The existing install is unchanged. To follow one of them: <remove> then one of: <add a> or <add b>`. The add lines are alternatives, joined by ` or ` however many there are, so none reads as a shell sequence; each installs its skill at the version the entry tracks (`restoreCommand`; a version change's pins its tag; a local one names the skill's folder, as every local re-add does).
- **Keyed as `add` keys it.** A replayed skill is named by its folder (`folderName`: the path's basename, or the source root's name at the root), never by its key, so a key that disagrees with the folder installs under the folder. The replayed item is keyed by `keyItem` under the entry's source key (`sourceKeyOf`: `owner/repo`, or the local root). When that isn't the entry's key — a pack path now a single skill, a root skill moved below the root, a skill moved to the root, a skill still keyed by a pack's path, a pack recorded by name with a path — the entry moves to that key with `add`'s `sourceSubpath`, the old key dropped in the same manifest write (`recordReinstall`, on every writer), and one note names both (`…, now keyed <new>`). A new key another entry holds aborts the entry before anything is removed (`takenKey`; remedy: `remove <new>` then `update <old>`), unless that entry is a loose skill the pack takes over: it is dropped and the pack recorded under its key in the same write (`recordReinstall` drops what it took over, then records it). The out-of-constraint footer prints its commands for entries as the run left them, leaving out any the run uninstalled (absorbed, removed as gone upstream, copy failed); a group with none left prints no line.
- **Derive-before-delete.** Replay, folders it would drop that the source still has, the new key, files in the way (other entries' and unmanaged), and the symlink-escape scan all run before any file is removed. Irreconcilable change or files in the way → abort that entry, install intact, loud message with the `remove` + re-add (`--overwrite` when files are in the way) remedy. The `remove` names the entry as installed; once the replay has succeeded, the re-add installs the item as replayed (`replayed`): a remote item under its new key, a local one by its folder, which `add` keys as a source of its own (see Re-add commands). The re-add keeps the version the entry tracks (`restoreCommand`). An abort of a list version change redoes that change: the remedy says to change the version again (an update follows the entry's own constraint or pin, so it would never install the chosen tag), and its re-add pins that tag.
- **Nothing still upstream is dropped** (`dropped-folders.ts`). A recorded `.claude/skills/<name>/` the reinstall won't write, whose name is still a folder in the replayed item's source outside everything the item installs, aborts the entry (`stillInSource`): `can't be updated: it would remove <names>, which are still in the source but would no longer be installed`, remedy `remove` + re-add to update it anyway. The walk reads the pack folder as deep as discovery does (`MAX_DEPTH` below the item's path) and never enters a folder the item installs (a pack's skill and support folders, a skill's own folder), as a namesake inside one still installs, nested in it; so a loose skill, or a pack re-typed as one, never trips it. Nor does it enter the pack's own top-level `agents/` or `hooks/`, which install by their own rules and never to `.claude/skills/`. Hidden folders, links and the walk's skipped names are left out. The recorded path must be the folder itself, `.claude/skills/<name>/` (`skillFolderName` in `asset-targets.ts`, the one parser of a skills path, which `list`'s detail view shares). It asks the source, never the install rules, so a gap in those rules stops the update rather than deleting what they miss. A namesake holding a folder the item installs is a v1 category folder whose skills v2 lifts out, so it goes. Recorded paths outside `.claude/skills/` (agents, hooks, legacy `.agents/skills`/`.cursor/skills`) and loose files in it are deliberate drops, never checked; a name gone from the source is a removal upstream. The source is walked only when something would be dropped.
- **Gone upstream.** Nothing left for a skill (or a pack's path gone/empty) → `settleGone`: `-y` removes, a terminal asks (default no; kept entries are asked again next run), machine mode keeps and reports (`gone-kept`, flags `-y`). Never a failure.
- **Absorption.** A pack's skills landing on loose skill entries from its own source take them over (files removed, entries dropped, `absorbed` outcome). Only its skills, by name: its support folder landing on one clashes, so the entry aborts as files in the way. Packs update before skills across the run: a unit (group or local entry) holding a pack runs before units without one, and packs go first within a group. The order ranks whole units, so a unit holding both a pack and loose skills can reinstall one of those skills before another unit's pack takes it over (two groups of one repo, each with a pack); the pack then takes over the reinstalled skill, which ends the same. Otherwise a loose skill a pack takes over is skipped.
- **Re-add commands** (`entry-source.ts`) carry the recorded path and `--pack`; a group's loose skills share one `--skill` line. A local entry's re-add names its item's folder (`add <root>/<path>`), which installs that folder as a source of its own: key `<root>/<path>` and that `localRoot`, not the entry's key under the original root. It is printed only once the entry is gone (an abort's remedy removes it first, a copy failure already has), so it can't collide; the form stays because `--skill <name>` from the root refuses outright when another skill under the root shares the name. A remedy or recovery re-add keeps the entry's version intent (`restoreCommand`): the tag a version change picked, else its constraint, else its tag or branch; an entry on HEAD is added bare. The out-of-constraint footer (bare) and the newer-tags line (`@<newest>`) don't, as their job is to move past the constraint. The source is GitHub shorthand only for a GitHub HTTPS clone URL; other hosts and SSH print the clone URL.
- **Legacy entries.** `type: "plugin"` reads as `pack`; missing `type` derives from recorded `files`; per-agent `agents` is dropped; files recorded under `.agents/skills`/`.cursor/skills` are deleted on update and reinstalled under `.claude/`. Persisted on next write.
- **Per-entry granularity:** one entry aborting doesn't stop siblings. Command exits non-zero if any entry aborted/errored (partial success). With a key, a failed check or no matching tag also exits non-zero, however many entries the key names; without one they only warn. A key naming several entries doesn't stop at a failure.

### All-mode group-first dedup (`update` with no key, or a key naming several entries → `runGroupedUpdates`)

All-mode is a group-first pipeline (`update-groups.ts`); a key naming several entries (a prefix such as `owner/repo`) runs the same pipeline over just those entries, threading and writing the whole manifest so entries outside it stay recorded, with group labels computed from the groups it holds. The three singleton entry points (`update <key>` naming one entry, list update, list change-version) stay on `reinstallEntry`, through `updateUnderRow` (`key-update.ts`).

- **Group → resolve/check once → categorize members → clone once → reinstall.** Non-local entries are grouped by `(deriveCloneUrlFromKey, versionIntent = constraint ?? ref)` — a constrained entry keys on its stable `constraint` and *excludes* the mutating `ref`, so a singly-updated member stays grouped with its behind siblings. One resolution probe, one `cloneRepoOnce` and at most one whole-source walk (`sourceWalk`, shared by members whose skill moved; a walk that fails isn't kept, so the next member walks again) per group; each member categorizes against the shared `GroupTarget` using its own installed commit, so genuine-state splits are preserved. Local entries (`commit === null`) are excluded from grouping — one reinstall each.
- **Failure isolation.** Clone-fatal → N `failed` outcomes (no manifest mutation, non-zero exit, rendered as one enumerated line); check/resolve-fatal → N `check-failed` (no clone, all-mode exit 0), printed as one line (`formatCheckFailedLine`: `<label>: couldn't check for updates (<cause>) — left untouched`, the cause the first line of git's error that names the failure, passing over `warning:`/`hint:`/`Cloning into` lines, without `fatal: `, as with a single key) while the JSON `reason` keeps git's whole error; per-member `copy-failed`/`aborted`/`blocked` stay isolated with remove-vs-intact semantics. Manifest persists per group; the per-member `sourceSubpath` containment guard runs per member via `resolveGuardedSourceDir`.
- **Two-granularity streamed output** (`update-render.ts`): batched `Checking for updates...`, then a per-group `Updating <label> <old> -> <new> (N members)` spinner emitting per-member lines, each named by the key the run left it under (a failure line is its message alone, which names the key once); trailing summary collapses to one line per group per non-actioned category (`up-to-date`, `newer-tags`, `check-failed`, `constrained-no-match`) plus the out-of-constraint footer. The *Group label* is bare `owner/repo`, `@intent`-disambiguated only when one repo yields multiple groups.
- **Tag-vs-hash wording** (`formatVersionMove`, single-sourced in `version-resolve.ts`): tags only when both refs are genuine tags (`isVersionTag`) AND the ref moved; else short commit hashes. Same on the single-key and all-mode surfaces.
- **Actionable gating footer:** names the post-bump current vs newest and the group's re-add commands without a version (bare add re-establishes caret); tag pins get the newer-tags line with `@<newest>`. Informative, exit 0.

## Machine Mode

`--json`, or stdin/stdout not a TTY → `MachineUi`. Never clack, never waits.

- **One JSON document per command** on stdout: `{ ok, command, scope?, error?, ...body, warnings, notes }`; `ok` is true exactly when the exit code is 0. Errors are documents too, exit 1. `scope` (`"project" | "global"`) appears on the four commands that take `-g`, not on `init`.
- **A question is a flag or a stop.** A prompt reached in machine mode fails the command. Callers check `ui.mode` first and fail with `{ flags }` naming the answer: menu → `--skill`/`--pack`/`--all` (document still carries the listing); files in the way → that item stops with `flags: ["--overwrite"]`, the rest install, exit 1; `remove` confirmation → `-y`; `remove` without a key → `<key>`; gone upstream → kept, reported, exit 0; `init` → type + `-y`.
- **`update` items name a moved key.** An entry the update moved to the key `add` gives it reports that key as `key` and the one it had as `previousKey`. An `absorbed` item is the entry as the run found it: its key and record then, no `previousKey`, its message naming the pack (by the key it left, when the pack moved onto the absorbed entry's key; the pack's own item carries `previousKey`).
- **`remove` reports per key.** The document carries `removed` (entries with their files) and `failed` (entries with a `reason`). `remove` tries every key; a key whose files can't be removed stays recorded, so whatever is left stays tracked, and the command exits 1.
- `warn`/`note` reach both modes; `intro`/`outro`/`log`/`spinner`/`box` are terminal-only; `report(body)` sets the document body.

## Testing

```bash
npm test
```

## Build

```bash
npm run build
```

Output: `dist/cli.js`

## Changelog

`CHANGELOG.md` belongs to mint: `mint release` writes each version's entry from the changes since the last tag. Never edit it by hand, and never add an `[Unreleased]` section.
