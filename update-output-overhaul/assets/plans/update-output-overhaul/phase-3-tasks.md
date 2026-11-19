---
phase: 3
phase_name: Tag-based summary wording
total: 2
---

## update-output-overhaul-3-1 | approved

### Task 3.1: Reword formatVersionMove to the tag-vs-hash rule and apply it across the grouped surface

**Problem**: Phase 2 introduced an interim, hash-only `formatVersionMove(oldCommit, newCommit)` in `src/update-render.ts` (Task 2.2), reused by `formatGroupHeader` (2.2) and the divergent-old member move in `formatMemberLine` (2.3). It renders 7-char commit hashes users don't recognise (`v1.2.3` collections still show `6500f65 -> f395397`). The grouped progress surface must instead speak in semver tags where the repo is genuinely tagged AND the ref actually moved — but the rule must be authored *once*, in a spot both the grouped renderer (`update-render.ts`) and the two `summary.ts` renderers (Task 3.2) can share, so single-key and all-mode wording can never diverge.

**Solution**: Author the tag-vs-hash decision as a single pure rule in `src/version-resolve.ts` (the neutral, cycle-free home of `isVersionTag`/`clean()`), extending `formatVersionMove` to take both refs *and* both commits; then rewire the grouped surface — `formatVersionMove`'s callers in `update-render.ts` (`formatGroupHeader`, `formatMemberLine`) and the `runAllUpdates` grouped streaming site — to thread the resolved old/new refs through it.

**Outcome**: `formatVersionMove({ oldRef, newRef, oldCommit, newCommit })` renders `<oldRef> -> <newRef>` (tags) when both refs are genuine version tags and `oldRef !== newRef`, and `<oldShort> -> <newShort>` (short hashes, `"unknown"` for a null old commit) otherwise; the shared-old group header, the divergent-old per-member move, and the divergent-old header's target-only display all speak in tags where the group is genuinely tagged; a `v4` branch, a `v4.0.0` branch whose only the commit moved, a branch/HEAD group, and any both-tags-but-unmoved case all fall to hashes; and a constrained `v1.2.3 -> v1.3.0` collection renders tags.

