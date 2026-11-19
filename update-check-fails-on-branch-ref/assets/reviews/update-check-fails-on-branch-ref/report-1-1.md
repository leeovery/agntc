TASK: 1.1 — Add exact-path ls-remote probe parser (internal ID update-check-fails-on-branch-ref-1-1)

ACCEPTANCE CRITERIA:
- Only refs/heads/{ref} -> { headSha: sha, tagSha: null }.
- Only refs/tags/{ref} -> { headSha: null, tagSha: sha }.
- Both -> both shas populated.
- Peeled refs/tags/{ref}^{} ignored (does not overwrite tagSha, does not error).
- Empty stdout -> { headSha: null, tagSha: null }.
- Full-path match: ref='release' does NOT match refs/heads/release-candidate; slash-in-name ref (feature/x) matches only exact path.
- Result identical regardless of line order.

STATUS: Complete

SPEC CONTEXT:
The remote-truth classifier (Task 1.2) probes the remote with a single
`git ls-remote <url> refs/heads/{ref} refs/tags/{ref}` and must decide which of
the two exact ref paths are present. The probe output is up to three lines: a
refs/heads/{ref} line, a refs/tags/{ref} line, and — for an annotated tag — a
peeled refs/tags/{ref}^{} line. Spec (Classification probe) requires matching
the FULL ref path (not a loose prefix) so a slash-in-name ref cannot cross-match,
ignoring the peeled ^{} line and any non-exact line, order-independent. Neither
existing helper suffices: parseLsRemoteSha reads only the first line and discards
the ref path; parseTagRefs strips refs/tags/ and ignores heads. This task adds
the dedicated parser that foundation supplies.

IMPLEMENTATION:
- Status: Implemented
- Location: src/update-check.ts:50-75 (parseRefProbe); consumed by classifyAndCheck at src/update-check.ts:136.
- Notes: Home is unambiguous — the parser is defined only in update-check.ts,
  co-located with parseLsRemoteSha (lines 36-42); it is NOT duplicated in
  git-utils.ts (confirmed by reading git-utils.ts). The "state chosen home in
  code, not both" requirement is satisfied, and the header comment (lines 44-49)
  documents why it differs from the two sibling parsers.
- Signature exactly as recommended: parseRefProbe(stdout: string, ref: string):
  { headSha: string | null; tagSha: string | null } — exported (line 50).
- Do-list conformance, item by item:
  - Trim stdout; empty input -> { headSha: null, tagSha: null } (lines 54-55). MET.
  - Split on newlines; skip empty lines; per line split on tab into [sha, refPath],
    trimming both (lines 62-66, uses parts[0]?.trim() ?? "" / parts[1]?.trim() ?? ""). MET.
  - Exact string equality against refs/heads/${ref} and refs/tags/${ref}
    (lines 57-58, 67-71). MET.
  - Peeled ^{} and prefix-sharing refs ignored — they simply fail exact equality,
    so no special-case code is needed (matches the plan's note that an explicit
    ^{} check is "not required but harmless"). MET.
  - No dependence on line ordering — all lines scanned, matches recorded by path
    (lines 62-72). MET.
- Every acceptance criterion maps to implemented behaviour. The `sha || null`
  guard (lines 68, 70) additionally coerces an empty-sha match to null — a benign
  defensive guard, not spec-required, no drift.

TESTS:
- Status: Adequate
- Location: tests/parse-ref-probe.test.ts:9-93 (8 tests).
- Coverage: All 8 required tests present, one-to-one with acceptance criteria:
  - only-heads (10-16)
  - only-tags (18-24)
  - both (26-35)
  - peeled ^{} ignored (37-46)
  - empty stdout (48-52)
  - prefix cross-match guard, refs/heads/release vs refs/heads/release-candidate (54-63)
  - slash-in-name exact match, feature/x with a feature/xyz decoy (65-75)
  - line-order independence, heads-then-tags vs tags-then-heads (77-92)
- Not under-tested: exact-equality is exercised on both the tag side (peeled ^{}
  test would fail under a startsWith/prefix match) and the heads side (prefix
  guard test), so a regression from exact to loose matching is caught. Order
  independence and empty input are covered. Would fail if the feature broke.
- Not over-tested: each test asserts a distinct behaviour with a single toEqual;
  no redundant assertions, no unnecessary mocking (pure function, no mocks). Realistic
  ls-remote payloads used (sha\trefs/heads/v4, annotated-tag ^{} line), matching
  the spec preference.
- Notes: No coverage of the empty-sha `|| null` guard, but that path is a
  defensive internal detail not in the spec — adding a test would edge toward
  over-testing, so its absence is correct.

CODE QUALITY:
- Project conventions: Followed. Mirrors parseTagRefs style in git-utils.ts
  (trim, split("\n"), skip blank lines, parts[0]?.trim() ?? "" / parts[1]?.trim() ?? "").
  Uses safe optional chaining rather than the non-null assertions in the older
  parseLsRemoteSha — a modest improvement.
- SOLID principles: Good. Single responsibility (pure classification of one probe
  payload); the branch-vs-tag tiebreak lives in the caller, correctly out of this
  parser.
- Complexity: Low. One loop, two exact comparisons, no branching on ordering.
- Modern idioms: Yes. Optional chaining + nullish coalescing; const-correct; pure/
  side-effect-free.
- Readability: Good. Header comment explains the rationale and why it differs from
  the two siblings; local headPath/tagPath names make intent clear.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None.
