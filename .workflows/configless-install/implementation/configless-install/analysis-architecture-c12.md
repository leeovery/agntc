AGENT: architecture
CYCLE: 12
STATUS: findings
FINDINGS_COUNT: 3

FINDINGS:
- FINDING: Integration suite never exercises the command entry points end-to-end
  SEVERITY: medium
  FILES: tests/integration/workflows.test.ts:88-1219, src/commands/add.ts:496-819
  DESCRIPTION: Every integration case hand-wires the leaf functions (detectType → copy* → addEntry → writeManifest) and re-implements the orchestration the production code performs. No test drives runAdd, runCollectionPipeline, runUpdate, or executeUpdateAction through a real source tree. The most load-bearing configless seams — runCollectionPipeline's per-member forcePlugin=memberHasAssetDirs gate, the memberKey/memberSourceSubpath/segment-vs-basename decoupling, the step-2c path-traversal guard ordering — are covered only by mocked unit tests. KNOWN RECURRENCE (flagged c11 architecture, discarded as test-STRATEGY change / established project approach; the acute c9 regression gap is itself now closed by the c11 resolveUpdateSourceDir extraction + direct cloneAndReinstall tests added in c10/c11).
  RECOMMENDATION: Add integration cases invoking runCollectionPipeline / runAdd via a local-path source against a real on-disk fixture (prompts mocked as in command tests), prioritising the skills-only-inner-member and member-with-asset-dirs cases. NOTE (orchestrator): test-strategy expansion, not a defect; consistently below the action bar for this work unit; the acute gap that produced the c9 regression is already closed.
- FINDING: renderCollectionAddSummary `failed` filter has a type predicate wider than its runtime guard
  SEVERITY: low
  FILES: src/summary.ts:153-157
  DESCRIPTION: The `failed` array is built with `r.status === "failed"` but annotated `is Extract<PluginInstallResult, { status: "skipped" | "failed" }>`. The predicate claims the array may contain `skipped` while the runtime filter excludes them. Harmless today (both non-installed variants share an identical shape) but the predicate misrepresents the array's contents. Behaviour-neutral cosmetic. Below-threshold.
  RECOMMENDATION: Narrow the predicate to `is Extract<PluginInstallResult, { status: "failed" }>`.
- FINDING: "Is this a local install" recomputed inline at four sites instead of being a named domain predicate
  SEVERITY: low
  FILES: src/clone-reinstall.ts:58, src/commands/update.ts:200, src/commands/update.ts:294, src/commands/list-update-action.ts:35
  DESCRIPTION: `entry.commit === null` re-authored at four reinstall sites. KNOWN RECURRENCE (c9/c10/c11, dup agent c12). Below-threshold.
  RECOMMENDATION: Expose isLocalEntry(entry) in manifest.ts; call from the four sites.

SUMMARY: Architecture is strong and well-documented — clean discriminated-union result types, single-source helpers (memberKey, resolveUpdateSourceDir, mapCloneFailure, findPresentAssetDirs), tight type-driven seams. The recurring observation is integration coverage (orchestrators tested via mocks + hand-wired components, not real command entry points — a test-strategy item discarded in c11; acute c9 gap already closed), plus two below-threshold polish items (over-wide type predicate, repeated unnamed local-install predicate).
