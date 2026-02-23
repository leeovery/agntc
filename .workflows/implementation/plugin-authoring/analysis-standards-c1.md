AGENT: standards
FINDINGS:
- FINDING: SKILL_MD_TEMPLATE duplicated across three scaffold files
  SEVERITY: medium
  FILES: /Users/leeovery/Code/agntc/src/init/scaffold-skill.ts:11, /Users/leeovery/Code/agntc/src/init/scaffold-plugin.ts:11, /Users/leeovery/Code/agntc/src/init/scaffold-collection.ts:11
  DESCRIPTION: The identical `SKILL_MD_TEMPLATE` string and `pathExists`/`fileExists` helper function are copied verbatim in all three scaffold files. The code-quality reference states "Extract repeated logic after three instances (Rule of Three)" -- this is exactly three instances. The template is a spec-defined constant (the SKILL.md frontmatter template from the specification). If the spec template changes, all three files must be updated in lockstep, creating a maintenance risk where they could drift from each other and from the spec.
  RECOMMENDATION: Extract `SKILL_MD_TEMPLATE` into a shared module (e.g., `src/init/templates.ts`). Similarly, the `pathExists`/`fileExists` helper appears in all three files and could be shared.

- FINDING: formatInitReport parameter type couples to scaffold-skill instead of shared interface
  SEVERITY: low
  FILES: /Users/leeovery/Code/agntc/src/init/format-report.ts:1, /Users/leeovery/Code/agntc/src/init/scaffold-skill.ts:5, /Users/leeovery/Code/agntc/src/init/scaffold-plugin.ts:5, /Users/leeovery/Code/agntc/src/init/scaffold-collection.ts:5
  DESCRIPTION: `formatInitReport` imports `ScaffoldResult` from `scaffold-skill.ts`, but is called with results from `scaffoldPlugin` (type `ScaffoldPluginResult`) and `scaffoldCollection` (type `ScaffoldCollectionResult`). All three result types are structurally identical (`{ created: string[]; skipped: string[]; overwritten: string[] }`) so TypeScript's structural typing makes this compile. However, there are three separately-defined identical interfaces when the spec treats scaffold output as a single concept. The typescript-pro skill says "MUST DO: Use type-first API design." A shared `ScaffoldResult` type would be the type-first approach.
  RECOMMENDATION: Define a single `ScaffoldResult` interface in a shared location (e.g., `src/init/types.ts`) and have all three scaffold functions return it. Remove the per-file duplicate interfaces.

- FINDING: preview-confirm uses Partial<Record> where a complete Record is warranted
  SEVERITY: low
  FILES: /Users/leeovery/Code/agntc/src/init/preview-confirm.ts:4
  DESCRIPTION: `filesByType` is typed as `Partial<Record<InitType, string[]>>` even though all three `InitType` variants are present in the literal. The typescript-pro skill says "MUST NOT DO: Use explicit `any` without justification" and the code-quality reference says "Concrete Over Abstract: Prefer concrete types." Using `Partial` here is unnecessarily abstract -- it introduces a `undefined` possibility that doesn't exist, forcing the runtime guard on line 30. Using `Record<InitType, string[]>` would be the concrete, type-safe choice, letting the compiler enforce completeness if a new `InitType` variant is added.
  RECOMMENDATION: Change type to `Record<InitType, string[]>` and remove the `if (!files)` guard (or keep it as a defensive assertion if preferred).

SUMMARY: Implementation faithfully follows the specification across all major requirements: command signature, prompt flow, file scaffolding, skip-if-exists logic, reconfigure semantics, preview format, success messages, and agntc.json/SKILL.md content. The findings are all low-to-medium severity relating to code organization (duplicated template/helper, loosely typed interfaces) rather than spec conformance drift.
