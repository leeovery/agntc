TASK: configless-install-analysis-2-4 — Extract isCloneReinstallFailure type-guard for the four-site non-success guard; define the failure-set once beside mapCloneFailure and use it at all four reinstall sites; behaviour unchanged. (Converged note: guard must also cover the later-added 'blocked' variant.)

ACCEPTANCE CRITERIA: failure-set defined once co-located with mapCloneFailure; all four reinstall entry points use isCloneReinstallFailure; behaviour unchanged; npm test passes.

STATUS: Complete

SPEC CONTEXT: Four failure-set members map to spec outcomes: aborted (458 — derive-before-delete, install intact, reported aborted); blocked (377,393,454 — symlink-escape pre-flight, install intact); no-agents (21,141 — lenient skip, not hard error, no forced non-zero); failed (clone/copy/unknown). Consolidation is structural, preserves spec's "exit non-zero if any hard-errored or aborted" posture (466) at call sites.

IMPLEMENTATION: Implemented (converged incl blocked extension).
- Guard + co-located union: src/clone-reinstall.ts:111-115 (CloneReinstallFailure union), :140-149 (isCloneReinstallFailure), :151-172 (mapCloneFailure) — all adjacent (co-location).
- Sites: update.ts:213 (single), update.ts:309 (all), list-update-action.ts:51, list-change-version-action.ts:102.
- Guard covers full current set failed|aborted|blocked|no-agents (143-148), reflecting blocked from analysis-3-1 (NOTE satisfied). Single union consumed by guard (narrows to it) + mapCloneFailure (accepts it). New status = single-site change (extend union + guard term + mapper arm). At each site mapCloneFailure called inside if(isCloneReinstallFailure(result)) so narrowed type flows in, no cast.
- Behaviour unchanged per-site: site 1 richer per-status handlers (warn+exit-0 no-agents, error+exit-1 rest); site 2 PluginOutcome objects; sites 3/4 delegate failureMessage. No stray inline 3-term guards remain. Other status=== checks at update.ts:585-628 operate on separate PluginOutcome union (summary + hasFailedOutcome), correctly untouched.

TESTS: Adequate. tests/clone-reinstall.test.ts:1158-1222 dedicated isCloneReinstallFailure block: true for failed/no-agents/aborted/blocked (1159-1192); false for success (1194-1202); type-level narrowing test confirming post-guard value satisfies mapCloneFailure param + dispatches (1204-1221). Four call sites' failure-path behaviours covered by existing update/list-update/list-change-version suites (unchanged). Each status assertion distinct; narrowing test verifies behaviour not internals. Not over/under-tested.

CODE QUALITY: Conventions followed (idiomatic user-defined type guard result is CloneReinstallFailure; guard+union+mapper clean dispatch surface). SOLID good (single source of truth — open/closed; guard + mapper share one union, eliminates four-way duplication). Complexity low (flat 4-term disjunction). Modern idioms (type predicate, exhaustive switch on failureReason no default → compile error on new reason). Readability good (co-located doc comments state single-site-change rationale + narrowing contract).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [do-now] src/clone-reinstall.ts:126-133 — stale orphan doc comment ("Routes a non-success clone-reinstall result…") sits between CloneReinstallFailure and isCloneReinstallFailure but documents mapCloneFailure (which has its own comment below), so it visually attaches to the wrong symbol. Remove the duplicate block. (Same orphan flagged by analysis-1-6 review.)
