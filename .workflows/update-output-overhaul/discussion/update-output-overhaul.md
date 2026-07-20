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

  Discussion Map — Update Output Overhaul (15 subtopics — 8 decided · 7 pending)

  ├─ ✓ Per-unit progress output [decided]
  │  ├─ ✓ Spinner identity — name the unit, resolve inline [decided]
  │  └─ ✓ Inline outcome vs end-of-run summary loop [decided]
  ├─ ✓ Per-repo clone dedup [decided]
  │  ├─ ✓ Grouping updatable entries by source repo [decided]
  │  ├─ ✓ Clone ownership refactor (cloneAndReinstall / processUpdateForAll) [decided]
  │  └─ ✓ Failure isolation across shared-clone members [decided]
  ├─ ✓ Tag-based summary wording [decided]
  │  ├─ ✓ Tags-where-tagged vs hash fallback [decided]
  │  └─ ✓ Sourcing old/new tag (entry.ref + resolved tag) [decided]
  ├─ ○ Safe-vs-major bump gating [pending]
  │  ├─ ○ Audit: what constraint semantics already gate today [pending]
  │  ├─ ○ Blocking message: passive out-of-constraint → active re-add directive [pending]
  │  └─ ○ 0.x-line + exact-pin edge cases [pending]
  └─ ○ Scope boundary — existing-behaviour audit vs new build [pending]

---

*Subtopics are documented below as they reach `decided` or accumulate enough
exploration to capture.*

---

## Per-Unit Progress Output

### Context

Today all-mode's live output is a wall of anonymous `"Cloning repository..."` →
`"Cloned successfully"` lines (one per entry, no identity), and the user only learns
*what* changed at the very end when the summary loop prints outcomes
(`update.ts:588-609`). The clone-dedup decision reshapes the work: cloning is now
**per-group** (once per repo), while each install outcome is still **per-member**.
This subtopic designs the progress stream over that new shape.

### Spinner identity / progress unit — Decision

**Report at two granularities, each natural to its action (folds review F10):**

- **The clone/work step is per-group** — named once at the repo-group level
  (`Updating <owner/repo> … (N skills)`), because the clone is genuinely one
  per-repo action after dedup.
- **The outcome is per-member** — each member resolves its own line beneath the
  group header (`✓ design → claude`), because the per-install result is what the
  user acts on.
- **A standalone unit is a group of one** — its group header and single outcome
  collapse into one line (`✓ vendor/tool: Updated v1.2.3 → v1.3.0`), matching the
  seed's `Updating <key>… → <key>: Updated <old> → <new>`.

Illustrative shape:

```
◒ Updating rshankras/claude-code-apple-skills … (10 skills)
   ✓ design → claude
   ✓ macos  → claude
   …
✓ vendor/tool: Updated v1.2.3 → v1.3.0            ← group of one, collapsed
```

**Rejected: fully flat per-member** (every member its own `Updating owner/repo/x…`
line, clone invisible). More uniform with the singleton path, but discards the
one-clone-per-repo legibility dedup just bought and reintroduces a milder repetitive
wall (~N near-identical lines for a big collection).

*(Clone-failure rendering from the failure-isolation decision lands here: a
group-fatal clone failure renders as one grouped line under this group header, not N
copies.)*

### Outcome timing — Decision

**Actioned outcomes stream inline as each group completes; the end-of-run summary
loop shrinks to non-actioned check categories only.**

- **Per group:** a `p.spinner()` starts `Updating <repo>…` and spins through the
  clone (the slow part); on completion the per-member result lines are emitted as
  persistent `p.log.*` lines. A group's results appear the moment it finishes, in
  processing order.
- **The spinner does NOT tick live per member during reinstall** — it spins on the
  group name through the clone, then emits the per-member lines on completion.
  Per-member reinstalls are fast local file copies; live per-member ticking mostly
  flickers without adding signal. (Emit-on-completion, not live-per-member.)
