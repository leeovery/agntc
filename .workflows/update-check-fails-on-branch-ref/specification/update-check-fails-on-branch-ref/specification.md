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

## Working Notes
