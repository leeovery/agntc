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

  Discussion Map — Update Output Overhaul (15 subtopics — 15 decided)

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
  ├─ ✓ Safe-vs-major bump gating [decided]
  │  ├─ ✓ Audit: what constraint semantics already gate today [decided]
  │  ├─ ✓ Blocking message: passive out-of-constraint → active re-add directive [decided]
  │  └─ ✓ 0.x-line + exact-pin edge cases [decided]
  └─ ✓ Scope boundary — existing-behaviour audit vs new build [decided]

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
- **Persist per group, before streaming its outcomes (review 003 F3).** Today the
  manifest is written once at the end (`update.ts:507-530`), *before* the summary
  loop prints — so a ✓ implies a persisted entry. Emit-on-completion would invert
  that (✓ streams before the single end write), so a failed write or Ctrl-C after
  some ✓ lines printed would show units as succeeded while the manifest still records
  the old commit. **Decision:** write the manifest **per group, right before
  streaming that group's ✓** — so the ✓ is honest (persisted before shown) and an
  interrupt leaves the manifest *matching disk* (early groups recorded, later ones
  not — accurate, so recovery does less redundant work). Trades the single write for
  a few cheap incremental writes (manifests are small). `outcomes[]` is still
  collected for the `hasFailedOutcome` exit code (`update.ts:618-631`); what changes
  is *when* the manifest persists (per group, not one end-of-run write).

Net stream: `Checking for updates…` → streamed group results (each live) → trailing
summary of untouched / blocked-by-check entries → out-of-constraint footer.

### Partial collections & counts — Decision (review F1)

Group membership is decided by each member's `checkForUpdate` category
(`update.ts:428-455`) *before* grouping, so only *updatable* members join a group;
up-to-date siblings fall to the trailing summary. This is **intended**: the group is
"updates from a repo," not "the whole collection" — forcing 7 unchanged members
inline every run would be noise.

- **Up-to-date siblings collapse per-repo in the trailing summary** —
  `owner/repo: 7 up to date` as one line, not 7 — so a mostly-unchanged collection
  doesn't become its own mini-wall.
- **Per-repo collapse spans *every* trailing category (review 003 F4)** — not just
  up-to-date and out-of-constraint, but also `newer-tags`, `check-failed`, and
  `constrained-no-match` (`update.ts:533-570`). An exact-pinned 10-member collection
  otherwise emits 10 near-identical `newer-tags` lines — the wall, resurfacing. This
  falls out of the **group-first check (F2)**: one check per group → one category →
  one trailing line per repo-group, automatically. One line per repo-group
  everywhere — updates, up-to-date, out-of-constraint, newer-tags, check-failed,
  constrained-no-match.
- **Group-of-one collapse is fine** — a single updated member of a collection
  collapses to `✓ owner/repo/member: Updated…`; the `/member` suffix already
  distinguishes it from a true standalone (`owner/repo`), so collection context
  isn't lost.
- **Header count/noun is generic** — `(N members)` counting the members *updated in
  this group*, not `(N skills)`; a collection can hold plugin members (agents/hooks),
  not only skills.

### Version move & dropped-agents placement — Decision (review F1)

