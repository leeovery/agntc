TASK: configless-install-1-3 — Replace 'child contains agntc.json' membership predicate with a structural one (child qualifies if root SKILL.md OR ≥1 asset-kind dir), one level only, no recursion into grandchildren.

ACCEPTANCE CRITERIA: child SKILL.md qualifies (bare-skill member); child ≥1 asset dir qualifies (plugin member); neither → skip; config-bearing+configless coexist; child that is only a collection-of-grandchildren NOT a member (one level); no qualifying children → not-agntc; child with only agntc.json no longer a member.

STATUS: Complete

SPEC CONTEXT: Collection Membership & Selection Flow (304-336) — membership redefined structurally, replacing has-agntc.json enumeration; nested collections unsupported, one level down. Detection-level only; pipeline/nested-warning are Phase 3.

IMPLEMENTATION: Implemented.
- src/type-detection.ts:201-206 — qualifiesAsMember(childDir): pathExists(join(childDir,'SKILL.md')) OR findPresentAssetDirs(childDir).length>0; child root only, never recurses.
- :168-192 — scanCollectionMembers wires qualifiesAsMember into collection step: reads immediate entries, ignores non-dirs (178), collects qualifying names, sorts (187) for stable order, returns {kind:'members',plugins} when ≥1 else {kind:'none'}.
- :159 classifyStructure falls through to scanCollectionMembers; :97-103 'members'→{type:'collection',plugins}.
- Reuses root-classifier primitives; one-level guarantee structural (qualifiesAsMember only calls root-level primitives against childDir). agntc.json carries no structural weight. Deterministic sort load-bearing (readdir order platform-dependent).

TESTS: Adequate. tests/type-detection.test.ts collection block (159-239): configless members (160); plugin member by asset dir (172); skips neither (180); mixed config-bearing+configless (189); no recursion into nested-collection child (202); not-agntc when none qualifies (210); child with only agntc.json no longer member (219); deterministic sort (227); files-only + unreadable-no-throw (248/257). Each AC has dedicated behaviour-level assertion over real fixtures; reverting predicate breaks 189 & 219. Not over-tested.

CODE QUALITY: Conventions followed (ESM .js, as const satisfies, discriminated union exhaustive switch). SOLID good (single-responsibility predicate; scanCollectionMembers owns iteration/ordering; findPresentAssetDirs single reused primitive). Complexity low. Modern idioms. Readability good (doc comments state one-level invariant).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [idea] tests/type-detection.test.ts:202 — consider a mixed case where one qualifying sibling coexists with a nested-collection-only child (assert kept member enumerated AND nested child skipped in one collection). Combined "kept + skipped" path not covered. Decide whether worth the fixture.
