# Review: configless-install-analysis-9-1

**Task:** Make Skills-Only Collection Members Updatable — Preserve The Source Subpath The Update Path Needs To Relocate skills/<name>
**STATUS:** Complete
**FINDINGS_COUNT:** 0 blocking issues

## Spec Context
Cycle-8 added the flag-free skills/-only collection root: inner skills enumerated with dir-relative segment skills/<name> but keyed by basename (owner/repo/<name>). Pre-fix update reconstructed source dir purely from key via getSourceDirFromKey → wrong path → derive-before-delete aborts. Plan entry analysis-9-1 (planning.md:257) confirms option (a) chosen and legacy case explicitly handled-or-documented.

## Implementation — Implemented (option (a), as planned)
- src/manifest.ts:37 — optional sourceSubpath?: string with doc (21-36). Conditional spread in buildManifestEntry (61-67) omits when undefined → byte-identical legacy shape.
- src/commands/add.ts:123-125 — memberSourceSubpath(memberSegment) returns segment only when it diverges from basename, else undefined.
- src/commands/add.ts:785-796 — step-6 collection write loop populates sourceSubpath via memberSourceSubpath(result.pluginSegment); buildAddEntry (63-88) threads it through; pluginSegment carried on PluginInstallResult (summary.ts:112-129).
- src/source-parser.ts:462-470 — resolveUpdateSourceDir is the single authoring of the rule; getSourceDirFromKey has no other production caller.
- src/clone-reinstall.ts:366-381 — remote branch: pre-flight assertSubpathWithinClone guard (analysis-10-2) then resolveUpdateSourceDir. Local-path branch bypasses (keyed by path).
- Identity preserved: memberKey always keys by basename; install destination unchanged. --plugin/type:plugin bundle path never enumerates inner skills → no sourceSubpath, unchanged.

## Tests — Adequate
- Integration (f) tests/integration/workflows.test.ts:683-812 — installs flag-free skills-only member (sourceSubpath="skills/alpha" persisted + asserted), updates via executeNukeAndReinstall end-to-end: status "success", re-copy picks up new references/new.md under skills/alpha for both agents, SKILL.md present, type intact, sourceSubpath survives, commit advanced.
- Integration (g) :814-891 — genuine root-child member (no sourceSubpath): falls back to <clone>/alpha (asserted), update succeeds, no sourceSubpath introduced.
- clone-reinstall.test.ts:529-612 — full cloneAndReinstall seam: relocated derive-before-delete path, copy from relocated dir, sourceSubpath survival, fallback case.
- source-parser.test.ts:1147-1167 — focused resolveUpdateSourceDir unit test, both branches.
- manifest.test.ts:580-683 — type acceptance, round-trip, OLD manifest without field reads correctly, JSON omits-undefined/includes-defined.
- Legacy case: a pre-fix skills-only entry (no sourceSubpath) falls back to wrong dir, replayRecordedSkill finds no SKILL.md, pipeline returns `aborted` with remove+add remedy (clone-reinstall.ts:263-273, nuke-reinstall-pipeline.ts:159-161) — loud, install-intact, non-silent.

## Code Quality
Strict TS; optional field typed string | undefined; resolveUpdateSourceDir single-responsibility seam shared by production and tests; memberKey/memberSourceSubpath single-source helpers. No issues.

## Blocking Issues
None.

## Non-Blocking Notes
- [quickfix] tests/commands/add.test.ts — add a collection-install assertion that a skills-only member drives runCollectionPipeline and persists sourceSubpath="skills/<name>" on the written entry while a root-child member omits it. Closes the only end-to-end gap in the INSTALL-path wiring (memberSourceSubpath → buildAddEntry); currently covered only at unit granularity and via inline-entry integration test (f).
