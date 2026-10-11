# Review Tracking: vercel-skills-compatibility - Gap Analysis

## Findings

### 1. A ref named in the URL reads as a bare add

**Source**: Specification analysis
**Category**: Contradiction
**Move**: settled
**Priority**: Important
**Affects**: §2.5 Version a bare add installs; §2.1 Source forms (GitHub tree URLs, GitLab `/-/tree/` URLs, Azure Repos `?version=`)

**Problem**:
A bare add installs the newest semver tag and records a caret constraint. The spec defines a bare add as one with no `#` fragment. But three accepted source forms carry their ref inside the URL rather than in a `#` fragment:
- a GitHub tree URL (`/tree/<ref>/…`);
- a GitLab `/-/tree/<ref>/…` URL;
- an Azure Repos `?version=`.

The document supports two readings of these forms:
- **The URL's ref is installed.** The form names a ref, and every form is parsed the way Vercel parses it.
- **They are bare.** By the definition they have no `#` fragment, so the ref is dropped.

Under the second reading:
- A user who pastes a tree link to `main` gets the newest release instead, and later updates follow tags, not the branch.
- A link to a skill at `v1.2.0` installs `v2.x` under a caret constraint.

Nothing reports that the ref was ignored, so an agent caller never finds out.

**Proposal**:
A ref carried in the URL is read the way the same `#` fragment would be: a tag installs exactly with no constraint, and a branch tracks that branch. Only a source that names no ref anywhere is bare.

What determined it: the URL's ref is part of the line the user wrote. The governing rule that no part of a line is silently dropped leaves the other reading dead, because installing a different version from the one the link names drops the ref without a word.

**Current**:
A bare add, meaning one with no `#` fragment, keeps agntc's default:

