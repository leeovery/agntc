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

### Failure isolation & lifecycle

Two failure classes, handled differently. The shared clone is read-only during reinstall, so it survives per-member failures and is torn down once.

**Clone failure (group-fatal).** `cloneRepoOnce` throws (network/auth/ref gone; `cloneSource` already retries 3× internally, so a throw is final). Every member of the group becomes a `failed` outcome attributed to its own key.

- **No manifest mutation** — `clone-failed` doesn't remove entries (only `copy-failed` does, `update.ts:521`), so all N installs stay intact.
- **Exit accounting unchanged** — N `failed` outcomes trip `hasFailedOutcome` (`update.ts:618-631`) → non-zero exit, same as today.
- **Rendering** collapses to one grouped line (specified in *Per-Unit Progress Output*). The *model* stays N outcomes (for accounting); only the *display* groups.

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

### Version move & dropped-agents placement

- **Version move → the group header.** "Resolve once per group" makes the old→new a single shared group property: `◒ Updating owner/repo  v1.2.3 → v1.3.0  (N members)`. This is where the tag-vs-hash rule (see *Tag-Based Summary Wording*) renders for the grouped path. Without this, a *multi-member* collection would show the version move nowhere — the per-member line is `✓ member → agents` (agents, not version).
- **Dropped-agents notice → the member line.** Agent support is per-member (each member's config can drop agents independently), so it rides its own line: `✓ macos → claude  (codex support removed by author)`. This is the `formatDroppedAgentsSuffix` "support removed by author" notice (`summary.ts:261-277`), which otherwise had no home in the member line.
- **Group-of-one** unchanged — collapses to one line carrying the version (`✓ vendor/tool: Updated v1.2.3 → v1.3.0`).

### Outcome timing — emit-on-completion, stream inline

Actioned outcomes stream inline as each group completes; the end-of-run summary loop shrinks to non-actioned check categories only.

- **Per group:** a `p.spinner()` starts `Updating <repo>…` and spins through the clone (the slow part); on completion the per-member result lines are emitted as persistent `p.log.*` lines. A group's results appear the moment it finishes, in processing order.
- **The spinner does NOT tick live per member during reinstall** — it spins on the group name through the clone, then emits the per-member lines on completion. Per-member reinstalls are fast local file copies; live per-member ticking mostly flickers without adding signal.
- **End-of-run loop retained only for non-actioned check categories** — `up-to-date`, `newer-tags`, `check-failed`, `constrained-no-match` — plus the out-of-constraint footer. These never entered a processing group, so a tidy trailing summary is the right home.

Net stream: `Checking for updates…` → streamed group results (each live) → trailing summary of untouched / blocked-by-check entries → out-of-constraint footer.

### Per-group manifest persistence before streaming

Today the manifest is written once at the end (`update.ts:507-530`), *before* the summary loop prints — so a ✓ implies a persisted entry. Emit-on-completion would invert that (✓ streams before the single end write), so a failed write or Ctrl-C after some ✓ lines printed would show units as succeeded while the manifest still records the old commit.

**Decision:** write the manifest **per group, right before streaming that group's ✓** — so the ✓ is honest (persisted before shown) and an interrupt leaves the manifest *matching disk* (early groups recorded, later ones not — accurate, so recovery does less redundant work). Trades the single write for a few cheap incremental writes (manifests are small). `outcomes[]` is still collected for the `hasFailedOutcome` exit code (`update.ts:618-631`); what changes is *when* the manifest persists (per group, not one end-of-run write).

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
- **Lexical trap closed for free:** `isVersionTag` is `clean()`-based (`version-resolve.ts:30`); `clean("v4")` is `null` (not a full semver), so a `v4` *branch* is correctly not treated as a tag → **hashes**.
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

## Working Notes

[Optional - capture in-progress discussion if needed]
