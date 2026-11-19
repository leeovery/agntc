TASK: 5-4 — Extract shared helpers for scattered newest-tag and key→repo/basename idioms (newestTag, repoFromKey, memberName)

ACCEPTANCE CRITERIA:
- `newestTag`, `repoFromKey`, and `memberName` are each defined once and called from every listed site.
- No remaining inline `[...tags].reverse()[0]`, `.slice(0,2).join("/")`, or key-basename `.pop()` at the listed sites.
- Behaviour is unchanged at every call site.
- Tests: unit tests for `newestTag` (ascending → newest), `repoFromKey` (strips `/<member>`), and `memberName`; existing call-site tests pass unchanged.

STATUS: Complete

SPEC CONTEXT: This is an Analysis Cycle 1 (Phase 5) refactor finding, not a spec-behaviour feature. The intent is DRY consolidation: two drift-prone inline idioms — the "newest of an ascending oldest-first newer-tags list" (`[...tags].reverse()[0]!`) and the key-shape transforms (`owner/repo` via `.slice(0,2).join("/")`, member basename via `.pop()!`) — were re-authored across the update-output surface and drifted when only one site was edited. Each assumption should live in one documented helper. Observable behaviour must be byte-identical.

IMPLEMENTATION:
- Status: Implemented
- Location:
  - `newestTag(tags)` — src/version-resolve.ts:108-110, colocated with the tag utilities, with a docblock (99-107) documenting the ascending/oldest-first assumption and the non-empty precondition.
  - `repoFromKey(key)` — src/source-parser.ts:430-432, docblock 424-429.
  - `memberName(key)` — src/source-parser.ts:440-442, docblock 434-439.
  - Call sites routed:
    - newestTag → src/commands/update.ts:172 (single-key newer-tags upgrade command) and src/commands/update.ts:988 (emitCollapsedGroupSummary grouped newer-tags line).
    - repoFromKey → src/commands/update.ts:140 (extractOutOfConstraint `repo` field) and src/update-render.ts:19 (`repoOf(group)` now delegates to `repoFromKey(group.members[0]!.key)`).
    - memberName → src/commands/update.ts:718 (clone-failure affected-members list) and src/commands/update.ts:867 (member-line name).
- Notes: The task snapshot listed THREE newestTag sites — single-key (:164), splitMember (:576), and emitCollapsedGroupSummary (:1044). Only two survive because the intervening group-collapse redesign (commit 438855e / Phase 8) reduced `splitMember` (src/commands/update.ts:546-575) to return bare status markers — its `newer-tags` case (line 566) no longer computes a display string, so the newest-tag computation for the grouped path now lives solely in `emitCollapsedGroupSummary`. The acceptance intent ("no remaining inline idiom; helper called from every site that still needs newest extraction") is fully met: a repo-wide sweep finds zero remaining `[...tags].reverse()[0]`, `.slice(0,2).join("/")`, or key-basename `.pop()` in production outside the three helper bodies (verified against src/). The `reverse()` at src/commands/update.ts:168 is display ordering (prints the full tag list newest-first), a legitimately distinct operation, not the newest-single idiom. No import cycles introduced: source-parser has no back-edge to update-render; version-resolve depends only on semver.

TESTS:
- Status: Adequate
- Coverage:
  - newestTag — tests/version-resolve.test.ts:187-200: ascending list → newest (tail), single-element list, and behavioural equivalence to the `[...tags].reverse()[0]` idiom it replaces.
  - repoFromKey — tests/source-parser.test.ts:1324-1336: standalone key unchanged, `/<member>` stripped, nested member path → first two segments.
  - memberName — tests/source-parser.test.ts:1338-1350: standalone → repo name, collection member → member, nested → final segment.
  - Existing call-site behaviour (repoOf/groupLabel, out-of-constraint footer, clone-failure line, member lines) is exercised by the pre-existing update-groups/update-render/update suites, which the pure delegation leaves unchanged (baseline known-green).
- Notes: Tests are focused, one assertion per behaviour, no redundant setup or mocking. The `newestTag` equivalence assertion (version-resolve.test.ts:198) references the old idiom directly — legitimate as a refactor-equivalence guard rather than an implementation-detail test; not over-tested. The `newestTag` unit test landed in version-resolve.test.ts rather than the update-groups/update-render suites named in the task, which is the correct home since the helper lives in version-resolve.ts — a sensible, non-drifting deviation.

CODE QUALITY:
- Project conventions: Followed. Tiny single-purpose exported helpers with intent-documenting docblocks match the codebase's heavy self-documenting-comment style; naming (`repoFromKey`/`memberName`/`newestTag`) is consistent with the existing `*FromKey` family. Non-null assertions on the tail/`.pop()` mirror the surrounding conventions and preserve the pre-refactor failure mode.
- SOLID principles: Good — single responsibility per helper; `repoOf` now composes `repoFromKey` (open/closed via delegation).
- Complexity: Low — one expression each.
- Modern idioms: Yes.
- Readability: Good — the docblocks localise the previously-implicit "why reverse / why slice(0,2)" assumptions.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [do-now] src/commands/update.ts:966 — the docblock parenthetical "(reverse-newest)" is stale terminology now that the value comes from `newestTag` (tail of the ascending list, not reverse-then-first); reword to e.g. "(the newest, via newestTag — tail of the ascending list)" to match the implementation.
