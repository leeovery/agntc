TASK: configless-install-2-3 — Route a direct-path (tree URL) source's subpath through the standalone single-unit flow (detection/config/copy against join(sourceDir, parsed.targetPlugin)) instead of always deferring to the collection pipeline.

ACCEPTANCE CRITERIA: readConfig/detectType against join(sourceDir,targetPlugin) not root; tree-URL unit installs standalone keyed owner/repo/<subpath>, folder=subpath basename; agents from subpath config (config?.agents ?? [], else KNOWN_AGENTS); @ref suffix rejected by parseDirectPath (exit 1); --plugin orthogonal to selector; subpath not-agntc fails pre-flight source-named ExitSignal(1); existing direct-path key/files preserved via standalone route; no path-traversal check (deferred Phase 5).

STATUS: Complete

SPEC CONTEXT: Source selector grammar (tree URL = DirectPathSource, key owner/repo/<subpath>); Selector/--plugin orthogonality; Identity & Naming (basename); Manifest Keying (owner/repo/<unit-dir>); Error & Abort (not-agntc/--plugin pre-flight non-zero named); Copy-Safety (path-traversal deferred Phase 5).

IMPLEMENTATION: Implemented. src/commands/add.ts.
- unitDir = parsed.type==="direct-path" ? join(sourceDir,parsed.targetPlugin) : sourceDir (231-234), no-op for non-selector.
- readConfig(unitDir) 260; single detectType(unitDir,{onWarn,configType,forcePlugin}) 267-271.
- Collection-at-subpath dispatch passes sourceDir: unitDir, cloneRoot: sourceDir (293-303).
- not-agntc pre-flight source-named p.cancel + ExitSignal(1) (307-313).
- Copy receives sourceDir: unitDir (390-394; computeIncomingFiles 367-369). Manifest key = parsed.manifestKey (418).
- source-parser.ts unchanged (git clean): @ref rejection (154), targetPlugin/manifestKey derivation (186-189).
- Phase 5 copy-safety guards co-located (assertSubpathWithinClone 245-256, checkEscapingSymlinks 353-357) are later-phase additions; 2-3 correctly did not add a containment check.

TESTS: Adequate. tests/commands/add.test.ts describe("direct-path source (tree URL)") 3716-4010: readConfig/detectType against unitDir not root (explicit negative assertion 3785-3788); standalone install copy sourceDir=unitDir no multiselect; key owner/repo/<subpath> + basename folder; subpath agents; configless→KNOWN_AGENTS default; @ref rejected (exit 1 no install); --plugin bundles skills-only subpath; --plugin non-bundleable subpath hard error; not-agntc source-named exit 1 no write; multi-segment identity=last segment; recorded type skill/plugin. Reconciliation test 6061 (same key+files+no constraint via standalone). Behaviour-focused; explicit negative assertion guards regression.

CODE QUALITY: Conventions followed. SOLID good (unitDir single derived value reused by config/detect/copy, prevents drift; mirrors buildAddEntry/memberKey single-source helpers). Complexity low (one-line ternary + reuse standalone branch). Modern idioms (discriminated-union narrowing on parsed.type). Readability good (step-2b comment explains reroute + no-op).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None. (Co-located Phase 5 copy-safety code out of scope for 2-3, verified under its own task.)
