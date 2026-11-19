TASK: configless-install-1-4 — Two-level type override and conflict hard error (precedence --plugin > config type > structure, resolving only skills-only; contradiction on unambiguous structure → TypeConflictError; only 'plugin' recognised).

ACCEPTANCE CRITERIA: skills-only + (configType plugin / forcePlugin / both) → plugin, neither → collection; multi-asset plugin + override → no-op; bare-skill + override → throws; member-dirs + override → throws (names N); configType collection/unknown ignored; not-agntc + override → not-agntc (no throw); thrown error is TypeConflictError describing the conflict.

STATUS: Complete

SPEC CONTEXT: Structural Type Detection (Detection precedence; Type-vs-structure conflict hard error; Recognised type values); Error & Abort Behaviour (hard errors detection-time before any write). No CLI wiring (Phase 2).

IMPLEMENTATION: Implemented in src/type-detection.ts.
- TypeConflictError (41-46) extends Error, name "TypeConflictError"; doc comment on structural-half/source-identity split.
- DetectTypeOptions (48-52) {configType?,forcePlugin?,onWarn?}.
- Resolution in detectType (68-108): wantsPlugin = forcePlugin===true || configType==="plugin" (79); switch on structure.kind: plugin→as-is no throw (82-84); bare-skill→throw if wantsPlugin "the source is a bare skill — cannot bundle" (85-91); skills-only→{type:'plugin',assetDirs:['skills']} else {type:'collection',plugins:[]} (92-96); members→throw "its structure is a collection of ${N} members — cannot bundle" if wantsPlugin (97-103); default not-agntc→return, never throws (104-106).
- Precedence centralised by collapsing both override inputs into one wantsPlugin (observable only in skills-only). Only exact "plugin" recognised. Throws pre-flight (pure read/classify). Scope limited to type-detection.ts.

TESTS: Adequate. tests/type-detection.test.ts "override resolution" block (271-411) maps 1:1 onto every AC. Throw tests assert rejects.toBeInstanceOf(TypeConflictError); two message tests assert structural substring (/bare skill/, /collection of 2 members/). No-op tests assert full preserved plugin shape. Both override sources exercised separately on bare-skill and member-dirs. Not over-tested.

CODE QUALITY: Good. Conventions followed (tabs, node:, .js ESM, named exports, discriminated unions). Single-responsibility seam classifyStructure(structure) vs detectType(override/mapping). Low complexity (one flat exhaustive switch + one boolean). Modern idioms. Self-documenting.

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [quickfix] tests/type-detection.test.ts:377 — edge-case list names empty-string '' among ignored configType values, but no test exercises configType:''; 'bundle' stands in for all non-'plugin'. Add a configType:"" case to pin the empty-string branch.
- [do-now] tests/type-detection.test.ts:331-345 — bare-skill throw tests assert only error type; bare-skill message checked once at 396. Optionally fold a message assertion into one bare-skill throw test for symmetry. Low value.
