# Review: configless-install-analysis-7-2

**Task:** Extract canonical @clack/prompts mock to stop spinner/log shape drifting across command test files
**STATUS:** Complete
**FINDINGS_COUNT:** 0 blocking issues

## Spec Context
Test-quality / DRY refactor. The same vi.mock("@clack/prompts", ...) literal was copy-pasted across four command test files with field drift already begun. Fix centralises the canonical shape. No spec behaviour touched.

## Implementation — Implemented
- tests/helpers/clack-mock.ts:60-81 — mockClack(extra = {}) authoring the base shape once: intro/outro, spinner (fresh { start, stop, message } handle per call), full log set { info, warn, error, success, message }, cancel. ...extra spread last (additive).
- tests/commands/add.test.ts:18-21 — return mockClack();
- tests/commands/update.test.ts:13-16 — return mockClack();
- tests/commands/list-update-action.test.ts:11-14 — return mockClack();
- tests/commands/list-change-version-action.test.ts:11-14 — return mockClack({ select: vi.fn(), isCancel: vi.fn() }); (extension mechanism)
- Base shape now in exactly one place; grep finds zero residual base-mock literals in the four files.
- select/isCancel acquired only via the factory's extra arg; consumed via vi.mocked(p.select)/vi.mocked(p.isCancel).
- Per-test spinner-handle overrides remain inline (correct stable-handle pattern the helper docstring anticipates).
- No production (src/) code involved.

## Tests — Adequate (task IS a test refactor)
Existing assertions against p.log.*, p.spinner().*, p.cancel, p.select, p.isCancel bind to the same vi.fn instances. Runtime mock object is structurally identical to the prior inline literals. No over-/under-testing.

## Code Quality
Matches established helper-factory pattern; additive extra keeps it open/closed; low complexity; docstrings explain rationale.

## Blocking Issues
None.

## Non-Blocking Notes
- [bug] tests/helpers/clack-mock.ts:23 — `spinner: Mock<[], SpinnerHandle>` uses the removed vitest-2 two-arg tuple-args generic form. vitest 3 (installed ^3.0.5) takes a single function-type arg; correct form is `Mock<() => SpinnerHandle>`. Currently invisible (tsconfig excludes tests/, vitest does not type-check), but would surface under any future test type-checking step.
- [idea] list.test.ts, list-detail.test.ts, list-remove-action.test.ts, remove.test.ts still inline their own @clack/prompts mocks — out of scope; candidate follow-up to fully close the drift surface.
