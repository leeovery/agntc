---
topic: update-check-fails-on-branch-ref
cycle: 1
total_findings: 5
deduplicated_findings: 3
proposed_tasks: 1
---
# Analysis Report: update-check-fails-on-branch-ref (Cycle 1)

## Summary
The bugfix (replacing the lexical `isTagRef` classifier with a remote-truth `ls-remote` probe) is clean and correctly scoped: the standards agent found zero deviations, and duplication (3) and architecture (2) raised only low-severity polish. After dedup, five raw findings collapse to three distinct items — two of them corroborated by both the duplication and architecture agents. One item (the resolved-sha comparison now authored twice inside `update-check.ts`) is self-contained, stays within the bugfix's own file, and directly remediates duplication the change introduced, so it becomes a proposed task. The remaining two are discarded as scope-expanding polish that would reach into the stable `git-utils.ts` module or edit pre-existing catch sites the bugfix never touched.

## Discarded Findings
- **ls-remote line-parse primitive / parser scattering** (duplication #2 + architecture #2) — Consolidating the `sha\trefpath` tokenisation or colocating the three parsers requires editing `git-utils.ts` (`parseTagRefs`) and restructuring the module's public surface. Both agents explicitly flag it as optional and "not required for correctness / cleanup for the next time this module is touched." The spec deliberately confined the change to `update-check.ts` and sanctioned a separate classifier; this crosses into a stable shared module and is out of the bugfix's scope.
- **catch-to-check-failed translation repeated a fourth time** (duplication #3) — The duplication agent's own lowest-priority item; the block is described as small, idiomatic, and consistent with the file's established convention (the new copy matches three pre-existing ones). Extracting `toCheckFailed` would require editing the catch sites of `checkHead`, `checkTag`, and `checkConstrained` — code the bugfix did not touch — to remove drift risk on an idiomatic three-line block. Not worth expanding the blast radius for a tight bugfix.
