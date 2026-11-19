AGENT: duplication
CYCLE: 4
STATUS: findings
FINDINGS_COUNT: 3

FINDINGS:

- FINDING: Symlink-escape scan + error-mapping block duplicated across three install/replay sites
  SEVERITY: medium
  FILES: src/commands/add.ts:313-321, src/commands/add.ts:593-607, src/nuke-reinstall-pipeline.ts:103-113
  DESCRIPTION: The "call scanForEscapingSymlinks, catch, narrow to SymlinkEscapeError, map to an outcome, rethrow otherwise" block is hand-authored three times. Standalone add (add.ts:313) and update pipeline (nuke-reinstall-pipeline.ts:103) are near-identical try/catch wrappers around the same scan; the collection-member path (add.ts:593) is the same with a different failure-recording arm. Each repeats the `if (err instanceof SymlinkEscapeError)` narrowing and `throw err` fall-through, diverging only in how the violation is surfaced (cancel+ExitSignal / failed-result push / blocked status). (Flagged low in cycle 3 and discarded as borderline rule-of-three; now firmly at three sites.)
  RECOMMENDATION: Extract a helper in copy-safety.ts that runs the scan and returns a discriminated `{ ok: true } | { ok: false; message: string }` instead of throwing, so each caller maps a value rather than re-authoring the try/catch + instanceof narrowing. Site-specific surfacing stays at the call site. Consolidation only.

- FINDING: Per-unit install sequence + manifest-entry construction duplicated between standalone and collection-member paths in add.ts
  SEVERITY: medium
  FILES: src/commands/add.ts:304-384, src/commands/add.ts:586-716
  DESCRIPTION: Both the standalone install (steps 9b-13) and the collection per-member loop body run the same ordered sequence against a resolved standalone unit: symlink pre-flight, nuke existing files if an entry exists, computeIncomingFiles(toComputeInput(...)), runConflictChecks, copyUnit, then buildManifestEntry + addEntry. The manifest-entry literal is a near-identical ~9-line block at add.ts:374-382 and add.ts:706-714 (same field set, same manifestTypeFromDetected/deriveCloneUrlForManifest helper calls; only the agents/files source and constraint variable name differ). Authored separately and drifting incidentally (collection path nukes inside a per-member try/catch; standalone does not).
  RECOMMENDATION: Extract the "install one resolved standalone unit and build its manifest entry" tail into a shared helper taking (detected, unitDir, agents, projectDir, parsed, commit, constraint, currentManifest), returning copiedFiles + the built entry (or a skip signal). Collection-specific result/skip bookkeeping stays at the call site.

- FINDING: buildFailureMessage re-derives messages already centralised in failureMessage and is unused in production
  SEVERITY: low
  FILES: src/clone-reinstall.ts:199-212, src/clone-reinstall.ts:184-197
  DESCRIPTION: buildFailureMessage hand-rolls a no-agents message ("Plugin ${key} no longer supports any of your installed agents") plus a clone/copy/unknown passthrough — the exact dispatch failureMessage already centralises via mapCloneFailure. The same no-agents sentence is also authored inline at clone-reinstall.ts:434 and update.ts:216. buildFailureMessage has no production caller (only tests/clone-reinstall.test.ts) — a parallel, unmaintained implementation that can silently drift from failureMessage. (Superseded by cycle-3's failureMessage extraction but not removed.)
  RECOMMENDATION: Remove buildFailureMessage and fold its coverage into failureMessage, or have it delegate to failureMessage. Source the repeated no-agents sentence (clone-reinstall.ts:434, update.ts:216) from a single constant/helper.

SUMMARY: Three consolidation-only duplication points — the symlink-scan-and-narrow block (3 sites), the per-unit install + manifest-entry-build tail (standalone vs collection-member), and the redundant buildFailureMessage paralleling the centralised failureMessage. No behaviour change in any fix.
