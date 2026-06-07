AGENT: architecture
CYCLE: 6
STATUS: clean
FINDINGS_COUNT: 0

SUMMARY: Architecture is sound — clean boundaries, appropriate abstractions, good seam quality across the configless-install pipeline. No genuine architectural issue.
- Single detection path (detectType maps internal StructuralKind to the stable public DetectedType union in one place; override layer wantsPlugin centralised; no parallel/fallback detection).
- One seam for type persistence (manifestTypeFromDetected sole bare-skill→skill mapping, signature anchored to Extract<DetectedType,{type:"bare-skill"|"plugin"}> so a future variant forces a compile error; deriveTypeFromFiles the disjoint legacy path from local files only).
- Failure-status union defined once beside its mapper (CloneReinstallFailure + isCloneReinstallFailure + mapCloneFailure together; four reinstall entry points share them; failureMessage implemented via mapCloneFailure so list actions can't drift; aborted vs blocked correctly distinct statuses, not a redundant tag).
- Copy-safety guards split by responsibility, boundary threaded consistently (path-traversal lexical/source-resolution, gated before the first read at joined unitDir step 2c; symlink-escape content/every-install with cloneRoot boundary — not unitDir — passed identically through add and update; update's omission of path-traversal justified+documented: replays a manifest-derived key via getSourceDirFromKey, not a fresh selector).
- Concrete types at boundaries (ComputeInput, StructuralKind, StandaloneDetected, AgentResolution/SelectAgentsResult discriminated unions; toComputeInput/copyUnit branch on the discriminant only).
The only residue (buildAddEntry/memberKey consolidation in add.ts) is duplication-domain (cycle 5) — not architectural. Consistent with architecture returning clean in cycle 5.
