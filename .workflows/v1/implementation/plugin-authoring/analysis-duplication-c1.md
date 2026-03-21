AGENT: duplication
FINDINGS:
- FINDING: SKILL_MD_TEMPLATE duplicated across all three scaffold modules
  SEVERITY: high
  FILES: src/init/scaffold-skill.ts:11-21, src/init/scaffold-plugin.ts:11-21, src/init/scaffold-collection.ts:11-21
  DESCRIPTION: The exact same 10-line SKILL_MD_TEMPLATE string literal is independently defined in scaffold-skill.ts, scaffold-plugin.ts, and scaffold-collection.ts. These were clearly authored by separate executors who each needed the template. Any future change to the template content must be replicated in all three files or they will drift.
  RECOMMENDATION: Extract SKILL_MD_TEMPLATE to a shared module (e.g. src/init/templates.ts) and import it in all three scaffold files.

- FINDING: pathExists / fileExists helper duplicated across all three scaffold modules
  SEVERITY: high
  FILES: src/init/scaffold-skill.ts:23-30, src/init/scaffold-plugin.ts:23-30, src/init/scaffold-collection.ts:23-30
  DESCRIPTION: All three scaffold files independently define an identical async function that wraps fs.access in a try/catch to return a boolean. In scaffold-skill.ts it is named fileExists; in scaffold-plugin.ts and scaffold-collection.ts it is named pathExists. The implementations are byte-for-byte identical aside from the function name. This is a textbook extraction candidate.
  RECOMMENDATION: Extract to a shared utility (e.g. src/init/fs-utils.ts or add to an existing utils module) exporting a single pathExists function. Import it in all three scaffold files.

- FINDING: agntc.json write-or-skip-or-overwrite logic duplicated across all three scaffold modules
  SEVERITY: high
  FILES: src/init/scaffold-skill.ts:36-54, src/init/scaffold-plugin.ts:36-54, src/init/scaffold-collection.ts:36-57
  DESCRIPTION: Each scaffold function independently implements the same 15-20 line pattern for handling agntc.json: build JSON content with JSON.stringify({agents}, null, 2), check if file exists, branch on reconfigure to overwrite/skip, push to created/skipped/overwritten arrays. The logic is structurally identical across all three files with only the base directory path differing. This is the largest single block of duplicated logic in the implementation.
  RECOMMENDATION: Extract a shared helper such as writeConfigFile(dir, agents, reconfigure) that returns {action: "created"|"skipped"|"overwritten"} and handles the full check-write-classify flow. Each scaffold function calls it with its target directory.

- FINDING: ScaffoldResult / ScaffoldPluginResult / ScaffoldCollectionResult are identical interfaces
  SEVERITY: medium
  FILES: src/init/scaffold-skill.ts:6-9, src/init/scaffold-plugin.ts:6-9, src/init/scaffold-collection.ts:6-9
  DESCRIPTION: Three separate interfaces with identical shapes ({created: string[], skipped: string[], overwritten: string[]}) are defined independently in each scaffold module. format-report.ts already imports ScaffoldResult from scaffold-skill.ts, but the other two modules define their own copies. The init.ts orchestrator also defines this shape inline as a return type.
  RECOMMENDATION: Define ScaffoldResult once in a shared location (e.g. src/init/types.ts or alongside the extracted template/utils module) and import it in all scaffold files and format-report.ts.

- FINDING: SKILL_MD_TEMPLATE duplicated in test files
  SEVERITY: low
  FILES: tests/init/scaffold-skill.test.ts:7-17, tests/init/scaffold-plugin.test.ts:14-24, tests/init/scaffold-collection.test.ts:14-24
  DESCRIPTION: Each scaffold test file independently re-declares the SKILL_MD_TEMPLATE constant for assertions. Additionally, the scaffold-plugin and scaffold-collection test files each define their own exists() helper (identical to the source pathExists). While test duplication is lower priority than source duplication, these three copies will drift if the template changes and only some tests are updated.
  RECOMMENDATION: If the source template is extracted to a shared module per Finding 1, the test files can import it from there (or from a test fixtures module) instead of re-declaring it. The test exists() helpers can similarly be shared.

SUMMARY: The three scaffold modules (scaffold-skill.ts, scaffold-plugin.ts, scaffold-collection.ts) were independently authored and contain substantial duplicated logic: an identical template string, an identical filesystem helper, an identical result interface, and near-identical config-file write logic. Extracting these four items into shared modules would eliminate approximately 60-70 duplicated lines and create a single source of truth for each concern.
