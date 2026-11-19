---
phase: 1
phase_name: Configless detection foundation (structural type, lenient config, agent default)
total: 5
---

## configless-install-1-1 | approved

### Task configless-install-1-1: Lenient config reading with optional type

**Problem**: Today `readConfig` throws on malformed JSON, on a missing `agents` key, and on an empty `agents` array. Under configless this is wrong: config is optional and any unparseable/unusable config must be treated as "no usable config" (lenient default), never an error. The governing posture is "missing/invalid info → lenient default" for config reading. The config must also begin carrying the optional `type` disambiguator and tolerate unknown keys.

**Solution**: Rewrite `readConfig` so the *only* outcomes are (a) a usable `AgntcConfig` (`{ agents, type? }`) or (b) `null` ("no usable config"). A config is **usable** if it parses to an object that yields *either* a usable (non-empty, ≥1 known) `agents` list *or* a recognised `type` value — so a `type`-only config (the configless skills-only bundle the spec reserves `type` for) is retained even with no `agents`. Missing file, malformed JSON, and an object that yields **neither** a usable `agents` list **nor** a `type` property collapse to `null`. Non-permission/non-ENOENT IO errors still propagate. Read the optional `type` property; pass its raw value through untouched (recognition of `"plugin"` vs. unrecognised values belongs to detection in task 1-4, not here). Unknown keys are ignored. When a config is retained on the strength of `type` alone, its `agents` is the empty list `[]` — which downstream (task 1-5 / Phase 2 wiring) resolves to the `KNOWN_AGENTS` default (no agent restriction), exactly matching "a configless skills-only repo bundled for any agent."

**Outcome**: `readConfig` never throws a `ConfigError`. A bare-`SKILL.md` repo with no `agntc.json` (the `refero_skill` shape) yields `null`. A config of `{agents:[claude]}` yields `{agents:["claude"]}`. A config of `{agents:["claude"], type:"plugin"}` yields `{agents:["claude"], type:"plugin"}`. A config of `{type:"plugin"}` with no `agents` yields `{agents:[], type:"plugin"}` (the bundle intent survives to detection; agents fall through to the `KNOWN_AGENTS` default). A config with neither usable `agents` nor a `type` (e.g. `{}`, `{agents:[]}`, all-unknown agents and no `type`) yields `null`. Malformed JSON yields `null` (with a warning), not a throw.

**Do**:
- In `src/config.ts`, extend the `AgntcConfig` interface to `{ agents: AgentId[]; type?: string }`. Keep `type` as a raw `string` (or `string | undefined`) — do **not** narrow to a union here; recognition of `"plugin"` vs. unrecognised values is detection's job (task 1-4). This keeps `readConfig` purely lenient.
- Change the `JSON.parse` failure branch (currently `throw new ConfigError(...)`) to call `options?.onWarn?.(...)` with a message like `Ignoring malformed agntc.json: <detail>` and `return null`.
- Change the "not an object" branch (currently throws "agents field is required") to `return null` (optionally warn) — a non-object JSON is "no usable config."
- For an object that parses: compute the filtered known-`agents` list (keep the existing unknown-agent filtering loop, warning per unknown agent) and read the `type` property (when present and a string). Then:
  - If the filtered `agents` is non-empty → return `{ agents: filtered, ...(type ? { type } : {}) }`.
  - Else if a `type` property is present (a string) → return `{ agents: [], type }` — the `type`-only configless-bundle case is **usable**; its empty `agents` means "no restriction" (resolves to the `KNOWN_AGENTS` default downstream). Do **not** discard the `type`.
  - Else (no usable `agents` **and** no `type` — missing `agents`, `agents: []`, non-array `agents`, or all-unknown `agents` with no `type`) → `return null`. An object carrying neither a usable agent declaration nor a `type` disambiguator carries no usable author intent, identical to no config (spec: *Agent Selection → "No valid constraint" — unified across three cases*).
- Read `type` from the parsed object when present and a string; attach it to the returned config as-is. Ignore any other (unknown) keys silently.
- Keep the ENOENT branch returning `null`. Keep the non-ENOENT IO error (e.g. `EACCES`) re-throwing the raw error unchanged (it must **not** be wrapped or swallowed — a real filesystem failure is not "no usable config").
- The `ConfigError` class may become unused; remove its export only if no other module imports it (grep first — it is imported in `src/commands/add.ts`). If still imported, leave the class defined but stop throwing it from `readConfig`; note in task wiring that add.ts's `ConfigError` catch becomes dead in Phase 2. To keep the build green in Phase 1, leave the `ConfigError` class exported.