The tag-wording decision renders `Updated <old> → <new>`, but the per-member line is
`✓ member → agents` (agents, not version) — so a *multi-member* collection would show
the version move *nowhere* (a standalone shows it, a collection doesn't). The
`formatDroppedAgentsSuffix` "support removed by author" notice
(`summary.ts:261-277`) likewise had no home in the member line. Placement:

- **Version move → the group header.** "Resolve once per group" makes the old→new a
  single shared group property, so it belongs on the header:
  `◒ Updating owner/repo  v1.2.3 → v1.3.0  (10 members)`. This is where the
  tag-vs-hash rule renders for the grouped path.
- **Dropped-agents notice → the member line.** Agent support is per-member (each
  member's config can drop agents independently), so it rides its own line:
  `✓ macos → claude  (codex support removed by author)`.
- **Group-of-one** unchanged — collapses to one line carrying the version
  (`✓ vendor/tool: Updated v1.2.3 → v1.3.0`).

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
- **Group *first*, then check once per group — not per member (folds review F3 +
  F2).** Because the key is computable from the manifest with no network, grouping
  happens *before* the update check: group by identity, run **one**
  `checkForUpdate` per group, and categorize the whole group as a unit. This closes
  the per-member check race at *both* levels:
  - **Commit-level (F3):** per-member parallel probes (`update.ts:409-415`) could
    resolve two members of one collection to *different* commits if the remote
    advanced mid-run — one check per group means one resolved target for all.
  - **Category-level (F2):** the same mid-run push could put member A in
    `up-to-date` (trailing summary) and member B in `update-available` (updates) —
    splitting the collection across *categories* before grouping even runs.
    Check-once-per-group categorizes the group as a whole, so no member can diverge
    into a different category.
  - **Bonus — check dedup:** a 10-member collection does 10 identical `ls-remote`
    probes today; one probe per group removes that redundancy, mirroring the clone
    dedup one layer up.
  This is *why* the key must be the pre-resolution identity: keying on the resolved
  `targetCommit` would re-admit the race before grouping even happens. Grouping key,
  "check/resolve once per group," and "collection moves as a unit" are one decision.
  The resulting pipeline: **group (from manifest) → check once per group →
  categorize group → clone once if updatable → reinstall members.**
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

## Safe-Vs-Major Bump Gating

### Context

The seed asks to confirm/align npm-style gating: auto-apply safe bumps (patch/minor
within the major), block a major (or a minor on a `0.x` line) and direct the user to
re-add explicitly, naming current-vs-newer. Part of the task is auditing what already
exists before building.

### Audit — what already gates today (Decision: behaviour is done, gap is messaging)

The *gating behaviour* already exists, entirely via semver caret semantics:

- **Safe bumps auto-apply.** `checkConstrained` → `maxSatisfying(constraint, tags)`
  (`update-check.ts:211`); a patch/minor within the major advances `best` →
  `constrained-update-available` → auto-applied in all-mode (`update.ts:483-504`).
- **Major bumps are already gated.** `^1.2.3` = `>=1.2.3 <2.0.0`, so `2.0.0` never
  satisfies → can't be auto-applied; it surfaces as `latestOverall` in the
  out-of-constraint footer (`summary.ts:294-306`).
- **0.x-minor is already gated identically.** `^0.3.3` = `>=0.3.3 <0.4.0` (caret on
  0.x pins the minor), so `0.4.0` is out of constraint — same path as a major.
  agntc itself is at v0.3.3, so this is the live case.
- **Exact-pin already blocks with a re-add directive.** `newer-tags` → the
  single-key path prints `To upgrade: npx agntc add <key>@<newest>`
  (`update.ts:151`).

**Conclusion:** no resolver/gating work. The gap is purely *messaging*.

### Blocking message — Decision (passive footer → actionable, mode-matched)

- **Tone: informative opt-in, not an error.** A major-available situation is the
  constraint doing its job (holding the unit at its major), not a failure. No error
  styling; **exit stays 0**; it does not feed `hasFailedOutcome`.
- **Upgrade the out-of-constraint message from passive to actionable.** Today:
  `Newer versions outside constraints: key 2.0.0 available (constraint: ^1.2.3)`.
  Target: name the current version vs the newer one *and* give the exact re-add
  command to cross the boundary.
- **Re-add suggestion matches the user's existing versioning mode:**
  - **Constrained / caret user** → suggest **bare `npx agntc add owner/repo`**. A
    bare add re-resolves the latest semver tag and stores the default
    `^major.minor.patch` constraint, so it jumps to the newest major *and*
    re-establishes caret tracking — the user needn't know it's `^2`. Chosen over
    `@^2` for simplicity; the prose names the target version, the command stays
    trivial.
  - **Exact-pin user** (`newer-tags`, no constraint) → keep suggesting a specific
    **`@<newest>`** tag, as today. This user deliberately pinned an exact tag; a bare
    re-add would silently switch them into caret tracking — a versioning-mode change
    they didn't ask for.
  - Rule: **suggest the re-add that preserves how they pinned.**
- **Names the *post-bump* current version (review F2).** The out-of-constraint info
  is captured at check time (`update.ts:458-468`), *before* a same-run safe bump is
  applied. Naming the pre-bump `entry.ref` would report a stale current: for
  `v1.2.3` on `^1.2.3` with remote `v1.3.0` + `v2.0.0`, the run auto-applies `v1.3.0`
  but the footer would say "current `v1.2.3` → `v2.0.0`" — contradicting the
  `Updated v1.2.3 → v1.3.0` line right above it. **Decision:** the footer names the
  version this run actually landed on (`v1.3.0 → v2.0.0`), so it's consistent with
  the inline outcome. Requires the footer's current-version reference to come from
  the post-bump entry, not the pre-run ref (`OutOfConstraintInfo` carries no current
  version today — `summary.ts:288-292` — so the applied version must be threaded in;
  that plumbing is mechanics). When no safe bump happened this run, pre and post
  coincide — the divergence only bites after a same-run bump.
- **The footer collapses per repo-group, not per member (review F3).** Today
  `renderOutOfConstraintSection` emits one line per key (`summary.ts:294-306`); a
  major-available N-member collection (members share ref + constraint) produces N
  near-identical actionable lines — the exact "wall of identical lines" Part 1
  exists to kill, reappearing in the footer. **Decision:** collapse to **one line
  per repo-group**, reusing Part 1's grouping. At that repo level the bare
  `npx agntc add owner/repo` re-add is *correct* — for a collection it re-adds the
  collection (re-selecting members at the new major), for a standalone it re-adds the
  plugin. The member-key vs bare-command mismatch only looked wrong because the
  footer was per-member; per-repo collapse fixes both at once.

### 0.x-line + exact-pin edge cases — Decision (confirmations)

- **0.x-minor** confirmed gated by caret (above) — no special-casing needed; it
  rides the same out-of-constraint path as a major, with the same actionable
  message.
- **Consistency fix:** the all-mode `newer-tags` line (`update.ts:541`) currently
  says "newer tags available (latest: X)" but omits the `agntc add` command the
  single-key path includes. Align it so exact-pin messaging is consistent across
  single-key and all-mode.

### Exit-code posture: single-key vs all-mode — Decision (review F4)

`check-failed` and `constrained-no-match` exit differently by mode today, and the
divergence is **intentional — keep it, and state it explicitly**:

- **Single-key** `update <key>` exits `1` on both (`update.ts:139-142`, `160-165`):
  the one plugin you targeted couldn't be checked / has no matching tag → the
  requested action didn't happen.
- **All-mode** `update` warns and exits `0` (both excluded from `hasFailedOutcome`,
  `update.ts:623-630`): a batch shouldn't be sunk by one dead remote or one stuck
  constraint when everything else succeeded — partial-success, failure surfaced as a
  warning. Consistent with the existing posture where only
  `aborted`/`blocked`/`failed`/`copy-failed` trip the non-zero exit.

Not a change — a ratification. The mode-consistency work (aligning `newer-tags`
wording) sits right next to this, so the posture is recorded rather than left
silent.

---

## Scope Boundary

### Context

Part of the seed is separating what already exists (verify + reword) from genuinely
new build, and — since all three parts touch the same `update` surface — deciding how
they're sequenced (review F9).

### Audit line — new build vs reword/verify

- **New build:** clone dedup (grouping, per-group orchestrator, resolve-once-per-
  group) and the progress stream (group header + per-member inline outcomes). The
  structural weight of the feature.
- **Reword / verify over existing behaviour:** tag-vs-hash wording, the gating
  message (passive footer → actionable, mode-matched), and the all-mode `newer-tags`
  consistency fix. No new *logic* — gating and constraint resolution already work.

### Build order — Decision (seam-first, one feature)

Parts 2 and 3 both edit the outcome-summary plumbing
(`renderUpdateOutcomeSummary`, built inside `processUpdateForAll`) — the *same* call
site the dedup ownership seam (Part 1) refactors. They are **not independent**:
doing the wording first and then refactoring that construction for dedup would mean
rewriting the wording work. So:

- **One feature, built seam-first.** Part 1 reshapes `processUpdateForAll` and the
  per-member outcome model first; Parts 2/3 layer their wording onto the *new*
  outcome construction. Sequenced phases within one unit, not three independent PRs.
- (Call made by the orchestrator on the user's delegation — a low-stakes ordering
  decision with a clear dependency.)

### Testing (scope note, not a decision to litigate)

The seam routes all-mode through a new grouped orchestration while the three
singleton entry points stay on the old path. Regression coverage for the shared
reinstall half (existing `update` tests still green) plus new coverage for the
grouped/dedup path belongs in the build. (review Observations)

### Output is human-only — confirmed (review F5)

`update` output is human-only: it's built entirely on clack (spinners, ANSI, gutter
lines) with no `--json` mode, so nothing machine-parses it today. The hash→tag
switch and stream restructure are therefore **not a breaking change for any
supported consumer** — there is no machine-readable output contract to preserve.
(Confirmed with the maintainer.)

---

## Summary

### Key Insights

1. **Clone dedup is the structural pivot the whole feature hangs off.** Cloning
   moves from per-entry to per-repo-group; the progress stream, failure model, and
   the tag/gating wording all sit downstream of that ownership change.
2. **Group first, then check/resolve/clone once per group.** The key is a
   pre-resolution identity (`(resolvedCloneUrl, ref, constraint)`) computable from
   the manifest, so grouping precedes the network entirely: one `checkForUpdate` and
   one clone per group. That single move dedups clones *and* `ls-remote` probes, and
   genuinely guarantees a collection moves as one unit — closing the per-member check
   race at both the commit and category levels.
3. **Two of the three parts are mostly already built.** Gating behaviour exists
   entirely via semver caret semantics (safe bumps auto-apply; major and 0.x-minor
   already fall out of constraint); tag-vs-hash and gating are *messaging* changes,
   not logic. The work concentrates in Part 1 (dedup + progress).
4. **Taggedness is a data property, not a string shape.** The tag-vs-hash rule keys
   off both refs being semver tags *and* the ref having moved — never the lexical
   shape — which closes the `v4`-is-a-branch trap for free.
5. **Re-add suggestions match the user's pinning mode.** Caret users get a bare
   re-add (latest + default caret); exact-pin users get a specific `@<newest>` tag —
   preserving how they chose to pin.

### Open Threads

- **Parallel reinstall within a group** — deferred as a later optimization; the
  network win is already captured by cloning once. Sequential for now.
- **SIGINT/interrupt cleanup of the shared temp dir** — out of scope; noted as no
  worse than today (fewer temp dirs in flight, not more).
- **Outcome-mapping factoring** (orchestrator inside vs beside `processUpdateForAll`)
  — left to the implementer; behaviourally invariant.

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
- Safe-vs-major gating fully decided: behaviour already exists (caret semantics);
  gap is messaging — informative (exit 0), actionable re-add matched to the user's
  pinning mode (caret → bare re-add; exact-pin → `@<newest>`); align all-mode
  newer-tags wording with single-key.
- All 15 subtopics decided. Scope boundary set: seam-first, one feature; audit line
  drawn (new build = dedup + progress; reword = tag/gating wording); testing scoped.
- Three review cycles (001, 002, 003) fully incorporated. Review-003's seam findings
  folded in: version move on group header + dropped-agents on member line (F1),
  group-first check dedup closing the category-split race + ls-remote dedup (F2),
  per-group manifest persistence before streaming (F3), per-repo collapse across all
  trailing categories (F4).
- Ready to conclude.

## Triage

(none)
