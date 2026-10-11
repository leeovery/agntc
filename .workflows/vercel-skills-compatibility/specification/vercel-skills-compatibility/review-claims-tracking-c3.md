# Review Tracking: vercel-skills-compatibility - Claims Verification

## Findings

### 1. Refusing `remove --all -a` rests on a Vercel behaviour that doesn't exist

**Source**: Tree measurement — Vercel v1.7.0 (`7407f3893ad4`) `src/remove.ts:413–415`, `:210–211`
**Category**: Source defect
**Move**: route
**Affects**: §12.3 (`remove` flags, the `--all` row)

**Problem**:
agntc would refuse `remove --all -a cursor` because the record believes Vercel's `--all` sets every agent and silently drops the `-a`, so the remove would delete every agent's copies. Vercel's `remove` does not do this. Its `--all` selects every skill and skips the confirmation, and `-a` still scopes the removal. Vercel's line removes every skill from Cursor only. So a Vercel line that works meets a refusal and a non-zero exit in agntc. The refusal is also not marked as a divergence. Once the premise falls, none of the specification's grounds for diverging applies: no kept capability, no owner position, no silently ignored part of the line. The `add` half of the premise holds: Vercel's `add --all` overwrites the agent list with `'*'`, so `add --all -a` does drop the `-a`.

**Evidence**:
Specification claim (§12.3): "`--all` | Remove every install. Implies `-y`, and cannot be combined with names or with `-a`. The refusal names `-s '*' -a <agents> -y` for removing from some agents only."

Source premise: discussion `vercel-skills-compatibility.md`, Install Flag Set, 2026-10-11 revised (line 579): "*Trigger: `--all` sets the agents itself — every agent — so `add … --all -a cursor` and `remove --all -a cursor` carry two conflicting agent instructions; read as the shorthand it expands to, the `-a` is silently dropped, and the remove deletes every agent's copies where only Cursor's were meant.*"

Measurement, Vercel `src/remove.ts` at `7407f3893ad4dceab546ac002c3ef806e4000c73` (`curl -sf https://raw.githubusercontent.com/vercel-labs/skills/7407f389…/src/remove.ts | grep -n …`):
```
413:    } else if (arg === '--all') {
414:      options.all = true;
415:      options.yes = true;
210:  if (options.agent && options.agent.length > 0) {
211:    targetAgents = options.agent as AgentType[];
```
`--all` on `remove` sets only `all` and `yes`. The agent list given with `-a` becomes the removal's target agents. The only combination Vercel's remove refuses with `--all` is skill names (`:85`, "Cannot combine --all with specific skill names.").

For contrast, Vercel `src/add.ts` at the same commit:
```
1208:  if (options.all) {
1210:    options.agent = ['*'];
```
Here `--all` overwrites any `-a`, so the add half of the premise holds.

**Proposed Text**:

**Resolution**: Routed
**Notes**: Measured correction landed in the discussion as a dated revision of "Install Flag Set" (2026-10-11): add keeps the refusal, remove --all -a follows Vercel. §12.3 re-aligned.

---

### 2. A Cursor install never meets a Vercel-installed copy, so no clash is shown

**Source**: Tree measurement — `src/drivers/cursor-driver.ts:8`; Vercel v1.7.0 `src/agents.ts:269–272`; `src/commands/add.ts:218–222`
**Category**: Source defect
**Move**: route
**Affects**: §4.2 (the closing paragraph on installs by both tools); §13 (coexistence with Vercel-installed skills)

**Problem**:
The specification promises that a skill installed by both agntc and Vercel's CLI lands in one folder. The overlap then shows up as a visible clash, not as two copies the agent sees. That holds for Claude and Codex. It does not hold for Cursor. Vercel puts Cursor's copy in `.agents/skills/<name>`, agntc puts it in `.cursor/skills/<name>`, and `add`'s clash checks look only at the paths agntc is about to write. Take a user who installed a skill with Vercel's CLI and then runs `agntc add … -a cursor`. They get no prompt and a second copy. Cursor discovers skills in both `.agents/skills/` and `.cursor/skills/`, so it is offered the skill twice. Nothing in the build would catch this, because the specification says the clash path already handles it.

**Evidence**:
Specification claim (§4.2): "When a skill is installed by both agntc and Vercel's CLI, both land on the same folder. This shows up as a visible clash through the untracked-files path (§13), not as two copies the agent sees side by side."

Source: discussion `vercel-skills-compatibility.md`, Skill Identity, Options Considered, "Declared name for folder and key (Vercel's)" (line 339): "a skill installed by both tools lands on one folder (a visible clash through the untracked-files path) instead of appearing twice to the agent".

Measurement:
- `grep -n "skills:" src/drivers/cursor-driver.ts` → `8:	skills: ".cursor/skills",`
- Vercel `src/agents.ts:269–272` at `7407f389`: `cursor: { name: 'cursor', displayName: 'Cursor', skillsDir: '.agents/skills',`. Cursor is one of Vercel's universal agents, so its copy is the canonical `.agents/skills/<name>`, with no link under `.cursor/`.
- `src/commands/add.ts:218–222`: `const unmanagedConflicts = await checkUnmanagedConflicts(incomingFiles, currentManifest, projectDir);`. The clash check covers only agntc's own incoming target paths, which for Cursor sit under `.cursor/skills/`.
- Sibling record, `.workflows/cursor-agent-driver/discussion/cursor-agent-driver.md:35`: "Cursor auto-discovers skills from four directories: `.agents/skills/`, `.cursor/skills/`, `~/.cursor/skills/` (global), and `.claude/skills/` (legacy fallback)."

**Proposed Text**:

**Resolution**: Pending
**Notes**:

---

## Observations

- §2.1's "Vercel clones either as given" holds for `git@host:path` and for self-hosted `ssh://` and `.git` URLs. An `ssh://` URL on github.com or gitlab.com is the exception: it matches Vercel's GitHub or GitLab pattern first and is cloned over https (v1.7.0 `src/source-parser.ts:455–464`, `:500–511`). The whole-path point the section relies on still holds.
- §5.3's "Today a `SKILL.md` beside any asset folder is read as a plugin" goes too far. Beside `skills/` alone, the folder is read as skills-only (a menu, or a bundle under `--plugin`), not as a plugin (`classifyStructure`, `src/type-detection.ts:145–163`). The `SKILL.md` is dropped either way.
