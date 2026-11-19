TASK: configless-install-1-5 — Replace selectAgents' empty-declaration `return []` footgun with a prompt over all KNOWN_AGENTS (detected pre-ticked, always prompt, never auto-select in this path); declared hard ceiling and single-declared-detected auto-select unchanged.

ACCEPTANCE CRITERIA: no declaration → multiselect over all KNOWN_AGENTS, detected pre-ticked, always prompt (no auto-select even with one detected); valid declaration → options exactly declared (hard ceiling); single declared+detected → auto-select; cancel/zero-selection → [] semantics.

STATUS: Complete

SPEC CONTEXT: Agent Selection (261-300). Configless delta: source candidates from KNOWN_AGENTS when no valid declaration, replacing return [] footgun; pre-tick, always prompt, no auto-select in no-constraint default; auto-select scoped strictly to declared-single-detected. Caller wiring + three-case unification are Phase 2. KNOWN_AGENTS order ["claude","codex","cursor"] (config.ts:11).

NOTE (not drift): live code returns discriminated SelectAgentsResult ({kind:"cancelled"} | {kind:"selected";agents}) per later task analysis-2-5 (planning.md:181), applied on top of 1-5. Reviewed tree is post-analysis; 1-5 assessed against equivalent union semantics (cancel→cancelled; zero-selection→selected/[] no info log). Behavioural intent of 1-5 fully preserved.

IMPLEMENTATION: Implemented — src/agent-select.ts:21-65.
- KNOWN_AGENTS imported from ./config.js (2). hasDeclaration/candidates derivation (24-27); old return [] guard removed.
- Auto-select gated on hasDeclaration && candidates.length===1 && singleAgent && detectedSet.has(singleAgent) (32-37) — hasDeclaration guard = spec-mandated protection; no-declaration path never auto-selects.
- initialValues = candidates ∩ detected (42, preserves candidate order); options with "(not detected in project)" label (44-47); multiselect/isCancel/selected unchanged (49-64).

TESTS: Adequate — tests/agent-select.test.ts. Every AC+edge mapped: all-KNOWN_AGENTS offered (91); detected pre-ticked (105); never-auto-selects-with-one-detected asserting multiselect WAS called (117); returns user pick (129); undetected-label hint (140); cancel (159) + zero-selection/no-info-log (170); prompts-instead-of-early-return (302); retained declared hard-ceiling/label (21,34,47,62,77), single-declared auto-select+log (232,242), multi-declared prompt (269,280,291), declared cancel/zero/valid (196,207,221). Behaviour not internals; no over/under-testing.

CODE QUALITY: Conventions followed (tabs, .js, import type, as const spread). SOLID good; complexity low (one short-circuit, linear); modern idioms (Set lookups, spread of readonly tuple, discriminated union); readability good (hasDeclaration names guarded invariant).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
