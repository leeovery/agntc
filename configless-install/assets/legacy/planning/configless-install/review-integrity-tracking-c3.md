---
status: complete
created: 2026-06-06
cycle: 3
phase: Plan Integrity Review
topic: Configless Install
---

# Review Tracking: Configless Install - Integrity

## Summary

Cycle 3 re-reviews the plan after the cycle-3 traceability fix that reclassified a top-level/standalone (and subpath) not-agntc source from a silent exit-0 to a loud non-zero pre-flight failure (`ExitSignal(1)`, source-named `p.cancel`) in tasks 2-1, 2-3, and the Phase 2 acceptance. The authoritative implementation surfaces of that fix are correctly and consistently applied:

- **Task 2-1** "Do" (the not-agntc branch), Outcome, the not-agntc Acceptance Criterion, the two not-agntc Tests lines, and Edge Cases all now state `ExitSignal(1)` / loud source-named `p.cancel`.
- **Task 2-3** Outcome, the subpath-not-agntc Acceptance Criterion, the not-agntc Test line, and Edge Cases all now state `ExitSignal(1)`.
- **Phase 2 acceptance** (planning.md line 48) states the not-agntc source "fails pre-flight loudly (source-named `p.cancel`, non-zero exit)."

The change is also correctly scoped: the `ExitSignal(0)` references that remain in the plan (phase-2-tasks.md lines 18, 26; phase-3-tasks.md lines 20, 37) all describe **legacy code being removed** (the old `config === null` block, the duplicate standalone collection guard, the `pluginConfigs.size === 0` gate) — not the new not-agntc behaviour. Those are correct and were not flagged.

**Task 3-4's collection-member not-agntc skip remains correctly distinct.** A member re-detecting as `not-agntc` is warned (`"<member>: not a valid agntc plugin — skipping"`), pushed as a `skipped` result, and its siblings continue installing — it is **not** a hard non-zero exit. Task 2-1's "Do" explicitly carves this out ("The collection-**member** not-agntc *skip* — warned, siblings continue — is unchanged and owned by task 3-4; this change is the top-level/standalone source only"). No collision or contradiction was introduced between the new loud standalone not-agntc failure and the per-member silent skip. This distinction is sound and intact.

One finding: the cycle-3 fix updated the authoritative surfaces but left **three stale recap-prose surfaces** still describing the old exit-0 behaviour ("exits cleanly" / "exits 0"). One of these (phase-2-tasks.md line 142) is inside task 2-3's authoritative "Do" instructions and directly contradicts the same task's Outcome, Acceptance Criterion, and Edge Cases.

## Findings

### 1. Three stale surfaces still describe the not-agntc path as exit-0 ("exits cleanly" / "exits 0"), contradicting the cycle-3-pinned `ExitSignal(1)`

