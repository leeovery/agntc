TASK: 2-7 — Collapse the out-of-constraint footer to one line per group (structure only)

ACCEPTANCE CRITERIA:
- A constrained N-member collection with an out-of-constraint version renders exactly one footer line (keyed by the group), not N.
- Two distinct-intent groups of one repo (@^1.2.3 and @^2.0.0) render two separate footer lines, @intent-disambiguated by groupLabel.
- The footer line format is preserved verbatim (task 2-7 interim: passive `<latestOverall> available (constraint: <constraint>)`).
- Exit stays 0 for an out-of-constraint situation (does not feed hasFailedOutcome).
- The single-key path (renderOutOfConstraintSection with key only, no label) renders byte-identically to today.

STATUS: Complete

SPEC CONTEXT: Spec "Safe-vs-Major Bump Gating / Blocking message" — the out-of-constraint footer collapses per group, not per member, keyed by the grouping key (resolvedCloneUrl, versionIntent) using the shared Group label, so a major-available N-member collection collapses from N near-identical lines to one, while two distinct-intent groups of one repo keep separate current->newer pairs. Tone is informative opt-in (exit 0, not an error). Task 2-7 was explicitly the STRUCTURAL step ("preserve today's passive wording verbatim"), with the Phase boundary note that Phase 4 would reword the footer to the actionable, mode-matched, post-bump message. The repo being reviewed is at the "complete implementation" commit, so Phase 4's reword is present on top of 2-7's collapse.

IMPLEMENTATION:
- Status: Implemented (structural deliverable intact; interim wording legitimately superseded by Phase 4)
- Location:
  - src/commands/update.ts:519-537 (groupOutOfConstraintInfo) — builds ONE OutOfConstraintInfo per group when target.kind === "constrained" && target.latestOverall !== null; label = groupLabel(group, groups), repo = repoOf(group) (bare owner/repo), current = target.tag.
  - src/commands/update.ts:461-473 — called once per group in categorizeGroups; pushes at most one info per group into outOfConstraintInfo (never per member).
  - src/commands/update.ts:116-144 (extractOutOfConstraint) — single-key path sets `key` only (no label), preserving the label ?? key fallback.
  - src/summary.ts:310-359 — OutOfConstraintInfo carries optional key?/label?; renderOutOfConstraintSection renders `info.label ?? info.key`.
  - src/commands/update.ts:435, 419, 1025-1030 (renderOutOfConstraintOutput) — emitted via p.log.info, entirely separate from the outcomes[] array that gates exit.
- Notes:
  - The group-level guard `target.kind === "constrained" && target.latestOverall !== null` is the correct group equivalent of hasOutOfConstraintVersion (update-check.ts:27-35), which is defined on the per-member UpdateCheckResult (latestOverall !== null iff out of constraint). A constrained GroupTarget maps to constrained-up-to-date/constrained-update-available per member, all sharing the same latestOverall, so one group-level check is exact.
  - `current = target.tag` unifies both member sub-cases cleanly: a constrained-up-to-date member has entry.ref === target.tag (categorizeMember, update-check.ts:179), and a bumped member lands on target.tag — so the single collapsed line's post-bump current is correct for every member, and stays consistent with the single-key path's `checkResult.status === "constrained-update-available" ? checkResult.tag : entry.ref!`.
  - Interim-vs-final wording: task 2-7's acceptance criteria 3 and 5 asked for the passive `<latestOverall> available (constraint: <constraint>)` verbatim and NO re-add command. The final code carries Phase 4's actionable `<current> -> <latestOverall> available. To upgrade: npx agntc add <repo>`. This is the EXPECTED end state (2-7 itself declared Phase 4 would reword it); the OutOfConstraintInfo.constraint field was dropped and current/repo added by Phase 4. No stale `(constraint: ...)` residue remains anywhere (verified).

TESTS:
- Status: Adequate
- Coverage:
  - tests/commands/update.test.ts:6580 — "renders one footer line per group for a constrained N-member collection (not N lines)": a 3-member collection yields exactly one `To upgrade` line (AC1).
  - tests/commands/update.test.ts:6607 — "a multi-group repo renders two @intent-prefixed footer lines": ^1.2.3 and ^2.0.0 groups of one repo each get their own @intent-disambiguated prefix, bare command, length === 2 (AC2).
  - tests/commands/update.test.ts:6656 — exact two-line assertion pinning the collapsed all-mode footer and asserting no `available (constraint` tail survives.
  - tests/commands/update.test.ts:6683 — "keeps the all-mode (and single-key) exit at 0": runUpdate() and runUpdate("owner/repo") both resolve undefined (AC4).
  - Single-key regression: tests/commands/update.test.ts:6423, 6497, 6461, 6545 cover key-only current (post-bump landed tag vs entry.ref) and omission when in-constraint.
  - tests/summary-out-of-constraint.test.ts:7-106 — pure renderer: label ?? key fallback (single-key regression, AC5), multi-group prefix-vs-bare-command, one-line-per-info collapse preserved, informative tone (no ! / warning).
- Notes:
  - The pure-renderer suite is focused (6 tests, each a distinct behavior) — not bloated, not under-tested.
  - Both AC1 (collapse to one) and AC2 (two @intent lines) are asserted with explicit length checks, so a regression to per-member lines would fail loudly.
  - Interim passive-wording tests named in the plan ("preserves the passive footer wording verbatim") were correctly replaced by the Phase 4 actionable-wording tests — appropriate given the final code, not a coverage gap.
  - tests/summary.test.ts carries no OOC assertions (all footer coverage is in the dedicated file) — fine.

CODE QUALITY:
- Project conventions: Followed. Discriminated GroupTarget narrowing, `!` only where an invariant is documented (versionIntent! on constrained, entry.ref! comments), heavy intent-carrying comments consistent with the module.
- SOLID principles: Good. groupOutOfConstraintInfo is a single-purpose pure builder; renderOutOfConstraintSection is a single-purpose pure formatter with the label ?? key fallback isolating the two callers.
- Complexity: Low. One guard + one object literal in the builder; one loop in the renderer.
- Modern idioms: Yes. `label ?? key`, discriminated-union narrowing.
- Readability: Good. Field-level doc comments on OutOfConstraintInfo explain label vs key precedence, post-bump current, and bare-repo command rationale.
- Issues: None in task 2-7's structural scope.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [bug] src/commands/update.ts:519-537 — groupOutOfConstraintInfo is built during the check phase and unconditionally reports `current: target.tag` for the collapsed line, but on a group clone failure a behind (constrained-update-available) member never lands on target.tag. The footer then claims a post-bump current the run did not reach, contradicting OutOfConstraintInfo.current's documented "the tag this run actually landed on" (summary.ts:326-331). Extreme edge (constrained group at a caret boundary, a behind member, whose single clone fails) and this `current` field is Phase 4's, not 2-7's structural collapse — out of this task's scope, noted for the Phase 4 owner. Concrete change: derive the collapsed footer's `current` from the group's actual post-run landed ref (or fall back to the pre-bump ref on clone-failure) rather than the aspirational target.tag.
