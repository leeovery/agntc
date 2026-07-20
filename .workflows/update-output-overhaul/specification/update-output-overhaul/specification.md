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

## Per-Repo Clone Dedup

The fix groups manifest entries that would clone the identical tree, clones once per group, and reinstalls all members from that single clone. Today each entry's `cloneAndReinstall` owns a full clone lifecycle (`git clone --depth 1 --branch <ref>` of the whole repo into a fresh mkdtemp dir, reinstall, then cleanup in `finally`), so a 10-member collection produces 10 identical full clones at the identical ref — the source of both the repeated anonymous "Cloned successfully" noise and a real network/disk/time cost.

### Grouping key

**Group by the deterministic pre-resolution identity `(resolvedCloneUrl, ref, constraint)`** — "entries whose version *intent* points at the same tree" — then **resolve the target once per group** and clone once. The key is the identity computable from the manifest alone (no network), *not* the resolved commit.

- `cloneSource` clones at a specific `--branch <ref>`. Two entries from the same repo with different version intent (`owner/repo/a@^1` vs `owner/repo/b@^2` — different `constraint`) must not share a clone → different groups. Same repo + same `(ref, constraint)` → one group, one clone.
- **The key uses the *resolved* clone URL** (via `deriveCloneUrlFromKey(key, entry.cloneUrl)`), not the raw `entry.cloneUrl` field (which is `null` on legacy manifests). Otherwise a legacy entry and an explicit-URL entry for the same repo wouldn't collapse.
- Collection members collapse into one group **for free**: added atomically, they share `resolvedCloneUrl` + `ref` + `constraint`.
- **Local entries** (`commit === null`) never clone — excluded from grouping entirely; one reinstall each, unchanged.

### Group-first pipeline — check/resolve once per group

Because the key is computable from the manifest with no network, grouping happens *before* the update check. The pipeline becomes:

**group (from manifest) → resolve/check once per group → categorize members against the shared target → clone once if the group is updatable → reinstall members.**

One network resolution runs per group (one `checkForUpdate`-equivalent probe resolving the group's target tag+commit), then each member's category is computed against that shared target using the member's *own* installed commit. This closes the per-member check race at both levels and removes redundant probes:

- **Commit-level race:** today's per-member parallel probes (`update.ts:409-415`) could resolve two members of one collection to *different* commits if the remote advanced mid-run. One resolution per group → one target for all.
- **Category-level race:** the same mid-run push could make two members *resolve to different targets* — member A's probe sees `[v1.2.3]`, member B's a moment later sees `[v1.2.3, v1.3.0]`. One resolution per group yields a **single** target for all members, so no member lands on a different commit than its siblings.
- **Probe dedup:** a 10-member collection does 10 identical `ls-remote` probes today; one probe per group removes that redundancy, mirroring the clone dedup one layer up.

The key **must** be the pre-resolution identity — keying on the resolved `targetCommit` would re-admit the race before grouping even happens. Grouping key, "check/resolve once per group," and "collection moves as a unit" are one decision.

### Genuine-state splits are intended

Members compare their own installed commit against the shared resolved target — so within one group, a member already at the target is **up-to-date** while a behind sibling **updates**. This genuine-state split (e.g. a member updated singly before) is intended and expected: the group shares a *target*, not a *category*. Only the *race*-induced split is what group-first closes.

### Grouping spans both processing loops

Same-repo/same-target entries across the two all-mode processing loops (`[...updateAvailable, ...local]` and `constrainedUpdateAvailable`, `update.ts:473-504`) — which today live in different check categories — must still collapse into one group.

### Rejected alternative

**"Clone once at the newest ref, check out per member."** Adds checkout complexity and a shared mutable working tree for marginal benefit; the triple-key with per-group clones is simpler, and the common case (a real collection) already collapses to one clone.

### Clone ownership seam — orchestrator

**Extract `cloneRepoOnce()` and add a group orchestrator used by all-mode only; leave `cloneAndReinstall` as-is for the three singleton entry points** — single-key `update <key>`, and both `list` actions (update + change-version).

- The reinstall half is *already* clone-agnostic: `runPipeline` takes `{sourceDir, cloneRoot}` separately (`clone-reinstall.ts:435`), and `executeNukeAndReinstall` scopes the symlink-escape boundary to `cloneRoot` while installing from `sourceDir` (`nuke-reinstall-pipeline.ts:109`). So the orchestrator **clones once**, then loops members through `runPipeline` with `cloneRoot = sharedTempDir` and `sourceDir = resolveUpdateSourceDir(sharedTempDir, memberKey, entry.sourceSubpath)`, cleaning up once after all members.
- **Preserves the per-member lexical `sourceSubpath` containment guard** (`assertSubpathWithinClone`, `clone-reinstall.ts:366-379`). It must run **per member** in the orchestrator, since each member carries its own `sourceSubpath` and the bypassed code path currently owns it. Dropping it is a path-traversal regression — this is a preservation constraint, not a design choice.
- **Rejected: unify all four entry points through one grouped primitive.** All-mode is the only site with a collection to dedup; the three singletons are correct and battle-tested. Unifying would rewrite three working call sites for zero dedup benefit and a larger blast radius.

### Left to the implementer (behaviourally invariant)

Two items are deliberately *not* decisions — the observable behaviour is identical however they're wired, so they are pure code mechanics:

- **Result → `PluginOutcome` mapping factoring** — whether the orchestrator lives inside vs beside `processUpdateForAll`, and whether a shared helper is extracted. The emitted outcomes are the same either way.
- **Threading the resolved old/new refs into the tag-render signature** (see *Tag-Based Summary Wording*) — the *values* that feed it and the rule they're tested against are decided; the plumbing is not.

*(Clone-progress rendering on the grouped path — where the old per-clone spinner in `cloneAndReinstall` vanishes from the grouped path — is a real design decision, but it is owned by* Per-Unit Progress Output *and specified there, not here.)*

---

## Working Notes

[Optional - capture in-progress discussion if needed]
