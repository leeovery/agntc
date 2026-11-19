# Member-select prompt says "plugins" even when members are skills

The collection / skills-only member multiselect is hard-coded to `"Select plugins to install"` (`src/collection-select.ts:35`), but its options are frequently bare *skills*, not plugins. This jars against the agent prompt right below it, which already uses the precise noun + count via `describeUnits` — e.g. "Install **these 2 skills** for which agents?" or "Install **these 2 skills and 1 plugin** for which agents?". So one prompt says "plugins" while the very next says "2 skills". Surfaced repeatedly during the pre-release e2e walkthrough (3.1, 4.1, 4.2, 4.3, 7.3).

**Fix direction:** make the member-select label use a precise/neutral noun derived from the actual member kinds — mirror `describeUnits`:
- all skills → "Select skills to install"
- all plugins → "Select plugins to install"
- mixed → a neutral collective, e.g. "Select items to install" (or "Select skills and plugins to install").

`describeUnits` (in `src/commands/add.ts`) already computes this distinction for the agent prompt; the member-select call site could pass the same derived label down so the two prompts agree.

**Related minor wording nits noted in the same walkthrough (fold in or ignore):**
- Remove confirm reads "N file(s) will be deleted" where the recorded `files` are often skill *directories* (e.g. `.claude/skills/alpha/`), so "3 file(s)" really means 3 paths/dirs. Consider "N item(s)" / "N path(s)", or count the actual files.
- After removing the last install, empty parent asset dirs (`.claude/skills/`, `.agents/skills/`, `.cursor/skills/`) are left behind. Harmless (standard agent dirs agntc may share with the user's own content) — deliberately not pruned. Only worth revisiting if it bothers anyone.

**Relevant files:** `src/collection-select.ts` (label), `src/commands/add.ts` (`describeUnits`), `src/commands/list-remove-action.ts` (remove confirm wording).
