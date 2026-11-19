AGENT: duplication
CYCLE: 2
STATUS: findings
FINDINGS_COUNT: 3

FINDINGS:

- FINDING: Plugin-vs-bare-skill copy dispatch duplicated within add.ts
  SEVERITY: medium
  FILES: src/commands/add.ts:343-359, src/commands/add.ts:656-685
  DESCRIPTION: The standalone install path (step 11) and the collection-member install loop (step 5b) each branch `detected.type === "plugin"` → copyPluginAssets({ sourceDir, assetDirs, agents, projectDir }) else copyBareSkill({ sourceDir, projectDir, agents }), then assemble copiedFiles/assetCountsByAgent the same way. The same two-arm copy dispatch is also independently encoded at the recorded-type replay layer in nuke-reinstall-pipeline.ts (replayRecordedSkill/replayRecordedPlugin) — three separately-authored encodings of "given a unit type, run the matching copy fn."
  RECOMMENDATION: Extract a single copyUnit(detected, { sourceDir, agents, projectDir }) helper returning { copiedFiles, assetCountsByAgent? } that owns the plugin/bare-skill branch; call from both add.ts sites. Replay functions stay separate (they gate on recorded-type validation) but can consume the same copyUnit.

- FINDING: computeIncomingFiles input-shape ternary duplicated within add.ts
  SEVERITY: low
  FILES: src/commands/add.ts:313-322, src/commands/add.ts:603-616
  DESCRIPTION: Both install paths build the discriminated ComputeInput with the identical `detected.type === "plugin" ? { type:"plugin", sourceDir, assetDirs, agents } : { type:"bare-skill", sourceDir, agents }` shape. Same mapping authored twice; pairs with the copy dispatch above.
  RECOMMENDATION: Fold this mapping into the same copyUnit/unit-descriptor helper, or a small shared toComputeInput(detected, sourceDir, agents).

- FINDING: Non-success clone-reinstall result guard repeated across four call sites
  SEVERITY: low
  FILES: src/commands/update.ts:209-213, :300-304, src/commands/list-update-action.ts:51-55, src/commands/list-change-version-action.ts:102-106
  DESCRIPTION: All four reinstall entry points open with the identical 3-term guard `result.status === "failed" || result.status === "aborted" || result.status === "no-agents"` immediately before delegating to mapCloneFailure. A future non-success status would require editing all four.
  RECOMMENDATION: Add an isCloneReinstallFailure(result): type-guard next to mapCloneFailure in clone-reinstall.ts and use it at all four sites, co-locating the failure-set definition with mapCloneFailure.

SUMMARY: The two related copy-dispatch duplications in add.ts (plugin-vs-bare-skill copy block + computeIncomingFiles input shape, each authored twice across standalone and collection paths) are the highest-value consolidation; the four-site failure-status guard is a clean type-guard extraction. Shared reinstall helpers and test factories are already well-extracted.
