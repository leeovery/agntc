---
topic: plugin-authoring
cycle: 1
total_proposed: 4
---
# Analysis Tasks: Plugin Authoring (Cycle 1)

## Task 1: Extract shared scaffold utilities (template, pathExists, ScaffoldResult)
status: approved
severity: high
sources: duplication, standards, architecture

**Problem**: Three independently-authored scaffold modules each define their own copy of: (1) SKILL_MD_TEMPLATE -- an identical 10-line string literal in scaffold-skill.ts, scaffold-plugin.ts, and scaffold-collection.ts; (2) pathExists/fileExists -- an identical async fs.access wrapper (named fileExists in scaffold-skill.ts, pathExists in the other two); (3) ScaffoldResult/ScaffoldPluginResult/ScaffoldCollectionResult -- three structurally identical interfaces. format-report.ts imports ScaffoldResult from scaffold-skill.ts specifically, creating an arbitrary coupling. The orchestrator (init.ts:53) also defines the same shape inline as a return type.

**Solution**: Create two shared modules: `src/init/templates.ts` exporting SKILL_MD_TEMPLATE, and `src/init/scaffold-utils.ts` exporting pathExists and the ScaffoldResult interface. All three scaffold files and format-report.ts import from these shared locations. Remove the per-file duplicate declarations.

**Outcome**: SKILL_MD_TEMPLATE, pathExists, and ScaffoldResult each have a single definition. The three scaffold modules and format-report.ts import from the shared locations. Approximately 50 lines of duplicated declarations eliminated. Future changes to the template or result shape need only be made in one place.

**Do**:
1. Create `src/init/templates.ts` exporting `SKILL_MD_TEMPLATE`
2. Create `src/init/scaffold-utils.ts` exporting `pathExists` (the async fs.access wrapper) and `ScaffoldResult` interface (`{ created: string[]; skipped: string[]; overwritten: string[] }`)
3. In `src/init/scaffold-skill.ts`: remove local SKILL_MD_TEMPLATE, fileExists, and ScaffoldResult. Import SKILL_MD_TEMPLATE from `./templates.js`, pathExists and ScaffoldResult from `./scaffold-utils.js`. Change the function to use `pathExists` instead of `fileExists`. Update the export to re-export ScaffoldResult if needed for backward compatibility, or update all consumers.
4. In `src/init/scaffold-plugin.ts`: remove local SKILL_MD_TEMPLATE, pathExists, and ScaffoldPluginResult. Import from the shared modules. Change return type to `ScaffoldResult`.
5. In `src/init/scaffold-collection.ts`: remove local SKILL_MD_TEMPLATE, pathExists, and ScaffoldCollectionResult. Import from the shared modules. Change return type to `ScaffoldResult`.
6. In `src/init/format-report.ts`: change import to `import type { ScaffoldResult } from "./scaffold-utils.js"`
7. In `src/commands/init.ts`: replace the inline return type on the `scaffold` function (line 53) with `Promise<ScaffoldResult>`, importing from `./scaffold-utils.js`
8. Verify all tests pass -- update any test imports if they reference the old per-file types

**Acceptance Criteria**:
- SKILL_MD_TEMPLATE is defined in exactly one file (`src/init/templates.ts`)
- pathExists is defined in exactly one file (`src/init/scaffold-utils.ts`)
- ScaffoldResult is defined in exactly one file (`src/init/scaffold-utils.ts`)
- All three scaffold functions return the same `ScaffoldResult` type
- format-report.ts imports ScaffoldResult from the shared location
- No behavioral changes -- all existing tests pass

**Tests**:
- Existing scaffold-skill, scaffold-plugin, and scaffold-collection tests pass without behavioral changes
- Existing format-report tests pass with updated imports
- TypeScript compilation succeeds with no errors

---

## Task 2: Compose scaffoldCollection with scaffoldPlugin
status: approved
severity: medium
sources: architecture, duplication

**Problem**: scaffoldCollection (scaffold-collection.ts:32-85) independently reimplements the same file-creation logic as scaffoldPlugin -- agntc.json write-or-skip-or-overwrite, skills/my-skill/SKILL.md creation, agents/ mkdir, hooks/ mkdir -- with all paths prefixed by `my-plugin/`. The two functions share approximately 80% of their logic. The plan explicitly states "Collection is just Plugin nested inside a named directory with no root agntc.json." This violates the compositional relationship: when one concept is a wrapper of another, it should delegate rather than reimplement.

**Solution**: Have scaffoldCollection delegate to scaffoldPlugin by calling `scaffoldPlugin(join(dir, 'my-plugin'), agents, options)` and then prefix all returned paths with `my-plugin/`. The collection function also needs to create the `my-plugin/` directory before delegating. This eliminates ~50 lines of duplicated scaffold logic.

**Outcome**: scaffoldCollection is a thin wrapper (~10 lines) that creates the `my-plugin/` directory, delegates to scaffoldPlugin, and prefixes the returned paths. Changes to the scaffolded plugin structure (e.g., adding new starter files) only need to be made in scaffoldPlugin.

