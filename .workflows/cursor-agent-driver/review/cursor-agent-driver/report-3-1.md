TASK: Deduplicate PluginInstallResult / CollectionPluginResult Interfaces

ACCEPTANCE CRITERIA:
- Only one definition of the plugin-install-result interface exists in the codebase
- Both add.ts and summary.ts import from the same source
- All existing tests pass without modification

STATUS: Complete

SPEC CONTEXT: This task is a code quality refactoring within the cursor-agent-driver feature work. The spec focuses on adding a Cursor agent driver and adjusting agent selection/collection pipelines. The `PluginInstallResult` interface is used in the collection pipeline (`add.ts`) and summary rendering (`summary.ts`). Having a single source of truth prevents drift as new agents (like cursor) are added.

IMPLEMENTATION:
- Status: Implemented
- Location:
  - Single definition: src/summary.ts:101-109
  - Import in consumer: src/commands/add.ts:25
  - Usage in consumer: src/commands/add.ts:425
- Notes: The interface is exported from `src/summary.ts` with the name `PluginInstallResult`. The old duplicate `CollectionPluginResult` no longer exists anywhere in the codebase (confirmed via grep). `add.ts` uses `import type { PluginInstallResult }` which is correct TypeScript practice for type-only imports. All seven fields match the task description: `pluginName`, `status`, `copiedFiles`, `agents`, `assetCountsByAgent?`, `detectedType?`, `errorMessage?`.

TESTS:
- Status: Adequate
- Coverage: The summary.test.ts file has comprehensive tests for `renderCollectionAddSummary` that exercise all status variants (installed, skipped, failed) and field combinations (with/without assetCountsByAgent, with/without detectedType, with/without errorMessage). The add.test.ts tests cover the collection pipeline. Since this is a pure refactoring (moving an interface, not changing behavior), existing tests passing is the correct verification -- no new tests needed.
- Notes: Tests do not reference the interface by name (they use structural typing with inline object literals), which is appropriate and makes them resilient to this kind of refactoring.

CODE QUALITY:
- Project conventions: Followed -- uses `import type` for type-only imports, consistent with the rest of the codebase
- SOLID principles: Good -- the DRY violation is resolved; single source of truth for the interface
- Complexity: Low -- minimal change, straightforward deduplication
- Modern idioms: Yes -- `import type` syntax is modern TypeScript best practice
- Readability: Good -- the interface lives in `summary.ts` alongside its primary consumer (`renderCollectionAddSummary`), which is a reasonable home
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- The interface could arguably live in a shared types file (e.g., `src/types.ts`) rather than `summary.ts`, since it is produced in `add.ts` and consumed in `summary.ts`. However, placing it in `summary.ts` avoids creating a new file and keeps the interface near the rendering logic that consumes it. This is a reasonable choice.
