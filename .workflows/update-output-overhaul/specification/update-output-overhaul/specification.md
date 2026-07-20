# Specification: Update Output Overhaul

## Overview

`agntc update` all-plugins mode (invoked as `agntc update` with no key → `runAllUpdates`) produces opaque live output and reports commit hashes users can't recognise. This feature overhauls that surface. It bundles three interlocking parts, all landing on `src/commands/update.ts`, `src/clone-reinstall.ts`, `src/nuke-reinstall-pipeline.ts`, and `src/summary.ts`:

1. **Per-repo clone dedup + per-unit progress clarity** *(structural pivot — new build)*. Today every manifest entry clones independently and renders the same anonymous `"Cloning repository..."` → `"Cloned successfully"` spinner (`clone-reinstall.ts:336,349`), so a 10-member collection shallow-clones the same repo ~10× and prints a wall of identical anonymous lines; the user only learns *what* changed at the very end, when the per-plugin summary loop prints (`update.ts:588-609`). This part groups entries that would clone the identical tree, clones once per group, and streams a named per-group / per-member progress stream.

2. **Tag-based summary wording** *(reword over existing behaviour)*. `update` reports commit hashes (`Updated key: 6500f65 -> f395397`, `summary.ts:220-228,261-277`); where both refs are genuine semver tags it should speak in tags (`Updated key from v1.2.3 to v1.3.0`), falling back to short hashes for the untagged / HEAD-tracked / branch case.

3. **Safe-vs-major bump gating messaging** *(reword/verify over existing behaviour)*. The gating *behaviour* already exists entirely via semver caret semantics; the gap is purely messaging — the passive out-of-constraint footer becomes an actionable, mode-matched re-add directive.

## Scope Boundary

### New build vs reword/verify

- **New build:** clone dedup (grouping, per-group orchestrator, resolve/check-once-per-group) and the progress stream (group header + per-member inline outcomes). The structural weight of the feature.
- **Reword / verify over existing behaviour:** tag-vs-hash wording, the gating message (passive footer → actionable, mode-matched), and the all-mode `newer-tags` consistency fix. No new *logic* — gating and constraint resolution already work correctly.

### Build order — seam-first, one feature

Parts 2 and 3 both edit the outcome-summary plumbing (`renderUpdateOutcomeSummary`, constructed inside `processUpdateForAll`) — the same call site the dedup ownership seam (Part 1) refactors. They are **not independent**: doing the wording first and then refactoring that construction for dedup would rewrite the wording work. Therefore this ships as **one feature, built seam-first**:

- Part 1 reshapes `processUpdateForAll` and the per-member outcome model first;
- Parts 2/3 layer their wording onto the *new* outcome construction.

Sequenced phases within one unit, not three independent PRs.

### Output is human-only

`update` output is human-only — built entirely on clack (spinners, ANSI, gutter lines) with no `--json` mode. Nothing machine-parses it. The hash→tag switch and stream restructure are therefore **not a breaking change for any supported consumer**; there is no machine-readable output contract to preserve.

---

## Working Notes

[Optional - capture in-progress discussion if needed]
