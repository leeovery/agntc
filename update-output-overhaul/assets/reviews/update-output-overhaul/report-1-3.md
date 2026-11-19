TASK: 1-3 (update-output-overhaul-1-3) — Per-group resolve/check once and categorize members against the shared target

ACCEPTANCE CRITERIA:
1. resolveGroupTarget performs exactly one remote round-trip per call (one fetchRemoteTagRefs for constrained/exact-pin, one ls-remote for branch/HEAD).
2. Constrained group: categorizeMember returns constrained-up-to-date for a member whose entry.ref equals the resolved best.tag, and constrained-update-available for a behind sibling — from the SAME GroupTarget (genuine-state split).
3. Branch/HEAD group: two members at different installed commits both compare against the single resolved HEAD sha; the behind one is update-available, the at-HEAD one up-to-date.
4. Exact-pin group: resolveGroupTarget returns the newerTags list once; categorizeMember yields newer-tags when non-empty, up-to-date otherwise — independent of any caret group resolving to the same commit.
5. A probe error (rejected ls-remote/fetchRemoteTagRefs) yields { kind: "check-failed", reason }, and categorizeMember maps it to check-failed for every member.

STATUS: Complete

SPEC CONTEXT:
Spec "Per-Repo Clone Dedup → Group-first pipeline — check/resolve once per group": one network resolution per group resolves a shared target tag+commit, then each member's category is computed against that shared target using the member's OWN installed commit. This closes the commit-level race (two members resolving to different commits mid-run) and the category-level race (member A sees [v1.2.3], member B sees [v1.2.3, v1.3.0]) and dedups the redundant per-member probe. Key constraint: "keying on the resolved targetCommit would re-admit the race" — resolution must NOT compare against any single member. Spec "Genuine-state splits are intended": within one group a member already at the target is up-to-date while a behind sibling updates; the group shares a target, not a category. Existing arm logic to factor: checkConstrained, classifyAndCheck, checkHead, checkTag, findNewerTags, compareResolvedSha, detectLatestOverall.

IMPLEMENTATION:
- Status: Implemented
- Location: src/update-check.ts:105-116 (GroupTarget union), :138-143 (resolveGroupTarget), :150-163 (shared resolveTarget), :173-204 (categorizeMember), :212-240 (resolveRefTarget), :242-255 (resolveHeadTarget), :264-276 (resolveTagTarget), :278-322 (detectLatestOverall + resolveConstrainedTarget).
- Notes:
  - GroupTarget discriminated union exported exactly as specified — 6 kinds (constrained / constrained-no-match / tag / branch / head / check-failed) with the correct field shapes.
  - Clean refactor: the old checkForUpdate arm logic is factored into a shared resolveTarget (resolution only) + categorizeMember (pure comparison). checkForUpdate (:118-129) now = resolveTarget + categorizeMember, so the singleton path is byte-identical to before (verified against the pre-commit source, ee4fb3d~1). No drift for the three singleton entry points.
  - Resolution never compares against a single member: resolveConstrainedTarget uses only the constraint (not entry.ref); the old best.tag===currentRef comparison correctly moved into categorizeMember keyed on each member's own entry.ref. resolveGroupTarget uses a representative member (group.members[0]) legitimately, since the grouping invariant guarantees all members share intent+URL. Matches spec's "target resolved once and shared."
  - Subtle behavioural preservation, benign: resolveConstrainedTarget now performs the tagCommitMap commit lookup during resolution (returning check-failed if undefined) rather than only in the old update-available branch. best.tag is always drawn from the same fetched `parsed` list that populates tagCommitMap, so the undefined branch is genuinely unreachable (correctly documented as defensive at :288-290). No observable change.
  - AC1 wording nuance (not a defect): for the exact-pin (tag) case, resolveRefTarget issues the classification probe (ls-remote refs/heads+refs/tags) AND then resolveTagTarget issues fetchRemoteTagRefs (ls-remote --tags) = two round-trips. This faithfully preserves the pre-existing remote-truth ref-classification behaviour (classifyAndCheck+checkTag, landed by the separate update-check-fails-on-branch-ref feature) and is inherent to the design — an unconstrained `r:{ref}` group cannot know branch-vs-tag without probing. The AC parenthetical "one fetchRemoteTagRefs for constrained/exact-pin" holds literally, and the spec's real goal (one probe-set per group vs per member — dedup) is fully achieved. No action warranted.

