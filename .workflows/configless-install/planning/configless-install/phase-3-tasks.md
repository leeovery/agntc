---
phase: 3
phase_name: Structural collection membership and selection
total: 6
---

## configless-install-3-1 | approved

### Task configless-install-3-1: Structural member enumeration without config dependency

**Problem**: `runCollectionPipeline` (`src/commands/add.ts` ~348–634) still enumerates installable members by the v1 "has `agntc.json`" rule. Two places encode it: step-3 reads each selected child's config and **skips any child whose `readConfig` returns `null`** (`pluginConfig === null` → `onWarn("... no agntc.json found — skipping")` → `continue`, ~389–392), and a `pluginConfigs.size === 0` gate exits the run when no child carried config (~407–410). Under configless, members carry no config, so every configless member is wrongly skipped and an all-configless collection exits installing nothing. Membership must instead come from **structural detection per child** — exactly the `detected.plugins` list Phase 1 (`qualifiesAsMember`) already produces — with config read only for agents, never as a gate on membership.

**Solution**: Make the pipeline treat the *selected* member names (already drawn from `detected.plugins`, which Phase 1 populates structurally via `qualifiesAsMember`) as the authoritative member set. Remove the config-presence skip and the `pluginConfigs.size === 0` gate. Read each selected child's config **only to obtain its (optional) declared agents**; a `null` config is the legitimate configless state, not a skip reason. A member is dropped *only* when its own structural re-detection (`detectType` against the child dir) returns `not-agntc` or `collection` (those skips are owned by tasks 3-3/3-4) — never because config is absent. Update the per-child `detectType` call to the Phase 1 options shape (drop `hasConfig`). This task removes the config-as-membership coupling; per-member *agent resolution* (replacing the single union prompt) is task 3-2 and builds directly on the member set this task establishes.

**Outcome**: A collection whose members are all configless (`refero_skill`-style bare-skill members, configless plugin members) enumerates and installs the selected members; an all-configless collection no longer exits with "No valid plugins to install." A mixed collection (some members with `agntc.json`, some without) installs both kinds — config presence neither adds nor removes a member. A member is excluded from install only when its structural re-detect yields `not-agntc`/`collection`, not when its config is `null`. `detectType` is called per child with `{ onWarn }` (no `hasConfig`).

**Do**:
- In `src/commands/add.ts` `runCollectionPipeline`, **delete the `pluginConfig === null` skip** in the step-3 loop (~389–392): `if (pluginConfig === null) { onWarn(\`${pluginName}: no agntc.json found — skipping\`); continue; }`. A `null` config is now retained as "configless member, agents default to `KNOWN_AGENTS`."
- Rework the step-3 loop so it no longer treats config presence as membership. The member set is `selectedPlugins` (from `detected.plugins` / the selector). For each selected member, read its config for agents only: store the result as `AgntcConfig | null` per member (e.g. a `Map<string, AgntcConfig | null>` or keep configs keyed by member name with `null` allowed). Do **not** drop a member for a `null` config.
- **Delete the `pluginConfigs.size === 0` gate** (~407–410): `if (pluginConfigs.size === 0) { p.log.warn("No valid plugins to install"); throw new ExitSignal(0); }`. With structural membership, "no members" is already handled upstream — `selectCollectionPlugins` returning `[]` (~375–378) and the direct-path "not in collection" error (~362–366) cover the empty/absent cases. (An empty `detected.plugins` cannot reach this point: Phase 1 returns `not-agntc` rather than an empty-member collection, and the standalone dispatch in task 2-1 only enters the pipeline for `type: "collection"`.)
- Change the per-child `detectType` call (~451) from `detectType(pluginDir, { hasConfig: true, onWarn })` to `detectType(pluginDir, { onWarn })` — Phase 1 (task 1-2) dropped `hasConfig`; the child detection is the same single structural path used at root, applied one level down. Keep this call (it is the structural re-detect that confirms a selected member still resolves to an installable unit and feeds the `not-agntc`/`collection` skips owned by 3-3/3-4 and 3-4 respectively).
- Adjust the step-5a per-plugin loop's config lookup (~439–448): the `pluginConfigs.get(pluginName)` retrieval and the `if (!pluginConfig) { ...skipped... }` guard currently treat "no config" as "skip." Replace that guard's *semantics* so a member retained with a `null` config is **not** skipped here — it proceeds to install with the configless agent default. (The actual per-member agent computation moves to task 3-2; in this task, ensure the loop no longer pushes a `skipped` result purely because config is `null`. Retain skip results only for the genuine structural skips — `not-agntc` ~456–465, `collection` ~467–476 — which stay as-is until 3-4 adjusts the nested-collection warning.)
- Leave the per-plugin manifest keying (~488–491), conflict checks (~524–540), and copy loop (~552–602) untouched in this task — they are agnostic to whether config was present.
- Do **not** modify `src/type-detection.ts` — `detected.plugins` and `qualifiesAsMember` are consumed as built in Phase 1, not re-touched.

**Acceptance Criteria**:
- [ ] A selected member whose `readConfig` returns `null` is **no longer skipped** for that reason — it installs with the configless agent default (verified end-to-end once 3-2 lands; in this task verified by the absence of a config-presence skip / `skipped` result and the absence of the "no agntc.json found — skipping" warning).
- [ ] The `pluginConfig === null` skip branch and its `onWarn("... no agntc.json found — skipping")` are removed.
- [ ] The `pluginConfigs.size === 0` → "No valid plugins to install" gate is removed; an all-configless collection does not exit `0` with that message.
- [ ] A member is excluded from install **only** when its structural re-detect (`detectType` on the child dir) returns `not-agntc` or `collection` — not when its config is `null`.
- [ ] Config-bearing and configless members coexist: a collection with one `agntc.json`-bearing child and one configless child enumerates and installs both.
- [ ] The per-child `detectType` is called with `{ onWarn }` and **no** `hasConfig` property.
- [ ] An all-configless collection installs its selected members (each keyed `owner/repo/<unit>`).

