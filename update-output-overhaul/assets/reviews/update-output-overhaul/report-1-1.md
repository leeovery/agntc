TASK: 1.1 — Group non-local manifest entries by (resolvedCloneUrl, versionIntent)

ACCEPTANCE CRITERIA:
1. Two members of one repo sharing a constraint collapse into one group whose members holds both, in manifest order.
2. A constrained group keys on (url, constraint) and EXCLUDES ref (v1.3.0 vs v1.2.3 siblings on ^1.2.3 stay in one group).
3. owner/repo/a@^1 vs b@^2 → two groups; branch vs caret → two groups; exact-pin ref vs same-repo caret → two groups (keyed pre-resolution, never on a resolved commit).
4. Legacy cloneUrl:null and explicit-URL entry for same repo + intent collapse via deriveCloneUrlFromKey.
5. HEAD-tracked entry (ref:null, commit set) forms its own group under the HEAD sentinel, distinct from tag/branch/caret.
6. Local entries (commit===null) never appear in any returned group.

STATUS: Complete

SPEC CONTEXT: Per-Repo Clone Dedup → Grouping key. Group by the deterministic pre-resolution version intent (resolvedCloneUrl, versionIntent), versionIntent = constraint ?? ref, computable from the manifest alone with no network. A constrained entry's stored ref mutates on every update (checkConstrained compares best.tag===entry.ref), so it groups on (url, constraint) and EXCLUDES ref, keeping a singly-updated member grouped with behind siblings. Discriminators are namespaced (c:/r:) so a caret can never key-collide with a tag ref; the HEAD sentinel keys ref===null distinctly. Uses deriveCloneUrlFromKey so legacy null-cloneUrl and explicit-URL entries collapse. Local entries excluded. Display-label @intent disambiguation is explicitly a later phase — not built here.

IMPLEMENTATION:
- Status: Implemented
- Location: src/update-groups.ts:32-37 (EntryGroup interface), :45-49 (intentKey helper), :57-82 (groupEntriesForUpdate).
- Notes:
  - EntryGroup interface matches the spec signature byte-for-byte (cloneUrl: string; versionIntent: string | null; constrained: boolean; members: Array<{ key; entry }>).
  - Local skip is the first loop statement (`if (entry.commit === null) continue`) — AC6 satisfied structurally.
  - Key = `${deriveCloneUrlFromKey(key, entry.cloneUrl)} ${intentKey(entry)}`. deriveCloneUrlFromKey (source-parser.ts:451) returns the explicit cloneUrl when non-null, else derives https://github.com/owner/repo.git from the key's first two segments — so legacy and explicit-URL entries for one repo collapse (AC4).
  - intentKey namespacing is correct: `c:<constraint>` when constraint !== undefined, else `r:<ref>` with ` HEAD` (leading-space) sentinel for ref===null. The `c:`/`r:` prefixes make a caret string incapable of colliding with a tag ref (AC3); the leading-space sentinel cannot collide with any real git ref name (AC5).
  - constrained = entry.constraint !== undefined and versionIntent = entry.constraint ?? entry.ref are consistent (constraint is `string | undefined`, never null, so `!== undefined` and `??` agree) and match the spec's "raw intent value, null for HEAD".
  - Insertion-ordered Map keyed by fullKey; group created on first-seen member, later members pushed onto the existing group; `[...map.values()]` returns groups in first-seen order. Object.entries order is reliable here because manifest keys (owner/repo[/member]) are never integer-like, so JS preserves insertion order (AC1 order guarantee holds).
  - No drift from plan/spec. Function is pure and network-free as required.

TESTS:
- Status: Adequate
- Location: tests/update-groups.test.ts:249-383 (groupEntriesForUpdate describe).
- Coverage: All 6 acceptance criteria are covered, and all 8 plan-named test cases are present:
  - AC1 → "groups two members ... preserving manifest order" (:250) asserts one group, cloneUrl/versionIntent/constrained shape, and member order [a, b].
  - AC2 → "excludes the mutating ref ..." (:267) — differing refs v1.3.0/v1.2.3 on one constraint stay in one group.
  - AC3 → three split tests: @^1 vs @^2 (:280), branch vs caret (:295), exact-pin vs caret with a deliberately SHARED commit (:314) proving pre-resolution keying (never on resolved commit).
  - AC4 → legacy null-cloneUrl + explicit-URL collapse, asserts resolved cloneUrl and both members (:338).
  - AC5 → head/tag/branch → 3 groups, head group has versionIntent===null and constrained===false (:354).
  - AC6 → local excluded; asserts the local key is absent from all groups' flattened keys (:370).
  - Split tests also implicitly assert GROUP ordering (groups[0] vs groups[1] follow first-seen member position).
  - Each test would fail if the corresponding behaviour broke (e.g. including ref in the constrained key flips :267 from 1 group to 2; dropping deriveCloneUrlFromKey flips :338 from 1 to 2; not skipping locals fails :370).
- Notes:
  - Not over-tested: each case targets one distinct grouping property; no redundant assertions; the file-level git-utils/clone mocks are consumed by other describe blocks, not by these pure-function tests, so there is no unnecessary mocking within the grouping tests.
  - Minor under-coverage (non-blocking): the "preserving manifest order" claim is only exercised with two CONTIGUOUS same-group members. No test uses interleaved members of two groups (e.g. {a: intent1, b: intent2, c: intent1}) to prove simultaneously that the third entry joins the first group rather than creating a new one AND that group[0] retains its first-seen position. The Map logic is simple and correct, but an interleaved case would harden the order guarantee that AC1 rests on.

CODE QUALITY:
- Project conventions: Followed. Tabs, `.js` import specifiers, `import type` for type-only imports, thorough doc comments consistent with the surrounding file. Reuses the shared deriveCloneUrlFromKey rather than re-deriving URLs.
- SOLID principles: Good. Single responsibility (pure partition), intentKey extracted as the sole owner of the namespacing rule.
- Complexity: Low. One linear pass, one Map, one branch for the local skip.
- Modern idioms: Yes. Map, Object.entries, spread, nullish coalescing, template literals; no non-null assertions in the implementation.
- Readability: Good. Intent-revealing names; the doc comments explain the mutating-ref exclusion and the sentinel rationale precisely.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [quickfix] tests/update-groups.test.ts:250 — add a grouping test with interleaved members of two intents (e.g. {a: constraint ^1, b: constraint ^2, c: constraint ^1}) asserting groups[0].members === [a, c] and groups[1].members === [b], to exercise the first-seen group-position + late-member-accumulation path that the current contiguous-member tests do not cover.
