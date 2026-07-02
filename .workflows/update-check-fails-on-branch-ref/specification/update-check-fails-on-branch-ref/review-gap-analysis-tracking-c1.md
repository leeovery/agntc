---
status: in-progress
created: 2026-07-02
cycle: 1
phase: Gap Analysis
topic: update-check-fails-on-branch-ref
---

# Review Tracking: update-check-fails-on-branch-ref - Gap Analysis

## Findings

### 1. Probe-output parsing is underspecified; the "existing primitives suffice" claim does not hold as written

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: "Classification probe" section; "Scope & Constraints → In scope" (the `parseLsRemoteSha` / `parseTagRefs` claim); "Comparison paths → Branch" (sha reuse)

**Details**:
The probe issues a single call `git ls-remote <url> refs/heads/{ref} refs/tags/{ref}`, whose stdout can contain up to three lines: a `refs/heads/{ref}` line, a `refs/tags/{ref}` line, and — for an annotated tag — a peeled `refs/tags/{ref}^{}` line. The spec says to "key strictly off the ref-path prefix" and that the existing `execGit` / `parseLsRemoteSha` / `parseTagRefs` primitives "already suffice." Neither primitive actually parses this mixed, multi-line, two-ref-type output:

- `parseLsRemoteSha` (update-check.ts:43) returns the sha from `split("\n")[0]` — the FIRST line ONLY. If the probe output lists `refs/heads/{ref}` and `refs/tags/{ref}`, this returns whichever line git emitted first and discards the prefix entirely, so it cannot classify by prefix nor reliably extract the branch tip.
- `parseTagRefs` (git-utils.ts:34) strips the literal `refs/tags/` substring and filters `^{}`, but does not distinguish `refs/heads/` lines (a heads line would pass through as a bogus "tag" with its full path as the name).

So the classification logic — "did `refs/heads/{ref}` match, did `refs/tags/{ref}` match" — has no existing primitive that answers it. An implementer is left to invent a per-line prefix-matching parser. The spec should either (a) state that a new parse step keyed on the `refs/heads/` vs `refs/tags/` line prefix is required (not merely "optional helper"), or (b) not assert the existing primitives suffice. The order of lines in ls-remote output must not be relied upon for classification (only the prefix), which the spec's "key strictly off the ref-path prefix" wording gets right — but the named primitives contradict that by keying off line position.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 2. Branch-path sha reuse: which line to extract is unspecified given multi-line probe output

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: "Comparison paths → Branch" ("The probe already fetched the tip sha, so this path may reuse it instead of re-fetching"); Constraints ("the branch path reuses the probe's sha rather than issuing a second lookup")

**Details**:
The Constraints section states as a hard cost bound that "the branch path reuses the probe's sha rather than issuing a second lookup" — phrased as a requirement, not merely the optional optimisation that "Comparison paths" describes ("may reuse"). This is an internal inconsistency (may vs. must). More importantly, to reuse the branch tip sha the implementer must extract specifically the `refs/heads/{ref}` line's sha from the probe output. `parseLsRemoteSha`'s first-line behaviour (see Finding 1) makes this unreliable when a `refs/tags/{ref}` line is also present (the "Both" tiebreak case, or any case where git orders the tags line first). The spec should state that the reused sha must be taken from the `refs/heads/{ref}` line specifically, and reconcile "may reuse" (Comparison paths) with "reuses ... rather than issuing a second lookup" (Constraints) into a single clear statement of whether reuse is required or optional.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 3. "Both" tiebreak → tag path silently drops the already-fetched probe sha and re-fetches all tags

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: "Tiebreak" section; "Comparison paths → Tag"; Constraints (cost bound "at most one extra ls-remote round-trip")

**Details**:
When both a branch and a tag exist, the tiebreak routes to the tag path, which "fetches all tags" via `fetchRemoteTagRefs` (a second `ls-remote --tags` call). Combined with the probe, that is two `ls-remote` calls — consistent with the stated "at most one extra round-trip versus today" bound for the tag case (today's `checkTag` already does one). This is fine, but worth making explicit: the tag path always issues its own `ls-remote --tags` regardless of what the probe returned (the probe's tag sha is not reused), because `checkTag` needs the full tag list to compute `newer-tags`. The spec implies reuse is a branch-path-only optimisation but never states that the tag path deliberately does NOT reuse the probe sha. An implementer might waste effort trying to reuse it, or worse, try to compute `newer-tags` from the single probed sha. State plainly: tag path re-fetches the full tag list (unchanged from `checkTag`); only the branch path reuses the probe sha.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 4. Cost-bound claim ("at most one extra ls-remote round-trip") is not universally true across all classifications

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: "Scope & Constraints → Constraints" (third bullet)

