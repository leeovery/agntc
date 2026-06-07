AGENT: architecture
CYCLE: 5
STATUS: clean
FINDINGS_COUNT: 0

SUMMARY: Architecture composes cleanly across detection, config, agent-selection, copy-safety, and the add/update pipelines — no genuine, actionable architectural issues.
- One structural detection path (detectType) with a clean override layer over a stable public DetectedType union; richer internal StructuralKind mapped to the public union in one place; findPresentAssetDirs is the single asset-dir scan reused by detection, membership, and replay.
- Type seams are concrete, not untyped: manifestTypeFromDetected takes Extract<DetectedType, {type:"bare-skill"|"plugin"}>, copy-unit.ts narrows the same way (StandaloneDetected), installed-result narrowing is static (no runtime guard). deriveTypeFromFiles, recorded-type replay, and detected type produce/consume the same "skill"|"plugin" fact from genuinely different inputs — distinct concerns, not parallel computations.
- Copy-safety is pure throw-only primitives (assertSubpathWithinClone, scanForEscapingSymlinks) wrapped by the discriminated checkEscapingSymlinks; callers own only their surfacing. cloneRoot vs unitDir/sourceDir boundary threaded explicitly so the symlink boundary is always the clone root.
- The CloneReinstallFailure union + mapCloneFailure/failureMessage/noAgentsMessage centralise failure dispatch across all four update entry points; list actions derive messages from the same source and cannot drift.
- Update relies on the trusted recorded manifest key via getSourceDirFromKey rather than a fresh selector, so the path-traversal guard is needed only on add's direct-path selector and the symlink scan is the whole update pre-flight — a sound, documented asymmetry.
The two findings discarded in cycle 4 (collection-member skills-only via forcePlugin; detectType's caller-enforced standalone invariant) were re-examined; no materially new actionable angle.