- **End-of-run loop retained only for non-actioned check categories** —
  `up-to-date`, `newer-tags`, `check-failed`, `constrained-no-match` — plus the
  existing out-of-constraint footer. These never entered a processing group, so a
  tidy trailing summary is the right home.
- **Accounting unchanged.** `outcomes[]` is still collected to drive the single
  manifest write (`update.ts:507-530`) and the `hasFailedOutcome` exit code
  (`update.ts:618-631`); only *where actioned outcomes print* moves (on completion
  vs the end-loop), not what's tracked.

Net stream: `Checking for updates…` → streamed group results (each live) → trailing
summary of untouched / blocked-by-check entries → out-of-constraint footer.

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

**Group by the deterministic pre-resolution identity `(resolvedCloneUrl, ref,
constraint)`** — "entries whose version *intent* points at the same tree" — then
**resolve the target once per group** and clone once. The key is the identity
computable from the manifest alone (no network), *not* the resolved commit.

- `cloneSource` clones at a specific `--branch <ref>`. Two entries from the same
  repo with different version intent (`owner/repo/a@^1` vs `owner/repo/b@^2`,
  different `constraint`) must not share a clone → different groups. Same repo +
  same `(ref, constraint)` → one group, one clone.
- **Resolve the target once per group, not per member (folds review F3).** Each
  member's `checkForUpdate` is an independent live probe run in parallel
  (`update.ts:409-415`); if the remote advances mid-run, two members of one
  collection could resolve to *different* commits — splitting the group and
  installing one logical collection at divergent commits. This divergence is
  **pre-existing** (independent per-member checks already allow it today); resolving
  the group's target once, up front, eliminates it and guarantees a collection moves
  as a unit. This is *why* the key must be the pre-resolution identity: keying on the
  resolved `targetCommit` would re-admit the race before grouping even happens. The
  grouping key and "resolve once per group" are one decision, not two.
- Collection members collapse into one group **for free**: added atomically, they
  share `resolvedCloneUrl` + `ref` + `constraint`.
- **Local entries** (`commit === null`) never clone — excluded from grouping
  entirely; one reinstall each, unchanged.
- **The key uses the *resolved* clone URL** (via `deriveCloneUrlFromKey`), not the
  raw `entry.cloneUrl` field (which is `null` on legacy manifests). Otherwise a
  legacy entry and an explicit-URL entry for the same repo wouldn't collapse. This
  is a precision on the key, not a separate decision — there's one right answer.
  (review F1)
- **Grouping spans both processing loops** (`[...updateAvailable, ...local]` and
  `constrainedUpdateAvailable`, `update.ts:473-504`) — same-repo/same-target entries
  in different check categories must still collapse into one group. (review F2)
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
- **Preserves the per-member lexical `sourceSubpath` containment guard**
  (`assertSubpathWithinClone`, `clone-reinstall.ts:366-379`) — it must run **per
  member** in the orchestrator, since each member carries its own `sourceSubpath`
  and the bypassed code path currently owns it. A preservation constraint (dropping
  it is a path-traversal regression), so it's spec content, not a debate. (review F4)

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

### Not decided here — and why

Two review items are deliberately *not* decisions for this subtopic. Neither is
"deferred to planning" (planning originates no decisions — it captures the spec,
which captures this discussion):

- **Result→`PluginOutcome` mapping factoring** (orchestrator inside vs beside
  `processUpdateForAll`, shared-helper extraction) — **behaviourally invariant**:
  the observable outcomes are identical however it's wired. Pure code mechanics →
  the implementer's call. (review F6)
- **Clone-progress rendering on the grouped path** — a *real* design decision (the
  clone spinner in `cloneAndReinstall` vanishes from the grouped path), but it's
  owned by the **Per-Unit Progress Output** subtopic and decided *there*, not a
  mechanic and not lost. (review F5)

---

## Tag-Based Summary Wording

### Context

