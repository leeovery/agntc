---
topic: update-output-overhaul
cycle: 2
total_proposed: 4
---
# Analysis Tasks: Update Output Overhaul (Cycle 2)

## Task 1: Single-source the sourceSubpath containment guard across the singleton and grouped clone paths
status: pending
severity: high
sources: duplication, architecture

**Problem**: The per-member path-traversal containment guard — `assertSubpathWithinClone` inside a try/catch that maps a `PathTraversalError` to a clone-failed result, immediately followed by `resolveUpdateSourceDir` — is authored twice: in `cloneAndReinstall`'s remote branch (src/clone-reinstall.ts:389-404) and in `reinstallMember` (src/update-groups.ts:290-310). This is a security invariant (symlink / `../` escape rejection) the spec calls a "preservation constraint, not a design choice." The group orchestrator re-authored it inline rather than sharing the singleton's copy; both sites even carry comments acknowledging one is "mirrored" from the other. Nothing structurally binds the two copies, so a future change to the escape rule or its error mapping (or to how it pairs with `resolveUpdateSourceDir`) applied to one copy silently leaves the other clone entry point unguarded — a latent path-traversal regression across the exact seam the feature split.

**Solution**: Extract the guard + source-dir resolution into a single shared helper that both clone entry points compose. Preferred (narrow) boundary — a `resolveGuardedSourceDir(cloneRoot, key, sourceSubpath): { ok: true; sourceDir } | { ok: false; message }` co-located with `resolveUpdateSourceDir` in src/source-parser.ts (its natural home — that function is already the shared source-dir authority both callers use): it runs the guard, discriminates `PathTraversalError` from a rethrow, then calls `resolveUpdateSourceDir`, returning a result-object; each call site keeps only its own one-line failure mapping. Acceptable (wider) alternative — the architecture agent's `reinstallFromClone(tempDir, key, entry, { newRef, newCommit, projectDir }): CloneReinstallResult` owning guard + `resolveUpdateSourceDir` + `runPipeline`, composed by both sites — adopt this only if the executor finds the `runPipeline` call also duplicates cleanly. Either way the guard sequence must live in exactly one place.

**Outcome**: The `assertSubpathWithinClone` → `PathTraversalError`-vs-rethrow discrimination → `resolveUpdateSourceDir` sequence exists in one location; both the singleton and grouped clone paths reject the same escaping subpath, and a future guard tweak provably reaches both.

