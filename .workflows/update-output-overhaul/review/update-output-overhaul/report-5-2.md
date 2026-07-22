TASK: 5-2 — Consolidate the triplicated GroupTarget→(ref, commit) projection into one derivation (behaviour-preserving refactor)

ACCEPTANCE CRITERIA:
- Exactly one switch over `GroupTarget.kind` derives the group's commit and refs; all other sites read from it.
- The clone `--branch` override (branch/head→undefined) and the display ref (branch/head→versionIntent) remain distinct and correct.
- Header "new", member-line "new", and collapsed group-of-one "new" all originate from the single projection.
- Adding a hypothetical new streamed `GroupTarget` arm requires editing only the one derivation.

STATUS: Complete

SPEC CONTEXT: Phase 5 is Analysis Cycle 1. This is a code-health refactor (not a spec-feature task): the single logical property "what ref/commit does a streamed group land on" was projected in three places (`resolveEffectiveTarget` in update-groups.ts, `groupTargetCommit` + `groupTargetRef` in commands/update.ts), each re-switching over the `constrained | branch | head | <unreachable default>` shape. The genuine subtlety the refactor must preserve is the branch/HEAD split between the CLONE ref (`undefined`, the `--branch` override so the stored branch/HEAD is cloned) and the DISPLAY ref (`versionIntent`, the branch name / null shown in the move), which coincide with the member's own `ref` only by the grouping invariant (a branch group keys on `ref`, so all members share it), not by type guarantee.

IMPLEMENTATION:
- Status: Implemented (verified against commit 45f8a55, a clean 1:1 replacement)
- Location:
  - Single derivation: src/update-groups.ts:276-297 (`groupTargetFacets`) + interface `GroupTargetFacets` at :247-264. This is now the ONLY switch over `GroupTarget.kind` for this projection.
  - Consumers read from it: `processGroupUpdate` (src/update-groups.ts:391-392, `cloneRef` for the clone override), `reinstallMember` (src/update-groups.ts:317, threads `commit`/`cloneRef`/`displayRef`; `runPipeline` gets `newRef: cloneRef ?? null` / `newCommit: commit`; outcome summary gets `displayRef` at :338 and :351), and `streamGroupWork` (src/commands/update.ts:677-680, header reads `commit`/`displayRef`).
  - Removed: `EffectiveTarget`, `resolveEffectiveTarget`, `groupTargetCommit`, `groupTargetRef` — grep confirms zero residual references in src/ or tests/ (only stale wording in two test strings/comments, noted below).
- Notes: Behaviour-preservation traced site-by-site and is exact for every REACHABLE arm:
  - streamGroupWork newCommit/newRef == old groupTargetCommit/groupTargetRef (constrained→commit/tag; branch/head→resolvedSha/versionIntent). Identical.
  - clone override: old `effectiveRef` == new `cloneRef`; both `!== undefined` gate is unchanged. Identical.
  - runPipeline newRef `cloneRef ?? null` == old `effectiveRef ?? null`; newCommit `commit` == old `effectiveCommit` for reachable arms. Identical.
  - member-line move ref: old `effectiveRef ?? entry.ref` → new `displayRef`. For constrained both are `tag`; for branch/head old is `entry.ref` and new is `group.versionIntent`, which are equal by the grouping invariant (proven by the test at :459). The two projections differ ONLY on the default arm (old `entry.ref` vs new `null`, old commit `null` vs new `""`), which is unreachable for a streamed group (only constrained/branch/head carry updating members) — the same "unreachable default" caveat the original code documented.

TESTS:
- Status: Adequate
- Coverage:
  - New direct unit tests: tests/update-groups.test.ts:385-499 (`groupTargetFacets` describe) cover the constrained, branch, and head arms via whole-object `toStrictEqual` (:386, :412, :428), the clone-ref-vs-display-ref distinctness (:444), and the grouping-invariant equivalence `displayRef === cloneRef ?? member.ref` across all three reachable arms (:459) — the assertion that pins the member-line behaviour-preservation claim.
  - End-to-end behavioural coverage that would catch any drift already exists and stays green: tests/update-render.test.ts (formatGroupHeader shared/divergent moves, tag-vs-hash) and tests/commands/update.test.ts (runAllUpdates → streamGroupWork → processGroupUpdate: header "Updating owner/repo  aaaaaaa -> bbbbbbb (N members)", collapsed group-of-one "owner/repo: Updated ...", branch `effectiveCommit`==resolvedSha at :766-769, constrained records target.commit at :773+). These jointly assert header/member-line/collapsed agreement (acceptance criterion 3) end-to-end.
- Notes: The task's "assertions across constrained/branch/head verifying header, member-line, and collapsed refs agree" requirement is met by the combination of the new unit tests (the derivation) and the pre-existing behavioural tests (the three surfaces consuming it). No under-testing. Mild redundancy only — see the first non-blocking note.

CODE QUALITY:
- Project conventions: Followed. TS discriminated-union switch with exhaustive arms + documented no-op default; `export interface` for the facet contract; JSDoc explains the load-bearing cloneRef/displayRef distinction. Consistent with the file's existing "single source of truth" idiom (failedOutcome, isSuccessOutcome, mapReinstallResultToOutcome).
- SOLID: Good. Single responsibility restored — one derivation owns the projection; consumers depend on the `GroupTargetFacets` abstraction, not the union shape. Open/closed: a new streamed arm is genuinely a single-site edit (criterion 4 met).
- Complexity: Low. One switch, three-arm; consumers reduced to destructuring reads.
- Modern idioms: Yes. Object destructuring at call sites, `?? null` normalization preserved verbatim.
- Readability: Good. The `cloneRef` vs `displayRef` field docs and the reinstallMember comment explicitly call out the branch/HEAD clone-vs-display split, which was the easiest thing to get wrong.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [idea] tests/update-groups.test.ts:444-457 — the "keeps the branch clone ref (undefined) distinct from the display ref" test re-asserts exactly the `cloneRef: undefined` / `displayRef: "main"` pair already covered by the branch `toStrictEqual` at :412-426. Decide whether to keep it as a deliberately-named pin for acceptance criterion 2 (documentation value) or fold it into the branch case; leaning keep, since it names the one invariant most at risk.
- [do-now] tests/update-groups.test.ts:459 — test title says "displayRef equals effectiveRef ?? member.ref", but the removed field was renamed; the body computes `cloneRef ?? member.ref`. Update "effectiveRef" → "cloneRef" in the title to match current code.
- [do-now] tests/update-groups.test.ts:766 — comment "Branch effectiveCommit is the group's resolved sha" references the removed `EffectiveTarget.commit` field name; reword to "commit"/"facets.commit".
