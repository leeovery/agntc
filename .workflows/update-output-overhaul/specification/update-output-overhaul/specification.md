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

**Group by the deterministic pre-resolution *version intent*, `(resolvedCloneUrl, versionIntent)`** — "entries whose intent points at the same tree" — then **resolve the target once per group** and clone once. The key is computable from the manifest alone (no network), *not* the resolved commit.

`versionIntent = constraint ?? ref` — the component that fixes which tree the entry wants. It differs by pinning mode, because for a constrained entry the stored `ref` is *not* the intent:

- **Constrained (caret) entry** — intent is the **`constraint`**; the stored `ref` is the entry's *current resolved tag*, which mutates on every update (`checkConstrained` compares `best.tag === entry.ref`, `update-check.ts:218`, and a successful update writes the resolved tag back into `entry.ref`, `nuke-reinstall-pipeline.ts:117,298-311`). Grouping on `ref` would split a collection the instant one member is updated singly (a `v1.3.0` member and a `v1.2.3` sibling key differently) — defeating the dedup for exactly the collections this feature targets, and contradicting the genuine-state-split guarantee below. So a constrained entry groups on `(resolvedCloneUrl, constraint)` and **excludes `ref`**.
- **Unconstrained entry** (branch, HEAD-tracked `ref === null`, or exact-pin) — intent *is* the **`ref`** (branch name, `null` for HEAD, or the pinned tag), which is fixed and does not mutate under `update`. These group on `(resolvedCloneUrl, ref)`.

Precise rules:

- Two entries from the same repo with different intent must not share a clone: `owner/repo/a@^1` vs `owner/repo/b@^2` (different `constraint`) → different groups; a branch entry and a caret entry for the same repo → different groups (different intent components). (The `constraint`-vs-`ref` discriminators are namespaced so a caret string can never coincidentally key-collide with a tag ref.)
- **The clone happens at the group's *effective* ref:** the stored `ref` for an unconstrained group, or the **resolved target tag** for a constrained group (passed as the `newRef` override to `cloneSource`, exactly as today's constrained single-update does).
- **The key uses the *resolved* clone URL** (via `deriveCloneUrlFromKey(key, entry.cloneUrl)`), not the raw `entry.cloneUrl` field (which is `null` on legacy manifests). Otherwise a legacy entry and an explicit-URL entry for the same repo wouldn't collapse.
- Collection members collapse into one group **for free**: added atomically, they share `resolvedCloneUrl` and the same intent (`constraint` for a caret collection, `ref` for a branch/pinned collection) — and stay grouped even after a member is updated singly, because a constrained group's key excludes the mutating `ref`.
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

- For a **constrained** group this holds precisely because `ref` is excluded from the key (see *Grouping key*): the singly-updated member — now at the newer tag but still within the constraint — stays grouped with its behind siblings and reports up-to-date.
- For a **branch/HEAD** group the split is at the *commit* level: members share the branch `ref` but sit at different installed commits, all advancing to the same resolved HEAD.

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

### Failure isolation & lifecycle

Two failure classes, handled differently. The shared clone is read-only during reinstall, so it survives per-member failures and is torn down once.

**Clone failure (group-fatal).** `cloneRepoOnce` throws (network/auth/ref gone; `cloneSource` already retries 3× internally, so a throw is final). Every member of the group becomes a `failed` outcome attributed to its own key.

- **No manifest mutation** — `clone-failed` doesn't remove entries (only `copy-failed` does, `update.ts:521`), so all N installs stay intact.
- **Exit accounting unchanged** — N `failed` outcomes trip `hasFailedOutcome` (`update.ts:618-631`) → non-zero exit, same as today.
- **Rendering** collapses to one grouped line (specified in *Per-Unit Progress Output*). The *model* stays N outcomes (for accounting); only the *display* groups.

