---
phase: 4
phase_name: Manifest type lifecycle (record, replay, derive-before-delete, legacy backfill)
total: 7
---

## configless-install-4-1 | approved

### Task configless-install-4-1: Add optional type field and persist on standalone install

**Problem**: `ManifestEntry` (`src/manifest.ts` ~9–17) carries `ref, commit, installedAt, agents, files, cloneUrl, constraint` — but **no `type` field**. The spec mandates recording the resolved type so `update` can *replay* it rather than blindly re-detecting (which under configless could silently morph a plugin into a collection when an author drops `agntc.json`). Today the standalone install write point in `runAdd` (`src/commands/add.ts` ~297–307) builds the entry from `detected.type` (the Phase 2 resolved `DetectedType.type`, one of `bare-skill | plugin`) but never persists that type. Without it, the lifecycle hazard the spec calls out is open and every later Phase 4 task (replay, derive-before-delete, abort) has no recorded fact to act on. Note the mapping seam: `DetectedType.type` is `"bare-skill"` whereas the persisted `ManifestEntry.type` must be `"skill"` — a `bare-skill → "skill"` mapping is required at the write point.

**Solution**: Add an **optional** `type?: "skill" | "plugin"` field to the `ManifestEntry` interface (optional so legacy manifests that predate it still parse — every reader must tolerate its absence; backfill of legacy entries is task 4-3). At the standalone `addEntry` write point in `runAdd` (~297), map the resolved `detected.type` to the manifest type value — `bare-skill → "skill"`, `plugin → "plugin"` — and persist it on the entry. This single recorded value collapses all three derivation paths (structure, config `type`, `--plugin`): whatever `detectType` resolved (including a `--plugin`- or config-`type`-bundled skills-only repo, which Phase 1/2 resolve to `{ type: "plugin", assetDirs: ["skills"] }`) lands as `"plugin"`; a bare skill lands as `"skill"`. The tree-path (direct-path) standalone unit routed through this same write point (Phase 2 task 2-3) records its own resolved type identically — no special-casing.

**Outcome**: After `agntc add referodesign/refero_skill` the manifest entry for `owner/repo` carries `type: "skill"`. After installing a configless multi-asset plugin the entry carries `type: "plugin"`. After `agntc add owner/skills-only --plugin` (or a config `type: "plugin"` skills-only repo) the entry carries `type: "plugin"`. A direct-path standalone unit (`owner/repo/<subpath>`) records its own resolved type. The `type` field is optional, so a manifest written before this change still reads without error. No other entry fields change.

**Do**:
- In `src/manifest.ts`, add `type?: "skill" | "plugin";` to the `ManifestEntry` interface (~9–17). Place it after `files` for readability; it must be **optional** (`?`) — a missing `type` must never break `readManifest`/`writeManifest`/`addEntry` or any reader. Do not change `Manifest`, `writeManifest`, `addEntry`, or `removeEntry` signatures.
- Introduce a small mapping from the resolved `DetectedType.type` to the manifest type value. Recommended: a pure helper (e.g. `manifestTypeFromDetected(t: "bare-skill" | "plugin"): "skill" | "plugin"`) co-located where it is used (in `src/commands/add.ts`, or a tiny shared util) returning `t === "bare-skill" ? "skill" : "plugin"`. Keep it total over the two standalone-installable variants; `collection`/`not-agntc` never reach the standalone write point (Phase 2 routes/exits them before this).
- In `src/commands/add.ts` `runAdd`, at the standalone manifest entry construction (~297–305, the object literal assigned to `entry` then passed to `addEntry(currentManifest, parsed.manifestKey, entry)`), add `type: manifestTypeFromDetected(detected.type)` to the entry object. `detected.type` here is the single resolved type from the Phase 2 unified `detectType` call (`bare-skill | plugin` at this point in the flow). Do **not** read or re-derive type from config or structure again — the resolved `detected.type` is the authoritative fact.
- Ensure the direct-path standalone case (Phase 2 task 2-3 routes a tree-path source through this same standalone write point with key `owner/repo/<subpath>`) records its resolved type through the identical line — no separate branch needed, because task 2-3 unified detection against `unitDir` and reuses this write point.
- Leave the **collection member** write point (~612) for task 4-2 (it depends on this interface change but is a distinct entry site).
- Do **not** touch `nuke-reinstall-pipeline.ts`, `update.ts`, or backfill (`readManifest`) here — recording on install is this task; replay/backfill are 4-3/4-4/4-5.

**Acceptance Criteria**:
- [ ] `ManifestEntry.type` exists and is optional (`type?: "skill" | "plugin"`); a manifest object literal omitting `type` still type-checks and round-trips through `writeManifest`/`readManifest`.
- [ ] A standalone bare-skill install (`detected.type === "bare-skill"`) writes an entry with `type: "skill"`.
- [ ] A standalone plugin install (`detected.type === "plugin"`) writes an entry with `type: "plugin"`.
- [ ] A skills-only repo bundled via `--plugin` or config `type: "plugin"` (resolved by Phase 1/2 to `{ type: "plugin", ... }`) writes `type: "plugin"`.
- [ ] A direct-path standalone unit keyed `owner/repo/<subpath>` writes its own resolved type via the same write point.
- [ ] The `bare-skill → "skill"` mapping is applied (the persisted value is never the literal string `"bare-skill"`).
- [ ] All other entry fields (`ref`, `commit`, `installedAt`, `agents`, `files`, `cloneUrl`, `constraint`) are unchanged.

**Tests** (`tests/manifest.test.ts` for the interface/round-trip; `tests/commands/add.test.ts` for the write-point mapping — `addEntry`/`writeManifest` are mocked/spied there):
- `"ManifestEntry without a type field round-trips through write/read"` — write a manifest whose entry omits `type`; assert `readManifest` returns it without error and `type` is absent (sets up legacy tolerance for 4-3).
- `"standalone bare skill records type: skill"` — `mockDetectType` → `{ type: "bare-skill" }`; assert `addEntry` called with an entry whose `type === "skill"` for key `owner/my-skill`.
- `"standalone plugin records type: plugin"` — `mockDetectType` → `{ type: "plugin", assetDirs: ["skills","agents"] }`; assert `addEntry` entry `type === "plugin"`.
- `"a --plugin-bundled skills-only repo records type: plugin"` — `mockDetectType` (with `forcePlugin`) → `{ type: "plugin", assetDirs: ["skills"] }`; assert `type === "plugin"`.
- `"a direct-path standalone unit records its resolved type"` — tree-path source, `mockDetectType` against `unitDir` → `{ type: "bare-skill" }`; assert `addEntry` key `owner/my-collection/pluginA` carries `type: "skill"`.
- `"bare-skill is mapped to skill, never persisted verbatim"` — assert the persisted value is `"skill"`, not `"bare-skill"`.

**Edge Cases**:
- Resolved `bare-skill` → persisted `"skill"` (the mapping seam).
- Skills-only bundled (config `type`/`--plugin`) → resolved `plugin` → persisted `"plugin"` (the three derivation paths collapse to one recorded value).
- Direct-path standalone unit → records its own resolved type at the shared write point.
- Legacy entry with no `type` → still parses (tolerance; backfill is 4-3).

**Context**:
> Spec — *Manifest Keying & Lifecycle → Decision: record the resolved type, replay it, never silently morph*: "**Add a `type` field to `ManifestEntry`**, values `"skill" | "plugin"` only. A collection is never stored — its selected children persist as their own skill/plugin entries keyed `owner/repo/<unit>`. However the type was derived (structure, config `type`, or `--plugin`), the *resolved* value is what's persisted. The three derivation paths collapse to one recorded fact."
> Spec — *`type` field: optionality and backfill timing*: "**`type` is optional on the `ManifestEntry` interface** (`type?: "skill" | "plugin"`). It must be optional so legacy manifests (which predate the field) still parse; every reader must tolerate its absence."
> Spec — *Manifest Keying & Lifecycle → Current behaviour*: "`ManifestEntry` today carries `ref, commit, installedAt, agents, files, cloneUrl, constraint` — **no `type` field**."
> Mapping seam: `DetectedType.type` is `"bare-skill"` (`src/type-detection.ts` ~12–14) while `ManifestEntry.type` is `"skill"` — the write point maps `bare-skill → "skill"`.
> Phase 2 contract: `runAdd` runs a single `detectType` and the standalone write point at `src/commands/add.ts` ~297 builds the entry from the resolved `detected.type` (`bare-skill | plugin`); task 2-3 routes direct-path standalone units through the same write point.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Manifest Keying & Lifecycle*.

