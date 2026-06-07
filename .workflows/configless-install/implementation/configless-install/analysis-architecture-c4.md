AGENT: architecture
CYCLE: 4
STATUS: findings
FINDINGS_COUNT: 2

FINDINGS:

- FINDING: Collection-member plugin classification overloads the --plugin installer-override channel
  SEVERITY: medium
  FILES: src/commands/add.ts:525-533, src/type-detection.ts:68-108, src/commands/add.ts:242-246
  DESCRIPTION: The collection pipeline classifies a skills-only member as a plugin by passing forcePlugin: memberHasAssetDirs into detectType. But forcePlugin models the user-supplied --plugin installer override — its conflict semantics ("the --plugin flag cannot bundle this source") and precedence-over-config-type meaning are tied to that origin. Here it is repurposed as a structural membership rule (spec Collection Membership: "a child with >=1 asset-kind dir is a plugin member"). Two distinct concepts — "installer forced bundling" vs "membership detection resolves a child's skills-only-ness to plugin" — now flow through one input. It works today only because the code pre-gates with memberHasAssetDirs to dodge the member-dirs hard-error path. The coupling is fragile: the TypeConflictError attribution in add.ts:242-246 (standalone catch) assumes options?.forcePlugin === true means "user passed the flag," so future changes to --plugin's conflict/precedence behaviour could affect member classification. (No current bug — the standalone catch and the member path are distinct, and memberHasAssetDirs gating prevents a member TypeConflictError — but the two concepts are coupled at one input.)
  RECOMMENDATION: Express member skills-only resolution as its own input — either a distinct DetectTypeOptions field for "resolve skills-only ambiguity as plugin (membership context)" separate from the user --plugin override, or map a skills-only child directly to a plugin member at the membership/qualifiesAsMember layer (which already knows the child has asset dirs) instead of round-tripping through detectType's override resolver.

- FINDING: detectType's standalone-only invariant is enforced by repeated caller discipline, not the type system
  SEVERITY: low
  FILES: src/commands/add.ts:527-555, src/copy-unit.ts:13-16, src/manifest.ts:59-63
  DESCRIPTION: detectType always returns the 4-arm DetectedType. The per-member call (add.ts:527) re-checks for not-agntc/collection and emits skip results, even though copy-unit.ts (StandaloneDetected = Extract<...>), manifestTypeFromDetected, and the add.ts:700 comment all already assert "only bare-skill | plugin reach copy/manifest." The narrowing fact is restated in three places but the detector never produces a narrowed result, so each consumer re-derives it at runtime. Benign (correct today), but the invariant rides on caller discipline rather than the signature.
  RECOMMENDATION: Optional/low. A thin detectStandaloneUnit (or membership-resolving) wrapper returning StandaloneDetected | NotAgntc would let the member path get a narrower result and type-enforce the copy/manifest invariant at the seam.

SUMMARY: Architecture composes cleanly overall — shared helpers (findPresentAssetDirs, toComputeInput/copyUnit, mapCloneFailure/failureMessage) are well-factored, failure-status unions are co-located with their mappers, and the symlink-boundary (clone root vs unit dir) is handled consistently across add/update. The one concern worth addressing is the collection pipeline routing member-type classification through the --plugin installer-override channel. No correctness bug.
