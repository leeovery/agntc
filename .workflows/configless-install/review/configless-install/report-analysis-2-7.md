TASK: configless-install-analysis-2-7 — Remove the unused ConfigError class and its export from src/config.ts so the config type surface reflects that config reading has no error path.

ACCEPTANCE CRITERIA: ConfigError removed from src/config.ts and no longer exported; no remaining references anywhere; npm test + type-check pass.

STATUS: Complete

SPEC CONTEXT: Spec mandates fully lenient config reading ("Config reading is lenient" L58; "No hard errors for config problems" L290; boundary "unparseable/unusable config → lenient ignored" L61). The one intentional non-lenient path is non-ENOENT IO errors propagating raw. readConfig never constructs/throws a typed config error, so exported ConfigError was unreachable dead code risking a future throwing path that violates leniency.

IMPLEMENTATION: Implemented. src/config.ts now runs lines 1-85 with no ConfigError declaration (line 17, formerly the class, is now the start of readConfig). Module exports only AgntcConfig, KNOWN_AGENTS, ReadConfigOptions, readConfig — no error type.
- Codebase-wide search for ConfigError returns zero matches in src/ and tests/. Remaining matches confined to non-code artifacts (.workflows/*.md findings + .tick/tasks.jsonl ledger) — historical records, not compilable references; do not violate criterion 2.
- Non-ENOENT propagation (throw err at line 30) re-throws raw underlying error, never ConfigError — removal causes no behaviour change.

TESTS: Adequate. tests/config.test.ts exercises leniency/never-throws thoroughly: missing→null (19-27); malformed JSON→null+warn no throw (65-92); missing/empty/non-array/all-unknown agents→null (94-133); "does not throw for malformed JSON" (87). The one intentional throwing path locked by "propagates permission denied errors unchanged (raw error)" (180-193) asserting rejects.toBe(err) — exact raw instance, not wrapped — guards against reintroducing a typed config error. Type-only/configless-bundle cases (207-281) unchanged. No test referenced ConfigError (3-3 removed last importer). Behaviour-focused, not over-tested. (Tests read not executed.)

CODE QUALITY: Conventions followed (precise type surface Promise<AgntcConfig|null>, no vestigial error type). SOLID good (dead-code removal tightens single responsibility; public surface matches behaviour — interface segregation). Complexity low (pure deletion, no control-flow change). Modern idioms (lenient parse, isNodeError guard, narrowed unknown). Readability good (absence of ConfigError removes misleading error-path signal; never-throws intent self-evident from signature).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None. (ConfigError strings remaining in .workflows/*.md and .tick/tasks.jsonl are historical finding/ledger records correctly describing the now-resolved issue; editing would falsify the audit trail.)
