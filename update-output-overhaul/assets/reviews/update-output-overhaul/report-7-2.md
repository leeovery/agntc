TASK: update-output-overhaul-7-2 — Compute the divergent-old flag once and thread it to both header and member-line rendering

ACCEPTANCE CRITERIA:
- The divergent-old boolean is computed in exactly one place (streamGroupWork); neither formatGroupHeader nor streamGroupMemberLines derives it from a Set size internally.
- A shared-old group (all updating members at one installed commit) renders the move on the header and leaves member lines bare — unchanged from today.
- A divergent-old group (updating members at ≥2 distinct installed commits) renders the target-only header and a per-member old -> new move on every member line — unchanged from today.
- The move renders exactly once per member across the header/member-line pair in both cases.
- npm test passes.

STATUS: Complete

SPEC CONTEXT:
Per the spec "Version move & dropped-agents placement" section, the header-old ref is a strict XOR: when updating members share one old ref the header shows old -> new and member lines stay bare; when olds diverge the header shows the resolved target only and every updating member carries its own old -> new on its line. This task is a pure refactor hardening that XOR into a structural guarantee: the "is this group divergent-old?" decision was previously computed independently in two files (formatGroupHeader via `new Set(oldCommits).size`, streamGroupMemberLines via `new Set(item.updating.map(m => m.entry.commit)).size > 1`) that had to stay in lockstep. The spec requires byte-for-byte identical output for both shared-old and divergent-old groups.

IMPLEMENTATION:
- Status: Implemented (matches all "Do" steps and acceptance criteria)
- Location:
  - src/commands/update.ts:686 — divergent flag computed ONCE in streamGroupWork (`const divergent = new Set(item.updating.map((m) => m.entry.commit)).size > 1;`), placed before the header is built.
  - src/commands/update.ts:689-696 — formatGroupHeader call site passes `divergent`.
  - src/commands/update.ts:722 — streamGroupMemberLines call site passes `divergent`.
  - src/commands/update.ts:850-869 — streamGroupMemberLines now accepts `divergent: boolean`; internal `new Set(...).size > 1` derivation removed (was at old line 861). Also promoted from module-private to `export` so the unit/guard test can drive it directly.
  - src/update-render.ts:148-169 — formatGroupHeader accepts `divergent: boolean` in its input object; internal `const distinct = new Set(oldCommits).size; if (distinct === 1)` replaced by `if (!divergent)`. Shared-old branch renders `formatVersionMove` using oldRefs[0]/oldCommits[0]; divergent branch renders target-only. `count = oldCommits.length` and `(N members)` suffix unchanged.
  - Doc comments on both functions (update.ts:840-849, update-render.ts:135-147) updated to state the divergent-old decision is caller-supplied (single source), not derived locally. Matches "Do" step 4.
- Notes:
  - Byte-for-byte equivalence verified. formatGroupHeader is only reached in the multi-member branch (`single === false` ⇒ `item.updating.length ≥ 2`), so `oldCommits` always has ≥2 entries and Set size ≥1; thus old `distinct === 1` ⟺ new `!divergent` (size ≤ 1 ⟺ size === 1) exactly. The member-line path consumes the identical expression the caller now computes, so its behaviour is unchanged. Header count and target-rendering logic untouched.
  - "Do" step 5 confirmed: grep shows the ONLY src callers of formatGroupHeader (update.ts:689) and streamGroupMemberLines (update.ts:722) are inside streamGroupWork; no other caller needed the new argument.
  - No drift from plan.

TESTS:
- Status: Adequate
- Coverage:
  - Unit — formatGroupHeader (tests/update-render.test.ts:144-252): shared-old header with move + count (hash and tag variants), divergent-old target-only header (tag target and branch/hash target), attempted-count-only. Two dedicated structural-guard cases (lines 223-251) feed `oldCommits` whose Set size CONTRADICTS the passed flag (identical commits + divergent=true → target-only; distinct commits + divergent=false → header move), proving the flag alone gates placement and nothing is re-derived internally.
  - Unit — streamGroupMemberLines (tests/commands/update.test.ts:1869-1943): two structural-guard cases mirroring the header ones (identical commits + divergent=true → per-member moves; distinct commits + divergent=false → bare lines). Directly satisfies the task's "Guard test (structural)" requirement.
  - Integration — runUpdate (tests/commands/update.test.ts:1792-1866): shared-old constrained collection renders header tag move v1.2.3 -> v1.3.0 with bare member lines; divergent-old constrained members render target-only header + each member's own tag move. Confirms end-to-end that streamGroupWork threads one flag to both surfaces.
- Notes:
  - The guard tests are exactly the "not-coincidental" verification the refactor exists to provide — the flag contradicts the internal Set to prove single-source-of-truth. Would fail if either consumer re-derived internally.
  - Not over-tested: each case exercises a distinct branch (shared/divergent × tag/hash × flag-contradiction × unit/integration). No redundant assertions.

CODE QUALITY:
- Project conventions: Followed. Export-for-test of streamGroupMemberLines matches the file's existing pattern (failureOrSkipMemberLine, isSuccessOutcome, etc. are similarly exported). TypeScript `divergent: boolean` param is explicit and non-optional, forcing every call site to supply it (no silent default that could reintroduce drift).
- SOLID principles: Good. Single source of truth for the divergent-old decision; both renderers now depend on an injected boolean (dependency-inversion flavour) rather than each re-deriving.
- Complexity: Low. Net logic is simpler — one Set computation replaces two; header branch condition reads `!divergent`.
- Modern idioms: Yes.
- Readability: Good. Doc comments explicitly name the single-source invariant and cross-reference streamGroupWork; the inline comment at update.ts:683-685 states why the flag lives there.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None.
