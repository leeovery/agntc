AGENT: duplication
FINDINGS: none
SUMMARY: No significant cross-file duplication detected. The nine implementation
files are already exceptionally deduplicated — prior cycles ran dedicated
consolidation tasks (triplicated GroupTarget projection collapsed into
groupTargetFacets; newest-tag and key→repo/basename helpers extracted; the
sourceSubpath containment guard single-sourced in resolveGuardedSourceDir; the
PluginOutcome success/failure mapping centralised in failedOutcome /
mapReinstallResultToOutcome / failureOrSkipMemberLine; the divergent-old flag
computed once in streamGroupWork and threaded to both header and member-line
renderers; the tag-vs-hash rule single-sourced in formatVersionMove). The
remaining structural parallelism between the singleton clone path
(cloneAndReinstall) and the grouped orchestrator (processGroupUpdate /
reinstallMember) is the spec's deliberately-preserved entry-point separation —
both compose the same already-extracted primitives (cloneRepoOnce,
resolveGuardedSourceDir, runPipeline, cleanupTempDir) — and is out of scope to
merge per the spec's "leave cloneAndReinstall as-is for the three singletons"
decision.

Only sub-threshold, non-actionable micro-candidates were observed, none of which
clears the fourth-cycle HIGH bar (each is at or below the "three similar lines"
Rule-of-Three floor, and some are pre-existing or intentional):

- A 6-line inline version-move type literal ({ oldRef; newRef; oldCommit;
  newCommit }) is repeated as the emitMemberLine `move` parameter
  (update.ts:902-907) and the MemberLineInput.move field (update-render.ts:196-201).
  Both are byte-identical and could share a named type, but this is a small type
  declaration, not repeated logic — below the extraction threshold.
- list.ts's formatLabel (list.ts:19-22) recomputes the ref/commit→label rule that
  the exported formatRefLabel (summary.ts:58-65) already owns, but this is a
  single ternary expression in pre-existing list-display code, not feature-plan
  scope.

Neither is worth the churn; reporting them would be manufacturing findings
against the stated HIGH bar.
