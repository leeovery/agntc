TASK: configless-install-analysis-1-3 — Add real-driver, real-manifest-round-trip integration scenarios for the new configless seams (configless detection → manifest type write; type backfill round-trip; derive-before-delete abort; structural collection-membership scan; copy-safety pre-flight). Original finding: tests/integration/workflows.test.ts shipped agntc.json in every scenario, covered only v1 flows, and the agent-drop test hit the ?? "skill" fallback not a backfilled value.

ACCEPTANCE CRITERIA: scenarios cover all four seams against real drivers; backfill scenario asserts persisted derived type (real read-then-write); abort scenario asserts files intact. Do-items: (1) configless bare-skill → detect→copy→write→read back type:"skill"; (2) legacy entry without type → read backfill → write persists derived type; (3) recorded-plugin reshaped to bare-skill → executeNukeAndReinstall aborted, files intact; (4) escaping-symlink source → pipeline aborts before nuke.

STATUS: Issues Found

SPEC CONTEXT: Manifest Keying & Lifecycle (type optional, backfill from files in-memory on read persisted on write); Derive-before-delete (recorded plugin aborts when no asset dir remains, install intact); Copy-Safety (symlink-escape pre-flight on update re-copy before nuke, boundary=clone root); Structural detection.

IMPLEMENTATION: Implemented with one drift on Do-item 4. tests/integration/workflows.test.ts:449-785 — six new describe blocks, no mocks (grep for vi.mock/vi.fn/vi.spyOn returns nothing), real drivers + real production functions. readRawManifest helper (:79-85) reads file directly off disk to bypass in-memory backfill — correct technique to prove persistence.
- Configless detect→type write: (a) :450-495 bare skill persisted type:"skill"; (b) :497-542 multi-asset plugin persisted type:"plugin".
- Backfill round-trip: (c) :546-579 plugin from agents/ files (asserts "type" in before === false, reads via readManifest derives plugin, writes, re-reads RAW asserts persisted); (c2) :581-605 single-skill → skill.
- Derive-before-delete abort: (d) :609-670 plugin reshaped to bare skill → executeNukeAndReinstall aborted, recordedType plugin, files on disk + manifest entry unchanged; (d2) :672-725 inverse.
- Copy-safety: (e) :729-772 escaping symlink; (e2) :774-784 within-clone control.

TESTS: Adequate with one gap. Seams 1/2/3 covered end-to-end; backfill correctly proven via raw read-then-write (satisfies AC#2, closes the original ?? "skill" gap); abort asserts files intact (AC#3). No redundancy; (c2)/(d2)/(e2) are deliberate complementary branches.

BLOCKING ISSUES:
- Do-item 4 not implemented as specified. Task requires the PIPELINE to abort before nuke on an escaping-symlink source (executeNukeAndReinstall → checkEscapingSymlinks → "blocked" outcome, src/nuke-reinstall-pipeline.ts:103-109). Scenario (e) (:729-772) instead calls scanForEscapingSymlinks + copyBareSkill directly and asserts SymlinkEscapeError before copy. It verifies the underlying guard + "before any copy" ordering, but does NOT exercise the executeNukeAndReinstall "blocked" seam nor the "aborts before nuke / install left intact" property on an existing recorded install. (Mitigant: the pipeline blocked-before-nuke path IS unit-tested in nuke-reinstall-pipeline.test.ts / clone-reinstall.test.ts per task 5-4; the gap is specifically the integration-level proof this task scoped.) To close: add a scenario recording a real install + manifest entry, place an escaping symlink in the re-cloned source, call executeNukeAndReinstall, assert status==="blocked", existing files still on disk, manifest entry unchanged.

NON-BLOCKING NOTES:
- [quickfix] tests/integration/workflows.test.ts:202-208 — "plugin add with collision detection" computes pluginAIncoming but never uses it (pre-dates this task); remove or assert.
- [idea] tests/integration/workflows.test.ts:729-772 — once the pipeline scenario is added, keep (e) as the unit-level guard test but rename its describe to distinguish guard-level from pipeline-level "blocked".
- [do-now] tests/integration/workflows.test.ts:597 — add the symmetric expect("type" in before["owner/legacy-skill"]).toBe(false) in (c2) to match (c)'s :567 sanity assertion.

CODE QUALITY: Conventions followed (real drivers as integration point, discriminated-union narrowing, node: prefixes, tmpdir isolation + cleanup; readRawManifest JSDoc documents why it bypasses backfill). SOLID/complexity/readability good. Issues: none at the quality level.