**Tests** (rewrite the affected cases in `tests/commands/add.test.ts` `collection type` describe, ~545–1597; the v1 setups stub per-child `readConfig` → a config object and assert config-presence skips — those must be reworked to allow `null`):
- `"installs configless members (null per-child config no longer skipped)"` — per-child `readConfig` → `null` for both members, per-child `detectType` → `bare-skill`; assert both members copied and `addEntry` called for `owner/my-collection/pluginA` and `.../pluginB`, and **no** "no agntc.json found — skipping" warning.
- `"an all-configless collection no longer exits with 'No valid plugins to install'"` — all per-child `readConfig` → `null`; assert the run installs members and does **not** `p.log.warn("No valid plugins to install")` nor `ExitSignal(0)` on that path.
- `"config-bearing and configless members coexist"` — pluginA `readConfig` → `{ agents: ["claude"] }`, pluginB → `null`; assert both enumerate and install.
- `"a member is dropped only by structural re-detect, not by missing config"` — pluginA configless + `detectType` → `bare-skill` (installs); pluginB configless + `detectType` → `not-agntc` (skipped). Assert pluginA installs, pluginB is skipped for the structural reason, and the skip is **not** attributed to missing config.
- `"per-child detectType uses the Phase 1 options shape (no hasConfig)"` — assert every per-child `detectType` call's options arg lacks `hasConfig` and includes `onWarn`.
- Rewrite `setupCollectionBareSkills` and the per-plugin/zero-match setups (~589–610, ~1219–1259, ~1439–1478) so per-child `readConfig` may return `null` (configless) without the test expecting a skip; assertions about config-presence skipping are removed.

**Edge Cases**:
- Configless member (`null` config) → retained, installs with the configless default (3-2).
- Mixed config-bearing + configless members → both enumerate.
- Member dropped by structural re-detect (`not-agntc`/`collection`) → still skipped (owned by 3-3/3-4), but never for a `null` config.
- All-configless collection → installs members; no "No valid plugins" exit.

**Context**:
> Spec — *Collection Membership & Selection Flow → Decision*: "Collection membership = 'a child dir that structurally resolves to a unit.' Recurse the same structural detection one level down; drive selection with the existing prompt + source-string selector. No flags."
> Spec — *Membership (structural, one level down)*: "For each immediate child dir, run the *same* structural detection used at the root: child has `SKILL.md` → bare-skill member; child has asset-kind dirs → plugin member; child has neither → skip it. The pickable list comes from this structural scan, **replacing** the 'has `agntc.json`' enumeration."
> Spec — *Per-child agents*: "child config present → constrains, per the *Agent Selection* rules. child config absent → the configless default (all `KNOWN_AGENTS`, installer picks). Config-bearing and configless members coexist in one collection."
> Spec — *Backward-Compat → Collection pipeline's child-`agntc.json` dependency*: "membership comes from structural detection per child; child config is read only for agents when present."
> Phase 1 contract: `detected.plugins` is populated structurally via `qualifiesAsMember`; `detectType(dir, { onWarn })` is the single structural path (`hasConfig` removed). Phase 2 (task 2-1) left `runCollectionPipeline` untouched and kept the `ConfigError` import alive only for this pipeline's still-live reference (removed in task 3-3).
> Scope: per-member *agent resolution* (replacing the single union prompt) is task 3-2; the dead `ConfigError` catch is task 3-3; the nested-collection warning wording is task 3-4. This task establishes the structural member set and removes the config-presence membership coupling only.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Collection Membership & Selection Flow*, *Backward-Compat / Migration & Config Schema*.

---

## configless-install-3-2 | approved

### Task configless-install-3-2: Per-member agent resolution replacing the union prompt

**Problem**: The pipeline today computes a **union of declared agents across all selected members** and runs `selectAgents` **once** over that union (`allDeclaredAgents` set + single `selectAgents({ declaredAgents: [...allDeclaredAgents], ... })`, ~382–417), then intersects each member's declared set against the single picked list (`declaredSet` filter, ~479–481). This union model cannot express the configless per-member contract: a configless member must default to **all `KNOWN_AGENTS`** while a config-bearing sibling keeps its **declared ceiling**, and each must auto-select or prompt per its own declaration. A union prompt collapses both into one list and has no way to offer `KNOWN_AGENTS` to the configless member without also offering them to a Claude-only member. The union also breaks the "declared-single-detected auto-select" rule per member. Agent resolution must move *inside* the per-member loop so each member resolves its agents independently via the Phase 1 `selectAgents` rules.

**Solution**: Remove the union (`allDeclaredAgents`) and the single top-level `selectAgents` call. Move agent resolution into the per-member loop: for each retained member, call `selectAgents({ declaredAgents: memberConfig?.agents ?? [], detectedAgents })` — a config-bearing member passes its declared ceiling (Phase 1 honours it, auto-selecting a single-declared-detected agent); a configless member passes `[]`, which Phase 1 resolves to the `KNOWN_AGENTS` default (pre-tick detected, always prompt). A member whose resolution yields **zero agents** (declared ceiling with no detected/selected match, or user deselects all) is **silently skipped** — no copy, no manifest entry, no warning — preserving the existing per-plugin silent-skip behaviour but now driven by each member's own resolution rather than a post-union intersection. `detectAgents` is still called once (it is project-state, member-independent); only `selectAgents` moves per-member. The per-member install (keying, conflict checks, copy) consumes each member's own resolved agent list and records exactly those agents in its manifest entry.

**Outcome**: In a collection, a configless member sources the `KNOWN_AGENTS` default (offered all three, detected pre-ticked, user picks) while a Claude-only member offers only Claude (auto-selecting if Claude is the single declared+detected agent) — each independently. A member resolving to zero agents is silently dropped (no copy, no entry, no warning, absent from summary). Each member's manifest entry records only that member's resolved agents. The single union prompt (`allDeclaredAgents` + one `selectAgents`) is gone.

