# Review Tracking: vercel-skills-compatibility - Gap Analysis

## Findings

### 1. `"type": "plugin"` on a source whose skills sit outside `skills/`

**Source**: Specification analysis
**Category**: Contradiction
**Move**: settled
**Priority**: Important
**Affects**: §5.1 Reading a source's shape (rule 4); §6 Units Under Vercel Selection (the unit definition); §6.2 `--plugin` bundles the whole source

**Problem**:
Take a Vercel-style repo whose skills sit in top-level folders rather than under `skills/`. Its author adds an `agntc.json` declaring `"type": "plugin"` to keep the skills together. The document supports two incompatible readings:
- **A unit, installed whole.** Every source declaring `"type": "plugin"` is a unit: "all" installs it whole and picks from it are refused. A source holding plugin members already bundles under the declaration.
- **A menu.** The shape rules attach the declaration to a `skills/`-only root and to two `SKILL.md`-rooted shapes. For "anything else" they say only that discovery's members form the menu.

Under the second reading the author's declaration has no effect and nothing says so. `-y` installs every skill as its own entry, and a pick takes one skill out of a set the author said only works together.

**Proposal**:
The declaration bundles such a source the way `--plugin` does. The source is a unit, with everything that follows from that: "all" installs it whole and a pick from it is refused.

What determined it:
- the unit definition counts every source that declares `"type": "plugin"`;
- the bundle rules already let the declaration bundle a source holding plugin members, which is the same "anything else" shape;
- `--plugin` bundles a source with skills at its top level, and the declaration is the author's form of that request ("on a skills-only repo it keeps its existing meaning, bundle by default").

The menu reading is dead: it leaves a declaration the unit rules honour everywhere else with no effect on this one shape.

**Current**:
4. **Anything else.** Discovery runs (§5.2), and its members form the menu.

**Proposed Text**:
4. **Anything else.** Discovery runs (§5.2), and its members form the menu. `--plugin`, or `"type": "plugin"` in `agntc.json`, bundles them instead (§6.2, §6.6).

**Resolution**: Approved
**Notes**: 

---

### 2. A skill installed on its own: no ceiling, and no rule for a clash in a `-y` run

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Move**: settled
**Priority**: Important
**Affects**: §6 Units Under Vercel Selection (the unit definition); §8.2 The author's ceiling applies per unit; §8.3 Agents under `-y`; §10.3 Replacing what is in the way needs `--overwrite`

**Problem**:
A unit is defined as a plugin, a plugin member, a source declaring `"type": "plugin"`, or a `--plugin` bundle. A skill installed on its own is none of these. Yet the author's agent ceiling and the handling of a clash under `-y` are both stated per unit. A builder who reads "unit" the way the definition reads it builds two things:
- **No ceiling on a skill.** A skill whose own `agntc.json` restricts it to Claude installs for Cursor under `-a cursor`, or under `-y` in a project where Cursor is detected. Today that restriction holds.
- **No per-skill stop.** In a `-y` run over a skills-only repo every skill is its own entry, and nothing says a clash on one of them stops only that skill. The builder could refuse the whole run, so the other skills never install.

**Proposal**:
For agent targeting and for what is in the way, every entry a run installs is handled on its own, a skill installed on its own included:
- it keeps the ceiling its own `agntc.json` sets today;
- a clash, or a ceiling that excludes every named agent, stops that skill alone, and the run's other entries proceed.

What determined it:
- the ceiling rule's own account of today describes the multi-unit path skipping a member, and today's members include single skills;
- the clash rule's "other units in the same run proceed" governs `-y` runs, and on a skills-only source those are runs of separate skills;
- the ceiling is a capability the spec keeps, and today it restricts a single skill.

**Proposed Text**:
New paragraph in §6, after "A unit is one manifest entry. It is installed, updated, removed and version-pinned together. …":

"Agent targeting (§8) and what is in the way (§10.3) are handled per installed entry, and there a skill installed on its own counts as a unit as well. Its ceiling is the `agents` list in its own `agntc.json`, as a single skill's is today. A clash, or a ceiling that excludes every named agent, stops that skill alone, and the run's other entries proceed."

**Resolution**: Approved
**Notes**: 

---

### 3. Removing or updating an install whose folder Vercel has since replaced with a link

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Move**: settled
**Priority**: Important
**Affects**: §13 Coexistence with Vercel-Installed Skills (the symlink rule); §12.6 An occupied target folder; §12.3 `remove` flags

**Problem**:
Vercel's CLI replaces a folder in its way without asking, and for Claude it installs a link to its shared copy in `.agents/skills/<name>`. So when Vercel's CLI installs a skill that agntc installed earlier, agntc's `.claude/skills/<name>` becomes that link. agntc's record still lists the files it wrote there.

