---
status: complete
created: 2026-07-21
cycle: 2
phase: Gap Analysis
topic: update-output-overhaul
---

# Review Tracking: update-output-overhaul - Gap Analysis

## Findings

### 1. "Grouping spans both processing loops" contradicts the pre-resolution intent key

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Per-Repo Clone Dedup* → *Grouping spans both processing loops*

**Details**:
The pre-pivot "Grouping spans both processing loops" section no longer reconciles with the intent-based, pre-resolution key: "same-target … must collapse" would demand commit-level merging that *Group-first pipeline* forbids, and the two named post-check loops can never contain same-intent entries under the intent key.

**Resolution**: Approved
**Notes**: Rewrote the section as "Grouping covers the whole manifest, before checking" — grouping runs over every non-local entry in one pass before any check, so today's post-check loop boundaries never fragment a group; explicitly states it does NOT merge distinct intents that resolve to the same commit (removes the "same-target must collapse" contradiction).

---

### 2. Divergent-old header rule: undefined "group" reference and unspecified member-line format

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Per-Unit Progress Output* → *Version move & dropped-agents placement*, "Header 'old' ref when updating members diverge"

**Details**:
The divergence rule left "each member whose old differs from the group" undefined (the divergent header carries no group old) and never illustrated the member-line format when it carries a version move alongside agents and the dropped-agents suffix.

**Resolution**: Approved
**Notes**: Clarified that in the divergent case **every** updating member carries its own `old → new` (not just outliers). Added a member-line format bullet: the per-member move rides a parenthetical suffix consistent with the dropped-agents notice — `✓ macos → claude  (v1.2.0 → v1.3.0)`, combined as `(v1.2.0 → v1.3.0; codex support removed by author)`.

---

### 3. Non-streaming category list omits `check-failed`

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Per-Unit Progress Output* → *Outcome timing*, "Two phases" bullet

**Details**:
The two-phase bullet listed non-updatable groups as "(all up-to-date / `newer-tags` / `constrained-no-match`)", omitting the cycle-1 `check-failed` class, which also never clones/streams and is a trailing category everywhere else.

**Resolution**: Approved
**Notes**: Added `check-failed` to the "never clones / never streams" set in the two-phase bullet ("or whose check itself failed (`check-failed`)").

---

### 4. "Deterministic processing order" is asserted but never defined

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Failure isolation & lifecycle*, *Outcome timing*, *Local entries*, Acceptance criterion 2

**Details**:
"Deterministic processing order" / "in processing order" is relied on for streamed-group ordering and inline local-entry placement, but the ordering basis was never stated — leaving observable output ordering (which tests assert) an implementer's free choice.

**Resolution**: Approved
**Notes**: Defined processing order = manifest order: updatable groups stream in the order their first member appears in the manifest, local group-of-one lines interleave at their own manifest positions. Added inline in the *Outcome timing* two-phase bullet.

---
