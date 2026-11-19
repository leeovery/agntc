TASK: update-output-overhaul-6-2 — Consolidate PluginOutcome failure/success outcome handling into co-located helpers (failedOutcome, isSuccessOutcome)

ACCEPTANCE CRITERIA:
- The `failed` outcome literal and its "<key>: Failed — <message>" wording exist in exactly one place; all six former sites call failedOutcome.
- The `updated | refreshed` success set exists in exactly one place; all five former sites call isSuccessOutcome, and newEntry-reading sites narrow through the guard.
- No behavioural change: identical outcome shapes and identical summary strings as before.
- member.key-vs-key drift closed.
- Typecheck clean; full suite passes.
- Unit test locks the failedOutcome literal against drift.

STATUS: Complete

SPEC CONTEXT: Phase 6 (Analysis Cycle 2) is dead-code / duplication consolidation over the group-first update engine built in Phases 1-4. This task removes two hand-inlined duplication classes in the all-mode update path: the six-site `failed` PluginOutcome literal and the five-site `updated || refreshed` success predicate. The spec's grouped outcome model (one PluginOutcome per attempted member, driving hasFailedOutcome exit accounting and per-group manifest persistence) is behaviour-frozen; this is a pure behaviour-preserving refactor.

IMPLEMENTATION:
- Status: Implemented (correct)
- Location:
  - src/update-groups.ts:133-135 — failedOutcome(key, message): the SINGLE `failed` literal constructor with the "<key>: Failed — <message>" wording, co-located with the PluginOutcome type (line 98).
  - src/update-groups.ts:144-148 — isSuccessOutcome type guard narrowing to Extract<PluginOutcome, { status: "updated" | "refreshed" }>.
  - Six failed-literal sites all route through failedOutcome: src/commands/update.ts:321 (prepareReinstall-not-ok), :329 (processLocalUpdate outer catch); src/update-groups.ts:189 (onCloneFailed arm), :190 (onUnknown arm), :353 (reinstallMember catch), :406 (clone-fatal fan-out, passing member.key).
  - isSuccessOutcome call sites: src/commands/update.ts:791 (collapsedMemberLine), :833 (streamCollapsedOutcome), :896 (emitMemberLine — narrows to read outcome.newEntry.agents + droppedAgents), :935 (persistUnitOutcomes — narrows to read outcome.newEntry).
- Notes: The task narrative cites five inline success predicates; the 6-2 commit (fff2518) converted all five, including a fifth at renderOutcomeSummary. Only four isSuccessOutcome calls remain today because task 8-1 (438855e) later trimmed renderOutcomeSummary to its sole reachable `failed` case, legitimately removing its success branch. This is correct downstream evolution, not a 6-2 defect. All conversions in the 6-2 commit are verified against the diff. The member.key-vs-key drift is structurally closed: every call site passes exactly one key value, and failedOutcome uses that single value for both the `key` field and the summary prefix, so prefix and body can no longer diverge. The residual `status: "failed"` at src/update-groups.ts:333 is a CloneReinstallResult input literal (carries failureReason/message), a different type that then routes through failedOutcome via the onCloneFailed arm — correctly untouched. add.ts:766/853 `status: "failed"` belong to the separate install-path outcome type, out of scope. No inline `updated || refreshed` predicates remain in src/.

TESTS:
- Status: Adequate
- Coverage:
  - tests/update-groups.test.ts:112-120 — failedOutcome produces the exact `{ status, key, summary: "<key>: Failed — <message>" }` literal (toEqual on the full shape). This is the drift-guard the task requires, hard-coding the wording independent of the helper.
  - tests/update-groups.test.ts:122-161 — isSuccessOutcome: true for updated + refreshed with narrowing verified (reads .newEntry inside the guard); false for the complete set of nine non-success statuses.
  - Behaviour lock preserved by pre-existing integration assertions on the "<key>: Failed —" wording: tests/commands/update.test.ts:3645, :6887, :6948, :6980, :7010; tests/update-groups.test.ts:1004; tests/shared-containment-guard.test.ts:97.
- Notes: Focused, not over-tested — three added tests, each verifying a distinct contract (literal wording, success narrowing, complete false set) with no redundant assertions or excess mocking. The isSuccessOutcome false-case loop attaches an inert `summary` field to statuses whose real variant lacks it; harmless (the predicate is a runtime status check) and keeps the loop object uniform.

CODE QUALITY:
- Project conventions: Followed. Helpers co-located with the PluginOutcome type per the task; JSDoc density matches the file's house style; idiomatic Extract<> discriminated-union narrowing (typescript-advanced-types).
- SOLID principles: Good — each helper is single-responsibility; the guard centralizes the success-set definition (open/closed for a future success variant).
- Complexity: Low — literal extraction and a two-clause predicate.
- Modern idioms: Yes — `outcome is Extract<...>` type-guard replaces the prior `&& "newEntry" in outcome` runtime narrowing at persistUnitOutcomes, cleaner and cast-free.
- Readability: Good — self-documenting names, accurate JSDoc enumerating all failure origins.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [idea] src/update-groups.ts:133 — failedOutcome returns the broad `PluginOutcome`; it could return `Extract<PluginOutcome, { status: "failed" }>` for symmetry with isSuccessOutcome's narrowing and more precise call-site typing. No caller needs it today and the broad return is consistent with sibling constructor mapReinstallResultToOutcome, so this is a consistency-vs-precision judgment call, not a defect.