---

## configless-install-4-2 | approved

### Task configless-install-4-2: Persist resolved type on each collection member entry

**Problem**: The collection pipeline records *each selected child as its own manifest entry* keyed `owner/repo/<unit>` (the collection is a transport, never a stored unit — there is no collection-level entry). The member write point in `runCollectionPipeline` (`src/commands/add.ts` ~606–622) builds each member entry from `result.agents`, `result.copiedFiles`, etc., but — like the standalone site before task 4-1 — never persists the member's resolved type. Each member's resolved type is already in scope: the per-member install result carries `detectedType: pluginDetected` (`Extract<DetectedType, { type: "bare-skill" | "plugin" }>`, set when a member is installed, see ~589 and the `results.push({ ... detectedType: pluginDetected })` sites). Without persisting it, member entries have no recorded type to replay on `update`, leaving collection members exposed to the same silent-morph hazard as standalone units, and breaking the per-member abort/replay rules (tasks 4-4/4-5/4-7).

**Solution**: Depending on task 4-1's `ManifestEntry.type` interface field, persist each member's resolved type at the member `addEntry` site (~612), mapping `result.detectedType.type` via the same `bare-skill → "skill"` / `plugin → "plugin"` mapping used in 4-1. A skill member records `type: "skill"`; a plugin member records `type: "plugin"`. Configless and config-bearing members alike record their type (type comes from structural resolution, not config). No collection-container entry is written (unchanged — the pipeline only writes per-installed-member entries, and skipped members produce no entry). A direct-path single member (keyed `owner/repo/<unit>` via `parsed.manifestKey`) records its type identically.

**Outcome**: After installing a collection with a bare-skill member `member-a` and a plugin member `member-b`, the manifest has `owner/repo/member-a` with `type: "skill"` and `owner/repo/member-b` with `type: "plugin"`, and **no** `owner/repo` collection-level entry. A configless member and a config-bearing member both record their structurally-resolved type. A direct-path single member records its own type.

**Do**:
- **Depends on task 4-1** (the `ManifestEntry.type` interface field and the `bare-skill → "skill"` mapping helper). Reuse the same `manifestTypeFromDetected` helper.
- In `src/commands/add.ts` `runCollectionPipeline`, at the per-member entry construction in the manifest-write loop (~606–621), add `type: manifestTypeFromDetected(result.detectedType.type)` to each member's entry object. The `result` is a successfully-`"installed"` `PluginInstallResult`; its `detectedType` field (set at the install push sites, e.g. ~584–590) is the member's resolved `DetectedType` (`bare-skill | plugin`). Skipped/failed results are already filtered out earlier in the loop (`if (result.status !== "installed") continue;` ~607), so only installed members — which always carry `detectedType` — reach the entry construction.
- Confirm `PluginInstallResult` (in `src/summary.ts`) carries `detectedType` on the `"installed"` variant such that `result.detectedType.type` is `"bare-skill" | "plugin"` at this site. If TypeScript cannot narrow `detectedType` to present-and-non-optional here, narrow via the already-applied `status === "installed"` guard, or assert/guard before the map — do **not** loosen the entry `type` to optional-by-accident; an installed member always has a resolved type.
- Do **not** write any collection-level entry. There is deliberately no collection record (the spec: "A collection is never stored"). The loop already keys each member `parsed.type === "direct-path" ? parsed.manifestKey : \`${parsed.manifestKey}/${result.pluginName}\`` — leave keying untouched (task 3-6 owns it).
- Configless vs config-bearing makes no difference to the recorded type: type is resolved structurally per member (Phase 3 task 3-1), so a `null`-config member and a config-bearing member both have a `detectedType` and record it identically. No config read feeds the type value.
- Do **not** touch the standalone write point (task 4-1) or `update`/backfill.

**Acceptance Criteria**:
- [ ] Each installed collection member entry persists `type`, mapped from its resolved `detectedType` (`bare-skill → "skill"`, `plugin → "plugin"`).
- [ ] A mixed collection (skill member + plugin member) records `type: "skill"` and `type: "plugin"` on the respective entries.
- [ ] A configless member and a config-bearing member both record their structurally-resolved type (config presence does not change the recorded type).
- [ ] **No** collection-container entry (`owner/repo`) is written; only per-installed-member entries exist.
- [ ] A direct-path single member keyed `owner/repo/<unit>` records its own resolved type.
- [ ] Skipped/failed members produce no entry (unchanged) and therefore no `type`.

**Tests** (`tests/commands/add.test.ts`, `collection type` describe — extend the member-install assertions):
- `"each member records its resolved type"` — member-a re-detects `bare-skill`, member-b re-detects `{ type: "plugin", assetDirs: ["skills"] }`; assert `addEntry` for `owner/my-collection/member-a` carries `type: "skill"` and `owner/my-collection/member-b` carries `type: "plugin"`.
- `"configless and config-bearing members both record type"` — member-a configless (`readConfig` → `null`) re-detects `bare-skill`; member-b config-bearing re-detects `plugin`; assert both entries carry the correct `type`.
- `"no collection-container entry is written"` — assert `addEntry` is **never** called with key `owner/my-collection` (only the member sub-keys).
- `"a direct-path single member records its type"` — direct-path, `targetPlugin: "member-a"`, re-detect `bare-skill`; assert `addEntry` key `owner/my-collection/member-a` carries `type: "skill"`.
- `"a skipped member produces no entry and no type"` — member-b skipped (structural re-detect `not-agntc`); assert no `addEntry` for member-b.

**Edge Cases**:
- Mixed skill/plugin members → each records its own type.
- Configless member → structural type recorded (no config dependency).
- Skipped member → no entry, no type.
- Direct-path single member → records type under `owner/repo/<unit>`.
- Collection container → never recorded.

**Context**:
> Spec — *Manifest Keying & Lifecycle → Decision: record the resolved type*: "A collection is never stored — its selected children persist as their own skill/plugin entries keyed `owner/repo/<unit>`. However the type was derived ... the *resolved* value is what's persisted."
> Spec — *Manifest Keying & Lifecycle → Current behaviour*: "**A collection is a transport, not a stored unit** — the collection pipeline records *each selected child as its own entry*. No collection-level entry exists."
> Spec — *Backfill is per manifest entry*: "Backfill is per manifest entry, and an entry is always a unit (skill/plugin) — never a collection." (The same invariant the record path must uphold.)
> Mapping seam: member `detectedType.type` is `bare-skill | plugin`; the entry `type` is `skill | plugin` — reuse task 4-1's mapping.
> Phase 3 contract: members are enumerated/installed structurally per child (task 3-1/3-2); each installed member result carries `detectedType: pluginDetected`. Keying is `owner/repo/<unit>` (task 3-6).
> Depends on task 4-1's `ManifestEntry.type` field and mapping helper.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Manifest Keying & Lifecycle*.

---

## configless-install-4-3 | approved

### Task configless-install-4-3: Legacy backfill of type from files on manifest read

**Problem**: Existing manifests predate the `type` field, so a legacy entry has no recorded type for `update` to replay. The spec is explicit that the type must **not** be re-derived from a fresh re-clone/re-detection: backfill runs at the first `update`, which re-clones the *current* remote, and an author may have dropped `agntc.json` by then (the exact configless migration this feature enables) — a shape-unchanged but now config-absent skills-only repo would silently re-derive as `collection`, flipping a `plugin` install. The local install (the recorded `files`) is the ground truth. `readManifest` (`src/manifest.ts` ~24–47) already has the precedent: an inline loop backfills `cloneUrl` for pre-`cloneUrl` manifests (~40–44). The `type` backfill must mirror that: derive `type` from `files` in-memory on read, so `type` is available uniformly to *every* command that reads the manifest (`list`, `remove`, `update`) — not just `update` — and persist it on the next write.

