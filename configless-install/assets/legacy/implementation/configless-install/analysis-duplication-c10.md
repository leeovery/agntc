AGENT: duplication
CYCLE: 10
STATUS: findings
FINDINGS_COUNT: 4

FINDINGS:
- FINDING: Four reinstall entry points repeat the same prepare→clone→failure→write orchestration
  SEVERITY: medium
  FILES: src/commands/list-update-action.ts:38-56, src/commands/list-change-version-action.ts:89-108, src/commands/update.ts:202-252, src/commands/update.ts:296-355
  DESCRIPTION: All four update entry points execute the identical post-`prepareReinstall` sequence: call `prepareReinstall`, early-return on `!prepared.ok`, call `cloneAndReinstall(prepared.options)`, branch on `isCloneReinstallFailure(result)`, and on success `addEntry` then `writeManifest`. The success/failure dispatch is partly shared (`failureMessage`, `mapCloneFailure`), but the spine is hand-authored four times and has drifted (the not-ok message string differs). Largest remaining cross-file duplication and the most drift-prone. (Partial known recurrence — the consolidation of these entry points was already done in c1 Task 1; the residual spine is the remaining tail.)
  RECOMMENDATION: Extract a single orchestration helper in clone-reinstall.ts (e.g. `runReinstall(...)`) returning a discriminated result; callers keep only their distinct presentation/exit mapping.
- FINDING: "Path … does not exist or is not a directory" message re-authored and already drifting, ignoring prepareReinstall's own reason
  SEVERITY: low
  FILES: src/commands/list-change-version-action.ts:96, src/commands/list-update-action.ts:45, src/commands/update.ts:207
  DESCRIPTION: Three of four reinstall entry points hardcode `Path ${key} does not exist or is not a directory` while `prepareReinstall` already returns structured `prepared.reason`. The fourth (processUpdateForAll, update.ts:303) uses `prepared.reason`. The three copies have drifted (trailing period) and ignore the real reason. KNOWN RECURRENCE (c7/c8/c9, below-threshold).
  RECOMMENDATION: Route all three through `prepared.reason`, or derive the sentence once beside prepareReinstall.
- FINDING: `isLocal = entry.commit === null` recomputed at four sites
  SEVERITY: low
  FILES: src/clone-reinstall.ts:58, src/commands/update.ts:200, src/commands/update.ts:294, src/commands/list-update-action.ts:35
  DESCRIPTION: The "is this a local-path install" predicate is the inline literal `entry.commit === null` in four places. KNOWN RECURRENCE (c9, below-threshold).
  RECOMMENDATION: Add `isLocalEntry(entry): boolean` in manifest.ts; use at the four sites.
- FINDING: Commit-shortening + dropped-agents assembly duplicated between the two git-update summary renderers
  SEVERITY: low
  FILES: src/summary.ts:190-198, src/summary.ts:231-247
  DESCRIPTION: renderGitUpdateSummary and renderUpdateOutcomeSummary's git-update arm independently compute `oldShort`/`newShort` (7-char slice + "unknown" fallback). KNOWN RECURRENCE (c9, below-threshold).
  RECOMMENDATION: Extract `shortCommit(commit: string | null): string` in summary.ts; reuse in both renderers.

SUMMARY: The implementation has been consolidated across prior cycles. Remaining duplication is concentrated in the four update entry points (residual prepare→clone→failure→write spine after c1's partial consolidation) plus the already-drifted path-not-ok message; smaller items are the `entry.commit === null` predicate and commit-shortening in summary.ts. All items are known recurrences previously held below-threshold.