**Proposed Text**:
A ref carried in the URL itself (a GitHub tree URL's `<ref>`, a GitLab `/-/tree/<ref>/`, an Azure Repos `?version=`) is read the way the same `#` fragment would be (§2.4). A bare add, meaning one that names no ref or version in either place, keeps agntc's default:

**Resolution**: Approved
**Notes**: 

---

### 2. `--plugin` with a path at one skill inside a unit: installed alone, or refused

**Source**: Specification analysis
**Category**: Contradiction
**Move**: settled
**Priority**: Important
**Affects**: §6.5 Picking one skill from a unit (the path paragraph); §6.6 What `--plugin` refuses (the single-skill bullet and the named-skill bullet); §5.1 Reading a source's shape (shape is read at the path the source names)

**Problem**:
Take `npx agntc add owner/repo/skills/x --plugin`, or a tree URL to that folder, where the repo is a plugin that does not declare `"type": "plugin"`. The document supports incompatible readings:
- **Installed alone, with a warning.** A path that lands at one of a unit's skills is handled as a pick by name, "with or without `--plugin`".
- **Refused.** Shape is read at the path the source names. That folder holds a `SKILL.md`, so the source is a single skill, and `--plugin` on a single skill is refused. A pick by name beside `--plugin` is refused as well.

Which reading a builder lands on depends on the order of the checks. The user gets either a failed run, or the skill alone with `--plugin` having had no effect.

**Proposal**:
Refused. `--plugin` asks for a bundle, and a path at one skill holds nothing to bundle. That is the same reason `--plugin` is refused on any single skill.

Installing the skill alone would drop the flag without saying so, which the never-silently-ignore rule forbids. The warning names the unit's parts that were left out, not that the flag did nothing.

This leaves a path at a folder of a unit's skills as it is.

Alternative that also fits: install the skill alone with the warning, as "with or without `--plugin`" reads literally. That leaves the flag with no effect and nothing saying so.

**Current**:
Such a path is handled as a pick by name is, with or without `--plugin`.

**Proposed Text**:
Such a path is handled as a pick by name is, with or without `--plugin`, except that a path at one skill together with `--plugin` is refused, as `--plugin` on any single skill is (§6.6).

**Resolution**: Approved
**Notes**: Determined by the record: a path is handled as a pick (Selection From a Unit, 2026-10-09), and a pick beside --plugin is refused.

---

### 3. Following a printed `add` as an agent caller adds every detected agent

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Move**: settled
**Priority**: Important
**Affects**: §14.1 The rule (printed `add` commands); §8.4 A re-add adds agents and never drops them; §10.5 Agent callers behave as `-y`

**Problem**:
Printed `add` commands name no agents. A re-add under `-y` adds every detected agent within the author's ceiling, and an AI agent caller always runs as if `-y` were given. So when an agent caller follows an upgrade line such as `npx agntc add owner/repo#v3.0.0@x`, the install gains every agent agntc detects in the project, including Codex or Cursor that the owner never chose. Every later update then installs for those agents too.

The derive-before-delete remedy goes further. It removes the entry first, so its `add` is a fresh install. That install takes the detected agents when run unattended, and the agent prompt at a terminal, rather than the agents the entry had.

In both cases, following the printed command does not reproduce the install it advises on, and printed commands exist to guarantee that. The result is also the quiet widening that `update` avoids by replaying the agents recorded at install.

**Proposal**:
Printed `add` commands name the entry's recorded agents with `-a`. A re-add then adds no agent, because every named agent is already recorded. The remove-then-add remedy reinstalls for exactly the agents the entry had, whoever runs it.

What leaned:
- the printed-command rule that following a command reproduces the install;
- the re-add rule that `-y` adds the detected agents;
- agent callers running as `-y`.

Alternative that also fits: a re-add that names only a version adds no agent, even under `-y`. That fixes the upgrade lines but not the remedy, whose `add` comes after a remove and is a fresh install.

**Proposed Text**:
New bullet in §14.1 under "Printed `add` commands", after "carry `--plugin` whenever the entry is a plugin;":

"  - name the entry's recorded agents with `-a`, so following the command installs for exactly those agents and adds none, at a terminal or from an agent caller (§8.4, §10.5). One command covers only entries recorded for the same agents;"

**Resolution**: Routed
**Notes**: Landed in the discussion as a dated revision of "Re-Add Advice Defects" (2026-10-11); §14.1 re-aligned.

---

### 4. A bulk update's per-group upgrade line names the whole repository

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Move**: settled
**Priority**: Important
**Affects**: §14.1 The rule (printed `add` commands); §14.2 Where agntc prints commands today (the all-mode newer-tags line and the out-of-constraint line)

**Problem**:
A bulk `update` prints its "newer tags available" line and its "newer versions outside constraints" line once per group, with one `add` command each. A group is every entry installed from one repository on the same version intent. Under the new grammar a group is commonly several skills installed one by one from a skills-only repo, or several plugin members.

The printed-command rules say how to name one skill or one plugin member, and say nothing about a line that speaks for several. Today that line names the bare repository. §14.2 does not list it among the sites that break the rule.

Followed as printed, the bare repository line:
- reopens the full menu at a terminal, and the owner has to remember which skills they had;
- run by an agent caller (as `-y`), installs every skill in the repo as its own entry and every plugin member whole, not the three skills the owner picked;
- with `--plugin` carried because the members are plugins, bundles the whole repo as one unit. That bundle clashes with the member entries, and "Remove and continue" converts them into it: the change of install shape that printed commands must never cause.

**Proposal**:
A printed `add` that speaks for several entries names every one of them and nothing else:
- the group's skills go in one command, named with `--skill` (`owner/repo#v2.0.0 --skill a b c`);
- each plugin member gets its own command by its path, with `--plugin`, because a member is selected by its path.

What determined it: following a printed command must reproduce the install it advises on, which rules out the bare repository line.

What leaned toward one command for the skills: a line per group is the output's existing granularity, and `--skill` takes several names where `@skill` takes one.

Alternative that also fits: one command per entry. It reproduces the install too, but turns each collapsed group line into a line per member.

**Proposed Text**:
New bullet in §14.1 under "Printed `add` commands", after "name a plugin member by its path in the repo (`owner/repo/<path>`);":

"  - where one printed line speaks for several entries, as a bulk update's per-group lines do, name every entry it covers and no other. The group's skills share one command, named with `--skill` (`owner/repo#v2.0.0 --skill a b c`). Each plugin member takes a command of its own, by its path;"

**Resolution**: Routed
**Notes**: Landed in the discussion as a dated revision of "Re-Add Advice Defects" (2026-10-11); §14.1 re-aligned.

---

## Observations

- A folder holding `SKILL.md` beside `agents/`/`hooks/`, or beside `skills/` alone, whose own `agntc.json` declares `"type": "plugin"` reads as a plugin when a path points at it. Discovery from the repo root reads it as a skill, because the member rules name only the `skills/`-beside-`agents/`/`hooks/` exception.
- Two different declared names that sanitize to one folder (`My Tool` and `my-tool`, or two that reduce to `unnamed-skill`) both get past the same-name dedup, and in a single install they land in one folder under one key.
- A `--plugin` bundle whose members' ceilings don't overlap has an empty ceiling. Under `-y`, "every agent within its ceiling" then installs for none rather than refusing.
- `remove -a cursor x`, where `x` is not installed for Cursor, removes nothing. The spec doesn't say whether that counts as a name that matches nothing.
- Printed `remove`/`update` commands may name an entry by skill name. If an install from another repository shares that name, the printed line is refused; a key is never refused that way.
- A plugin whose own `skills/` is nested in category folders installs "as it does today", which lands the category folders where skills belong. Only the `--plugin` bundle is said to take skills wherever they sit.
- A tree URL that also carries a `#` fragment names two refs, and which one wins is unstated.
- Under `--json`, a unit stopped by a clash could report its skills as either `skipped` or `failed`. Both exit non-zero.
