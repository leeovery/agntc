---
status: complete
created: 2026-07-02
cycle: 2
phase: Gap Analysis
topic: Update Check Fails On Branch Ref
---

# Review Tracking: Update Check Fails On Branch Ref - Gap Analysis

## Findings

### 1. Probe `ls-remote` timeout value unstated

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Solution — "Classification probe"; Scope & Constraints — "In scope" (`execGit` reuse)

**Details**:
The spec gives the exact probe command (`git ls-remote <url> refs/heads/{ref} refs/tags/{ref}`) and states `execGit` is reused to run it, but never states the timeout to pass. Every existing `ls-remote` call in the module (`checkHead`, `checkBranch`, `fetchRemoteTagRefs`) explicitly passes `{ timeout: 15_000 }`, whereas `execGit`'s own default is `30_000`. So "reuse `execGit`" does not resolve the value by itself — the implementer must choose between the module-wide 15s convention and the 30s default, and those diverge. This is a real (small) decision left open. Recommend stating that the probe uses the same 15s timeout as the sibling `ls-remote` calls so behaviour stays consistent with the paths it replaces.

**Proposed Addition**:
Add after the probe command block: "Run it via `execGit` with the module's standard `{ timeout: 15_000 }` — matching the sibling `ls-remote` calls (`checkHead`, `checkBranch`, `fetchRemoteTagRefs`), not `execGit`'s 30s default."

**Resolution**: Approved
**Notes**:

---
