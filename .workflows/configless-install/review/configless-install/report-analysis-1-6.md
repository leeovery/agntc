TASK: configless-install-analysis-1-6 — Make status the single discriminator for clone-reinstall outcomes: drop failureReason:"aborted", dispatch aborted on status and the failed family on failureReason; surface the lenient no-agents skip under a non-failed status (keep mapCloneFailure.onNoAgents). Preserve observable behaviour.

ACCEPTANCE CRITERIA: no failureReason:"aborted"; no-agents not status:"failed"; single-key all-dropped returns null/exit 0; all-updates emits non-fatal no-agents skip.

STATUS: Complete

SPEC CONTEXT: Spec distinguishes (a) irreconcilable recorded-type change → loud abort, install intact, non-zero (hard failure family) from (b) lenient agent posture — re-clone narrowing installed agents to zero is a benign skip, NOT a hard error, must not exit non-zero. Modelling change keeps aborted in non-zero family, no-agents out, no observable change.

IMPLEMENTATION: Implemented (consolidated model fully in place). src/clone-reinstall.ts + nuke-reinstall-pipeline.ts.
- :222-226 CloneReinstallAborted carries status:"aborted" + recordedType + reason only, no failureReason (item 1 resolved).
- :100-103 CloneReinstallNoAgents has own status:"no-agents" not "failed" (item 2 resolved).
- :151-172 mapCloneFailure dispatches aborted/blocked/no-agents on status, refines only failed family (clone-failed/copy-failed/unknown) on failureReason. Single discriminator.
- :140-149 isCloneReinstallFailure narrows full non-success union incl no-agents. :428-433 runPipeline packages no-agents under status:"no-agents". nuke-reinstall-pipeline.ts:41-43,256-268 emits dedicated status:"no-agents". :377-392 handleCopyFailedRemoval keys status==="failed" && failureReason==="copy-failed" — aborted/blocked/no-agents never match (install-intact entry never removed).
- Callers resolve under status: update.ts:213-251 (single) + :309-354 (all) route through isCloneReinstallFailure + mapCloneFailure, no direct failureReason read; no-agents → onNoAgents → single-key null/exit 0, all-updates skipped-no-agents excluded from hasFailedOutcome. list actions route through failureMessage (immune to drop). Grep: failureReason:"aborted" nowhere in src.

TESTS: Adequate. tests/clone-reinstall.test.ts: mapCloneFailure aborted via status (1113); failed-family via failureReason clone-failed (1077)/copy-failed (1097)/unknown (1105); no-agents via own status (1089); isCloneReinstallFailure incl no-agents/aborted/blocked + narrows (1168,1204); cloneAndReinstall returns status:"no-agents" no nuke (347); aborted plumbed no nuke entry-not-removed (391-511). update.test.ts: single-key all-dropped exit 0 no nuke/write warn (1168,1118); all-updates no-agents benign skip no ExitSignal sibling written entry untouched warned-not-errored (1800 — strongest guard for criterion 2).

CODE QUALITY: Conventions followed (discriminated-union dispatch, exhaustive switch on failureReason no default; union + mapper co-located). SOLID good (aborted from two-tag to single discriminator — tightened invariant; mapCloneFailure one dispatch point). Complexity low. Modern idioms (exhaustive narrowing → compile error on new failureReason). Readability good (doc comments state status is single discriminator, no-agents is skip-not-failure).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [quickfix] tests/clone-reinstall.test.ts:418-442 — remove the duplicate aborted test ("carries status 'aborted'"); byte-equivalent arrange+assertions to :391-416. Keep one. (Recurs with the 4-6 note.)
- [do-now] src/clone-reinstall.ts:126-139 — orphaned/misattached JSDoc: the block documenting mapCloneFailure's dispatch sits detached above isCloneReinstallFailure (real mapCloneFailure at :151). Move it to immediately above mapCloneFailure.
