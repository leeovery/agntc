# Plan: Update Check Fails On Branch Ref

## Phases

### Phase 1: Remote-truth ref classification in update-check
status: draft

**Goal**: Replace the lexical `isTagRef` heuristic in `checkForUpdate` (`src/update-check.ts`) with a remote-truth classification probe. A stored non-null, unconstrained `ref` is probed via a single `ls-remote <url> refs/heads/{ref} refs/tags/{ref}` call (using the module's `{ timeout: 15_000 }`), parsed by a new step keyed on the exact ref path, and routed to the branch comparison (reusing the probed `refs/heads/{ref}` tip sha — no second lookup) or the tag comparison (issuing its own `--tags` list). This fixes the whole class of branch refs that lexically resemble tags (`v4`, `v3`, `4`, `2024`) and clears the symmetric latent case (`release-1.0`-style tags misrouted to the branch path).

**Why this order**: This is a single-root-cause bugfix confined to one dispatch decision in a single ~210-line file. There is no prerequisite scaffolding, no independently valuable intermediate state, and no separate subsystem to fix. The direct regression guard, the routing change, the dead-code removal (`isTagRef` and the unreachable per-type not-found guards), and the emergent cross-surface recovery all hang off the same change — they form one cohesive TDD cycle. Splitting cross-surface verification into its own phase would create a checkpoint with no independent implementation, so it stays here.

**Acceptance**:
- [ ] Branch ref `v4` (remote advertises `refs/heads/v4`, no `refs/tags/v4`) classifies as branch and compares against the branch tip → `up-to-date` (tip == commit) or `update-available` (tip != commit); never returns `Tag 'v4' not found on remote`.
- [ ] Real semver tag `v4.9.0` (remote advertises `refs/tags/v4.9.0` plus newer tags) classifies as tag → `newer-tags` / `up-to-date`; unchanged from today.
- [ ] Symmetric case `release-1.0` (tag name not matching `/^v?\d/`) classifies as tag and returns a tag-comparison result, not `Branch 'release-1.0' not found`.
- [ ] Plain branch (`main` / `dev`) classifies as branch; unchanged from today.
- [ ] A ref present as both `refs/heads/{ref}` and `refs/tags/{ref}` resolves deterministically to the tag (tiebreak), returning the tag-comparison result.
- [ ] A ref present as neither returns `check-failed` with reason `Ref '{ref}' not found on remote as a branch or tag` (terminal — no commit/HEAD fallback).
- [ ] A network/exec failure during the probe returns `check-failed` carrying the underlying error message.
- [ ] `isTagRef` is removed (no remaining caller) and the now-unreachable per-type not-found guards inside the comparison bodies no longer surface `Tag '…' not found` / `Branch '…' not found`; the unified reason is the single not-found path.
- [ ] The classification depends only on which of the two exact ref paths are present, matching the full ref path (not a loose prefix) and ignoring the peeled `^{}` line, independent of line order.
- [ ] Untouched paths verified unchanged: constrained entries (`constraint` set) route through `checkConstrained`; HEAD-tracking entries (`ref === null`) route through `checkHead`; local-only entries return `local`.
- [ ] Cross-surface: an entry that previously reported `Check failed — Tag 'v4' not found on remote` now yields a real status — `agntc update <key>` reports a status and exits 0; `agntc update` (all) emits no `check-failed` warning for it; `agntc list` status column and detail view show a real status. (The "change version" action stays gated by `isVersionTag` and remains disabled for branch refs — out of scope, correct.)
- [ ] The full test suite is green: the new regression cases exist in `tests/update-check.test.ts` (with `git-mocks.ts` returning the correct response per `ls-remote` invocation); the `ref type detection` block, the tag-path call-shape assertions, and the per-type not-found assertions are rewritten against remote-truth; cross-surface files (`update-check-all`, `commands/update`, `commands/list-detail`) and the regression file pass; no existing behaviour regresses.