**Do**:
1. In `src/init/scaffold-collection.ts`, replace the current implementation with:
   - Create `my-plugin/` directory with `mkdir(join(dir, 'my-plugin'), { recursive: true })`
   - Call `scaffoldPlugin(join(dir, 'my-plugin'), agents, options)`
   - Map the returned `created`, `skipped`, and `overwritten` arrays to prefix each entry with `my-plugin/`
   - Return the prefixed result
2. Remove the now-unused local imports (access, writeFile if no longer needed) -- keep mkdir and join
3. Import `scaffoldPlugin` from `./scaffold-plugin.js`
4. Remove imports of SKILL_MD_TEMPLATE and pathExists from scaffold-collection.ts (they are no longer needed directly)
5. Verify all scaffold-collection tests pass -- the external behavior (returned paths, created files) should be identical
6. Verify the init command's scaffold dispatch still works correctly for collection type

**Acceptance Criteria**:
- scaffoldCollection delegates to scaffoldPlugin instead of reimplementing the logic
- All returned paths are correctly prefixed with `my-plugin/`
- scaffoldCollection handles `reconfigure` correctly by passing options through
- All existing scaffold-collection tests pass with identical assertions
- All init command tests pass

**Tests**:
- Existing scaffold-collection tests verify the same files are created on disk
- Existing scaffold-collection tests verify the same paths appear in created/skipped/overwritten arrays
- Test that reconfigure mode still overwrites `my-plugin/agntc.json` correctly
- Test that skip-if-exists behavior is preserved for all files

---

## Task 3: Unify scaffold function signatures
status: approved
severity: medium
sources: architecture

**Problem**: scaffoldSkill takes a single options object `{ agents, targetDir, reconfigure? }`, while scaffoldPlugin and scaffoldCollection take positional parameters `(dir, agents, options?)`. These three functions serve the same architectural role and are called from the same dispatch site in init.ts (lines 54-70). The inconsistency forces the orchestrator to use two different calling conventions and prevents the scaffold dispatch from being simplified to a uniform call pattern.

**Solution**: Unify all three scaffold functions to use the options-object pattern from scaffoldSkill: `{ agents, targetDir, reconfigure? }`. The options-object pattern is preferable because it makes call sites self-documenting with named fields.

**Outcome**: All three scaffold functions accept the same signature shape. The init.ts orchestrator can call all three with an identical argument structure, simplifying the dispatch logic.

**Do**:
1. In `src/init/scaffold-plugin.ts`, change the function signature from `scaffoldPlugin(dir, agents, options?)` to `scaffoldPlugin(options: { agents: AgentId[]; targetDir: string; reconfigure?: boolean })`. Update the function body to destructure from the options object.
2. In `src/init/scaffold-collection.ts`, change the function signature from `scaffoldCollection(dir, agents, options?)` to `scaffoldCollection(options: { agents: AgentId[]; targetDir: string; reconfigure?: boolean })`. Update the function body to destructure from the options object. (If Task 2 has been applied, this means updating the delegation call accordingly.)
3. In `src/commands/init.ts`, update the scaffold dispatch to use the unified signature for all three functions. The two calling conventions (lines 56-70) can collapse into a single pattern.
4. Update all test files that call scaffoldPlugin or scaffoldCollection directly to use the new signature
5. Verify all tests pass

**Acceptance Criteria**:
- All three scaffold functions accept `{ agents, targetDir, reconfigure? }`
- The init.ts orchestrator uses one calling convention for all three
- All existing tests pass with updated call signatures

**Tests**:
- Existing scaffold-plugin tests pass with updated call syntax
- Existing scaffold-collection tests pass with updated call syntax
- Existing init command tests pass

---

## Task 4: Tighten Partial<Record> to Record in preview-confirm
status: approved
severity: low
sources: standards

**Problem**: In `src/init/preview-confirm.ts:4`, `filesByType` is typed as `Partial<Record<InitType, string[]>>` even though all three InitType variants (skill, plugin, collection) are present in the literal. This introduces an unnecessary `undefined` possibility, forcing the runtime guard on line 30 (`if (!files)`) and an error path (`Init type "${options.type}" is not yet supported`) that can never be reached in practice. Using `Partial` is unnecessarily abstract when the record is complete.

**Solution**: Change the type to `Record<InitType, string[]>` and remove the unreachable guard/error.

**Outcome**: The type accurately reflects the data (all variants present). The compiler will enforce completeness if a new InitType variant is added in the future. The unreachable error path is eliminated.

**Do**:
1. In `src/init/preview-confirm.ts:4`, change `Partial<Record<InitType, string[]>>` to `Record<InitType, string[]>`
2. Remove the `if (!files)` guard and the associated `throw new Error(...)` on lines 30-31, since `files` is now guaranteed to be defined
3. Verify TypeScript compilation succeeds
4. Verify all existing tests pass

**Acceptance Criteria**:
- `filesByType` is typed as `Record<InitType, string[]>`
- No unreachable error path for unsupported init types
- TypeScript compilation succeeds
- All existing tests pass

**Tests**:
- Existing preview-confirm tests pass without modification
- TypeScript compilation verifies completeness (adding a new InitType variant without updating filesByType would cause a compile error)
