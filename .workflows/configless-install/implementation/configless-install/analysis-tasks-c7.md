---
topic: configless-install
cycle: 7
total_proposed: 2
---
# Analysis Tasks: configless-install (Cycle 7)

standards: clean (3rd consecutive cycle). architecture: 1 LOW finding, discarded (see below). duplication: 4 findings.

The two highest-value remaining items are both in **test scaffolding**: a ~20-line `copy-safety` mock block that hand-mirrors the production `checkEscapingSymlinks` narrowing (introduced as c4 Task 2) across six test files, and the `@clack/prompts` mock object copied across four+ command test files (already showing field drift). Production code is heavily consolidated after six cycles and a review phase; the remaining production seams flagged this cycle are all known recurrences of below-threshold notes and are not re-proposed.

## Discarded / known recurrences (not proposed)

- **Path-failure message hand-written at 3 reinstall sites** (low, duplication) — KNOWN RECURRENCE. The c7 duplication agent explicitly flags this as a recurrence of a prior below-threshold path-failure-message observation. `prepareReinstall` already returns a structured `reason`; the three callers (update.ts:207, list-update-action.ts:45, list-change-version-action.ts:96) independently literalise "Path {key} does not exist or is not a directory" (update.ts adds a trailing period). Below-threshold previously, nothing changed, behaviour-neutral cosmetic. Discarded.
- **agent-id → `{ id, driver: getDriver(id) }` mapping repeated 3×** (low, duplication) — KNOWN RECURRENCE, explicitly noted-but-NOT-raised below threshold in both c5 and c6 (add.ts:339, add.ts:611, nuke-reinstall-pipeline.ts:139). Each is a ~3-line `.map`; the construction is the single canonical way the codebase pairs an id with its driver. Nothing changed since the deliberate prior decision. Discarded.
- **Zero-agents / empty-selection decision replicated across 3 sites** (low, architecture) — Self-flagged by the architecture agent as requiring "no restructuring for correctness"; the interactive (`selectAgents`) and silent-narrowing (`resolveAgents` + `computeAgentChanges`) flows are genuinely different operations that correctly never share a call site, and each site is small and currently consistent. Architecture was clean c5 and c6. Below threshold, defer-if-touched. Discarded.

## Task 1: Extract shared copy-safety mock helper to stop six test files re-encoding production narrowing logic
status: approved
severity: medium
sources: duplication

**Problem**: The `vi.mock("../../src/copy-safety.js", ...)` factory that re-implements the real `checkEscapingSymlinks` wrapper over a mocked `scanForEscapingSymlinks` is reproduced near-byte-identically across six test files: tests/commands/add.test.ts (137-174), tests/commands/update.test.ts (89-111), tests/commands/list-update-action.test.ts (70-92), tests/commands/list-change-version-action.test.ts (55-77), tests/clone-reinstall.test.ts, and tests/nuke-reinstall-pipeline.test.ts. Each copy hand-mirrors the production scan-and-narrow contract introduced in cycle-4 Task 2 — the `try { await scanForEscapingSymlinks(...); return { ok: true } } catch (err) { if (err instanceof SymlinkEscapeError) return { ok: false, message: err.message }; throw err }` block, plus the explanatory "Mirror the real wrapper's scan-and-narrow..." comment. The only variation is whether the file spreads `...actual` and reads `actual.SymlinkEscapeError` (update/list/pipeline) or fully replaces the module with locally-declared `PathTraversalError`/`SymlinkEscapeError` classes (add.test.ts:137-174). Because each copy re-encodes production behaviour in test scaffolding, any change to the wrapper's contract (e.g. a new non-throw outcome) must be propagated to six places or the mocks silently drift from production.

**Solution**: Add one shared test helper (e.g. tests/helpers/copy-safety-mock.ts) exporting a factory that builds the mocked module — a single scan-and-narrow implementation wired to a shared `vi.fn()` scan — and have each `vi.mock("../../src/copy-safety.js", ...)` factory delegate to it. Mirrors the existing tests/helpers/factories.ts and tests/helpers/git-mocks.ts convention. Test scaffolding only — no production change.

**Outcome**: The scan-and-narrow re-encoding lives in exactly one test helper. The six test files reference it from their `vi.mock` factory rather than re-authoring the try/scan/narrow/rethrow block. A change to the `checkEscapingSymlinks` contract requires editing one helper. All existing tests pass unchanged with the same scan-driver behaviour (`mockScanForEscapingSymlinks.mockResolvedValue`/`.mockRejectedValue`) continuing to control the install/replay sites.