`update` reports commit hashes today (`${key}: Updated ${oldShort} -> ${newShort}`,
`summary.ts:220-228,261-277`), which installers don't recognise. The seed wants
semver tags where the repo is tagged (`Updated key from v1.2.3 to v1.3.0`), with a
short-hash fallback only for the untagged / HEAD-tracked case. The trap the KB
flagged (`update-check-fails-on-branch-ref`): a ref like `v4` can be a *branch*, so
the rule must not key off the lexical shape of the ref.

### Tags-where-tagged vs hash fallback — Decision

**Render `Updated <old> → <new>` in tags when both the old and new refs are genuine
version tags AND the ref actually moved; otherwise fall back to short commit
hashes.** The signal is *both refs being semver tags AND a ref move* — never the
string shape alone.

- **Constrained update** (`v1.2.3 → v1.3.0`): old ref = current tag, new ref =
  resolved `result.tag`; both parse as semver and differ → **tags**. This is the
  all-mode case that produces a tagged "updated" outcome.
- **HEAD-tracked** (`ref === null`) or **branch** (`main`): not a version tag →
  **hashes**.
- **Lexical trap closed for free**: `isVersionTag` is `clean()`-based
  (`version-resolve.ts:30`); `clean("v4")` is `null` (not a full semver), so a `v4`
  *branch* is correctly not treated as a tag → **hashes**.
- **Branch literally named `v4.0.0`, commit moved**: passes `isVersionTag`, but a
  branch update doesn't change the ref name (only the commit), so `oldRef ===
  newRef` → the "ref actually moved" guard sends it to **hashes**. This guard is why
  the rule is "both tags AND ref moved," not just "both tags."
- **Rejected: show tags whenever the new target is a tag** (even from a non-tag
  origin) — would render a misleading half-tagged move and doesn't survive the
  branch-named-like-semver edge.

### Sourcing old/new tag — Decision

Follows from the rule; the values are already at the outcome-construction site
(`update.ts:372-383`):

- **Old ref** = the pre-update `entry.ref`.
- **New ref** = the post-update `result.manifestEntry.ref` (= the resolved
  `result.tag` for a constrained update; unchanged from `entry.ref` for a
  branch/HEAD update, which is exactly why those land on the hash path).
- **Apply to both surfaces** — the single-key path (`renderGitUpdateSummary`) and
  all-mode (`renderUpdateOutcomeSummary`) both get the tag treatment, so wording
  can't drift between them.
- Threading the two refs into the render signature is mechanics → the implementer's
  call. What's decided here is *which values* feed it (old `entry.ref`, new resolved
  ref) and the rule they're tested against.

**Coupling note (review F9):** the outcome-summary plumbing
(`renderUpdateOutcomeSummary`, produced inside `processUpdateForAll`) is the *same*
call site the dedup ownership seam touches. Sequencing of the two changes is a
Scope-Boundary concern — flagged there, not resolved here.

---

## Summary

### Key Insights

*(to be captured as the discussion progresses)*

### Open Threads

*(none yet)*

### Current State

- Clone dedup: grouping key, ownership seam, and failure isolation decided.
  Review-001 refinements folded in as spec-level precision (resolved clone URL,
  grouping spans both loops, per-member lexical guard preserved). Outcome-mapping
  factoring left to the implementer; clone-progress rendering routed to Part 1.
- F3 resolved: single-resolved-commit per repo-group — folded into the grouping-key
  decision (key is pre-resolution identity; target resolved once per group).
- Per-repo clone dedup fully decided.
- Per-unit progress output fully decided: group header + per-member outcomes (F10),
  actioned outcomes stream inline (emit-on-completion), end-loop keeps non-actioned
  check categories only.
- Tag-based summary wording fully decided: tags when both refs are semver tags AND
  the ref moved, else hashes; old = entry.ref, new = resolved ref; applied to both
  update surfaces.
- Next: Safe-Vs-Major Bump Gating (Part 3). Review F9 (sequencing/coupling of parts
  2-3 with the seam plumbing) still to surface — lands under Scope Boundary.

## Triage

(none)
