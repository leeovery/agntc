TASK: configless-install-analysis-2-5 — selectAgents returns a discriminated { kind: "cancelled" } | { kind: "selected"; agents } result so cancellation and deliberate empty-selection are distinct at the type level; standalone caller emits a single accurate exit reason (no emit-then-overwrite); collection caller maps empty-selection to per-member skip.

ACCEPTANCE CRITERIA: selectAgents returns discriminated cancelled|selected; standalone emits exactly one accurate exit message (no "No agents selected — skipping" then "Cancelled — no agents selected"); collection-member skip preserved; npm test passes.

STATUS: Complete

SPEC CONTEXT: Agent Selection (constraint model, no-valid-constraint → all KNOWN_AGENTS pre-ticked always prompt); Collection per-plugin silent skip (no warning). Correctness/clarity fix on the seam: same [] return previously carried two meanings (Esc-cancel vs deliberate empty), surfaced standalone as contradictory emit-then-overwrite.

IMPLEMENTATION: Implemented. src/agent-select.ts:17-19 (SelectAgentsResult union), :23 (return type), :39 (auto-select → {kind:"selected",agents:[singleAgent]}), :56-58 (cancel → {kind:"cancelled"}), :64 (multiselect → {kind:"selected",agents:result}). Standalone caller add.ts:323-336; collection caller add.ts:597-610.
- In-helper "No agents selected — skipping" log fully removed (grep zero in src).
- Standalone (328-334) maps cancelled OR selected-with-agents.length===0 to single p.cancel("Cancelled — no agents selected") + ExitSignal(0). Emit-then-overwrite gone.
- Collection-member (605-609) maps cancelled OR agents.length===0 to bare continue — no copy/entry/warning/summary. Silent per-member skip preserved.
- Type-level distinctness: {kind:"cancelled"} carries no agents field. Narrowing (kind==="cancelled" || agents.length===0) sound (|| short-circuits before field access). No drift.

TESTS: Adequate. Unit (tests/agent-select.test.ts): cancel → cancelled declared (196) + no-declaration (159); zero-selection → selected/[] declared (207) + no-declaration (170) each asserting info NOT called with skipping; valid → selected (221); auto-select (232). Standalone (tests/commands/add.test.ts:3616-3656): "deliberate empty selection emits ONE coherent cancel message" asserts mockCancel once + info NOT called with skipping; cancelledSelection (Esc) path exit 0 + cleanup. Collection: cancelled member silently skipped siblings install (1251); zero-agents installs nothing no cancel (1223); silent-skip block (2362-2565). Helpers selected()/cancelledSelection (222-231) encode new shape, used pervasively (whole suite migrated). Behaviour-focused, negative assertions are load-bearing regression guards. Not over-tested.

CODE QUALITY: Conventions followed (discriminated union with literal kind discriminant, idiomatic; matches DetectedType/UpdateCheckResult style). SOLID good (helper returns outcome data, leaves messaging/exit to callers — removes prior responsibility leak). Complexity low. Modern idioms. Readability good (doc comments explain two-channel mapping).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
