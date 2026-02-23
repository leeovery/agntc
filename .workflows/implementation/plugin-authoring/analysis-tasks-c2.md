---
topic: plugin-authoring
cycle: 2
total_proposed: 3
---
# Analysis Tasks: Plugin Authoring (Cycle 2)

## Task 1: Extract agntc.json write-or-skip-or-overwrite helper into scaffold-utils
status: pending
severity: medium
sources: duplication, architecture

**Problem**: scaffold-skill.ts (lines 18-31) and scaffold-plugin.ts (lines 17-30) contain a near-identical 14-line block that builds agntc.json content, checks existence via pathExists, branches on reconfigure to decide overwrite/skip/create, and pushes to the appropriate result array. If the agntc.json schema changes, both must be updated in lockstep. This was identified in cycle 1 but the fixes addressed other duplication without extracting this specific block.

**Solution**: Extract a helper function `writeConfigFile` into `src/init/scaffold-utils.ts` that encapsulates the full check-write-classify flow for agntc.json. Both scaffoldSkill and scaffoldPlugin call it and push to result arrays based on the returned status.

**Outcome**: The agntc.json write logic exists in exactly one place. Both scaffold functions delegate to it, reducing each by ~14 lines and making the config schema a single-point-of-change.

**Do**:
1. In `src/init/scaffold-utils.ts`, add an exported async function `writeConfigFile(targetDir: string, agents: AgentId[], reconfigure?: boolean): Promise<{ path: string; status: "created" | "skipped" | "overwritten" }>`.
2. Move the agntc.json build + pathExists check + reconfigure branching + writeFile logic into this function.
3. The function returns `{ path: "agntc.json", status }` where status reflects what happened.
4. In `src/init/scaffold-skill.ts`, replace lines 18-31 with a call to `writeConfigFile(options.targetDir, options.agents, options.reconfigure)` and push to the appropriate result array based on the returned status.
5. In `src/init/scaffold-plugin.ts`, replace lines 17-30 with a call to `writeConfigFile(targetDir, agents, reconfigure)` and push to the appropriate result array based on the returned status.
6. Ensure `writeFile` and `join` imports are added to scaffold-utils.ts and removed from scaffold-skill.ts / scaffold-plugin.ts if no longer needed.
7. Run `pnpm test` to confirm all existing tests pass.

**Acceptance Criteria**:
- `writeConfigFile` is exported from `src/init/scaffold-utils.ts`
- `scaffold-skill.ts` and `scaffold-plugin.ts` both call `writeConfigFile` instead of inline logic
- No inline agntc.json write-or-skip-or-overwrite logic remains in either scaffold function
- All existing tests pass without modification

**Tests**:
- Existing scaffold-skill and scaffold-plugin tests continue to pass (fresh create, skip-if-exists, reconfigure overwrite)
- Unit test for writeConfigFile: returns `{ path: "agntc.json", status: "created" }` when file does not exist
- Unit test for writeConfigFile: returns `{ path: "agntc.json", status: "skipped" }` when file exists and reconfigure is false/undefined
- Unit test for writeConfigFile: returns `{ path: "agntc.json", status: "overwritten" }` when file exists and reconfigure is true

## Task 2: Use pathExists from scaffold-utils in pre-check.ts
status: pending
severity: low
sources: duplication, architecture

**Problem**: `src/init/pre-check.ts` (lines 13-17) uses a raw `access(configPath)` wrapped in try/catch to test file existence -- the exact same pattern exported as `pathExists` from `src/init/scaffold-utils.ts`. The shared utility was introduced specifically for this purpose but pre-check was not updated to use it. Having two filesystem-existence patterns in the same feature module undermines the purpose of the shared utility.

**Solution**: Import `pathExists` from `./scaffold-utils.js` in pre-check.ts and replace the inline try/catch with a one-line call.

**Outcome**: All file-existence checks in the init feature use the shared `pathExists` utility. The inline try/catch pattern is eliminated from pre-check.ts.

**Do**:
1. In `src/init/pre-check.ts`, add `import { pathExists } from "./scaffold-utils.js";` to the imports.
2. Remove the `import { access } from "node:fs/promises";` import (no longer needed).
3. Replace lines 13-17 (the try/catch block around `access(configPath)`) with: `if (!(await pathExists(configPath))) { return { status: "fresh" }; }`
4. Run `pnpm test` to confirm all existing tests pass.

**Acceptance Criteria**:
- pre-check.ts imports `pathExists` from `./scaffold-utils.js`
- pre-check.ts no longer imports `access` from `node:fs/promises`
- No inline try/catch around `access()` remains in pre-check.ts
- All existing tests pass without modification

**Tests**:
- Existing pre-check tests continue to pass (fresh directory returns "fresh", existing config triggers reconfigure prompt)

## Task 3: Remove allowExcessArguments from init command
status: pending
severity: medium
sources: standards

**Problem**: The init command definition in `src/commands/init.ts` (line 70) uses `.allowExcessArguments(true)`, which silently accepts extra positional arguments (e.g., `npx agntc init foo bar` succeeds without error). The specification states "No arguments. No flags." and Commander's default behavior (`allowExcessArguments(false)`) already enforces this. No other command in the project uses `allowExcessArguments(true)`. This contradicts the spec's acceptance criteria.

**Solution**: Remove `.allowExcessArguments(true)` from the init command definition. Commander's default behavior will reject excess arguments, matching the spec.

**Outcome**: `npx agntc init foo` produces a Commander error about excess arguments, conforming to the spec requirement of no arguments and no flags.

**Do**:
1. In `src/commands/init.ts`, remove `.allowExcessArguments(true)` from the command chain on line 70.
2. Run `pnpm test` to confirm all existing tests pass.

**Acceptance Criteria**:
- The init command definition does not include `.allowExcessArguments(true)`
- Commander rejects excess positional arguments with its default error behavior
- All existing tests pass without modification

**Tests**:
- Existing init command tests continue to pass
- Manual verification: running the built CLI with `npx agntc init extra-arg` produces a Commander error
