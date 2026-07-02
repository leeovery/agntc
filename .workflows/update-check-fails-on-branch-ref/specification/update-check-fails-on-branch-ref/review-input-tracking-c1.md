---
status: complete
created: 2026-07-02
cycle: 1
phase: Input Review
topic: Update Check Fails On Branch Ref
---

# Review Tracking: Update Check Fails On Branch Ref - Input Review

## Findings

### 1. "Change version" action gate (`isVersionTag`) is independent of the fix and stays disabled for `v4`

**Source**: investigation §Analysis divergence table (lines 138-148), §Contributing Factors (lines 180-181), §Blast Radius (`list-detail.ts:133`, line 203)
**Category**: Enhancement to existing topic
**Affects**: Overview → severity bullet (`agntc list`); Acceptance Criteria → Cross-surface (`agntc list` bullet)

**Details**:
The investigation surfaces a second, distinct lexical classifier — `isVersionTag` (`semver.clean(ref) !== null`, `version-resolve.ts:30`) — used at `list-detail.ts:133` to gate the "change version" action: `canChangeVersion = isVersionTag(entry.ref) && updateStatus.status !== "check-failed"`. The divergence table records `isVersionTag("v4") === false`.

The spec's Cross-surface criterion says the `list` "detail view and the 'change version' action behave per the resolved type" — but this glosses over a real interaction the investigation exposes. The fix only changes `checkForUpdate`'s branch-vs-tag routing; it does **not** touch `isVersionTag` or the `list-detail` gate. So for a `v4` branch after the fix:
- `updateStatus.status` is no longer `check-failed` (the first gate clears), **but**
- `isVersionTag("v4")` is still `false`, so `canChangeVersion` remains `false` and "change version" stays disabled.

This is arguably *correct* (a branch is not tag-pinned, so "change version" shouldn't apply), but the spec currently implies the action recovers post-fix ("behave per the resolved type") without stating that the gate is a separate lexical check outside this fix's scope. Worth an explicit line so a reader/implementer doesn't expect "change version" to light up for `v4`, and so the `list` severity bullet ("change version action disabled") is understood to only *partially* recover (detail view / status column recover; the action stays off for branch refs by a different mechanism).

**Current**:
Overview severity bullet:
> - **`agntc list`** — permanent `✗ check failed` in the update-status column every run; detail view degraded, "change version" action disabled.

Acceptance Criteria Cross-surface bullet:
> - `agntc list` — update-status column shows a real status; detail view and the "change version" action behave per the resolved type.

**Proposed Addition**:
Replace the Acceptance Criteria Cross-surface `agntc list` bullet with:
> - `agntc list` — update-status column and detail view show a real status (no longer `check-failed`). The **"change version" action is gated separately** by `isVersionTag(entry.ref)` in `list-detail.ts` — **outside this fix's scope**. For a branch ref like `v4`, `isVersionTag` stays `false`, so the action remains disabled (correct — a branch is not tag-pinned). This fix recovers the status column and detail view; it does not re-enable "change version" for branch refs.

(Overview severity bullet is unchanged — it correctly describes the pre-fix broken state.)

**Resolution**: Approved
**Notes**:

---

### 2. Broader set of affected branch names (`v3`, `4`, `v4.0`, `2024` date-branch) not enumerated

**Source**: investigation §Blast Radius, "Potentially affected" (lines 205-207); §Contributing Factors (line 176)
**Category**: Enhancement to existing topic
**Affects**: Overview → Root Cause / Goal; Acceptance Criteria (breadth of the branch-looks-like-tag case)

**Details**:
The investigation enumerates the full class of misrouted branch names: "Any branch ref that lexically parses as a (partial) version: `v4`, `v3`, `4`, `v4.0`, `2024` (date-branch), etc. — all misrouted to `checkTag`." The spec everywhere reduces this to the single exemplar `v4`. The `2024` date-branch case is notably distinct from the `v`-prefixed family and demonstrates the heuristic's breadth (`/^v?\d/` matches any leading digit). The remote-truth fix covers all of these by construction, but the spec never states the general class — a reader could infer the bug/fix is narrowly about `v`-major branches. Stating the class (any leading-digit / partial-version branch name) both frames the problem correctly and could motivate a table-driven regression case beyond the lone `v4`.

**Current**:
Overview → Root Cause:
> `checkForUpdate` (`src/update-check.ts`) classifies a stored `ref` as tag-vs-branch using a purely lexical heuristic, `isTagRef` → `/^v?\d/`. A branch named `v4` matches, so it is misrouted to the tag path (`checkTag`) ...

**Proposed Addition**:
Append to the Root Cause paragraph (after "…so the check fails permanently."):
> The same misroute hits **any** branch whose name lexically parses as a leading-digit or partial version — `v4`, `v3`, `4`, `v4.0`, `2024` (a date-branch) — because `/^v?\d/` matches any leading digit. `v4` is the reported exemplar; the remote-truth fix covers the whole class by construction.

**Resolution**: Approved
**Notes**:

---

### 3. The `isTagRef` comment documents only the opposite failure — context for its removal

**Source**: investigation §Why It Wasn't Caught (lines 191-193); confirmed in code at `src/update-check.ts:36-38`
**Category**: Enhancement to existing topic
**Affects**: Scope & Constraints → In scope ("remove `isTagRef`")

**Details**:
The investigation's "Why It Wasn't Caught" notes the `isTagRef` heuristic "own comment flags only the *opposite* failure (tags with a non-`v`/non-numeric prefix like `release-1.0`), not the branch-looks-like-tag case that actually bites here." The live code confirms this: the comment at `src/update-check.ts:36-38` explicitly warns "Will misclassify tags that start with a non-numeric, non-v prefix (e.g. 'release-1.0')" — the symmetric latent case — while saying nothing about the `v4`-branch case that is the actual reported defect.

The spec instructs "remove `isTagRef` (it has no other caller)" but omits that a documented, known-limitation comment travels with it. This is minor, but relevant: it explains *why* the symmetric `release-1.0` case is already understood (the code called it out) while the primary bug went unnoticed, and it confirms the removal takes the stale comment with it. Useful as a one-line note in the In-scope removal so the implementer knows the comment is intentional collateral, not something to preserve/port.

**Current**:
> - **`src/update-check.ts`** — reshape the `checkForUpdate` dispatch; remove `isTagRef`; add the classification probe, its parsing, and branch/tag routing.

**Proposed Addition**:
Replace the In-scope `src/update-check.ts` bullet with:
> - **`src/update-check.ts`** — reshape the `checkForUpdate` dispatch; remove `isTagRef` (no other caller; its known-limitation comment documents only the *opposite* symmetric failure — `release-1.0`-style tags — and is intentional collateral, not something to port); add the classification probe, its parsing, and branch/tag routing.

**Resolution**: Approved
**Notes**:

---
