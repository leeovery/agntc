TASK: Add semver dependency

ACCEPTANCE CRITERIA:
- semver appears in package.json dependencies
- @types/semver appears in package.json devDependencies
- import * as semver from "semver" compiles without error in a .ts file
- All existing tests pass (pnpm test)

STATUS: Complete

SPEC CONTEXT: The specification (section "Version Resolution > Dependency") states: "Add semver as a production dependency (alongside commander and @clack/prompts). Use @types/semver for TypeScript support. The package is ~50KB with zero dependencies." The project uses semver.clean(), semver.valid(), semver.validRange(), and semver.maxSatisfying() across multiple source files for constraint resolution.

IMPLEMENTATION:
- Status: Implemented
- Location: package.json:38 (semver "^7.7.4" in dependencies), package.json:44 (@types/semver "^7.7.1" in devDependencies)
- Notes: Both packages are installed in node_modules at the declared versions (semver@7.7.4, @types/semver@7.7.1). The semver package is correctly placed in production dependencies, not devDependencies, matching the spec requirement. Multiple source files already consume semver successfully: src/version-resolve.ts imports clean, gte, maxSatisfying; src/source-parser.ts imports validRange. The namespace import `import * as semver from "semver"` is used in the test file and compiles correctly under the project's TypeScript config (NodeNext module resolution, strict mode, esModuleInterop enabled).

TESTS:
- Status: Adequate
- Coverage: Two smoke tests in tests/semver-smoke.test.ts exactly match the plan's required test descriptions:
  1. "semver is importable and clean() returns expected value" -- imports semver via namespace import and asserts semver.clean("v1.2.3") === "1.2.3"
  2. "semver maxSatisfying works with caret constraint" -- asserts semver.maxSatisfying(["1.0.0", "1.1.0", "2.0.0"], "^1.0.0") === "1.1.0"
- Notes: Tests are appropriately scoped for a dependency-addition task. They verify that the package is importable and that the two core functions needed by the project (clean and maxSatisfying) produce correct results. No over-testing -- no redundant assertions or unnecessary mocking. The tests would fail if the dependency were removed or if the types were incompatible.

CODE QUALITY:
- Project conventions: Followed -- uses vitest, proper imports, biome-compatible formatting (tabs)
- SOLID principles: N/A (dependency addition, no architecture to evaluate)
- Complexity: Low -- straightforward smoke tests
- Modern idioms: Yes -- ESM imports, vitest describe/it/expect
- Readability: Good -- test names are descriptive and match acceptance criteria exactly
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- None
