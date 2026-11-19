AGENT: standards
CYCLE: 3
STATUS: findings
FINDINGS_COUNT: 1

FINDINGS:

- FINDING: Inconsistent config-warning coverage for unusable-but-parseable config
  SEVERITY: low
  FILES: src/config.ts:41-62
  DESCRIPTION: readConfig returns null for typeof parsed !== "object" (e.g. a JSON scalar like "foo" or 42) WITHOUT invoking onWarn, whereas a JSON.parse failure DOES warn ("Ignoring malformed agntc.json"). Both are the same "well-formed JSON but not a usable config object" leniency case (spec lines 58, 289). Behaviour is spec-correct (lenient fallback, no error); only the warning surface is inconsistent — an author shipping a bare JSON scalar gets no diagnostic while a syntax error does. Not a behavioural conformance break.
  RECOMMENDATION: Optionally emit the same onWarn diagnostic when parsed is a non-object so all "config present but unusable" cases surface identically. The lenient fallback already conforms; this only aligns observability.

SUMMARY: Implementation conforms tightly to the spec on all high-impact decision points (structural detection, override precedence + type-vs-structure hard error, agent selection KNOWN_AGENTS default + scoped auto-select, manifest type optional + files-based backfill, derive-before-delete replay, copy-safety guards on add and update, partial-outcome non-zero exits). The cycle-2 high-severity skills-only-member bug did NOT resurface (fixed). One low-severity observability inconsistency only.
