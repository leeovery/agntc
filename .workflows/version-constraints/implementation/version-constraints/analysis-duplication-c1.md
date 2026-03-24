AGENT: duplication
FINDINGS:
- FINDING: ls-remote tag parsing duplicated between git-utils.ts and update-check.ts
  SEVERITY: high
  FILES: src/git-utils.ts:33-42, src/update-check.ts:36-47
  DESCRIPTION: fetchRemoteTags (git-utils.ts) and parseAllTags (update-check.ts) contain near-identical logic for parsing git ls-remote --tags output. Both split on newlines, filter empty lines, filter ^{} annotated refs, split on tab, and strip refs/tags/ prefix. parseTagCommitMap (update-check.ts:162-176) is a third variant that also parses the same format but retains the SHA. Three separate implementations of ls-remote tag output parsing exist across two files, each written independently.
  RECOMMENDATION: Extract a single shared parser in git-utils.ts that returns an array of { tag, sha } objects. fetchRemoteTags can map to tag names. parseAllTags and parseTagCommitMap in update-check.ts can be replaced by calling fetchRemoteTags (for tag names) or the new shared parser (for the map). This eliminates ~25 lines of duplicated parsing logic.

- FINDING: Downgrade prevention logic duplicated within update.ts
  SEVERITY: medium
  FILES: src/commands/update.ts:155-158, src/commands/update.ts:494-497
  DESCRIPTION: The same downgrade-prevention check using gte(clean(entry.ref) ?? "0.0.0", clean(result.tag) ?? "0.0.0") appears in both runSingleUpdate (line 155-158) and runAllUpdates (line 494-497). Both check if the current ref is already >= the constrained update target and skip if so. The logic is identical but operates on slightly different variable shapes (entry vs checked.entry).
  RECOMMENDATION: Extract a helper function like shouldSkipConstrainedUpdate(currentRef: string | null, targetTag: string): boolean in update.ts or version-resolve.ts. Both call sites can use this, eliminating the risk of one being updated without the other.

- FINDING: cloneAndReinstall call pattern with optional overrides duplicated in update.ts
  SEVERITY: medium
  FILES: src/commands/update.ts:210-220, src/commands/update.ts:315-324
  DESCRIPTION: runSinglePluginUpdate and processUpdateForAll both construct nearly identical call objects for cloneAndReinstall, including the same conditional spread patterns: (isLocal ? { sourceDir: key } : {}) and (overrides !== undefined ? { newRef: overrides.newRef, newCommit: overrides.newCommit } : {}). The two functions share the same purpose (execute a single plugin update) but differ in error handling strategy (single-plugin throws ExitSignal, batch returns outcome objects).
  RECOMMENDATION: Extract the common call-object construction into a helper like buildReinstallInput(key, entry, projectDir, overrides?, isLocal?) that returns the options object. Both functions call this helper, then diverge only in error handling. This removes ~10 lines of duplicated spread logic.

- FINDING: droppedSuffix formatting repeated four times in summary.ts
  SEVERITY: medium
  FILES: src/summary.ts:148-151, src/summary.ts:165-168, src/summary.ts:190-193, src/summary.ts:197-200
  DESCRIPTION: Four instances of the droppedSuffix pattern exist in summary.ts: renderGitUpdateSummary, renderLocalUpdateSummary, and two branches within renderUpdateOutcomeSummary. Each constructs a suffix string from a droppedAgents array with minor wording variations (". X support removed by plugin author." vs " -- X support removed by plugin author").
  RECOMMENDATION: Extract a formatDroppedAgentsSuffix(droppedAgents: string[], separator?: string) helper within summary.ts. The two wording variants (sentence-start with period vs dash-prefixed) can be parameterized. Reduces four ~3-line blocks to single-line calls.

- FINDING: makeEntry test helper duplicated across five test files
  SEVERITY: low
  FILES: tests/commands/list-change-version-action.test.ts:96-106, tests/commands/list-detail.test.ts:31-41, tests/nuke-reinstall-pipeline.test.ts:57-67, tests/update-check-constrained.test.ts:14-24, tests/update-check-unconstrained-regression.test.ts:12-22
  DESCRIPTION: Five test files independently define a makeEntry(overrides?: Partial<ManifestEntry>): ManifestEntry helper with the same structure (spread defaults + overrides). The default field values differ slightly between files (e.g., commit is "a".repeat(40) in some, "abc1234567890def" in others), but the pattern is identical.
  RECOMMENDATION: Extract a shared makeEntry helper into a tests/helpers/ module. Each test file can import and optionally override defaults. This is low-severity because test helpers are inherently local, but with five copies the drift risk is real.

SUMMARY: The most impactful finding is the triplication of ls-remote tag output parsing across git-utils.ts and update-check.ts, where three separate functions parse the same git output format independently. The downgrade-prevention check and cloneAndReinstall call construction are duplicated within update.ts due to the single-plugin vs batch-update code paths being implemented independently. Summary formatting has four repeated droppedSuffix blocks. Test helper duplication is minor but present across five files.
