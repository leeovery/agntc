AGENT: duplication
FINDINGS:
- FINDING: PluginInstallResult and CollectionPluginResult are identical interfaces
  SEVERITY: medium
  FILES: src/commands/add.ts:347, src/summary.ts:101
  DESCRIPTION: PluginInstallResult (add.ts) and CollectionPluginResult (summary.ts) have identical fields: pluginName, status, copiedFiles, agents, assetCountsByAgent?, detectedType?, errorMessage?. These were likely written by separate executors (one for the command layer, one for the summary layer) and ended up as independent copies of the same shape. If one evolves, the other must be kept in sync manually.
  RECOMMENDATION: Extract a single shared interface (e.g., PluginInstallResult) and export it from one location. summary.ts should import it rather than redeclaring it. The natural home is whichever module owns the concept -- likely add.ts since it produces the data, or a shared types file if other commands also produce this shape.
SUMMARY: One medium-severity finding: identical interface declared independently in add.ts and summary.ts. The three driver classes (claude, codex, cursor) share a structural pattern but are pre-existing architecture, not implementation-scope duplication.
