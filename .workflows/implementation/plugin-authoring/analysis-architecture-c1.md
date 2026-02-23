AGENT: architecture
FINDINGS:
- FINDING: Scaffold functions have inconsistent API signatures
  SEVERITY: medium
  FILES: src/init/scaffold-skill.ts:32, src/init/scaffold-plugin.ts:32, src/init/scaffold-collection.ts:32
  DESCRIPTION: scaffoldSkill takes a single options object `{ agents, targetDir, reconfigure? }`, while scaffoldPlugin and scaffoldCollection take positional parameters `(dir, agents, options?)`. These three functions serve the same architectural role (scaffold a type to disk) and are called from the same dispatch site in the orchestrator (src/commands/init.ts:48-71). The inconsistency forces the orchestrator to use two different calling conventions for equivalent operations and prevents the scaffold dispatch from being simplified to a single call pattern.
  RECOMMENDATION: Unify all three scaffold functions to the same signature. Either all take a single options object or all take the same positional parameters. The options-object pattern from scaffoldSkill is preferable since it already carries named fields, making the call site self-documenting.

- FINDING: Three identical result types and one inline duplicate for the same shape
  SEVERITY: medium
  FILES: src/init/scaffold-skill.ts:5-9, src/init/scaffold-plugin.ts:5-9, src/init/scaffold-collection.ts:5-9, src/commands/init.ts:53, src/init/format-report.ts:1
  DESCRIPTION: ScaffoldResult, ScaffoldPluginResult, and ScaffoldCollectionResult are structurally identical interfaces (`{ created: string[], skipped: string[], overwritten: string[] }`). The orchestrator's scaffold() function defines the same shape inline as its return type. formatInitReport imports only ScaffoldResult from scaffold-skill.ts but is called with results from all three scaffolders -- this works only via structural compatibility. If the types were to diverge, the type system would not catch mismatches between ScaffoldPluginResult/ScaffoldCollectionResult and what formatInitReport expects, because there is no shared nominal type binding them together. This also violates DRY (four definitions of the same contract).
  RECOMMENDATION: Extract a single `ScaffoldResult` interface to a shared location (e.g., a types file in `src/init/` or re-export from a single module). All three scaffolders and the orchestrator should reference the same type. formatInitReport should import from that shared location rather than coupling to scaffold-skill.

- FINDING: scaffoldCollection duplicates scaffoldPlugin instead of composing with it
  SEVERITY: medium
  FILES: src/init/scaffold-collection.ts:32-85, src/init/scaffold-plugin.ts:32-82
  DESCRIPTION: The plan explicitly states "Collection is just Plugin nested inside a named directory with no root agntc.json." Despite this, scaffoldCollection independently reimplements the same file-creation logic as scaffoldPlugin (agntc.json write, skills/my-skill/SKILL.md write, agents/ mkdir, hooks/ mkdir) with all paths prefixed by `my-plugin/`. The two functions share approximately 80% of their logic. This violates the code-quality principle "Compose, Don't Duplicate" -- when one concept is a wrapper of another, it should be derived from the existing abstraction rather than implemented independently. Changes to the scaffolded structure (e.g., adding a new starter file) would need to be made in both places.
  RECOMMENDATION: Have scaffoldCollection delegate to scaffoldPlugin by calling `scaffoldPlugin(join(dir, 'my-plugin'), agents, options)` and then prefix the returned paths with `my-plugin/`. This makes the compositional relationship explicit and eliminates the duplicated logic.

- FINDING: SKILL_MD_TEMPLATE and pathExists/fileExists duplicated across three files
  SEVERITY: low
  FILES: src/init/scaffold-skill.ts:11-21, src/init/scaffold-plugin.ts:11-21, src/init/scaffold-collection.ts:11-21, src/init/scaffold-skill.ts:23-29, src/init/scaffold-plugin.ts:23-29, src/init/scaffold-collection.ts:23-29
  DESCRIPTION: The SKILL_MD_TEMPLATE string literal and the pathExists/fileExists async helper are copy-pasted identically in all three scaffold modules. This is a direct consequence of the scaffolders being implemented independently rather than composed. These constants and utilities are shared implementation details that belong in a single location.
  RECOMMENDATION: Extract SKILL_MD_TEMPLATE to a shared module (or it becomes unnecessary if scaffoldCollection delegates to scaffoldPlugin). Extract pathExists to a shared utility. If the composition recommendation above is adopted, most of this duplication resolves automatically.

SUMMARY: The scaffold layer has inconsistent API surfaces, duplicated result types, and missed composition between scaffoldCollection and scaffoldPlugin. The prompt modules and orchestrator are cleanly structured with good seam quality and thorough test coverage. The primary architectural improvement is unifying the scaffold functions behind a shared interface and having collection compose with plugin rather than reimplementing it.
