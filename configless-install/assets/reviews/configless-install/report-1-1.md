TASK: configless-install-1-1 — Make readConfig lenient: only outcomes are a usable AgntcConfig ({agents, type?}) or null.

ACCEPTANCE CRITERIA: lenient readConfig (null for missing/malformed/non-object/no-usable-agents-and-no-type); returns {agents,type?} for ≥1 known agent with per-unknown warning + raw type passthrough; retains type-only config as {agents:[],type}; ignores unknown keys; non-ENOENT IO error propagates (not ConfigError); config-bearing behaviour preserved.

STATUS: Complete

SPEC CONTEXT: Config Model (lenient reading; type raw, recognition deferred to detection 1-4; unknown keys ignored); Agent Selection (absent/empty/malformed unify to KNOWN_AGENTS default — empty agents = no restriction); Structural Type Detection (type:plugin reserved for skills-only bundle).

IMPLEMENTATION:
- Status: Implemented. src/config.ts:6-9 (AgntcConfig = { agents: AgentId[]; type?: string }, type kept raw); :17-62 (readConfig); :64-84 (filterKnownAgents).
- JSON.parse failure (config.ts:36-39) warns "Ignoring malformed agntc.json: <detail>", returns null. Non-object branch (:41-43) returns null. Three-way resolution (:50-61): filtered>0 → agents + conditional type spread; else rawType present → {agents:[],type}; else null.
- rawType = typeof type === "string" ? type : undefined (:48) — non-string type does not rescue a no-agents config.
- ENOENT→null; non-ENOENT re-thrown raw (:27-30), unwrapped, exact instance preserved.
- Benign converged drift: ConfigError removed entirely (not left exported as the task's build-safety note said). Deliberate later cleanup (analysis-standards-c1 flagged dead class); spec-consistent, build green (no remaining importer). Not a regression.

TESTS:
- Status: Adequate. tests/config.test.ts.
- Covers every AC/edge: ENOENT→null; known-agent happy paths; malformed→null+warn (incl no-onWarn variant); no-usable-config→null variants; unknown-agent filter + per-agent warn + order; EACCES raw-instance assertion; type-only/type-bearing retention; optional type; unrecognised type verbatim; unknown keys ignored; non-string type→null.
- Not under/over-tested; asserts return value/warn behaviour, not internals; minimal fs-boundary mocking.

CODE QUALITY:
- Project conventions: Followed (node: imports, .js ESM, import type).
- SOLID: Good (single responsibility; agent filtering extracted; onWarn injected).
- Complexity: Low. Modern idioms: Yes (conditional spread, Set, typeof narrowing). Readability: Good.

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [idea] src/config.ts:75-81 — filterKnownAgents silently drops non-string array entries (e.g. agents:[123,"claude"]) with no warning, while unknown strings warn. Decide whether a malformed non-string entry should also warn; spec silent — judgment call.
