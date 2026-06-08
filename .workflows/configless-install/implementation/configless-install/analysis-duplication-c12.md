AGENT: duplication
CYCLE: 12
STATUS: findings
FINDINGS_COUNT: 5

FINDINGS:
- FINDING: Four near-duplicate prepare → clone → map-failure → write-manifest reinstall driver bodies
  SEVERITY: medium
  FILES: src/commands/update.ts:193-277, src/commands/update.ts:287-389, src/commands/list-update-action.ts:28-66, src/commands/list-change-version-action.ts:89-114
  DESCRIPTION: All four update entry points repeat the same skeleton: prepareReinstall → bail on !prepared.ok with a "Path … does not exist or is not a directory" message → cloneAndReinstall → isCloneReinstallFailure → failure presenter → on success addEntry/writeManifest. The shared machinery is already factored into clone-reinstall.ts, but the orchestration sequence + the !prepared.ok message string are re-authored at all four sites. KNOWN RECURRENCE (c1 partial consolidation; c10/c11 residual-spine, below-threshold).
  RECOMMENDATION: Extract a "run reinstall → discriminated result" helper in clone-reinstall.ts; callers map only their presentation channel.
- FINDING: Duplicated git-update / local-update summary branching across the two update report styles
  SEVERITY: medium
  FILES: src/commands/update.ts:254-274, src/commands/update.ts:357-381, src/summary.ts:181-247
  DESCRIPTION: runSinglePluginUpdate and processUpdateForAll both branch on isLocal and assemble a summary from identical inputs; summary.ts carries two parallel renderer families computing the same short-SHA pair + formatDroppedAgentsSuffix. KNOWN RECURRENCE (c9/c10 commit-shortening, below-threshold).
  RECOMMENDATION: Collapse into one parametrised renderer keyed on style; or at minimum hoist a formatCommitTransition helper.
- FINDING: never-downgrade constrained-update guard duplicated between single and all-plugins update
  SEVERITY: low
  FILES: src/commands/update.ts:165-181, src/commands/update.ts:481-502
  DESCRIPTION: The constrained-update-available handling repeats the isAtOrAboveVersion never-downgrade gate + the { newRef, newCommit } override literal in both runSingleUpdate and runAllUpdates. Behaviour-neutral. Below-threshold.
  RECOMMENDATION: Extract resolveConstrainedOverride(entry, result) owning the gate + override literal.
- FINDING: Repeated "cancelled or empty selection → skip" agent-selection result handling
  SEVERITY: low
  FILES: src/commands/add.ts:359-365, src/commands/add.ts:653-657
  DESCRIPTION: Both the standalone tail and the collection per-member loop test `selection.kind === "cancelled" || selection.agents.length === 0` inline. Behaviour-neutral. Below-threshold.
  RECOMMENDATION: Add isNoAgentsSelected(result) beside selectAgents; both call sites use it (divergent messaging stays per-caller).
- FINDING: `isLocal = entry.commit === null` re-derived at multiple call sites
  SEVERITY: low
  FILES: src/commands/update.ts:200, src/commands/update.ts:294, src/commands/list-update-action.ts:35, src/clone-reinstall.ts:58
  DESCRIPTION: The local-path-install determination is re-authored as an isLocal local at four sites. KNOWN RECURRENCE (c9/c10/c11). Below-threshold.
  RECOMMENDATION: Expose isLocalEntry(entry) in manifest.ts; all sites use it.

SUMMARY: The shared clone-reinstall plumbing already absorbs most cross-file risk. Remaining duplication is concentrated in the four update entry points (prepare→clone→narrow orchestration) and the parallel git/local update-summary renderers, plus small re-derived invariants. All are KNOWN RECURRENCES or below-threshold behaviour-neutral cleanups previously deferred. No new high-impact duplication.
