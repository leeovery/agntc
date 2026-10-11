# Review Tracking: vercel-skills-compatibility - Gap Analysis

## Findings

### 1. A skill pack named by its path: installed whole, or a menu of its skills

**Source**: Specification analysis
**Category**: Contradiction
**Move**: settled
**Priority**: Important
**Affects**: §5.1 Reading a source's shape (rule 3); §5.3 Members (the skill pack); §7.1 What a name matches (a plugin member is selected by its path); §4.3 One key per skill (the member key); §11.2 `-l` / `--list`

**Problem**:
A skill pack is a folder inside a repository that holds only a `skills/` folder. It counts as a plugin member, and the menu installs it whole as one entry. The spec also says a plugin member is chosen by its path in the source, and that its key is the same whether it was picked from the menu or chosen by that path.

But shape is read at the root of whatever the path names, and a folder holding only `skills/` reads there as a menu of its skills. So the document supports two incompatible readings of `npx agntc add owner/repo/packs/foo`:
- **The member, whole.** The path selects the plugin member, as the selection rule and the key rule say.
- **A menu of its skills.** The folder holds `skills/` alone, so it reads as a skills-only source.

Under the second reading:
- An agent caller reads `--list`, sees the pack listed with its path, and passes that path. It gets every skill in the pack installed as its own entry, with the pack's internal skills left out. Those skills no longer update, pin or come out together.
- At a terminal, the user gets a menu of skills where they expected the pack.
- A re-add by path of a pack installed from the menu doesn't reach the installed entry. Its skills clash with the pack's own files, and answering "Remove and continue" converts the pack into separate entries.

Packs that hold `agents/` or `hooks/` are unaffected, because at a path those read as a plugin either way.

**Proposal**:
A path into the repository that names a non-hidden folder holding only `skills/` names that plugin member. It installs the member whole under its member key, as picking it from the menu does, and `--plugin` on it is redundant, as on any plugin. The `skills/`-only menu still holds at the root of a repository or a local path, and at a hidden folder, which is never a plugin member.

What determined it:
- the selection rule: a plugin member is selected by its path in the source, the form agntc prints for it;
- the key rule: a member's key is the same whether it was picked from the menu or selected by its path;
- the member rule already treats a folder holding only `skills/` as a pack installed whole, and marks that as a divergence from Vercel made to keep units. A path naming that folder names the same pack. Splitting the pack because it was reached by path drops the unit, and unit-keeping is the one ground the governing rule gives for diverging.

The pack's skills stay reachable one by one. A path at the pack's own `skills/` folder lands inside a unit and is handled as a pick, with the warning.

Alternative: read the path at its own root, so a pack named by path is a menu and installs whole only with `--plugin`. That matches Vercel's reading of the same line. But the same folder then installs as one entry or several depending on how it was reached, and the selection and key rules no longer hold for packs.

**Current**:
3. **`skills/` only.** By default this is a menu of the skills discovery finds (§5.2). `--plugin`, or `"type": "plugin"` in `agntc.json`, bundles it instead (§6).

**Proposed Text**:
3. **`skills/` only.** By default this is a menu of the skills discovery finds (§5.2). `--plugin`, or `"type": "plugin"` in `agntc.json`, bundles it instead (§6). A path into the repository that names a non-hidden folder of this shape names a skill pack, a plugin member (§5.3), and not a menu. It installs that member whole under its member key (§4.3), as picking it from the menu does, and `--plugin` on it is redundant (§6.6). **This diverges from Vercel, to keep units (§1.4)**, as the member rule does.

**Resolution**: Pending
**Notes**:

---

## Observations

- One skill installed today under two entries with different old keys (a tree URL for Claude, the menu for Cursor) maps to one new key. On update or re-add, nothing says whether the two merge or one stops.
- At a version whose author ceiling no longer includes a recorded agent, the re-add rule (never drop a recorded agent) and the ceiling rule (install only within the ceiling) pull opposite ways.
- `remove <name>`, where the name matches a standalone entry and a skill inside a unit from the same repository, falls outside the two-repositories refusal. The outcome is unstated.
- On `add`, a name that matches both a loose skill and a skill inside a plugin member has no stated winner, because the same-name dedup runs only over the walk, which never enters members.
- `--list` on a bare source lists the newest tag. A skill only on the default branch, which a pick reaches through the fallback, never appears to an agent caller choosing from it.
- `update --overwrite` is said to apply to "the single-key update and to all-mode"; an update naming several entries is not mentioned.
- A re-add that names agents but no version is a bare add and re-resolves the newest tag. Adding an agent to an exact-pinned or branch-tracking entry also changes its version.
- In the "Proceed with installation?" item, "So does a plugin whose one declared agent is detected" reads as "installs without a member prompt", but the point is that no agent prompt shows.
- Without `--plugin`, a path at a folder of a unit's skills is "handled as a pick by name is". At a terminal, that could mean a menu or every skill in the folder, and internal skills could be included (as named) or left out (as "all").
