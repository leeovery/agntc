# Review: configless-install-review-1-1

**Task:** Add integration scenario exercising the update-time symlink-escape pipeline seam (blocked-before-nuke)
**STATUS:** Complete
**FINDINGS_COUNT:** 0 blocking issues

## Spec Context
specification.md:377, 382-393 requires the symlink-escape guard to run as a pre-flight scan on every install/re-copy ("validate before you mutate" / derive-before-delete). analysis-1-3 Do-item 4 demands the production update pipeline abort before nuke on an escaping-symlink source, exercising executeNukeAndReinstall → checkEscapingSymlinks → "blocked" (src/nuke-reinstall-pipeline.ts:109-115) on an existing recorded install, asserting the install is left intact.

## Implementation — Implemented
- New scenario: tests/integration/workflows.test.ts:1136-1218 — describe "copy-safety pipeline-level blocked outcome aborts update before nuke", test "(e3)".
- Retained/renamed guard-level scenario: tests/integration/workflows.test.ts:1077-1134 — describe "copy-safety guard-level pre-flight gates a real copy", tests "(e)" + "(e2)".
- Production seam under test: src/nuke-reinstall-pipeline.ts:109-115. checkEscapingSymlinks (src/copy-safety.ts:115-128) is the production wrapper around scanForEscapingSymlinks, so (e3) genuinely exercises the pipeline-level seam, not the guard utility directly.

## Tests — Adequate (ACs map 1:1)
- AC1: (e3) calls executeNukeAndReinstall (:1195) — same entry point update uses. Met.
- AC2: expect(result.status).toBe("blocked") at :1206. Met.
- AC3: installed SKILL.md + references/guide.md asserted present before (:1186-1187) and after (:1209-1210) — no nuke before block. Met.
- AC4: manifest entry snapshotted via readRawManifest before (:1188-1190) and expect(entryAfter).toEqual(entryBefore) after (:1213-1216). Met.
- AC5: guard-level describe renamed (:1077); (e) still asserts SymlinkEscapeError before copy at :1109-1110. Met.
- AC6: no mocks in the file; consistent with surrounding no-mocks scenarios. Met.

The "retain root SKILL.md" setup (:1167-1171) is a deliberate, load-bearing control isolating the block to the symlink pre-flight rather than a missing-SKILL.md abort.

## Code Quality
Project conventions followed (node:fs/promises, real drivers, absolute joins, consistent with (f)/(g) pipeline scenarios). No issues.

## Blocking Issues
None.

## Non-Blocking Notes
- [idea] (e3) covers the recorded-skill replay arm's blocked seam. A symmetric recorded-plugin variant would add defensive breadth, but the pre-flight runs before type dispatch so this is not an uncovered gap.
