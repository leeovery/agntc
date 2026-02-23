AGENT: duplication
FINDINGS:
- FINDING: agntc.json write-or-skip-or-overwrite logic duplicated between scaffold-skill and scaffold-plugin
  SEVERITY: medium
  FILES: src/init/scaffold-skill.ts:18-31, src/init/scaffold-plugin.ts:17-30
  DESCRIPTION: Both scaffold-skill.ts and scaffold-plugin.ts independently implement the same 14-line pattern for handling agntc.json: build JSON content with JSON.stringify, check if file exists via pathExists, branch on reconfigure to overwrite/skip/create, and push to the corresponding result array. The two blocks are structurally identical -- the only differences are destructuring style (options.targetDir vs targetDir, options.reconfigure vs reconfigure). This was identified in cycle 1 finding 3 but the fix tasks addressed scaffoldCollection composition and shared utilities without extracting this specific block into a helper.
  RECOMMENDATION: Extract a shared helper in scaffold-utils.ts such as writeConfigFile(targetDir, agents, reconfigure) that returns { action: "created" | "skipped" | "overwritten" } and handles the full check-write-classify flow. Both scaffoldSkill and scaffoldPlugin call it and push to the appropriate result array based on the returned action. This eliminates 14 duplicated lines and creates a single source of truth for config file write semantics.

- FINDING: pre-check.ts reimplements pathExists inline instead of using shared utility
  SEVERITY: low
  FILES: src/init/pre-check.ts:13-17, src/init/scaffold-utils.ts:9-16
  DESCRIPTION: pre-check.ts uses its own inline try/catch around fs.access to check whether agntc.json exists, which is the same pattern already extracted to pathExists in scaffold-utils.ts. While the surrounding control flow differs (pre-check returns early rather than storing a boolean), the existence-check itself is identical and the shared utility exists specifically for this purpose.
  RECOMMENDATION: Import pathExists from scaffold-utils.ts and replace the inline try/catch with a simple `if (!(await pathExists(configPath)))` guard. This is a minor cleanup (5 lines to 1) but improves consistency by using the shared utility everywhere.

SUMMARY: Cycle 1 fixes successfully eliminated the highest-severity duplication (template, pathExists, ScaffoldResult, collection composition). One medium-severity duplicate remains: the 14-line agntc.json write-or-skip-or-overwrite block shared between scaffold-skill.ts and scaffold-plugin.ts, which was identified in cycle 1 but not extracted. A minor low-severity instance of inline pathExists reimplementation exists in pre-check.ts.
