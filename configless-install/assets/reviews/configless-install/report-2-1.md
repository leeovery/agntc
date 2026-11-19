TASK: configless-install-2-1 — Collapse v1 config-gate + standalone path in runAdd into a single clone→read-config→detectType-once→branch flow; configless bare skill / multi-asset plugin installs standalone.

ACCEPTANCE CRITERIA: configless bare skill installs standalone (copy + manifest owner/repo, no cancel); configless multi-asset plugin via plugin copy; configless → selectAgents declaredAgents:[]; config-bearing → config.agents; collection still dispatches to pipeline; not-agntc fails pre-flight source-named ExitSignal(1); detectType called once with {onWarn,configType} no hasConfig; config-bearing unchanged; no ConfigError catch in standalone path.

STATUS: Complete

SPEC CONTEXT: Config Model (structure-authoritative; presence never signals type); Agent Selection ('No valid constraint' unified to KNOWN_AGENTS default, no hard errors for config); Overview/Error&Abort (not-agntc is loud pre-flight non-zero, distinct from clean cancel).

IMPLEMENTATION: Implemented (at converged later-refactored state vs literal 2-1 line numbers).
- src/commands/add.ts: single readConfig(unitDir,{onWarn}) 258-260; single detectType(unitDir,{onWarn,configType:config?.type,forcePlugin:options?.forcePlugin}) 265-271, before any branch, no hasConfig.
- Branch on detected.type: collection→runCollectionPipeline(...)+return (293-305); not-agntc→source-named p.cancel + throw ExitSignal(1) (307-313); else standalone tail (315+).
- declaredAgents: config?.agents ?? [] (325); config is AgntcConfig|null across path.
- Legacy config===null gate, "Not an agntc source" ExitSignal(0), "no agntc.json" cancel all gone (grep). 4 remaining ExitSignal(0) sites are unrelated clean aborts.
- Standalone copy/compute route through copyUnit/toComputeInput (src/copy-unit.ts) dispatching bare-skill→copyBareSkill, plugin→copyPluginAssets.

TESTS: Adequate. tests/commands/add.test.ts describe("configless standalone install") 607-842: bare skill standalone + key + no cancel (608); KNOWN_AGENTS default declaredAgents:[] (625); multi-asset plugin via copyPluginAssets (637); config-bearing ceiling (663); detectType once + no hasConfig property assertion (675); collection dispatch+return (698); configless not-agntc ExitSignal(1) source-named no addEntry/copy (713); config-bearing not-agntc (732); recorded-type sub-suite (746-841). Legacy ConfigError 'invalid config' test removed (grep zero matches). Not over/under-tested.

CODE QUALITY: Conventions followed (discriminated DetectedType exhaustive arms, Extract narrowing, why-comments). SOLID good (single detectType authority; copyUnit/toComputeInput single source; buildAddEntry centralised). Complexity acceptable (long but linear numbered steps, flat guards). Modern idioms. Readability good (branch order matches spec resolution order).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None. (ConfigError import absence is correct converged end state — Phase 3 removed all usage.)
