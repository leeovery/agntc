TASK: configless-install-4-2 — Persist each collection member's resolved type at the member addEntry site, reusing 4-1's manifestTypeFromDetected (bare-skill→skill, plugin→plugin). No collection-level entry.

ACCEPTANCE CRITERIA: each installed member entry persists type from resolved detectedType; mixed collection records skill + plugin; configless + config-bearing both record structural type; NO collection-container entry; direct-path single member keyed owner/repo/<unit> records own type; skipped/failed → no entry no type.

STATUS: Complete

SPEC CONTEXT: Manifest Keying & Lifecycle (collection is transport not stored — each child its own entry, no collection-level entry; resolved value persisted; member entries owner/repo/<unit> with own type, independent by construction; backfill per entry, always a unit).

IMPLEMENTATION: Implemented (converged final state). src/commands/add.ts:725-744 (step 6 write loop).
- Per-member entry built at 734-741 via buildAddEntry({detected: result.detectedType, ...}); mapping seam buildAddEntry (63-80) → manifestTypeFromDetected (manifest.ts:59-63). Shared with standalone tail (410) — can't drift.
- PluginInstallResult.installed carries REQUIRED detectedType narrowed to Extract<DetectedType,{bare-skill|plugin}> (summary.ts:112-127); if(result.status!=='installed') continue (728) statically narrows — no runtime throw (analysis-2-2 final state).
- No collection-level entry: only installed results reach addEntry; container key never written.
- Keying via memberKey (87-94, task 3-6): direct-path ? manifestKey : `${manifestKey}/${pluginName}`. Not re-implemented.
- Configless vs config-bearing identical: detectedType structurally resolved (562-568), no config feeds persisted type. Standalone/update/backfill untouched.

TESTS: Adequate. tests/commands/add.test.ts describe("recorded type (per member)") 1328-1472: each member resolved type bare-skill→skill/plugin→plugin (1334); configless + config-bearing both record (1361); no collection-container entry owner/my-collection (1390); skipped member no entry (1402); direct-path single member records type under owner/repo/<unit> (1427). mockAddEntry passthrough captures real entry built by buildAddEntry/buildManifestEntry — genuine seam exercise. findPresentAssetDirs mocked [] so detectType mock drives resolved type. Failed-member no-entry covered nearby (1783-1807). Not over-tested.

CODE QUALITY: Conventions followed (discriminant narrowing over runtime guard; Extract anchors param; shared buildAddEntry DRY). SOLID good (buildAddEntry/memberKey/manifestTypeFromDetected single responsibilities; loop orchestrates). Complexity low. Modern idioms. Readability good (comment explains why no runtime narrowing needed).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