**Do**:
1. Add tests/helpers/copy-safety-mock.ts exporting a factory (e.g. `mockCopySafety()`) that returns the mocked `copy-safety` module shape: a shared `scanForEscapingSymlinks = vi.fn()`, the `checkEscapingSymlinks` wrapper that calls it inside the one shared try/scan → `SymlinkEscapeError`-narrow → rethrow implementation, and `assertSubpathWithinClone: vi.fn()`. Expose the shared `scanForEscapingSymlinks` mock so test bodies can keep driving it.
2. Support both current usage shapes: the `...actual`-spread variant (update/list/pipeline, which narrows on `actual.SymlinkEscapeError`) and the full-replacement variant (add.test.ts, which declares local `PathTraversalError`/`SymlinkEscapeError`). Either accept the `SymlinkEscapeError` constructor as a parameter, or have the factory itself provide the error classes — whichever keeps each call site's existing narrowing semantics identical.
3. Update the six `vi.mock("../../src/copy-safety.js", ...)` factories to delegate to the helper, preserving each file's existing extra members and the `importOriginal`/`...actual` spread where it is currently used.
4. Keep the `mockScanForEscapingSymlinks` references in each test body pointing at the shared mock (via the helper's exposed handle) so the existing `.mockResolvedValue`/`.mockRejectedValue` drivers keep controlling behaviour exactly as before.
5. Remove the now-redundant inline scan-and-narrow blocks and the duplicated "Mirror the real wrapper's scan-and-narrow..." comments from the six files.

**Acceptance Criteria**:
- The scan-and-narrow (`try`/scan → `instanceof SymlinkEscapeError` → `{ ok: false, message }` → rethrow → `{ ok: true }`) implementation is authored in exactly one place (tests/helpers/copy-safety-mock.ts); none of the six test files contain an inline copy.
- Each of the six test files' `copy-safety` mock delegates to the shared helper while preserving its current narrowing semantics (local class vs `actual.SymlinkEscapeError`).
- The mocked `scanForEscapingSymlinks` remains drivable per-test (existing `.mockResolvedValue`/`.mockRejectedValue` calls still control the install/replay sites).
- No production code changes; no behavioural change to any test outcome.
- npm test passes with no other test modifications required.

**Tests**:
- Existing copy-safety / symlink-escape coverage in all six files passes unchanged: standalone-add cancel+exit on escape, collection-member failed-result+continue, update-replay blocked status, and clean-scan permit paths.
- Confirm the shared helper's `checkEscapingSymlinks` returns `{ ok: true }` on a clean scan, `{ ok: false, message }` for a `SymlinkEscapeError`, and rethrows a non-`SymlinkEscapeError` — matching the production wrapper contract.

## Task 2: Extract canonical @clack/prompts mock to stop spinner/log shape drifting across command test files
status: approved
severity: low
sources: duplication

**Problem**: The same `vi.mock("@clack/prompts", ...)` literal — `intro`/`outro`/`spinner({ start, stop, message })`/`log { info, warn, error, success(, message) }`/`cancel` — is repeated across the command test files: tests/commands/add.test.ts (18-33), tests/commands/update.test.ts (13-29), tests/commands/list-update-action.test.ts (6-22), tests/commands/list-change-version-action.test.ts (6-24). Each is ~15 lines with an identical spinner shape and log-method set. Field drift already exists (some include `log.message`; list-change-version adds `select`/`isCancel`) — exactly the copy-paste divergence a shared default prevents.

**Solution**: Add tests/helpers/clack-mock.ts exporting the canonical clack mock object — or a factory accepting extra members like `select`/`isCancel` — and reference it from each `vi.mock` factory so the spinner/log shape lives in one place. Test scaffolding only — no production change.

**Outcome**: The clack mock spinner/log shape is owned in one helper. Command test files reference it (extending with `select`/`isCancel`/`log.message` only where actually needed). Adding or changing a clack mock member is a one-place edit. All existing tests pass unchanged.

**Do**:
1. Add tests/helpers/clack-mock.ts exporting a factory (e.g. `mockClack(extra?)`) returning the canonical mock object: `intro`, `outro`, `spinner: vi.fn(() => ({ start, stop, message }))`, `log: { info, warn, error, success }`, `cancel` — all `vi.fn()`. Allow callers to merge extra members (e.g. `log.message`, `select`, `isCancel`) without redefining the base shape.
2. Update the four command test files' `vi.mock("@clack/prompts", ...)` factories to delegate to the helper, passing only the extras that file genuinely uses (e.g. list-change-version's `select`/`isCancel`).
3. Preserve every member each file currently relies on — verify no test loses access to a `vi.fn()` it asserts against (notably any `log.message` and `select`/`isCancel` usage).

**Acceptance Criteria**:
- The base clack mock shape (intro/outro/spinner/log/cancel) is authored once in tests/helpers/clack-mock.ts; the four command test files reference it.
- Files needing `select`/`isCancel`/`log.message` obtain them via the factory's extension mechanism, not by redefining the base object.
- No production code changes; no behavioural change to any test outcome.
- npm test passes with no other test modifications required.

**Tests**:
- Existing assertions against `p.log.*`, `p.spinner().*`, `p.cancel`, `p.select`, and `p.isCancel` across the four command test files pass unchanged.
