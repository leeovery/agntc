AGENT: duplication
CYCLE: 11
STATUS: findings
FINDINGS_COUNT: 1

FINDINGS:
- FINDING: Near-identical mock-setup harness duplicated across the two list-action test files
  SEVERITY: medium
  FILES: tests/commands/list-update-action.test.ts:1-136, tests/commands/list-change-version-action.test.ts:1-137
  DESCRIPTION: The two list-action test files share an essentially byte-identical ~130-line preamble: the `@clack/prompts`/`manifest`/`git-clone`/`config`/`type-detection`/`nuke-files`/`copy-plugin-assets`/`copy-bare-skill`/`drivers-registry`/`node:fs/promises`/`copy-safety` `vi.mock` factories, the full block of `vi.mocked(...)` handle declarations, the `INSTALLED_SHA`/`REMOTE_SHA` constants, the `fakeDriver`, and the `beforeEach` body. A diff shows the only divergences are: change-version adds `fetchRemoteTags` + `select`/`isCancel` mocks and an `mockIsCancel.mockReturnValue(false)` line, while list-update adds `stat`. Each future change to the shared pipeline's dependency surface must be hand-mirrored in both files — the copy-paste-drift risk the prior cycles' clack-mock.ts/copy-safety-mock.ts/factories.ts helpers were created to remove, but the mock-wiring/beforeEach layer above those helpers was never extracted. The `aborted` and `blocked` test cases (list-update-action.test.ts:557-629, list-change-version-action.test.ts:535-615) are also near-verbatim copies.
  RECOMMENDATION: Extract the shared list-action test harness into a `tests/helpers/` module (e.g. `setupCloneReinstallMocks()` / `installCloneReinstallBeforeEach()`) registering the common beforeEach defaults and returning the shared `vi.mocked` handles, plus a helper consolidating the common `vi.mock` factory set. The change-version file layers only its extra select/isCancel/fetchRemoteTags mocks on top. Mirrors the existing mockClack/mockCopySafety extraction pattern one level up. No behaviour change — pure test-support consolidation.

SUMMARY: Production code is already well-consolidated; no high-impact source-side duplication remains. The one outstanding candidate is the ~130-line near-identical mock-setup-and-beforeEach harness shared by the two list-action test files, which sits above the already-extracted test helpers and is a drift risk worth folding into a shared tests/helpers setup.
