---
topic: configless-install
cycle: 5
total_proposed: 1
---
# Analysis Tasks: configless-install (Cycle 5)

standards + architecture returned clean. One grouped LOW consolidation task from the 2 duplication findings (both behaviour-preserving residues in add.ts/runCollectionPipeline sharing the same drift risk).

## Task 1: Consolidate add.ts manifest-entry literal and collection member-key ternary
status: approved
severity: low
sources: duplication

**Problem**: src/commands/add.ts carries two behaviour-preserving duplications, both at risk of silent drift:
1. The same buildManifestEntry({ ref, commit, agents, files, type: manifestTypeFromDetected(...), cloneUrl: deriveCloneUrlForManifest(parsed), constraint }) literal is hand-authored in two places — the standalone install tail (step 13, lines 369-377, using selectedAgents / copiedFiles / detected / resolvedConstraint) and the collection per-member write loop (step 6, lines 700-708, using result.agents / result.copiedFiles / result.detectedType / constraint). Identical seven-field shape and identical helper calls; a field addition must be mirrored in both.
2. The collection member-key ternary `parsed.type === "direct-path" ? parsed.manifestKey : \`${parsed.manifestKey}/${pluginName}\`` is authored twice inside runCollectionPipeline — once as pluginManifestKey for the conflict/nuke pass (5a, lines 576-579) and again as manifestKey in the write loop (step 6, lines 696-699), the latter reconstructing from result.pluginName rather than reusing the 5a value. The keying rule lives in two places and could drift.

**Solution**: Extract the field assembly into one small local helper and compute the member key once, then reference both from the two call sites. Pure consolidation — no behavioural change.

**Outcome**: The manifest-entry field shape is owned in one place in add.ts (a single helper), and the collection member-key rule is computed once and reused. Adding a manifest field or changing the direct-path keying rule requires editing exactly one location. All existing add/collection tests pass unchanged.

**Do**:
1. Add a small local helper in src/commands/add.ts (e.g. buildAddEntry) that owns the buildManifestEntry({...}) field assembly plus the manifestTypeFromDetected(...) and deriveCloneUrlForManifest(parsed) calls, parameterised by the differing inputs (detected/detectedType, agents, files, parsed, commit, constraint).
2. Replace the standalone install-tail literal (currently lines 369-377) with a call to the new helper, passing detected, selectedAgents, copiedFiles, parsed, commit, resolvedConstraint.
3. Replace the collection write-loop literal (currently lines 700-708) with a call to the new helper, passing result.detectedType, result.agents, result.copiedFiles, parsed, commit, constraint.
4. For the member-key duplication: compute the key once — either carry the already-computed pluginManifestKey (5a, lines 576-579) through to the write loop (via the per-member result/pluginsToInstall), or extract a tiny memberKey(parsed, pluginName) helper used in both 5a and step 6 (lines 696-699). Ensure the write loop no longer independently reconstructs the key from result.pluginName using a separately-authored ternary.
5. Keep the surrounding step sequencing, comments, and ordering intact — change only the duplicated field-assembly and key-derivation expressions.

**Acceptance Criteria**:
- The buildManifestEntry({...}) literal appears at exactly one site in add.ts (inside the new helper); both former call sites invoke it.
- The direct-path-vs-`{manifestKey}/{name}` member-key ternary is authored at exactly one site; both the 5a conflict/nuke pass and the step-6 write loop reference that single source.
- Resulting manifest entries and keys are byte-for-byte identical to current behaviour for both the standalone and collection install paths (same fields, same values, same key strings).
- No new public exports or signature changes outside add.ts; helpers stay local to the module.
- npm test passes with no test modifications required.

**Tests**:
- Existing standalone-add tests (manifest entry written with correct ref/commit/agents/files/type/cloneUrl/constraint) pass unchanged.
- Existing collection-pipeline tests (per-member manifest entries and member keys for both direct-path and non-direct-path sources) pass unchanged.
- If member-key derivation is consolidated by carrying the 5a value forward, confirm via the collection direct-path test that the write-loop key matches the conflict/nuke-pass key (no divergence).
