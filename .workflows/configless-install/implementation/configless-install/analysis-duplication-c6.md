AGENT: duplication
CYCLE: 6
STATUS: findings
FINDINGS_COUNT: 1

FINDINGS:

- FINDING: Repeated per-member PluginInstallResult literals in the collection pipeline
  SEVERITY: low
  FILES: src/commands/add.ts:572-577, :583-588, :647-652, :671-676 (plus the parallel "failed" literals at :630-636 and :713-721)
  DESCRIPTION: The collection per-member loop in runCollectionPipeline pushes the same five-field "skipped" result literal `{ pluginName, status: "skipped", copiedFiles: [], agents: [] }` at four points (not-agntc child, nested-collection child, failed-nuke, unresolved-conflict). The two "failed" literals share the same shape plus an errorMessage field. Independent hand-authored copies of one outcome shape; if PluginInstallResult gains or renames a field, every site must be edited in lockstep, and the empty copiedFiles/agents defaults can silently drift. Within-file repetition of a small structured literal rather than logic, so impact is modest — but it is exactly the kind of factored constructor the module already favours (memberKey, buildAddEntry, toComputeInput).
  RECOMMENDATION: Extract two tiny local factory helpers in add.ts, e.g. skippedResult(pluginName) and failedResult(pluginName, errorMessage), returning the PluginInstallResult literal with the constant copiedFiles: []/agents: [] defaults, and call them at the six sites. Consolidates the outcome shape to one place without changing behaviour.

SUMMARY: Well-factored after five cycles — the major cross-file patterns (symlink scan, manifest-entry construction, member-key derivation, reinstall flow, copy dispatch) are consolidated. The only remaining actionable item is a minor in-file repetition of the per-member result literal in the collection pipeline. (Noted but NOT raised, below threshold: the agent-driver mapping (id) => ({ id, driver: getDriver(id) }) recurs 3 times at add.ts:339, add.ts:611, nuke-reinstall-pipeline.ts:139, each ~3 lines.)
