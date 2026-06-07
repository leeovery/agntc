TASK: configless-install-4-5 — Add recorded-plugin branch to executeNukeAndReinstall. For existingEntry.type==='plugin': enumerate asset-kind dirs present in re-cloned sourceDir BEFORE nuke; ≥1 → nuke + copyPluginAssets(present dirs); zero → abort install intact. Replays plugin (chooses dirs), not re-deriving. Remove v1 blind detectType/invalid-type.

ACCEPTANCE CRITERIA: reads type==='plugin' replays; ≥1 asset dir → re-copies present dirs, benign additions picked up; zero asset dirs → aborted no nuke/copy; scan BEFORE nuke; recorded plugin + added SKILL.md but ≥1 asset dir still plugin; member subdir vanished aborts; configless proceeds; blind re-detection/invalid-type removed, computeAgentChanges retained.

STATUS: Complete

SPEC CONTEXT: Manifest Keying & Lifecycle (replay plugin not re-derive; recorded-plugin predicate = ≥1 asset-kind dir remains → re-copy present dirs benign additions, zero → abort; member entries same predicate on own subdir); Error & Abort (install intact, structured cause, aborted).

IMPLEMENTATION: Implemented. src/nuke-reinstall-pipeline.ts.
- :127 recordedType = existingEntry.type ?? "skill"; :153-155 branch dispatch (recorded type selected before structural inspection — added SKILL.md can't reroute recorded plugin).
- :212-245 replayRecordedPlugin: :218 scan via findPresentAssetDirs; :220-227 abort on zero {status:'aborted',recordedType:'plugin',reason}; :229 nuke after scan; :233-239 copyPluginAssets assetDirs: presentAssetDirs (current set → benign additions picked up).
- Member subdir vanished → zero present → abort, same predicate. Dead-code removal complete: no detectType import in pipeline (grep), result union has no invalid-type member (would not compile). computeAgentChanges retained via resolveAgents (264); onAgentsDropped (135-137). Configless: resolveAgents treats undefined configAgents as no-restriction, proceeds.
- Uses shared findPresentAssetDirs (analysis-1-4 consolidation) instead of literal inline ASSET_DIRS.filter — intended DRY design, identical outcome.

TESTS: Adequate. tests/nuke-reinstall-pipeline.test.ts: replays plugin scans+nukes+copyPluginAssets assetDirs:["skills"], copyBareSkill NOT called, type plugin (160-195); benign added asset dir picked up assetDirs includes agents (197-217); added SKILL.md + ≥1 asset dir still plugin (219-238); scan-before-nuke success (240-267) + abort callOrder never contains nuke (327-345); configless proceeds (269-289); zero asset dirs aborted no nuke/copy recordedType plugin (292-308); became bare skill aborted (310-325); member subdir vanished aborts scan path (347-367). Behaviour-focused. invalid-type-gone enforced by union type at compile time (no runtime test warranted).

CODE QUALITY: Conventions followed (shared findPresentAssetDirs + pathExists primitives; ReplayContext/buildSuccess/copyFailed helpers; symmetric with replayRecordedSkill). SOLID good (single responsibility; recorded-type dispatch clean open/closed seam — skill/plugin interchangeable strategies). Complexity low. Modern idioms (for-of await, discriminated result, structured abort). Readability good (doc comment states derive-before-delete + recorded-type-authoritative).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
