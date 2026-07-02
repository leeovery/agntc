# Specification: Update Check Fails On Branch Ref

## Overview

### Problem

A source installed from a **branch ref whose name lexically resembles a semver tag** (e.g. `v4` — a long-lived major-version branch, as `nuxt/ui` ships its skill from `skills/nuxt-ui/` on `v4`) installs cleanly but can never resolve to a real update status. Every update-check surface reports `Tag 'v4' not found on remote`.

This violates the core invariant: **installed fine ⇒ should update/remove fine.**

Severity differs by surface:
- **`agntc update <key>`** (single) — hard non-zero error, exits 1.
- **`agntc update`** (all) — loud non-fatal warning (`check-failed` is excluded from the failed-outcome set, so the command does **not** exit non-zero).
- **`agntc list`** — permanent `✗ check failed` in the update-status column every run; detail view degraded, "change version" action disabled.

`remove` is unaffected (it does no ref resolution).

### Root Cause

`checkForUpdate` (`src/update-check.ts`) classifies a stored `ref` as tag-vs-branch using a purely lexical heuristic, `isTagRef` → `/^v?\d/`. A branch named `v4` matches, so it is misrouted to the tag path (`checkTag`), which performs an exact tag-existence lookup. No tag literally named `v4` exists on the remote (its tags are `v4.9.0`, `v4.8.2`, …), so the check fails permanently.

The same misroute hits **any** branch whose name lexically parses as a leading-digit or partial version — `v4`, `v3`, `4`, `v4.0`, `2024` (a date-branch) — because `/^v?\d/` matches any leading digit. `v4` is the reported exemplar; the remote-truth fix covers the whole class by construction.

The install path never hit this because `git clone --branch <ref>` resolves a branch **or** a tag agnostically. Update-check is the only path that pre-classifies the ref by string shape.

### Goal

Make update-check determine a stored ref's type from **remote truth** — whether it exists as `refs/heads/{ref}` or `refs/tags/{ref}` on the remote — instead of guessing from the string. This fixes branch refs that look like tags, and as a bonus clears the symmetric latent case (a real tag whose name doesn't match `/^v?\d/`, e.g. `release-1.0`, currently misrouted to the branch path). No manifest migration; no change to the `add` side.

---

## Solution: Remote-Truth Ref Classification

### Dispatch change (confined to `checkForUpdate`)

Current dispatch order in `checkForUpdate` (`src/update-check.ts`):

1. `ref === null && commit === null` → `local`
2. `constraint !== undefined` → `checkConstrained`
3. `ref === null` → `checkHead`
4. `isTagRef(ref)` → `checkTag`  ← **the bug**
5. else → `checkBranch`

Steps 1–3 are **unchanged**. Steps 4–5 (the lexical `isTagRef` split) are replaced by remote-truth classification. The `isTagRef` helper is removed (it has no other caller).

### Classification probe

When a non-null `ref` reaches the classifier (constraint absent, ref present), probe the remote for both ref types in a **single** `ls-remote` call:

```
git ls-remote <url> refs/heads/{ref} refs/tags/{ref}
```

Run it via `execGit` with the module's standard `{ timeout: 15_000 }` — matching the sibling `ls-remote` calls (`checkHead`, `checkBranch`, `fetchRemoteTagRefs`), **not** `execGit`'s 30s default.

The probe output has up to three lines: a `refs/heads/{ref}` line, a `refs/tags/{ref}` line, and — for an annotated tag — a peeled `refs/tags/{ref}^{}` line. Classify by scanning the lines and recording, per line, whether its ref path is **exactly** `refs/heads/{ref}` or **exactly** `refs/tags/{ref}`. Match the full ref path, not a loose prefix, so a ref name containing a slash cannot cross-match; ignore the peeled `^{}` line and any line that is neither exact path. Classification depends only on *which of the two exact paths are present*, never on line order.

This needs a **new parse step**: the existing `parseLsRemoteSha` reads only the first line (discarding the prefix) and `parseTagRefs` strips `refs/tags/` while ignoring heads — neither classifies a mixed heads+tags response. A small dedicated parser (returning the head sha and/or the tag sha, keyed by exact ref path) is required.

- **Only `refs/heads/{ref}` present** → branch → branch-comparison path.
- **Only `refs/tags/{ref}` present** → tag → tag-comparison path.
- **Both present** → tiebreak (below).
- **Neither present** → `check-failed`, reason `Ref '{ref}' not found on remote as a branch or tag`.

### Tiebreak: both a branch and a tag named `{ref}`

Resolve to the **tag**, mirroring git's own ref-resolution precedence (gitrevisions disambiguates a bare name with `refs/tags/` before `refs/heads/`). Deterministic and matches "what git would do with this bare name." The manifest records no ref-type intent, so this is the principled default rather than a guess at what the installer meant. This is the one edge the investigation explicitly deferred to the specification.

