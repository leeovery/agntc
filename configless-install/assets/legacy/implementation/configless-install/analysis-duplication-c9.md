AGENT: duplication
CYCLE: 9
STATUS: findings
FINDINGS_COUNT: 4

FINDINGS:

- FINDING: prepareReinstall's structured failure reason discarded and re-authored at three of four call sites
  SEVERITY: medium
  FILES: src/commands/list-update-action.ts:43-46, src/commands/list-change-version-action.ts:94-97, src/commands/update.ts:206-208, src/commands/update.ts:299-304
  DESCRIPTION: prepareReinstall already returns a structured `{ ok: false, reason }` (clone-reinstall.ts:60-63) where `reason` is the precise local-path validation message ("path does not exist" / "path is not a directory"). Three callers throw that reason away and re-author a fixed literal "Path ${key} does not exist or is not a directory" — and they have already drifted: list-update-action and list-change-version-action emit it with no trailing period, update.ts:207 with a trailing period. The fourth caller (processUpdateForAll, update.ts:303) instead does the right thing — `${key}: Failed — ${prepared.reason}`. KNOWN RECURRENCE (flagged low in c7/c8, discarded below-threshold).
  RECOMMENDATION: Add one shared formatter beside prepareReinstall in clone-reinstall.ts (e.g. `prepareFailureMessage(key, reason)`) and call it from all four `!prepared.ok` branches.

- FINDING: PluginInstallResult "skipped"/"failed" literal repeated across the collection per-member loop
  SEVERITY: medium
  FILES: src/commands/add.ts:596-601, :607-612, :654-661, :670-677, :695-701, :737-744
  DESCRIPTION: The collection per-member loop pushes a near-identical result object `{ pluginName: memberName, status: "skipped"|"failed", copiedFiles: [], agents: [] }` (plus optional `errorMessage`) at six bail-out points. KNOWN RECURRENCE (flagged in c6 as below-threshold).
  RECOMMENDATION: Add two tiny local builders in add.ts, e.g. `skippedMember(pluginName)` and `failedMember(pluginName, errorMessage)`, and replace the six inline literals.

- FINDING: `isLocal = entry.commit === null` recomputed at every reinstall entry point
  SEVERITY: low
  FILES: src/commands/update.ts:200, :294, src/commands/list-update-action.ts:35, src/clone-reinstall.ts:57
  DESCRIPTION: The local-vs-remote discriminator `entry.commit === null` is recomputed inline in four sites that consume ManifestEntry for reinstall.
  RECOMMENDATION: Expose `isLocalEntry(entry: ManifestEntry): boolean` in manifest.ts; call from the four sites. Low priority — fold in opportunistically.

- FINDING: Short-commit-SHA formatting duplicated between the two git-update summary renderers
  SEVERITY: low
  FILES: src/summary.ts:182-183, :224-225
  DESCRIPTION: renderGitUpdateSummary and renderUpdateOutcomeSummary's git-update arm each independently compute `oldShort`/`newShort` (7-char slice + "unknown" fallback).
  RECOMMENDATION: Extract `formatCommitTransition(oldCommit, newCommit)` / a `shortSha` helper in summary.ts and reuse in both renderers.

SUMMARY: The clone-reinstall consolidation already done is strong; residual duplication is concentrated at the four reinstall entry points and the collection per-member loop. The two medium items (prepareReinstall reason, member-result literal) are KNOWN RECURRENCES previously judged below-threshold. No new high-impact duplication.
