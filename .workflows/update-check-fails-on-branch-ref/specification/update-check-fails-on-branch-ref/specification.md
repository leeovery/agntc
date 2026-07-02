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

Parse which of the two matched, keying strictly off the ref-path prefix (`refs/heads/` vs `refs/tags/`; ignore peeled `^{}` lines from annotated tags):

- **Only `refs/heads/{ref}`** → branch → branch-comparison path.
- **Only `refs/tags/{ref}`** → tag → tag-comparison path.
- **Both** → tiebreak (below).
- **Neither** → `check-failed`, reason `Ref '{ref}' not found on remote as a branch or tag`.

### Tiebreak: both a branch and a tag named `{ref}`

Resolve to the **tag**, mirroring git's own ref-resolution precedence (gitrevisions disambiguates a bare name with `refs/tags/` before `refs/heads/`). Deterministic and matches "what git would do with this bare name." The manifest records no ref-type intent, so this is the principled default rather than a guess at what the installer meant. This is the one edge the investigation explicitly deferred to the specification.

### Comparison paths (behaviour preserved)

- **Branch:** compare the `refs/heads/{ref}` tip sha against the installed commit → `up-to-date` or `update-available`. Behaviourally identical to today's `checkBranch`. The probe already fetched the tip sha, so this path may reuse it instead of re-fetching.
- **Tag:** fetch all tags, find those newer than `{ref}` → `newer-tags` or `up-to-date`. Identical to today's `checkTag`.

### Error handling

- Any `ls-remote` network/exec failure → `check-failed` carrying the error message (as today).
- Ref found as neither branch nor tag (e.g. deleted upstream) → `check-failed` with the unified reason above.

---

## Scope & Constraints

### In scope

- **`src/update-check.ts`** — reshape the `checkForUpdate` dispatch; remove `isTagRef`; add the classification probe, its parsing, and branch/tag routing.
- Optionally a small ref-existence helper (e.g. in `src/git-utils.ts`) for the probe — implementation's call; the existing `execGit` / `parseLsRemoteSha` / `parseTagRefs` primitives already suffice.

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
- Cost at most one extra `ls-remote` round-trip versus today; the branch path reuses the probe's sha rather than issuing a second lookup.

---

## Working Notes
