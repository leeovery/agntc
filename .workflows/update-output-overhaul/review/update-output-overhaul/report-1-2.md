TASK: 1.2 — Extract cloneRepoOnce clone primitive from cloneAndReinstall

ACCEPTANCE CRITERIA:
1. cloneRepoOnce returns the { tempDir, commit } from cloneSource and passes newRef ?? entry.ref as the parsed source's ref (constrained resolved-tag override reaches git clone --branch <resolved-tag>).
2. cloneRepoOnce throws (does not swallow) when cloneSource rejects; no internal retry loop is added (retry stays inside cloneSource).
3. cloneAndReinstall still returns { status: "failed", failureReason: "clone-failed" } on cloneSource rejection, and still calls spin.start("Cloning repository...") + spin.stop("Cloned successfully") on success.
4. All existing tests/clone-reinstall.test.ts cases pass unchanged (singleton regression).

STATUS: Complete

SPEC CONTEXT:
Spec "Clone ownership seam — orchestrator" (specification.md:85-91): extract cloneRepoOnce() and add a group orchestrator used by all-mode only; leave cloneAndReinstall as-is for the three singleton entry points (single-key update <key>, both list actions). "Failure isolation & lifecycle" (:106): cloneRepoOnce throws (network/auth/ref gone; cloneSource already retries 3x internally, so a throw is final). Clone-progress rendering on the grouped path is deferred to Phase 2 (:100), so cloneRepoOnce is spinner-free. The clone happens at the group's effective ref — stored ref for an unconstrained group, resolved target tag for a constrained group (passed as newRef override). This task is a pure, behaviour-preserving extraction of the clone half.

IMPLEMENTATION:
- Status: Implemented
- Location: src/clone-reinstall.ts:315-326 (cloneRepoOnce); src/clone-reinstall.ts:352-374 (cloneAndReinstall remote-branch refactor calling it inside the spinner frame).
- Notes: Matches the task spec verbatim. cloneRepoOnce body is buildParsedSourceFromKey(key, newRef ?? entry.ref, entry.cloneUrl) then return cloneSource(parsed) — spinner-free, no try/catch, throw propagates. CloneResult is reused from git-clone.ts (imported at :5). cloneAndReinstall wraps the call in an inner try/catch inside the existing spin frame: on throw it does spin.stop("Clone failed") + returns clone-failed; on success spin.stop("Cloned successfully"), sets tempDir = cloneResult.tempDir and newCommit = options.newCommit ?? cloneResult.commit. The inner catch returns before tempDir is assigned, so the outer finally's `if (tempDir)` cleanup guard is correctly skipped (nothing to clean on clone failure). The per-member resolveGuardedSourceDir guard, runPipeline call, and finally { cleanupTempDir } are left exactly in place — only the clone call moved. No drift from plan.

TESTS:
- Status: Adequate
- Coverage: New describe("cloneRepoOnce") block at tests/clone-reinstall.test.ts:1285-1328 with all three planned cases:
    - "returns tempDir and commit from cloneSource" (:1286) — asserts the returned object AND that cloneSource received objectContaining({ ref: "v1.0.0" }), i.e. the no-override path forwards entry.ref (AC1, default branch).
    - "passes newRef as the clone --branch override when provided" (:1305) — asserts cloneSource received ref: "v2.0.0", override winning over entry.ref (AC1, constrained-tag override branch).
    - "rethrows when cloneSource rejects (retry is internal, throw is final)" (:1320) — rejects.toThrow (AC2).
  Regression coverage present and unmodified: "uses spinner for clone" (:284, AC3), "returns failed with clone-failed reason" (:722, AC3), "cleans up temp dir on success/failure" (:241/:265, AC4).
- Notes: Tests verify behaviour (inputs reaching cloneSource, returned value, throw propagation) rather than internals. AC1's two branches are split across two focused tests; no redundant assertions. Not over-tested: forwarding of entry.cloneUrl (legacy vs explicit URL) is deliberately NOT retested here — that is buildParsedSourceFromKey's own responsibility and has its own coverage; adding it would duplicate. Not under-tested: every AC has a corresponding assertion. A broken cloneRepoOnce (swallowed throw, wrong ref precedence, or lost commit) would fail at least one of the three.

CODE QUALITY:
- Project conventions: Followed. Nullish-coalescing ref precedence, discriminated-union results, exported typed primitive with a thorough JSDoc consistent with the file's house style.
- SOLID principles: Good. cloneRepoOnce is a single-responsibility clone primitive; cloneAndReinstall composes it and owns presentation (spinner) + failure mapping. Clean separation lets the group orchestrator (processGroupUpdate, src/update-groups.ts:384) reuse the clone half without the spinner.
- Complexity: Low. Two-statement primitive; caller adds only the spin frame and one inner try/catch.
- Modern idioms: Yes (input.newRef ?? input.entry.ref).
- Readability: Good. JSDoc at :304-314 states the retry-is-internal / throw-is-final contract and the spinner-free rationale.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None.
