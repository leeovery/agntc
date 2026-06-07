TASK: configless-install-3-1 — Make runCollectionPipeline treat detected.plugins (structural member set) as authoritative; remove v1 config-presence couplings (pluginConfig===null skip + pluginConfigs.size===0 gate); read child config ONLY for agents; null config is legitimate configless state, never a skip reason.

ACCEPTANCE CRITERIA: null-config member no longer skipped for that reason; null skip branch + onWarn removed; size===0 'No valid plugins' gate removed; member excluded only by structural re-detect not-agntc/collection; config-bearing+configless coexist; per-child detectType {onWarn} no hasConfig; all-configless collection installs keyed owner/repo/<unit>.

STATUS: Complete

SPEC CONTEXT: Collection Membership & Selection Flow (structural membership replaces has-agntc.json; per-child agents: present constrains, absent → configless default, coexist); Backward-Compat (child config read only for agents). Correctly scoped — 3-2 owns per-member agents, 3-3 dead ConfigError catch, 3-4 nested warning.

IMPLEMENTATION: Implemented (all 7 criteria, no drift). src/commands/add.ts:506-590.
- Step 3 (515-521): member set = selectedPlugins; Map<string,AgntcConfig|null>; every member set with config-or-null, none dropped for null. pluginConfig===null skip + 'no agntc.json found' onWarn gone.
- size===0 'No valid plugins' ExitSignal(0) gate gone (grep zero occurrences of 'No valid plugins'/'no agntc.json found' in src).
- Step 5a (546): const pluginConfig = pluginConfigs.get(pluginName) ?? null; null read but never a skip reason. Only structural skips remain: not-agntc (570-579), collection (581-590).
- Per-child detectType (562-568): {onWarn, configType: pluginConfig?.type, forcePlugin: ...}, no hasConfig. (configType/forcePlugin additions owned by Phase 1 tasks 1-4/2-1, in-scope; load-bearing no-hasConfig holds.)
- pluginConfig?.agents ?? [] at 599 feeds per-member selectAgents. memberKey → owner/repo/<unit> (616,733,87-94).

TESTS: Adequate. tests/commands/add.test.ts collection block: invalid agntc.json no longer skips (1106) + missing no longer skips (1135) — assert different warning substrings ("skipping" vs "no agntc.json found"), each guards a distinct removed branch; all-skipped completes w/o error, no 'No valid plugins' (1188); not-agntc structural skip (1164,1304); per-child detectType not.toHaveProperty("hasConfig") + toHaveProperty("onWarn") (2703); all-configless keying exact owner/my-collection/pluginA,B (2734). Not over/under-tested; behaviour-level.

CODE QUALITY: Conventions followed (Map<string,AgntcConfig|null> idiomatic total-readConfig representation, no any). SOLID good (membership vs agent resolution cleanly separated — the point of the task; memberKey/buildAddEntry single-sourced). Complexity low (removing branches reduced it). Modern idioms (?? null, ?.type). Readability good (comments document null=configless member).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
