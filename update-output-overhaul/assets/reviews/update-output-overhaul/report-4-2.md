TASK: 4-2 — Regression-lock the exact-pin newer-tags re-add command across all-mode and single-key (verification/regression only, no source change)

ACCEPTANCE CRITERIA:
1. An exact-pin collection in all-mode renders exactly one collapsed newer-tags line for the group, containing the repo-level `npx agntc add owner/repo@<newest>` (not N lines, not a member-scoped command).
2. The single-key standalone path outros `npx agntc add owner/repo@<newest>` and the single-key collection-member path outros `npx agntc add owner/repo/<member>@<newest>` (member/key-scoped, unchanged).
3. A caret/constrained entry with an out-of-constraint newer major emits NO `@<newest>` newer-tags line; it emits the bare `npx agntc add owner/repo` caret footer (task 4-1) instead.
4. No source file is modified by this task (verification only); all assertions pass against the code as built by Phases 2 and 4-1.

STATUS: Complete

SPEC CONTEXT:
Spec "Safe-vs-Major Bump Gating / 0.x-line + exact-pin edge cases" ratifies two disjoint re-add surfaces. (a) Exact-pin (unconstrained) newer-tags: keep suggesting a specific `@<newest>` tag — a bare re-add would silently switch the user into caret tracking (a versioning-mode change they did not ask for). The all-mode collapsed line is repo-level (`add owner/repo@<newest>`) because it collapses to one line per group; the single-key path stays member/key-scoped (`add <key>@<newest>`). (b) Caret/constrained: surfaces only via the task 4-1 out-of-constraint footer with the BARE `npx agntc add owner/repo`. newer-tags only ever fires for an UNCONSTRAINED exact-pin/branch entry; a constrained entry resolves to a constrained-* status and can only reach the footer — the "caret user never routed to @newest" guarantee. Command forms fixed by the naming cross-cutting spec (`npx agntc add owner/repo`).

IMPLEMENTATION:
- Status: Implemented (behaviour pre-existing from Phase 2 task 2-5 + task 4-1; this task is test-only, correctly no source change).
- Location (behaviour under lock):
  - All-mode repo-level collapse: src/commands/update.ts:987-993 (emitCollapsedGroupSummary tag branch) → src/update-render.ts:74-81 (formatNewerTagsLine), commandTarget = repoOf(group), one line per group.
  - Single-key key/member-scoped: src/commands/update.ts:166-174 (newer-tags branch outros `npx agntc add ${key}@${newest}`; key preserves any /member suffix).
  - Caret footer (disjoint surface): src/commands/update.ts:519-537 (groupOutOfConstraintInfo, gates on target.kind==="constrained" && latestOverall!==null) + src/summary.ts:342-359 (renderOutOfConstraintSection, bare `npx agntc add ${info.repo}`, no @).
- Notes: Disjointness holds by construction — the newer-tags line fires only for target.kind==="tag" (emitCollapsedGroupSummary:987); a constrained target never reaches it, and a constrained group's members categorize to constrained-up-to-date (excluded from hasNotableCategory), so the footer renders on the all-up-to-date early-return path (update.ts:415-421). Verified the exact-pin arrangement is a genuine exact-pin: makeEntry (tests/helpers/factories.ts:5) leaves `constraint` undefined, and the all-mode arrange sets only `{ ref: "v1.0" }`, so versionIntent = ref = "v1.0" (the "Pinned to v1.0" prefix).

TESTS:
- Status: Adequate
- Coverage: All five named tests from the plan are present, correctly arranged on the established seams (all-mode → mockResolveGroupTarget; single-key → mockCheckForUpdate), and each carries the load-bearing regression assertion:
  - tests/commands/update.test.ts:2027 "all-mode collapses an exact-pin collection to one repo-level ... newer-tags line" — asserts the exact collapsed line `owner/repo: Pinned to v1.0 — newer tags available (latest: v3.0). To upgrade: npx agntc add owner/repo@v3.0`, filters "newer tags available" to length 1, AND asserts no member-scoped `/owner\/repo\/\w+@/` command leaks (the repo-level-vs-member-scoped lock). No clone.
  - :4540 "single-key exact-pin standalone outros ..." — positive outro `add owner/repo@v3.0` plus NEGATIVE lock that the bare caret form `To upgrade: npx agntc add owner/repo` is never called.
  - :4565 "single-key exact-pin collection member outros ..." — positive outro `add owner/repo/go@v3.0` plus NEGATIVE lock that the repo-level `add owner/repo@v3.0` (the all-mode collapse form) is never called.
  - :6738 "a caret entry ... never routed to a @<newest> newer-tags line" — aggregates info/message/warn/outro lines; asserts no "newer tags available" notice AND no `@`-suffixed re-add command (`/npx agntc add \S+@/` → false). No clone.
  - :6770 "a caret entry ... emits the bare npx agntc add owner/repo footer instead" — asserts the header + bare-command footer line and filters "To upgrade" to length 1.
- Would fail if broken: Yes. Wording drift on formatNewerTagsLine, a member-scoped leak into the all-mode collapse, a bare-re-add regression on the single-key path, or any routing of a constrained entry onto the @newest surface each break a specific assertion.
- Notes (non-blocking, by design): The new locks partially overlap pre-existing positive assertions — :2027 re-asserts the collapsed line already covered by :2000; :4540/:4565 re-assert outros already covered by :4480/:4524. This overlap is intentional per the task ("add an explicit assertion if the member-scoped case is not already locked") and each new test adds a DISTINCT negative/disjointness assertion the older tests lack, so it is not redundant over-testing — the duplicated positive line keeps each regression lock self-contained and readable.

CODE QUALITY:
- Project conventions: N/A (test-only task). Test style matches the established file conventions (seam mocks, `.mock.calls.map`, comment banners naming the task).
- SOLID principles: N/A (no production code changed).
- Complexity: Low — tests are flat arrange/act/assert.
- Modern idioms: Yes.
- Readability: Good — each test has a comment stating the regression it locks and why (repo-level vs member-scoped, exact-pin vs caret).
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None. (The positive-assertion overlap with pre-existing tests was considered and is intentional/justified — each new test carries a distinct disjointness lock — so no change is proposed.)
