TASK: configless-install-analysis-1-5 — De-duplicate the fs-existence helper and the ManifestEntry construction (single fs-existence primitive; single buildManifestEntry factory owning installedAt stamp + conditional constraint spread; three entry sites byte-identical).

ACCEPTANCE CRITERIA: no local exists; ManifestEntry literal in exactly one place; entries byte-identical in shape.

STATUS: Complete

SPEC CONTEXT: Pure internal consolidation (duplication), no observable behaviour change. Single fs-existence primitive centres pathExists (fs-utils.ts); single entry factory so future shape changes are made once. Later analysis-5-1 further folded the two add.ts sites behind buildAddEntry — consistent with and strengthening this task.

IMPLEMENTATION: Implemented.
- fs primitive: src/type-detection.ts:5 imports pathExists; checks at :123/:136/:202; local exists gone (Grep function exists|const exists no match in src). Doc comment names pathExists as the single primitive.
- Factory: src/manifest.ts:41-48 buildManifestEntry(fields: ManifestEntryInput) owns installedAt: new Date().toISOString() (:45) + conditional ...(constraint !== undefined && {constraint}) (:46). ManifestEntryInput = Omit<ManifestEntry,"installedAt">. Only installedAt: new Date() literal in src (Grep).
- Three sites route through factory: add.ts standalone tail :410 + collection loop :734 (via shared buildAddEntry :71 → buildManifestEntry); nuke-reinstall-pipeline.ts:279.
- Byte-identical structurally guaranteed (single factory is the only place literal/stamp/spread exist). constraint != null faithfully reproduced as constraint !== undefined (string|undefined everywhere). cloneUrl always passed explicitly (null when absent).

TESTS: Adequate. Factory unit: tests/manifest.test.ts:1055-1174 (fake timers): stamps installedAt (1067); valid ISO (1080); includes constraint w/ full toEqual (1093); omits when undefined w/ "constraint" in entry false + full shape (1117); omits when not passed (1140); cloneUrl present/null + commit null-vs-sha (1153). Both constraint and cloneUrl axes. Site 1+2 (add.ts): mock keeps real buildManifestEntry/manifestTypeFromDetected (:99-103) so write-point tests exercise real factory; full-shape objectContaining (822-840). Site 3 (nuke-reinstall): buildSuccess→buildManifestEntry shape asserted (562,586,640, constraint omission "constraint" in result.entry false 659). fs primitive: findPresentAssetDirs tests (type-detection.test.ts:31-64). Shape guarantee now structural so no cross-site deep-equal boilerplate needed. Not over-tested.

CODE QUALITY: Conventions followed (Omit<ManifestEntry,"installedAt"> input type so factory input can't drift; conditional-spread idiom). SOLID good (factory SRP stamp+spread; buildAddEntry owns add-path assembly delegating literal — appropriate two-layer split not over-abstracted). Complexity low. Modern idioms (rest destructure, Omit). Readability good (doc comments explain installedAt ownership + constraint !== undefined equivalence).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [idea] src/init/scaffold-utils.ts:16 — pathExists here is a byte-identical clone of fs-utils.ts:27 (same name/signature/access try-catch), so a second fs-existence primitive still exists. Out of this task's stated scope (named only type-detection.ts exists) but undercuts the broader single-primitive goal. Decide whether to collapse onto fs-utils.pathExists or note as intentionally module-local to init.
