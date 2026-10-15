# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.3] - 2026-10-15

🐛 Fixed
- When an update can't tell a moved skill apart because several skills now share its name, the error now offers each namesake as a separate `add` command to choose from — each one keeps the version the entry tracks.

## [0.5.2] - 2026-10-14

✨ Added
- Packs now install support folders — folders in a pack's top-level `skills/` that hold no skill (shared references, hook bundles) install whole to `.claude/skills/<name>/` beside its skills, including inside category folders.
- `add --list`, the add menu, the install summary, and the `--json` listing show support folder counts and names (e.g. `2 skills, 3 folders, 1 agent`).
- `list` detail view counts a pack's skills, support folders, agents and hooks the way `add` does, each once however many paths are recorded.

🔧 Changed
- Taking one skill out of a pack with `--skill` names the support folders left behind in its note.
- A pack whose own folders would install to the same place is refused as it stands, with no "choose one" prompt, on both `add` and `update`.
- Failed update checks print one line with the cause (`owner/repo: couldn't check for updates (…) — left untouched`) instead of git's full output; `--json` keeps the full error.
- Copy-failure and abort messages in `update` name the member once instead of repeating its key.
- Copy-failure recovery hints now include the cause of the failure.
- `list` change-version reports why available versions couldn't be fetched instead of failing.
- Remote git reads (tag lists, update probes) now retry up to three times, and SSH "Permission denied" is retried like other transient failures.
- A clone that times out says so, and isn't retried.

🐛 Fixed
- `update` no longer deletes folders from `.claude/skills/` that the repo still holds but would stop installing — it stops, names them, and prints the `remove` + `add` that updates anyway.
- A retried clone starts from an emptied folder, so a partial first attempt no longer hides the real error.
- A pack's support folder landing on a loose skill from the same source now clashes instead of silently absorbing it, and a support folder no longer causes a skill of the same name to be left out of `--skill`.

## [0.5.1] - 2026-10-14

✨ Added
- `update owner/repo` (a key naming several installs) now updates them together — one check and one clone per repo, with grouped streamed output.
- `npm run typecheck` type-checks source and tests, and now gates CI publish and `mint release`.

🔧 Changed
- Updates re-key installs the way `add` would, such as a pack whose folder is now a single skill or a root skill that moved below the root — the entry moves to the new key and a note names both.
- Updating by key now exits non-zero on a dead remote or unmatched constraint, whether the key names one install or several; update-all still only warns.
- Packs update before loose skills across the whole run, so skills a pack absorbs are skipped rather than reinstalled and taken over.
- Remedy and recovery re-add commands keep the install's version (constraint, tag or branch) and point at the item as replayed under its new key.
- Local-source re-add commands name the item's own folder.
- The out-of-constraint footer prints commands only for installs the run left in place, under their current keys.
- Machine-mode `update` items report a moved entry under its new `key` with `previousKey` for the old one.
- `list` follows an entry to its new key after an update or version change.
- Moved skills in a group are located with one shared walk of the clone.
- The symlink-escape check now plans exactly the folders and filters the copy uses, and names the offending link by its path below the source root.

🐛 Fixed
- Updates abort before removing anything when the key an install would move to is already taken, with a remedy that frees it.
- Links in a clone to a file or folder elsewhere in the repo are now copied in place, one level deep, instead of being dropped.
- Links into `.git` are left out of a copy in any letter case.

🔒 Security
- Links to targets that can't be listed or whose names differ in case from what's on disk are refused, so a link can't reach `.git` or folders above an item on case-insensitive filesystems.
- Links in folders brought in by another link are checked against the source root before anything is written.

## [0.5.0] - 2026-10-13

**Breaking:** agntc now installs for Claude only, and a pack (formerly a plugin) must be declared with `{"type": "pack"}` or `--pack`; folder shape no longer makes one. Existing installs keep working: multi-agent installs move to `.claude/` on their next `update`, and plugin entries are read as packs.

✨ Added
- `add` walks the source to find skills: up to 5 levels deep, through plain category folders, skipping hidden folders, `node_modules`, `dist`, `build` and `vendor`.
- `owner/repo/path` sources start the search at a folder in the repo.
- Packs: a set of skills, optionally with agents and hooks, that installs, updates and removes as one entry. Declared by the author with `{"type": "pack"}` in `agntc.json`, or by the user with `--pack`.
- A source holding several things shows a menu with one line per pack and each loose skill by path; one thing installs without a menu.
- `--skill <names...>` installs skills by folder or frontmatter name, including a skill inside a pack, which installs on its own with a note naming what's left out. A name found twice is refused, listing its paths.
- `--all` installs everything the menu would list; `--list` shows what a source holds, with skill counts and descriptions, and installs nothing.
- A folder whose `agents/` or `hooks/` won't be installed gets a notice with the `--pack` command that would install them.
- `update` re-walks each pack, so skills added upstream arrive and removed ones go.
- `update` follows a loose skill whose folder moved upstream when exactly one skill has its name.
- `update` asks whether to remove a skill or pack that's gone upstream; no keeps it at its last version and asks again next time. `update -y` removes without asking.
- A pack takes over loose skills from its own repo on `add` and `update`, and `--skill` on a skill an installed pack already holds does nothing and says so.
- `-g`/`--global` on `add`, `remove`, `update` and `list` installs into `~/.claude/` with the manifest at `~/.agntc/manifest.json`. Each command stays within one scope, and printed re-add and remove commands carry `-g`.
- Without a terminal, every command prints one JSON document on stdout and never waits on a prompt; a question it can't ask stops the command and names the flag that answers it. `--json` forces JSON at a terminal.
- `add --overwrite` replaces files in the way without asking; `remove -y` removes without confirmation.
- `init skill` and `init pack` scaffold a skill or a pack directly; `-y` skips the confirmation.

