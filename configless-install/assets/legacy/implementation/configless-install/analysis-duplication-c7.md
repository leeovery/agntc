AGENT: duplication
CYCLE: 7
STATUS: findings
FINDINGS_COUNT: 4

FINDINGS:

- FINDING: `checkEscapingSymlinks` scan-and-narrow mock duplicated verbatim across six test files
  SEVERITY: medium
  FILES: tests/commands/add.test.ts:137-174, tests/commands/update.test.ts:89-111, tests/commands/list-update-action.test.ts:70-92, tests/commands/list-change-version-action.test.ts:55-77, tests/clone-reinstall.test.ts, tests/nuke-reinstall-pipeline.test.ts
  DESCRIPTION: The `vi.mock("../../src/copy-safety.js", ...)` factory that re-implements the real `checkEscapingSymlinks` wrapper over a mocked `scanForEscapingSymlinks` (the try/scan → SymlinkEscapeError-narrow → rethrow block, including its explanatory comment "Mirror the real wrapper's scan-and-narrow...") is reproduced near-byte-identically in six test files. This is a ~20-line block that re-encodes the production narrowing logic in test scaffolding; the only variation is whether the file spreads `...actual` or pulls `SymlinkEscapeError` from a locally-declared class (add.test.ts). Because each copy hand-mirrors `copy-safety.ts`'s real behaviour, a change to the wrapper's contract (e.g. a new non-throw outcome) must be propagated to six places or the mocks silently drift from production.
  RECOMMENDATION: Extract a shared test helper (e.g. `tests/helpers/copy-safety-mock.ts`) exporting a factory that builds the mocked module — a `mockCopySafety()` returning `{ scanForEscapingSymlinks, checkEscapingSymlinks }` wired to one shared scan-and-narrow implementation — and have each `vi.mock` call delegate to it. Mirrors the existing `tests/helpers/factories.ts` / `git-mocks.ts` convention.

- FINDING: `@clack/prompts` mock object duplicated across command test files
  SEVERITY: low
  FILES: tests/commands/add.test.ts:18-33, tests/commands/update.test.ts:13-29, tests/commands/list-update-action.test.ts:6-22, tests/commands/list-change-version-action.test.ts:6-24
  DESCRIPTION: The same `vi.mock("@clack/prompts", ...)` literal — `intro/outro/spinner({start,stop,message})/log{info,warn,error,success(,message)}/cancel` — is repeated across the command test files in the implementation set (and others outside it). Each is ~15 lines; the spinner shape and log-method set are identical. Minor field drift already exists (some include `log.message`, change-version adds `select`/`isCancel`), which is exactly the kind of copy-paste divergence that makes a shared default valuable.
  RECOMMENDATION: Add a `tests/helpers/clack-mock.ts` exporting the canonical clack mock object (or a factory accepting extra members like `select`/`isCancel`), and reference it from each `vi.mock` factory so the spinner/log shape lives in one place.

- FINDING: "Path {key} does not exist or is not a directory" failure message hand-written at three reinstall call sites
  SEVERITY: low
  FILES: src/commands/update.ts:207, src/commands/list-update-action.ts:45, src/commands/list-change-version-action.ts:96
  DESCRIPTION: All three callers of `prepareReinstall` produce the identical user-facing string for a failed `prepared.ok === false` local-path check (update.ts appends a trailing period; the two list actions are byte-identical). The string is independently literal-authored at each site rather than derived from the structured `prepared.reason` that `prepareReinstall` already returns (update.ts even discards `prepared.reason` entirely in favour of the hardcoded sentence). This is parallel wording that must be kept in sync by hand and already diverges in punctuation.
  RECOMMENDATION: Have `prepareReinstall`'s failure carry (or a small shared helper format) the user-facing path-failure message once, and have the three call sites surface that single string. The `reason` field is already on the result; route it through a shared `pathFailureMessage(key, reason)` (in clone-reinstall.ts beside `failureMessage`) rather than re-literalizing.

- FINDING: agent-id → `{ id, driver: getDriver(id) }` mapping repeated across copy entry points
  SEVERITY: low
  FILES: src/commands/add.ts:339-342, src/commands/add.ts:611-614, src/nuke-reinstall-pipeline.ts:139-142
  DESCRIPTION: The `agents.map((id) => ({ id, driver: getDriver(id) }))` lift from `AgentId[]` to `AgentWithDriver[]` is written three times (standalone install, per-member collection install, and the pipeline replay path). Each is a 3–4 line `.map` with the same shape. It is the single canonical way the codebase pairs an agent id with its driver, so divergence is unlikely to be caught by types but the construction is genuinely repeated logic.
  RECOMMENDATION: Extract a tiny shared helper such as `toAgentDrivers(ids: AgentId[]): AgentWithDriver[]` (in drivers/registry.ts beside `getDriver`) and call it from the three sites. Low priority given each instance is small, but it removes a copy-paste seam that spans task boundaries (add command vs. pipeline).

SUMMARY: The production code is already heavily consolidated (shared `prepareReinstall`/`mapCloneFailure`/`failureMessage`/`buildAddEntry`/`findPresentAssetDirs` etc.), so the highest-impact remaining duplication is in test scaffolding — chiefly a ~20-line `copy-safety` mock block hand-mirroring production behaviour across six test files. A few small production seams (path-failure message, agent-driver mapping) remain as lower-priority extraction candidates. (Note: the agent-driver mapping and a similar path-failure-message observation were noted-but-below-threshold in prior cycles; raised here for synthesizer dedup against c5/c6.)
