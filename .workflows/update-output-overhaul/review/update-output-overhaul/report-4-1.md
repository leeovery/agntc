TASK: 4-1 — Reword the out-of-constraint footer to the actionable, caret-mode re-add directive naming the post-bump current version

ACCEPTANCE CRITERIA:
1. renderOutOfConstraintSection emits "Newer versions outside constraints:" then one line per info of the form "  <label|key>  <current> -> <latestOverall> available. To upgrade: npx agntc add <repo>" — no (constraint: …) tail, no error glyph.
2. Re-add command is the BARE npx agntc add <repo> (owner/repo), even when the prefix is an @intent-disambiguated Group label.
3. Single-key, constrained-update-available: current is the landed checkResult.tag (post-bump), not pre-bump entry.ref.
4. Single-key, constrained-up-to-date: current is entry.ref (pre/post coincide).
5. All-mode: current is the group's resolved target.tag; N-member constrained collection renders exactly one footer line.
6. 0.x-minor gate (^0.3.3 → 0.4.0) rides the same path with the same wording.
7. Informative tone (no !, no warning language); exit stays 0 (does not feed hasFailedOutcome).

STATUS: Complete

SPEC CONTEXT: Spec "Safe-vs-Major Bump Gating → Blocking message" — the gating behaviour already exists via semver caret semantics; the gap is purely messaging. The passive footer ("Newer versions outside constraints: key 2.0.0 available (constraint: ^1.2.3)") becomes an actionable, mode-matched directive naming the post-bump current version vs the newest, with a bare "npx agntc add owner/repo" re-add for caret users (re-resolves latest, re-establishes caret). The footer is caret-only by construction (gated by hasOutOfConstraintVersion && entry.constraint !== undefined). Acceptance 8. Command form fixed by the naming cross-cutting spec Touchpoints: "npx agntc add owner/repo" — verified verbatim against naming spec line 31.

IMPLEMENTATION:
- Status: Implemented
- Location:
  - Interface — src/summary.ts:310-340 (OutOfConstraintInfo with required current + repo; key?/label? retained).
  - Render — src/summary.ts:342-359 (renderOutOfConstraintSection; header + "  ${label ?? key}  ${current} -> ${latestOverall} available. To upgrade: npx agntc add ${repo}").
  - Single-key call site — src/commands/update.ts:116-144 (extractOutOfConstraint; current = checkResult.tag for constrained-update-available, entry.ref! for constrained-up-to-date; repo = repoFromKey(key)).
  - All-mode call site — src/commands/update.ts:519-537 (groupOutOfConstraintInfo; current = target.tag, repo = repoOf(group), label = groupLabel(group, groups)); one info per group (update.ts:470-473).
  - Output — src/commands/update.ts:1025-1030 (renderOutOfConstraintOutput via p.log.info — no error styling).
- Notes:
  - All 7 acceptance criteria met exactly. Command string matches the naming-spec canonical "npx agntc add owner/repo" (bare, no @intent, member segment stripped via repoFromKey / repoOf). The ASCII " -> " arrow matches formatVersionMove's module convention (version-resolve.ts:59).
  - Post-bump sourcing verified: extractOutOfConstraint runs at update.ts:154 BEFORE the never-downgrade guard at :190, so the extreme-edge constrained-update-available-that-hits-the-guard case names checkResult.tag per the ruled sourcing (no special branch) — matches the plan's edge-case note.
  - repo derivation routes through the single repoFromKey home in both paths (repoOf = repoFromKey(members[0].key)) — good DRY.
  - Benign deviation from the literal plan text (context only, no action): the plan said "constraint is retained but no longer rendered"; the constraint field was instead fully removed from OutOfConstraintInfo and both call sites. This is a clean removal — no lingering references (grep confirms the only remaining `.constraint` usages are ManifestEntry.constraint at update.ts:123 and the unrelated formatConstrainedNoMatchLine param). Consistent with the phase-8 "remove dead presentation residue" cleanup and strictly better than retaining a dead field. Correct end state.

TESTS:
- Status: Adequate
- Coverage:
  - Unit (tests/summary-out-of-constraint.test.ts): empty-array boundary; actionable line with bare command; @intent-prefix-but-bare-command multi-group; key fallback; informative-tone/no-! /no-warning/header-preserved; one-line-per-info collapse. All acceptance-format assertions present.
  - Integration (tests/commands/update.test.ts): all-mode same-run safe bump names post-bump target.tag (6302); single-key constrained-update-available names checkResult.tag (6423); single-key constrained-up-to-date names entry.ref (6497); 0.x-minor gate ^0.3.3→0.4.0 (6521); N-member collection collapses to one line (6580, asserts .filter(To upgrade).length === 1); multi-group two @intent lines each with bare command (6607); all-mode exact-two-line pin + no "(constraint" tail (6656-6681); exit-0 for both all-mode and single-key (6683). The default resolveGroupTarget bridge (test:203-208) correctly wires checkForUpdate-arranged all-mode tests through the real categorizeGroups → groupOutOfConstraintInfo path, so target.tag is genuinely derived.
  - Would fail if broken: yes — verbatim string assertions on the exact footer line catch any wording/arrow/command drift; the .length===1 / toEqual assertions catch collapse regressions; the exit assertions catch a hasFailedOutcome regression.
- Notes:
  - Minor redundancy: the unit tests "renders the actionable … line" (test.ts:13-27) and "falls back to key as the prefix when no label is set" (test.ts:50-64) have byte-identical `infos` (key-only, no label) and identical expected output — the first does not exercise a distinct path from the third. The label-prefix path is already covered by the multi-group test (32-46). Non-blocking.
  - The extreme-edge never-downgrade-guard case (constrained-update-available whose entry.ref is at/above result.tag) is not given a dedicated integration test, but the task explicitly rules it "not special-cased" (follow result.tag sourcing) and it is a pathological locally-ahead/deleted-remote-tag case — acceptable to leave to the sourcing rule.

CODE QUALITY:
- Project conventions: Followed. Single home for key→repo (repoFromKey), tag-vs-hash arrow authored once (formatVersionMove re-exported), caret-only-by-construction gating reused rather than re-derived.
- SOLID principles: Good. renderOutOfConstraintSection has a single presentation responsibility; the two call sites own their own sourcing; no logic leaked into the renderer.
- Complexity: Low. All three functions are small with clear linear paths.
- Modern idioms: Yes — `??` fallback, discriminated-union narrowing (hasOutOfConstraintVersion type guard), justified non-null assertions with explaining comments.
- Readability: Good. Comments explain the "why" (post-bump sourcing, bare repo, one-line-per-group collapse) rather than the "what".
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [quickfix] tests/summary-out-of-constraint.test.ts:13-27 — the "renders the actionable … line" test duplicates the "falls back to key" test (50-64): identical key-only `infos` and identical expected output. Change this test's input to a `label`-set info (all-mode representative, e.g. label: "owner/repo") so the two tests cover distinct prefix paths (label vs key), or fold them into one.