🔧 Changed
- "Plugin" is now "pack". `--plugin` still works as an alias for `--pack`, with a note; config `"type": "plugin"` and manifest `plugin` entries are read as packs.
- Agents and hooks install only as part of a pack, and only `.md` files from a pack's `agents/` install as agents.
- A repo with several things in it gives a menu instead of being a collection, and picked items are no longer forced into plugins.
- Skills always install flat as `.claude/skills/<folder>`, including a pack's skills.
- Installs made for Codex or Cursor move to `.claude/` on their next `update`.
- Re-add commands in update output carry the install's path and `--pack`, and several loose skills from one repo share one `--skill` line.
- `init` scaffolds a skill (`SKILL.md` only) or a pack (`agntc.json`, `skills/`, `agents/`, `hooks/`).

🗑️ Removed
- Codex and Cursor support: their drivers, `.agents/skills` and `.cursor/skills` routing, agent detection and the agent prompt.
- The `agents` key in `agntc.json` (now ignored) and the per-agent list in manifest entries.
- Collections, and plugin detection from folder shape.

🐛 Fixed
- Skills carrying an `agents/openai.yaml` were installed as plugins with their `SKILL.md` dropped; they now install as skills.
- A stray `.claude/agents/openai.yaml` copied by such an install is removed on its next update.
- Re-add advice printed by `update` dropped `--plugin`; it now carries `--pack`.
- A skill removed upstream aborted every update; it now asks whether to remove it.
- Removing, updating or rolling back an install no longer follows a symlink in the destination: a link is unlinked as a link, and agntc won't write through one.
- A hand-edited manifest path or key using `..` can no longer delete or read outside the project or the clone.
- Approving the replacement of files in the way now removes them first, so an install replaces a folder instead of merging into it.
- Conflict checks run before an earlier install's files are removed, so a skipped item keeps its install and entry.
- An `add` whose chosen items would install to the same place is refused before anything is copied, naming the paths.
- An HTTPS URL with a path after the repo, such as `https://github.com/owner/repo/skills`, cloned the wrong repository (`repo/skills`); the first two segments now name the repo and the rest is the start path. SSH URLs take a path the same way.
- Re-add commands printed for a source on another host, or added over SSH, named a GitHub repo; they now name the clone URL.
- Hidden files in a pack's `hooks/`, such as `.DS_Store`, are no longer installed.
- A constrained update recorded an annotated tag's object sha as the commit; it now records the commit the tag points at.
- `update` no longer copies through a symlink at or above an install's path in the source; the entry is blocked and left intact.
- A local source that is a symlink to a folder now installs from the folder it links to.
- Symlinks inside an installed skill or hook were rewritten to point into the temp clone, which is deleted after the copy. A link within what's installed now stays a relative link. A link elsewhere in a local source links there absolutely; from a remote source it is left out, as is a link at the top of a pack's `hooks/`.
- An `https://user@host/...` URL no longer reads the login as a version.
- Adding the same `owner/repo` from another host no longer silently replaces an install; it is refused with the remove-then-add remedy. HTTPS and SSH of one repo still count as one source.
- Printed commands quote versions holding `^` or `~`, so they paste into zsh with extended globbing.
- `remove` carries on past a key whose files can't be removed, keeps that key recorded, and exits 1; before, it stopped part way with earlier keys deleted but still recorded.
- An approved overwrite replaces a real folder where an agent or hook file installs, instead of failing the whole add.

## [0.4.0] - 2026-07-22

✨ Added
- All-mode `update` (no key) now clones and checks each repo once per group instead of once per member — a 10-member collection now clones once, not ten times.
- Progress for `update` now streams live: a header per group with a per-member outcome line beneath, instead of one batched report at the end.
- Update summaries name an actionable re-add command for out-of-constraint versions, matched to how the plugin was pinned (`npx agntc add owner/repo` for caret, `npx agntc add owner/repo@<version>` for an exact pin).

