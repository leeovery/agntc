TASK: configless-install-4-6 — Thread the derive-before-delete abort up through clone-reinstall.ts and update.ts into a clear user-facing report (recorded type vs current structure, manual remove+add remedy, entry reported aborted, single-key exits non-zero), DISTINCT from copy-failed.

ACCEPTANCE CRITERIA: abort mapped to dedicated aborted failure (recordedType+reason), not conflated; message names recorded-vs-current + remove+add remedy; entry reported aborted; single-key abort exits non-zero; install fully intact (no nuke, entry not removed/modified); distinct from copy-failed (different message + manifest effect).

STATUS: Complete

SPEC CONTEXT: Error & Abort (update abort irreconcilable change — install intact, recorded-vs-current message + remove/add remedy, aborted report; command exit non-zero if any aborted, no sibling rollback); Manifest Keying & Lifecycle (irreconcilable change → abort + loud alert install intact). Converged final state: analysis-3-1 gave symlink-escape its own 'blocked' outcome distinct from 'aborted' (both install-intact, only aborted offers remove+add remedy).

IMPLEMENTATION: Implemented. src/clone-reinstall.ts + src/commands/update.ts.
- clone-reinstall.ts:222-226 CloneReinstallAborted (status:"aborted", recordedType, reason) — dedicated branch (status is the cross-boundary discriminator, keeps it off copy-failed removal path). :443-449 runPipeline maps pipeline aborted preserving recordedType+reason. :121,155-157 onAborted in CloneFailureHandlers + case 'aborted'. :260-270 buildAbortMessage names recorded type + reason + "install unchanged" + "To migrate: npx agntc remove … then npx agntc add …". :377-392 handleCopyFailedRemoval removes only failed+copy-failed; aborted/blocked never reach it (CRUCIAL satisfied).
- update.ts:226-233 runSinglePluginUpdate onAborted logs buildAbortMessage via p.log.error + throws ExitSignal(1). :325-333 processUpdateForAll onAborted returns {status:"aborted",key,summary} (PluginOutcome variant 49). :508-523 all-updates build loop adds only updated/refreshed, removes only copy-failed; aborted untouched. :616-629 hasFailedOutcome counts aborted toward ExitSignal(1) after summary, no sibling rollback.
- Derive-before-delete gate lives upstream (4-4/4-5); 4-6 threads, not re-decides. Abort vs copy-failed fully distinct (copy-failed recoveryHint + entry removal vs abort intact + remove+add remedy).

TESTS: Adequate. tests/clone-reinstall.test.ts:391-565 (aborted): plumbed w/ recordedType/reason (392); status discriminator (418); no nuke (444); does NOT remove entry even when manifest provided (466 — CRUCIAL); temp cleanup (491); member subdir abort (513). :1064-1156 mapCloneFailure dispatches aborted→onAborted (1113); isCloneReinstallFailure true (1176); failureMessage aborted→buildAbortMessage (1279). tests/commands/update.test.ts:1191-1355: single-key exits non-zero (1214); message names recorded type + SKILL.md change + unchanged + remove/add (1223); no nuke/mutate/removeEntry (1238); distinct from copy-failed no "currently uninstalled" (1248); all-updates aborted no mutate sibling defined (1265); loud per-unit remedy (1320). Behaviour-focused.

CODE QUALITY: Conventions followed (discriminated-union exhaustive dispatch; ExitSignal via withExitSignal). SOLID good (mapCloneFailure open/closed single-site; buildAbortMessage/buildCopySafetyMessage single responsibility; message decoupled from presentation). Complexity low. Modern idioms (as const, exhaustive narrowing). Readability good (doc comments state install-intact + abort-vs-copy-failed/blocked distinctions).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [quickfix] tests/clone-reinstall.test.ts:418-442 — "carries status 'aborted'" test duplicates arrange+assertions of preceding "plumbs aborted up" (392-416); merge or differentiate (e.g. assert NOT failed/copy-failed) so each earns its place.
