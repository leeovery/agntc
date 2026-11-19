AGENT: architecture
CYCLE: 2
STATUS: findings
FINDINGS_COUNT: 3

FINDINGS:

- FINDING: Collection-member install result typed with the full DetectedType union, forcing a runtime narrowing guard
  SEVERITY: medium
  FILES: src/summary.ts:101-109, src/commands/add.ts:702-709, src/commands/add.ts:636-643
  DESCRIPTION: PluginInstallResult.detectedType is typed DetectedType? (full bare-skill|plugin|collection|not-agntc union), but by construction every installed collection member resolves to exactly bare-skill|plugin — the per-member loop filters collection and not-agntc to "skipped" before a result can be pushed as "installed". Because the declared type is wider than the values that can flow through it, the manifest-build loop re-proves the invariant at runtime: add.ts:702-709 reads result.detectedType?.type then throws "Installed collection member … is missing a resolved type". The pluginsToInstall staging array already narrows correctly (Extract<DetectedType, { type: "bare-skill" | "plugin" }> at add.ts:499); only the shared PluginInstallResult shape widens it back out.
  RECOMMENDATION: Narrow PluginInstallResult.detectedType to Extract<DetectedType, { type: "bare-skill" | "plugin" }> (matching pluginsToInstall) and make it required on installed results (or split into installed vs skipped/failed variants). The runtime throw at add.ts:705-709 then becomes statically impossible and deletable.

- FINDING: manifestTypeFromDetected widens its input to a bare string-literal union when callers hold the exact DetectedType variant
  SEVERITY: low
  FILES: src/manifest.ts:57-61, src/commands/add.ts:378, src/commands/add.ts:719
  DESCRIPTION: manifestTypeFromDetected(t: "bare-skill" | "plugin") maps structural type to manifest "skill" | "plugin". Both call sites hold a fully-narrowed DetectedType discriminant. The helper accepts a bare string-literal union rather than the discriminated DetectedType variant, so the DetectedType↔ManifestEntry.type relationship is expressed twice and a future third structural variant would not surface a compile error here.
  RECOMMENDATION: Accept the narrowed variant directly — manifestTypeFromDetected(t: Extract<DetectedType, { type: "bare-skill" | "plugin" }>) keyed on t.type — anchoring the mapping to the DetectedType union. Pairs with the first finding.

- FINDING: selectAgents collapses cancellation and deliberate empty-selection to the same [], producing a lossy seam and a contradictory log/exit message
  SEVERITY: low
  FILES: src/agent-select.ts:45-54, src/commands/add.ts:275-278
  DESCRIPTION: selectAgents returns [] both on prompt cancel (isCancel -> []) and on a deliberate empty multiselect (length === 0 -> []), logging "No agents selected — skipping" only in the latter. The standalone runAdd caller (add.ts:275-278) maps any [] to p.cancel("Cancelled — no agents selected") + ExitSignal(0), so the empty-selection path emits "No agents selected — skipping" then is immediately overwritten by a contradictory "Cancelled — no agents selected". The collection caller treats [] as a silent per-member skip (spec-mandated) — same return value, two different meanings. Benign today (both standalone outcomes are non-error exits), but lossy.
  RECOMMENDATION: Return a discriminated result ({ kind: "cancelled" } | { kind: "selected"; agents: AgentId[] }) so each caller maps the cases to its own channel. Removes the emit-then-overwrite log and makes the standalone exit reason accurate.

SUMMARY: The reinstall seam and derive-before-delete replay are well-composed, and cycle 1's path-traversal ordering, integration-coverage, and redundant-discriminator findings are all resolved. Remaining issues are type-precision at the collection-member result seam (an over-wide DetectedType forcing a runtime narrowing throw) and a lossy [] return from selectAgents conflating cancel with empty-selection.
