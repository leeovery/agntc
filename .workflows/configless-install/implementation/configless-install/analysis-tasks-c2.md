---
topic: configless-install
cycle: 2
total_proposed: 7
---
# Analysis Tasks: Configless-Install (Cycle 2)

## Task 1: Skills-only collection member is silently skipped at install instead of installing as a plugin member
status: approved
severity: high
sources: standards

**Problem**: A skills-only child dir (only a `skills/` asset dir, no SKILL.md) is correctly enumerated as a collection member — `qualifiesAsMember` returns true because `findPresentAssetDirs(childDir).length > 0` (src/type-detection.ts:201-206) — and therefore appears in the pickable member list. But at install time the per-member loop re-runs the ROOT `detectType(pluginDir, { onWarn })` with NO override (src/commands/add.ts:513). For a skills-only dir that detector hits the root-level skills-only ambiguity and, with no `wantsPlugin`, returns `{ type: "collection" }` (src/type-detection.ts:92-96). add.ts:528 then treats that as a nested collection and pushes `status: "skipped"` with `"nested collections not supported"`. Net result: a structurally-valid skills-only collection member is offered for selection, then silently dropped at install — it never installs, contradicting the spec's "Collection Membership & Selection Flow → Membership" rule that any child with >=1 asset-kind dir is a plugin member. A member-level `type: plugin` config is also never consulted because the per-member `detectType` receives no `configType`. Existing unit tests mask the bug by mocking `detectType` to return a plugin result directly for the skills-dir member (tests/commands/add.test.ts:1276-1282, 1305-1311), so the real skills-only → collection → skip path is never exercised.

**Solution**: At the collection level, resolve a skills-only child to a plugin member rather than letting the root skills-only ambiguity default it to collection. Per the spec's membership rule, any child with >=1 asset-kind dir is a plugin member, so the per-member detection must bundle skills-only as a plugin (pass the member-level forcePlugin/`wantsPlugin` equivalent, or feed the member's resolved config type into `detectType`). Preserve the genuine nested-collection skip only for children that resolve to an actual members-collection.

**Outcome**: A skills-only collection member that the user selects installs as a plugin member (its `skills/` assets copied for the selected agents and recorded in the manifest), exactly as the spec requires. The "nested collections not supported" skip fires only for children whose structure is genuinely a members-collection. The skills-only member path is covered by a test using a real member dir, not a mocked detection result.

