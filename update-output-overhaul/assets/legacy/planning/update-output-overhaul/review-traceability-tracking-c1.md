---
status: complete
created: 2026-07-21
cycle: 1
phase: Traceability Review
topic: Update Output Overhaul
---

# Review Tracking: Update Output Overhaul - Traceability

## Result

**CLEAN** — no findings. The plan is a faithful, complete, bidirectional translation of the
specification. Every specification decision, edge case, constraint, and all ten *Testing &
Acceptance* criteria map to one or more tasks with implementer-level depth; and every task's
content traces back to a specific specification section. No missing spec content, no
hallucinated plan content, no misattributed or contradictory traceability.

## Findings

None.

---

## Evidence

### Direction 1 — Specification → Plan (completeness)

Every spec section maps to plan coverage:

| Spec section / decision | Plan coverage |
|---|---|
| Overview — three interlocking parts | Phase 1+2 (part 1), Phase 3 (part 2), Phase 4 (part 3) |
| Scope Boundary — new build vs reword/verify; seam-first build order; human-only output | Phase framing + each phase "Why this order"; human-only is informational (no `--json` contract to preserve) — no task required |
| Per-Repo Clone Dedup → Grouping key (`constraint ?? ref`, namespaced, `deriveCloneUrlFromKey`, local excluded, HEAD sentinel, distinct-intent split, effective-ref clone) | Task 1-1 (grouping), Task 1-2 (`newRef` override), Task 1-4 (`effectiveRef`) |
| Group-first pipeline — resolve/check once per group; commit-level + category-level race closure; probe dedup; pre-resolution key | Task 1-3 (`resolveGroupTarget` + `categorizeMember`), Task 1-5 (wire) |
| Genuine-state splits are intended | Task 1-3 |
| Grouping covers whole manifest, before checking | Task 1-1, Task 1-5 |
| Rejected alternative (clone-once-checkout-per-member) | Informational — no task required |
| Clone ownership seam — `cloneRepoOnce` + orchestrator, per-member `sourceSubpath` guard, rejected 4-way unify | Task 1-2, Task 1-4, Task 1-5 (rejected-unify context) |
| Left to the implementer (PluginOutcome mapping; ref threading) | Noted as mechanics in Task 1-4, Task 3-1/3-2 |
| Failure isolation & lifecycle — clone-fatal, check-fatal, per-member reinstall, sequential lifecycle, copy-safety boundary, interrupt-noted | Task 1-4 (lifecycle/isolation/boundary), Task 1-6 (remove-vs-intact), Task 1-7 (clone-fatal model), Task 1-8 (check-fatal model), Task 2-3/2-6 (rendering) |
| Per-Unit Progress → Progress granularities (group header + per-member + group-of-one) | Task 2-2, Task 2-3, Task 2-4 |
| Local entries | Task 1-5 (reinstall), Task 2-4 (Refreshed line) |
| Version move & dropped-agents placement (header move, shared-vs-divergent old, member parenthetical, dropped-agents notice, group-of-one) | Task 2-2, Task 2-3 |
| Failed & skipped member lines (success/copy-failed/aborted/blocked/no-agents) | Task 2-3 |
| Outcome timing — two phases, per-group spinner, no per-member tick, end-of-run loop for non-actioned only | Task 2-4 |
| Per-group manifest persistence before streaming | Task 1-6 (persistence), Task 2-4 (✓-after-write) |
| Partial collections & counts — per-group collapse across all trailing categories; Group label; collapsed formats; group-of-one; generic count/noun | Task 2-1 (label), Task 2-2 (count/noun), Task 2-5 (trailing collapse), Task 2-6 (clone-fail enumerate), Task 2-7 (footer) |
| Clone-failure rendering (one enumerated line) | Task 2-6 |
| Tag-Based Summary Wording — tags-where-tagged vs hash; ref sourcing; both surfaces | Task 3-1 (shared rule + grouped surface), Task 3-2 (single-key + all-mode `summary.ts`) |
| Safe-vs-Major Gating → Audit (no gating change) | Reflected in Task 4-1 ("no resolver/gating change") |
| Blocking message — passive→actionable, tone, post-bump current, mode-matched re-add, per-group footer collapse | Task 2-7 (structure), Task 4-1 (wording/caret), Task 4-2 (exact-pin) |
| 0.x-line + exact-pin edge cases — 0.x gated by caret; all-mode `newer-tags` command consistency fix; command granularity | Task 2-5 (build command), Task 4-1 (0.x-minor gate), Task 4-2 (regression-lock) |
| Exit-code posture — single-key vs all-mode (ratified) | Task 1-8 (all-mode check-failed model), Task 4-3 (full matrix lock) |
| Testing scope — regression + grouped/dedup coverage | Distributed: Tasks 1-2/1-5 (regression), 1-1/1-3/1-4/1-6/1-7/2-5/2-6 (new grouped coverage) |

