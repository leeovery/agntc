TASK: configless-install-analysis-5-1 — Dedup the add.ts manifest-entry literal (into buildAddEntry) and the collection member-key ternary (into memberKey); both consumed by both standalone + collection paths. Consolidation only.

ACCEPTANCE CRITERIA: buildManifestEntry literal at exactly one site in add.ts (the helper), both former call sites invoke it; member-key ternary authored at exactly one site referenced by 5a + step-6; manifest entries/keys byte-for-byte identical for standalone + collection; no new public exports / signature changes outside add.ts (helpers local); npm test passes unmodified.

STATUS: Complete

SPEC CONTEXT: Spec fixes ManifestEntry shape (ref,commit,installedAt,agents,files,type,cloneUrl,constraint) + constraint-omission for untagged. Member-key rule: direct-path keeps parsed.manifestKey else `${manifestKey}/${pluginName}`. Pure refactor — must not alter observable values, only authoring sites.

IMPLEMENTATION: Implemented (matches plan exactly). src/commands/add.ts.
- :63-80 local buildAddEntry(opts) owns single buildManifestEntry({...}) literal + manifestTypeFromDetected(opts.detected) + deriveCloneUrlForManifest(opts.parsed). Parameterised by detected/agents/files/parsed/commit/constraint.
- :87-94 local memberKey(parsed, pluginName) owns single direct-path ternary.
- :410-417 standalone tail (former 369-377 literal) calls buildAddEntry; :734-741 collection write-loop (former 700-708) calls buildAddEntry.
- :616 5a conflict/nuke pass pluginManifestKey = memberKey(parsed, pluginName); :733 step-6 write loop manifestKey = memberKey(parsed, result.pluginName).
- buildManifestEntry literal now at exactly one site (line 71); grep: other buildManifestEntry callers are manifest.ts (def) + nuke-reinstall-pipeline.ts (out of scope). Member-key ternary at one site referenced by both passes.
- Byte-identity holds: both sites pass identical field values to before (standalone detected/selectedAgents/copiedFiles/parsed/commit/resolvedConstraint; collection result.detectedType/result.agents/result.copiedFiles/parsed/commit/constraint); buildManifestEntry/manifestTypeFromDetected/deriveCloneUrlForManifest untouched so installedAt stamping + constraint omission preserved.
- Helpers module-local (grep: no export, referenced only in add.ts). buildAddEntry returns ManifestEntry, memberKey returns string, correctly typed. Type narrowing preserved (opts.detected typed Extract<DetectedType,{type:"bare-skill"|"plugin"}> matching both sites; no as casts).

TESTS: Adequate (no test modifications required — criterion met). tests/commands/add.test.ts: standalone shape :463 (ref/commit/installedAt ISO/agents/files) + cloneUrl variants 483-534 + :822 full field set incl type; collection non-direct-path keys :991 (owner/my-collection/pluginA,B); direct-path member key :1427 (entry under bare parsed.manifestKey — confirms write-loop key == 5a key, the divergence-guard the plan calls for); per-member type/field :1334/1361/1390/1402. Existing suite pins entry shape + both key branches; tests assert observable behaviour via addEntry mock not helper internals so correctly unchanged. Read-verified.

CODE QUALITY: Conventions followed (small local helpers, intent JSDoc consistent w/ manifest.ts factory docs; Extract<DetectedType,...> + Awaited<ReturnType<typeof parseSource>> idioms). SOLID good (single-responsibility helpers; field-shape + member-key each one home — DRY without premature abstraction). Complexity low (flat assembly + single ternary). Modern idioms (options-object param, discriminated narrowing, no casts). Readability good (step comments/ordering preserved; JSDoc cites the two call sites).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