**Do**:
- **Depends on task 3-1** (the structural member set and `AgntcConfig | null` per-member configs). Build on the loop 3-1 established.
- In `src/commands/add.ts` `runCollectionPipeline`, **remove** the `allDeclaredAgents` set and the union population (~383, ~394–396) and the single top-level `selectAgents` call + its zero-selection cancel (~412–422). `detectAgents(projectDir)` stays (it is member-independent); compute `detectedAgents` once before the per-member loop.
- Inside the per-member loop (the step-5a loop ~438–550, after the structural `not-agntc`/`collection` skips), resolve agents per member: `const memberConfig = pluginConfigs.get(pluginName) ?? null; const memberAgents = await selectAgents({ declaredAgents: memberConfig?.agents ?? [], detectedAgents });`. A `null`/absent config yields `declaredAgents: []` → Phase 1's `KNOWN_AGENTS` default; a present config yields its declared ceiling.
- **Replace** the post-union intersection filter (~479–481): `const declaredSet = new Set(pluginConfig.agents); const pluginAgents = selectedAgents.filter(...)` becomes simply `const pluginAgents = memberAgents;` (the resolution already applied the ceiling/default). **Silent skip on zero**: keep the `if (pluginAgents.length === 0) continue;` guard (~481) — a member that resolves to zero agents is silently skipped (no `skipped` result pushed, no warning), exactly as today. This now covers both "declared ceiling matched nothing" and "user deselected all in the configless default."
- Build `pluginAgentDrivers` from `pluginAgents` (unchanged, ~482–485), and carry `pluginAgents` into `computeIncomingFiles` (~509–522), the conflict checks, the copy loop (~552–602), and the manifest entry (`agents: result.agents`, ~616) — all already consume the per-member `pluginAgents`; only its *source* changes (per-member resolution instead of union-filter).
- **Auto-select / prompt cadence**: because `selectAgents` is now called per member, a collection with two config-bearing members may prompt twice (once each, unless each auto-selects). This is the correct per-member contract (the spec resolves agents per member). Tests that asserted "`selectAgents` called exactly once" for a collection (~706–715, ~1426–1435) must be rewritten to assert per-member resolution.
- Do **not** reintroduce any union or cross-member coupling; each member's resolution is independent.

**Acceptance Criteria**:
- [ ] `selectAgents` is called **per retained member**, with `declaredAgents` = that member's `config?.agents ?? []` and the shared `detectedAgents`.
- [ ] A configless member (`null` config) passes `declaredAgents: []`, sourcing the `KNOWN_AGENTS` default (offered all three, detected pre-ticked, always prompted — no auto-select).
- [ ] A config-bearing member passes its declared ceiling; a single declared+detected agent auto-selects for that member (Phase 1 behaviour, per member).
- [ ] A member resolving to **zero agents** is silently skipped: no copy, no manifest entry, no warning, absent from the summary.
- [ ] Each member's manifest entry records **only that member's** resolved agents.
- [ ] The union (`allDeclaredAgents`) and the single top-level `selectAgents` call are removed; resolution is fully per-member.
- [ ] `detectAgents` is still called once (member-independent).

**Tests** (rewrite the union/filtering/zero-match suites in `tests/commands/add.test.ts`: `per-plugin agent filtering` ~1218–1436 and `silent skip for plugins with zero applicable agents` ~1438–1597 — these assert the v1 union prompt + post-union filter and must reflect per-member resolution):
- `"resolves agents per member (selectAgents called once per retained member)"` — two members; assert `selectAgents` called with each member's own `declaredAgents`.
- `"a configless member sources the KNOWN_AGENTS default"` — member config `null`; assert `selectAgents` called with `declaredAgents: []` for that member.
- `"a config-bearing member keeps its declared ceiling"` — member config `{ agents: ["claude"] }`; assert `selectAgents` called with `declaredAgents: ["claude"]` for that member.
- `"mixed members resolve agents independently"` — pluginA `null` (→ `[]`), pluginB `{ agents: ["codex"] }` (→ `["codex"]`); assert two `selectAgents` calls with the respective `declaredAgents`, and each member installs/records its own resolved agents.
- `"a member resolving to zero agents is silently skipped"` — member's `selectAgents` resolves `[]`; assert no copy, no `addEntry`, no warning, member absent from summary. (Replaces the v1 zero-applicable-agents intersection tests ~1480–1608.)
- `"declared-single-detected member auto-selects without prompting"` — member `{ agents: ["claude"] }`, detected `["claude"]`; assert that member installs claude (auto-select path, via the per-member `selectAgents`).
- `"per-member manifest records only its agents"` — pluginA → `["claude"]`, pluginB → `["codex"]`; assert each `addEntry` records only that member's agents (preserves the intent of ~1289–1308, rerouted through per-member resolution).
- Remove/rewrite `"agent multiselect called once for all plugins"` (~706) and `"selectAgents still called with union of all declared agents across plugins"` (~1426) — both assert the obsolete union model.

**Edge Cases**:
- Configless member → `KNOWN_AGENTS` default, always prompts (no auto-select).
- Config-bearing single-declared-detected member → auto-selects (no prompt) for that member.
- Mixed members → independent resolution; one may auto-select while another prompts.
- Member resolves to zero agents (ceiling unmet, or user deselects all) → silent skip, no warning, absent from summary.
- All members resolve to zero → nothing installs, no error (the run completes; summary shows the collection header with no plugin blocks).

**Context**:
> Spec — *Collection Membership & Selection Flow → Per-child agents*: "child config present → constrains, per the *Agent Selection* rules. child config absent → the configless default (all `KNOWN_AGENTS`, installer picks). Config-bearing and configless members coexist in one collection."
> Spec — *Agent Selection → Constraint model (unchanged)*: "Declared agents are a hard ceiling... Auto-select when a single declared agent is detected. **Per-plugin silent skip** in collections — undeclared agents are dropped per-plugin during copy, no warning."
> Spec — *Agent Selection → Decision*: "Valid, non-empty `agents` → hard ceiling. No valid constraint → offer all `KNOWN_AGENTS`, pre-tick detected, user picks." Per-member, a `null` config is "no valid constraint."
> Spec — *Agent detection signal and auto-select interaction*: "Auto-select stays scoped to the declared-single-agent case only... The configless default never auto-selects even if exactly one agent is detected."
> Phase 1 contract (task 1-5): `selectAgents({ declaredAgents: [], detectedAgents })` offers all `KNOWN_AGENTS` (pre-tick detected, always prompt); a valid non-empty `declaredAgents` is a ceiling with single-declared-detected auto-select; cancel/zero-selection returns `[]`. This task calls that contract per member.
> Phase 3 dependency: builds on task 3-1's structural member set and per-member `AgntcConfig | null` configs.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Collection Membership & Selection Flow*, *Agent Selection*.