**Do**:
1. Add the shared helper next to `resolveUpdateSourceDir` in src/source-parser.ts. It runs `assertSubpathWithinClone(cloneRoot, sourceSubpath)` in a try/catch that returns a failure result carrying `err.message` on `PathTraversalError` and rethrows otherwise, then returns the `resolveUpdateSourceDir(cloneRoot, key, sourceSubpath)` result on success. It must no-op the guard when `sourceSubpath` is absent (matching today's key-derived-fallback behaviour; `assertSubpathWithinClone` already no-ops on null/empty).
2. Replace the inline block in `cloneAndReinstall` (src/clone-reinstall.ts:389-404) with a call, mapping a failure result to its existing raw `{ status: "failed", failureReason: "clone-failed", message }` return, then continuing to `runPipeline` with `cloneRoot = tempDir`.
3. Replace the inline block in `reinstallMember` (src/update-groups.ts:290-310) with a call, mapping a failure result through `mapReinstallResultToOutcome(key, entry, { status: "failed", failureReason: "clone-failed", message }, displayRef)` exactly as today.
4. Preserve the `cloneRoot = tempDir` containment-boundary semantics (within-clone cross-member symlinks allowed; only escapes beyond the whole clone rejected) and the "no nuke, no copy, install intact" abort behaviour at both sites.

**Acceptance Criteria**:
- The guard + `resolveUpdateSourceDir` sequence (including the `PathTraversalError`-vs-rethrow discrimination) exists in exactly one location.
- Both `cloneAndReinstall`'s remote branch and `reinstallMember` obtain their guarded sourceDir via that single helper.
- A recorded `sourceSubpath` that lexically escapes the clone (e.g. `../evil`) is still rejected pre-flight on BOTH the singleton and grouped paths, mapping to clone-failed with no nuke, no copy, and the install left intact.
- Each call site retains only its own one-line failure mapping (raw clone-failed result vs `mapReinstallResultToOutcome`).
- Typecheck clean; full suite passes.

**Tests**:
- Existing path-traversal rejection tests for the singleton clone path pass unchanged.
- A grouped-update member with an escaping `sourceSubpath` is rejected pre-flight (clone-failed, install intact) through `reinstallMember` / the group orchestrator.
- A regression test asserting both clone entry points reject the same escaping subpath through the shared helper (so a one-sided divergence would fail).

## Task 2: Consolidate PluginOutcome failure/success outcome handling into co-located helpers
status: pending
severity: medium
sources: duplication

**Problem**: Two `PluginOutcome`-shaping patterns are hand-inlined across src/commands/update.ts and src/update-groups.ts. (a) The `failed` outcome literal `{ status: "failed", key, summary: \`${key}: Failed — ${msg}\` }` is built at six sites (update.ts:326, update.ts:340, update-groups.ts:150, update-groups.ts:155, update-groups.ts:327, update-groups.ts:384) — the `prepareReinstall`-not-ok branch, the outer catch in `processUpdateForAll`, the `onCloneFailed`/`onUnknown` arms of `mapReinstallResultToOutcome`, the `reinstallMember` catch, and the clone-fatal fan-out map in `processGroupUpdate`. All six must keep the discriminant, key, and "<key>: Failed — <message>" wording in lockstep, but nothing enforces it, and one site already reads `member.key` instead of `key` — exactly where the prefix can drift from the body. (b) The success predicate `outcome.status === "updated" || outcome.status === "refreshed"` is re-inlined at five sites (update.ts:813, 855, 914, 968, 1040), several of which then reach into `outcome.newEntry`; the two-status success set is encoded in five places with no shared type guard.

**Solution**: Add two helpers co-located with the `PluginOutcome` definition in src/update-groups.ts and route every site through them: `failedOutcome(key: string, message: string): PluginOutcome` returning the `failed` literal once, and `isSuccessOutcome(outcome): outcome is Extract<PluginOutcome, { status: "updated" | "refreshed" }>` naming the success set once and narrowing to `newEntry` for the sites that consume it.

**Outcome**: The `failed` literal + its "<key>: Failed — <message>" wording and the `updated | refreshed` success set each live in exactly one place; adding a new failure origin or a future success variant is a one-line change, and the `member.key`-vs-`key` drift is closed.

**Do**:
1. Add `failedOutcome` next to the `PluginOutcome` type in src/update-groups.ts and replace all six `failed`-literal sites with a call, passing the correct key at each (fix the `member.key`-vs-`key` site so the prefix and message body agree).
2. Add `isSuccessOutcome` as a named type guard next to `PluginOutcome` and replace the five inline `updated || refreshed` checks; at the sites that then read `outcome.newEntry`, rely on the guard's narrowing.
3. Leave each site's surrounding failure-mapping behaviour (raw result vs `mapReinstallResultToOutcome` vs the clone-fatal fan-out) unchanged — only the literal construction and the predicate move into the helpers.

**Acceptance Criteria**:
- The `failed` outcome literal and its "<key>: Failed — <message>" wording exist in exactly one place; all six former sites call `failedOutcome`.
- The `updated | refreshed` success set exists in exactly one place; all five former sites call `isSuccessOutcome`, and `newEntry`-reading sites narrow through it.
- No behavioural change: identical outcome shapes and identical summary strings as before.
- Typecheck clean; full suite passes.

**Tests**:
- Existing all-mode / grouped update tests asserting failure and success outcome shapes and summary wording pass unchanged.
- A focused unit test that `failedOutcome(key, msg)` produces the exact prior literal, guarding the wording against drift.

## Task 3: Carry structured fields on the updated/refreshed PluginOutcome instead of a pre-rendered summary the renderer discards
status: pending
severity: medium
sources: architecture

**Problem**: The updated/refreshed `PluginOutcome` is built with a fully pre-rendered `summary` string via `renderUpdateOutcomeSummary` (src/update-groups.ts:160-186), but the multi-member streamed renderer `emitMemberLine` (src/commands/update.ts:903-932) ignores that string and re-renders the line from scratch via `formatMemberLine`, needing `newEntry.agents` and the structured dropped-agents set. Because the outcome carries no structured dropped-agents, `droppedAgentsFor` (update.ts:941-946) reconstructs them by set-differencing `oldEntry.agents` against `newEntry.agents` — data the pipeline already computed (`result.droppedAgents`) and then discarded into the summary string. The boundary type is stringly-typed where structured fields are what's actually consumed: the pre-rendered `summary` is dead weight for every multi-member member (computed, never shown), and the dropped-agents recompute works only because it is provably equal to the discarded value — a correctness-by-coincidence the comment itself has to assert.

**Solution**: Carry the structured fields the pipeline already returns (`droppedAgents`, and `agents` if it removes a redundant `newEntry.agents` read) on the updated/refreshed outcome variants, and have the render paths compose from them; drop or lazily-derive the `summary` string so it is produced only where actually displayed (the collapsed group-of-one / local paths).

**Outcome**: The multi-member renderer reads structured dropped-agents straight from the outcome; the set-difference recompute is gone and no `summary` is rendered for members that get re-rendered — the seam is self-contained, with identical on-screen output.

**Do**:
1. Extend the `updated` / `refreshed` `PluginOutcome` variants (src/update-groups.ts:90-106) to carry structured `droppedAgents` (and optionally `agents`) that `mapReinstallResultToOutcome` already has in scope via `result.droppedAgents` / `result.manifestEntry`.
2. In `mapReinstallResultToOutcome` (src/update-groups.ts:160-186), populate those fields; retain the pre-rendered `summary` only where a display path still needs it, or make it lazy so it is not computed for members that get re-rendered.
3. Update `emitMemberLine` (src/commands/update.ts:914-924) to read the structured `droppedAgents` from the outcome instead of calling `droppedAgentsFor`; remove `droppedAgentsFor` (update.ts:941-946) if it becomes unused.
4. Keep the collapsed group-of-one / local path (`streamCollapsedOutcome`) rendering identical — it may continue to consume the summary if that string is retained there.

**Acceptance Criteria**:
- The updated/refreshed outcome carries the structured dropped-agents (and agents if adopted) the renderer consumes.
- `emitMemberLine` composes its success line from the structured fields; the `oldEntry`-vs-`newEntry` set-difference recompute is eliminated (or `droppedAgentsFor` removed).
- The pre-rendered `summary` is no longer computed for members re-rendered by the multi-member path (dropped or lazy).
- Rendered output is byte-identical on every path (collapsed group-of-one, multi-member, local).
- Typecheck clean; full suite passes.

**Tests**:
- Existing multi-member streamed-line tests (including dropped-agents notices) pass unchanged.
- A test confirming a member whose reinstall drops agents renders the same dropped-agents notice sourced from the structured field.
- Collapsed group-of-one and local `Refreshed` / `Updated` lines unchanged.

## Task 4: Remove dead git generality from the now-local-only update path (processUpdateForAll)
status: pending
severity: medium
sources: architecture

**Problem**: After the group-first pivot, every git entry flows through `streamGroupWork → processGroupUpdate`; the only remaining caller of `processUpdateForAll` is `streamLocalWork` (src/commands/update.ts:835), which passes a local entry and no overrides. The function is now structurally mis-scoped for its one real use: (a) its `overrides?: VersionOverrides` parameter is dead — the sole caller never passes it, so the `...overrides` spread (update.ts:320) is always `{}`; (b) a local entry (`commit === null`) always takes the `refreshed` arm, so the git-update arm of `mapReinstallResultToOutcome` is unreachable from this path; (c) the code launders that dead generality with an apologetic benign-lie comment (update.ts:331-335) explaining it passes `entry.ref` as `newRef` purely because "the git-update arm's newRef is never consulted here." A function advertising more than the one narrow case it serves, kept honest only by an apologetic comment, misleads the next editor and invites a real bug if someone reroutes a git entry through it. (Raised in cycle 1 and discarded then as a standalone rename; the actionable value here is the dead-code removal — the rename is optional cohesion, not the point.)

**Solution**: Narrow the function to exactly what it does — a local reinstall. Drop the dead `overrides` parameter and the `...overrides` spread; stop threading a fabricated `newRef` (call the local/`refreshed` construction directly, or pass `null` to `mapReinstallResultToOutcome`), and delete the apologetic comment. The git-update generality stays — correctly — only in the grouped path, so do NOT remove the git-update arm of `mapReinstallResultToOutcome` (it remains reachable via `processGroupUpdate`).

**Outcome**: The local-only update path advertises only what it does — no dead parameter, no fabricated ref, no apologetic comment — while producing the identical `refreshed` outcome and leaving the grouped git-update path untouched.

**Do**:
1. Remove the `overrides?: VersionOverrides` parameter from `processUpdateForAll` (src/commands/update.ts:312-317) and the `...overrides` spread in the `prepareReinstall` call (update.ts:319-321); update the sole call site in `streamLocalWork` (update.ts:835).
2. Remove the fabricated `newRef` threading: either invoke the local/`refreshed` outcome construction directly, or pass `null` to `mapReinstallResultToOutcome`, and delete the benign-lie comment (update.ts:331-335).
3. Optionally rename to `processLocalUpdate` for cohesion — secondary; only if it does not create needless churn across the call site and tests.
4. Do NOT remove the git-update arm of `mapReinstallResultToOutcome` — it remains reachable and unchanged through `processGroupUpdate`.

**Acceptance Criteria**:
- `processUpdateForAll` no longer accepts `overrides` and no longer threads a synthetic `newRef`; the apologetic comment is gone.
- The local group-of-one update path produces the identical `refreshed` (local-update) outcome and summary as before.
- The git-update arm of `mapReinstallResultToOutcome` remains reachable and unchanged for the grouped path.
- Typecheck clean; full suite passes.

**Tests**:
- Existing local-entry update tests (`Refreshed from local path`, dropped-agents on local) pass unchanged.
- Grouped git-update tests unaffected — the git-update arm is still exercised via the group orchestrator.
