# Review: configless-install-analysis-8-1

**Task:** Skills-only default must enumerate inner skills as an installable collection menu
**STATUS:** Complete
**FINDINGS_COUNT:** 0 blocking issues

## Spec Context
Spec "Structural Type Detection → Skills-only resolution" (lines 88, 124-129) mandates the flag-free default for a root skills/-only repo to resolve to a collection menu of N independently-installable skills, mirroring Vercel discoverSkills (one level into skills/, each skills/<name>/SKILL.md a selectable bare-skill member). Overrides (config type:plugin or --plugin, --plugin winning) bundle the whole skills/ dir as one plugin. Identity is dir-basename throughout (spec lines 174/178, 252-253), so each member keys owner/repo/<name>.

## Implementation — Implemented
- src/type-detection.ts:64-69 — StructuralKind gains `skills-only` carrying enumerated members.
- src/type-detection.ts:95-104 — skills-only branch: wantsPlugin → plugin over skills; default → collection with structure.members.
- src/type-detection.ts:158-163 — classifyStructure enumerates members via scanSkillsOnlyMembers.
- src/type-detection.ts:196-200 — scanSkillsOnlyMembers walks one level into skills/, prefixes each name with "skills/" so the segment locates the dir while basename keys it.
- src/type-detection.ts:209-229 — scanQualifyingChildDirs: shared one-level membership scan reused by both root-child scan and skills-only enumeration.
- src/commands/add.ts:103-110 (memberKey) — keys members by basename(segment): skills-only members key owner/repo/<name>, not owner/repo/skills/<name>.
- src/commands/add.ts:123-125 (memberSourceSubpath) + 581-616, 728-797 — pipeline iterates segments, locates dirs at join(sourceDir, segment), display/key by basename, persists divergent segment as sourceSubpath for the update path.
- src/collection-select.ts:18-32 — menu labels and installed-hint keys by basename(segment).
- Enumeration reuses the same qualifiesAsMember authority as root-child scan. Skills-only inner skill is a bare skill (SKILL.md, no asset dir), resolves to bare-skill with no override.

## Tests — Adequate
- tests/type-detection.test.ts:149-186 — populated skills-only → collection ["skills/a","skills/b"]; empty skills/ → { collection, plugins: [] } (no crash); non-unit child excluded. Original test correctly re-targeted to populated enumeration with empty case kept separate.
- tests/type-detection.test.ts:300-340 — override paths unchanged: config type:plugin and forcePlugin both → { plugin, assetDirs: ["skills"] }.
- tests/integration/workflows.test.ts:545-630 (d) — flag-free populated skills-only repo → collection; members install as bare skills to .claude/ AND .agents/, manifest keys basenames with type "skill".
- tests/integration/workflows.test.ts:632-681 (e) — --plugin and type:plugin both bundle root as ONE plugin entry; enumeration does NOT happen.
- tests/integration/workflows.test.ts:683-812 (f) — skills-only member updates end-to-end via stored sourceSubpath.
- tests/integration/workflows.test.ts:814-891 (g) — root-child member (segment === basename) carries NO sourceSubpath, resolves via key-derived fallback (existing path unchanged).

## Code Quality
Discriminated unions with exhaustive switch; scanQualifyingChildDirs is the single membership authority; memberKey/memberSourceSubpath each own one rule shared by conflict pass and write loop to prevent drift. Conditional-spread optional manifest fields. Doc comments explain segment-vs-basename decoupling. No issues.

## Blocking Issues
None.

## Non-Blocking Notes
None.