---

## configless-install-3-3 | approved

### Task configless-install-3-3: Remove dead ConfigError handling from the collection pipeline

**Problem**: The collection pipeline's step-3 loop wraps each child `readConfig` in a `try/catch (err) { if (err instanceof ConfigError) { onWarn("... — skipping"); continue; } throw err; }` (~397–403). Phase 1 (task 1-1) made `readConfig` **lenient** — it never throws `ConfigError` (malformed JSON, missing/empty `agents`, all-unknown agents all return `null`). The catch is therefore dead: `ConfigError` can never be thrown from `readConfig`, so the branch is unreachable and the `ConfigError` import in `src/commands/add.ts` (~line 10) is kept alive only by this one dead reference (Phase 2 task 2-1 deliberately left it for Phase 3 to remove). Leaving dead error-handling around config reading is misleading — it implies a config problem can abort a member, contradicting the configless leniency contract.

**Solution**: Remove the dead `try/catch (ConfigError)` wrapper around the child `readConfig` in the pipeline, leaving a plain `await readConfig(pluginDir, { onWarn })` (which returns `AgntcConfig | null`). Once no live `ConfigError` reference remains in `add.ts`, drop `ConfigError` from the `import { ConfigError, readConfig } from "../config.js"` so the import surfaces only what is used. Verify via grep that no other `ConfigError` reference survives in the file before removing it. Keep the `ConfigError` class itself exported from `src/config.ts` if any *other* module still imports it (it is no longer thrown by `readConfig`, but the class definition is out of scope to delete here).

**Solution ordering note**: This task removes dead code and depends on nothing in tasks 3-1/3-2 functionally, but it **should land after 3-1 and 3-2** because both rework the same step-3/step-5a region of `runCollectionPipeline`; sequencing it last avoids merge churn against the lines those tasks edit. (3-1 already removes the `null`-config skip that sat immediately above this catch; this task removes the catch wrapper and the now-orphaned import.)

