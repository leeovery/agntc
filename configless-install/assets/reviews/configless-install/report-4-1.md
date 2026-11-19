TASK: configless-install-4-1 — Add optional type?: 'skill'|'plugin' to ManifestEntry; persist resolved type at standalone install write point; mapping seam bare-skill→'skill', plugin→'plugin'.

ACCEPTANCE CRITERIA: ManifestEntry.type optional, round-trips with/without; standalone bare-skill → 'skill'; standalone plugin → 'plugin'; skills-only via --plugin/config type → 'plugin'; direct-path standalone records own type; bare-skill→skill (never literal 'bare-skill'); other fields unchanged.

STATUS: Complete

SPEC CONTEXT: Manifest Keying & Lifecycle (record resolved type "skill"|"plugin" only, three derivation paths collapse to one fact; collection never stored; type field optional so legacy parses, readers tolerate absence; backfill is 4-3). bare-skill→skill is the never-silently-morph seam.

IMPLEMENTATION: Implemented (converged final state).
- src/manifest.ts:18 — type?: "skill"|"plugin" (optional, after files).
- src/manifest.ts:59-63 — manifestTypeFromDetected(t: Extract<DetectedType,{type:"bare-skill"|"plugin"}>): "skill"|"plugin"; body t.type==="bare-skill"?"skill":"plugin". Retyped to discriminated variant per analysis-2-2 — future structural variant forces compile error (improvement).
- src/commands/add.ts:63-80 — buildAddEntry helper (analysis-5-1) owns the single literal incl type: manifestTypeFromDetected(opts.detected); detected param is Extract<...> narrowed variant, derived from single resolved detected.
- :410-417 standalone tail builds entry via buildAddEntry; detected narrowed (collection/not-agntc exit earlier 293-313).
- :733-742 collection member loop also routes through buildAddEntry (4-2's write point, shared helper).
- Direct-path standalone flows same tail keyed parsed.manifestKey=owner/repo/<subpath> (tests 3983, 3808).
- Scope respected: nuke-reinstall-pipeline.ts/update.ts/backfill (manifest.ts:90-97 is 4-3) untouched.

TESTS: Adequate.
- Interface/round-trip (tests/manifest.test.ts): type optional accepted (581-593); undefined when absent (595-606); round-trip preserves (608-625); legacy no-type parses (627-647); JSON.stringify omits undefined (649-662); manifestTypeFromDetected block bare-skill→skill/plugin→plugin/never literal (665-681).
- Write-point (tests/commands/add.test.ts "recorded type" 746-841): standalone bare→skill (747); standalone plugin (757); --plugin skills-only→plugin (774); config type plugin (792); never verbatim (812); other fields unchanged (822-840). Direct-path standalone (3983-4009). Mock keeps real manifestTypeFromDetected/buildManifestEntry (99-107) so seam genuinely exercised. Not over/under-tested.

CODE QUALITY: Conventions followed (Extract discriminant narrowing, conditional-spread factory, optional type keeps byte-identical shape). SOLID good (manifestTypeFromDetected pure total; buildAddEntry centralizes so standalone + collection can't drift). Complexity low (single ternary). Modern idioms (Extract anchors mapping → compile error on new variant). Readability good (doc comments).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
