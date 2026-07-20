# Discussion: Update Output Overhaul

## Context

`agntc update` (all-plugins mode) produces opaque live output and speaks in commit
hashes the user can't recognise. This feature bundles three interlocking parts, all
landing on the same surface (`src/commands/update.ts`, `src/clone-reinstall.ts`,
`src/nuke-reinstall-pipeline.ts`, `src/summary.ts`):

1. **Per-unit progress clarity.** Every plugin's clone step renders the same generic
   spinner text — `"Cloning repository..."` → `"Cloned successfully"`
   (`clone-reinstall.ts:336,349`) — with no unit identity. The user sees a stack of
   identical anonymous lines and only learns *what* changed at the very end, when the
   per-plugin summary loop prints outcomes (`update.ts:588-609`). Two root causes: the
   anonymous spinner, and redundant per-member cloning — collection members are
   independent manifest entries pointing at the same repo, so `cloneAndReinstall` is
   called once per member and the same repo is shallow-cloned ~10× for a 10-member
   collection (`update.ts:473-480` loop → `clone-reinstall.ts:305`).

2. **Tag-based summary wording.** `update` reports commit hashes
   (`Updated key: 6500f65 -> f395397`, `summary.ts:220-228,261-277`), which installers
   don't recognise. Where the repo is tagged it should speak in semver tags
   (`Updated key from v1.2.3 to v1.3.0`), falling back to short hashes only for the
   untagged / HEAD-tracked case.

3. **Safe-vs-major bump gating.** Confirm/align npm-style gating: auto-apply safe bumps
   (patch + minor within the constraint's major) and show the tag move; block a major
   bump (or a minor on a `0.x` line), naming current vs newer and directing the user to
   re-add explicitly. Part of the work is auditing what already exists (constraint
   resolution in `update-check.ts`/`version-resolve.ts`, `list` out-of-constraint
   display, `update` summary wording) and closing the gap.

### References

- Seed: `seeds/2026-07-19-update-progress-clarity.md` (progress + clone dedup)
- Seed: `seeds/2026-06-09-show-version-tags-on-update.md` (tags + gating)
- Discovery: `.workflows/update-output-overhaul/discovery/sessions/session-001.md`

## Discussion Map

### States

- **pending** (`○`) — identified but not yet explored
- **exploring** (`◐`) — actively being discussed
- **converging** (`→`) — narrowing toward a decision
- **decided** (`✓`) — decision reached with rationale documented

### Map

  Discussion Map — Update Output Overhaul (15 subtopics — 3 decided · 1 exploring · 11 pending)

  ├─ ○ Per-unit progress output [pending]
  │  ├─ ○ Spinner identity — name the unit, resolve inline [pending]
  │  └─ ○ Inline outcome vs end-of-run summary loop [pending]
  ├─ ◐ Per-repo clone dedup [exploring]
  │  ├─ ✓ Grouping updatable entries by source repo [decided]
  │  ├─ ✓ Clone ownership refactor (cloneAndReinstall / processUpdateForAll) [decided]
  │  └─ ✓ Failure isolation across shared-clone members [decided]
  ├─ ○ Tag-based summary wording [pending]
  │  ├─ ○ Tags-where-tagged vs hash fallback [pending]
  │  └─ ○ Sourcing old/new tag (entry.ref + resolved tag) [pending]
  ├─ ○ Safe-vs-major bump gating [pending]
  │  ├─ ○ Audit: what constraint semantics already gate today [pending]
  │  ├─ ○ Blocking message: passive out-of-constraint → active re-add directive [pending]
  │  └─ ○ 0.x-line + exact-pin edge cases [pending]
  └─ ○ Scope boundary — existing-behaviour audit vs new build [pending]

---

*Subtopics are documented below as they reach `decided` or accumulate enough
exploration to capture.*

---

## Per-Repo Clone Dedup

### Context

`agntc update` (all-mode) processes each manifest entry independently, and each
entry's `cloneAndReinstall` owns a full clone lifecycle: `cloneSource` does
`git clone --depth 1 --branch <ref> <url>` of the **whole repo** into a fresh
mkdtemp dir, reinstalls, then `cleanupTempDir` in a `finally`
(`clone-reinstall.ts:334-405`, `git-clone.ts:30-49`). Collection members are
independent entries pointing at the same repo, so a 10-member collection produces
10 identical full clones at the identical ref — both the source of the repeated
anonymous "Cloned successfully" noise and a real network/disk/time cost. The fix
groups entries that would clone the identical tree, clones once per group, and
reinstalls all members from that single clone.

### Grouping key — Decision

**Group by the triple `(cloneUrl, targetRef, targetCommit)`** — "entries that would
clone the identical tree" — not by `cloneUrl` alone.

- `cloneSource` clones at a specific `--branch <ref>`, and `update` resolves a
  target ref/commit *per entry* during the check phase. Two entries from the same
  repo can resolve to different targets (e.g. `owner/repo/a@^1` and
  `owner/repo/b@^2`), so keying on `cloneUrl` alone would wrongly force them to
  share one clone. The triple splits divergent members into separate groups (each
  clones its own tree) while collapsing convergent ones.
- Collection members collapse into one group **for free**: added atomically, they
  share `cloneUrl` + `constraint` + `ref`, and the check resolves them all to the
  same `(targetRef, targetCommit)`.
- **Local entries** (`commit === null`) never clone — excluded from grouping
  entirely; one reinstall each, unchanged.
- Considered and rejected: "clone once at the newest ref, check out per member."
  Adds checkout complexity and a shared mutable working tree for marginal benefit;
  the triple-key with per-group clones is simpler and the common case
  (a real collection) already collapses to one clone.

### Clone ownership seam — Decision

**Extract `cloneRepoOnce()` and add a group orchestrator used by all-mode only;
leave `cloneAndReinstall` as-is for the three singleton entry points** (single-key
`update <key>`, and both `list` actions).

- The reinstall half is *already* clone-agnostic: `runPipeline` takes
  `{sourceDir, cloneRoot}` separately (`clone-reinstall.ts:435`) and
  `executeNukeAndReinstall` scopes the symlink-escape boundary to `cloneRoot`
  while installing from `sourceDir` (`nuke-reinstall-pipeline.ts:109`). So the
  orchestrator clones once, then loops members through `runPipeline` with
  `cloneRoot = sharedTempDir` and
  `sourceDir = resolveUpdateSourceDir(sharedTempDir, memberKey, subpath)`,
  cleaning up once after all members.
- **Rejected: unify all four entry points through one grouped primitive.** All-mode
  is the only site with a collection to dedup; the three singletons are correct and
  battle-tested. Unifying would rewrite three working call sites for zero dedup
  benefit and a larger blast radius.

### Failure isolation — Decision

Two failure classes, handled differently; the shared clone is read-only during
reinstall, so it survives per-member failures and is torn down once.

**Clone failure (group-fatal).** `cloneRepoOnce` throws (network/auth/ref gone;
`cloneSource` already retries 3× internally, so a throw is final). Every member of
the group becomes a `failed` outcome attributed to its own key.
- **No manifest mutation** — `clone-failed` doesn't remove entries (only
  `copy-failed` does, `update.ts:521`), so all N installs stay intact.