A later `agntc remove` or `agntc update` deletes those recorded files. Through the link, they are Vercel's shared copy: the copy Codex and Vercel's other agents read. The spec protects that copy from being written through a link, but says nothing about deleting through one. The user notices when the skill vanishes or breaks for every other agent after an agntc remove or update.

**Proposal**:
agntc never deletes through a link. A folder an entry recorded that is now a link is no longer agntc's copy:
- `remove` drops the entry, leaves the link and the folder it points to as they are, and says so;
- `update` treats the link as something in its way: it stops the entry, or under `--overwrite` replaces the link as a link.

What leaned:
- the rule that a link is replaced as a link and the folder it points to is left untouched;
- skills installed by Vercel are files agntc does not manage, touched only through the clash path's consent;
- the Cursor rule's reason for leaving a Vercel copy alone: Codex and Vercel's other agents read it.

Alternative that also fits: `remove` deletes the link itself, and `update` replaces it without asking, treating agntc's record as still owning the folder. That silently undoes the later Vercel install for that agent.

**Proposed Text**:
New bullet in §13, after the bullet "A target that is a symlink is replaced as a link, never written through. …":

"- **Nothing agntc removes is deleted through a link.** A folder an entry recorded may since have been replaced with a link, for example by Vercel's CLI installing the same skill. Such a folder is no longer agntc's copy. `remove` drops the entry, leaves the link and the folder it points to as they are, and says so. `update` treats the link as in its way (§12.6): it stops the entry, or replaces the link as a link under `--overwrite`."

**Resolution**: Routed
**Notes**: Landed in the discussion as a dated revision of "Vercel Install Coexistence" (2026-10-11); §13 re-aligned.

---

### 4. A bare add of an agents-only or hooks-only plugin always falls back to the default branch

**Source**: Specification analysis
**Category**: Enhancement to existing topic
**Move**: settled
**Priority**: Important
**Affects**: §2.5 Version a bare add installs (the fallback's second case)

**Problem**:
A plugin can hold only agents and hooks, with no `SKILL.md` anywhere, and agntc installs it as a plugin. None of its tags hold a skill. Read as written, the fallback's "newest tag holds no skills" case catches every bare add of such a plugin:
- it installs from the default branch and records no constraint;
- every later update follows the branch rather than releases.

A user who adds a tagged plugin bare expects the newest release under a caret constraint. They get unreleased commits instead, and notice it from the fallback notice or when an update pulls in unreleased work.

**Proposal**:
The second case applies when the newest tag holds nothing installable. A tag that holds a plugin's agents or hooks has something to install, so the bare add keeps the newest tag and its caret constraint.

What determined it: the fallback exists for a repo whose tags predate its skills, a tag with nothing to install. The literal reading is dead because it strips semver tracking from every agents-only or hooks-only plugin. The bare-add default exists to protect exactly that tracking.

**Current**:
- The newest tag holds no skills at all.

**Proposed Text**:
- The newest tag holds nothing installable: no skill, and no agent or hook a plugin would install.

**Resolution**: Routed
**Notes**: Landed in the discussion as a dated revision of "Bare Add Version" (2026-10-11) to keep the fallback wording aligned; §2.5 re-aligned.

---

## Observations

- A `name:` that is an empty or whitespace-only string could fall back to the folder name or install as `unnamed-skill`; unstated.
- A lone root `SKILL.md` whose `agntc.json` declares `"type": "plugin"` could read as a single skill or a one-skill unit, or be refused as `--plugin` on that shape is.
- Whether a skills-only source's root `agntc.json` `agents` list restricts skills installed from it one by one is unstated; it restricts them when bundled.
- A skill picked from a unit before its author added `"type": "plugin"` keeps updating, but its printed upgrade line is now a refused pick.
- An entry installed for both Codex and Cursor sits in `.agents/skills/` and `.cursor/skills/`, so Cursor sees agntc's own copy twice; the Cursor warning covers only copies agntc does not manage.
- The pre-install summary names nothing `--overwrite` will replace, so an attended `--overwrite` confirms without seeing which install or files go.
- Vercel's `list`/`ls` command appears in neither the in-scope nor the out-of-scope list.
- The declared-name-change case of the occupied-folder rule implies update follows an entry's recorded path. A skill the author moves into a category folder then aborts every update with the remove-and-add remedy.
- `--json` doesn't say its entries are the skills the line selected; listing internal skills left out of "all" as `skipped` would exit non-zero on a clean install.
- An internal skill the source points straight at (a root `SKILL.md` or a path), with no name given, could install or be refused as nothing to install.
- "As it does today" for a plain plugin add could be read as keeping folder-basename folders for a plugin's own skills, against the declared-name folder rule.
- A skill keyed `owner/repo/<folder>` and a plugin member at a one-segment path keyed `owner/repo/<path>` can share a key.
