# Discovery Session 001

Date: 2026-07-19
Work unit: update-output-overhaul

## Description (as of session)

Improve `agntc update` output: per-unit progress clarity, semver-tag summary wording, and safe-vs-major bump gating.

## Seed

- seeds/2026-07-19-update-progress-clarity.md (inbox:idea)
- seeds/2026-06-09-show-version-tags-on-update.md (inbox:idea)

## Imports

(none)

## Map State at Start

(n/a — single-topic work)

## Exploration

The work originated from two inbox ideas that both land on the same command surface — `agntc update` — and were confirmed as one coherent feature.

The trigger was a live `agntc update` run whose output was opaque: every plugin's clone step renders the same generic spinner text (`"Cloning repository..."` → `"Cloned successfully"`) with no plugin key attached, producing a stack of identical anonymous lines. The user only learns *what* was updated at the very end, when the per-plugin summary loop prints `Updated <old> -> <new>`. Two root causes were identified against the code: (1) the clone spinner in `clone-reinstall.ts` (~lines 336, 349) has no unit identity — it should name the unit and ideally resolve straight to that unit's outcome inline; (2) collection members are independent manifest entries pointing at the same source repo, so `cloneAndReinstall` is called per-member and the same repo is shallow-cloned ~10× for a 10-member collection — the source of both the repeated "Cloned successfully" noise and a real performance cost. The fix direction bundles naming units in the spinner (moving outcomes inline instead of batching them into the end-of-run summary loop in `update.ts` ~lines 587-609) with deduping cloning per source repo (grouping updatable entries by repo, cloning each once, reinstalling all members from that clone — a larger structural change to clone ownership and the processing loop in `processUpdateForAll`).

The second idea folds into the same output pass: `update` currently reports commit hashes (`Updated …: 6500f65 -> f395397`), which installers don't recognise. Where the repo is tagged it should speak in semver tags (`Updated … from v1.2.3 to v1.3.0`), falling back to short commit hashes only for the untagged / HEAD-tracked case. The user explicitly confirmed that the associated semver-gating behaviour is *in scope*: `update` should auto-apply safe bumps (patch + minor within the constraint's major) and show the tag move, while a major bump (or a minor on a `0.x` line) is not auto-applied — it's blocked with a message naming the current vs newer version and directing the user to explicitly re-add. Part of this work is verifying what already exists today (constraint resolution, `list` out-of-constraint display, `update` summary wording) and closing the gap.

Shaping settled the type quickly: one command's UX with three interlocking parts (per-unit progress, tag-based summary wording, safe-vs-major gating), all touching the same `update.ts` / `clone-reinstall.ts` / `nuke-reinstall-pipeline.ts` surface — a single coherent feature, not an epic (no multiplying topics), not a bugfix (improving working behaviour), and more than a quick-fix (the gating carries real behaviour design and the clone dedup is a structural refactor).

## Edits

(none)

## Topics Identified

(none)

## Conclusion

(none)