**Do**:
- In `src/version-resolve.ts`, author the single shared decision rule. Export `interface VersionMoveInput { oldRef: string | null; newRef: string | null; oldCommit: string | null; newCommit: string }` and `export function formatVersionMove(input: VersionMoveInput): string`. Body: `if (isVersionTag(input.oldRef) && isVersionTag(input.newRef) && input.oldRef !== input.newRef) return `${input.oldRef} -> ${input.newRef}`;` then the hash fallback `const oldShort = input.oldCommit ? input.oldCommit.slice(0, 7) : "unknown"; return `${oldShort} -> ${input.newCommit.slice(0, 7)}`;`. Reuse the existing `isVersionTag` (`version-resolve.ts:30`, `clean()`-based) — do NOT re-implement string-shape detection. Keep the ` -> ` ASCII arrow verbatim (see Context — the spec's `→` is illustrative prose; Phase 2 and the existing renderers use ` -> `).
- Retire the Phase 2 interim `formatVersionMove(oldCommit: string, newCommit: string)` in `src/update-render.ts`: replace it with the extended shared rule. Recommended low-churn wiring — re-export the shared rule from `update-render.ts` (`export { formatVersionMove } from "./version-resolve.js"`) so Phase 2 callers/tests keep importing the same name; alternatively import it directly at each call site. Exact re-export-vs-direct-import is mechanics (implementer's call); what is fixed is that the rule lives in `version-resolve.ts` and is authored once.
- Extend `formatGroupHeader` (Task 2.2, `update-render.ts`) to carry the refs alongside the commits: add `oldRefs: (string | null)[]` (the *updating* members' installed `entry.ref`, one per attempted member, parallel to `oldCommits`) and `newRef: string | null` (the group's resolved target ref) to its input.
  - Shared-old branch (`distinct === 1` on `oldCommits`): render the move via `formatVersionMove({ oldRef: oldRefs[0]!, newRef, oldCommit: oldCommits[0]!, newCommit })` instead of the interim hash call — so an atomically-added `v1.2.3` collection header reads `Updating <label>  v1.2.3 -> v1.3.0  (N members)`.
  - Divergent-old branch (`distinct > 1` on `oldCommits`): the header is target-only (there is no single shared old to compare, so the two-ref move rule cannot apply). Render the resolved target as a tag when it is one: `` `Updating ${label} -> ${isVersionTag(newRef) ? newRef : newCommit.slice(0, 7)}  (${count} members)` `` — matching the spec illustrative `◒ Updating owner/repo → v1.3.0 (N members)`; a branch/HEAD divergent group (non-tag `newRef`) stays on the short target hash.
- Extend `formatMemberLine` (Task 2.3, `update-render.ts`) so its optional `move` field carries the refs: `move?: { oldRef: string | null; newRef: string | null; oldCommit: string; newCommit: string } | null`, and build the parenthetical move part from `formatVersionMove(move)`. This is the divergent-old per-member move (`✓ macos → claude  (v1.2.0 -> v1.3.0)`), which now renders in tags when the member's own old ref and the group's new ref are both tags and differ.
- Thread the refs at the grouped streaming site in `runAllUpdates` (the Task 2.4 caller of `formatGroupHeader`/`formatMemberLine`): `oldRefs` = the updating members' `entry.ref`; `newRef` = the group's resolved effective ref — `target.tag` for a constrained group (`GroupTarget.constrained.tag`, Phase 1 Task 1.3), and the group's shared unchanged `entry.ref` (the branch name, or `null` for HEAD) for a branch/HEAD group. Pass the same `newRef` into each attempted member's `move` (with that member's own `oldRef = member.entry.ref`) in the divergent-old case.
- Do NOT branch on the string shape of a ref anywhere; the only signal is `isVersionTag` (both refs) plus the `oldRef !== newRef` moved-guard. Do NOT change the ` -> ` arrow, the `Updating`/`(N members)` scaffolding, or any Phase 2 layout — this task rewords only the move tokens (hash → tag) where the rule fires.

**Acceptance Criteria**:
- [ ] `formatVersionMove` returns `<oldRef> -> <newRef>` when both refs pass `isVersionTag` and `oldRef !== newRef` (e.g. `v1.2.3 -> v1.3.0`), and `<oldShort> -> <newShort>` otherwise, with `"unknown"` when `oldCommit` is null.
- [ ] A `v4` branch (`oldRef`/`newRef` = `"v4"`) falls to hashes because `clean("v4")` is null (`isVersionTag` false) — the `update-check-fails-on-branch-ref` KB trap stays closed.
- [ ] A branch literally named `v4.0.0` whose only the commit moved (`oldRef === newRef === "v4.0.0"`) falls to hashes via the moved-guard, even though both refs pass `isVersionTag`.
- [ ] A branch/HEAD group (`newRef` a branch name or `null`) falls to hashes; both refs being tags but the ref unmoved (`oldRef === newRef`) falls to hashes.
- [ ] A constrained `v1.2.3 -> v1.3.0` shared-old collection header renders `Updating <label>  v1.2.3 -> v1.3.0  (N members)` (tags), and each divergent-old member line renders its own `<oldTag> -> v1.3.0` in tags.
- [ ] The divergent-old header target-only display renders `-> v1.3.0` (tag) when the resolved `newRef` is a version tag, and `-> <newShort>` (hash) for a branch/HEAD target.
- [ ] The tag-vs-hash rule is authored exactly once in `src/version-resolve.ts`; `update-render.ts` consumes that same rule (no second copy of the decision logic).

**Tests** (update `tests/update-render.test.ts` — Phase 2's interim hash tests migrate to the new signature — and add grouped-wiring assertions to `tests/commands/update.test.ts`):
- `"formatVersionMove renders <oldTag> -> <newTag> when both refs are semver tags and the ref moved"`
- `"formatVersionMove falls to short hashes for a v4 branch (clean() null)"`
- `"formatVersionMove falls to short hashes for a v4.0.0 branch when only the commit moved (oldRef === newRef)"`
- `"formatVersionMove falls to short hashes for a branch/HEAD move (newRef null or non-tag)"`
- `"formatVersionMove uses 'unknown' for a null old commit on the hash path"`
- `"shared-old group header renders the tag move v1.2.3 -> v1.3.0"`
- `"divergent-old member line renders its own <oldTag> -> <newTag> move in tags"`
- `"divergent-old header shows -> <tag> for a tagged target and -> <hash> for a branch target"`
- `"grouped streaming threads old = members' entry.ref and new = resolved target.tag into the header/member move"` (in `update.test.ts`, asserting a constrained collection's header/member lines carry tags)

**Edge Cases**:
- `v4` branch → `clean("v4")` null → hashes.
- Branch named `v4.0.0`, only the commit moved → `oldRef === newRef` → hashes (why the rule is "both tags AND ref moved").
- Constrained `v1.2.3 -> v1.3.0` → tags.
- Branch/HEAD (`newRef` non-tag or `null`) → hashes.
- Both refs tags but ref unmoved → hashes.
- Divergent-old header target-only: tag when `newRef` is a version tag, else short new hash.

**Context**:
> *Tags-where-tagged vs hash fallback* (spec): "Render `Updated <old> → <new>` in tags when both the old and new refs are genuine version tags AND the ref actually moved; otherwise fall back to short commit hashes. The signal is *both refs being semver tags AND a ref move* — never the string shape alone." "Constrained update (`v1.2.3 → v1.3.0`): ... both parse as semver and differ → tags." "HEAD-tracked (`ref === null`) or branch (`main`): not a version tag → hashes." "Lexical trap closed for free ... `isVersionTag` is `clean()`-based (`version-resolve.ts:30`); `clean("v4")` is `null`, so a `v4` *branch* is correctly not treated as a tag → hashes." "Branch literally named `v4.0.0`, commit moved: passes `isVersionTag`, but a branch update doesn't change the ref *name* (only the commit), so `oldRef === newRef` → the 'ref actually moved' guard sends it to hashes. This guard is why the rule is 'both tags AND ref moved,' not just 'both tags.'" *Sourcing old/new refs*: "Threading the two refs into the render signature is mechanics (implementer's call); what's decided is *which values* feed it (old `entry.ref`, new resolved ref) and the rule they're tested against." *Version move & dropped-agents placement*: the shared-old header carries the move (`◒ Updating owner/repo  v1.2.3 → v1.3.0  (N members)`) — "This is where the tag-vs-hash rule ... renders for the grouped path"; when olds diverge "the header shows **only the resolved target** (`◒ Updating owner/repo → v1.3.0 (N members)`) and **every** updating member carries its own `old → new` on its member line." *Left to the implementer (behaviourally invariant)*: "Threading the resolved old/new refs into the tag-render signature ... the *values* that feed it and the rule they're tested against are decided; the plumbing is not." ARROW NOTE: the spec renders the move with a unicode `→` in illustrative prose and even `Updated key from v1.2.3 to v1.3.0` in the Overview, but the literal renderers today (`summary.ts:220-228,261-277`) and the Phase 2 `formatVersionMove` use the ASCII ` -> `. Part 2 is explicitly a "reword over existing behaviour" of the *tokens* (hash → tag), not the arrow; keep ` -> ` verbatim to avoid an unlegislated wording change. INTERIM RELATIONSHIP: this task retires Phase 2 Task 2.2's hash-only `formatVersionMove(oldCommit, newCommit)` — Phase 2 explicitly deferred the tag rule here ("Phase 3 rewords this one helper (and its callers) to speak in tags").

**Spec Reference**: `.workflows/update-output-overhaul/specification/update-output-overhaul/specification.md` — *Tag-Based Summary Wording → Tags-where-tagged vs hash fallback*, *Sourcing old/new refs*; *Per-Unit Progress Output → Version move & dropped-agents placement*; *Testing & Acceptance* (acceptance 3).

## update-output-overhaul-3-2 | approved

### Task 3.2: Apply the shared tag-vs-hash rule to the single-key and collapsed all-mode summary renderers

**Problem**: The two `summary.ts` renderers still report raw commit hashes: `renderGitUpdateSummary` (single-key `update <key>`, `summary.ts:220-228`) prints `Updated <key>: 6500f65 -> f395397 — …`, and `renderUpdateOutcomeSummary` (git-update variant, `summary.ts:261-277`) — reused by the all-mode group-of-one collapse (Phase 2 Task 2.4) — prints `<key>: Updated 6500f65 -> f395397`. Installers don't recognise these hashes, and if the rule were re-implemented separately here the single-key and all-mode wording could drift from the grouped surface (Task 3.1).

**Solution**: Thread the resolved old/new refs into both renderers and replace their inline hash formatting with the *same* shared `formatVersionMove` rule authored in `src/version-resolve.ts` (Task 3.1), then source the refs at the single-key call site (`runSinglePluginUpdate`) and the all-mode collapsed group-of-one site.

**Outcome**: `renderGitUpdateSummary` and `renderUpdateOutcomeSummary` render the move via the shared `formatVersionMove`, so a constrained single-key update reports `Updated <key>: v1.2.3 -> v1.3.0 — …` (old `entry.ref`, new `result.tag`), a branch/HEAD update (ref unchanged, `oldRef === newRef` or `null`) stays on short hashes, a null old commit still yields the `"unknown"` short-hash fallback, and — because both surfaces call the one rule — single-key and all-mode produce identical move wording for identical inputs.

**Do**:
- In `src/summary.ts`, import the shared rule: `import { formatVersionMove } from "./version-resolve.js";` (no cycle — `version-resolve.ts` imports only `semver`; `summary.ts` does not appear in its import chain).
- Extend `GitUpdateSummaryInput` (`summary.ts:211-218`) with `oldRef: string | null` and `newRef: string | null`. In `renderGitUpdateSummary`, delete the local `oldShort`/`newShort` computation and render the move via the shared rule: `` return `Updated ${input.key}: ${formatVersionMove({ oldRef: input.oldRef, newRef: input.newRef, oldCommit: input.oldCommit, newCommit: input.newCommit })} — ${input.copiedFiles.length} file(s) for ${input.effectiveAgents.join(", ")}${droppedSuffix}`; ``. Preserve every other token (`Updated `, `: `, ` — `, the file-count/agents tail, and `droppedSuffix`) verbatim.
- Extend the `git-update` arm of `UpdateOutcomeInput` (`summary.ts:247-259`) with `oldRef: string | null` and `newRef: string | null`. In `renderUpdateOutcomeSummary`'s git-update branch, delete the local `oldShort`/`newShort` and render `` return `${input.key}: Updated ${formatVersionMove({ oldRef: input.oldRef, newRef: input.newRef, oldCommit: input.oldCommit, newCommit: input.newCommit })}${droppedSuffix}`; ``. Leave the `local-update` branch untouched (it has no version move).
- Thread the refs at the single-key call site in `runSinglePluginUpdate` (`update.ts:266-275`): pass `oldRef: entry.ref` (pre-update) and `newRef: result.manifestEntry.ref` (post-update = the resolved `result.tag` for a constrained update; unchanged `entry.ref` for a branch/HEAD update) alongside the existing `oldCommit: entry.commit`, `newCommit: result.manifestEntry.commit!`.
- Thread the refs at the all-mode collapsed group-of-one site (the Phase 2 Task 2.4 caller that builds the single-member `renderUpdateOutcomeSummary({ type: "git-update", … })` line): `oldRef` = the member's pre-update `entry.ref`; `newRef` = the group's resolved target ref (`target.tag` for a constrained group; the unchanged `entry.ref` — branch name or `null` — for a branch/HEAD group), identical to the `newRef` Task 3.1 threads into the grouped header. This keeps the collapsed group-of-one wording identical to the grouped multi-member wording for the same move.
- Do NOT re-implement the tag/hash decision in `summary.ts`; both renderers must call the single `formatVersionMove` from `version-resolve.ts` (acceptance 3 — one rule, no divergence). Keep the ` -> ` ASCII arrow (the rule already emits it; see Task 3.1 Context).

**Acceptance Criteria**:
- [ ] `renderGitUpdateSummary` renders the move through `formatVersionMove`: a constrained update (`oldRef: "v1.2.3"`, `newRef: "v1.3.0"`) prints `Updated <key>: v1.2.3 -> v1.3.0 — …`; the file-count/agents tail and dropped-agents suffix are unchanged.
- [ ] `renderUpdateOutcomeSummary` git-update renders `<key>: Updated v1.2.3 -> v1.3.0` for the same constrained refs, and the `local-update` branch is unchanged.
- [ ] A branch/HEAD update (`oldRef === newRef`, e.g. `"main"`, or `newRef: null`) falls to short hashes on both renderers.
- [ ] A null old commit on the hash path still renders `unknown -> <newShort>` on both renderers (existing `renderGitUpdateSummary` `"uses 'unknown' when old commit is null"` and equivalent outcome-summary behaviour preserved).
- [ ] Both renderers call the *same* `formatVersionMove` from `version-resolve.ts` (no duplicated decision logic); for identical `{ oldRef, newRef, oldCommit, newCommit }` the single-key and all-mode surfaces emit an identical move substring.
- [ ] The single-key call site passes `oldRef: entry.ref` / `newRef: result.manifestEntry.ref`, and the all-mode collapsed site passes `oldRef: entry.ref` / `newRef: target.tag`-or-unchanged-`entry.ref`.

**Tests** (update `tests/summary.test.ts` — the existing `renderGitUpdateSummary`/`renderUpdateOutcomeSummary` suites gain the new `oldRef`/`newRef` inputs — and add a single-key call-site assertion to `tests/commands/update.test.ts`):
- `"renderGitUpdateSummary renders tags for a constrained update (v1.2.3 -> v1.3.0)"`
- `"renderGitUpdateSummary falls to short hashes for a branch update (oldRef === newRef)"`
- `"renderGitUpdateSummary falls to short hashes for a HEAD update (newRef null)"`
- `"renderGitUpdateSummary still renders 'unknown -> <newShort>' when old commit is null (hash path)"`
- `"renderUpdateOutcomeSummary git-update renders tags for a constrained update and hashes for a branch update"`
- `"renderUpdateOutcomeSummary local-update is unchanged"`
- `"single-key and all-mode produce the identical move substring for the same old/new refs (shared rule, no divergence)"`
- `"single-key runSinglePluginUpdate passes entry.ref and result.manifestEntry.ref into renderGitUpdateSummary"` (in `update.test.ts`)

**Edge Cases**:
- Constrained single-key update (old `entry.ref`, new `result.tag`) → tags.
- Branch/HEAD single-key update (ref unchanged, `oldRef === newRef` or `newRef: null`) → hashes.
- Old commit null → `"unknown"` short-hash fallback.
- Shared rule keeps single-key and all-mode wording identical (no re-implemented decision).

**Context**:
> *Sourcing old/new refs* (spec): "The values are already at the outcome-construction site (`update.ts:372-383`): **Old ref** = the pre-update `entry.ref`. **New ref** = the post-update `result.manifestEntry.ref` (= the resolved `result.tag` for a constrained update; unchanged from `entry.ref` for a branch/HEAD update, which is exactly why those land on the hash path). **Apply to both surfaces** — the single-key path (`renderGitUpdateSummary`) and all-mode (`renderUpdateOutcomeSummary`) both get the tag treatment, so wording can't drift between them." *Tags-where-tagged vs hash fallback*: the rule fires only when "both the old and new refs are genuine version tags AND the ref actually moved" — a branch/HEAD update keeps `newRef` equal to (or a non-tag/`null` version of) `oldRef`, so it stays on hashes. *Coupling note*: "the outcome-summary plumbing (`renderUpdateOutcomeSummary`, produced inside `processUpdateForAll`) is the *same* call site the dedup ownership seam touches" — under Phase 2 that construction moved to the group-of-one collapse (Task 2.4), which is where the all-mode refs are threaded now. The shared rule is authored in Task 3.1 (`version-resolve.ts`); this task only consumes it — re-implementing the decision in `summary.ts` would risk exactly the single-key/all-mode divergence the spec forbids. Existing behaviour to preserve verbatim (only the move tokens change): the `Updated <key>: … — N file(s) for <agents>` tail of `renderGitUpdateSummary`, the `<key>: Updated …` shape of `renderUpdateOutcomeSummary`, the ` -> ` arrow, the `"unknown"` null-commit fallback, and the dropped-agents suffix.

**Spec Reference**: `.workflows/update-output-overhaul/specification/update-output-overhaul/specification.md` — *Tag-Based Summary Wording → Sourcing old/new refs*, *Tags-where-tagged vs hash fallback*; *Testing & Acceptance* (acceptance 3).
