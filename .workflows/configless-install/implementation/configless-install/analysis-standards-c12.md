AGENT: standards
CYCLE: 12
STATUS: findings
FINDINGS_COUNT: 1

FINDINGS:
- FINDING: TypeConflictError message attribution can misreport which override triggered the conflict when config `type: plugin` is set together with `--plugin`
  SEVERITY: low
  FILES: src/commands/add.ts:313-317
  DESCRIPTION: The code attributes the conflict to `--plugin` whenever `options.forcePlugin === true`, else to config `type: plugin`. This matches the spec's precedence (`--plugin` beats config `type`) and is correct for the common case. The only edge is a source carrying BOTH `--plugin` and config `type: plugin` against a non-bundleable structure: the message blames only the flag and never mentions the config also declared it. This is faithful to the precedence rule (the flag owns the tie), both message variants are accurate, exit non-zero, and name the source — so it is purely a wording nicety, NOT a behavioural drift or correctness gap. The agent explicitly states: "No change required for conformance."
  RECOMMENDATION: No change required. If maximal clarity is later desired, the flag-branch message could note "(config also declares type plugin)" when both are present.

SUMMARY: The implementation conforms to the specification on every load-bearing decision (structural type detection + precedence, recognised-`type` leniency/error boundary, dir-basename identity, manifest `type` field with files-based legacy backfill, KNOWN_AGENTS agent-selection fallback with no auto-select in the configless default, structural one-level collection membership, tagless→HEAD `ref: null` reuse, path-traversal + clone-root-boundary symlink guards pre-flight on add and update, derive-before-delete abort vs copy-safety block separation, per-unit partial-outcome non-zero exit) and to project TypeScript conventions. tsc clean; all 1521 tests pass. The single finding is a low-severity message-attribution nicety requiring no change — effectively a clean cycle.
