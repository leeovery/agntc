TASK: configless-install-analysis-3-2 — Extract a shared failureMessage helper so both list actions (update + change-version) collapse any CloneReinstallFailure to one user-facing message, eliminating duplicated mapCloneFailure handler objects.

ACCEPTANCE CRITERIA: both list actions produce identical failure messages for every CloneReinstallFailure variant from the single helper; change-version success still strips constraint, update success doesn't; discriminators (success vs changed) + success messages unchanged; processUpdateForAll unchanged; no duplicated handler object remains across the two list action files.

STATUS: Complete

SPEC CONTEXT: Dedup task (severity medium, duplication). Underlying behaviour (no-agents skip, aborted, blocked copy-safety, copy-failed removal) is established; this only deduplicates the presentation tail shared by the two list actions, preserving every per-variant outcome. The newer blocked variant (analysis-3-1) landed first so the helper covers it.

IMPLEMENTATION: Implemented (clean, matches plan + ACs).
- src/clone-reinstall.ts:184-197 failureMessage(result,key) beside mapCloneFailure, implemented via mapCloneFailure<string>: pass-through msg for clone-failed/copy-failed/unknown/no-agents; buildAbortMessage for aborted; buildCopySafetyMessage for blocked. All six variants covered.
- list-update-action.ts:51-53 → return {success:false, message: failureMessage(result,key)}; discriminator + success message (Refreshed/Updated) untouched.
- list-change-version-action.ts:102-103 → {changed:false, message: failureMessage(result,key)}; stripConstraint on success (106) preserved; success message unchanged.
- update.ts:214-251 (runSinglePluginUpdate) + :310-354 (processUpdateForAll) retain their richer handlers (out-of-scope channels intact).
- No duplicated handler object in the two list files (grep onCloneFailed|onNoAgents|onCopyFailed|onAborted|onBlocked|onUnknown in src returns only clone-reinstall.ts + update.ts). Both list actions emit identical prepareReinstall not-ok literal "Path ${key} does not exist or is not a directory" (no period). update.ts:207 variant has trailing period but is p.log.error on out-of-scope channel — correctly not unified. Plan's "single edit for a new variant" holds.

TESTS: Adequate. tests/clone-reinstall.test.ts:1238-1294 dedicated failureMessage describe, one focused test per variant: clone-failed/copy-failed/unknown/no-agents pass-through; aborted == buildAbortMessage(...); blocked == buildCopySafetyMessage(...) — pinned to canonical builders so cannot drift. list-update-action.test.ts failure-path regression (success discriminator): clone-failure (236), agents-dropped remote+local (259,289), copy-failed (523,555), aborted (584), blocked (620). list-change-version-action.test.ts symmetric (changed discriminator): 306,332,531,564,604; success/stripConstraint contract 646-688 + 773-801 (changed:true, constraint undefined). Update-success-no-strip: list-update-action.test.ts:156-196 (success:true, no stripConstraint import/call). "Same message both actions" satisfied structurally (helper output pinned once + both actions assert same substrings against it; both call identical failureMessage so can't diverge — literal side-by-side equality would add no coverage). Not over/under-tested.

CODE QUALITY: Conventions followed (helper co-located beside mapCloneFailure/isCloneReinstallFailure per single-site-change pattern; doc comment matches house style + notes update.ts keeps richer handler). SOLID good (failureMessage single responsibility failure→string, built on existing mapCloneFailure dispatcher — DRY; open for extension via handler interface). Complexity low (flat handler over existing exhaustive switch; list actions lost ~10-line inline block each for a one-line call). Modern idioms (generic mapCloneFailure<string>, exhaustive dispatch, spread stripConstraint). Readability good (distinct success-path stripConstraint stays local to change-version).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [idea] src/commands/update.ts:207 vs list-update-action.ts:45 / list-change-version-action.ts:96 — the three prepareReinstall not-ok messages are near-identical but inconsistent (list actions no period, runSinglePluginUpdate appends a period). Correctly scoped out (different channels: returned-result vs p.log.error), but the literal is triplicated and prepareReinstall already returns a structured reason all three discard. Follow-up could centralise the not-found sentence or surface prepared.reason. Requires a decision on unifying period + channel, hence idea.