### Comparison paths (behaviour preserved)

- **Branch:** compare the branch tip sha against the installed commit → `up-to-date` (tip == commit) or `update-available` (tip != commit). The tip sha is the one the probe parsed for the **`refs/heads/{ref}`** line specifically; the branch path **reuses that sha and issues no second lookup** — required, not optional (it is what keeps the branch case at no extra round-trip). The comparison itself is identical to today's `checkBranch`.
- **Tag:** the tag path always issues its own `ls-remote --tags` for the full tag list, then finds those newer than `{ref}` → `newer-tags` or `up-to-date`. It does **not** reuse the probe's tag sha (a single probed sha cannot yield the newer-tags set). Identical to today's `checkTag`.

### Error handling

- Any `ls-remote` network/exec failure → `check-failed` carrying the error message (as today).
- Ref found as neither branch nor tag (e.g. deleted upstream) → `check-failed` with the unified reason above. This is **terminal**: even though the entry still holds a valid installed `commit`, there is **no** commit-based or HEAD fallback — a gone ref is a degraded (non-fatal for `update`-all / `list`) `check-failed`, matching how the ref-specific "not found" paths behave today.
- Because the probe confirms the ref exists before routing, the per-type "not found" guards inside the comparison bodies (`checkTag`'s `Tag '…' not found`, `checkBranch`'s `Branch '…' not found`) become **unreachable**. They may be removed as dead code; the unified neither-found reason is the single not-found path.

---

## Scope & Constraints

### In scope

