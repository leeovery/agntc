TASK: configless-install-1-2 — Single structural detection path (collapse detectType's two hasConfig-gated paths into one structural classifier that ignores config presence).

ACCEPTANCE CRITERIA: detectType drops hasConfig; bare SKILL.md no config → bare-skill; skills+agents/hooks → plugin; agents-only/hooks-only/agents+hooks → plugin; skills-only → collection default (ambiguous, exposed to override layer); SKILL.md+asset → plugin warn once; empty/unreadable/files-only → not-agntc no throw; call sites compile.

STATUS: Complete

SPEC CONTEXT: Structural Type Detection — one always-structural path; config presence no longer an input; canonical plugin rule (≥1 asset-kind dir → plugin, skills-only exception); refero_skill bare SKILL.md no config must detect bare-skill. (Reviewed within final cumulative tree which also reflects 1-3/1-4.)

IMPLEMENTATION: Implemented.
- src/type-detection.ts: DetectTypeOptions { configType?; forcePlugin?; onWarn? } (48-52), hasConfig dropped. Private StructuralKind 'skills-only'|'plugin'|'bare-skill'|'members'|'none' (61-66). classifyStructure(dir,onWarn) (130-160) does asset-dir scan, hasSkillMd, plugin classification w/ SKILL.md-coexists warning, skills-only, bare-skill, member scan; detectType (68-108) maps to stable public DetectedType. findPresentAssetDirs (120-128) single asset-dir scan reusing pathExists.
- Call sites: src/commands/add.ts:267-271 (root) and :562-568 (per-member) pass {onWarn,configType,forcePlugin}, no hasConfig. nuke-reinstall-pipeline.ts no longer calls detectType (replay uses findPresentAssetDirs+pathExists) — legitimate later-phase replacement of the "~85" caller.
- No production hasConfig references remain (grep).

TESTS: Adequate. tests/type-detection.test.ts covers every 1-2 criterion behaviourally w/ real temp dirs (no detectType mocking): bare-skill from root SKILL.md (76-82) + non-asset siblings (84-92); plugin from skills+agents/agents-only/hooks-only/agents+hooks w/ assetDirs ordering (96-134); warn-once+plugin on SKILL.md coexistence (136-146); skills-only→collection (149-156); not-agntc empty/only-files/unreadable-no-throw (242-268); config-presence-ignored equivalence (414-424); plus findPresentAssetDirs/ASSET_DIRS coverage. Not over-tested.

CODE QUALITY: Conventions followed (single existence primitive, single asset scan, ASSET_DIRS via satisfies). SOLID good (classifyStructure vs detectType separation; private discriminator keeps public union stable). Complexity low. Modern idioms (discriminated unions, satisfies). Readability good.

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
