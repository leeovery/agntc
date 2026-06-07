TASK: configless-install-analysis-2-3 — Extract single copy dispatch (copyUnit) + compute-input mapping (toComputeInput) shared by standalone and collection-member install paths (dedup).

ACCEPTANCE CRITERIA: copy dispatch in exactly one helper called from both add.ts paths; computeIncomingFiles input mapping in exactly one place used by both; standalone + collection-member behaviour unchanged; npm test passes.

STATUS: Complete

SPEC CONTEXT: Duplication-class refactor (not spec-driven). Relevant invariant is behavioural: the two-arm plugin/bare-skill dispatch and discriminated ComputeInput must produce identical results for standalone and collection-member paths. No spec behaviour change.

IMPLEMENTATION: Implemented (clean, no drift).
- New module src/copy-unit.ts:34-43 (toComputeInput) + :52-73 (copyUnit), keyed on shared StandaloneDetected = Extract<DetectedType,{type:"bare-skill"|"plugin"}> (13-16).
- Standalone consumes both: toComputeInput add.ts:368, copyUnit add.ts:390-394.
- Collection-member loop consumes both: toComputeInput add.ts:659, copyUnit add.ts:700-704.
- Inline detected.type==="plugin"? ternary dispatch + inline compute-input ternary fully removed from add.ts (grep copyPluginAssets/copyBareSkill/type==="plugin"? in add.ts zero matches except the unrelated empty-plugin warning gate at 404).
- copyUnit returns {copiedFiles, assetCountsByAgent?}, bare-skill arm omits assetCountsByAgent (71-72), matching original.
- Nuke-reinstall replay (replayRecordedSkill/Plugin nuke-reinstall-pipeline.ts:174,212) left calling copiers directly — task explicitly permits; those select assetDirs via findPresentAssetDirs (derive-before-delete) not a detected unit, so reuse isn't a clean fit. No drift.

TESTS: Adequate. tests/copy-unit.test.ts: toComputeInput plugin arm (41) + bare-skill arm (51); copyUnit plugin dispatch with assetCountsByAgent (62) + bare-skill dispatch asserting assetCountsByAgent undefined + other copier NOT called (87). Both arms of both helpers + argument forwarding. End-to-end through both real paths in add.test.ts: standalone plugin (637 + compute-input 4577); standalone bare-skill compute-input (4567); collection plugin (931); collection bare-skill (991/1005); collection mixed (961); per-member compute-input agents (2210). Behaviour-focused (copier mocks + computeIncomingFiles args). Not over/under-tested.

CODE QUALITY: Conventions followed (module JSDoc on both helpers; Extract<DetectedType,...> narrowing consistent with buildAddEntry; .js + type-only imports). SOLID good (each helper single responsibility; discriminant in one place — open/closed for future third arm = single-site edit). Complexity low (binary branch over two-member discriminated union, exhaustive by construction via StandaloneDetected). Modern idioms. Readability good (copyUnit/toComputeInput/StandaloneDetected self-documenting).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [idea] src/copy-unit.ts:52 / src/nuke-reinstall-pipeline.ts:233 — consider routing replayRecordedPlugin's copy through copyUnit via a synthetic {type:"plugin",assetDirs:presentAssetDirs} unit, collapsing the last direct copyPluginAssets call mirroring copyUnit's plugin arm. Requires a design decision (synthetic-unit vs keeping replay's derive-before-delete copy explicit); task explicitly allows leaving as-is. Optional polish.