**Solution**: Add a second inline backfill loop in `readManifest`, alongside the `cloneUrl` one: for each entry lacking a `type`, derive `"skill" | "plugin"` from its `files` and populate it on the in-memory entry. The derivation predicate (from the spec):
- Files that wrote to an **`agents/` or `hooks/` target** → `plugin`.
- Files that hold **multiple skill dirs under one key** (more than one `<skills-target>/<name>/` directory) → `plugin`.
- A **single skills dir** (exactly one `<skills-target>/<name>/`, no `agents/`/`hooks/` targets) → `skill` (the accepted single-skill ambiguity: a single-skill plugin backfills as `skill`; safe, because replay re-copies the one skill dir identically).
- An entry **already carrying `type`** is left untouched (not overwritten).
- An **empty `files` array** (or files matching no asset target) → default to `skill` (the lenient common case; replay validates against the tree anyway, and a vanished/empty install will abort on the predicate at update). Backfill is **total** — every `files` shape maps to exactly one of `skill`/`plugin`; reading must never error on the missing field.

Use the existing `identifyFileOwnership` (`src/drivers/identify.ts`) to classify each file path into its `assetType` (`skills`/`agents`/`hooks`) across all registered drivers' target dirs, so per-agent target paths (`.claude/skills/...`, `.agents/skills/...`, `.cursor/skills/...`) are all recognised. Counting distinct skill *dirs* uses the top-level skill-dir segment of each `skills`-owned path.

**Outcome**: Reading a legacy manifest populates `type` on every entry in-memory: an entry whose `files` include `.claude/agents/...` or `.claude/hooks/...` → `plugin`; an entry with two `.claude/skills/<a>/` and `.claude/skills/<b>/` dirs → `plugin`; an entry with a single `.claude/skills/<name>/` → `skill`; an entry already having `type` is unchanged. Reading never throws on a missing `type`. The backfilled `type` persists on the next `writeManifest` (e.g. after the first `update`). `list`/`remove`/`update` all see the backfilled type.

**Do**:
- In `src/manifest.ts` `readManifest`, after the existing `cloneUrl` backfill loop (~40–44) and before `return parsed as unknown as Manifest;` (~46), add a `type` backfill loop over `Object.values(parsed)`: `if (!("type" in entry)) { entry.type = deriveTypeFromFiles(entry.files as string[]); }`. Mirror the `cloneUrl` loop's in-memory mutation style (mutate the parsed entry; persistence happens on the next write, exactly as `cloneUrl` does today).
- Implement `deriveTypeFromFiles(files: string[]): "skill" | "plugin"` (a pure helper, in `src/manifest.ts` or a small co-located module). Logic:
  1. For each file path, call `identifyFileOwnership(file)` (import from `./drivers/identify.js`). Collect the set of `assetType`s present.
  2. If any file is owned by `agents` or `hooks` → return `"plugin"`.
  3. Otherwise (only `skills`-owned and/or unrecognised paths): count distinct **skill directories** — derive each skills-owned path's first path segment *after* its `skills` target dir (the `<name>` in `<skills-target>/<name>/...`). If the count of distinct skill-dir names is `> 1` → `"plugin"`.
  4. Else (≤1 skill dir, no `agents`/`hooks`, or empty/unrecognised `files`) → `"skill"`.
