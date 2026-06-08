AGENT: architecture
CYCLE: 7
STATUS: findings
FINDINGS_COUNT: 1

FINDINGS:

- FINDING: No-agents / empty-selection decision is replicated across three call sites rather than owned by one seam
  SEVERITY: low
  FILES: src/nuke-reinstall-pipeline.ts:256-269, src/agent-select.ts:60-65, src/commands/add.ts:328-334, src/commands/add.ts:605-609
  DESCRIPTION: `add` resolves effective agents through `selectAgents` (declared ceiling → KNOWN_AGENTS default, interactive), while `update`'s replay resolves them through `resolveAgents` + `computeAgentChanges` (silent intersection of recorded agents with new config). The two flows are genuinely different operations (interactive pick vs. silent narrowing) and correctly never share a call site, so two paths is defensible. The mild smell is that the "zero agents → skip/abort" decision is interpreted independently in `resolveAgents` (returns no-agents status), in add's standalone tail, and in add's per-member loop. A future change to the zero-agents policy must be edited in multiple places. Low impact: each site is small and currently consistent.
  RECOMMENDATION: No restructuring required for correctness. If this area is touched later, consider a single predicate that both flows feed for the zero-agents decision, layering the interactive-vs-silent difference on top.

SUMMARY: Architecture composes well — the non-success failure union (aborted/blocked/no-agents/copy-failed) is defined once beside its mapper (mapCloneFailure) and narrowing predicate (isCloneReinstallFailure) and reused across all four reinstall entry points (update single, update all, list-update, list-change-version); a single discriminator (status) drives dispatch with no runtime type-sniffing. Type detection runs a single structural path with overrides feeding only the ambiguous case; the resolved type is derived once and replayed (never silently re-detected). Copy-safety guards are pure, well-typed, and share one boundary-correct containment predicate. manifestTypeFromDetected (detect→manifest) and deriveTypeFromFiles (legacy backfill) are intentionally distinct (different inputs). findPresentAssetDirs is the single asset-dir scan reused by detection, membership, and plugin replay. Integration tests cover the real-fs flows (bare-skill add, plugin collision, agent-drop update, remove, configless detection→manifest, legacy backfill round-trip, derive-before-delete abort both types, copy-safety block/permit, and now the pipeline-level blocked-before-nuke seam). Only one low-severity composition nit found (replicated zero-agents decision across three call sites).
