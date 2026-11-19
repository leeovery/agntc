TASK: configless-install-3-5 — Verify+guard the collection-root seam: stray root agntc.json with no type ignored (structure decides collection; root config never an installable unit config); root type:'plugin' on member-dirs → hard error (TypeConflictError) pre-flight non-zero before any write, pipeline not entered.

ACCEPTANCE CRITERIA: member-dirs + stray root no-type → collection installs, root config not read as unit config; member-dirs + root type:plugin → TypeConflictError, identity-prefixed p.cancel ('collection of N members — cannot bundle') + ExitSignal(1); pre-flight (no copy/write, pipeline not entered); runAdd forwards configType: config?.type; configless-root collection unchanged.

STATUS: Complete

SPEC CONTEXT: Backward-Compat (stray root agntc.json — no type ignored, type:plugin on member-dirs hard error, presence never reclassifies); Config Model (collection never carries config; presence never signals type; only type:"plugin" recognised); Type-vs-structure conflict; Error & Abort (pre-flight, nothing written, non-zero, names source). Verification/guarding task — no new production code.

IMPLEMENTATION: Implemented (verification — seam from 2-1/2-2). src/commands/add.ts.
- 267-271 single root detectType forwards configType: config?.type (load-bearing seam); config read once step 3 (260) against unitDir.
- 272-290 TypeConflictError catch: identity-prefix when not --plugin, p.cancel, ExitSignal(1), before collection branch.
- 293-305 collection branch dispatches only after detectType succeeds (conflict never reaches it).
- 450-463 CollectionPipelineInput carries sourceDir/cloneRoot/parsed/commit/detected/onWarn/spin/constraint — NO root-config field. Pipeline step 3 (515-521) reads only child configs; agents per-member (597-600) from pluginConfig?.agents, never root.
- type-detection.ts:79,97-103: wantsPlugin = forcePlugin||configType==="plugin"; members+wantsPlugin → TypeConflictError(N members); members without → collection; configType undefined/"collection" → wantsPlugin false → structure stands.

TESTS: Adequate. tests/commands/add.test.ts describe("stray root agntc.json on a member-dirs collection") 2893-3138: stray no-type → collection keyed owner/my-collection/pluginA,B, no cancel (2931); root detectType receives configType undefined (2965); root type:plugin → ExitSignal(1) identity-prefixed cancel names source + 'cannot bundle' + 'collection of 2 members' (2990); forwards configType:"plugin" (3020); pre-flight proof — selectCollectionPlugins/nuke/copy/addEntry/writeManifest NOT called, temp cleaned (3040); root config never a unit config — root agents:["codex"] members ["claude"], every selectAgents carries ["claude"] (3068, strongest guard); configless-root unchanged (3096); root type:collection ignored → installs (3119). Behaviour-focused, isolated mocks.

CODE QUALITY: Conventions followed (single structural detection path, identity-prefixing, total readConfig, per-member resolution; discriminated DetectedType + Extract narrowing). SOLID good (detectType owns recognition+conflict; runAdd owns prefix+exit; pipeline owns per-member; CollectionPipelineInput exposes only what pipeline needs — interface segregation). Complexity low. Modern idioms (instanceof, ?., ??). Readability good.

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [idea] tests/commands/add.test.ts (stray-root block) — does not directly assert CollectionPipelineInput carries no root-config field; verified structurally by the interface + behaviourally by test 3068 (root agents never reach selectAgents). Adequate as-is; a direct interface-shape assertion is optional.