**Check/resolve failure (group-level).** The per-group resolution probe can itself fail (dead remote, `ls-remote` error) *before* any clone. By analogy to clone failure, every member of the group becomes a `check-failed` outcome attributed to its own key; no clone or reinstall runs, so there is **no manifest mutation**. Per the ratified exit posture, all-mode `check-failed` warns and **exits 0** (it does not feed `hasFailedOutcome`), and the display collapses to one trailing line per repo-group (see *Partial collections & counts*). The *model* stays N `check-failed` outcomes for the trailing summary; only the *display* groups — mirroring clone failure's model-vs-display split.

**Reinstall failure (per-member, isolated).** Once the clone exists, each member runs its own `runPipeline` against it. `copy-failed` / `aborted` / `blocked` / `no-agents` stay exactly per-member — one member's `copy-failed` removes *its* entry and siblings continue. Verbatim today's behaviour; dedup doesn't touch it.

**Lifecycle.**

1. Clone once (`cloneRepoOnce`).
2. Members reinstalled **sequentially** — deterministic output ordering for the progress stream; the network cost is already gone after one clone. (Parallel reinstall-from-shared-clone is safe on a read-only source but deferred as a later optimization.)
3. Each member wrapped in its **own try/catch** so an unexpected throw is contained to that member (mirrors `processUpdateForAll`'s existing wrapper, `update.ts:295,384-390`).
4. `cleanupTempDir` runs **once** in a `finally` that wraps the **entire member loop**, so no member's throw skips the shared cleanup or aborts remaining siblings.

**Copy-safety boundary — unchanged (no security regression).** Today's remote branch *already* sets `cloneRoot = tempDir` (whole clone) with `sourceDir = member subpath` (`clone-reinstall.ts:392-394`). Sharing the physical clone across members keeps the identical boundary — cross-member symlinks inside the clone allowed, escapes beyond it rejected. Dedup changes how many times we clone, not what counts as an escape.

**Interrupt (noted, not solved).** The shared temp dir now spans N reinstalls instead of one, so a SIGINT mid-loop leaves it behind — but this is **no worse than today** (each per-entry `finally` has the same SIGINT gap, and dedup means *fewer* temp dirs in flight). Process-signal cleanup is out of scope; noted so it isn't mistaken for a regression.

---

## Per-Unit Progress Output

The clone-dedup reshape makes cloning **per-group** (once per repo) while each install outcome stays **per-member**. This section designs the progress stream over that shape, replacing today's wall of anonymous `"Cloning repository..."` lines and the deferred end-of-run summary.

### Progress granularities — group header + per-member outcomes

Report at two granularities, each natural to its action:

- **The clone/work step is per-group** — named once at the repo-group level (`Updating <owner/repo> …`), because the clone is genuinely one per-repo action after dedup.
- **The outcome is per-member** — each member resolves its own line beneath the group header (`✓ design → claude`), because the per-install result is what the user acts on.
- **A standalone unit is a group of one** — its group header and single outcome collapse into one line (`✓ vendor/tool: Updated v1.2.3 → v1.3.0`).

Illustrative shape:

```
◒ Updating rshankras/claude-code-apple-skills  v1.2.3 → v1.3.0  (10 members)
   ✓ design → claude
   ✓ macos  → claude
   …
✓ vendor/tool: Updated v1.2.3 → v1.3.0            ← group of one, collapsed
```

**Rejected: fully flat per-member** (every member its own `Updating owner/repo/x…` line, clone invisible). More uniform with the singleton path, but discards the one-clone-per-repo legibility dedup just bought and reintroduces a milder repetitive wall.

### Local entries

A local entry (`commit === null`) is excluded from grouping and never clones, so it does not fit the group-header + clone-spinner model. It renders as a **group-of-one** line in the actioned stream — `✓ <key>: Refreshed from local path` (its existing local-update wording, `renderUpdateOutcomeSummary` `local-update`) — with no clone spinner and no version move (there is nothing to clone and no ref to move). It streams inline in the actioned phase in processing order alongside the streamed groups, and is subject to per-member reinstall isolation and per-entry manifest persistence like any other unit.

### Version move & dropped-agents placement

- **Version move → the group header.** "Resolve once per group" makes the new target a single shared group property: `◒ Updating owner/repo  v1.2.3 → v1.3.0  (N members)`. This is where the tag-vs-hash rule (see *Tag-Based Summary Wording*) renders for the grouped path. Without this, a *multi-member* collection would show the version move nowhere — the per-member line is `✓ member → agents` (agents, not version).
- **Header "old" ref when updating members diverge.** The *new* ref is genuinely shared (the group's resolved target); the *old* ref is per-member (each updating member's own installed `ref`/commit). When the updating members share one old ref — the common case, an atomically-added collection all at the same tag — the header shows that shared `old → new`. When their olds diverge (e.g. members manually installed at different tags, all now advancing to the target), the header shows **only the resolved target** (`◒ Updating owner/repo → v1.3.0 (N members)`) and each member whose old differs from the group carries its own `old → new` on its member line, so no member's actual move is hidden. (Up-to-date members are excluded from the count and contribute no "old".)
- **Dropped-agents notice → the member line.** Agent support is per-member (each member's config can drop agents independently), so it rides its own line: `✓ macos → claude  (codex support removed by author)`. This is the `formatDroppedAgentsSuffix` "support removed by author" notice (`summary.ts:261-277`), which otherwise had no home in the member line.
- **Group-of-one** unchanged — collapses to one line carrying the version (`✓ vendor/tool: Updated v1.2.3 → v1.3.0`).

### Outcome timing — emit-on-completion, stream inline

Actioned outcomes stream inline as each group completes; the end-of-run summary loop shrinks to non-actioned check categories only.

- **Two phases: batched check, then streamed updates.** All groups are resolved/checked up front under a single leading `Checking for updates…` spinner (per-group probes may run in parallel across distinct repos, as today's checks do via `Promise.all`); this is where each group's target and version move are resolved. Only *updatable* groups then enter the streaming phase, each with its own `Updating <repo> v… → v… (N members)` spinner in deterministic processing order. A group whose check finds every member non-updatable (all up-to-date / `newer-tags` / `constrained-no-match`) never clones and never emits an `Updating` spinner — it is silent in the streamed phase and appears only as its collapsed trailing line. This is why the group spinner can carry the resolved version move: the check has already resolved it before streaming begins.
- **Per group:** a `p.spinner()` starts `Updating <repo>…` and spins through the clone (the slow part); on completion the per-member result lines are emitted as persistent `p.log.*` lines. A group's results appear the moment it finishes, in processing order.
- **The spinner does NOT tick live per member during reinstall** — it spins on the group name through the clone, then emits the per-member lines on completion. Per-member reinstalls are fast local file copies; live per-member ticking mostly flickers without adding signal.
- **End-of-run loop retained only for non-actioned check categories** — `up-to-date`, `newer-tags`, `check-failed`, `constrained-no-match` — plus the out-of-constraint footer. These never entered a processing group, so a tidy trailing summary is the right home.

Net stream: `Checking for updates…` → streamed group results (each live) → trailing summary of untouched / blocked-by-check entries → out-of-constraint footer.

### Per-group manifest persistence before streaming

Today the manifest is written once at the end (`update.ts:507-530`), *before* the summary loop prints — so a ✓ implies a persisted entry. Emit-on-completion would invert that (✓ streams before the single end write), so a failed write or Ctrl-C after some ✓ lines printed would show units as succeeded while the manifest still records the old commit.

**Decision:** write the manifest **per group, right before streaming that group's ✓** — so the ✓ is honest (persisted before shown) and an interrupt leaves the manifest *matching disk* (early groups recorded, later ones not — accurate, so recovery does less redundant work). Trades the single write for a few cheap incremental writes (manifests are small). `outcomes[]` is still collected for the `hasFailedOutcome` exit code (`update.ts:618-631`); what changes is *when* the manifest persists (per group, not one end-of-run write).

This "matching disk" guarantee holds at **group boundaries** — completed groups recorded, not-yet-started groups untouched. It does **not** cover a SIGINT *mid-member*, in the nuke-and-reinstall window after a member's old files are deleted but before its re-copy and the per-group write completes: there the manifest still records the now-deleted files. That window is the pre-existing SIGINT gap (see *Failure isolation & lifecycle* — no worse than today) and is out of scope here.

### Partial collections & counts

Under group-first checking, a group shares one *resolved target*, but each member's category still compares its **own installed commit** to that target — so a collection can still split: behind members update inline under the group header; already-current members are up-to-date in the trailing summary. This split is **intended** (see *Genuine-state splits*).

- **Per-repo collapse spans *every* trailing category.** Trailing lines collapse to **one line per repo-group** across *all* trailing categories: `up-to-date`, out-of-constraint, `newer-tags`, `check-failed`, and `constrained-no-match` (`update.ts:533-570`). An exact-pinned 10-member collection otherwise emits 10 near-identical `newer-tags` lines — the wall, resurfacing. This falls out of group-first: the trailing categories all depend on the shared `ref`/`constraint`, so they're group-uniform (one check per group → one trailing line per repo-group). Example: `owner/repo: 7 up to date` as one line, not 7.
- **Group-of-one collapse is fine** — a single updated member of a collection collapses to `✓ owner/repo/member: Updated…`; the `/member` suffix already distinguishes it from a true standalone (`owner/repo`), so collection context isn't lost.
- **Header count/noun is generic** — `(N members)` counting the members *updated in this group*, not `(N skills)`; a collection can hold plugin members (agents/hooks), not only skills.

### Clone-failure rendering

A group-fatal clone failure (see *Failure isolation & lifecycle*) renders as **one grouped line** under the group header — `owner/repo: clone failed — affects N members: a, b, c` — not N copies, so a group failure doesn't reintroduce the "stack of identical anonymous lines" this feature exists to kill. The underlying model stays N `failed` outcomes for exit accounting; only the *display* groups.

---

## Tag-Based Summary Wording

`update` reports commit hashes today (`${key}: Updated ${oldShort} -> ${newShort}`, `summary.ts:220-228,261-277`), which installers don't recognise. This part speaks in semver tags where the repo is genuinely tagged, with a short-hash fallback for the untagged / HEAD-tracked / branch case.

### Tags-where-tagged vs hash fallback

**Render `Updated <old> → <new>` in tags when both the old and new refs are genuine version tags AND the ref actually moved; otherwise fall back to short commit hashes.** The signal is *both refs being semver tags AND a ref move* — never the string shape alone.

- **Constrained update** (`v1.2.3 → v1.3.0`): old ref = current tag, new ref = resolved `result.tag`; both parse as semver and differ → **tags**. This is the all-mode case that produces a tagged "updated" outcome.
- **HEAD-tracked** (`ref === null`) or **branch** (`main`): not a version tag → **hashes**.
- **Lexical trap closed for free** (this rule guards the `update-check-fails-on-branch-ref` KB trap)**:** `isVersionTag` is `clean()`-based (`version-resolve.ts:30`); `clean("v4")` is `null` (not a full semver), so a `v4` *branch* is correctly not treated as a tag → **hashes**.
- **Branch literally named `v4.0.0`, commit moved:** passes `isVersionTag`, but a branch update doesn't change the ref *name* (only the commit), so `oldRef === newRef` → the "ref actually moved" guard sends it to **hashes**. This guard is why the rule is "both tags AND ref moved," not just "both tags."
- **Rejected: show tags whenever the new target is a tag** (even from a non-tag origin) — would render a misleading half-tagged move and doesn't survive the branch-named-like-semver edge.

### Sourcing old/new refs

The values are already at the outcome-construction site (`update.ts:372-383`):

- **Old ref** = the pre-update `entry.ref`.
- **New ref** = the post-update `result.manifestEntry.ref` (= the resolved `result.tag` for a constrained update; unchanged from `entry.ref` for a branch/HEAD update, which is exactly why those land on the hash path).
- **Apply to both surfaces** — the single-key path (`renderGitUpdateSummary`) and all-mode (`renderUpdateOutcomeSummary`) both get the tag treatment, so wording can't drift between them.

Threading the two refs into the render signature is mechanics (implementer's call); what's decided is *which values* feed it (old `entry.ref`, new resolved ref) and the rule they're tested against.

**Coupling note:** the outcome-summary plumbing (`renderUpdateOutcomeSummary`, produced inside `processUpdateForAll`) is the *same* call site the dedup ownership seam touches — which is why the whole feature is built seam-first (see *Build order*).

---

## Safe-vs-Major Bump Gating

### Audit — the behaviour already exists; the gap is messaging

The *gating behaviour* already exists, entirely via semver caret semantics — **no resolver/gating work is needed**:

- **Safe bumps auto-apply.** `checkConstrained` → `maxSatisfying(constraint, tags)` (`update-check.ts:211`); a patch/minor within the major advances `best` → `constrained-update-available` → auto-applied in all-mode (`update.ts:483-504`).
- **Major bumps are already gated.** `^1.2.3` = `>=1.2.3 <2.0.0`, so `2.0.0` never satisfies → can't be auto-applied; it surfaces as `latestOverall` in the out-of-constraint footer (`summary.ts:294-306`).
- **0.x-minor is already gated identically.** `^0.3.3` = `>=0.3.3 <0.4.0` (caret on 0.x pins the minor), so `0.4.0` is out of constraint — same path as a major. agntc itself is at v0.3.3, so this is the live case.
- **Exact-pin already blocks with a re-add directive.** `newer-tags` → the single-key path prints `To upgrade: npx agntc add <key>@<newest>` (`update.ts:151`).

**Conclusion:** the gap is purely *messaging*.

### Blocking message — passive footer → actionable, mode-matched

- **Tone: informative opt-in, not an error.** A major-available situation is the constraint doing its job (holding the unit at its major), not a failure. No error styling; **exit stays 0**; it does not feed `hasFailedOutcome`.
- **Upgrade the out-of-constraint message from passive to actionable.** Today: `Newer versions outside constraints: key 2.0.0 available (constraint: ^1.2.3)`. Target: name the current version vs the newer one *and* give the exact re-add command to cross the boundary.
- **Re-add suggestion matches the user's existing versioning mode:**
  - **Constrained / caret user** → suggest **bare `npx agntc add owner/repo`**. A bare add re-resolves the latest semver tag and stores the default `^major.minor.patch` constraint, so it jumps to the newest major *and* re-establishes caret tracking — the user needn't know it's `^2`. Chosen over `@^2` for simplicity; the prose names the target version, the command stays trivial.
  - **Exact-pin user** (`newer-tags`, no constraint) → keep suggesting a specific **`@<newest>`** tag, as today. This user deliberately pinned an exact tag; a bare re-add would silently switch them into caret tracking — a versioning-mode change they didn't ask for.
  - Rule: **suggest the re-add that preserves how they pinned.**
- **Names the *post-bump* current version.** The out-of-constraint info is captured at check time (`update.ts:458-468`), *before* a same-run safe bump is applied. Naming the pre-bump `entry.ref` would report a stale current: for `v1.2.3` on `^1.2.3` with remote `v1.3.0` + `v2.0.0`, the run auto-applies `v1.3.0` but the footer would say "current `v1.2.3` → `v2.0.0`" — contradicting the `Updated v1.2.3 → v1.3.0` line right above it. **Decision:** the footer names the version this run actually landed on (`v1.3.0 → v2.0.0`), consistent with the inline outcome. This requires the footer's current-version reference to come from the post-bump entry, not the pre-run ref (`OutOfConstraintInfo` carries no current version today — `summary.ts:288-292` — so the applied version must be threaded in; that plumbing is mechanics). When no safe bump happened this run, pre and post coincide.
- **The footer collapses per repo-group, not per member.** Today `renderOutOfConstraintSection` emits one line per key (`summary.ts:294-306`); a major-available N-member collection (members share ref + constraint) produces N near-identical actionable lines — the "wall" Part 1 exists to kill, reappearing in the footer. **Decision:** collapse to **one line per repo-group**, reusing Part 1's grouping. At the repo level the bare `npx agntc add owner/repo` re-add is *correct* — for a collection it re-adds the collection (re-selecting members at the new major), for a standalone it re-adds the plugin.

### 0.x-line + exact-pin edge cases

- **0.x-minor** confirmed gated by caret (above) — no special-casing needed; it rides the same out-of-constraint path as a major, with the same actionable message.
- **Consistency fix:** the all-mode `newer-tags` line (`update.ts:541`) currently says "newer tags available (latest: X)" but omits the `agntc add` command the single-key path includes. Align it so exact-pin messaging is consistent across single-key and all-mode.
- **Command granularity for the collapsed line:** because the all-mode `newer-tags` line collapses to **one line per repo-group** (see *Partial collections & counts*), its command is **repo-level** — `npx agntc add owner/repo@<newest>` — which for a collection re-adds the collection (re-selecting members at the pinned newest tag) and for a standalone re-adds the plugin, mirroring the caret footer's repo-level re-add. The single-key path stays member/key-scoped (`npx agntc add <key>@<newest>`), since it targets one plugin.

### Exit-code posture — single-key vs all-mode (ratified, not changed)

`check-failed` and `constrained-no-match` exit differently by mode today, and the divergence is **intentional — keep it, and state it explicitly**:

- **Single-key** `update <key>` exits `1` on both (`update.ts:139-142`, `160-165`): the one plugin you targeted couldn't be checked / has no matching tag → the requested action didn't happen.
- **All-mode** `update` warns and exits `0` (both excluded from `hasFailedOutcome`, `update.ts:623-630`): a batch shouldn't be sunk by one dead remote or one stuck constraint when everything else succeeded — partial-success, failure surfaced as a warning. Consistent with the existing posture where only `aborted`/`blocked`/`failed`/`copy-failed` trip the non-zero exit.

---

## Testing & Acceptance

### Testing scope

The seam routes all-mode through a new grouped orchestration while the three singleton entry points stay on the old path. Coverage required in the build:

- **Regression coverage** for the shared reinstall half — existing `update` tests stay green (the singleton paths are unchanged).
- **New coverage** for the grouped/dedup path: grouping by `(resolvedCloneUrl, ref, constraint)`, one clone + one check per group, per-member categorization against the shared target, genuine-state splits, clone-failure fan-out to N `failed` outcomes with grouped rendering, per-member reinstall isolation, per-group manifest persistence, and per-repo trailing collapse.

### Acceptance criteria

Observable outcomes the finished feature must satisfy:

1. A multi-member collection at one `(resolvedCloneUrl, ref, constraint)` clones **once** and runs **one** update check for the whole group.
2. Each updated member streams its own `✓ member → agents` line under a single group header carrying the version move; a standalone collapses to one line.
3. The version move renders in **tags** only when both refs are semver tags and the ref moved; otherwise short hashes — on both single-key and all-mode surfaces.
4. Actioned outcomes stream inline on group completion; only non-actioned categories (`up-to-date`, `newer-tags`, `check-failed`, `constrained-no-match`) plus the out-of-constraint footer appear in the trailing summary, each collapsed to **one line per repo-group**.
5. The manifest is persisted per group before that group's ✓ streams; an interrupt leaves the manifest matching disk **at group boundaries** (the mid-member nuke-and-reinstall window is the pre-existing SIGINT gap, out of scope).
6. A clone failure fails all N members of its group (attributed per-key for exit accounting, rendered as one grouped line), removes no entries, and exits non-zero.
7. A per-member reinstall failure (`copy-failed` / `aborted` / `blocked` / `no-agents`) is isolated to that member; siblings continue; the shared clone is cleaned up once.
8. An out-of-constraint situation (major, or 0.x-minor) renders one actionable, mode-matched line per repo-group naming the post-bump current version and the newest available, with a re-add command that preserves the user's pinning mode; exit stays 0.
9. The all-mode `newer-tags` line includes the `agntc add` command, matching single-key.
10. Exit-code posture is unchanged: single-key exits 1 on `check-failed` / `constrained-no-match`; all-mode warns and exits 0 for those; only `aborted` / `blocked` / `failed` / `copy-failed` trip a non-zero all-mode exit.

---

## Working Notes

[Optional - capture in-progress discussion if needed]