- Keep the predicate **total and non-throwing**: a path `identifyFileOwnership` returns `null` for (an unrecognised/unmanaged path) contributes nothing; an empty `files` array yields `"skill"` by the default. Never throw from backfill.
- Do **not** re-clone, re-detect, or read config in backfill — derive solely from the local `files`. (This is the load-bearing anti-drift guarantee.)
- Backfill is **per entry** and an entry is always a unit (skill/plugin) — a legacy collection-member entry (`owner/repo/<unit>`) backfills from its own `files` like any other unit. No collection type is ever derived.
- Confirm `list`/`remove` read through `readManifest`/`readManifestOrExit` and therefore receive the backfilled `type` automatically — no change needed in those commands (they tolerate and benefit from the field). Note: `list`/`remove` must not *require* `type`; they only benefit.
- Verify persistence: the backfilled `type` is on the in-memory entry, so any subsequent `writeManifest(projectDir, manifest)` (e.g. update's manifest write ~92/~539) persists it. No explicit "write on read" is added (mirrors `cloneUrl`).

**Acceptance Criteria**:
- [ ] A legacy entry whose `files` include an `agents/` or `hooks/` target backfills `type: "plugin"`.
- [ ] A legacy entry with **multiple** distinct skill dirs under one key (e.g. two `.claude/skills/<a>/`, `.claude/skills/<b>/`) backfills `type: "plugin"`.
- [ ] A legacy entry with a **single** skills dir and no `agents/`/`hooks/` targets backfills `type: "skill"` (single-skill ambiguity accepted).
- [ ] An entry that **already** has `type` is not overwritten by backfill.
- [ ] Per-agent skills target paths (`.claude/skills/`, `.agents/skills/`, `.cursor/skills/`) are all recognised via `identifyFileOwnership`.
- [ ] An empty `files` array backfills to `type: "skill"` (lenient default) without error.
- [ ] Reading a legacy manifest **never errors** on the missing `type` field; backfill is total.
- [ ] `list` and `remove` (reading via `readManifest`) receive the backfilled `type`; the backfilled value persists on the next `writeManifest`.
- [ ] Backfill derives from local `files` only — no re-clone, re-detect, or config read.

**Tests** (extend `tests/manifest.test.ts`):
- `"backfills type: plugin when files include an agents target"` — entry `files: [".claude/agents/foo/"]`, no `type`; assert read entry `type === "plugin"`.
- `"backfills type: plugin when files include a hooks target"` — `files: [".claude/hooks/bar.sh"]`; assert `"plugin"`.
- `"backfills type: plugin for multiple skill dirs under one key"` — `files: [".claude/skills/a/", ".claude/skills/b/"]`; assert `"plugin"`.
- `"backfills type: skill for a single skills dir (single-skill ambiguity accepted)"` — `files: [".claude/skills/only/", ".claude/skills/only/SKILL.md"]`; assert `"skill"`.
- `"does not overwrite an existing type"` — entry with `type: "plugin"` but skill-only files; assert it stays `"plugin"`.
- `"recognises per-agent skills targets"` — `files: [".agents/skills/x/"]` and `files: [".cursor/skills/y/"]`; assert each → `"skill"`.
- `"backfills empty files to skill without error"` — `files: []`; assert `"skill"`, no throw.
- `"reading a legacy manifest with no type field never errors"` — manifest of mixed entries lacking `type`; assert `readManifest` resolves and every entry has a `type`.
- `"a legacy collection-member entry backfills from its own files"` — key `owner/repo/member-a`, `files: [".claude/skills/member-a/"]`; assert `type === "skill"` (never a collection type).
- `"the cloneUrl and type backfills coexist"` — entry missing both; assert both populated.

**Edge Cases**:
- Single skill dir, no asset targets → `skill` (a single-skill *plugin* backfills as `skill`; safe — identical replay; the rare divergence is the user's manual `remove`+`add` remedy if the author later adds an asset dir).
- Multiple skill dirs under one key → `plugin`.
- `agents/`/`hooks/` target present → `plugin`.
- Empty `files` / all-unrecognised paths → `skill` default; never throw.
- Entry already typed → untouched.
- Legacy collection-member entry → backfills as a unit from its own files; no collection type.

**Context**:
> Spec — *Legacy backfill (pre-`type` manifest entries)*: "**Backfill `type` from the recorded `files`** (the local install is ground truth) — **not** from a fresh re-clone or re-detection." "an entry that wrote to `agents/`/`hooks/` targets, or holds multiple skill dirs under one key → `plugin`; a single `.claude/skills/<name>/` → bare skill. Backfill reads `files`, records `type`, and is therefore immune to any drift in the remote's current config or shape."
> Spec — *Single-skill ambiguity is accepted collateral*: "A legacy entry whose `files` are a single `.claude/skills/<name>/` (or the equivalent per-agent skills dir) with no `agents/`/`hooks/` targets backfills as `skill`, even if it was originally bundled as a single-skill plugin — the two are indistinguishable from `files` alone. This is safe: replay behaviour is identical ... legacy backfill favours the common case (bare skill) over the rare one."
> Spec — *`type` field: optionality and backfill timing*: "**Backfill happens in-memory on manifest *read*** — mirroring the existing inline `cloneUrl` backfill in `readManifest`. When a legacy entry lacking `type` is read, its type is derived from `files` ... then **persisted on the next manifest write**. This makes `type` available uniformly to *all* commands that read the manifest (`list`, `remove`, `update`) ... Reading legacy manifests never errors on the missing field; backfill is total (every `files` shape maps to exactly one of `skill`/`plugin`)."
> Spec — *Backfill is per manifest entry*: "an entry is always a unit (skill/plugin) — never a collection. A legacy collection-member entry (`owner/repo/<unit>`) backfills from its own `files` like any other unit."
> Existing precedent: `readManifest` (`src/manifest.ts` ~40–44) already backfills `cloneUrl` inline on read. `identifyFileOwnership` (`src/drivers/identify.ts`) classifies a file path into `{ agentId, assetType }` across registered drivers' target dirs.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Manifest Keying & Lifecycle (Legacy backfill, `type` field optionality and backfill timing)*, *Backward-Compat / Migration*.

---

## configless-install-4-4 | approved

### Task configless-install-4-4: Update replays recorded skill type with derive-before-delete validation

**Problem**: `executeNukeAndReinstall` (`src/nuke-reinstall-pipeline.ts`) today **blindly re-detects** type on update: it reads config and calls `detectType(sourceDir, { hasConfig: true, onWarn })` (~84–88), treats `not-agntc`/`collection` as `invalid-type` (~90–92), then **nukes** the existing files (~101) *before* copying. Under configless this is the silent-morph hazard: a recorded **skill** whose remote dropped `agntc.json` (or gained an `agents/` dir) could re-detect as something else, or — worse — files are deleted *before* discovering the unit can no longer be reinstalled, stranding the install. The spec mandates **replay** the recorded type (not re-derive it) and **derive-before-delete**: validate the re-cloned tree supports the recorded type *before* any file removal. For a recorded `skill`, the predicate is: the unit's root `SKILL.md` must still exist; if so, re-copy the unit dir as a bare skill (ignoring any newly-added asset dirs — the *recorded* type is authoritative, not a re-derivation); if `SKILL.md` is gone → **abort** with no files removed.

**Solution**: Rework `executeNukeAndReinstall` to consume the recorded type from `existingEntry.type` (present after tasks 4-1/4-2 on new installs, and after task 4-3 backfill on legacy installs) and **replace blind re-detection with recorded-type replay + a derive-before-delete validation gate**. For a recorded `skill`: validate `exists(join(sourceDir, "SKILL.md"))` against the re-cloned tree *before* `nukeManifestFiles`; if present, copy the unit dir via `copyBareSkill` (regardless of any added asset dirs); if absent, return a new **abort** result (no nuke, install left intact). This task establishes the validate-before-nuke seam and the skill predicate (the plugin predicate is task 4-5, building on this seam); member-entry subdir validation (the recorded type applied to the member's own `owner/repo/<unit>` subdir, where a vanished subdir is the common trigger) is covered here for the `skill` case because the member's `sourceDir` is already its own subdir via `getSourceDirFromKey` (`src/clone-reinstall.ts` ~153). The new abort result is surfaced through reporting in task 4-6.

**Outcome**: `agntc update <key>` for a recorded-`skill` entry whose re-cloned tree still has `SKILL.md` re-copies the unit dir as a bare skill — even if the author added an `agents/` dir (it is ignored; recorded `skill` is replayed, not re-derived). If `SKILL.md` has vanished from the re-cloned tree (e.g. restructured into a collection), the update **aborts** for that entry: `nukeManifestFiles` is **not** called, the existing install is fully intact, and a distinct abort result is returned (its reporting is task 4-6). A member entry whose own subdir vanished aborts identically (its `sourceDir` is the vanished subdir, so `SKILL.md` is absent).

**Do**:
- In `src/nuke-reinstall-pipeline.ts`, **remove the blind re-detection** as the type authority: do not call `detectType` to *decide which type to install*. Instead read the recorded type from `existingEntry.type`. (Keep `detectType` only if useful for plugin asset-dir enumeration in task 4-5; for the skill path it is not needed — `SKILL.md` existence is the whole predicate.)
- Add a derive-before-delete **validation gate** for the recorded `skill` case, run **before** `nukeManifestFiles` (~101): `const skillMdExists = await exists(join(sourceDir, "SKILL.md"));` (add a small `exists` helper or reuse the pattern from `type-detection.ts`). If the recorded type is `skill` and `SKILL.md` is **absent** → return a new abort result and do **not** nuke or copy.
- Introduce an **abort result variant**: extend `NukeReinstallResult` with `NukeReinstallAborted` carrying enough context for reporting — e.g. `{ status: "aborted"; recordedType: "skill" | "plugin"; reason: string }` where `reason` describes what changed (recorded type vs current structure, e.g. `"recorded as skill but SKILL.md no longer exists in the source"`). The full user-facing message and remedy text are assembled in the reporting layer (task 4-6); the pipeline supplies the structured cause. Plumb this new status up through `clone-reinstall.ts` (`CloneReinstallFailed.failureReason` or a new `aborted` result — see task 4-6 for the seam; for this task, return the structured abort from the pipeline and have task 4-6 map it).
- For a recorded `skill` with `SKILL.md` present: proceed to nuke + `copyBareSkill` (the existing bare-skill copy branch ~115–122), **ignoring any asset dirs** present in the tree — do not switch to `copyPluginAssets` just because an `agents/` dir appeared. The recorded type is authoritative.
- **Ordering is load-bearing**: the validation (`SKILL.md` existence check) must run *before* `nukeManifestFiles`. On abort, no file removal and no copy occur. Match the spec's "validate before you mutate."
- Member entries: the pipeline already receives `sourceDir` as the entry's own dir (`getSourceDirFromKey(tempDir, key)` resolves `owner/repo/<unit>` to the `<unit>` subdir within the clone). So a member's `SKILL.md` check is against its own subdir; a vanished subdir means `SKILL.md` is absent → abort. No special member branch needed — the same predicate against `sourceDir` covers it.
- Reconcile the existing `no-config`/`no-agents`/`invalid-type` results: the `no-config` path (~66–69) and `invalid-type` path (~90–92) are v1 artifacts of the config-mandatory/blind-detection model. Agent-dropping logic (`computeAgentChanges`, ~73–82) should be **retained** (it is orthogonal — a plugin may drop an agent in its new config). The `no-config` early return is now wrong under configless replay (a recorded skill with no config is normal); coordinate with task 4-5/4-6 on removing/repurposing `no-config`/`invalid-type` — for this task, ensure the **recorded-skill replay path does not bail on `config === null`** (a configless skill must update). If config is read only for agent constraints, a `null` config means "no agent restriction" (effective agents unchanged), not an abort. Adjust accordingly so a configless recorded-skill update proceeds.
- Do **not** add copy-safety (symlink/traversal) guards — Phase 5.

**Acceptance Criteria**:
- [ ] Update of a recorded-`skill` entry reads `existingEntry.type === "skill"` and replays it (does not re-derive the type from the re-cloned tree).
- [ ] Recorded `skill` + `SKILL.md` present in the re-cloned tree → re-copies the unit dir via `copyBareSkill`; benign newly-added asset dirs are **ignored** (not re-derived into a plugin).
- [ ] Recorded `skill` + `SKILL.md` **vanished** → returns an `aborted` result; `nukeManifestFiles` is **not** called and no copy occurs (install left fully intact).
- [ ] The `SKILL.md` validation runs **before** `nukeManifestFiles` (derive-before-delete ordering).
- [ ] A member entry whose own subdir vanished aborts identically (its `sourceDir` lacks `SKILL.md`).
- [ ] A configless recorded-`skill` update (re-cloned source has no `agntc.json`) proceeds (does not bail on `null` config).
- [ ] The abort result carries structured cause (recorded type + reason) for the reporting layer (task 4-6).

**Tests** (extend `tests/nuke-reinstall-pipeline.test.ts` and/or `tests/clone-reinstall.test.ts` — `readConfig`/`detectType`/copy fns are mocked):
- `"replays recorded skill: SKILL.md present re-copies the unit dir"` — `existingEntry.type: "skill"`, `exists(SKILL.md)` → true; assert `copyBareSkill` called, `copyPluginAssets` not, success result.
- `"benign added asset dir is ignored for a recorded skill"` — `existingEntry.type: "skill"`, tree has both `SKILL.md` and an `agents/` dir; assert `copyBareSkill` (not `copyPluginAssets`) is called — recorded type wins.
- `"recorded skill with vanished SKILL.md aborts before nuke"` — `existingEntry.type: "skill"`, `exists(SKILL.md)` → false; assert result status `"aborted"`, `nukeManifestFiles` **not** called, no copy.
- `"validation runs before nukeManifestFiles"` — spy ordering: assert the `SKILL.md` existence check resolves before any `nukeManifestFiles` invocation; on abort, `nukeManifestFiles` call count is 0.
- `"a member subpath that vanished aborts (skill)"` — `sourceDir` is the member subdir, `SKILL.md` absent; assert abort, no nuke.
- `"a configless recorded-skill update proceeds (null config)"` — `readConfig` → `null`, `existingEntry.type: "skill"`, `SKILL.md` present; assert `copyBareSkill` called (does not return a no-config abort).
- `"the abort result names the recorded-vs-current cause"` — assert the aborted result's `reason`/`recordedType` describe "recorded skill but SKILL.md gone".

**Edge Cases**:
- Recorded `skill` + `SKILL.md` present + added asset dir → re-copy as skill (ignore asset dir; recorded type authoritative).
- Recorded `skill` + `SKILL.md` gone → abort, intact.
- Member subdir vanished → abort (its `sourceDir` lacks `SKILL.md`).
- Configless recorded skill (no config in re-clone) → proceeds; `null` config is "no agent restriction," not an abort.
- Validation strictly before nuke — no on-disk window where files are deleted and then the unit can't be reinstalled.

**Context**:
> Spec — *Manifest Keying & Lifecycle → Decision*: "**`update` replays the recorded type**, not blind re-detection. Reinstalling the recorded unit re-copies whatever is in the tree now, so benign additions ... are picked up *without* changing the recorded type — we're replaying "plugin," not re-deriving it." "**Derive-before-delete.** On `update`, validate the unit can still be reinstalled as its recorded type *before* removing any existing files. Never delete first and discover failure."
> Spec — *Derive-before-delete validation predicate (per recorded type)*: "**Recorded `skill`** → the unit's root `SKILL.md` must still exist. If present, replay as a bare skill (re-copy the unit dir) regardless of any newly-added asset dirs — the *recorded* type is authoritative, not a re-derivation. If `SKILL.md` is gone → **abort**." "**Member entries** apply the *same* per-type predicate to their own subdir (`owner/repo/<unit>`). A vanished subdir is the common abort trigger, but a subdir that still exists yet no longer supports its recorded type aborts identically." "Validation runs entirely against the re-cloned tree before any file removal; on failure the existing install is left intact."
> Spec — *Error & Abort Behaviour → `update` abort (irreconcilable change)*: "that unit's existing install is **left intact** (no files removed) ... reported as **aborted**."
> Existing code: `executeNukeAndReinstall` (`src/nuke-reinstall-pipeline.ts`) blindly re-detects (~85), returns `invalid-type` for collection/not-agntc (~90), nukes at ~101, copies at ~107–122; member `sourceDir` is resolved to the entry's own subdir by `getSourceDirFromKey` (`src/clone-reinstall.ts` ~153).
> Depends on tasks 4-1/4-2 (entries carry `type`) and task 4-3 (legacy entries backfill `type`) so `existingEntry.type` is reliably present. Task 4-5 builds the plugin predicate on this same validate-before-nuke seam; task 4-6 surfaces the abort result through reporting.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Manifest Keying & Lifecycle (Decision, Derive-before-delete validation predicate)*, *Error & Abort Behaviour*.

---

## configless-install-4-5 | approved

### Task configless-install-4-5: Update replays recorded plugin type with the plugin predicate

**Problem**: With the skill replay + validate-before-nuke seam established (task 4-4), the recorded **plugin** case needs its own derive-before-delete predicate. The spec: a recorded `plugin` validates that **at least one asset-kind dir (`skills/`/`agents/`/`hooks/`) still exists** at the unit root *before* nuking; if so, re-copy whatever asset dirs are present now (benign additions — e.g. the author added an `agents/` dir to a `skills/`-only plugin — are picked up, *without* re-deriving the type); if **no** asset dir remains (the unit became a bare skill or a member-dirs collection) → **abort**, install intact. Today the pipeline blindly re-detects and would, for a plugin, either re-classify or nuke-then-fail; it must instead replay the recorded `plugin` against this predicate.

**Solution**: Building on task 4-4's validate-before-nuke seam and abort result, add the recorded-`plugin` branch to `executeNukeAndReinstall`. For `existingEntry.type === "plugin"`: enumerate the asset-kind dirs present in the re-cloned `sourceDir` (`skills`/`agents`/`hooks`) **before** `nukeManifestFiles`; if ≥1 present, nuke then re-copy *those present* asset dirs via `copyPluginAssets`; if **zero** asset dirs present, return the abort result (recorded `plugin`, reason "no asset dir remains"). The asset-dir enumeration is structural-but-scoped: it reuses the same `ASSET_DIRS` existence scan as detection, but it is *not* re-deriving the type — it is replaying `plugin` and computing *which present asset dirs to copy*. Member plugin entries validate against their own subdir identically (a vanished subdir → no asset dir → abort).

**Outcome**: `agntc update <key>` for a recorded-`plugin` entry whose re-cloned tree still has ≥1 asset dir re-copies the present asset dirs — picking up a benign newly-added `agents/` dir on a former `skills/`-only plugin without changing the recorded type. If the tree no longer has any asset dir (now a bare skill, or a member-dirs collection), the update **aborts** for that entry with the install left fully intact and a structured abort cause. A member plugin entry whose subdir vanished aborts identically.

**Do**:
- **Depends on task 4-4** (the validate-before-nuke ordering and the `NukeReinstallAborted` result variant). Reuse both.
- In `src/nuke-reinstall-pipeline.ts`, add the recorded-`plugin` branch keyed on `existingEntry.type === "plugin"`. **Before** `nukeManifestFiles`, scan `sourceDir` for asset dirs: `const presentAssetDirs = ASSET_DIRS.filter(d => exists(join(sourceDir, d)))` (await each; import `ASSET_DIRS` from `./type-detection.js`, already exported). 
- If `presentAssetDirs.length === 0` → return the abort result (`{ status: "aborted", recordedType: "plugin", reason: "recorded as plugin but no asset dir (skills/agents/hooks) remains in the source" }`). Do **not** nuke or copy.
- If `presentAssetDirs.length > 0` → proceed: nuke existing files, then `copyPluginAssets({ sourceDir, assetDirs: presentAssetDirs, agents, projectDir })` (the existing plugin copy branch ~107–114, but with `assetDirs` from the present-asset-dir scan rather than a re-detected `detected.assetDirs`). This picks up benign additions (a newly-added `agents/` dir is now in `presentAssetDirs`).
- Do **not** re-derive the *type*: the asset-dir scan only chooses *which dirs to copy* for a unit already known (recorded) to be a plugin. A recorded plugin that now *also* has a root `SKILL.md` but still has ≥1 asset dir is still replayed as a plugin (asset dirs copied; `SKILL.md` ignored) — recorded type authoritative.
- Member plugin entries: `sourceDir` is the member's own subdir (`getSourceDirFromKey`), so the present-asset-dir scan is scoped to the member; a vanished subdir yields zero asset dirs → abort. No special member branch.
- Finalise the removal/repurposing of the v1 `invalid-type`/`no-config` results begun in task 4-4: with both `skill` and `plugin` replay predicates in place, the blind `detectType` call (~85) and the `not-agntc || collection → invalid-type` return (~90–92) are dead for the replay model — remove them (the abort result replaces `invalid-type`'s role with a derive-before-delete, install-intact guarantee). Retain `computeAgentChanges`/`onAgentsDropped` (orthogonal agent-drop reporting). Ensure a configless recorded-plugin update (re-clone has no `agntc.json`) proceeds (a `null` config means no agent restriction, effective agents unchanged) — do not bail on `null` config.
- Do **not** add copy-safety guards — Phase 5.

**Acceptance Criteria**:
- [ ] Update of a recorded-`plugin` entry reads `existingEntry.type === "plugin"` and replays it.
- [ ] Recorded `plugin` + ≥1 asset dir present → re-copies the **present** asset dirs via `copyPluginAssets`; a benign newly-added asset dir (e.g. `agents/` on a former skills-only plugin) is picked up.
- [ ] Recorded `plugin` + **zero** asset dirs present (now a bare skill or member-dirs collection) → returns `aborted`; `nukeManifestFiles` not called, no copy, install intact.
- [ ] The asset-dir presence scan runs **before** `nukeManifestFiles`.
- [ ] A recorded plugin that also gained a root `SKILL.md` but still has ≥1 asset dir is replayed as a plugin (asset dirs copied, `SKILL.md` ignored) — recorded type authoritative.
- [ ] A member plugin entry whose subdir vanished aborts identically (zero asset dirs in its `sourceDir`).
- [ ] A configless recorded-plugin update (no `agntc.json` in re-clone) proceeds.
- [ ] The blind `detectType` re-detection and the `invalid-type` return are removed; replay + abort replace them; `computeAgentChanges` retained.

**Tests** (extend `tests/nuke-reinstall-pipeline.test.ts`):
- `"replays recorded plugin: present asset dirs re-copied"` — `existingEntry.type: "plugin"`, `exists(skills)`/`exists(agents)` → true; assert `copyPluginAssets` called with `assetDirs` containing the present dirs.
- `"benign added asset dir is picked up for a recorded plugin"` — recorded plugin was skills-only, re-clone now has `skills/`+`agents/`; assert `copyPluginAssets` `assetDirs` includes `agents`.
- `"recorded plugin with no asset dir aborts before nuke"` — `existingEntry.type: "plugin"`, all `exists(skills|agents|hooks)` → false; assert `"aborted"`, `nukeManifestFiles` not called, no copy.
- `"recorded plugin that became a bare skill aborts"` — tree has `SKILL.md` only, no asset dir; assert abort (recorded plugin, not re-derived into a skill).
- `"a recorded plugin with an added SKILL.md but ≥1 asset dir is still a plugin"` — tree has `SKILL.md` + `skills/`; assert `copyPluginAssets` (not `copyBareSkill`).
- `"a member plugin subpath that vanished aborts"` — member `sourceDir` has no asset dir; assert abort.
- `"a configless recorded-plugin update proceeds (null config)"` — `readConfig` → `null`, asset dir present; assert `copyPluginAssets` called.
- `"the blind re-detection invalid-type path is gone"` — assert no `invalid-type` result is produced for a tree that previously would have re-detected as collection/not-agntc; it now aborts via the recorded-plugin predicate.

**Edge Cases**:
- Recorded `plugin` + ≥1 asset dir → copy present dirs (benign additions included).
- Recorded `plugin` + zero asset dirs (now bare skill or member-dirs collection) → abort, intact.
- Recorded `plugin` + added `SKILL.md` but asset dir still present → still plugin (recorded type wins).
- Member plugin subdir vanished → abort.
- Configless recorded plugin → proceeds; `null` config = no agent restriction, not an abort.

**Context**:
> Spec — *Derive-before-delete validation predicate (per recorded type)*: "**Recorded `plugin`** → at least one asset-kind dir (`skills/`/`agents/`/`hooks/`) must still exist at the unit root. If so, re-copy whatever asset dirs are present now (benign additions picked up). If no asset dir remains (e.g. now a bare skill or member-dirs collection) → **abort**."
> Spec — *Manifest Keying & Lifecycle → Decision*: "we're replaying "plugin," not re-deriving it."
> Spec — *Member entries replay by path*: "A collection member persists as `owner/repo/<unit>` with its own recorded type, and `update` re-copies *its own subdir*. ... Only a vanished member subdir trips the abort path." (refined: a subdir that exists but no longer supports the recorded type aborts identically.)
> Spec — *Error & Abort Behaviour → `update` abort*: install left intact, reported aborted.
> Existing code: plugin copy branch in `executeNukeAndReinstall` (~107–114) uses `copyPluginAssets({ sourceDir, assetDirs, agents, projectDir })`; `ASSET_DIRS` exported from `src/type-detection.ts`. `getSourceDirFromKey` scopes member `sourceDir` to the subdir.
> Depends on task 4-4 (validate-before-nuke seam + abort result variant); together they remove the blind-detection `invalid-type`/`no-config` model.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Manifest Keying & Lifecycle (Derive-before-delete validation predicate, Member entries replay by path)*, *Error & Abort Behaviour*.

---

## configless-install-4-6 | approved

### Task configless-install-4-6: Surface irreconcilable-change abort intact through update reporting

**Problem**: Tasks 4-4/4-5 produce a structured **abort** result inside `executeNukeAndReinstall` when derive-before-delete fails, with the existing install left intact (no nuke ran). But that result must travel up through `clone-reinstall.ts` (`CloneReinstallFailed`/`mapCloneFailure`) and `update.ts` (`runSinglePluginUpdate`/`processUpdateForAll`) to become a clear user-facing report. The spec's *Error & Abort Behaviour* makes the abort's observable shape a behavioural contract: the message must name **recorded type vs current structure**, state the **manual `remove` + `add` remedy**, report the entry as **"aborted"**, and a single-key update of an aborting entry must exit **non-zero**. This abort must be **distinct** from the residual `copy-failed` case (an I/O failure *after* nuke, where the unit is left uninstalled with a different recovery hint) — derive-before-delete eliminates the type-incompatibility stranding case, so an abort means "nothing was touched," not "uninstalled, retry."

**Solution**: Thread the abort result through the existing failure-mapping seam. Add an `aborted` failure reason (or a distinct result branch) to `CloneReinstallFailed`/`mapCloneFailure` (`src/clone-reinstall.ts`) so the pipeline's abort status maps to a dedicated handler. In `update.ts`, add an `onAborted` handler to both `runSinglePluginUpdate` (~241) and `processUpdateForAll` (~331) that renders a clear message naming recorded-vs-current structure and the `remove`+`add` remedy, reports the outcome as `"aborted"`, and — for single-key update — exits non-zero (`ExitSignal(1)`). The abort handler is **distinct** from `onCopyFailed` (which keeps its "currently uninstalled — retry" hint and the manifest-entry removal). On abort, the manifest entry is **left unchanged** (the install is intact), so no `removeEntry`/no manifest mutation for that entry. (The all-updates partial-success summary and per-entry granularity across siblings is task 4-7, building on the `"aborted"` outcome this task introduces.)

**Outcome**: `agntc update owner/restructured-skill`, where the recorded `skill` no longer has `SKILL.md` (or the recorded `plugin` lost all asset dirs), prints a clear error naming the recorded type and what the structure became, states "run `agntc remove owner/restructured-skill` then `agntc add ...`", reports the entry as aborted, leaves the install fully intact (the manifest entry and on-disk files unchanged), and exits non-zero. This message and exit are distinct from the `copy-failed` residual (which says "currently uninstalled — run update to retry").

**Do**:
- **Depends on tasks 4-4/4-5** (the `NukeReinstallAborted` result with `recordedType` + `reason`).
- In `src/clone-reinstall.ts`: extend `CloneReinstallFailed.failureReason` with `"aborted"` (and carry the structured cause — e.g. add optional `recordedType`/`reason` fields to the failed result, or a dedicated `CloneReinstallAborted` branch in `CloneReinstallResult`). In `runPipeline` (~201–261), map the pipeline's `status === "aborted"` to this new failed/aborted result, preserving `recordedType` and `reason`. Add `onAborted` to `CloneFailureHandlers<T>` and a `case "aborted"` in `mapCloneFailure` (~53–71). Build the user-facing message in `buildFailureMessage` (or in the handlers) so it names recorded-vs-current and the remedy.
- **Crucially, the abort path must NOT remove the manifest entry**: `handleCopyFailedRemoval` (~175–190) removes the entry only for `copy-failed`; ensure `aborted` is **not** routed through that removal (the install is intact). Leave the manifest entry exactly as it was.
- In `src/commands/update.ts` `runSinglePluginUpdate` (the `mapCloneFailure` handlers ~241–269): add `onAborted: () => { p.log.error(<recorded-vs-current + remedy message>); throw new ExitSignal(1); }`. The message must name the recorded type and the current structure mismatch and state the manual remedy: e.g. `` `${key} was installed as a ${recordedType}, but its source no longer supports that type (${reason}). The existing install is unchanged. To migrate: \`npx agntc remove ${key}\` then \`npx agntc add ...\`.` ``. Exit non-zero.
- In `src/commands/update.ts` `processUpdateForAll` (~331–366): add `onAborted: () => ({ status: "aborted" as const, key, summary: <recorded-vs-current + remedy> })`. This introduces a new `PluginOutcome` variant `{ status: "aborted"; key: string; summary: string }` (add it to the `PluginOutcome` union ~33–46). In the all-updates flow, an `aborted` outcome must **not** add or remove a manifest entry (no `newEntry`, not `copy-failed`) — the `for (const outcome of outcomes)` manifest-build loop (~520–535) must leave aborted entries untouched. (The exit-status and summary wiring for the all-updates path is task 4-7; here, ensure the `aborted` outcome is produced and carries the correct message, and that it does not mutate the manifest.)
- Ensure the abort is **distinct from copy-failed**: `copy-failed` keeps its existing "currently uninstalled — run update to retry" hint and entry removal; `aborted` keeps the install intact with the `remove`+`add` migration remedy. Two different messages, two different manifest effects.
- Reuse the recorded type and reason from the abort result for the message; do not re-derive.

**Acceptance Criteria**:
- [ ] A derive-before-delete abort (from 4-4/4-5) is mapped through `clone-reinstall.ts` to a dedicated `aborted` failure (with `recordedType` + `reason`), not conflated with `copy-failed` or `invalid-type`.
- [ ] The abort message names the **recorded type vs current structure** and states the manual **`remove` + `add`** remedy.
- [ ] The entry is reported as **"aborted"** (a distinct `PluginOutcome`/handler outcome).
- [ ] A single-key `update` of an aborting entry exits **non-zero** (`ExitSignal(1)`).
- [ ] On abort the existing install is **fully intact**: no `nukeManifestFiles` ran (4-4/4-5), and the manifest entry is **not** removed or modified.
- [ ] The abort is **distinct** from the `copy-failed` residual: different message (intact vs "currently uninstalled — retry") and different manifest effect (unchanged vs entry removed).

**Tests** (extend `tests/clone-reinstall.test.ts` and `tests/commands/update.test.ts`):
- `"maps a pipeline abort to a dedicated aborted failure"` — pipeline returns `{ status: "aborted", recordedType: "skill", reason: ... }`; assert `cloneAndReinstall` yields a failed/aborted result with `failureReason: "aborted"` carrying `recordedType`/`reason`.
- `"abort does not remove the manifest entry"` — assert `handleCopyFailedRemoval` does not remove the entry for an `aborted` result (no `writeManifest` removal on abort).
- `"single-key update of an aborting entry exits non-zero with the remedy message"` — `existingEntry.type: "skill"`, `SKILL.md` gone; assert `ExitSignal(1)`, `p.log.error` message contains the key, "skill", "unchanged", and "remove"/"add".
- `"the abort message names recorded type vs current structure"` — assert the message references both the recorded type and what the structure became (via `reason`).
- `"abort is distinct from copy-failed"` — one test with a copy-failed result (entry removed, "currently uninstalled" hint) and one with an aborted result (entry intact, "remove then add" remedy); assert the two messages and manifest effects differ.
- `"processUpdateForAll yields an aborted outcome that does not mutate the manifest"` — assert the outcome `status === "aborted"` and the manifest-build loop neither adds nor removes the key.

**Edge Cases**:
- Abort vs copy-failed: distinct messages and manifest effects (intact vs uninstalled-retry).
- Single-key abort → non-zero exit; install intact.
- Abort message must carry the recorded type and the structural change (from the abort `reason`).
- Manifest untouched on abort (no add, no remove).

**Context**:
> Spec — *Error & Abort Behaviour → `update` abort (irreconcilable change)*: "When derive-before-delete fails for a unit, that unit's existing install is **left intact** (no files removed), a clear message describes what changed (recorded type vs current structure) and states the manual remedy (`remove` then `add`), and the entry's `update` is reported as **aborted**."
> Spec — *Manifest Keying & Lifecycle → Decision*: "**Irreconcilable change → abort + loud alert, existing install left intact.** ... do **not** try to save it or auto-migrate. Abort that unit's update, keep what's installed, emit a clear error describing what changed. The remedy is manual (`remove` then `add` — the user's call)."
> Spec — *Error & Abort Behaviour → Copy failure after nuke (residual, acknowledged)*: "Derive-before-delete eliminates the *type-incompatibility* stranding case, but a copy that fails *after* files are nuked (I/O error mid-reinstall) remains possible. As today, this is reported with a recovery hint ('the unit is currently uninstalled; run `agntc update <key>` to retry'). Not expanded by this feature." (The abort must be distinct from this.)
> Spec — *Error & Abort Behaviour → Command exit status*: "the command exits **non-zero if any unit hard-errored or aborted**."
> Existing code: `mapCloneFailure`/`CloneFailureHandlers`/`buildFailureMessage` (`src/clone-reinstall.ts` ~44–91); `handleCopyFailedRemoval` (~175–190) removes the entry only on `copy-failed`; `runSinglePluginUpdate` handlers (`src/commands/update.ts` ~241–269); `processUpdateForAll` handlers (~331–366); `PluginOutcome` union (~33–46).
> Depends on tasks 4-4/4-5 (the abort result). Task 4-7 builds the all-updates partial-success exit + summary on the `aborted` outcome this task introduces.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Error & Abort Behaviour*, *Manifest Keying & Lifecycle*.

---

## configless-install-4-7 | approved

### Task configless-install-4-7: Per-entry abort granularity and partial-success exit status

**Problem**: `update` operates **per manifest entry**, and the spec's partial-outcome contract must hold: a plugin is one entry → atomic (abort = the whole plugin stays); collection members are independent entries → one member aborting while siblings advance is correct (agntc owes no collection-level coherence — lockstep is what `plugin` is for, and there is deliberately no collection record). Each aborted entry must be reported loudly with its own reason, and the **command exit status must be non-zero if any unit aborted (or hard-errored), even when other units succeeded** (partial success). The all-updates flow (`runAllUpdates`, `src/commands/update.ts` ~403–617) currently has no `aborted` outcome handling, no partial-failure exit code, and no per-entry abort isolation guarantee — `processUpdateForAll` catches per-entry errors into a `failed` outcome (~394–400), but the new `aborted` outcome (task 4-6) needs summary rendering and must drive a non-zero exit without rolling back sibling successes.

**Solution**: Building on the `aborted` `PluginOutcome` introduced in task 4-6, wire `runAllUpdates` so: (a) each entry is processed independently (already true — the per-entry loop ~483–490 and `processUpdateForAll`'s try/catch isolate failures; confirm an `aborted` outcome for one member does not stop siblings); (b) aborted entries are rendered in the per-plugin summary with their own reason (a loud `p.log.error`/`warn`), and surfaced in the outcome list; (c) the command **exits non-zero** when any outcome is `aborted` (or `failed`/`copy-failed`) while still committing the successful updates' manifest changes; (d) no collection-level coherence rollback — a sibling's success is **kept** even when another member aborts (the manifest write loop ~520–535 already only adds successful entries and removes copy-failed ones; aborted entries are left untouched per task 4-6, so siblings advance independently). A plugin (single entry) aborts atomically — its one entry stays, nothing partial within it.

**Outcome**: `agntc update` (all) across a manifest where one collection member's source restructured (aborts) and its siblings + other units update cleanly: the siblings and other units update and their manifest entries are written; the aborted member is reported loudly with its recorded-vs-current reason and left intact; the command exits **non-zero** (partial success). A single plugin entry that aborts stays whole (atomic). The all-updates summary lists per-unit outcomes (succeeded / aborted / errored). No sibling success is rolled back because another member aborted.

**Do**:
- **Depends on task 4-6** (the `aborted` `PluginOutcome` variant + its message, and the abort-leaves-manifest-intact behaviour).
- In `src/commands/update.ts` `runAllUpdates`, confirm per-entry isolation: the update loop (`for (const checked of [...updateAvailable, ...local])` ~483–490 and the constrained loop ~493–514) calls `processUpdateForAll` per entry; an `aborted` outcome (returned, not thrown) does not stop the loop. Verify no early `throw`/`ExitSignal` escapes the loop on abort (the abort is a returned outcome, not an exception — unlike the single-key path which throws). 
- **Manifest build loop** (~520–535): ensure an `aborted` outcome neither adds (`addEntry`) nor removes (`removeEntry`) its key — the entry is left exactly as-is (install intact). Only `updated`/`refreshed` add; only `copy-failed` removes. Confirm `aborted` falls through both branches untouched.
- **Per-plugin summary** (~597–614): add an `aborted` branch rendering the outcome loudly — `p.log.error(outcome.summary)` (or `warn`), with the per-entry recorded-vs-current reason and remedy from task 4-6. Each aborted entry is reported with its own reason.
- **Exit status**: introduce a non-zero exit when any outcome is `aborted` (or `failed`/`copy-failed`). Today `runAllUpdates` returns `void` and never sets a non-zero code on partial failure. After rendering all summaries (and the out-of-constraint output), if any outcome has status in `{ aborted, failed, copy-failed }`, `throw new ExitSignal(1)` so the command exits non-zero while having already written the successful updates' manifest and printed the full per-unit summary. (Place the throw **after** `writeManifest` and after the summary render, so partial successes persist and the user sees the complete report before the non-zero exit.)
- **`allUpToDate` interaction**: the early `allUpToDate` return (~582–595) only fires when there were no updatable/failed/etc. categories — an aborted entry comes from the updatable categories (it was `update-available`/`local`/`constrained-update-available` before reinstall), so `allUpToDate` is already false in that case. Confirm an abort cannot be swallowed by the `allUpToDate` early return.
- **No collection-level rollback**: do not introduce any logic that, on a member abort, reverts or skips that member's siblings. Each entry stands alone (the spec: members are independent entries by construction; agntc owes no collection coherence). The existing per-entry loop already provides this — guard against regressions.
- Keep the single-key path (task 4-6) as-is: it `throw`s `ExitSignal(1)` immediately on abort (one entry, no partial). The all-updates path defers the non-zero exit to the end so siblings complete.

**Acceptance Criteria**:
- [ ] In all-updates mode, one collection member aborting does **not** stop its siblings — siblings and other units update and their manifest entries are written.
- [ ] A plugin (single entry) abort is whole-entry atomic — the one entry stays intact; there is no partial within it.
- [ ] Each aborted entry is reported loudly in the per-plugin summary with its own recorded-vs-current reason and remedy.
- [ ] The all-updates command exits **non-zero** when any outcome is `aborted` (or `failed`/`copy-failed`), after writing successful updates and printing the full summary.
- [ ] The all-updates summary lists per-unit outcomes (succeeded / aborted / errored).
- [ ] No collection-level coherence rollback occurs: a sibling's successful update is kept even when another member aborts.
- [ ] An `aborted` outcome does not add or remove its manifest entry (install intact); the entry is unchanged.
- [ ] An abort is never swallowed by the `allUpToDate` early return.

**Tests** (extend `tests/commands/update.test.ts`, all-updates describe):
- `"one member aborts while siblings update (partial success)"` — manifest with `owner/c/member-a` (recorded skill, source restructured → abort) and `owner/c/member-b` (recorded skill, updates) + an unrelated `owner/x` (updates); assert member-b and owner/x manifest entries are written, member-a is reported aborted and left unchanged, and the command exits non-zero.
- `"a plugin entry aborts atomically"` — single recorded-plugin entry loses all asset dirs; assert it is reported aborted, its entry is unchanged, exit non-zero, nothing partially installed.
- `"each aborted entry is reported with its own reason"` — two entries abort for different reasons; assert two distinct loud summary lines naming each recorded-vs-current cause.
- `"partial abort exits non-zero after writing successful updates"` — assert `writeManifest` was called (successful entries committed) AND `ExitSignal(1)` thrown, in that order.
- `"the summary lists per-unit outcomes"` — assert succeeded + aborted entries both appear in the rendered summary.
- `"a sibling success is not rolled back on a member abort"` — assert the updating sibling's new entry is present in the written manifest despite the sibling member's abort.
- `"an aborted entry's manifest entry is unchanged"` — assert the aborted key's entry in the written manifest equals its original (no add/remove).
- `"an abort is not swallowed by allUpToDate"` — assert with one aborting + rest up-to-date, the command still reports the abort and exits non-zero (not the "All plugins are up to date" early return).

**Edge Cases**:
- One member aborts, siblings + others succeed → siblings written, abort reported, exit non-zero.
- Plugin single-entry abort → atomic, whole entry stays.
- Multiple aborts → each reported with its own reason; one non-zero exit.
- Successful updates committed even when a sibling aborts (no rollback).
- All up-to-date except one abort → abort still reported + non-zero (not swallowed by `allUpToDate`).
- Single-key path unchanged (throws immediately; one entry).

**Context**:
> Spec — *Manifest Keying & Lifecycle → Decision: Per-member abort granularity*: "`update` operates per manifest entry. A plugin is one entry → atomic (abort = the whole plugin stays). Collection members are **independent entries by construction** — that independence is what makes it a collection and not a plugin — so one member aborting while siblings advance is correct, not a coherence hazard. agntc owes **no** collection-level coherence guarantee (lockstep is what `plugin` is for; there is deliberately no collection record). Each aborted entry is reported loudly."
> Spec — *Error & Abort Behaviour → Partial outcomes for collections*: "A single unit (bare skill / plugin) is one entry → atomic: it wholly succeeds, wholly aborts, or hard-errors. Collection members are independent entries → each is processed on its own; a member that aborts or errors does **not** stop its siblings. Each failed member is reported loudly with its own reason. **Command exit status**: the command exits **non-zero if any unit hard-errored or aborted**, even when other units succeeded (partial success). The summary reports per-unit outcomes (succeeded / aborted / errored) so the user sees exactly what changed and what didn't."
> Existing code: `runAllUpdates` per-entry loop (~483–514), manifest-build loop (~520–535, only `updated`/`refreshed` add, `copy-failed` removes), per-plugin summary (~597–614), `allUpToDate` early return (~582–595); `processUpdateForAll` isolates per-entry failures into outcomes (~394–400). `PluginOutcome` union (~33–46) gains `aborted` in task 4-6.
> Depends on task 4-6 (the `aborted` outcome variant, its message, and abort-leaves-manifest-intact). Single-key path (4-6) throws immediately; this task wires the all-updates partial-success exit + summary.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Manifest Keying & Lifecycle (Per-member abort granularity)*, *Error & Abort Behaviour (Partial outcomes for collections)*.
