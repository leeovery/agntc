---
status: complete
created: 2026-07-21
cycle: 4
phase: Gap Analysis
topic: update-output-overhaul
---

# Review Tracking: update-output-overhaul - Gap Analysis

## Findings

### 1. Per-member reinstall-failure outcomes have no rendering home in the streamed-group model

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Per-Unit Progress Output* (Progress granularities / Version move & dropped-agents placement / Outcome timing) and *Failure isolation & lifecycle* (Reinstall failure)

**Details**:
The new streamed model gives every possible per-member outcome a rendering home *except* the four per-member reinstall failures. Mapping each outcome type to where it renders:

- updated → streamed `✓ member → agents` line / group-of-one collapse — specified.
- local-update → group-of-one `✓ <key>: Refreshed from local path` — specified.
- up-to-date, newer-tags, check-failed, constrained-no-match → trailing collapse — specified.
- out-of-constraint → footer — specified.
- clone `failed` (group-fatal) → one grouped clone-failure line — specified.
- **copy-failed / aborted / blocked / no-agents → not specified anywhere.**

These four occur *after* the clone succeeds and *after* the group's check passed, so they cannot render as a check-category trailing line: the end-of-run loop is explicitly restricted to "non-actioned check categories — `up-to-date`, `newer-tags`, `check-failed`, `constrained-no-match`" (line 172), which excludes all four. And they are not the `✓ member → agents` success shape either. `renderUpdateOutcomeSummary` (their home today) is exactly the summary plumbing this feature reshapes, so "verbatim today's behaviour" (line 114) covers only their *isolation* semantics (removes its entry, siblings continue, exit accounting) — not where/how they print in the streamed group.

Line 170 says only that "per-member result lines are emitted as persistent `p.log.*` lines," which is generic enough to *include* a failure but specifies no format or log level for one. Concretely unspecified for an implementer:

- **Member-line format/level for a failed member under a group header** — e.g. is a `copy-failed` member `✗ macos → claude  (copy failed — <reason>)` at `p.log.error`? A `no-agents` member a warning? There is no failure analog to the specified `✓ member → agents` shape.
- **The `aborted` (derive-before-delete) loud message.** Per Update Strategy the abort must emit a "loud message (manual `remove`+`add` remedy)". Whether that full remedy text still renders on the member line under the group header, or is deferred, is not reconciled with the new model.
- **Header `(N members)` count semantics when members fail.** The group spinner text (and its count) is set at clone start, before member outcomes are known, so `(N members)` can only be the *attempted* set — yet line 192 defines it as "the members *updated* in this group." When e.g. 7 are attempted and 1 copy-fails, whether the header reads `(7 members)` or `(6 members)` is ambiguous.

Because a mixed-outcome group (some `✓`, some `copy-failed`/`aborted`/`blocked`/`no-agents`) is exactly the kind of partial-success case this feature must handle, and acceptance criterion 7 asserts the behaviour without specifying the display, the implementer would have to invent the failed-member line format, its placement, and the header-count rule — a visible design decision left open.

**Proposed Addition**:
Applied — see resolution notes.

**Resolution**: Approved
**Notes**: Added a *Failed & skipped member lines* subsection to Per-Unit Progress Output specifying the member-line format and log level for each per-member reinstall outcome (`✓` success/`p.log.success`, `✗` copy-failed/aborted/blocked/`p.log.error`, `⚠` no-agents/`p.log.warn`), their inline placement in the group block (mixed-outcome group = one self-contained block), and the aborted loud-remedy rendering inline. Clarified the header `(N members)` count as the *attempted* set fixed at spinner start (a failed/skipped member still counts; its outcome shows on its line). Cross-referenced from Failure isolation and acceptance criterion 7.

---
