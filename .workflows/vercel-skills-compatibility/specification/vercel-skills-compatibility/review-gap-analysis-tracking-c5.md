# Review Tracking: vercel-skills-compatibility - Gap Analysis

## Findings

### 1. An install that is already current never gets its move or its repair

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Move**: settled
**Priority**: Important
**Affects**: §4.4 Existing installs move on their next update; §5.5 Repairing installs made under the old rule

**Problem**:
Two things happen to existing installs "on their next update":
- they move to their declared-name folder and key;
- broken ones are repaired. These are skills whose `agents/` folder was installed as subagents while the skill itself was lost.

`update` today reinstalls an entry only when it has a newer version to move to. An entry already at its target is reported up to date and left as it is. That covers an install at the newest tag, a branch at its head, an exact tag pin, and an entry whose newer versions all sit outside its constraint.

The spec doesn't say whether the move and the repair wait for a newer version. A builder who puts them in today's reinstall path ships a repair that doesn't fire for most users:
- A user upgrades agntc and runs `npx agntc update` to fix a broken install. They are told it is up to date. The skill is still missing, and its helper prompts still load as subagents.
- An exact-pinned install is never repaired or moved, because update never moves an exact pin.
- An unmoved install stays in its old folder. If Vercel's CLI later installs the same skill under its declared name, the agent sees two copies side by side, which is what the declared-name folder exists to prevent.

**Proposal**:
An entry due the move or the repair gets it on its next update, whether or not a newer version is available. An entry already at its target is reinstalled at the version it has, and its pin, constraint or branch stays the same.

What leaned:
- The repair's stated reason: without it the broken shape is kept, and a fresh add of the same source installs differently.
- Update never moves an exact pin, so waiting for a newer version leaves those installs broken for good.
- A re-add already moves an old install at whatever version the re-add names, so the move is not tied to a version change.

Alternative: move and repair only when the update installs a newer version. Current installs then stay broken, or in the old folder, until a release lands, and exact pins stay that way forever. A re-add becomes the only fix.

**Proposed Text**:
New paragraph at the end of §4.4:

"The next update makes these moves, and the repair of §5.5, whether or not a newer version is available. An entry already at its target is reinstalled at the version it has: one that is up to date, pinned to an exact tag, or whose newer versions are all outside its constraint. Its pin, constraint or branch stays as it was."

**Resolution**: Routed
**Notes**: This session's call. Landed in the discussion as dated revisions to Skill Identity (the move) and Skill-Local Agents Folders (the repair), then applied to §4.4 as staged. Landed under auto.

---

### 2. An install that hasn't moved yet can't be named by its skill's declared name

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Move**: settled
**Priority**: Important
**Affects**: §4.4 Existing installs move on their next update; §7.1 What a name matches (on `remove` and `update`); §14.1 The rule (printed `add` commands)

**Problem**:
The spec's example of what fails today is `npx agntc remove vercel-composition-patterns`. It targets an install agntc made from the collection menu, in the folder `composition-patterns` under the key `owner/repo/composition-patterns`. That install keeps its old folder and key until its next update moves it.

`remove` and `update` match a name against an installed skill's declared name or its install folder name. agntc has never read declared names, so nothing it holds for an existing install records one. A builder who records the declared name at install time leaves every existing install matchable only by folder name or key. Until the user happens to run `update`, the Vercel-style line is then refused on every older install as matching nothing, with exit 1. An agent caller following Vercel's documentation hits that refusal.

The same gap reaches printed commands. A printed `add` names a skill the way a user selects it, and on `add` a name matches only the declared name. If the old folder name is printed instead, agntc prints a command it then refuses.

**Proposal**:
An existing install is known by its skill's declared name before it moves, just as after:
- `remove` and `update` match it by that name, as well as by its folder name and key;
- a printed `add` names it by that name.

What determined it — the source discussion's own decisions:
- Update and Remove Surface: `remove` and `update` accept "the skill's declared name or its folder name — as well as agntc keys", with no carve-out for installs made before identity moved. An install that hasn't moved still holds its skill, and that skill's declared name.
- Re-Add Advice Defects: a printed `add` names a single skill the way a user selects it, by `@skill`. On `add`, that is the declared name.
- The motivating line for the name rule is this install: `vercel-composition-patterns` declared in the folder `composition-patterns`.

**Proposed Text**:
New paragraph in §4.4, after the paragraph ending "A re-add never installs a second copy beside it.":

"Before it moves, an existing install is still known by its skill's declared name. `remove` and `update` match it by that name as well as by its folder name and key (§7.1), and a printed `add` names it by that name (§14.1). So `remove vercel-composition-patterns` reaches an install still in `composition-patterns`."

**Resolution**: Approved
**Notes**: Disposed as the record's own answer (Update and Remove Surface's name rule; Re-Add Advice Defects' `@skill` printing). Landed under auto.

---

## Observations

- On a source where discovery finds nothing, `--list` could follow the nothing-installable refusal (non-zero) or "installs nothing and exits 0"; the refusal reading is the natural one.
- `--full-depth` on a source that reads as a plugin has no stated effect; the plugin installs whole either way.
- `update -y` is "Accepted" with no stated effect, while `-p` is explicitly "with no effect"; the spec names no prompt `update` meets for `-y` to answer.
