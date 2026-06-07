TASK: configless-install-analysis-2-1 (HIGH severity) — Fix spec-conformance bug: a skills-only collection member (only skills/, no SKILL.md) is correctly enumerated but silently skipped at install because per-member detection re-runs root detectType with no override, the skills-only ambiguity defaults to {type:"collection"}, hitting the "nested collections not supported" skip. Member-level type:plugin config also never consulted. Existing tests masked it by mocking detectType.

ACCEPTANCE CRITERIA: selected skills-only member installs as plugin member (skills assets copied for selected agents, manifest entry recorded); member-level type:plugin config consulted in per-member detection; genuine members-collection child still skipped with "nested collections not supported"; not-agntc child still skipped.

STATUS: Complete

SPEC CONTEXT: Spec membership rule "a child with >=1 asset-kind dir is a plugin member" applied one level down (113); skills-only is the single ambiguous case resolved only by override (config type:plugin or --plugin); nested collections unsupported, one level down (334-336); per-member type honours member's own config.

IMPLEMENTATION: Implemented (correct, matches acceptance + spec). src/commands/add.ts:560-568 (fix); type-detection.ts:92-96,120-128,201-206 (supporting); copy-unit.ts:34-73 (downstream unchanged).
- Per-member loop computes memberHasAssetDirs = (await findPresentAssetDirs(pluginDir)).length > 0 (560-561) and calls detectType(pluginDir, {onWarn, configType: pluginConfig?.type, forcePlugin: memberHasAssetDirs}) (562-568).
- Skills-only child → {type:"plugin", assetDirs:["skills"]} (type-detection.ts:94-95) instead of {type:"collection"}.
- Asset-dir gate is correct + safe: genuine members-collection child has zero asset dirs at its own root → forcePlugin false → detectType returns collection → existing skip at 581-590 still fires. A member-dirs child under forcePlugin:true would hard-error, so the gate is what keeps that safe (inline comment 550-559 captures this).
- Member's own configType forwarded (item 2); member config read at step 3 (517-521). Downstream copyUnit → copyPluginAssets runs unchanged (item 3). No drift.

TESTS: Adequate. Dedicated REAL-detection suite tests/commands/add.test.ts:3147-3340:
- "installs a real skills-only member as a plugin" (3168-3225): real on-disk member with only skills/foo/SKILL.md (no root SKILL.md), delegates BOTH detectType and findPresentAssetDirs to real impls via vi.importActual (3150-3158), readConfig null so resolution driven SOLELY by structural forcePlugin gate. Asserts copyPluginAssets once sourceDir===memberDir assetDirs===["skills"], copyBareSkill NOT called, manifest entry owner/my-collection/skillsonly type:"plugin", NO "nested collections" warning. With old code (no forcePlugin) real detectType returns collection → skipped → test fails. Genuinely exercises the bug.
- "honours a member-level type:plugin config" (3227-3286): member config {agents,type:"plugin"}; asserts member config read at own dir + configType:"plugin" forwarded into per-member detectType, installs as plugin (criterion 2).
- "still skips a genuine nested members-collection child" (3288-3339): real members-collection child via real detection → asserts "nested collections not supported — skipping" warning, nothing copied/recorded (regression).
not-agntc skip (criterion 4) covered by pre-existing tests (1188,733). Pre-existing mocked-detectType tests retained for orthogonal concerns. Not over/under-tested.

CODE QUALITY: Conventions followed (reuses single findPresentAssetDirs primitive; one-detection-path discipline — override input not parallel detector). SOLID good (copyUnit/toComputeInput single dispatch shared; fix is localized override input not new branch). Complexity low. Modern idioms. Readability good (inline comment 550-559 explains why asset-dir gate keeps member-dirs path safe — strong intent doc).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