### Ten Acceptance Criteria — explicit mapping

1. Multi-member collection clones once + one check; constrained group stays single after singly-updated member → **Tasks 1-1, 1-3, 1-4, 1-5** (Phase 1 acceptance).
2. Each updated member streams `✓ member → agents` under group header with version move; standalone collapses → **Tasks 2-2, 2-3, 2-4** (Phase 2 acceptance).
3. Version move in tags only when both refs tags and moved, else hashes, on both surfaces → **Tasks 3-1, 3-2** (Phase 3 acceptance).
4. Actioned stream inline; non-actioned + footer trailing, one line per group → **Tasks 2-4, 2-5, 2-7** (Phase 2 acceptance).
5. Manifest persisted per group before ✓; interrupt matches disk at group boundaries → **Tasks 1-6, 2-4** (Phase 1 + 2 acceptance).
6. Clone failure fails all N per-key, one grouped line, removes no entries, non-zero exit → **Tasks 1-7 (model), 2-6 (render)**.
7. Per-member reinstall failure isolated; siblings continue; clone cleaned once; own `✗`/`⚠` line → **Tasks 1-4, 1-6, 2-3**.
8. Out-of-constraint one actionable mode-matched line per group naming post-bump current + newest; re-add preserves pinning; exit 0 → **Tasks 4-1 (wording), 2-7 (structure)**.
9. All-mode `newer-tags` line includes `agntc add` command, matching single-key → **Tasks 2-5 (build), 4-2 (verify)**.
10. Exit-code posture unchanged (single-key exits 1; all-mode warns/exits 0; only aborted/blocked/failed/copy-failed trip non-zero) → **Tasks 4-3 (lock), 1-8 (all-mode check-failed)**.

### Direction 2 — Plan → Specification (fidelity / anti-hallucination)

Every task traces to a spec section. Implementation-mechanics that are not literal spec text
were each checked and found to be spec-sanctioned rather than invented:

- `GroupTarget` discriminated union (Task 1-3), `EntryGroup` interface (Task 1-1),
  `processGroupUpdate` `{ cloneFailed }` additive return (Task 2-6), `groupLabel`/`repoOf`
  helpers (Task 2-1) — factorings of spec categories/decisions, covered by
  *Left to the implementer (behaviourally invariant)*.
- `c:`/`r:` key prefixes and ` HEAD` / `@HEAD` sentinels — implement the spec's explicit
  "namespaced so a caret string can never coincidentally key-collide with a tag ref."
- ` -> ` ASCII arrow (vs spec's illustrative `→`) — deliberately reconciled in Task 3-1
  as reword-of-tokens-not-arrow, preserving today's renderers.
- "removed by plugin author" (vs spec prose "removed by author") — Task 2-3 reuses the
  canonical `formatDroppedAgentsSuffix` phrase the spec itself references, avoiding an
  unlegislated wording change.
- `"unknown"` null-old-commit fallback (Task 3-2), never-downgrade guard
  `isAtOrAboveVersion` (Task 1-5), "All plugins are up to date." short-circuit (Task 2-5) —
  preservation of existing behaviour, in-scope under *Scope Boundary* "reword/verify over
  existing behaviour ... No new logic."

No contradictions found. The two intentional structure-vs-wording cross-phase splits
(all-mode `newer-tags` build in Task 2-5 / verify in Task 4-2; out-of-constraint footer
structure in Task 2-7 / actionable wording in Task 4-1) are honoured as designed and were
not flagged as gaps.

### Cross-cutting note (non-finding)

The naming-and-identity cross-cutting decision (`npx agntc add owner/repo`) is correctly
applied and cited in Tasks 2-5, 4-1, and 4-2 (with the naming spec named in their Spec
Reference fields). Its content is fully traced; the absence of a dedicated top-level
"Cross-Cutting References" section in `planning.md` is a plan-structure/presentation matter
outside the content-traceability lens and is recorded here only for awareness, not as a
traceability finding.
