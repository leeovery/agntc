TASK: Fix list update action to forward constrained update resolution

ACCEPTANCE CRITERIA:
- executeUpdateAction accepts and forwards override ref/commit to cloneAndReinstall
- List UI constrained update installs the resolved tag, not the current ref
- Non-constrained updates from list UI are unaffected (no overrides passed)

STATUS: Complete

SPEC CONTEXT: The specification (List Command Integration section) states that the list dashboard should surface constrained update status and allow updates within constraint bounds. The Constrained Update Flow section requires that when a newer tag is resolved within constraint bounds, the nuke-and-reinstall uses that new tag. The `constrained-update-available` status carries both the resolved `tag` and `commit` which must be forwarded to the reinstall pipeline.

IMPLEMENTATION:
- Status: Implemented
- Location:
  - /Users/leeovery/Code/agntc/src/commands/list-update-action.ts:7-10 (UpdateActionOverrides interface)
  - /Users/leeovery/Code/agntc/src/commands/list-update-action.ts:18-26 (executeUpdateAction with optional overrides param)
  - /Users/leeovery/Code/agntc/src/commands/list-update-action.ts:48-55 (spread of overrides into cloneAndReinstall options)
  - /Users/leeovery/Code/agntc/src/commands/list.ts:156-166 (constrained update branch constructs overrides from freshStatus)
- Notes: The implementation is clean and correct. The `UpdateActionOverrides` interface has `newRef` and `newCommit` fields that map exactly to `CloneAndReinstallOptions.newRef` and `CloneAndReinstallOptions.newCommit`. The spread `...overrides` on line 54 of list-update-action.ts is a clean way to conditionally apply the fields. In list.ts lines 157-160, the overrides are only constructed when `freshStatus.status === "constrained-update-available"`, which is the only status that carries `tag` and `commit`. Non-constrained updates pass `undefined` for overrides, which spreads as no-op — preserving existing behavior.

TESTS:
- Status: Adequate
- Coverage:
  - /Users/leeovery/Code/agntc/tests/commands/list-update-action.test.ts:541-608 ("constrained update overrides" describe block)
  - Test at line 542: "forwards newRef and newCommit to cloneAndReinstall when overrides provided" — creates an entry with constraint "^1.0.0" and ref "v1.0.0", passes overrides { newRef: "v1.2.0", newCommit: "c"x40 }, verifies cloneSource is called with ref "v1.2.0" and that the result entry has the override ref and commit.
  - Test at line 577: "behaves as before when no overrides provided" — same constrained entry but no overrides, verifies cloneSource uses the existing entry.ref "v1.0.0".
- Notes: Both required test scenarios (with overrides and without) are covered. The tests verify the key behavior: that overrides change the ref passed to cloneSource and that the resulting manifest entry reflects the override values. The tests are focused and not redundant. They would fail if the override forwarding logic broke.

CODE QUALITY:
- Project conventions: Followed — uses the established pattern of extracting action logic into separate `list-*-action.ts` modules, consistent with list-remove-action.ts and list-change-version-action.ts.
- SOLID principles: Good — the `UpdateActionOverrides` interface provides a clean, typed contract. The optional parameter with undefined default follows the existing patterns. Single responsibility is maintained.
- Complexity: Low — the conditional at list.ts:157-160 is a simple ternary. The spread pattern at list-update-action.ts:54 is idiomatic.
- Modern idioms: Yes — uses optional spreading, discriminated union narrowing on freshStatus.status, TypeScript interfaces.
- Readability: Good — the overrides construction in list.ts clearly communicates intent: only pass resolved tag/commit when the status is constrained-update-available. The interface name `UpdateActionOverrides` is descriptive.
- Issues: None

BLOCKING ISSUES:
- None

NON-BLOCKING NOTES:
- None