- **`src/update-check.ts`** — reshape the `checkForUpdate` dispatch; remove `isTagRef` (no other caller; its known-limitation comment documents only the *opposite* symmetric failure — `release-1.0`-style tags — and is intentional collateral, not something to port); add the classification probe, its parsing, and branch/tag routing.
- A **new probe-parsing step** keyed on the exact ref path (see Classification probe) — the existing `parseLsRemoteSha` (first-line only) and `parseTagRefs` (tags-only, strips `refs/tags/`) do **not** classify a mixed heads+tags response, so they do not suffice. `execGit` is reused to run the probe; the small parser may live in `src/update-check.ts` or `src/git-utils.ts` (implementation's call).

### Untouched (explicit non-goals)

- **No manifest change.** `ManifestEntry` gains no `refType` field; no migration, no backfill. (Recording `refType` at `add` time — investigation Option 3 — is deferred as a possible future enhancement, not needed here.)
- **No `add`-side change.** `add` already records `ref` faithfully (`resolveTagConstraint` stores `ref: "v4"` with no constraint). The defect is entirely in update-check classification.
- **`checkConstrained` untouched** — entries with a `constraint` never routed through `isTagRef`.
- **`checkHead` untouched** — HEAD-tracking entries (`ref === null`) unaffected.
- **`local` path untouched.**
- **Comparison semantics unchanged** — the tag and branch comparison bodies keep their current behaviour; only the routing decision between them changes.

### Constraints

- No new dependencies.
- Preserve the existing `UpdateCheckResult` union — no new status variants; the neither-exists case reuses `check-failed`.
- **Network cost (design target, not a test-enforced criterion):** at most one extra `ls-remote` round-trip versus today. By case: branch — 1 probe call, sha reused → **no extra** call; tag — probe + `--tags` = 2 → **+1**; neither / failure → ~parity. The branch-case "no extra" depends on the required branch-sha reuse above. No acceptance criterion asserts call counts.

---

## Acceptance Criteria

Given a manifest entry with a non-null `ref` and no `constraint`, `checkForUpdate`:

1. **Branch ref that looks like a tag** (`ref = "v4"`; remote has `refs/heads/v4`, no `refs/tags/v4`) — classifies as branch; compares the `refs/heads/v4` tip against the installed commit; returns `up-to-date` (tip == commit) or `update-available` (tip != commit). **Never** returns `Tag 'v4' not found on remote`.
2. **Real semver tag** (`ref = "v4.9.0"`; remote has `refs/tags/v4.9.0`) — classifies as tag; returns `newer-tags` when later tags exist, else `up-to-date`. Unchanged from today.
3. **Symmetric case — tag whose name doesn't match `/^v?\d/`** (`ref = "release-1.0"`; remote has `refs/tags/release-1.0`) — classifies as tag (today it wrongly routes to branch). Returns a tag-comparison result, not `Branch 'release-1.0' not found`.
4. **Plain branch** (`ref = "main"` / `"dev"`; remote has `refs/heads/main`) — classifies as branch. Unchanged from today.
5. **Both a branch and a tag named `{ref}`** — resolves deterministically to the **tag** (tiebreak); returns the tag-comparison result.
6. **Ref exists as neither** (deleted upstream) — returns `check-failed` with reason `Ref '{ref}' not found on remote as a branch or tag`.
7. **Remote/network failure during the probe** — returns `check-failed` carrying the underlying error message.

**Cross-surface:** an entry that previously showed `Check failed — Tag 'v4' not found on remote` now —
- `agntc update <key>` — reports a real status and exits 0 (no hard error).
- `agntc update` (all) — no `check-failed` warning for that entry.
- `agntc list` — update-status column and detail view show a real status (no longer `check-failed`). The **"change version" action is gated separately** by `isVersionTag(entry.ref)` in `list-detail.ts` — **outside this fix's scope**. For a branch ref like `v4`, `isVersionTag` stays `false`, so the action remains disabled (correct — a branch is not tag-pinned). This fix recovers the status column and detail view; it does not re-enable "change version" for branch refs.

**Untouched paths stay correct:** constrained entries (`constraint` set) unchanged; HEAD-tracking entries (`ref === null`) unchanged; local-only entries return `local`.

---

## Testing Requirements

Unit tests live in `tests/update-check.test.ts` (`checkForUpdate` with `node:child_process` mocked via `tests/helpers/git-mocks.ts`). Cross-surface behaviour is covered by `tests/update-check-all.test.ts`, `tests/commands/update.test.ts`, `tests/commands/list-detail.test.ts`, and the regression file `tests/update-check-unconstrained-regression.test.ts`.

### New regression coverage (the fix)

1. **Branch ref matching `/^v?\d/`** (`ref = "v4"`) — the direct regression guard. Remote advertises `refs/heads/v4`, no matching tag. Assert it classifies as branch and compares against the branch tip (`up-to-date` / `update-available`) — never `Tag 'v4' not found`.
2. **Real semver tag** (`ref = "v4.9.0"`) — remote advertises `refs/tags/v4.9.0` plus newer tags. Assert tag comparison (`newer-tags` / `up-to-date`) still holds after the change.
3. **Symmetric latent case** (`ref = "release-1.0"`, tag not matching `/^v?\d/`) — remote advertises `refs/tags/release-1.0`. Assert it classifies as tag, not `Branch 'release-1.0' not found`.
4. **Both a branch and a tag named `{ref}`** — remote advertises both `refs/heads/v4` and `refs/tags/v4`. Assert the tiebreak resolves to the tag deterministically.
5. **Neither exists** — remote advertises neither. Assert `check-failed` with reason `Ref '{ref}' not found on remote as a branch or tag`.
6. **Probe network failure** — `ls-remote` errors. Assert `check-failed` carrying the underlying message.

### Existing tests to update (they encode the old heuristic)

- The **`ref type detection`** describe block (`v1.2.3` / `1.0.0` asserting `--tags` is called directly) — rewrite against remote-truth classification.
- The tag path's **single `ls-remote --tags` call** assertion and the branch/tag exact-arg-shape assertions — update to the probe-then-compare call sequence (or a single combined call, per the chosen implementation).
- The existing **per-type not-found assertions** — `checkForUpdate`'s "branch is gone" (`Branch 'deleted-branch' not found on remote`) and "installed tag not in remote tags" (`Tag 'v2.0' not found on remote`) — now resolve through the probe. Retire the per-type strings; where the ref exists as neither, assert the unified `Ref '…' not found on remote as a branch or tag`.
- Confirm untouched paths (`local`, HEAD-tracking, constrained) still pass unchanged.

### Mock harness note

The dispatch may issue more than one `ls-remote` invocation per check (probe, then tag list). The mock in `git-mocks.ts` must return the correct response **per invocation** — branch on the `ls-remote` args rather than returning one fixed payload.

### Preference

Where the harness allows, exercise classification against real `ls-remote` ref output, since the whole bug is the disagreement between lexical guess and remote reality.

---

## Out of Scope

- **Vercel `skills` CLI shorthand compatibility** (`npx skills add nuxt/ui` resolving to the right subpath) — a separate, pre-existing inbox idea (`vercel-skills-cli-compatibility`). Not part of this fix.
- **Recording `refType` in the manifest** (investigation Option 3) — a possible future robustness enhancement; not required here and explicitly deferred.
- **Swapping `isTagRef` for `isVersionTag`** (investigation Option 1) — the lexical quick-patch; rejected as the primary fix (still a guess; doesn't clear the symmetric `release-1.0` case). Retained only as a fallback one-line patch if a fix is ever wanted ahead of this work; not implemented here.
- **Changes to `add`, `remove`, clone/reinstall, or the constrained / HEAD comparison logic.** The invariant's install and remove halves already hold; only update/check classification is in scope.

**Release posture:** regular release, no hotfix urgency (loud warning + degraded `list`, not data loss).

---

## Working Notes
