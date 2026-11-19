TASK: 2-1 — Add group-label helper with @intent disambiguation (repoOf + groupLabel, HEAD sentinel)

ACCEPTANCE CRITERIA:
- A repo with a single group in `groups` yields the bare `owner/repo` (no `@` suffix).
- A repo appearing in two groups (caret + exact-pin) yields `owner/repo@^1.2.3` and `owner/repo@v2.0.0` respectively.
- A HEAD-tracked group (`versionIntent === null`) in a multi-group repo yields `owner/repo@HEAD` (the sentinel, not `@null`).
- A branch group yields `owner/repo@main` and an exact-pin group yields `owner/repo@v2.0.0` when their repo is multi-group.
- The label is computed identically for a standalone (`owner/repo`) and a collection member (`owner/repo/<member>`) — `repoOf` strips the member segment.

STATUS: Complete

SPEC CONTEXT:
Spec "Per-Unit Progress Output → Partial collections & counts (Group label)" (specification.md:201): almost always a repo has one group per run so its line reads `owner/repo:`; when one repo yields multiple groups (members added at different intents) each line disambiguates by appending the intent — `owner/repo@^1.2.3`, `owner/repo@v2.0.0`, `owner/repo@main`, or `owner/repo@HEAD`. The identical label is shared verbatim across the streamed group header, the trailing collapse, and the out-of-constraint footer, so it must be authored once. Collapsing by bare repo would merge distinct-intent groups and silently drop one group's version info — a correctness bug. `versionIntent = constraint ?? ref` (null for HEAD); the `@HEAD` sentinel mirrors the Phase 1 ` HEAD` key sentinel.

IMPLEMENTATION:
- Status: Implemented
- Location: src/update-render.ts:18-20 (repoOf), src/update-render.ts:36-43 (groupLabel); repo derivation delegated to src/source-parser.ts:430-432 (repoFromKey).
- Notes: `repoOf` delegates to the shared `repoFromKey` (`key.split("/").slice(0,2).join("/")`) — behaviourally identical to the task's inline derivation, but factored into the single key→repo home in source-parser (a DRY improvement over the literal task text; `repoFromKey` also used by the singleton path). `groupLabel` computes `base = repoOf(group)`, returns `base` when exactly one group shares that repo, else appends `@${versionIntent}` or `@HEAD` for `versionIntent === null`. The task text phrased the guard as `> 1 → append`; the impl inverts to `=== 1 → return base`, which is logically identical because the group is always a member of `groups` (count ≥ 1). Both encode the same assumption. No branch on `group.constrained` — the single `versionIntent` suffix rule covers caret/branch/exact-pin/HEAD uniformly, matching the spec. `repoOf` is used by both `groupLabel` and the streaming layer (update.ts:535, 990) as the bare re-add command target — not orphaned.

TESTS:
- Status: Adequate
- Coverage: tests/update-render.test.ts:33-73 — all five planned tests present, one per acceptance criterion: bare single-group label (34-38), two-group caret/exact-pin disambiguation (40-47), `@HEAD` sentinel for a null-intent group (49-55), `@main`/`@v2.0.0` branch vs exact-pin (57-64), standalone-vs-collection-member equivalence (66-72). Assertions verify observable output (the returned string), not internals, and each would fail if the corresponding branch broke (e.g. a `@null` regression fails the HEAD test; dropping the count guard fails the single-group test).
- Notes: `repoOf` has no direct test, but it is exercised transitively by every `groupLabel` case and is a one-line delegation to the already-tested `repoFromKey` — a direct test would be redundant, not a gap. Not over-tested: no duplicate happy-path variations, no unnecessary mocking (pure fixtures via `makeGroup`). The `makeGroup` fixture's `cloneUrl`/`constrained` fields are irrelevant to these two helpers (which read only `members[0].key` and `versionIntent`) but harmless.

CODE QUALITY:
- Project conventions: Followed — TS strict, `!` non-null on `members[0]` matches the codebase's group invariant (groups always have ≥1 member); explicit exported function signatures; JSDoc explaining the "why" (the correctness-bug rationale) rather than the "what".
- SOLID principles: Good — single responsibility per helper; repo-derivation dependency inverted onto the shared `repoFromKey`.
- Complexity: Low — one filter + one ternary; no nesting.
- Modern idioms: Yes — `??`-derived intent, arrow filter, template literals.
- Readability: Good — self-documenting names; the JSDoc names the three consuming surfaces so a reader understands why the label is authored once.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None.
