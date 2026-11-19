# Review Tracking: Vercel Skills Compatibility - Input Review

## Findings

### 1. A detected agent caller is never told the run is non-interactive

**Source**: Discussion, "Agent Caller Detection" → Context (Vercel "replaces its banner with 'Agent detected — installing non-interactively', and forces `yes`") and Decision ("detected as Vercel detects it"); the owner's rule that Vercel's way is the default (Skill Identity → Journey; Summary → Key Insights 2)
**Category**: Enhancement to existing topic
**Move**: settled
**Affects**: 10.5 Agent callers behave as `-y`

**Problem**:
When agntc decides it is running inside an AI agent, `add` picks every skill and skips the agent prompt and "Proceed with installation?". Then it installs, with nothing on screen saying why. Detection rests on environment variables, so a person can be read as an agent. For example, someone typing the command through a coding agent's shell passthrough, or in a shell that inherited the agent's environment. That person gets an install with no chance to choose and no explanation. They notice only when skills they never picked turn up in the project. Vercel's CLI announces the mode, and the source records the announcement. The specification adopts Vercel's detection but leaves out the announcement.

**Proposal**:
Add Vercel's announcement. The source records that Vercel, when it detects an agent caller, replaces its banner with "Agent detected — installing non-interactively". Detection itself is adopted "as Vercel detects it". The owner's rule makes Vercel's way the default wherever nothing agntc keeps is at stake, and the banner is not a kept capability. That rule decided it. Printing the line beneath agntc's banner instead of in its place would also work: either way the person sees why no prompt appeared.