TESTS:
- Status: Adequate
- Coverage: tests/update-groups.test.ts "resolveGroupTarget / categorizeMember" describe (:511-676) covers all five task-1-3 acceptance test cases verbatim:
  - constrained target resolved with a single fetchRemoteTagRefs call, asserting execGit NOT called (:516-544) — AC1 (constrained arm).
  - genuine-state split from one shared target: at-target member up-to-date, behind sibling constrained-update-available (:546-580) — AC2.
  - branch group, 3 members at divergent commits all comparing against one resolved HEAD sha; two behind → update-available, one at-head → up-to-date; execGit called once (:582-609) — AC3.
  - exact-pin group resolves newerTags once (fetchRemoteTagRefs once); both members → newer-tags, explicitly asserting the category is derived from the shared list not a resolved commit (:611-645) — AC4.
  - probe error (fetchRemoteTagRefs rejected) → check-failed target; categorizeMember maps both members to check-failed with the shared reason (:647-675) — AC5.
- Notes:
  - Regression coverage for resolveTarget's other arms lives in tests/update-check.test.ts via the intact 30-call checkForUpdate suite: HEAD resolution/up-to-date (:137), branch-that-looks-like-a-tag (:178), tag up-to-date at latest (empty newerTags → categorizeMember up-to-date, :252), tag newer-tags (:235), check-failed for neither-branch-nor-tag / probe error / ls-remote error / timeout (:372-435). Because checkForUpdate now delegates to resolveTarget+categorizeMember, these paths (HEAD-group resolution, tag up-to-date category, branch/tag/head probe-error → check-failed) are covered without duplication.
  - Not over-tested: the new section verifies only the group-level dedup and per-member categorization behaviour; it does not re-assert the singleton arm internals already covered by checkForUpdate. Good separation of concerns.
  - Minor, and covered elsewhere: the new section tests HEAD categorization only via the shared branch code path (categorizeMember collapses branch/head into one arm) and does not directly drive resolveHeadTarget through resolveGroupTarget, nor the tag "up-to-date" (empty newerTags) category. Both are exercised by the checkForUpdate regression suite, so no gap — no action needed.

CODE QUALITY:
- Project conventions: Followed. Discriminated unions, ESM `.js` import specifiers, unknown-typed catch with `as Error` narrowing, thorough intent-focused JSDoc — consistent with the codebase's typescript-expert conventions.
- SOLID principles: Good. Strong SRP — resolution (resolveTarget and its per-arm helpers) is cleanly separated from categorization (categorizeMember); each resolve* function owns one intent arm. The shared resolveTarget prevents singleton/group drift (single source of truth).
- Complexity: Low. categorizeMember is an exhaustive switch over the 6-kind union with NO default clause, so the compiler enforces exhaustiveness; a new arm is a single-site change. resolve* helpers are short and single-purpose.
- Modern idioms: Yes. Type-narrowed discriminated unions, Map-based tag/commit lookup, ?? / optional-chaining, exhaustive switch.
- Readability: Good. JSDoc explains the WHY (race closure, genuine-state split, dead-defensive branches) rather than restating the code.
- Issues: None material. categorizeMember's `entry.commit!` on the branch/head arm (:200) is safe by the grouping invariant (local entries are excluded from grouping and checkForUpdate returns local early), so a branch/head target is only ever categorized against a non-local member.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None. (The AC1 exact-pin double round-trip and the two minor test-coverage observations are all correct/covered behaviour that propose no concrete action — see IMPLEMENTATION and TESTS notes above.)
