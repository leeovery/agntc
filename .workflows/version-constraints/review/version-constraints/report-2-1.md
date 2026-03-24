TASK: Extend ManifestEntry with optional constraint field

ACCEPTANCE CRITERIA:
- ManifestEntry interface includes constraint?: string
- Old manifest JSON without constraint field reads correctly (entry.constraint is undefined)
- ManifestEntry with constraint: "^1.0" round-trips through write/read with field preserved
- ManifestEntry without constraint serializes to JSON without constraint key
- executeNukeAndReinstall preserves constraint from existing entry
- All existing tests pass

STATUS: Complete

SPEC CONTEXT: The spec (Manifest Storage section) states: "For non-constrained installs, constraint is absent. Its absence is the signal -- no need for a sentinel value." and "No migration needed -- constraint is purely additive. Old manifest entries without it behave exactly as before." The field captures user intent (e.g. "I want compatible 1.x updates"), while ref + commit capture current state. These shift independently on update.

IMPLEMENTATION:
- Status: Implemented
- Location: src/manifest.ts:16 -- `constraint?: string` added to ManifestEntry interface
- Location: src/nuke-reinstall-pipeline.ts:142-144 -- conditional spread to forward constraint from existing entry
- Notes: The plan specified placing `constraint` before `ref` (since it represents user intent). The actual placement is after `cloneUrl` (last field). This is purely cosmetic and has zero functional impact. The conditional spread pattern `...(existingEntry.constraint !== undefined && { constraint: existingEntry.constraint })` correctly handles both presence and absence cases, ensuring the key is entirely absent (not undefined) when no constraint exists.

TESTS:
- Status: Adequate
- Coverage:
  - "ManifestEntry accepts optional constraint field" -- tests/manifest.test.ts:473 -- verifies entry with constraint: "^1.0"
  - "ManifestEntry without constraint has undefined constraint" -- tests/manifest.test.ts:487 -- verifies absence yields undefined
  - "write/read round-trip preserves constraint field" -- tests/manifest.test.ts:500 -- writes entry with constraint, reads back, verifies preserved
  - "old manifest without constraint field reads correctly" -- tests/manifest.test.ts:519 -- writes raw JSON without constraint key, reads via readManifest, verifies undefined
  - "JSON serialization omits undefined constraint" -- tests/manifest.test.ts:541 -- verifies JSON.stringify output does not contain "constraint"
  - "JSON serialization includes defined constraint" -- tests/manifest.test.ts:556 -- verifies JSON round-trip preserves value
  - "executeNukeAndReinstall preserves constraint from existing entry" -- tests/nuke-reinstall-pipeline.test.ts:351 -- verifies constraint forwarded through pipeline
  - "executeNukeAndReinstall omits constraint key entirely when existing entry has no constraint" -- tests/nuke-reinstall-pipeline.test.ts:372 -- verifies key absence (not just value absence) using `"constraint" in result.entry`
- Notes: All 7 planned tests are present plus one additional negative case for executeNukeAndReinstall. The round-trip test only covers a single entry with constraint (the plan suggested one with and one without); however, the "old manifest without constraint" test separately covers the without-constraint read path, so the combined coverage is equivalent. The nuke-reinstall test checking `"constraint" in result.entry` is a strong assertion that validates the conditional spread pattern works correctly.

CODE QUALITY:
- Project conventions: Followed -- optional field pattern matches TypeScript conventions; test structure follows existing describe/it patterns in the test file
- SOLID principles: Good -- ManifestEntry remains a simple data interface; no unnecessary abstractions
- Complexity: Low -- single field addition, conditional spread is a standard TypeScript idiom
- Modern idioms: Yes -- conditional spread pattern `...(condition && { key: value })` is idiomatic TypeScript
- Readability: Good -- the intent is clear from the code
- Issues: None

BLOCKING ISSUES:
- (none)

NON-BLOCKING NOTES:
- The plan specified placing `constraint` before `ref` in the interface to visually separate "user intent" (constraint) from "resolved state" (ref, commit). The actual placement is after `cloneUrl` (last field). This is purely a style preference with no functional impact. Not worth changing since reordering interface fields in an existing codebase can cause unnecessary churn.
- The round-trip test (tests/manifest.test.ts:500) only tests one entry with constraint. The plan suggested also including an entry without constraint in the same round-trip test. The "old manifest" test (line 519) covers the without-constraint read path separately, so this is not a gap, but a combined test would be slightly more representative of real manifests.