**Severity**: Important
**Plan Reference**: phase-2-tasks.md task configless-install-2-3 "Do" (the direct-path routing bullet); planning.md task 2-1 Edge Cases column; planning.md task 2-3 Edge Cases column
**Category**: Internal consistency / Acceptance Criteria Quality (a task's authoritative "Do" step contradicting its own Outcome/Acceptance/Edge Cases; planning task-table Edge Cases contradicting the corrected acceptance)
**Change Type**: update-task

**Details**:
The cycle-3 traceability fix reclassified a standalone/subpath not-agntc source to `ExitSignal(1)` and applied it to every authoritative surface of tasks 2-1 and 2-3 (Do branch, Outcome, Acceptance Criteria, Tests, Edge Cases) and to the Phase 2 acceptance. Three recap surfaces were missed and still describe the *old* exit-0 behaviour:

1. **phase-2-tasks.md line 142 (task 2-3, "Do")** — the direct-path routing bullet still says `` `not-agntc` exits 0 ``. This is the most serious of the three because it sits inside task 2-3's authoritative implementation instructions and directly contradicts the same task's own Outcome (line 138: "exits **non-zero** (`ExitSignal(1)`)"), its Acceptance Criterion (line 155: "exits **non-zero** (`ExitSignal(1)`)"), its Test (line 168: "exits non-zero"), and its Edge Cases (line 177: "non-zero exit (`ExitSignal(1)`)"). An implementer reading the "Do" linearly could write `ExitSignal(0)` for the subpath not-agntc case, reintroducing exactly the silent no-op the fix removed — then have it contradicted three more times in the same task. This is an internally inconsistent task.

2. **planning.md line 59 (task 2-1 Edge Cases column)** — "not-agntc exits cleanly". The planning task table is the plan-level recap of each task's edge cases; "exits cleanly" connotes the silent exit-0 the fix removed. It contradicts the corrected Phase 2 acceptance bullet (planning.md line 48: "a not-agntc source fails pre-flight loudly (source-named `p.cancel`, non-zero exit)") and task 2-1's body.

3. **planning.md line 61 (task 2-3 Edge Cases column)** — "subpath unit that is not-agntc exits cleanly". Same issue for the subpath case; contradicts task 2-3's body (`ExitSignal(1)`) and the Phase 2 acceptance.

All three are recap/edge-case framing rather than the primary contract, but #1 is inside an authoritative "Do" step and is a genuine same-task contradiction; #2 and #3 are the plan-level edge-case summaries that should match the corrected acceptance. The fix is to restate all three as the loud non-zero pre-flight failure.

**Current** (phase-2-tasks.md, task configless-install-2-3, "Do" — the direct-path routing bullet):

> - Route a `direct-path` source through the **standalone** branch, not the collection pipeline: with detection now run against `unitDir`, a tree URL targeting a single unit resolves to `bare-skill`/`plugin`/`collection`/`not-agntc` *for that subpath*. The standalone install (tasks 2-1) handles `bare-skill`/`plugin`; `not-agntc` exits 0; a `collection` at the subpath would dispatch to `runCollectionPipeline` (a tree URL can legitimately point at a nested collection dir — but nested-collection *membership* recursion is Phase 3; here, simply route it to the existing pipeline with `sourceDir: unitDir` and let Phase 3 own deeper semantics). The key point: **detection is against the subpath, and the manifest key is `parsed.manifestKey` = `owner/repo/<subpath>`** (already produced by `parseDirectPath`).

**Proposed** (phase-2-tasks.md, task configless-install-2-3, "Do" — the direct-path routing bullet):

> - Route a `direct-path` source through the **standalone** branch, not the collection pipeline: with detection now run against `unitDir`, a tree URL targeting a single unit resolves to `bare-skill`/`plugin`/`collection`/`not-agntc` *for that subpath*. The standalone install (tasks 2-1) handles `bare-skill`/`plugin`; `not-agntc` fails pre-flight loudly via the shared task 2-1 handling (source-named `p.cancel`, `ExitSignal(1)` — **not** a silent exit-0); a `collection` at the subpath would dispatch to `runCollectionPipeline` (a tree URL can legitimately point at a nested collection dir — but nested-collection *membership* recursion is Phase 3; here, simply route it to the existing pipeline with `sourceDir: unitDir` and let Phase 3 own deeper semantics). The key point: **detection is against the subpath, and the manifest key is `parsed.manifestKey` = `owner/repo/<subpath>`** (already produced by `parseDirectPath`).

**Current** (planning.md, `#### Tasks` table under Phase 2, task `configless-install-2-1` row — Edge Cases cell):

> | configless-install-2-1 | Configless standalone detect-and-install wiring | null config bare skill (refero_skill shape), null config multi-asset plugin, config-bearing standalone unchanged, detected collection still dispatches, not-agntc exits cleanly, dead ConfigError catch removed, agents sourced from config?.agents ?? [] |

**Proposed** (planning.md, `#### Tasks` table under Phase 2, task `configless-install-2-1` row — Edge Cases cell):

> | configless-install-2-1 | Configless standalone detect-and-install wiring | null config bare skill (refero_skill shape), null config multi-asset plugin, config-bearing standalone unchanged, detected collection still dispatches, not-agntc fails pre-flight loudly (source-named p.cancel, ExitSignal(1)), dead ConfigError catch removed, agents sourced from config?.agents ?? [] |

**Current** (planning.md, `#### Tasks` table under Phase 2, task `configless-install-2-3` row — Edge Cases cell):

> | configless-install-2-3 | Tree-path subpath as standalone unit selector | tree URL installs unit at subpath keyed owner/repo/<subpath>, identity = subpath basename folder, @-suffix on tree URL rejected, --plugin orthogonal to selector on skills-only subpath, subpath unit that is not-agntc exits cleanly |

**Proposed** (planning.md, `#### Tasks` table under Phase 2, task `configless-install-2-3` row — Edge Cases cell):

> | configless-install-2-3 | Tree-path subpath as standalone unit selector | tree URL installs unit at subpath keyed owner/repo/<subpath>, identity = subpath basename folder, @-suffix on tree URL rejected, --plugin orthogonal to selector on skills-only subpath, subpath unit that is not-agntc fails pre-flight loudly (source-named p.cancel, ExitSignal(1)) |

**Resolution**: Fixed
**Notes**: Applied all three edits — phase-2-tasks.md task 2-3 "Do" routing bullet (now states the shared loud `ExitSignal(1)` handling), and the two planning.md Phase 2 task-table Edge Cases cells (2-1 and 2-3). The mirroring tick tasks (tick-e6e0d2, tick-f8f897) were already synced in cycle 3's traceability pass and carry no exit-0 residue.

---
