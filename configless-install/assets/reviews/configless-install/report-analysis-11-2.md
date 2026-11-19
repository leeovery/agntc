# Review: configless-install-analysis-11-2

**Task:** Extract the shared list-action test harness into tests/helpers
**STATUS:** Complete
**FINDINGS_COUNT:** 0 blocking issues

## Spec Context
Pure test-support consolidation from analysis cycle 11. The two list-action test files shared a byte-identical ~130-line preamble of vi.mock factories, vi.mocked handles, SHA constants, fakeDriver, and beforeEach body. The task extracts it into tests/helpers/. No behaviour change; regression guard is identical suite count + pass state pre/post.

## Implementation — Implemented
- tests/helpers/list-action-mocks.ts:32,34,41-56,70-110 — non-hoisted shared wiring: INSTALLED_SHA/REMOTE_SHA constants, ListActionMocks interface, setupListActionMocks() resolving shared vi.mocked handles + fakeDriver + common beforeEach defaults.
- tests/helpers/list-action-mock-factories.ts:1-93 — import-free hoisted factory bodies (manifest, git-clone, config, type-detection, nuke-files, copy-plugin-assets, copy-bare-skill, drivers/registry).
- tests/commands/list-update-action.test.ts:11-115 — delegates each vi.mock to shared factories, consumes setupListActionMocks(), layers only stat (node:fs/promises mock adds stat at 77-80; mockStat handle at 115).
- tests/commands/list-change-version-action.test.ts:11-130 — delegates to shared factories, consumes setupListActionMocks(), layers only select/isCancel (mockClack extra at 13), fetchRemoteTags (92-94, 119), mockIsCancel.mockReturnValue(false) (128-130).
- Duplicated preamble gone; divergences match ACs exactly.
- No production code changed (src/commands/list-update-action.ts and list-change-version-action.ts untouched; factories helper has zero static imports of production modules → delegation cannot hit real impls).
- Vitest hoisting respected: each vi.mock keeps its literal path; body delegated via await import(...helper) async-factory pattern; setupListActionMocks() runs at module scope after the hoisted vi.mock calls. The import-free constraint on the factories helper documented and honoured.
- node:fs/promises access member stays per-file factory (literal path required at hoist); handle + default centralised in setup/beforeEach — correct hoisting accommodation, not a divergence.

## Tests — Adequate (pure test-support refactor)
All pre-existing executeUpdateAction cases (remote/local update, clone failure, agent drops + warnings, temp-dir cleanup, null config, collection key, copy-failed remote/local, aborted, blocked, constrained overrides) and all executeChangeVersionAction cases (tag presentation, cancel, change, clone failure, agent drops, cleanup, ref update, not-newer-tags, copy-failed, aborted, blocked, constrained, fetchRemoteTags gating) retained verbatim. Aborted/blocked cases verify the same outcomes (install intact; canonical abort vs copy-safety messages). Coverage of the two functions unchanged.

## Code Quality
Reuses established hoisted-vi.mock + dynamic-import factory pattern (clack-mock.ts, copy-safety-mock.ts) and factories.ts; clean separation between import-free hoisted factory bodies and statically-importing non-hoisted handle wiring; low complexity; typed ListActionMocks interface; hoisting rationale documented.

## Blocking Issues
None.

## Non-Blocking Notes
- [quickfix] tests/helpers/list-action-mocks.ts:32 — INSTALLED_SHA is exported (and named in the ACs as part of the shared surface) but neither consumer imports it; both use only REMOTE_SHA. Either drop the export, or reference INSTALLED_SHA where the files currently rely on makeEntry()'s inline default "a".repeat(40) commit, to make the installed SHA explicit.