**Do**:
1. In src/commands/add.ts:513, change the per-member detection so a skills-only child resolves to a plugin member. Pass the member-level plugin resolution into `detectType` (the `forcePlugin` override, or the member's config `type`) so skills-only returns `{ type: "plugin", assetDirs: ["skills"] }` instead of `{ type: "collection" }`. Keep the existing not-agntc skip and the genuine-collection skip for children whose structure is `members`.
2. Ensure a member-bearing `agntc.json` with `type: plugin` is honoured for the member (per-member `detectType` must receive the member's `configType`, currently null/absent). Read the member's own config for this.
3. Verify the downstream member install (selectAgents → computeIncomingFiles → copy → manifest record) runs unchanged for the now-plugin member.
4. Add a collection-install test that uses a REAL skills-only member dir (a child containing only `skills/`), NOT a mocked `detectType` plugin result, asserting the member installs (files copied, manifest entry written) rather than being skipped.
5. Confirm a child that genuinely resolves to a members-collection still produces the "nested collections not supported — skipping" skip.

**Acceptance Criteria**:
- A selected skills-only collection member installs as a plugin member: its skills assets are copied for the selected agents and a manifest entry is recorded.
- A member-level `type: plugin` config is consulted during per-member detection.
- A child whose structure is a members-collection is still skipped with "nested collections not supported — skipping".
- A not-agntc child is still skipped with the existing message.

**Tests**:
- New collection-install test with a real skills-only member dir (no `detectType` mock) asserting the member installs (copied files + manifest entry), replacing/augmenting the mocked-plugin coverage at tests/commands/add.test.ts:1276-1282, 1305-1311.
- Test asserting a member-level `type: plugin` config drives the member's install.
- Regression test asserting a genuine nested members-collection child is still skipped.

## Task 2: Tighten the collection-member result type seam to eliminate the runtime narrowing throw
status: approved
severity: medium
sources: architecture

**Problem**: `PluginInstallResult.detectedType` is typed as the full `DetectedType` union (`bare-skill | plugin | collection | not-agntc`, optional), but by construction every installed collection member resolves to exactly `bare-skill | plugin` — the per-member loop filters `collection` and `not-agntc` to `"skipped"` before any result is pushed as `"installed"`. Because the declared type is wider than the values that can flow through it, the manifest-build loop re-proves the invariant at runtime: src/commands/add.ts:702-709 reads `result.detectedType?.type` and throws `"Installed collection member … is missing a resolved type"`. The `pluginsToInstall` staging array already narrows correctly to `Extract<DetectedType, { type: "bare-skill" | "plugin" }>` at add.ts:499; only the shared `PluginInstallResult` shape widens it back out. Relatedly, `manifestTypeFromDetected(t: "bare-skill" | "plugin")` (src/manifest.ts:57-61) accepts a bare string-literal union rather than the discriminated `DetectedType` variant, even though both call sites (add.ts:378, add.ts:719) hold a fully-narrowed `DetectedType` discriminant — so the `DetectedType` ↔ `ManifestEntry.type` relationship is expressed twice and a future third structural variant would not surface a compile error. The two are the same seam.

**Solution**: Narrow `PluginInstallResult.detectedType` to `Extract<DetectedType, { type: "bare-skill" | "plugin" }>` (matching `pluginsToInstall`) and make it required on installed results (or split into installed vs skipped/failed variants). Then change `manifestTypeFromDetected` to accept the narrowed `DetectedType` variant and key on `t.type`.

**Outcome**: The runtime throw at add.ts:705-709 becomes statically impossible and is deleted. The collection-member result type matches the values that actually flow through it, and the `DetectedType` → manifest-type mapping is expressed once and anchored to the union so a future structural variant produces a compile error rather than silent acceptance.

**Do**:
1. Change `PluginInstallResult.detectedType` to `Extract<DetectedType, { type: "bare-skill" | "plugin" }>` and make it required on the installed variant (split the result union into installed vs skipped/failed if the optionality is otherwise needed).
2. Delete the now-unreachable runtime narrowing throw at src/commands/add.ts:702-709.
3. Change `manifestTypeFromDetected` (src/manifest.ts:57-61) to accept `Extract<DetectedType, { type: "bare-skill" | "plugin" }>` and key on `t.type`.
4. Update the two call sites (src/commands/add.ts:378, add.ts:719) to pass the narrowed variant directly.
5. Run the type-checker and test suite.

**Acceptance Criteria**:
- `PluginInstallResult.detectedType` (installed variant) is typed `Extract<DetectedType, { type: "bare-skill" | "plugin" }>` and required.
- The "Installed collection member … is missing a resolved type" runtime throw is removed.
- `manifestTypeFromDetected` accepts the discriminated `DetectedType` variant keyed on `t.type`.
- `npm test` and the type-check pass.

**Tests**:
- Existing collection-install and manifest tests pass unchanged (behaviour preserved).
- Type-check passes with no `any`/cast escape hatches introduced at the narrowed seam.

## Task 3: Extract a single copyUnit / unit-descriptor helper for the plugin-vs-bare-skill dispatch
status: approved
severity: medium
sources: duplication

**Problem**: The plugin-vs-bare-skill copy dispatch is authored twice inside add.ts. The standalone install path (src/commands/add.ts:343-359) and the collection-member install loop (src/commands/add.ts:656-685) each branch `detected.type === "plugin"` → `copyPluginAssets({ sourceDir, assetDirs, agents, projectDir })` else `copyBareSkill({ sourceDir, projectDir, agents })`, then assemble `copiedFiles`/`assetCountsByAgent` the same way. The same two-arm shape is also encoded a third time when building the discriminated `ComputeInput` for `computeIncomingFiles`: both paths use the identical `detected.type === "plugin" ? { type:"plugin", sourceDir, assetDirs, agents } : { type:"bare-skill", sourceDir, agents }` mapping (src/commands/add.ts:313-322 and add.ts:603-616). A change to either arm must be made in multiple places.

**Solution**: Extract a single `copyUnit(detected, { sourceDir, agents, projectDir })` helper that owns the plugin/bare-skill branch and returns `{ copiedFiles, assetCountsByAgent? }`, and fold the `computeIncomingFiles` input mapping into the same descriptor (or a small shared `toComputeInput(detected, sourceDir, agents)`). Call both from the standalone path and the collection-member loop. The nuke-reinstall replay functions stay separate but may consume the same `copyUnit`.

**Outcome**: The plugin/bare-skill copy dispatch and the compute-input mapping each exist once, consumed by both install paths. Adding or changing an arm is a single-site edit. Install behaviour for both paths is unchanged.

**Do**:
1. Add `copyUnit(detected, { sourceDir, agents, projectDir })` (co-located with the existing copy helpers) branching on `detected.type` to call `copyPluginAssets` or `copyBareSkill`, returning `{ copiedFiles, assetCountsByAgent? }`.
2. Add a shared `toComputeInput(detected, sourceDir, agents)` (or fold into the same descriptor) producing the discriminated `ComputeInput`.
3. Replace the standalone path's inline dispatch (add.ts:343-359) and compute-input ternary (add.ts:313-322).
4. Replace the collection-member loop's inline dispatch (add.ts:656-685) and compute-input ternary (add.ts:603-616).
5. Leave the nuke-reinstall replay functions as-is (optionally routing their copy step through `copyUnit`).
6. Run the test suite.

**Acceptance Criteria**:
- The plugin/bare-skill copy dispatch exists in exactly one helper, called from both add.ts install paths.
- The `computeIncomingFiles` input mapping exists in exactly one place, used by both paths.
- Standalone and collection-member install behaviour is unchanged.
- `npm test` passes.

**Tests**:
- Existing standalone-install and collection-install tests pass unchanged.
- Coverage exercising both the plugin and bare-skill arms through the shared helper.

## Task 4: Extract an isCloneReinstallFailure type-guard for the four-site non-success guard
status: approved
severity: low
sources: duplication

**Problem**: All four reinstall entry points open with the identical 3-term guard `result.status === "failed" || result.status === "aborted" || result.status === "no-agents"` immediately before delegating to `mapCloneFailure` — at src/commands/update.ts:209-213, src/commands/update.ts:300-304, src/commands/list-update-action.ts:51-55, and src/commands/list-change-version-action.ts:102-106. The failure-status set is duplicated four times and lives apart from `mapCloneFailure`; a future non-success status would require editing all four sites.

**Solution**: Add an `isCloneReinstallFailure(result): result is <failure-union>` type-guard next to `mapCloneFailure` in clone-reinstall.ts, co-locating the failure-set definition with its mapper, and use it at all four sites.

**Outcome**: The clone-reinstall failure-set is defined once alongside `mapCloneFailure`. The four call sites narrow via the guard, and adding a new non-success status is a single-site change that propagates to all callers.

**Do**:
1. Add `isCloneReinstallFailure(result)` in src/clone-reinstall.ts beside `mapCloneFailure`, narrowing to the failure union (`failed | aborted | no-agents`).
2. Replace the inline 3-term guards at the four sites with calls to the guard.
3. Confirm `mapCloneFailure` receives the narrowed type at each site.
4. Run the test suite.

**Acceptance Criteria**:
- The clone-reinstall failure-set is defined once, co-located with `mapCloneFailure`.
- All four reinstall entry points use `isCloneReinstallFailure` instead of the inline 3-term guard.
- Behaviour at each site is unchanged.
- `npm test` passes.

**Tests**:
- Existing update / list-update / list-change-version failure-path tests pass unchanged.

## Task 5: selectAgents must distinguish cancellation from deliberate empty-selection
status: approved
severity: low
sources: architecture

**Problem**: `selectAgents` returns `[]` both on prompt cancel (`isCancel -> []`) and on a deliberate empty multiselect (`length === 0 -> []`), logging `"No agents selected — skipping"` only in the latter (src/agent-select.ts:45-54). The standalone `runAdd` caller (src/commands/add.ts:275-278) maps any `[]` to `p.cancel("Cancelled — no agents selected")` + `ExitSignal(0)`, so the empty-selection path emits `"No agents selected — skipping"` then is immediately overwritten by the contradictory `"Cancelled — no agents selected"`. The collection caller treats `[]` as a silent per-member skip (spec-mandated) — the same return value carries two different meanings, a lossy seam.

**Solution**: Return a discriminated result (`{ kind: "cancelled" } | { kind: "selected"; agents: AgentId[] }`) so each caller maps the two cases to its own channel.

**Outcome**: Cancellation and empty-selection are distinct at the type level. The standalone caller emits a single accurate exit reason (no emit-then-overwrite); the collection caller maps empty-selection to its per-member skip without conflation.

**Do**:
1. Change `selectAgents` (src/agent-select.ts:45-54) to return `{ kind: "cancelled" } | { kind: "selected"; agents: AgentId[] }`; remove the in-helper "No agents selected — skipping" log if the caller now owns messaging.
2. Update the standalone caller (add.ts:275-278) to map `cancelled` to the cancel/ExitSignal path with a single accurate message, and `selected` (incl. empty agents, if reachable) to its own outcome.
3. Update the collection-member caller to map the discriminated result to its per-member skip behaviour.
4. Run the test suite; update assertions tied to the old `[]`-return and the emit-then-overwrite log.

**Acceptance Criteria**:
- `selectAgents` returns a discriminated `{ kind: "cancelled" } | { kind: "selected"; agents }` result.
- The standalone path emits exactly one, accurate exit message (no "No agents selected — skipping" followed by "Cancelled — no agents selected").
- The collection-member path's skip behaviour is preserved.
- `npm test` passes.

**Tests**:
- Standalone cancellation emits the single cancel message and exits 0.
- A deliberate empty-selection no longer emits a contradictory pair of messages.
- Collection-member empty-selection still results in the per-member skip.

## Task 6: Type-conflict error message must not attribute a --plugin-flag conflict to a config "type plugin" declaration
status: approved
severity: low
sources: standards

**Problem**: The single `TypeConflictError` handler emits `${parsed.manifestKey} declares type plugin but ${err.message}` (src/commands/add.ts:230-238). `detectType` raises `TypeConflictError` for BOTH override inputs — a config `type: plugin` AND the `--plugin` installer flag. When the user passed `--plugin` on a bare skill or members-collection (no config type at all), the message wrongly attributes the conflict to a declared config type. The spec (Error & Abort → Hard errors) requires the message to "name the offending source/unit and what conflicted"; mis-attributing the source is an accuracy regression. The behaviour (non-zero pre-flight exit) is correct.

**Solution**: Distinguish the two override origins in the message, driven by whether `options.forcePlugin` (the `--plugin` flag) versus `config.type === "plugin"` triggered the conflict — e.g. "the --plugin flag cannot bundle …" vs "declares type plugin but …".

**Outcome**: A type-vs-structure conflict caused by the `--plugin` flag names the flag as the offending source; a conflict caused by a config `type: plugin` declaration names the config. The pre-flight non-zero exit is unchanged.

**Do**:
1. At the `TypeConflictError` handler (add.ts:230-238), branch the message on whether `options.forcePlugin` or `config.type === "plugin"` was the override that triggered the conflict.
2. Emit a flag-attributed message when `--plugin` caused it and a config-attributed message when the config did.
3. Keep the existing exit behaviour.
4. Add/adjust tests for both attribution paths.

**Acceptance Criteria**:
- A `--plugin`-flag conflict on a bare skill / members-collection produces a message attributing the conflict to the flag (not to a config "type plugin" declaration).
- A config `type: plugin` conflict still produces the config-attributed message.
- The non-zero pre-flight exit is unchanged for both.

**Tests**:
- `--plugin` on a bare skill yields the flag-attributed message and a non-zero exit.
- A config `type: plugin` on a conflicting structure yields the config-attributed message and a non-zero exit.

## Task 7: Remove the dead ConfigError class
status: approved
severity: low
sources: standards

**Problem**: The exported `ConfigError` class (src/config.ts:17-22) is unreachable dead code. The spec mandates fully lenient config reading and `readConfig` correctly never throws, so nothing constructs or catches `ConfigError`. It was flagged in cycle 1 and discarded, then re-surfaced in cycle 2 — the recurrence signals a persistent dead-code surface on the lenient-config contract. Harmless at runtime, but it invites a future caller to reintroduce a throwing path that would violate leniency.

**Solution**: Remove the unused `ConfigError` class and its export so the config type surface reflects that config reading has no error path.

**Outcome**: `ConfigError` no longer exists in the codebase; the config module exposes no error type, accurately reflecting the never-throws contract. No behaviour changes.

**Do**:
1. Delete the `ConfigError` class and its export at src/config.ts:17-22.
2. Search for and remove any imports/references to `ConfigError` (there should be none — task 3-3 removed the last importer).
3. Run the type-checker and test suite.

**Acceptance Criteria**:
- `ConfigError` is removed from src/config.ts and is no longer exported.
- No remaining references to `ConfigError` exist in the codebase.
- `npm test` and the type-check pass.

**Tests**:
- Type-check / build passes with the class removed.
- Existing config-reading tests (leniency, never-throws) pass unchanged.