🔧 Changed
- Version moves in update output now render as semver tags (`v1.2.3 -> v1.3.0`) when both the old and new refs are genuine tags, falling back to short commit hashes for branch/HEAD-tracked updates.
- The trailing update summary now collapses to one line per group for up-to-date, newer-tags, check-failed, and constrained-no-match plugins, instead of one line per member.
- A group can split during update: members already current report up to date while behind siblings update, all within the same run.

🐛 Fixed
- The out-of-constraint footer now reports the version this run actually landed on as "current," instead of the stale pre-update version, so it agrees with the inline update line.

## [0.3.3] - 2026-07-03

🐛 Fixed
- Update checks for branch refs that look like version tags (e.g. `v4`) no longer misfire as a missing-tag error — the checker now asks the remote whether a ref is a branch or tag instead of guessing from its name.

## [0.3.2] - 2026-06-17

✨ Added

- Release gate runs a clean install, build, and test suite before tagging — a broken build can no longer produce an orphaned tag or GitHub release.

🔧 Changed

- CLI smoke tests now run from an isolated temp directory instead of the repo root, eliminating flaky network timeouts caused by live GitHub update-checks against the real manifest.
- `.mint.toml` trimmed to only keys that differ from mint's built-in defaults, removing the commented-out documentation scaffold.

## [0.3.1] - 2026-06-15

✨ Added

- Configure agntc releases via `.mint.toml` — sets the AI model, diff limits, excluded paths, changelog, and lifecycle hooks for the `mint` release tool.
- `list`, `remove`, and `update` commands now each print an `agntc <command>` intro banner at the start of their interactive flow.

🔧 Changed

- The `release` script is now a thin shim that delegates to `mint release`, replacing the previous self-contained bash implementation.

🗑️ Removed

- Deleted the Cursor driver research notes (`CURSOR-DRIVER-RESEARCH.md`) from the repository.

## [0.2.1] - 2026-03-31

✨ Added

- File conflict prompts now display the affected file list in a separate info panel before asking how to proceed — lists longer than 10 files are truncated with a count of remaining entries.

## [0.2.0] - 2026-03-27

✨ Added

- Cursor is now a supported agent — skills install to `.cursor/skills/` with the same `SKILL.md` format used by Claude and Codex.
- Agent multiselect auto-skips when a plugin declares exactly one agent and it is detected in the project.

🔧 Changed

- Collection installs now filter each plugin's agents to its declared set before copying, so a plugin declared for `claude`-only receives only the Claude driver even when multiple agents are selected globally.
- Collection plugins with no applicable agents after filtering are silently skipped rather than copied with a compatibility warning.
- Agent multiselect options are now scoped to the plugin's declared agents only; undeclared agents are excluded entirely instead of shown with a "not declared" hint.
- Undetected agents show a `(not detected in project)` label in the multiselect instead of a separate hint field.
- Per-plugin manifest entries now record only the agents actually installed for that plugin rather than the full selected set.
- `npx agntc` examples in the README updated to `npx agntc@latest` to avoid running a locally cached stale version.

## [0.1.0] - 2026-03-25

✨ Added

- Semver version constraints — `owner/repo` bare adds now auto-resolve the latest semver tag and store a `^major.minor.patch` constraint; `@^1.0` / `@~2.1` syntax installs the best matching tag within the range.
- `update` respects stored constraints — constrained plugins update to the best match within their range rather than pulling the absolute latest.
- Out-of-constraint info section — after update, any version newer than your constraint ceiling is listed so you know it exists without being forced onto it.
- `list` detail view shows constraint metadata and surfaces out-of-constraint versions with a "Change version" action that pins to an exact tag and clears the constraint.
- `semver` dependency added to resolve and compare version ranges.

🔧 Changed

- `list` plugin labels now render as `key  ^constraint → ref` when a constraint is stored, replacing the previous `key@ref` format.
- "Change version" action for constrained plugins fetches all remote tags (not just newer-than-current tags) so you can pick any version across the full history.
- Changing version always strips the constraint and pins to an exact tag.
- `update` never downgrades a constrained plugin — if the resolved best-match tag is older than the currently installed ref, the plugin is reported as up to date.
- Tag parsing extracted to shared `fetchRemoteTagRefs` / `fetchRemoteTags` helpers in `git-utils.ts`, removing duplicated ls-remote parsing across update-check and add flows.
- Test factory helpers (`makeEntry`, `makeFakeDriver`, `makeManifest`) consolidated into `tests/helpers/factories.ts`, eliminating repeated definitions across test files.

## [0.0.5] - 2026-02-24

🔧 Changed

- CI publish pipeline now runs on Node.js 24.

## [0.0.4] - 2026-02-24

Maintenance release — no notable source changes
## [0.0.3] - 2026-02-24

🔧 Changed

- CI publish workflow now checks out the `main` branch explicitly and elevates permissions to workflow scope — ensures release jobs have write access to repository contents.

## [0.0.2] - 2026-02-24

🔧 Changed

- The npm publish workflow no longer requires a named `npm` environment gate — publishing runs directly on tag push.

## [0.0.1] - 2026-02-24

Initial release.
