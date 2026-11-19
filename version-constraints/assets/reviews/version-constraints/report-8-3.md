TASK: Restructure resolveTagConstraint to make bare-add / explicit-constraint mutual exclusion explicit

ACCEPTANCE CRITERIA:
- The two tag-resolution branches are syntactically mutually exclusive (if/else-if or early return)
- Bare-add resolution still auto-applies ^{latest} constraint
- Explicit constraint resolution still resolves best matching tag
- No double fetchRemoteTags call possible in any code path

STATUS: Complete

SPEC CONTEXT: The add command has three resolution paths: bare add (resolve latest semver tag, auto-apply ^X.Y.Z), explicit constraint (resolve best match within bounds), and exact tag/branch ref (no constraint). The bare-add and explicit-constraint paths both require fetching remote tags but are mutually exclusive by design -- a parsed source has either (ref=null, constraint=null) for bare add or (constraint!=null) for explicit constraint.

IMPLEMENTATION:
- Status: Implemented
- Location: src/commands/add.ts:56-74
- Notes: The function uses a clean if/else-if chain:
  - Line 56: `if (updatedParsed.ref === null && updatedParsed.constraint === null)` for bare-add
  - Line 64: `else if (updatedParsed.constraint != null)` for explicit-constraint
  This makes the mutual exclusion syntactically explicit. The third implicit branch (ref set, constraint null -- exact tag or branch ref) correctly falls through both conditions and skips tag resolution entirely. The constraint is correctly computed on line 76 via `updatedParsed.constraint ?? derivedConstraint`, which works because `derivedConstraint` is only set in the bare-add branch and `updatedParsed.constraint` is only non-null in the explicit-constraint branch. All four acceptance criteria are met.

TESTS:
- Status: Adequate
- Coverage: Tests in tests/commands/add.test.ts cover all three branches thoroughly:
  - "bare add -- tag resolution" (lines 3102-3278): 9 tests including fetchRemoteTags-exactly-once assertion (line 3266)
  - "explicit constraint -- tag resolution" (lines 3280-3494): 12 tests including fetchRemoteTags-exactly-once assertion (line 3482)
  - "exact tag and branch ref -- no constraint" (lines 3496+): tests verify fetchRemoteTags is NOT called for exact tag/branch ref
  - Re-add scenarios (line 3629+) also exercise the restructured function
- Notes: The existing tests directly validate the acceptance criteria. The fetchRemoteTags-call-count assertions specifically guard against the double-fetch scenario that motivated this task.

CODE QUALITY:
- Project conventions: Followed
- SOLID principles: Good -- single responsibility (tag resolution), clear separation from the rest of the add pipeline
- Complexity: Low -- straightforward if/else-if with two branches plus an early return for local-path
- Modern idioms: Yes -- spread operator for immutable updates, nullish coalescing for constraint derivation
- Readability: Good -- clear comments on each branch ("Bare add: ..." and "Explicit constraint: ..."), the if/else-if structure communicates intent better than the previous sequential blocks
- Issues: None

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- (none)