- **Exit accounting unchanged** — N `failed` outcomes trip `hasFailedOutcome`
  (`update.ts:618-631`) → non-zero exit, same as today.
- **Rendering** collapses to **one grouped line** (`owner/repo: clone failed —
  affects N members: a, b, c`) so a group failure doesn't reintroduce the
  "stack of identical anonymous lines" this feature exists to kill. The *model*
  stays N outcomes (for accounting); only the *display* groups. The actual
  rendering is owned by the Per-Unit Progress Output subtopic and deferred there.
  (Addresses review F7.)

**Reinstall failure (per-member, isolated).** Once the clone exists, each member
runs its own `runPipeline` against it. `copy-failed` / `aborted` / `blocked` /
`no-agents` stay exactly per-member — one member's `copy-failed` removes *its* entry
and siblings continue. Verbatim today's behaviour; dedup doesn't touch it.

**Lifecycle.** Clone once → members reinstalled **sequentially** (deterministic
output ordering for the progress stream; the network cost is already gone after one
clone; parallel reinstall-from-shared-clone is safe on a read-only source but
deferred as a later optimization) → each member wrapped in its **own try/catch** so
an unexpected throw is contained to that member (mirrors `processUpdateForAll`'s
existing wrapper, `update.ts:295,384-390`) → `cleanupTempDir` **once** in a `finally`
that wraps the **entire member loop**, so no member's throw skips the shared cleanup
or aborts remaining siblings. (Addresses review F8.)

**Interrupt (noted).** The shared temp dir now spans N reinstalls instead of one, so
a SIGINT mid-loop leaves it behind — but this is **no worse than today** (each
per-entry `finally` has the same SIGINT gap, and dedup means *fewer* temp dirs in
flight). Not solving process-signal cleanup in this work; noted so it isn't mistaken
for a regression.

### Copy-safety boundary — unchanged (noted, not a decision)

No security regression: today's remote branch *already* sets `cloneRoot = tempDir`
(whole clone) with `sourceDir = member subpath` (`clone-reinstall.ts:392-394`).
Sharing the physical clone across members keeps the identical boundary —
cross-member symlinks inside the clone allowed, escapes beyond it rejected. Dedup
changes how many times we clone, not what counts as an escape.

---

## Summary

### Key Insights

*(to be captured as the discussion progresses)*

### Open Threads

*(none yet)*

### Current State

- Clone dedup: grouping key, ownership seam, and failure isolation decided in
  direction. Review-001 surfaced refinements to the grouping-key sourcing and the
  ownership seam (cloneUrl normalization, per-variant target sourcing, TOCTOU split,
  per-member lexical guard, spinner/outcome-mapping ownership) — to walk through.

## Triage

(none)
