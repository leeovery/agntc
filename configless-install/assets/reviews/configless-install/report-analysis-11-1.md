# Review: configless-install-analysis-11-1

**Task:** Extract update source-dir resolution into a shared tested function (resolveUpdateSourceDir)
**STATUS:** Complete
**FINDINGS_COUNT:** 0 blocking issues

## Spec Context
The cycle-9 rule governs where an update re-copies a member's source from after re-cloning: a skills-only member keyed by basename lives at <clone>/skills/<name> (recorded sourceSubpath), not key-derived <clone>/<name>. Derive-before-delete (spec:245-246) reads at the resolved dir; copy-safety pre-flight (spec:399) runs on update's re-copy. Cycle-10 added a lexical-containment pre-check for an escaping sourceSubpath.

## Implementation — Implemented
- src/source-parser.ts:462-470 — single exported resolveUpdateSourceDir(cloneRoot, key, sourceSubpath: string | undefined). Body exactly `sourceSubpath ? join(cloneRoot, sourceSubpath) : getSourceDirFromKey(cloneRoot, key)`. Doc comment (452-461) records cycle-9 rationale + shared-authoring intent.
- src/clone-reinstall.ts:381 — cloneAndReinstall calls resolveUpdateSourceDir(tempDir, key, entry.sourceSubpath); inline ternary gone.
- src/clone-reinstall.ts:366-379 — cycle-10 guard preserved at the call site, still before the join is read.
- Rule authored in exactly one place (grep for the ternary matches only source-parser.ts). Empty-string sourceSubpath falls to key-derived branch (falsy); guard's if also no-ops on "" — honours "absent/empty is a no-op".
- Optional guard co-location intentionally NOT done; the guard (copy-safety side effects, distinct error path) stays inline; resolveUpdateSourceDir remains the pure rule only — correct behaviour-preserving choice.

## Tests — Adequate
- source-parser.test.ts:1147-1167 — focused unit test, both branches: present returns join(cloneRoot, sourceSubpath); absent returns getSourceDirFromKey(cloneRoot, key) (asserted against the real function, not a duplicated literal → cannot drift).
- tests/integration/workflows.test.ts:34 imports the shared function; case (f) :764-768 and case (g) :860-865 both call resolveUpdateSourceDir instead of re-deriving. Case (g) retains expect(updateSourceDir).toBe(join(reclonedDir, "alpha")), now validating the fallback branch.
- Cycle-10 guard behaviour: tests/clone-reinstall.test.ts:1084-1127 (escape → clone-failed; reads/nuke/copy not called), :1129-1156 (no entry removal), :1158-1193 (contained passes + reinstalls), :1062-1082 (no guard when absent).
- Stale "EXACTLY as cloneAndReinstall:352" comment and any clone-reinstall.ts:NNN reference removed (grep returns nothing).

## Code Quality
Pure helper co-located with getSourceDirFromKey; named export; DRY (three former sites → one); low complexity; doc comment captures cycle-9 rationale. No issues.

## Blocking Issues
None.

## Non-Blocking Notes
None.
