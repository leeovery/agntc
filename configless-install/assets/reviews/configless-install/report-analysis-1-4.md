TASK: configless-install-analysis-1-4 — De-duplicate the asset-dir presence scan. Extract findPresentAssetDirs(root): Promise<AssetType[]> into type-detection.ts; derive qualifiesAsMember from .length>0; reuse from replayRecordedPlugin. One scan function, one existence primitive across all sites.

ACCEPTANCE CRITERIA: scan loop in exactly one place; one existence primitive; detection/membership/replay unchanged.

STATUS: Complete

SPEC CONTEXT: Pure duplication-removal — the for(const dir of ASSET_DIRS){if(await exists(...))} loop appeared 3× (foundAssetDirs classification, qualifiesAsMember membership, presentAssetDirs replay), first two local exists, third pathExists. Asset-dir presence is the backbone of plugin/skills-only/bare-skill classification, structural membership, and derive-before-delete plugin replay — all must be byte-identical post-refactor.

IMPLEMENTATION: Implemented.
- src/type-detection.ts:120-128 findPresentAssetDirs — the only for...of ASSET_DIRS loop in src (Grep one hit).
- :134 classifyStructure consumes it (foundAssetDirs); :205 qualifiesAsMember derives from .length>0; nuke-reinstall-pipeline.ts:218 replayRecordedPlugin consumes it.
- Single primitive: uses pathExists (fs-utils.ts:27); no local exists remains in src (Grep no match). JSDoc names pathExists as single primitive.
- Beneficial 4th consumer found: add.ts:561 memberHasAssetDirs (from analysis-2-1 forcePlugin work) reuses the helper — strengthens consolidation, not drift.

TESTS: Adequate. Unit: tests/type-detection.test.ts:31-64 findPresentAssetDirs zero (40)/one (46)/many w/ ASSET_DIRS-order assertion (54) — ordering is the load-bearing invariant. Detection consumer: detectType suite (66-424). Membership consumer: collection suite (159-239). Replay consumer: update.test.ts:2091 (mockAccess makes hooks ENOENT, asserts assetDirs ["skills","agents"] reaches copyPluginAssets — real findPresentAssetDirs unmocked at :64 so genuinely exercises consolidated code) + :2554 regression. Zero-dirs abort covered at all-updates integration level (1612+). Not over-tested.

CODE QUALITY: Conventions followed (named async export, readonly/satisfies ASSET_DIRS, JSDoc explains why). SOLID good (single-responsibility query; consumers depend on abstraction not loop; DRY without premature abstraction — now 4 sites). Complexity low. Modern idioms (for...of over readonly tuple; sequential await fine for 3 fixed dirs). Readability good.

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [quickfix] tests/commands/update.test.ts (replay suite ~2091/2554) — add a focused unit-level regression asserting replayRecordedPlugin returns status:"aborted", recordedType:"plugin", "no asset dir … remains" reason when findPresentAssetDirs resolves [] (all three ASSET_DIRS access ENOENT). Zero-dirs branch currently only exercised indirectly via all-updates aborted suite.
- [do-now] src/nuke-reinstall-pipeline.ts:204-210 — replayRecordedPlugin JSDoc predates the extraction and still describes the scan inline; add a clause referencing findPresentAssetDirs (shared single-source helper) so the consolidation is discoverable from the consumer side.
