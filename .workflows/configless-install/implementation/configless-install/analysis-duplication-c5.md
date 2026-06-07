AGENT: duplication
CYCLE: 5
STATUS: findings
FINDINGS_COUNT: 2

All prior-cycle duplication findings have been consolidated (checkEscapingSymlinks, noAgentsMessage, buildFailureMessage removed). Two low-severity residues remain, both inside add.ts.

FINDINGS:

- FINDING: Manifest-entry construction literal duplicated across the two add.ts install paths
  SEVERITY: low
  FILES: src/commands/add.ts:369-377, src/commands/add.ts:700-708
  DESCRIPTION: The standalone install tail (step 13) and the collection per-member manifest-build loop (step 6) each hand-author the same buildManifestEntry({ ref, commit, agents, files, type: manifestTypeFromDetected(...), cloneUrl: deriveCloneUrlForManifest(parsed), constraint }) literal — same seven fields, same manifestTypeFromDetected + deriveCloneUrlForManifest helper calls, differing only in the agents/files/detected source (selectedAgents/copiedFiles/detected vs result.agents/result.copiedFiles/result.detectedType) and the constraint variable name (resolvedConstraint vs constraint). A field addition must be mirrored in both. (Carried from cycle-4 finding #2, which flagged the broader install tail; the surrounding sequence was left intentionally distinct — only this literal remains genuinely duplicated.)
  RECOMMENDATION: Extract a small local helper (e.g. buildAddEntry(detected, agents, files, parsed, commit, constraint)) in add.ts owning the field assembly + the manifestTypeFromDetected/deriveCloneUrlForManifest calls, invoked by both paths. Consolidation only.

- FINDING: Collection manifest-key ternary repeated within runCollectionPipeline
  SEVERITY: low
  FILES: src/commands/add.ts:576-579, src/commands/add.ts:696-699
  DESCRIPTION: The per-member key derivation `parsed.type === "direct-path" ? parsed.manifestKey : \`${parsed.manifestKey}/${pluginName}\`` is authored twice in the same function — once building pluginManifestKey for the conflict/nuke pass (5a) and again building manifestKey in the write loop (step 6). The write loop reconstructs the key from result.pluginName rather than reusing the already-computed 5a value, so the keying rule lives in two places and could drift if the direct-path special-case changes.
  RECOMMENDATION: Compute the member key once (a small memberKey(parsed, pluginName) helper, or carry the already-computed pluginManifestKey through pluginsToInstall/results to the write loop) and reference it in both places. Consolidation only.

SUMMARY: Two low-severity residues inside add.ts — a twice-authored manifest-entry literal across the standalone vs collection paths, and a member-key ternary repeated within runCollectionPipeline. Neither changes behaviour to fix. All prior-cycle duplication findings consolidated.