**Acceptance Criteria**:
- [ ] `readConfig` returns `null` (never throws `ConfigError`) for: missing file (ENOENT), malformed JSON, non-object JSON, and an object that yields **neither** a usable `agents` list **nor** a `type` property (object with no `agents` and no `type`; `agents` not an array and no `type`; empty `agents` array and no `type`; only-unknown `agents` and no `type`).
- [ ] `readConfig` returns `{ agents: [...known], type?: <raw> }` for a config with at least one known agent; unknown agents are filtered with a per-agent warning; the optional `type` value is passed through verbatim.
- [ ] A config carrying a recognised-or-unrecognised `type` but **no usable `agents`** (e.g. `{type:"plugin"}`) is **retained** as `{ agents: [], type: <raw> }` — the `type` disambiguator survives to detection and the empty `agents` resolves to the `KNOWN_AGENTS` default. This is the configless skills-only bundle the spec reserves `type` for.
- [ ] Unknown/extra top-level keys are ignored (do not appear on the returned object, do not cause warnings).
- [ ] A non-ENOENT, non-parse IO error (e.g. `EACCES`) propagates unchanged and is **not** an instance of `ConfigError`.
- [ ] Existing config-bearing behaviour is preserved: `{agents:["claude"]}` still yields `{agents:["claude"]}` (the `agentic-workflows` Claude-only case).