**Current**:
When agntc runs inside an AI agent, `add` and `remove` behave as if `-y` were given. The agent caller is detected as Vercel detects it: with `@vercel/detect-agent`, plus Vercel's refinement for Cursor. Cursor counts as an agent caller only when `CURSOR_AGENT` is set or `CURSOR_EXTENSION_HOST_ROLE` is `agent-exec`. The reason is that `CURSOR_TRACE_ID` is also present in Cursor's integrated terminal for ordinary users (Vercel's `src/detect-agent.ts`).

**Proposed Text**:
(§10.5, a new paragraph after the Current paragraph, before the bullets)

When it detects an agent caller, `add` says so in place of its banner, as Vercel does: "Agent detected — installing non-interactively".

**Resolution**: Approved
**Notes**: 

---

### 2. A path into a unit splits it with no warning, even when the author declared it whole

**Source**: Discussion, "Selection From a Unit" → Decision 2026-10-06 (a pick aimed at a unit installs that skill alone with a warning, and is refused when `agntc.json` declares `"type": "plugin"`; "The owner's workflows repo would add `"type": "plugin"` to keep its skills together"); "Skill Identity" → Decision (a skill is selected by "menu, `@name`, `--skill`, subpath, tree URL")
**Category**: Gap/Ambiguity
**Move**: settled
**Affects**: 6.5 Picking one skill from a unit; 5.1 Reading a source's shape

**Problem**:
The warning and the `"type": "plugin"` refusal apply only to picks by name. Shape is read at whatever path a source names. So `owner/repo/skills/x`, or a GitHub tree URL to that folder (the link a person copies while browsing the repo), reads as a single skill and installs it alone. Nothing warns that the unit's agents, hooks and other skills were left behind. The install goes through even when the author declared `"type": "plugin"` so that their skills would not be split. The installer ends up with a skill that calls agents or sibling skills that are not there, and finds out when it fails. The author's declaration does not hold against a link into their own repo. A path to a folder of a unit's skills (`owner/repo/skills`) splits the unit the same way, through the menu.

**Proposal**:
A path that lands inside a unit is handled the way a pick by name is. This is the session's call: the record decides the warning and the refusal for a pick by name and never addresses paths. What leaned:
- The warning exists so the installer knows what an install leaves out. The refusal exists so an author's "keep this whole" holds. Neither purpose depends on how the skill was named.
- The record lists subpath and tree URL among the ways a skill is selected.
- A path that installs silently produces exactly the partial install the record refuses for declared units.

The staged text exempted `--plugin`. That exemption is dropped: a `--plugin` path into a unit (`owner/repo/skills --plugin` on a plugin repo) bundles part of the unit, which is the same split.

Alternatives that also fit:
- Warn on a path but never refuse.
- Leave paths silent, as the earlier reading had them.

**Proposed Text**:
(§6.5, a new paragraph after the first paragraph)

A path in the source can also land inside a unit, either at one of its skills (`owner/repo/skills/x`, or a tree URL to that folder) or at a folder of its skills (`owner/repo/skills`). Such a path is handled as a pick by name is, with or without `--plugin`. What it installs carries the same warning, and the line is refused when the unit declares `"type": "plugin"`.

**Resolution**: Routed
**Notes**: Landed in the discussion as a dated revision of "Selection From a Unit" (2026-10-09); §6.5 re-aligned to it.

---

### 3. A skill picked out of a unit has no stated agent ceiling

**Source**: Discussion, Context → Inherited position, "agntc's reason to exist stands" (the owner's workflows repo, `agntc.json` → `{"agents": ["claude"]}`; Vercel's install of it "ignoring the Claude-only restriction"); "Agent Targeting" → Decision 2026-10-06 ("The author's ceiling applies per unit"); "Selection From a Unit" → Decision (a pick from an undeclared unit installs that skill alone)
**Category**: Gap/Ambiguity
**Move**: settled
**Affects**: 6.5 Picking one skill from a unit; 8.2 The author's ceiling applies per unit

**Problem**:
The author's agent ceiling applies per unit. A skill picked out of a unit installs alone, and its own folder holds no `agntc.json`. Nothing says which ceiling that lone skill installs under. If the ceiling is read from the skill's folder, there is none, and the skill installs for every agent. The owner's own workflows repo is a live case. Its `agntc.json` restricts it to Claude. A pasted `--skill x` line with `-y` or `--agent '*'` would land its skills in Codex's and Cursor's directories. The record holds exactly that failure against Vercel's install of the same repo ("ignoring the Claude-only restriction"). The author's restriction quietly stops applying once a user picks a skill instead of installing the whole unit.

**Proposal**:
A skill installed alone out of a unit installs within that unit's ceiling: the `agents` list in the unit's `agntc.json`. Two things decide this. The ceiling is one of the capabilities agntc keeps, and the record names the loss of the Claude-only restriction on the owner's repo as a defect of Vercel's install. The other side, no ceiling for a picked skill, reproduces that defect and is dead. The ceiling's existing handling carries over unchanged: the output names the agents left out, and the pick is refused when every named agent falls outside the ceiling.

**Proposed Text**:
(§6.5, a new paragraph after the paragraph describing the warning)

The picked skill installs within the unit's agent ceiling, the `agents` list in the unit's `agntc.json` (§8.2). The output names the agents left out, and a pick whose named agents all fall outside that ceiling is refused, as it would be for the unit itself.

**Resolution**: Approved
**Notes**: 

---

### 4. `--plugin` refused on a source that holds a plugin member

**Source**: No source decides this. Checked: discussion "Selection From a Unit" (`--plugin` bundles any skills-only source; `--plugin` with a skill pick is refused), "Units Among Discovered Skills" ("A skills-only repo root keeps its reading: a menu of the skills discovery finds, bundled by `--plugin` or `"type": "plugin"`"), "`--plugin` on a Root Skill Beside `skills/`" (the single-skill refusal and its one exception), "Re-Add Advice Defects"
**Category**: Unsourced decision
**Move**: route
**Affects**: 6.6 What `--plugin` refuses; 14.1 The rule

**Problem**:
The specification states: "**`--plugin` on a single skill (a root `SKILL.md`), or on a source whose members include a plugin member, is refused (§1.5).**" It also lists, among the cases that "change and are now refused": "`--plugin` on a `skills/`-only source that holds a plugin member."

The source never makes the plugin-member call. It says `--plugin` bundles a skills-only source. It says a skills-only root keeps its reading, bundled by `--plugin` or `"type": "plugin"`, and carves out no root that holds a plugin member. The only `--plugin` refusals it records are the skill pick and the single skill.

The decision has consequences for users:
- A `--plugin` line that bundles such a repo today exits non-zero after the change.
- For a bundle already made from such a repo, the printed re-add carries `--plugin`, because every plugin entry's printed re-add does. agntc then refuses that printed command, which breaks the rule that every command agntc prints is one it accepts.
- The same question is open for `"type": "plugin"` on that shape, which the specification still bundles.

What a bundle does with a member that is itself a unit is the owner's call to make in the discussion.

**Proposed Text**:

**Resolution**: Routed
**Notes**: Put to the owner; the owner chose bundling the whole source. Landed in the discussion as a dated revision of "Selection From a Unit" (2026-10-09); §6.2, §6.6 and §9.1 re-aligned. The configless-install --plugin/type rules for a collection with a plugin member corrected there (corrigendum 2026-10-09).

---

### 5. A whole-repo skill keeps its `owner/repo` key

**Source**: No source decides this. Checked: discussion "Skill Identity" (Context; Options; Decision: "One key per skill, however it was selected … built from the declared name"; "Existing installs move to the declared-name folder and key on their next update"), "Update and Remove Surface", "Re-Add Advice Defects"
**Category**: Unsourced decision
**Move**: route
**Affects**: 4.3 One key per skill; 4.4 Existing installs move on their next update

**Problem**:
The specification states: "A skill that is the whole repo (a root `SKILL.md`) keys as `owner/repo`, as it does today." The source decides that a skill's key is built from its declared name, and that existing installs move to a declared-name key on their next update. It never sets single-skill repos apart.

The two readings give users different results:
- Under the exemption, every single-skill repo appears in `list` under its repo path, not under the name it was selected by. `remove` and `update` also take it by that path.
- Its existing installs keep their key, while every other skill's key moves.
- A repo key acts on every entry under it, as `remove` reads one today. A root skill can be installed alongside its repo's nested skills, because `--full-depth` reaches past the root skill. In that case `remove owner/repo`, meant for the root skill, removes all of them.

Which key a whole-repo skill carries is the owner's call to make in the discussion.

**Proposed Text**:

**Resolution**: Routed
**Notes**: Derived from configless-install's corrected Keying and the one-key rule; landed in the discussion as a dated revision of "Skill Identity" (2026-10-09). §4.3 already matched; §12's key-matching sentence re-aligned to the exact-match-first rule the derivation rests on.

---

## Observations

- §9.2 reports a unit's skills as ordinary per-skill `--json` entries, and the unit's agents and hooks get no entry. This follows Vercel's per-skill contract, but no source decides how a unit appears in `--json`.
- §2.5's fallback condition names "the path in the source" next to skills selected by `@`/`--skill`. The source names only "a skill the line names". This is a faithful extension wherever the path names a skill folder.
