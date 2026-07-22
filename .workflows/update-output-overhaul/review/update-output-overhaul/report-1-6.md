TASK: update-output-overhaul-1-6 — Per-group manifest persistence with per-member remove-vs-intact semantics

ACCEPTANCE CRITERIA:
1. Two updatable groups each trigger one writeManifest call (N groups → N writes); a group with no successful/removed member triggers no write.
2. A member's copy-failed calls removeEntry for that key; the resulting written manifest omits it.
3. aborted, blocked, skipped-no-agents, up-to-date, newer-tags, and constrained-no-match members are never added or removed — their entries persist as-is across all writes.
4. After a group whose write completes, that group's updated entries are present in every subsequent write; a group processed later that never ran contributes nothing until it runs.
5. hasFailedOutcome(outcomes) still returns true when any copy-failed/aborted/blocked/failed outcome exists (non-zero exit preserved).

STATUS: Complete

SPEC CONTEXT:
Spec "Per-Unit Progress Output → Per-group manifest persistence before streaming": the manifest was written once at end-of-run; group-first inverts the ✓/write order, so persistence must move to per-group (write right before that group's ✓ streams) to keep the ✓ honest and leave the manifest matching disk at GROUP boundaries on interrupt (mid-member SIGINT gap explicitly out of scope). Per-member remove-vs-intact is verbatim today's isolation: only copy-failed removes an entry; aborted/blocked/no-agents/non-actioned leave it intact. outcomes[] still collected for hasFailedOutcome; what changes is WHEN the manifest persists. Local group-of-ones are their own persistence units. This task moves only persistence timing (the visible ✓ streaming is Phase 2).

IMPLEMENTATION:
- Status: Implemented
- Location:
  - src/commands/update.ts:926-953 (persistUnitOutcomes) — the per-unit fold+write boundary. Iterates a unit's PluginOutcome[]; isSuccessOutcome → addEntry; copy-failed → removeEntry; everything else no-op. Writes once iff mutated; returns the (possibly-updated) manifest for cumulative threading.
  - src/commands/update.ts:622-639 (streamActionedWork) — threads workingManifest = {...manifest} through each unit sequentially, so each write reflects all prior mutations (matching disk at group boundaries).
  - src/commands/update.ts:707-711 (streamGroupWork) — persists a group's outcomes BEFORE emitting any member line/stop-frame (✓ honesty).
  - src/commands/update.ts:817-819 (streamLocalWork) — same per-local-entry write via persistUnitOutcomes([outcome]).
  - src/commands/update.ts:1015-1023 (hasFailedOutcome) — unchanged membership (aborted/blocked/failed/copy-failed); fed by outcomes accumulated in streamActionedWork + non-actioned push at :430-433.
- Notes: The old single end-of-run build/write (former update.ts:506-530) is fully removed — no residual end-of-run write remains. The fold correctly handles a within-group mix (copy-failed member removed + updated sibling added collapsed into ONE write). Clone-fatal groups produce only `failed` outcomes → no mutation → no write, matching the "clone-failed removes no entries" rule. Threading is immutable-style (each unit returns a fresh manifest), so a non-mutating unit passes the manifest through unchanged. All five acceptance criteria are satisfied.

TESTS:
- Status: Adequate
- Coverage: The five prescribed tests exist in the "per-group manifest persistence (task 1-6)" block (tests/commands/update.test.ts:956-1291):
  - :957 two groups → two writes; final write cumulative (AC1).
  - :1008 copy-failed member removed + sibling persisted in one group write; second group its own write; exit 1 (AC2, AC1).
  - :1068 aborted/blocked/no-agents/up-to-date → no addEntry/removeEntry/writeManifest at all (AC3, AC1 "no mutation → no write").
  - :1159 distinct resolved commits; first write shows B still pre-run, second write carries A's prior update (AC4 both directions).
  - :1210 copy-failed/aborted/blocked all trip ExitSignal(1); copy-failed removal persisted (AC5).
  - Supporting coverage reinforces the boundary without redundancy: :1659 persistence-before-stream ordering (write precedes its own stop-frame, and A's frame precedes B's write); :637-640 git group + local group-of-one persist independently → two writes; :3553/:4053 clone-fatal group writes nothing while sibling group persists; :3957/:4005 cross-group aborted/blocked leave their entry intact (removeEntry not called) while sibling persists; :4102 copy-failed entry removed while siblings persist.
  - Mocks are behaviour-faithful: mockAddEntry/mockRemoveEntry carry real spread/omit implementations (:223-230) and mockWriteManifest captures the exact manifest snapshot per call, so cumulative-threading assertions read genuine state rather than call counts alone.
- Notes: Would fail if the feature broke — e.g. reverting to a single end-of-run write breaks the N-writes and per-write-snapshot assertions; dropping the copy-failed removeEntry breaks :1008/:1210; mutating an intact category breaks :1068. Not over-tested: each test targets a distinct acceptance criterion; assertions are observable (write counts, per-write manifest snapshots, exit code) rather than implementation-internal.

CODE QUALITY:
- Project conventions: Followed. Immutable manifest updates via addEntry/removeEntry (returning new objects), consistent with manifest.ts. Discriminated PluginOutcome union narrowed through the shared isSuccessOutcome guard rather than ad-hoc status string checks.
- SOLID principles: Good. persistUnitOutcomes is a single-responsibility helper shared by both the group and local persistence sites (DRY), keeping the remove-vs-intact rule in exactly one place. Threading is explicit (in → out), no hidden shared mutable state.
- Complexity: Low. persistUnitOutcomes is a linear fold with a single mutated flag; streamActionedWork is a simple sequential reduce over work items.
- Modern idioms: Yes. Object rest for removeEntry, spread for addEntry, async/await, exhaustive union narrowing.
- Readability: Good. The persistUnitOutcomes docblock states the verbatim-today remove-vs-intact rule and the skip-if-no-op write; streamActionedWork documents the cumulative-threading intent.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [quickfix] tests/commands/update.test.ts:1068 — add (or extend an existing) test asserting an aborted (or blocked) member sharing ONE group with an updated sibling has its entry preserved in that group's single write. The within-group non-mutating-member survival under a triggered write is currently only proven cross-group (:3957/:4005) and for copy-failed within-group (:1008); the aborted-intact-during-a-write path is guaranteed by the workingManifest threading but not directly asserted.