**Details**:
The bound reads "Cost at most one extra ls-remote round-trip versus today." Compare per case:
- Branch ref: today = 1 call (`checkBranch`); new = 1 probe call, sha reused → 0 extra. OK (or +1 if reuse not implemented).
- Tag ref: today = 1 call (`checkTag`'s `--tags`); new = probe (1) + tag list (1) = 2 → +1 extra. OK.
- Neither/network-failure: today the misrouted call fails after 1 call; new = 1 probe → roughly parity.

The "+1 for the tag case" is the worst case and matches the wording, so the bound holds — but only because the branch case reuses the probe sha (Finding 2). If an implementer treats reuse as optional (per "may reuse") and re-fetches the branch tip, the branch case also becomes +1, still within the bound. The bound is defensible; flagging so the reviewer confirms the intended reading is "worst case +1, achieved by requiring branch-sha reuse," and that this is a soft target rather than a testable acceptance criterion (no acceptance criterion asserts call counts). If it is meant to be enforced, the Testing section's mock-invocation-count assertions would need to encode it; currently they do not.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 5. Probe returns a sha but for an unexpected/partial ref — no rule for stray or malformed lines

**Source**: Specification analysis
**Category**: Edge Case
**Affects**: "Classification probe" parsing rules

**Details**:
The probe pins two exact ref paths (`refs/heads/{ref}`, `refs/tags/{ref}`), so git should only ever advertise those exact refs (plus a peeled `^{}` for an annotated tag, which the spec says to ignore). The spec covers Only-heads / Only-tags / Both / Neither. It does not state what to do if the parsed output contains a line whose ref path is neither `refs/heads/{ref}` nor `refs/tags/{ref}` exactly (should not happen with exact-path args, but ls-remote pattern-matching semantics and pathological ref names could in principle surprise). The safe rule ("ignore any line that is not exactly one of the two probed paths; classify solely on presence of those two") is implied by "key strictly off the ref-path prefix" but not spelled out — an implementer keying loosely on prefix (`startsWith("refs/heads/")`) versus exact match (`=== "refs/heads/" + ref`) could diverge for e.g. a ref name containing a slash. Recommend the spec state exact-path matching, or explicitly note only-exact-two-paths-can-return so loose prefix matching is safe.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 6. Reason-string exactness is testable but the tag/branch "not found" reasons are being dropped without note

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: "Error handling"; Acceptance Criteria 6; Testing Requirements (regression 5)

**Details**:
The unified neither-found reason `Ref '{ref}' not found on remote as a branch or tag` replaces both `Tag '{ref}' not found on remote` (checkTag) and `Branch '{ref}' not found on remote` (checkBranch). The spec is clear that Neither → the new unified reason. But it does not state whether the old per-type reason strings are fully retired. Under remote-truth classification, `checkTag`'s "Tag not found" branch (update-check.ts:144-148) becomes unreachable (a ref is only routed to the tag path after the probe confirmed `refs/tags/{ref}` exists), as does `checkBranch`'s "Branch not found" (lines 117-121). The spec says "Comparison paths ... keep their current behaviour," which literally would preserve that now-dead code. An implementer needs to know: is the now-unreachable not-found branch inside the tag/branch comparison bodies meant to be left as-is (dead but harmless), or removed? Acceptance Criteria 1 and 3 assert the old strings must NEVER appear, which is satisfied either way, but existing tests asserting those exact strings on the not-found path (if any) would need retirement. Testing Requirements mentions rewriting the `ref type detection` block and the arg-shape assertions but does not mention the now-unreachable not-found assertions. Recommend one sentence clarifying the fate of the per-type not-found branches.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 7. "Change version" gating rationale is correct but omits the `check-failed` half of the guard

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Acceptance Criteria "Cross-surface" bullet (`agntc list`)

**Details**:
The spec says the "change version" action is gated by `isVersionTag(entry.ref)` in list-detail.ts and stays disabled for a branch ref like `v4` because `isVersionTag` returns false. Verified accurate. However the actual guard (list-detail.ts:133) is `isVersionTag(entry.ref) && updateStatus.status !== "check-failed"` — a compound. For a real tag ref (`v4.9.0`) that previously showed `check-failed` due to the OPPOSITE symmetric bug (`release-1.0`), this fix flips the second conjunct from false to true, thereby RE-ENABLING "change version" for those tags — a real, intended behavioural improvement the spec does not call out. The spec frames "change version" purely as "remains disabled (correct)" for branch refs, but for the `release-1.0`-class tag (Acceptance Criterion 3 / Goal's "bonus"), recovering a non-`check-failed` status will also re-enable the action. This is a positive side effect worth stating so it is not mistaken for scope creep or an accident, and so a test can assert it if desired. As written, a reader could infer the fix never touches "change version" at all, which is inaccurate for the symmetric-tag case.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 8. No stated behaviour when the probe succeeds (network OK) but returns empty output for a ref that install recorded

**Source**: Specification analysis
**Category**: Edge Case
**Affects**: "Classification probe" (Neither branch); Acceptance Criterion 6

**Details**:
The "Neither" case is described as "e.g. deleted upstream" and mapped to `check-failed`. This correctly covers a ref that once existed and was deleted. It also silently covers a ref that never existed as either type — but note the installed commit is still present in the entry. The spec makes no distinction, treating any empty-both-patterns probe as `check-failed` with the unified reason. That is a reasonable and consistent choice, but the spec should confirm it is intentional that a genuinely-gone ref produces `check-failed` (degraded but non-fatal for `update` all / `list`) rather than any attempt to fall back to a commit-based or HEAD comparison. This matters because the entry still holds a valid `commit`, and a reader might expect a graceful degradation path. Recommend an explicit "no commit-based fallback; Neither is terminal `check-failed`" note to remove ambiguity.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---