**Do**:
- In `src/commands/add.ts` `runCollectionPipeline` step-3 loop, **remove the `try { ... } catch (err) { if (err instanceof ConfigError) {...} throw err; }`** wrapper (~387–403) around the child `readConfig`. Replace with the plain call: `const pluginConfig = await readConfig(pluginDir, { onWarn });` storing the `AgntcConfig | null` result for that member (consistent with task 3-1's per-member config map allowing `null`). There is no error path to catch — `readConfig` is total over its inputs (returns `null` for any unusable config; only a genuine non-ENOENT IO error propagates, and that *should* abort the run, so it must **not** be swallowed — do not add a catch for it).
- After removing the catch, `grep "ConfigError"` in `src/commands/add.ts`. If no reference remains, change the import (~line 10) from `import { ConfigError, readConfig } from "../config.js";` to `import { readConfig } from "../config.js";`.
- Do **not** delete the `ConfigError` class or its export from `src/config.ts` in this task — only stop importing it here. (Whether the class is dead project-wide is a separate concern; this task scopes to `add.ts`.)
- Run the type-checker/build and full suite to confirm the import removal and dead-branch deletion are clean (no unused-import lint, no broken reference).
- Note: a genuine filesystem failure on a child `readConfig` (e.g. `EACCES`) still propagates out of the loop to `runAdd`'s outer `catch` (~321–326), which renders the message and exits 1 — unchanged. Removing the `ConfigError` catch does **not** change IO-error behaviour; it only deletes an unreachable branch.

**Acceptance Criteria**:
- [ ] The `try/catch (ConfigError)` wrapper around the child `readConfig` is removed; the call is a plain `await readConfig(pluginDir, { onWarn })`.
- [ ] No `ConfigError` reference remains in `src/commands/add.ts`; the import drops `ConfigError`, importing only `readConfig` from `../config.js`.
- [ ] A genuine non-ENOENT IO error from a child `readConfig` still propagates (is not swallowed) and surfaces via `runAdd`'s outer catch as exit 1 — unchanged.
- [ ] The build/type-check passes with no unused-import or unreachable-code warnings; the full test suite stays green.

**Tests** (`tests/commands/add.test.ts`):
- Remove the obsolete `ConfigError`-throwing collection test path (the `pluginC` `ConfigError` → skipped case at ~1184–1214): under lenient `readConfig` a member's config is never a `ConfigError`. Replace its intent — "a member with an unusable config is not aborted" — with a test that a member whose `readConfig` returns `null` (configless / formerly-malformed) installs via the configless default (this overlaps 3-1/3-2; keep one clear assertion that no `ConfigError`-driven skip exists).
- `"a child IO error still propagates (not swallowed by a ConfigError catch)"` — per-child `readConfig` rejects with a non-`ConfigError` error (e.g. `Object.assign(new Error("EACCES"), { code: "EACCES" })`); assert the run surfaces it via the outer catch as `ExitSignal(1)` and writes no manifest.
- Confirm (via the existing suite) no test still constructs/imports `ConfigError` for the collection path; remove the `ConfigError` import from the test file if it becomes unused there.

**Edge Cases**:
- Child config malformed → `readConfig` returns `null` (lenient), member installs configless — no `ConfigError`, no skip.
- Child `readConfig` non-ENOENT IO error → propagates to outer catch, exit 1 (unchanged; not swallowed).
- Import removal only when no `ConfigError` reference remains (grep-gated).

**Context**:
> Spec — *Config Model → Recognised `type` values and the leniency-vs-error boundary*: "Config *reading* is lenient. A missing `agntc.json`, a syntactically malformed one, or one missing/empty `agents` is treated as 'no usable config' — no error... (This changes today's `readConfig`, which throws on parse failure / missing `agents`.)"
> Spec — *Agent Selection → "No valid constraint" — unified across three cases*: "config absent, config present but `agents: []`, config malformed... **No hard errors for config problems** — config reading treats parse failures as 'no usable config' and falls back to the default."
> Phase 1 contract (task 1-1): `readConfig` returns `AgntcConfig | null` and **never throws `ConfigError`**; only a genuine non-ENOENT IO error propagates. Phase 2 (task 2-1) kept the `ConfigError` import in `add.ts` alive solely for this pipeline catch, deferring its removal to Phase 3.
> Ordering: lands after 3-1/3-2 (which rework the same loop) to minimise churn; functionally independent of them.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Config Model*, *Agent Selection*.

---

## configless-install-3-4 | approved

### Task configless-install-3-4: Nested-collection member skipped with a pipeline warning (one level only)

**Problem**: Nested collections are unsupported: a collection member that is itself a collection must not be recursed into. Phase 1's detector already enforces "one level down" at *detection* (`qualifiesAsMember` returns false for a child that only resolves via *its* grandchildren, so such a child is never even listed in `detected.plugins`). But the *pipeline* has its own second-level guard: it re-runs `detectType` on each selected member (~451) and, if a member re-detects as `collection` (~467–476), skips it with `onWarn("... nested collections not supported — skipping")`. This pipeline-level skip must survive the Phase 3 rework intact — it is the runtime backstop for a selector (tree-path URL) pointing at a member dir that *does* structurally resolve to a collection, and for the case where a member's own children make it a collection at re-detect time. The warning must be emitted by the **pipeline**, not the detector (the detector stays silent per Phase 1 task 1-3), and a nested-collection member must be skipped **without stopping its sibling members**.

**Solution**: Preserve the per-member structural re-detect (`detectType(pluginDir, { onWarn })`, now without `hasConfig` per task 3-1) and keep the `pluginDetected.type === "collection"` branch that emits the pipeline warning and pushes a `skipped` result — confirming it remains correct after 3-1/3-2 reshape the loop. A member re-detecting as `collection` is skipped with the warning; siblings continue (the per-member loop already isolates failures — each member is independent). Recursion goes exactly one level: the pipeline never re-enters `runCollectionPipeline` for a nested-collection member; it simply skips it. The `not-agntc` re-detect branch (~456–465) similarly skips with its own warning and is retained.

**Outcome**: A collection where one member dir is itself a collection (e.g. reached via a tree-path selector, or a member whose own children make it collection-shaped) skips that member with a clear "nested collections not supported — skipping" warning and installs the remaining members normally. A member re-detecting as `not-agntc` is likewise skipped with its warning. The warning originates in the pipeline (not the detector). No recursion beyond one level occurs.

**Do**:
- **Depends on tasks 3-1/3-2** (the reshaped loop and per-member config/agent handling). Land after them.
- In `src/commands/add.ts` `runCollectionPipeline`, **keep** the per-member structural re-detect and the two skip branches, confirming they sit correctly in the post-3-1/3-2 loop:
  - `not-agntc` branch (~456–465): `onWarn(\`${pluginName}: not a valid agntc plugin — skipping\`)` + push `{ status: "skipped", ... }` + `continue`. Retain.
  - `collection` branch (~467–476): `onWarn(\`${pluginName}: nested collections not supported — skipping\`)` + push `{ status: "skipped", ... }` + `continue`. Retain — this is the one-level-only nested-collection backstop.
- Ensure the warning is emitted by the **pipeline** via `onWarn`, not by `detectType` (Phase 1 task 1-3 left the detector silent on nested-collection skips; do not add a detector warning).
- Confirm sibling isolation: the per-member loop `continue`s past a skipped nested-collection member and proceeds to the next member; a skipped member does not throw or abort the run. (The existing loop structure already provides this; verify it holds after 3-1/3-2.)
- Ensure **one-level-only**: the pipeline must **not** call `runCollectionPipeline` (or otherwise recurse) for a member that re-detects as `collection`. It skips it. (No recursive dispatch exists today; confirm none is introduced.)
- The skipped nested-collection/`not-agntc` members appear in the per-member summary as `skipped` (via `renderCollectionAddSummary`, `src/summary.ts` ~118+, which already renders a "skipped" count) — unchanged.

**Acceptance Criteria**:
- [ ] A selected member that re-detects as `collection` is skipped with the pipeline warning "`<member>`: nested collections not supported — skipping" and pushed as a `skipped` result.
- [ ] Sibling members of a skipped nested-collection member still install (the skip does not abort the run).
- [ ] A selected member that re-detects as `not-agntc` is skipped with "`<member>`: not a valid agntc plugin — skipping".
- [ ] The nested-collection warning is emitted by the pipeline (`onWarn`), not by `detectType`.
- [ ] Recursion is one level only: the pipeline does **not** re-enter `runCollectionPipeline` for a nested-collection member.
- [ ] Skipped members are reflected as `skipped` in the collection summary.

**Tests** (`tests/commands/add.test.ts`, `collection type` describe — adapt the existing nested-collection/`not-agntc` skip cases to the reshaped loop):
- `"skips a nested-collection member with a pipeline warning and installs siblings"` — pluginA re-detects `bare-skill` (installs), pluginB re-detects `{ type: "collection", plugins: [...] }`; assert pluginB skipped, `onWarn` called with "nested collections not supported — skipping", pluginA copied + `addEntry` for `owner/my-collection/pluginA`, and `runCollectionPipeline` **not** re-entered for pluginB (assert only the expected copy/entry counts).
- `"skips a member that re-detects as not-agntc"` — pluginB re-detects `not-agntc`; assert skip + warning + sibling install.
- `"the nested-collection warning comes from the pipeline, not the detector"` — assert the `onWarn` message originates in the pipeline path (the mocked `detectType` does not itself warn).
- `"recursion is one level only (no re-entry for a nested-collection member)"` — assert no second pipeline pass / no extra `selectCollectionPlugins` call for the nested member.
- Confirm the summary shows the skipped member in the `skipped` count (assert outro contains the skipped reflection).

**Edge Cases**:
- Member re-detects `collection` → skipped with warning; siblings install; no recursion.
- Member re-detects `not-agntc` → skipped with its warning; siblings install.
- Selector (tree-path URL) pointing at a member that is itself a collection → same skip + warning (the pipeline backstop catches it at re-detect).
- All members nested-collection/`not-agntc` → all skipped, nothing installs, no error (summary shows skips).

**Context**:
> Spec — *Collection Membership & Selection Flow → Nested collections*: "Remain **unsupported** — a collection member that is itself a collection is not recursed into. Membership detection goes exactly **one level** down."
> Spec — *Manifest Keying & Lifecycle → Current behaviour*: "**Nested collections are explicitly unsupported** (skipped with a warning), bounding recursion."
> Spec — *Error & Abort Behaviour → Partial outcomes for collections*: "Collection members are independent entries → each is processed on its own; a member that aborts or errors does **not** stop its siblings. Each failed member is reported loudly with its own reason."
> Phase 1 contract (task 1-3): `qualifiesAsMember` is one-level-only and the detector stays **silent** on nested-collection skips; the nested-collection *warning* belongs to the pipeline (this task). Phase 3 dependency: builds on the reshaped loop from tasks 3-1/3-2.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Collection Membership & Selection Flow*, *Manifest Keying & Lifecycle*, *Error & Abort Behaviour*.

---

## configless-install-3-5 | approved

### Task configless-install-3-5: Stray root agntc.json does not reclassify a member-dirs collection

**Problem**: A collection container is *not* an installable unit and never carries config — but an author (or a stray file) may leave an `agntc.json` at the collection root. Under v1, config *presence* at the root was the "this is a plugin/installable" signal; under configless that boundary-marker behaviour is dead (Phase 1), but two things must be verified end-to-end at the pipeline level: (1) a stray root config with **no `type`** must be **ignored** — structure still decides the repo is a member-dirs collection, and the pipeline must read the root config as nothing more than (irrelevant) noise, never as an installable-unit config; (2) a root config declaring **`type: "plugin"`** on a member-dirs structure is a **hard error** (unrealizable — you cannot bundle a member-dirs collection), surfaced pre-flight, non-zero, before any write. Both behaviours are produced by Phase 1's `detectType` (structure-authoritative; `TypeConflictError` for `type:"plugin"` on member-dirs) and Phase 2's `runAdd` wiring (single `detectType`, identity-prefixed `TypeConflictError` → `p.cancel` + `ExitSignal(1)`); this task verifies the **collection-root** manifestation of those rules and ensures the pipeline never treats the container's config as an installable unit's config.

**Solution**: This task is primarily **verification + guarding the seam**, with minimal-to-no new production code (Phase 1/2 already implement the mechanics): (a) confirm that a member-dirs source with a stray root `agntc.json` (no `type`) detects as `collection` and dispatches to `runCollectionPipeline`, where the **root** config is never read as an installable unit's config — the pipeline only ever reads *child* configs for agents (the root `config` from `runAdd` step-3 is not threaded into the pipeline as a unit config; verify it is not). (b) Confirm that a member-dirs source whose **root** `agntc.json` declares `type: "plugin"` raises `TypeConflictError` at the single `detectType` call in `runAdd` (because `detectType` reads the config `type` and the structure is a member-dirs collection), producing the identity-prefixed `p.cancel` + non-zero exit from Phase 2 task 2-2 — the pipeline is **never entered**. Add tests asserting both; add a guard/comment only if a gap is found (e.g. if the pipeline anywhere reads the root config as a unit).

**Note on `detectType` config-`type` input**: Phase 2 task 2-1 already pins the single root `detectType` call as `detectType(unitDir, { onWarn, configType: config?.type, forcePlugin: options?.forcePlugin })` — `configType: config?.type` is forwarded there as the canonical call shape. For the root `type: "plugin"` → error path to fire, `detectType` must receive the root config's `type` as `configType`; Phase 1 task 1-4 defined `detectType`'s `configType?` input and the realizability error. So this task is a **no-op verification** of an already-established seam: confirm 2-1's call forwards `configType: config?.type`, which makes a stray root `type:"plugin"` on a member-dirs structure reach the `TypeConflictError` path. (A root config with no `type` passes `configType: undefined` → structure stands → collection.) No new production wiring is needed here beyond verifying that seam.

**Outcome**: `agntc add owner/member-dirs-collection` where the repo root has a stray `agntc.json` with no `type` installs as a normal collection (members enumerated structurally, root config ignored). The same repo with a root `agntc.json` declaring `type: "plugin"` fails pre-flight: non-zero exit, `p.cancel` naming the source and the member-count conflict ("... structure is a collection of N members — cannot bundle"), no clone content copied, the pipeline never entered. A container's config is never read as an installable unit's config.

**Do**:
- In `src/commands/add.ts` `runAdd`, verify the single root `detectType` call forwards the root config's `type`: `detectType(unitDir, { onWarn, configType: config?.type, forcePlugin: options?.forcePlugin })`. Task 2-1 already pins `configType: config?.type` as the canonical call shape, so this is a **no-op verification** — the load-bearing seam for the root `type:"plugin"` error on a collection is already in place; just confirm it (and its test coverage) here.
- Confirm the pipeline (`runCollectionPipeline`) does **not** thread the **root** config in as an installable unit's config: the pipeline reads only *child* (`pluginDir`) configs for agents (tasks 3-1/3-2). The root `config` value from `runAdd` step-3 must not be passed to the pipeline as a unit config nor used to constrain agents. Verify `CollectionPipelineInput` carries no root-config field used that way; if a stray pathway exists, remove it.
- For the no-`type` stray-root case: structure-authoritative `detectType` (Phase 1) already ignores a `configType` that is `undefined`/unrecognised, so a root config `{ agents: [...] }` (no `type`) yields `collection` and dispatches to the pipeline normally. No code change beyond the verification above.
- For the `type: "plugin"` stray-root case: with `configType: "plugin"` forwarded and the structure a member-dirs collection, Phase 1 task 1-4 throws `TypeConflictError`; Phase 2 task 2-2's catch in `runAdd` prefixes the source identity, `p.cancel`s, and throws `ExitSignal(1)` — pre-flight, before clone content is copied, pipeline not entered. Confirm this end-to-end.
- Do **not** add any new error class or message format — reuse the Phase 1 `TypeConflictError` (member-count message) and Phase 2's identity-prefixing. This task wires/verifies the collection-root manifestation only.

**Acceptance Criteria**:
- [ ] A member-dirs source with a stray root `agntc.json` and **no `type`** detects as `collection` and installs via the pipeline; the root config does not reclassify it and is never read as an installable unit's config.
- [ ] A member-dirs source whose root `agntc.json` declares `type: "plugin"` raises `TypeConflictError` at the single root `detectType` call; `runAdd` surfaces it as an identity-prefixed `p.cancel` (naming the source and the "collection of N members — cannot bundle" conflict) and exits non-zero (`ExitSignal(1)`).
- [ ] The `type: "plugin"` error is **pre-flight**: no clone content copied, no manifest write, the collection pipeline **not** entered.
- [ ] `runAdd` forwards the root config's `type` as `configType` into the root `detectType` call (the seam enabling the above).
- [ ] A configless-root collection (no root `agntc.json`) is unchanged (`detectType` → `collection`, pipeline runs).

**Tests** (`tests/commands/add.test.ts`):
- `"a stray root agntc.json with no type does not reclassify a member-dirs collection"` — root `readConfig` → `{ agents: ["claude"] }` (no `type`); root `detectType` (with `configType: undefined`) → `COLLECTION_DETECTED`; assert the pipeline runs (`selectCollectionPlugins` reached) and members install; assert the root config is **not** passed into the pipeline as a unit config.
- `"a root agntc.json declaring type: plugin on a member-dirs collection is a hard error"` — root `readConfig` → `{ agents: ["claude"], type: "plugin" }`; root `detectType` (called with `configType: "plugin"`) rejects `TypeConflictError("... a collection of 2 members — cannot bundle")`; assert `ExitSignal(1)`, `p.cancel` message contains the source identity (`owner/my-collection`) and "cannot bundle", `selectCollectionPlugins` **not** called, no `writeManifest`.
- `"runAdd forwards the root config type into detectType"` — root config `{ agents: [...], type: "plugin" }`; assert the root `detectType` call options include `configType: "plugin"`.
- `"the container config is never read as an installable unit config"` — assert no code path uses the root `config.agents` to constrain collection-member agents (members resolve from their *own* configs per 3-2).
- `"a configless-root collection is unchanged"` — root `readConfig` → `null`; assert pipeline runs as before.

**Edge Cases**:
- Stray root config, no `type` → ignored; collection installs.
- Root config `type: "plugin"` on member-dirs → hard error, pre-flight, pipeline not entered.
- Root config `type: "collection"` or any unrecognised value → ignored (Phase 1 leniency); collection installs (not an error path).
- Configless root → unchanged.

**Context**:
> Spec — *Backward-Compat / Migration & Config Schema → Collection with a stray root `agntc.json`*: "Structure decides it's a collection regardless of the stray config: Root config with **no `type`** → ignored. Root config declaring **`type: plugin`** on a member-dirs structure → **hard error** (unrealizable, per the type-vs-structure conflict rule). Presence alone never reclassifies it."
> Spec — *Config Model → Rules*: "A collection is not an installable unit (it's a container of units), so a collection container **never carries config**. Config *presence* never signals type."
> Spec — *Type-vs-structure conflict → hard error*: "`type: plugin` on a member-dirs collection → error." and *Error & Abort Behaviour → Hard errors*: "pre-flight failures: nothing is written, the command exits non-zero, and the message names the offending source/unit and what conflicted."
> Phase 1 contract (task 1-4): `detectType` reads `configType`; `type:"plugin"` on a member-dirs collection throws `TypeConflictError`; `type:"collection"`/unknown ignored. Phase 2 contract (tasks 2-1/2-2): single root `detectType` call; `TypeConflictError` caught, identity-prefixed, `p.cancel` + `ExitSignal(1)`. This task verifies/wires the collection-root manifestation and the `configType: config?.type` forwarding seam.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Backward-Compat / Migration & Config Schema*, *Config Model*, *Structural Type Detection*, *Error & Abort Behaviour*.

---

## configless-install-3-6 | approved

### Task configless-install-3-6: Select-all and tree-path selector target structural members

**Problem**: Selection must operate over the **structural** member list (`detected.plugins`, now built via Phase 1's `qualifiesAsMember`) and produce the right per-member installs. Two selection paths exist and must both target structural members: (1) the interactive prompt's **select-all** installs every structural member (select-all is the flag-free "install every member", *not* `--plugin`); (2) the **tree-path selector** (`https://<host>/<owner>/<repo>/tree/<ref>/<subpath>`, parsed as a `direct-path` with `targetPlugin = <subpath>`) installs a single member directly without prompting. The pipeline's direct-path branch (~361–379) checks `detected.plugins.includes(parsed.targetPlugin)` and errors if absent (~362–366) — that membership check must be against the *structural* list, and a selector targeting a name not in the structural list must produce a clear error. (Note: Phase 2 task 2-3 reroutes a tree-path standalone unit through the standalone path against `unitDir`; the pipeline's direct-path branch here remains the path for a tree URL whose subpath is a *member of a detected collection root* — the two coexist. This task verifies the selector resolves against structural membership and that select-all fans out over all structural members.)

**Solution**: Verify and adjust the pipeline's selection over the structural member set: select-all from `selectCollectionPlugins` (the prompt returns every member name) fans out the per-member install over all structural members; the direct-path branch installs only `parsed.targetPlugin` and errors clearly if it is not in the structural `detected.plugins` list. Each selected member is keyed `owner/repo/<unit>` (the existing `${parsed.manifestKey}/${pluginName}` keying, ~488–491). With membership now structural (Phase 1) and config-presence skips removed (3-1), select-all and the selector both target the structural members. Config-bearing collection selection flow is unchanged (the prompt and keying are the same; only the membership source upstream changed).

**Outcome**: Select-all in the prompt installs every structural member of a collection (each keyed `owner/repo/<unit>`), including configless members. A tree-path selector installs the single targeted member without prompting, keyed `owner/repo/<unit>`. A selector whose `<subpath>` is not a structural member yields a clear error naming the unavailable target and the available members. Config-bearing collection selection behaves exactly as before.

**Do**:
- In `src/commands/add.ts` `runCollectionPipeline`, **confirm the select-all path**: when `parsed.type` is not `direct-path`, `selectCollectionPlugins({ plugins: detected.plugins, ... })` (~369–373) presents the structural member list; selecting all returns every member name, and the per-member loop installs each. No code change beyond ensuring `detected.plugins` is the structural list (it is, post-Phase-1) — verify select-all fans out over all members.
- **Confirm the direct-path selector path** (~361–379): `if (!detected.plugins.includes(parsed.targetPlugin)) throw new Error(\`Plugin "${parsed.targetPlugin}" not found in collection. Available: ${detected.plugins.join(", ")}\`)`. This membership check is now against the *structural* member list — verify the message lists structural members and that a selector for a non-member name errors clearly. (Keep the existing error shape; it already names the target and lists available members.)
- **Confirm keying** (~488–491, ~606–611): each member installs keyed `${parsed.manifestKey}/${pluginName}` for the prompt path, and the direct-path member keys `parsed.manifestKey` (`owner/repo/<subpath>`, already produced by `parseDirectPath`). No keying change — structural membership reuses the existing scheme.
- **Coexistence with Phase 2 task 2-3**: task 2-3 reroutes a tree URL through the *standalone* path against `unitDir` when the source is a `direct-path`. The pipeline's direct-path branch here applies when a `direct-path` source's *root* detected as a `collection` and the selector targets a member of it. Do not duplicate or conflict with 2-3's standalone reroute; this task only ensures the pipeline's existing direct-path member-selection branch checks membership against the structural list and installs/keys correctly. (If 2-3's reroute means a `direct-path` source never reaches `runCollectionPipeline`, this branch is exercised only by the historical/collection-root path; verify the existing direct-path collection tests reflect the structural list either way.)
- Do **not** introduce a `--plugin`-based "install all" — select-all is the flag-free mechanism (per spec). `--plugin` only resolves a unit's skills-only ambiguity and is a hard error on a member-dirs collection (Phase 2 task 2-2 / Phase 1 task 1-4).

**Acceptance Criteria**:
- [ ] Select-all in the prompt installs **every** structural member of a collection, each keyed `owner/repo/<unit>` (configless members included).
- [ ] The tree-path selector installs the single targeted member without prompting, keyed `owner/repo/<unit>`.
- [ ] A selector `<subpath>` not present in the structural member list produces a clear error naming the unavailable target and the available structural members; no install occurs.
- [ ] Member selection (prompt + selector) operates over `detected.plugins`, the structural list (config presence neither adds nor removes a selectable member).
- [ ] Config-bearing collection selection flow (prompt, keying, per-member install) is unchanged.
- [ ] "Install every member" is select-all, not `--plugin` (no `--plugin`-driven install-all is introduced).

**Tests** (`tests/commands/add.test.ts`, `collection type` describe — including the direct-path collection cases ~545–1597):
- `"select-all installs every structural member"` — `detected.plugins` = `["pluginA","pluginB"]` (structural, configless), `selectCollectionPlugins` → both; assert both copied and keyed `owner/my-collection/pluginA` / `.../pluginB`.
- `"select-all includes configless members"` — both members configless (`readConfig` → `null`); assert both install (overlaps 3-1; assert via the select-all fan-out).
- `"the tree-path selector installs a single member without prompting"` — `parsed.type: "direct-path"`, `targetPlugin: "pluginA"`, `detected.plugins` includes `pluginA`; assert `selectCollectionPlugins` **not** called, only pluginA installed, keyed appropriately.
- `"a selector targeting a non-member yields a clear error"` — `targetPlugin: "ghost"`, `detected.plugins` = `["pluginA","pluginB"]`; assert the thrown error message names `ghost` and lists `pluginA, pluginB`, and no install occurs (surfaces via outer catch as exit 1).
- `"member selection operates over the structural list"` — assert `selectCollectionPlugins` is called with `plugins: detected.plugins` (the structural list).
- `"config-bearing collection selection flow is unchanged"` — a config-bearing collection (members with `agntc.json`) selects and installs exactly as the existing suite asserts (guard test).
- Reconcile with Phase 2 task 2-3's reroute: if a `direct-path` source is rerouted to the standalone path (2-3), update the historical pipeline direct-path tests (~the existing direct-path collection cases) to reflect whichever route applies, preserving the externally-observable key/files outcome.

**Edge Cases**:
- Select-all → every structural member installs (configless included).
- Selector → single member, no prompt.
- Selector target absent from structural list → clear error (names target + available members), no install.
- Config presence on a member neither adds nor removes it from the selectable list.
- `--plugin` is never the install-all mechanism (select-all is); `--plugin` on a member-dirs collection is a hard error (Phase 1/2).

**Context**:
> Spec — *Collection Membership & Selection Flow → Selection UX (unchanged, flag-free)*: "The existing interactive prompt for 'which member(s)?' (one / some / all). A source-string selector — the GitHub tree-path URL — to pick a member directly without prompting. **'Install every member' is select-all in the prompt**, not `--plugin` (which only resolves a unit's skills-only ambiguity)."
> Spec — *Structural Type Detection → Source selector grammar*: "Unit / member selection = the GitHub tree-path URL... it yields `ref = <ref>`, `targetPlugin = <subpath>`, and manifest key `owner/repo/<subpath>`."
> Spec — *Manifest Keying & Lifecycle → Keying*: "`owner/repo/<unit-dir>` for a collection member... Configless adds no new keying scheme — it reuses the existing one."
> Spec — *Error & Abort Behaviour → Partial outcomes for collections*: "`update` and multi-member installs operate **per manifest entry**... a member that aborts or errors does **not** stop its siblings."
> Phase 1 contract: `detected.plugins` is the structural member list (`qualifiesAsMember`). Phase 2 task 2-3 reroutes a tree-path `direct-path` source through the standalone path against `unitDir`; this task ensures the pipeline's member-selection (prompt select-all + the pipeline's direct-path membership check) targets the structural list. Phase 2 task 2-2 / Phase 1 task 1-4: `--plugin` on a member-dirs collection is a hard error — never the install-all mechanism.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Collection Membership & Selection Flow*, *Structural Type Detection*, *Manifest Keying & Lifecycle*, *Error & Abort Behaviour*.