**Tests** (extend `tests/config.test.ts`):
- `"returns null when agntc.json does not exist"` (existing, unchanged)
- `"returns null for malformed JSON instead of throwing"` (rewrite of the two existing `throws ConfigError for invalid JSON` cases; assert `null` and an `onWarn` call)
- `"returns null when agents field is missing and no type is present"` (rewrite of `throws when agents field missing entirely`)
- `"returns null when agents is an empty array and no type is present"` (rewrite of `throws when agents is empty array`)
- `"returns null when agents is not an array and no type is present"`
- `"returns null when all agents are unknown and no type is present"` (rewrite of `returns empty known agents when all unknown` — now expects `null` and warns per unknown agent)
- `"retains a type-only config with empty agents (configless skills-only bundle)"` — `{type:"plugin"}` → `{agents:[], type:"plugin"}` (the bundle intent survives; not `null`)
- `"retains a type-bearing config even when agents is missing/empty/all-unknown"` — asserts `{agents:[], type:"plugin"}` is returned in each such case
- `"parses valid config with known agents"` (existing happy-path cases retained)
- `"reads optional type property when present"` — `{agents:["claude"], type:"plugin"}` → `{agents:["claude"], type:"plugin"}`
- `"passes through an unrecognised type value verbatim"` — `{agents:["claude"], type:"weird"}` → `type:"weird"` (recognition is detection's job)
- `"ignores unknown extra keys without warning"` — `{agents:["claude"], foo:1}` → `{agents:["claude"]}`, no `onWarn` for `foo`
- `"filters unknown agents but keeps known ones with type"` — mix of known/unknown plus `type`
- `"propagates non-ENOENT IO errors unchanged"` (existing `propagates permission denied` — assert not `ConfigError`)
- `"reads from correct path"` (existing, unchanged)

**Edge Cases**:
- Malformed JSON → `null` + warn (not throw).
- `{agents:[]}` with no `type` → `null` (empty array and no disambiguator is "no usable config").
- `{agents:["unknown1","unknown2"]}` with no `type` → `null` (all-unknown reduces to empty after filtering, and no `type`).
- `{type:"plugin"}` with no `agents` → `{agents:[], type:"plugin"}` (**usable**: the `type` disambiguator is the spec's reserved configless-bundle case; empty `agents` resolves to the `KNOWN_AGENTS` default downstream). The raw `type` survives to detection (task 1-4 decides recognition).
- `{}` / `{agents:[]}` / all-unknown agents, **no** `type` → `null` (neither usable `agents` nor a `type`).
- `EACCES`/other IO error → propagate raw.

**Context**:
> Spec — *Config Model → Config shape*: `agents` is **optional**; `type` is "Reserved strictly for a pure skills-only repo the author wants bundled as a plugin." A config carrying only `type` is therefore a usable config (its `agents` simply defaults to no-restriction / `KNOWN_AGENTS`).
> Spec — *Structural Type Detection → Skills-only resolution*: "Author override → config `type: plugin` bundles it (even a single skill)." For that override to reach detection, `readConfig` must **retain** a `type`-only config rather than discard it.
> Spec — *Config Model → Recognised `type` values and the leniency-vs-error boundary*: "Config *reading* is lenient." The recognised-value/error boundary (`type:"plugin"` realizability) is **not** enforced here — it lives in detection (task 1-4). `readConfig` only surfaces the raw `type`; it must not throw away a `type`-only config.
> Spec — *Agent Selection → "No valid constraint" — unified across three cases*: config absent, `agents:[]`, and malformed config all reduce to the same "no usable config" / `KNOWN_AGENTS`-default state. A `type`-only config takes the empty-`agents` (no-restriction) path, not the `null` path.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Config Model*, *Agent Selection*.

---

## configless-install-1-2 | approved

### Task configless-install-1-2: Single structural detection path

**Problem**: `detectType` currently has **two** detection paths gated on `hasConfig`: a config-present path that checks asset dirs / `SKILL.md`, and a config-absent path that only looks for child dirs containing `agntc.json`. The spec mandates a **single structural detection path** where config presence is never an input, and a bare-`SKILL.md` repo with no config (the `refero_skill` shape) must detect as a bare skill instead of being rejected as `not-agntc`.

**Solution**: Collapse `detectWithConfig`/`detectWithoutConfig` into one structural classifier that ignores config presence entirely. The root-level resolution order is: (1) root asset-kind dirs (`skills`/`agents`/`hooks`) with the skills-only exception → plugin; (2) root `SKILL.md` → bare skill; (3) otherwise scan non-asset child dirs as potential collection members → collection (membership rule built in task 1-3); (4) else not-agntc. The skills-only-at-root shape (only `skills/`, no `agents/`/`hooks/`, no other resolvable structure) defaults to **collection** but must be flagged internally as the ambiguous case so task 1-4's overrides can target it. This task delivers the structural core *without* the override inputs (those land in task 1-4) — but it establishes the new options shape so overrides slot in cleanly.

**Outcome**: `detectType(dir, { ... })` resolves type from structure alone. `refero_skill` shape (root `SKILL.md`, no config) → `bare-skill`. `skills/` + `agents/` → `plugin`. `agents/`-only or `hooks/`-only → `plugin`. `skills/`-only → `collection` (default for the ambiguous case). `SKILL.md` alongside an asset dir → `plugin` (with the existing warning). Empty/unreadable dir → `not-agntc`.

**Do**:
- In `src/type-detection.ts`, replace `DetectTypeOptions` `{ hasConfig: boolean; onWarn? }` with a new shape that drops `hasConfig` and adds the override inputs needed by task 1-4 — define them now as optional and unused-by-default so the signature is stable: `{ configType?: string; forcePlugin?: boolean; onWarn?: (m: string) => void }`. In this task, `configType`/`forcePlugin` are accepted but only the structural default is exercised; task 1-4 wires their behaviour and tests.
- Implement a single async classifier. Order:
  1. Scan root for asset-kind dirs (reuse `ASSET_DIRS`, the existing `exists` helper). Collect `foundAssetDirs`.
  2. Compute `hasSkillMd = exists(join(dir, "SKILL.md"))`.
  3. **Plugin (non-skills-only)**: if `foundAssetDirs` contains any of `agents`/`hooks` (i.e. ≥1 asset dir and not the skills-only case) → `{ type: "plugin", assetDirs: foundAssetDirs }`. If `SKILL.md` also present, emit the existing warning ("SKILL.md found alongside asset dirs — treating as plugin, SKILL.md will be ignored").
  4. **Skills-only ambiguous**: if `foundAssetDirs` is exactly `["skills"]` (only `skills/`, no `agents`/`hooks`) → this is the ambiguous case. **Default to collection** but mark it ambiguous (see modelling note). In this task, return the default collection result for it; task 1-4 consumes the ambiguity marker to apply overrides.
  5. **Bare skill**: else if `hasSkillMd` → `{ type: "bare-skill" }`.
  6. **Collection member scan**: else scan non-asset child dirs for structural units (delegated to task 1-3's membership rule). If ≥1 member → `{ type: "collection", plugins }`.
  7. **not-agntc**: else `{ type: "not-agntc" }`.
- Modelling the skills-only ambiguity: do **not** add a public `DetectedType` variant for it (callers still see `collection`/`plugin`). Instead, structure the implementation so the override-resolution layer (task 1-4) can detect "structure is skills-only-at-root." Recommended: factor a private `classifyStructure(dir, onWarn)` returning a richer internal discriminator (e.g. `{ kind: "skills-only" | "plugin" | "bare-skill" | "members" | "none"; assetDirs?; plugins? }`), with `detectType` mapping it to the public `DetectedType` and applying overrides. This keeps the public type stable while giving task 1-4 the hook it needs.
- The collection member scan (step 6) is the subject of task 1-3 — in this task, retain a placeholder that preserves the *current* `not-agntc` outcome for "no qualifying children" so this task's tests pass; task 1-3 replaces the membership predicate. (Concretely: until 1-3 lands, step 6 may still find nothing and fall through to `not-agntc` for non-asset child dirs — the skills-only and asset-dir cases above are fully exercised here.)
- **Keep the build green**: update the two existing call sites (`src/commands/add.ts` lines ~173/199, `src/nuke-reinstall-pipeline.ts` line ~85) to the new options shape — drop `hasConfig`, pass `{ onWarn }`. This is a *mechanical signature fix only*; full semantic rewiring of those callers (e.g. removing the `config === null` collection branch in add.ts) is Phase 2/3 and out of scope here. The call sites must compile and their existing tests must stay green.

**Acceptance Criteria**:
- [ ] `detectType` no longer accepts or reads `hasConfig`; detection is identical whether or not a config exists.
- [ ] Root `SKILL.md` with no config → `{ type: "bare-skill" }` (the `refero_skill` shape; previously `not-agntc`).
- [ ] `skills/` + `agents/` and/or `hooks/` → `{ type: "plugin", assetDirs: [...] }`.
- [ ] `agents/`-only, `hooks/`-only, or `agents/`+`hooks/` (no `skills/`) → `plugin`.
- [ ] `skills/`-only at root → `collection` by default (ambiguous case), and the implementation exposes that this was the skills-only case to the override layer (verifiable in task 1-4).
- [ ] `SKILL.md` alongside any asset dir → `plugin` with the existing warning fired once.
- [ ] Empty directory and unreadable directory → `not-agntc` (no throw).
- [ ] Root containing only files (no dirs, no `SKILL.md`) → `not-agntc`.
- [ ] Existing call sites compile against the new signature with their current tests green.

**Tests** (rewrite `tests/type-detection.test.ts` — the `hasConfig` parameterisation is removed):
- `"detects bare skill from root SKILL.md with no config (refero_skill shape)"`
- `"detects bare skill with non-asset sibling dirs (references, examples)"`
- `"detects plugin from skills + agents dirs"`
- `"detects plugin from agents-only dir"`
- `"detects plugin from hooks-only dir"`
- `"detects plugin from agents + hooks (no skills)"`
- `"warns and detects plugin when SKILL.md coexists with an asset dir"`
- `"defaults skills-only root to collection (ambiguous case)"`
- `"returns not-agntc for an empty directory"`
- `"returns not-agntc for a root containing only files"`
- `"returns not-agntc for an unreadable directory"` (readdir rejects)
- `"detection ignores agntc.json presence (same result with or without config)"` — assert a bare-`SKILL.md` dir detects identically whether an `agntc.json` is also present

**Edge Cases**:
- `skills/`-only → collection default, but flagged ambiguous internally (task 1-4 hooks it).
- `SKILL.md` + asset dir → plugin wins, warn once, `SKILL.md` ignored.
- Unreadable dir (readdir throws) → `not-agntc`, no exception escapes.
- Root with only loose files → `not-agntc`.

**Context**:
> Spec — *Structural Type Detection → Single structural detection path (at the root)* and *Canonical plugin rule*: "A **plugin** is structurally: a root containing one or more asset-kind dirs (`skills/`, `agents/`, `hooks/`), with the single skills-only exception." "Config presence is no longer an input to detection." Resolution order: root asset-kind dirs (plugin, skills-only excepted) checked **before** any member scan, so `skills/` is never mistaken for a collection-of-skills; then root `SKILL.md` → bare skill; then non-asset child scan → collection; else reject.
> Spec — *Why skills-only is ambiguous*: a root `skills/`-only dir defaults to collection (Vercel menu convention) but is the one case the overrides in task 1-4 resolve.
> The skills-only default-to-collection vs. the bare-skill ordering: the spec's prose lists `SKILL.md` first in the four-shapes table but the *detection path* checks asset-kind dirs before `SKILL.md` only to keep `skills/` from being read as a collection; a root with both `SKILL.md` and `skills/`+asset is plugin. A root with `SKILL.md` and no asset dir is a bare skill. Order the code to match the *detection path* prose, not the table.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Structural Type Detection*.

---

## configless-install-1-3 | approved

### Task configless-install-1-3: Structural collection membership (one level down)

**Problem**: Collection membership today is "an immediate child dir that contains `agntc.json`." Under configless, members carry no config, so that enumeration finds nothing. Membership must instead be "a child dir that structurally resolves to a unit," by recursing the *same* structural detection exactly one level down. Nested collections stay unsupported.

**Solution**: Replace the `has-agntc.json` child predicate in the collection member scan (the step 6 placeholder from task 1-2) with a structural one: a child qualifies as a member if it has a root `SKILL.md` (bare-skill member) **or** ≥1 asset-kind dir (`skills`/`agents`/`hooks`) (plugin member). A child with neither is skipped. A child that is itself a collection (only resolvable via *its* children) is **not** recursed into — membership detection goes exactly one level. If no immediate child qualifies (and the root had no asset dir / `SKILL.md`), the result is `not-agntc`.

**Outcome**: A repo whose immediate children are configless units enumerates those units as members. `member-a/SKILL.md` and `member-b/skills/` → `collection` with `plugins: ["member-a","member-b"]`. A child with only loose files, or only a nested collection, is excluded. A root whose children none qualify → `not-agntc`.

**Do**:
- In `src/type-detection.ts`, implement the member-qualification predicate as a per-child structural check reusing the same primitives as the root classifier: for each immediate child directory, `qualifiesAsMember(childDir)` is true iff `exists(join(childDir, "SKILL.md"))` **or** any of `ASSET_DIRS` exists directly under `childDir`. Collect qualifying child *names* into `plugins`.
- Wire this predicate into the root classifier's collection step (step 6 from task 1-2): scan only **non-asset** child dirs (the root-level asset dirs were already consumed by the plugin/skills-only branches), apply `qualifiesAsMember`, and if ≥1 qualifies → `{ type: "collection", plugins }`, else `not-agntc`.
- **One level only**: `qualifiesAsMember` checks the child's *own* root for `SKILL.md`/asset dirs. It must **not** recurse into the child's children. A child that is only a collection-of-grandchildren (no `SKILL.md`, no asset dir at the child root) returns false and is skipped — this is the "nested collections unsupported, one level down" rule. Do not warn here; the nested-collection warning belongs to the collection *pipeline* (Phase 3), not the detector.
- Iterate children deterministically (sort the qualifying names) so `plugins` order is stable for tests; existing tests already sort, but stabilising the source avoids flakiness.
- Keep ignoring non-directory entries (files at root are never members), matching current behaviour.

**Acceptance Criteria**:
- [ ] A child dir with a root `SKILL.md` qualifies as a member (bare-skill member), with no `agntc.json` required.
- [ ] A child dir with ≥1 asset-kind dir (`skills`/`agents`/`hooks`) qualifies as a member (plugin member), with no `agntc.json` required.
- [ ] A child dir with neither `SKILL.md` nor an asset dir is skipped.
- [ ] Config-bearing and configless members coexist: a mix where some children also have `agntc.json` and some do not all enumerate by structure alone (config presence neither adds nor removes a member).
- [ ] A child that is itself only a collection (resolvable solely via its grandchildren) is **not** counted as a member (one-level-only); if it is the sole child, the root is `not-agntc`.
- [ ] A root with no qualifying children and no root asset dir / `SKILL.md` → `not-agntc`.
- [ ] The previous behaviour (children with `agntc.json` enumerate) still produces a collection — but now because those children also have structural units in the real fixtures; pure-`agntc.json`-only child dirs (no `SKILL.md`, no asset dir) are **no longer** members (this is the intended change — note it explicitly in the test).

**Tests** (extend `tests/type-detection.test.ts`, `collection` describe block):
- `"enumerates configless members: child SKILL.md and child with skills dir"`
- `"counts a child plugin member by its asset dir (agents-only child)"`
- `"skips a child dir with neither SKILL.md nor asset dir"`
- `"enumerates mixed config-bearing and configless members structurally"` — child-a has `SKILL.md` + `agntc.json`, child-b has `skills/` and no config; both enumerate
- `"does not recurse into a nested-collection child (one level only)"` — `outer/inner-member/SKILL.md` (child `outer` has no root SKILL.md/asset dir) → `outer` is not a member → `not-agntc`
- `"returns not-agntc when no immediate child qualifies"`
- `"a child with only agntc.json (no SKILL.md, no asset dir) is no longer a member"` — documents the membership change from v1

**Edge Cases**:
- Nested collection child → skipped (one level only); if sole child, root is `not-agntc`.
- Child with `agntc.json` but no structural unit → skipped (membership is now structural, not config-presence).
- Mixed config-bearing + configless members → both enumerate.
- Files at root (non-dirs) → never members.

**Context**:
> Spec — *Collection Membership & Selection Flow → Membership (structural, one level down)*: "For each immediate child dir, run the *same* structural detection used at the root: child has `SKILL.md` → bare-skill member; child has asset-kind dirs → plugin member; child has neither → not a member, skip it. The pickable list... **replacing** the 'has `agntc.json`' enumeration."
> Spec — *Nested collections*: "a collection member that is itself a collection is not recursed into. Membership detection goes exactly **one level** down."
> This task delivers detection-level membership only. The *selection pipeline* (prompt, per-child agent resolution, nested-collection warning) is Phase 3 and out of scope here.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Collection Membership & Selection Flow*, *Structural Type Detection*.

---

## configless-install-1-4 | approved

### Task configless-install-1-4: Two-level type override and conflict hard error

**Problem**: The skills-only-at-root shape is the single irreducibly-ambiguous structure (plugin-bundle vs. collection-menu). Two override inputs resolve it — config `type: "plugin"` and the `--plugin` install flag — with precedence `--plugin` > config `type` > structure. An override that contradicts an *unambiguous* structure (bare skill, member-dirs collection, or multi-asset plugin that is already a plugin) is either a redundant no-op (already a plugin) or an unrealizable **hard error**. Only `type: "plugin"` is a recognised value; `type: "collection"` and all other values are silently ignored.

**Solution**: Add the override-resolution layer on top of the structural classifier from task 1-2. After structure is classified, apply (in precedence order) `--plugin` then config `type` *only* to the skills-only ambiguous case to bundle it as a plugin. If an override is asserted against an unambiguous structure, resolve per the conflict matrix: agrees with an existing plugin → no-op; contradicts (bare skill, member-dirs collection) → throw a pre-flight `TypeConflictError` naming the source/unit and the conflict. Unrecognised `type` values are ignored entirely (never reach the error path).

**Outcome**: `detectType(skillsOnlyDir, { configType: "plugin" })` → `plugin`. `detectType(skillsOnlyDir, { forcePlugin: true })` → `plugin`. When both disagree the flag wins (only relevant in the ambiguous case; they agree on "bundle"). `detectType(bareSkillDir, { configType: "plugin" })` and `{ forcePlugin: true }` → throw `TypeConflictError`. `detectType(memberDirsCollection, { configType: "plugin" })` / `{ forcePlugin: true }` → throw `TypeConflictError`. `detectType(multiAssetPlugin, { forcePlugin: true })` → `plugin` (no-op). `type: "collection"` and any unknown `type` → ignored (structure stands).

**Do**:
- In `src/type-detection.ts`, define and export a `TypeConflictError extends Error` (name `"TypeConflictError"`) carrying enough context for the caller's message (e.g. the resolved structural type and what was requested). The thrown error message should name the conflict, e.g. ``declares type: "plugin" but its structure is a collection of N members — cannot bundle`` and ``--plugin requested but the source is a bare skill — cannot bundle``. The *source identity* (owner/repo) is added by the caller (Phase 2/3); the detector supplies the structural description.
- Consume the internal ambiguity marker from task 1-2's `classifyStructure`. Resolution logic in `detectType`:
  1. Compute `wantsPlugin = forcePlugin === true || configType === "plugin"`. Precedence (`--plugin` > config) only matters when the two *disagree* — but config `type` has no value other than `"plugin"` that could disagree, so in practice both inputs only ever push toward "plugin." Record nothing extra; `wantsPlugin` captures the combined intent. (Document this: the precedence rule is observable only in the skills-only case where it is moot because both want the same outcome; it becomes load-bearing in Phase 2/3 if `--plugin` is ever passed against a structure config `type` did not request. Keep the resolution centralised here.)
  2. If structure is **skills-only ambiguous**:
     - `wantsPlugin` true → return `{ type: "plugin", assetDirs: ["skills"] }`.
     - else → return the default `{ type: "collection", plugins }` (the skills-only menu).
  3. If structure is **plugin** (multi-asset / non-skills-only): `wantsPlugin` true → redundant no-op, return the plugin as-is. (`--plugin`/`type:"plugin"` agree.)
  4. If structure is **bare-skill**: `wantsPlugin` true → throw `TypeConflictError` ("bare skill cannot be bundled as a plugin"). Else return bare-skill.
  5. If structure is **member-dirs collection**: `wantsPlugin` true → throw `TypeConflictError` ("collection of N members cannot be bundled as a plugin"). Else return collection.
  6. If structure is **not-agntc**: overrides are irrelevant; return not-agntc (a not-agntc source is its own hard error at the caller, not a type conflict). Do **not** throw `TypeConflictError` for not-agntc.
- **Recognition of `type`**: only the exact string `"plugin"` counts. Any other `configType` value (including `"collection"`, `"skill"`, `"bundle"`, empty string, etc.) is treated as if `configType` were absent — it does **not** set `wantsPlugin` and never reaches the error path. This is the leniency boundary: unrecognised `type` is ignored like an unknown key (task 1-1 already passes it through raw; recognition is gated here).
- Ensure the throw happens **before any filesystem mutation** — `detectType` is pure read/classify, so this is naturally pre-flight; just confirm no copy/write occurs in this module.
- The `--plugin > config type` precedence is centralised here so Phase 2 callers pass both inputs and get one resolved answer; callers never re-implement precedence.

**Acceptance Criteria**:
- [ ] Skills-only structure + `configType:"plugin"` → `plugin`.
- [ ] Skills-only structure + `forcePlugin:true` → `plugin`.
- [ ] Skills-only structure + both → `plugin` (agreement; flag-beats-config is moot but resolution is centralised).
- [ ] Skills-only structure + neither → `collection` (default menu).
- [ ] Multi-asset plugin structure + `forcePlugin:true` (or `configType:"plugin"`) → `plugin` unchanged (redundant no-op, no throw).
- [ ] Bare-skill structure + `configType:"plugin"` → throws `TypeConflictError`; + `forcePlugin:true` → throws identically.
- [ ] Member-dirs collection structure + `configType:"plugin"` → throws `TypeConflictError` (message names member count); + `forcePlugin:true` → throws identically.
- [ ] `configType:"collection"` → ignored; structure stands (never throws).
- [ ] Any other/unknown `configType` value → ignored; structure stands.
- [ ] not-agntc structure + any override → returns `not-agntc` (no `TypeConflictError`).
- [ ] The thrown error is a `TypeConflictError` whose message describes the structural conflict (resolved type vs. requested bundle).

**Tests** (extend `tests/type-detection.test.ts`, new `override resolution` describe block):
- `"bundles skills-only as plugin with config type plugin"`
- `"bundles skills-only as plugin with forcePlugin flag"`
- `"bundles skills-only when both overrides agree"`
- `"leaves skills-only as collection with no override"`
- `"forcePlugin is a no-op on a multi-asset plugin"`
- `"config type plugin is a no-op on a multi-asset plugin"`
- `"throws TypeConflictError for config type plugin on a bare skill"`
- `"throws TypeConflictError for forcePlugin on a bare skill"`
- `"throws TypeConflictError for config type plugin on a member-dirs collection"`
- `"throws TypeConflictError for forcePlugin on a member-dirs collection"`
- `"ignores config type collection (structure stands)"`
- `"ignores an unknown config type value (structure stands)"`
- `"does not throw TypeConflictError for a not-agntc source with overrides"`
- `"TypeConflictError message names the structural conflict"`

**Edge Cases**:
- `--plugin` vs config `type` on skills-only: both push to plugin → agree; flag-wins is unobservable but resolution stays centralised (don't leak precedence to callers).
- `configType:"collection"`, `""`, `"skill"`, unknown → ignored (not recognised), never error.
- not-agntc + override → no `TypeConflictError` (its rejection is the caller's not-agntc handling, a distinct error class).
- Bare-skill + override and member-dirs collection + override are the two contradiction cases; both throw the same error type.

**Context**:
> Spec — *Structural Type Detection → Detection precedence*: "1. Install flag `--plugin` (highest). 2. Config `type`. 3. Structure (default)."
> Spec — *Type-vs-structure conflict → hard error*: "`type: plugin` on a member-dirs collection → error. `type: plugin` on a bare skill → error. `--plugin` on a member-dirs collection (or any non-bundleable structure) → error, exactly as `type: plugin` would. The flag's *only* extra power is winning the tie in the ambiguous case." And: "The realizability error applies only to the recognised value `type: "plugin"`. `type: "collection"` and any other value are unrecognised and silently ignored — so they never reach this error path."
> Spec — *Recognised `type` values*: "The only recognised `type` value is `"plugin"`. Any other `type` value — including `"collection"` — is unrecognised and ignored."
> Spec — *Error & Abort Behaviour → Hard errors (detection-time, before any write)*: type-vs-structure conflicts are pre-flight failures; the message names the offending source/unit and what conflicted. (The detector supplies the structural half of the message; the caller prepends source identity.)
> This task does **not** wire `--plugin` into the `add` command surface (CLI flag parsing, forwarding) — that is Phase 2. Here the override is an input parameter to `detectType`.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Structural Type Detection*, *Error & Abort Behaviour*, *Config Model*.

---

## configless-install-1-5 | approved

### Task configless-install-1-5: KNOWN_AGENTS default in selectAgents

**Problem**: `selectAgents` returns `[]` ("install for nobody") whenever `declaredAgents` is empty. That was correct under v1 (config mandatory → empty meant misconfigured) but is the configless footgun: "no declaration" is now a legitimate, common state meaning "installable for anything." The fix is to source the candidate list from `KNOWN_AGENTS` when there is no valid author declaration, while leaving the declared-agents hard-ceiling and single-declared-detected auto-select untouched.

**Solution**: Branch `selectAgents` on whether a valid declaration exists. With a valid non-empty `declaredAgents` → today's behaviour exactly (ceiling + single-detected auto-select + prompt over declared options). With no valid declaration (empty `declaredAgents`) → offer **all** `KNOWN_AGENTS` as candidates, pre-tick detected ones, and **always prompt** (no auto-select in this path, even if exactly one agent is detected). User cancel / zero selection still returns `[]`.

**Outcome**: `selectAgents({ declaredAgents: [], detectedAgents: ["claude"] })` prompts with all of claude/codex/cursor, claude pre-ticked, and returns the user's pick (never auto-selects). `selectAgents({ declaredAgents: ["claude"], detectedAgents: ["claude"] })` still auto-selects `["claude"]` without prompting. The `return []` "install for nobody" path on empty declaration is gone (replaced by the prompt-over-KNOWN_AGENTS path); `[]` is now returned only on cancel or deliberate zero-selection.

**Do**:
- In `src/agent-select.ts`, import `KNOWN_AGENTS` from `./config.js` (it is already exported there).
- Replace the opening `if (input.declaredAgents.length === 0) { return []; }` guard with a branch that builds a **candidate list**: `const candidates = input.declaredAgents.length > 0 ? input.declaredAgents : [...KNOWN_AGENTS];` and a `hasDeclaration = input.declaredAgents.length > 0` flag.
- **Auto-select** stays gated on `hasDeclaration && candidates.length === 1 && detected`: only when there is exactly one *declared* agent and it is detected. The no-declaration default must **never** auto-select, even if exactly one agent is detected — guard the auto-select branch with `hasDeclaration`.
- Build `options` and `initialValues` from `candidates` (pre-tick = candidates ∩ detected), exactly as today but over the candidate list. In the no-declaration path the "(not detected in project)" label still applies to undetected `KNOWN_AGENTS`.
- Keep the `multiselect` call, the `isCancel` → `[]` path, and the zero-selection → `[]` (with the "No agents selected — skipping" info log) path unchanged. These remain the only routes to `[]`.
- Confirm `KNOWN_AGENTS` order is `["claude","codex","cursor"]` so the default candidate ordering is deterministic for tests.

**Acceptance Criteria**:
- [ ] No declaration (`declaredAgents: []`) → `multiselect` is called with all three `KNOWN_AGENTS` as options (the `return []` early-exit is gone).
- [ ] No declaration → detected agents are pre-ticked (`initialValues` = detected ∩ `KNOWN_AGENTS`).
- [ ] No declaration with exactly one detected agent → still **prompts** (no auto-select); returns whatever the user picks.
- [ ] Valid non-empty declaration → options are exactly the declared agents (hard ceiling); undeclared agents never appear — unchanged from today.
- [ ] Single declared agent that is detected → auto-selects without prompting — unchanged from today.
- [ ] Cancel returns `[]`; zero selection returns `[]` with the info log — unchanged.

**Tests** (extend `tests/agent-select.test.ts`):
- `"offers all KNOWN_AGENTS when there is no declaration"` — `declaredAgents: []`; assert `multiselect` options are `["claude","codex","cursor"]`
- `"pre-ticks detected agents in the no-declaration default"` — `declaredAgents: [], detectedAgents: ["codex"]`; assert `initialValues` is `["codex"]`
- `"never auto-selects in the no-declaration default even with one detected"` — `declaredAgents: [], detectedAgents: ["claude"]`; assert `multiselect` **was** called and the result is the user pick (not an auto-select bypass)
- `"returns the user pick from the KNOWN_AGENTS prompt"` — mock multiselect → `["cursor"]`; assert returns `["cursor"]`
- `"no-declaration default returns [] on cancel"` — mock cancel symbol
- `"no-declaration default returns [] on zero selection with info log"`
- Update/replace the existing `"empty declaredAgents yields zero options"` and `"returns empty array for zero declared agents without prompting"` tests — they assert the **old** `return []` behaviour and now contradict the spec; rewrite them to expect the KNOWN_AGENTS prompt.
- Retain unchanged: `"auto-selects when one declared agent is detected"`, the declared-ceiling option/label tests, the multi-declared prompt tests.

**Edge Cases**:
- No declaration + one detected → prompt (no auto-select). This is the explicit divergence from the declared-single path.
- No declaration + zero detected → prompt with all three, none pre-ticked.
- Cancel / zero-selection in the default path → `[]` (the only remaining `[]` routes).
- Valid declaration of one detected agent → auto-select (unchanged).

**Context**:
> Spec — *Agent Selection → Decision*: "Valid, non-empty `agents` in config → hard ceiling, exactly as today. No valid constraint → offer all `KNOWN_AGENTS` (claude / codex / cursor), pre-tick detected agents, user picks. This replaces the `return []` footgun."
> Spec — *Agent detection signal and auto-select interaction*: "Pre-tick, always prompt in the no-constraint default... There is **no auto-select** in this path — a multi-candidate list always warrants a choice. Auto-select stays scoped to the declared-single-agent case only... The configless default never auto-selects even if exactly one agent is detected, because the ceiling (all `KNOWN_AGENTS`) is not a single-agent declaration."
> Spec — *"No valid constraint" — unified across three cases*: config absent, `agents:[]`, and malformed config all reduce to "no valid declaration." Since task 1-1 makes `readConfig` return `null` for all three, callers pass `declaredAgents: []` (or `config?.agents ?? []`) in every no-usable-config case, so `selectAgents` only needs the single empty-vs-non-empty branch here. (Wiring the caller to pass `[]` from a `null` config is Phase 2.)

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Agent Selection*.
