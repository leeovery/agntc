AGENT: standards
CYCLE: 4
STATUS: findings
FINDINGS_COUNT: 1

FINDINGS:

- FINDING: check-failed exit-status diverges between single-key and all-plugins update
  SEVERITY: low
  FILES: src/commands/update.ts:136-139, src/commands/update.ts:620-628
  DESCRIPTION: The spec's exit-status contract (Error & Abort Behaviour → Partial outcomes) scopes non-zero exit to units that "hard-errored or aborted." In single-key update, check-failed throws ExitSignal(1) (fatal); in all-plugins mode check-failed is rendered as a warn summary and excluded from hasFailedOutcome, so the command exits zero. The two paths apply opposite exit semantics to the same transient condition. A check failure is neither the spec's type-conflict hard-error nor a derive-before-delete abort, so the all-mode non-fatal treatment is the more defensible reading — but the single-key path contradicts it. Borderline because the spec doesn't explicitly classify check failures. (Same single-key-vs-all-updates exit-asymmetry class noted (and left pre-existing/out-of-scope) at task 4-7.)
  RECOMMENDATION: Align both paths to one interpretation. Per the spec scoping non-zero to hard-errors/aborts, downgrade the single-key check-failed to a non-fatal warn-and-skip to match all-mode; or, if intended fatal, add check-failed to the all-mode non-zero set. Identical conditions should produce identical exit codes.

SUMMARY: Implementation conforms to the spec and project conventions on every major decision point (structural detection, override precedence, type-vs-structure hard errors, KNOWN_AGENTS default, manifest type + backfill, derive-before-delete replay, tagless ref reuse, path-traversal + symlink guards on add and update, post-copy agntc.json deletion, per-member collection independence with deferred non-zero exit). One low-severity exit-status inconsistency for the spec-unenumerated check-failed case between the two update paths. No correctness bugs.
