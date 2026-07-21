---
status: in-progress
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
**Affects**: *Per-Repo Clone Dedup* → *Grouping spans both processing loops* (line 77-79); reconciled against *Grouping key* (line 41-53) and *Group-first pipeline* (line 68)

**Details**:
This section survived from the pre-pivot design and no longer reconciles cleanly with the cycle-1 pre-check, intent-based grouping key. Two tensions:

- **"same-target … must collapse" vs. the deliberately pre-resolution key.** The section requires "Same-repo/**same-target** entries … must still collapse into one group." But line 68 explicitly rejects keying on the resolved target ("keying on the resolved `targetCommit` would re-admit the race"), and line 50 states different intents → different groups. So two same-repo entries that resolve to the *same commit* via different intents (e.g. an exact-pin at `v1.3.0` and a caret `^1.2.3` that resolves to `v1.3.0`) will **not** collapse under the intent key — directly contradicting a literal reading of "same-target … must collapse." An implementer could read this as a mandate to add commit-level merging, which line 68 forbids.
- **The two named loops can't contain same-intent entries.** The loops cited are `[...updateAvailable, ...local]` and `constrainedUpdateAvailable`. A constrained entry's intent is `constraint` and an unconstrained entry's is `ref`; by the key rules they are always different groups. So no single group ever spans both loops, and `local` is excluded from grouping entirely (line 54) — making the "spans both loops" framing describe a collapse that the intent key cannot produce.

If the intended meaning is merely "the grouping pass iterates over *all* manifest entries regardless of which today-loop they'd land in, and single-intent members split across today's post-check categories (up-to-date vs. constrained-update-available) stay in one group," then the wording ("same-target," the two specific loops, "collapse into one group") should be corrected to say that, so an implementer doesn't attempt commit-level or cross-intent merging.

**Proposed Addition**:
{blank until discussed}

**Resolution**: Pending
**Notes**:

---

### 2. Divergent-old header rule: undefined "group" reference and unspecified member-line format

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Per-Unit Progress Output* → *Version move & dropped-agents placement*, "Header 'old' ref when updating members diverge" (line 160)

**Details**:
The cycle-1 divergence rule has two internal gaps an implementer must guess through:

- **Undefined "group" old in the divergent branch.** The rule says that when olds diverge the header shows "**only the resolved target**" (no old), yet then qualifies which members show their own move as "each member **whose old differs from the group**." In the divergent case the header carries no group old, so "the group" old is undefined. It is unclear whether (a) *every* updating member shows its own `old → new` (the only reading that keeps "no member's actual move is hidden" true when the header shows no old), or (b) some implicit majority/shared old is chosen and only outliers show a move (which would contradict "the header shows only the resolved target"). These produce visibly different output.
- **Member-line format when it carries a version move is not illustrated.** The member line is elsewhere shown as `✓ member → agents` and, with a dropped-agents notice, `✓ macos → claude  (codex support removed by author)`. The divergent case adds a per-member `old → new`, but no example shows where the version move sits relative to the agent(s) and the dropped-agents suffix (e.g. `✓ macos  v1.2.0 → v1.3.0 → claude`?). The layout is left to interpretation.

**Proposed Addition**:
{blank until discussed}

**Resolution**: Pending
**Notes**:

---

### 3. Non-streaming category list omits `check-failed`

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Per-Unit Progress Output* → *Outcome timing*, "Two phases" bullet (line 168); reconciled against line 112, 171, 187

**Details**:
Line 168 enumerates the groups that "never clones and never emits an `Updating` spinner" as "(all up-to-date / `newer-tags` / `constrained-no-match`)", omitting `check-failed`. But a check/resolve-failed group (cycle-1 addition, line 112) also never clones, never streams, and surfaces only in the trailing summary — and it *is* listed as a trailing category everywhere else (line 171, 187, criterion 4). The omission is a minor enumeration inconsistency introduced alongside the new check/resolve-failure class; adding `check-failed` to the line 168 parenthetical (or noting it is covered separately) keeps the "which groups skip streaming" set consistent across sections.

**Proposed Addition**:
{blank until discussed}

**Resolution**: Pending
**Notes**:

---

### 4. "Deterministic processing order" is asserted but never defined

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Failure isolation & lifecycle* (line 119), *Outcome timing* (line 168-169), *Local entries* (line 155), Acceptance criterion 2

**Details**:
"Deterministic processing order" / "in processing order" is relied on repeatedly for the streamed-group ordering and the placement of inline local-entry lines, but the ordering *basis* is never stated (manifest order? grouping-iteration order? key-alphabetical?). "Deterministic" alone is satisfiable by any stable order, so this does not block implementation — but it leaves the observable output ordering (which tests for criteria 2/4 must assert, and where local entries interleave with streamed groups) an implementer's free choice with no stated intent. Pinning the ordering basis in one line removes the guess and makes the acceptance tests unambiguous.

**Proposed Addition**:
{blank until discussed}

**Resolution**: Pending
**Notes**:

---
