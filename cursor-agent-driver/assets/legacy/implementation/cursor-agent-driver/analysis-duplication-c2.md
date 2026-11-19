AGENT: duplication
FINDINGS:
- FINDING: Repeated "skipped" result object in collection pipeline
  SEVERITY: low
  FILES: src/commands/add.ts:441-446, src/commands/add.ts:458-463, src/commands/add.ts:469-474, src/commands/add.ts:498-503, src/commands/add.ts:533-538
  DESCRIPTION: The object literal `{ pluginName, status: "skipped", copiedFiles: [], agents: [] }` is repeated 5 times in `runCollectionPipeline`. Each instance pushes the same shape into the `results` array at a different early-exit point. Five instances exceeds the Rule of Three, though the object is small (4 properties) and all instances live within a single function.
  RECOMMENDATION: Extract a local helper within `runCollectionPipeline`, e.g. `const skippedResult = (name: string): PluginInstallResult => ({ pluginName: name, status: "skipped", copiedFiles: [], agents: [] })`. Each call site becomes `results.push(skippedResult(pluginName))`. Keeps the change local to the function -- no new module needed.
SUMMARY: One low-severity finding: a 4-property "skipped" result object repeated 5 times in the collection pipeline loop. No cross-file duplication detected beyond the cycle-1 finding (already fixed).
