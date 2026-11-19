TASK: CursorDriver Implementation (cursor-agent-driver-1-1)

ACCEPTANCE CRITERIA:
- [x] src/drivers/cursor-driver.ts exports a CursorDriver class implementing AgentDriver
- [x] detect() returns true when .cursor/ exists at project level
- [x] detect() returns true when which cursor succeeds (and project dir check failed)
- [x] detect() returns true when ~/.cursor/ exists (and both prior checks failed)
- [x] detect() returns false when all three tiers fail
- [x] detect() short-circuits: when project dir check succeeds, execFile is never called
- [x] detect() short-circuits: when which cursor succeeds, homeDirHasCursor is never called
- [x] getTargetDir("skills") returns ".cursor/skills"
- [x] getTargetDir("agents") returns null
- [x] getTargetDir("hooks") returns null
- [x] getTargetDir("unknown") returns null
- [x] All tests pass in tests/drivers/cursor-driver.test.ts

STATUS: Complete

SPEC CONTEXT: Cursor 2.4+ natively reads SKILL.md files in .cursor/skills/. The CursorDriver follows the ClaudeDriver pattern with three-tier detection (project .cursor/ dir, which cursor CLI, ~/.cursor/ home fallback) and a Partial<Record<AssetType, string>> TARGET_DIRS with only skills. Cursor has no agents or hooks system. agntc does not gate on Cursor version.

IMPLEMENTATION:
- Status: Implemented
- Location: src/drivers/cursor-driver.ts (57 lines)
- Notes: The implementation precisely mirrors the ClaudeDriver structure with Cursor-specific paths and CLI name. Three-tier detection uses early-return short-circuiting as specified. TARGET_DIRS is correctly typed as Partial<Record<AssetType, string>> matching the CodexDriver pattern (skills-only). getTargetDir uses nullish coalescing (?? null) to return null for unsupported asset types. Private methods follow the prescribed naming convention: projectHasCursor, whichCursorSucceeds, homeDirHasCursor.

TESTS:
- Status: Adequate
- Coverage: All 11 tests from the plan are present with matching names. Detection tests cover: project-level hit, CLI hit, home-dir hit, all-fail, no-throw on failures, and both short-circuit scenarios (project match skips execFile + fs.access count assertion; which success skips home dir check + fs.access count assertion). getTargetDir tests cover skills, agents, hooks, and unknown asset types.
- Notes: The "unknown" asset type test passes "unknown" directly without "as any" -- this is technically a TypeScript type error since AssetType is "skills" | "agents" | "hooks", but it is an established codebase convention (ClaudeDriver and CodexDriver tests do the same). The mocking approach correctly uses vi.mock for node:fs/promises and node:child_process at the module level, matching the existing claude-driver.test.ts pattern. Tests are focused and not over-tested -- each test verifies a distinct behavior or edge case without redundant assertions.

CODE QUALITY:
- Project conventions: Followed. File structure mirrors existing drivers (claude-driver.ts, codex-driver.ts). Import style, class structure, private method naming, TARGET_DIRS const placement, and error handling (try/catch returning boolean) all match established patterns.
- SOLID principles: Good. CursorDriver has single responsibility (detect + route for Cursor). Implements the AgentDriver interface cleanly. Open/closed is respected -- new driver added without modifying existing driver code.
- Complexity: Low. Three sequential checks with early return. No branching complexity. Cyclomatic complexity is minimal.
- Modern idioms: Yes. Uses async/await, nullish coalescing, Partial<Record> utility type, and the Promise constructor pattern for wrapping the callback-based execFile (matching ClaudeDriver).
- Readability: Good. Self-documenting method names (projectHasCursor, whichCursorSucceeds, homeDirHasCursor) make the three-tier detection clear. The detect() method reads as a clear cascade of checks.
- Issues: None identified.

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- The getTargetDir("unknown") test call is a minor TypeScript type mismatch (passing a string literal not in the AssetType union), but this is consistent with all other driver test files in the codebase and is a deliberate testing pattern for runtime safety verification.
