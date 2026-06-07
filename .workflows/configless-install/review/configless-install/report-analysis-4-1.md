TASK: configless-install-analysis-4-1 — Remove dead buildFailureMessage paralleling the centralised failureMessage; give the no-agents sentence a single source of truth.

ACCEPTANCE CRITERIA: buildFailureMessage no longer exists / not imported; no-agents string literal in exactly one place (clone-reinstall.ts:434, update.ts:216, failureMessage all derive from it); no production behaviour/message change; full suite passes.

STATUS: Complete

SPEC CONTEXT: Lenient no-agents posture — update dropping all installed agents warns + skips, files left in place, no non-zero exit on its account. Sentence "Plugin {key} no longer supports any of your installed agents"; update.ts appends remedy. Pure consolidation/dead-code removal, "no behaviour change".

IMPLEMENTATION: Implemented (all four Do steps).
- src/clone-reinstall.ts:207-209 new exported noAgentsMessage(key) co-located beside failureMessage — single literal source (line 208).
- :431 runPipeline no-agents result builds message via noAgentsMessage(key).
- src/commands/update.ts:9,217 imports noAgentsMessage; richer warning composes "${noAgentsMessage(key)}. No update performed. Run npx agntc remove ${key} to clean up."
- failureMessage (184-197) onNoAgents passes through the no-agents result's message (originates from noAgentsMessage at 431) — list update/change-version paths transitively derive from same source.
- buildFailureMessage gone from src; grep zero refs in src/tests (remaining hits historical .workflows/.tick records). All three sites trace to the one literal at 208. No drift.

TESTS: Adequate. tests/clone-reinstall.test.ts:1224-1236 dedicated noAgentsMessage describe (exact sentence for owner/repo + key interpolation for acme/widgets — the required helper test). :1238-1294 failureMessage describe covers clone-failed/copy-failed/unknown/no-agents/aborted/blocked (migrated coverage intact). mapCloneFailure (1105) + isCloneReinstallFailure (1158) cover no-agents dispatch. describe("buildFailureMessage") block + import removed (grep confirms). Downstream assertions (update.test.ts:1137,1163,2396; list-update-action.test.ts:280,306; list-change-version-action.test.ts:357) use stringContaining so consolidated single-source message still satisfies — confirms behaviour preservation. Not over/under-tested.

CODE QUALITY: Conventions followed (exported helper w/ JSDoc naming consumers; consistent w/ documented module style). SOLID good (single-responsibility helper; consumers depend on function not duplicated literal; failureMessage/mapCloneFailure remain one dispatch path). Complexity low (one-line pure function). Modern idioms. Readability good.

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
