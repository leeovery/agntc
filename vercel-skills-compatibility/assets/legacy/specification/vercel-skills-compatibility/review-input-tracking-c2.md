# Review Tracking: Vercel Skills Compatibility - Input Review

## Findings

### 1. A plugin member still gets a different key from the menu than from its path

**Source**: Discussion, "Skill Identity": Context ("one skill already gets two keys depending on route — the menu keys a member by basename (`owner/repo/composition-patterns`), a tree URL by its full subpath (`owner/repo/skills/composition-patterns`)"), Decision 2026-10-06 ("One key per skill, however it was selected … so every route lands on the same entry") and Decision 2026-10-11 (a re-add reaches an install made under its old key and keeps every recorded agent). "Units Among Discovered Skills": Decision (a folder the walk reaches that holds `skills/`, `agents/` or `hooks/` is a plugin member, installed whole, skill packs included). "Re-Add Advice Defects": Context and Decision (a printed re-add that lands on another key collides, and the collision prompt offers to remove the existing install; every printed command must reproduce the install).
**Category**: Gap/Ambiguity
**Move**: settled
**Affects**: 4.3 One key per skill; 4.4 Existing installs move on their next update

**Problem**:
The rule that gives one key per entry, whichever way it was selected, covers skills only. A plugin member is a folder with its own `skills/`, `agents/` or `hooks/`, and a skill pack counts as one. Plugin members keep today's split. The menu keys a member by its folder name (`owner/repo/<pack>`). A path or tree URL keys it by its full path (`owner/repo/skills/<pack>`). Discovery now reaches plugin members below the repo root, inside `skills/` and category folders, and that is where the two keys differ.

The path matters for two reasons. It is the only way to select a plugin member without the menu. It is also the form agntc prints for a plugin member in its upgrade and newer-tag advice.

Say a user installs a nested skill pack from the menu and later follows agntc's own upgrade line. The upgrade installs the pack as a second entry:
- At a terminal, the user is asked to "Remove owner/repo/<pack> and continue", and that is their own install.
- Under `-y`, or when an agent caller runs it, the run stops and names `--overwrite`.
- With `--overwrite`, the old entry is removed. Any agent it was installed for that the line doesn't name is dropped.

Fixing printed commands was meant to end exactly this collision, and for skills the re-add rule prevents this agent loss. A user who picks the member by path once and from the menu another time ends up with the same split.

**Proposal**:
A plugin member installed on its own gets the key `owner/repo/<path>`, where `<path>` is its folder's path in the repository, however it was selected. An existing member recorded under its folder name moves to that key on its next update. A re-add finds it under the old key, as it does for skills.

What leaned:
- The source names the defect: the menu and a path key the same member differently. Its fix for skills keys every route on one identity. A plugin member declares no name, so its location is the stable identity left.
- The path is the form agntc prints for a plugin member and the only way to select one without the menu. The key a user sees in `list` and passes to `remove` is then the same string they pass to `add`.
- A path is unique within a repository. Once discovery walks into category folders, folder names can repeat, and plugin members have no first-found-wins rule the way same-named skills do.

Members at the repository root keep their current key, because there the path and the folder name are the same.

Alternative that also fits: key by folder name (`owner/repo/<folder>`), mirroring the skill key. Every menu-installed key stays as it is today. But two members that share a folder name in different category folders would land on one key, and that needs a tie-break rule.

**Proposed Text**:
(§4.3, a new paragraph after the first paragraph)

A plugin member (§5.3) installed on its own has exactly one key, `owner/repo/<path>`, where `<path>` is its folder's path in the repository. The key is the same whether the member was picked from the menu or selected by its path in the source (§7.1). A plugin member at the repository root keys as it does today.

(§4.4, a new paragraph at the end of the section)

A plugin member recorded under its folder name moves to its path key on its next update. A re-add reaches it under that old key the same way, and it keeps every recorded agent.

**Resolution**: Routed
**Notes**: Landed in the discussion as a dated revision of "Skill Identity" (2026-10-11); §4.3 and §4.4 re-aligned.

---

## Observations

- The source has a `-y` re-add add "any detected within the ceiling". Read through the `-y` targeting rule it cross-references, the specification's re-add sentence could also pull in that rule's fallback ("none qualifies → every agent within the ceiling"), which the source never applies to a re-add.
- The source only puts Vercel's `init` parity out of scope. The specification lists `init` among commands a line is refused for, but `npx agntc init` runs agntc's own scaffolder.
- No source says how installs from hosts other than GitHub (GitLab nested groups, Azure Repos, SSH addresses) are keyed. The `owner/repo/<folder>` key shape is GitHub-shaped.
- The source gives `update --overwrite` for an occupied target folder on single-key and all-mode updates. `list`'s inline update action has no `--overwrite` to offer when it meets one.
