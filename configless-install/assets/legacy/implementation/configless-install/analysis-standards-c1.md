AGENT: standards
CYCLE: 1
STATUS: findings
FINDINGS_COUNT: 2

FINDINGS:
- FINDING: Dead `ConfigError` class contradicts the spec's lenient config-reading contract
  SEVERITY: low
  FILES: src/config.ts:17-22
  DESCRIPTION: The spec is explicit that config reading is fully lenient — "No hard errors for config problems" (Agent Selection) and "unparseable / unusable config → lenient (ignored)" (Config Model). readConfig correctly never throws for config problems. The exported ConfigError class is now unreachable dead code. Harmless at runtime, but invites a future caller to reintroduce a throwing path that would violate leniency, and documents an intent the code no longer has.
  RECOMMENDATION: Remove the unused ConfigError class (and its export) so the types reflect that config reading has no error path. If retained for an out-of-tree consumer, add a comment stating readConfig intentionally never throws it.

- FINDING: Internal `failed` labelling of the lenient no-agents skip mismatches the spec's posture
  SEVERITY: low
  FILES: src/nuke-reinstall-pipeline.ts:115-123, src/clone-reinstall.ts:258-264
  DESCRIPTION: The spec frames an update whose (present) config narrows to zero agents as a lenient skip, and observable behaviour conforms — single-key returns null (entry untouched, exit 0); all-updates emits a non-fatal skipped-no-agents. However runPipeline packages this as status:"failed", failureReason:"no-agents". Downstream mapCloneFailure.onNoAgents recovers the correct lenient behaviour, so this is a naming mismatch only, not a behavioural drift.
  RECOMMENDATION: Optional: surface no-agents under a non-failed status so the type mirrors the spec's "lenient skip, not a failure" intent. No behavioural change required.

SUMMARY: Implementation conforms to the specification on every load-bearing decision — structural type detection precedence and the skills-only/--plugin/config-type override resolution, the type-vs-structure hard-error path, manifest type field with files-based legacy backfill on read, derive-before-delete replay predicates per recorded type, the KNOWN_AGENTS agent-selection default with single-declared-agent auto-select only, tagless ref:null reuse, pre-flight path-traversal + symlink-escape guards (clone-root boundary, lexical broken-link handling) on both add and update, per-member collection independence with non-zero partial-failure exit, and agntc.json stripped from installed bare skills. Only two low-severity, non-behavioural cleanliness notes.
