TASK: configless-install-3-2 — Move agent resolution into the per-member collection loop; remove cross-member union (allDeclaredAgents + single top-level selectAgents) and post-union intersection; each member resolves independently via Phase 1 selectAgents.

ACCEPTANCE CRITERIA: selectAgents per retained member with declaredAgents=config?.agents ?? [] and shared detectedAgents; configless member → KNOWN_AGENTS default; config-bearing → declared ceiling, single declared+detected auto-selects; member resolving zero agents silently skipped (no copy/entry/warning/summary); each entry records only its agents; union + single top-level selectAgents removed; detectAgents called once.

STATUS: Complete

SPEC CONTEXT: Agent Selection (declared hard ceiling; auto-select only single-declared-detected; no-valid-constraint → all KNOWN_AGENTS pre-ticked always prompt); Collection Membership (per-child agents; config-bearing+configless coexist; no cross-member coupling). Phase 1 task 1-5 contract called per member.

IMPLEMENTATION: Implemented (no drift). src/commands/add.ts.
- detectAgents computed once before loop (525).
- Per-member config fetch pluginConfigs.get(pluginName) ?? null (546).
- Per-member selectAgents({declaredAgents: pluginConfig?.agents ?? [], detectedAgents}) inside loop after structural skips (597-600).
- Cancellation OR zero-resolution → silent continue (605-609).
- pluginAgents = pluginSelection.agents; pluginAgentDrivers built from it (610-614); carried into computeIncomingFiles (658-660), conflict checks, copy loop (692-722), manifest entry agents: result.agents (734-741).
- Grep: no allDeclaredAgents/declaredSet/intersection/union remain; only two selectAgents sites (standalone 323, per-member 597). selectAgents (src/agent-select.ts) returns discriminated cancelled|selected, auto-selects only declared-single-detected.

TESTS: Adequate. tests/commands/add.test.ts: per-member call own ceiling + shared detected, no union (1017, 2231 explicit no-union assertion); configless member KNOWN_AGENTS default declaredAgents:[] (1061); config-bearing single-declared-detected auto-selects (2254); mixed independent (2299); zero-agent silent skip no copy/entry (2408), absent from summary (2433,2516), no warning (2539), all-zero installs nothing no error (2452,2485); per-member entry records only its agents (2094,2127,2171); detectAgents once (1095); selectAgents twice for two members (1005,2237); cancellation → per-member silent skip siblings install (1251). Obsolete "called once for all plugins"/"union" tests removed (grep). Behaviour-focused.

CODE QUALITY: Conventions followed (discriminated SelectAgentsResult handling, ESM .js). SOLID good (resolution delegated to selectAgents; loop orchestrates). Complexity low/acceptable (one added guard in linear loop). Modern idioms (?.agents ?? [], union narrowing). Readability good (comments describe per-member contract + cancel/zero→silent-skip).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
