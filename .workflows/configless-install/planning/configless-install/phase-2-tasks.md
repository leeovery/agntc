---
phase: 2
phase_name: Configless standalone install through `add`
total: 3
---

## configless-install-2-1 | approved

### Task configless-install-2-1: Configless standalone detect-and-install wiring

**Problem**: `runAdd` still encodes the v1 "config means installable" model in two places that block configless standalone installs. (a) When `readConfig` returns `null` it treats null config as *must be a collection* — it runs `detectType` and only proceeds if the result is `collection`, otherwise it cancels with "no agntc.json found and no collection detected" and exits. So a bare-`SKILL.md` repo with no config (`referodesign/refero_skill`, the headline case) and a configless multi-asset plugin are both wrongly rejected even though Phase 1 detection now classifies them as `bare-skill`/`plugin`. (b) The standalone path reads `config.agents` only after asserting `config !== null`, so a configless unit has no agent source at all. (c) The Phase 1 rewrite of `detectType` drops the `hasConfig` option and the Phase 1 rewrite of `readConfig` stops throwing `ConfigError`, leaving two now-incorrect call shapes (`{ hasConfig: ... }`) and one dead `catch (ConfigError)` in `runAdd`.

**Solution**: Collapse the `config === null` collection-gate and the separate config-present standalone path into a single flow: clone, read config leniently (`AgntcConfig | null`), run `detectType(sourceDir, { onWarn })` **once** (structure is the sole authority — config presence is not an input), then branch on the *detected type*. `collection` → existing `runCollectionPipeline` dispatch (untouched — Phase 3 owns its rework). `not-agntc` → clean exit. `bare-skill` / `plugin` → the standalone install, sourcing declared agents from `config?.agents ?? []` so a configless unit falls through to the Phase 1 `KNOWN_AGENTS` default inside `selectAgents`. Update both `detectType` call sites in `runAdd` to the Phase 1 options shape and remove the dead `ConfigError` machinery.

**Outcome**: `agntc add referodesign/refero_skill` (bare `SKILL.md`, no `agntc.json`, untagged) installs the skill standalone under its repo-basename folder/manifest key with agents chosen from the `KNOWN_AGENTS` default; a configless multi-asset plugin installs standalone the same way. A configless source whose structure is a collection still dispatches to `runCollectionPipeline`. A not-agntc source still exits cleanly (code 0). Config-bearing standalone installs (e.g. `agentic-workflows`, declared `agents:[claude]`) behave exactly as before. The `config === null` → "must be a collection" gate, the second standalone `detectType` call, and the dead `ConfigError` catch are gone.

**Do**:
- In `src/commands/add.ts`, **remove** the `config === null` block (current lines ~171–196): the `detectType(..., { hasConfig: false })` call, the `detected.type === "collection"` early dispatch, and the `p.cancel("Not an agntc source …")` + `throw new ExitSignal(0)`. The collection dispatch moves into the unified branch below.
- **Replace** the step-5 standalone `detectType(sourceDir, { hasConfig: true, onWarn })` (lines ~198–202) with a single call **before** any type branch: `const detected = await detectType(sourceDir, { onWarn });` (Phase 1 dropped `hasConfig`; do not pass it). This one call serves every type.
- Re-order so the single `detectType` runs immediately after `readConfig`, then branch on `detected.type`:
  - `detected.type === "collection"` → call `runCollectionPipeline({ sourceDir, parsed, commit, detected, onWarn, spin, constraint: resolvedConstraint })` and `return` (preserve the exact existing dispatch — do **not** modify `runCollectionPipeline`; its `readConfig`/`detectType` internals are Phase 3 scope).
  - `detected.type === "not-agntc"` → `throw new ExitSignal(0)` (clean exit; the existing standalone `not-agntc` handling at lines ~205–207 already does this — keep that behaviour, now reachable for configless sources too).
  - else (`bare-skill` | `plugin`) → fall through to the standalone install (steps 7–14, unchanged in shape).
- Change the agent source for the standalone path: where step 8 currently passes `declaredAgents: config.agents`, pass `declaredAgents: config?.agents ?? []`. A configless unit (`config === null`) thus passes `[]`, which Phase 1's `selectAgents` resolves to the `KNOWN_AGENTS` default (pre-tick detected, always prompt). A config-bearing unit passes its declared ceiling unchanged. Adjust the local `config` type usage accordingly (it is now `AgntcConfig | null` for the whole standalone path).
- **Remove the dead `ConfigError` import and catch**: `readConfig` no longer throws `ConfigError` (Phase 1, task 1-1), so the `import { ConfigError, readConfig }` in `add.ts` should drop `ConfigError` *only from the standalone path's concern*. NOTE: `runCollectionPipeline` (lines ~398–402) still references `ConfigError` in its per-plugin `catch` — that is Phase 3's to remove. Keep the `ConfigError` import as long as `runCollectionPipeline` still uses it; do **not** delete the import while a live reference remains (grep `ConfigError` in `add.ts` before removing). The standalone path must simply stop having its own `ConfigError`-dependent branch (there is none today beyond the import — the standalone path never caught it; the dead code is the `config === null` collection gate, which this task removes).
- Leave the duplicate `detected.type === "collection"` guard that currently sits in the config-present standalone path (lines ~209–211, `throw new ExitSignal(0)`) **removed/folded**: with a single `detectType` call and the collection branch dispatching to the pipeline, a standalone-path `collection` can no longer reach a bare `throw`. Ensure no unreachable `collection`/`not-agntc` standalone guards remain after the merge.
- Keep steps 9–14 (driver pairs, manifest read + nuke, compute incoming files, conflict checks, copy, empty-plugin guard, manifest write, summary) **unchanged** — they already branch on `detected.type === "plugin"` vs bare-skill and are agnostic to config presence.

**Acceptance Criteria**:
- [ ] A configless bare skill (`readConfig` → `null`, `detectType` → `{ type: "bare-skill" }`) installs standalone: `copyBareSkill` is called, a manifest entry is written keyed `owner/repo`, and the run does **not** cancel with "no agntc.json found".
- [ ] A configless multi-asset plugin (`readConfig` → `null`, `detectType` → `{ type: "plugin", assetDirs }`) installs standalone via `copyPluginAssets`.
- [ ] For a configless unit, `selectAgents` is called with `declaredAgents: []` (sourcing the `KNOWN_AGENTS` default); for a config-bearing unit it is called with `declaredAgents: config.agents`.
- [ ] A configless source detected as `collection` still dispatches to `runCollectionPipeline` with the same arguments as today and returns.
- [ ] A `not-agntc` source (config-bearing or configless) exits with `ExitSignal(0)` and writes no manifest entry.
- [ ] `detectType` is called **exactly once** per standalone run, with options `{ onWarn }` and no `hasConfig` property.
- [ ] Config-bearing standalone behaviour is unchanged: `agentic-workflows`-shaped `{ agents: ["claude"] }` still passes `declaredAgents: ["claude"]`, and the existing happy-path/manifest/summary tests stay green.
- [ ] No `ConfigError`-catching branch remains in the standalone path; the import is retained only while `runCollectionPipeline` still references it.

**Tests** (extend `tests/commands/add.test.ts`, mock-based — `readConfig`/`detectType`/`selectAgents`/copy fns are already mocked):
- `"installs a configless bare skill standalone (refero_skill shape)"` — `mockReadConfig` → `null`, `mockDetectType` → `{ type: "bare-skill" }`; assert `copyBareSkill` called, `addEntry` called with key `owner/my-skill`, and `p.cancel` **not** called with the "no agntc.json" message.
- `"sources agents from KNOWN_AGENTS default for a configless unit"` — null config; assert `selectAgents` called with `declaredAgents: []`.
- `"installs a configless multi-asset plugin standalone"` — null config, `mockDetectType` → `{ type: "plugin", assetDirs: ["skills","agents"] }`; assert `copyPluginAssets` called, `copyBareSkill` not.
- `"config-bearing standalone still passes the declared ceiling"` — `mockReadConfig` → `{ agents: ["claude"] }`; assert `selectAgents` called with `declaredAgents: ["claude"]` (guards the existing behaviour).
- `"a configless collection still dispatches to the collection pipeline"` — null config, `mockDetectType` (root) → `{ type: "collection", plugins: [...] }`; assert `selectCollectionPlugins` reached (pipeline entered) and the standalone `copyBareSkill` single-unit path not taken.
- `"a configless not-agntc source exits 0 without installing"` — null config, `mockDetectType` → `{ type: "not-agntc" }`; assert `ExitSignal` code 0, no `addEntry`, no copy.
- `"a config-bearing not-agntc source exits 0"` — config present, `detectType` → `not-agntc`; assert exit 0 (preserves existing standalone not-agntc handling).
- `"calls detectType once with { onWarn } and no hasConfig"` — assert `mockDetectType` call count is 1 and the options arg has no `hasConfig` key.
- Update the existing collection-suite root setup that relied on the `config === null` → collection gate: those tests already stub `mockDetectType` (root) → `COLLECTION_DETECTED`, so they pass through the new unified branch unchanged — confirm they stay green (they assert pipeline behaviour, not the gate).
- Remove/rewrite the existing `"error: invalid config"` test (`tests/commands/add.test.ts` ~lines 530–543) which mocks `readConfig` to **reject** with `ConfigError` and asserts exit 1 — under Phase 1 `readConfig` never throws `ConfigError`, so this case is obsolete; replace it with a test that a null config does **not** error the standalone path.

**Edge Cases**:
- Null config + `bare-skill` → standalone install, `declaredAgents: []` (the `refero_skill` headline path).
- Null config + `plugin` → standalone install via `copyPluginAssets`.
- Config-bearing + `bare-skill`/`plugin` → unchanged (declared ceiling preserved).
- Config (or no config) + `collection` → existing `runCollectionPipeline` dispatch (untouched).
- `not-agntc` (either config state) → clean exit 0, no write.
- `ConfigError` catch is dead for the standalone path; import retained only for the still-live `runCollectionPipeline` reference (Phase 3 removes the rest).

**Context**:
> Spec — *Config Model → Responsibility split*: "Type, identity, and installability → derived from directory structure ALONE. Never from config, never from config *presence*. Agent targeting → optional author override via config. Absent → installer picks from the predefined agent list at install time; the unit is installable for any agent."
> Spec — *Config Model → Rules*: "Config *presence* never signals type … A config carrying only `agents` has zero effect on type. (The v1 'config present → plugin; no root config → collection' boundary-marker behaviour stays dead.)"
> Spec — *Agent Selection → "No valid constraint" — unified across three cases*: config absent, `agents: []`, and malformed config all reduce to the same default (offer all `KNOWN_AGENTS`). Task 1-1 makes `readConfig` return `null` for all three; this task wires the caller to pass `config?.agents ?? []` so `selectAgents` resolves the default.
> Spec — *Overview → Problem*: "A bare-`SKILL.md` repo is rejected as `not-agntc`. The anchor case `referodesign/refero_skill` (root `SKILL.md`, no config, zero tags …)." This task is what makes that repo install standalone.
> Phase 1 contract (task 1-2): `detectType(dir, { configType?, forcePlugin?, onWarn? })` — `hasConfig` removed; a single structural path. Task 1-1: `readConfig` returns `{ agents, type? } | null` and never throws `ConfigError`. Task 1-5: `selectAgents` with `declaredAgents: []` offers all `KNOWN_AGENTS`.
> Scope: `runCollectionPipeline` is **not** modified here — its membership/per-plugin rework is Phase 3. The existing collection dispatch stays exactly as-is.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Config Model*, *Structural Type Detection*, *Agent Selection*, *Overview*.

---

## configless-install-2-2 | approved

### Task configless-install-2-2: `--plugin` installer-override flag surface and forwarding

**Problem**: Phase 1 (task 1-4) built the override-resolution layer inside `detectType` — it accepts `forcePlugin?: boolean`, bundles a skills-only structure as a plugin when set, no-ops on an already-plugin structure, and throws `TypeConflictError` on a bare skill or member-dirs collection. But nothing exposes this to the user: the `add` command has no `--plugin` flag, `runAdd` never reads or forwards `forcePlugin`, and the `TypeConflictError` thrown by detection carries only the *structural* half of the message ("… its structure is a collection of N members — cannot bundle") with no source identity (`owner/repo`). Without the surface + forwarding + identity-prefixing, the installer override is inert and its hard-error message is incomplete.

**Solution**: Add a `--plugin` boolean option to the `addCommand` (commander), thread it through `runAdd(source, options)` into the single `detectType` call as `forcePlugin: options.plugin === true`, and wrap the detection call so a thrown `TypeConflictError` is caught pre-flight, prefixed with the parsed source identity (`parsed.manifestKey` / `owner/repo`), surfaced via `p.cancel`, and turned into a non-zero exit. The flag resolves only a skills-only ambiguity; the conflict/no-op semantics are entirely Phase 1's — this task is the CLI surface, the forward, and the identity-prefixed error.

**Outcome**: `agntc add owner/skills-only-repo --plugin` bundles the skills-only repo as a single plugin (installs via `copyPluginAssets`). `agntc add owner/bare-skill-repo --plugin` and `agntc add owner/collection-repo --plugin` fail pre-flight: non-zero exit, nothing written, a `p.cancel` message naming the source (`owner/repo`) and the structural conflict. `--plugin` on a multi-asset plugin is a redundant no-op (installs normally). With the flag absent, behaviour is exactly as task 2-1 left it.

**Do**:
- In `src/commands/add.ts`, change the `addCommand` definition (lines ~636–643): add `.option("--plugin", "Bundle a skills-only source as a single plugin")` and update the action to forward the parsed options: `withExitSignal(async (source, options) => { await runAdd(source, { forcePlugin: options.plugin === true }); })`. Commander exposes `--plugin` as `options.plugin` (boolean `true` when present, `undefined` when absent).
- Change `runAdd`'s signature to `runAdd(source: string, options?: { forcePlugin?: boolean })`. Default `forcePlugin` to `false`/`undefined` when `options` is omitted (preserves all existing single-arg call sites and tests that call `runAdd("owner/my-skill")`).
- Forward into the **single** `detectType` call from task 2-1: `await detectType(sourceDir, { onWarn, forcePlugin: options?.forcePlugin })`. Do **not** re-implement any precedence or conflict logic here — task 1-4 centralised it; this task only passes the input.
- Wrap the `detectType` call in a `try/catch` for `TypeConflictError` (import it from `../type-detection.js` — task 1-4 exports it). On catch: build a message that **prepends the source identity** to the detector's structural description, e.g. `` `${parsed.manifestKey} ${err.message}` `` rendered as `owner/repo declares … but its structure is a collection of N members — cannot bundle` (the detector supplies the structural half per task 1-4; the caller prepends `owner/repo`). Surface via `p.cancel(message)` and `throw new ExitSignal(1)` (non-zero, pre-flight, before any clone content is copied — `detectType` is pure read/classify so nothing is written yet).
  - Place the catch tightly around `detectType` (or let it propagate to the existing outer `catch` in `runAdd` — but the outer catch renders `errorMessage(err)` and exits **1** already; if you rely on the outer catch you must still prepend source identity *before* it reaches the generic handler, so a dedicated catch around `detectType` that re-throws an identity-prefixed `ExitSignal(1)` after `p.cancel` is cleaner and keeps the message correct). Prefer the dedicated catch.
- Ensure the flag is forwarded for **every** type branch, not just standalone: `--plugin` on a source that resolves to a `collection` must reach `detectType` (where task 1-4 throws `TypeConflictError` for member-dirs collections) — so the `forcePlugin` input is applied at the single `detectType` call *before* the collection-vs-standalone branch. (A skills-only structure with `--plugin` resolves to `plugin` inside `detectType` and therefore never enters the collection branch; a true member-dirs collection with `--plugin` throws inside `detectType` and never reaches the pipeline. Both are handled by the one forwarded call — no per-branch flag handling needed.)
- Do **not** add `--plugin` handling to `runCollectionPipeline` — by the above, a `--plugin` that survives to the collection branch is impossible (member-dirs + `--plugin` already threw; skills-only + `--plugin` became a plugin). Leave the pipeline untouched (Phase 3).

**Acceptance Criteria**:
- [ ] `addCommand` accepts `--plugin`; commander parses it to `options.plugin === true` when present, `undefined` when absent.
- [ ] `runAdd` forwards `forcePlugin` into the single `detectType` call; with the flag absent, `forcePlugin` is falsy and detection behaves as in task 2-1.
- [ ] `--plugin` on a skills-only source → `detectType` returns `{ type: "plugin", assetDirs: ["skills"] }` and the unit installs via `copyPluginAssets` (no error).
- [ ] `--plugin` on a bare skill → `detectType` throws `TypeConflictError`; `runAdd` catches it, calls `p.cancel` with a message containing the source identity (`owner/repo`) and the structural conflict, and exits non-zero (`ExitSignal(1)`); no manifest write, no copy.
- [ ] `--plugin` on a member-dirs collection → throws `TypeConflictError`; same identity-prefixed cancel + non-zero exit; the collection pipeline is **not** entered.
- [ ] `--plugin` on a multi-asset plugin → redundant no-op; the plugin installs normally (no error, no behaviour change).
- [ ] The error fires pre-flight (before any copy/manifest write).

**Tests** (extend `tests/commands/add.test.ts`; add a `--plugin` describe block):
- `"forwards forcePlugin: true to detectType when options.plugin is set"` — call `runAdd("owner/skills-only", { forcePlugin: true })`; assert `mockDetectType` called with options containing `forcePlugin: true`.
- `"does not set forcePlugin when flag absent"` — `runAdd("owner/my-skill")`; assert `mockDetectType` options have falsy `forcePlugin`.
- `"--plugin bundles a skills-only repo as a plugin"` — `mockDetectType` (with `forcePlugin`) → `{ type: "plugin", assetDirs: ["skills"] }`; assert `copyPluginAssets` called, install completes.
- `"--plugin on a bare skill is a hard error naming the source"` — `mockDetectType.mockRejectedValue(new TypeConflictError("requested as plugin but its structure is a bare skill — cannot bundle"))`; assert `ExitSignal` code 1, `p.cancel` called with a message containing `owner/my-skill` (or `owner/repo`) and `cannot bundle`, and `addEntry`/copy not called. (Import the real `TypeConflictError`; since `type-detection.js` is mocked in this suite, export `TypeConflictError` from the mock factory or `vi.importActual` it.)
- `"--plugin on a member-dirs collection is a hard error and does not enter the pipeline"` — `mockDetectType.mockRejectedValue(new TypeConflictError("… a collection of 3 members — cannot bundle"))`; assert exit 1, `p.cancel` includes source identity + member-count message, `selectCollectionPlugins` **not** called.
- `"--plugin is a redundant no-op on a multi-asset plugin"` — `mockDetectType` → `{ type: "plugin", assetDirs: ["skills","agents"] }`; assert install completes, no cancel.
- `"the TypeConflictError surfaces before any manifest write"` — assert `writeManifest` not called on the conflict path.
- Command-surface test (if a thin CLI/parsing test layer exists): assert `addCommand.options` includes a `--plugin` long flag; otherwise assert the action forwards `{ forcePlugin: true }` by spying on `runAdd` (or cover via the forwarding test above).

**Edge Cases**:
- `--plugin` + skills-only → bundle (the flag's valid use).
- `--plugin` + bare skill → hard error (would force skill→plugin; identical to `type:"plugin"` on a bare skill).
- `--plugin` + member-dirs collection → hard error (cannot bundle a non-bundleable collection); pipeline never entered.
- `--plugin` + multi-asset plugin → redundant no-op.
- Flag absent → identical to task 2-1.
- Source identity in the message comes from `parsed.manifestKey` (`owner/repo`); the detector supplies only the structural half — caller prepends.

**Context**:
> Spec — *Structural Type Detection → Detection precedence*: "1. Install flag `--plugin` (highest). 2. Config `type`. 3. Structure (default)."
> Spec — *Structural Type Detection → `--plugin` scope*: "Source resolves to a **skills-only** unit → `--plugin` bundles it as a plugin. This is its valid use. Source resolves to an **unambiguous member-dirs collection** → `--plugin` is a **hard error**. … Source resolves to an unambiguous **multi-asset plugin** → `--plugin` agrees (redundant, no-op). … Source resolves to an unambiguous **bare skill** → `--plugin` is a **hard error**."
> Spec — *Type-vs-structure conflict → hard error*: "`--plugin` on a member-dirs collection (or any non-bundleable structure) → error, exactly as `type: plugin` would. The flag's *only* extra power is winning the tie in the ambiguous case."
> Spec — *Error & Abort Behaviour → Hard errors (detection-time, before any write)*: "Type-vs-structure conflicts, `--plugin` on a non-bundleable structure … are **pre-flight failures**: nothing is written, the command exits **non-zero**, and the message names the offending source/unit and what conflicted (e.g. '`owner/repo` declares `type: plugin` but its structure is a collection of N members — cannot bundle')."
> Spec — *Config Model → Rules*: "No install-command flags for type or unit selection, except the single narrow `--plugin` installer override."
> Phase 1 contract (task 1-4): `detectType` accepts `forcePlugin?: boolean`, applies precedence/conflict centrally, and **exports** `TypeConflictError` whose message describes the structural conflict; "the caller prepends source identity." This task supplies that caller.
> Scope: `runCollectionPipeline` untouched (Phase 3); a `--plugin` that would reach it is structurally impossible (already resolved/thrown at the single `detectType` call).

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Structural Type Detection*, *Error & Abort Behaviour*, *Config Model*.

---

## configless-install-2-3 | approved

### Task configless-install-2-3: Tree-path subpath as standalone unit selector

**Problem**: The canonical unit/member selector is the GitHub tree-path URL `https://<host>/<owner>/<repo>/tree/<ref>/<subpath>`, parsed today as a `direct-path` source (`parseDirectPath` → `targetPlugin = <subpath>`, `manifestKey = owner/repo/<subpath>`, `@`-suffix rejected). But `runAdd` only routes a `direct-path` source **through the collection pipeline**: the root must `detectType` as a `collection`, and `runCollectionPipeline` then filters `detected.plugins` to `targetPlugin` and installs `join(sourceDir, targetPlugin)`. This breaks the configless selector contract two ways: (1) the targeted `<subpath>` unit is installed via the *collection* code path, not the standalone path, and only if the *root* happens to detect as a collection — a tree URL into a repo whose root is not a collection (e.g. a nested unit, or a repo restructured so the root no longer enumerates that child) cannot install; (2) detection/agent-resolution runs against the whole-repo root, not the selected subpath unit. The selector must resolve to the unit *at the subpath* and install it standalone, keyed `owner/repo/<subpath>`, with identity = the subpath basename — independent of what the repo root resolves to.

**Solution**: In `runAdd`, when the parsed source is a `direct-path`, point detection and install at the **subpath directory** (`join(sourceDir, parsed.targetPlugin)`) and run it through the standalone single-unit flow built in tasks 2-1/2-2, rather than always deferring to the collection pipeline. Compute `unitDir = parsed.type === "direct-path" ? join(sourceDir, parsed.targetPlugin) : sourceDir`; read config and run the single `detectType` against `unitDir`; the manifest key is already `parsed.manifestKey` (`owner/repo/<subpath>`); `copyBareSkill`/`copyPluginAssets` receive `sourceDir: unitDir`, so identity (`basename(unitDir)`) is the subpath basename. `@`-suffix rejection and tree-URL parsing stay in `parseDirectPath` (unchanged). `--plugin` (task 2-2) is orthogonal — it is forwarded to the same `detectType` call and resolves *the selected subpath unit's* skills-only ambiguity.

**Outcome**: `agntc add https://github.com/owner/repo/tree/main/path/to/unit` installs the unit at `path/to/unit` standalone, keyed `owner/repo/path/to/unit`, under a folder named after the subpath basename, with agents from the subpath unit's config (or the `KNOWN_AGENTS` default if configless). A tree URL with an `@ref` suffix is rejected by the parser (`tree URLs cannot have @ref suffix`). `--plugin` on a skills-only subpath bundles that subpath unit; on a not-bundleable subpath it hard-errors (task 2-2 semantics). A subpath that resolves to `not-agntc` exits cleanly (code 0).

**Do**:
- In `src/commands/add.ts`, after `sourceDir` is resolved (post-clone, step 2), compute the **unit directory** for the selector case: `const unitDir = parsed.type === "direct-path" ? join(sourceDir, parsed.targetPlugin) : sourceDir;` (`join` is already imported). Use `unitDir` for `readConfig`, the single `detectType` (with `forcePlugin` from task 2-2), and the copy `sourceDir`. The whole-repo (non-selector) case has `unitDir === sourceDir`, so this is a no-op for bare shorthand / plain URLs / local paths.
- Route a `direct-path` source through the **standalone** branch, not the collection pipeline: with detection now run against `unitDir`, a tree URL targeting a single unit resolves to `bare-skill`/`plugin`/`collection`/`not-agntc` *for that subpath*. The standalone install (tasks 2-1) handles `bare-skill`/`plugin`; `not-agntc` exits 0; a `collection` at the subpath would dispatch to `runCollectionPipeline` (a tree URL can legitimately point at a nested collection dir — but nested-collection *membership* recursion is Phase 3; here, simply route it to the existing pipeline with `sourceDir: unitDir` and let Phase 3 own deeper semantics). The key point: **detection is against the subpath, and the manifest key is `parsed.manifestKey` = `owner/repo/<subpath>`** (already produced by `parseDirectPath`).
- Pass `parsed.manifestKey` as the install key for the selector case exactly as the existing standalone path does (it already uses `parsed.manifestKey` for `readManifest` lookup, nuke, `addEntry`). No keying change is needed — `parseDirectPath` already sets `manifestKey = owner/repo/<subpath>`.
- Ensure the copy call receives `sourceDir: unitDir` so `basename(unitDir)` (the subpath's last segment) is the installed folder name (`copyBareSkill`/`copyPluginAssets` derive identity from `basename(sourceDir)` — see `src/copy-bare-skill.ts`). This yields identity = subpath basename per the spec's dir-basename rule.
- **Do not** change `parseDirectPath` in `src/source-parser.ts`: the `@`-suffix rejection (`if (rawPath.includes("@")) throw new Error("tree URLs cannot have @ref suffix")`), the `targetPlugin`/`manifestKey` derivation, and ref-in-path handling all stay as-is. This task consumes the existing parser output; it does not re-grammar it.
- **Subpath path-traversal guard is explicitly deferred to Phase 5.** Do **not** add a within-clone containment check for `parsed.targetPlugin` here. This task wires the selector to the standalone flow; the pre-flight traversal/symlink guards that validate `<subpath>` resolves within the clone are Phase 5 scope (note this in the test so a reviewer doesn't expect it).
- Reconcile with the existing collection direct-path behaviour: today a `direct-path` whose **repo root** is a member-dirs collection installs `targetPlugin` via the pipeline (the existing tests at `tests/commands/add.test.ts` ~line 1980). With detection now against `unitDir = root + "/" + targetPlugin`, that same install resolves the *member unit directly* and installs it standalone keyed `owner/repo/<targetPlugin>` — the **same manifest key and same installed files** as before, just via the standalone path. Update those direct-path tests so they stub `mockDetectType` to return the member's *unit* type when called with `unitDir` (e.g. `dir.endsWith("/pluginA") → { type: "bare-skill" }`) and assert the standalone copy + key `owner/my-collection/pluginA` — preserving the externally-observable outcome while reflecting the new internal route.

**Acceptance Criteria**:
- [ ] A `direct-path` source runs `readConfig` and `detectType` against `join(sourceDir, parsed.targetPlugin)`, not the repo root.
- [ ] A tree-URL unit installs standalone keyed `owner/repo/<subpath>` (`parsed.manifestKey`), with the installed folder named after the subpath basename.
- [ ] Agents for the subpath unit come from the subpath's own config (`config?.agents ?? []`), falling through to the `KNOWN_AGENTS` default when the subpath unit is configless.
- [ ] A tree URL carrying an `@ref` suffix is rejected by `parseDirectPath` (`tree URLs cannot have @ref suffix`) — unchanged parser behaviour, surfaced as a parse error and exit 1.
- [ ] `--plugin` is orthogonal to the selector: `--plugin` + a skills-only subpath bundles that subpath unit (`detectType` against `unitDir` returns `plugin`); `--plugin` + a non-bundleable subpath hard-errors per task 2-2.
- [ ] A subpath unit that resolves to `not-agntc` exits cleanly with `ExitSignal(0)` and writes nothing.
- [ ] Existing direct-path install outcome (manifest key `owner/repo/<targetPlugin>`, same copied files) is preserved, now via the standalone route.
- [ ] No subpath path-traversal/containment check is added (deferred to Phase 5).

**Tests** (extend `tests/commands/add.test.ts`, `direct-path source (tree URL)` describe block):
- `"detects and installs the subpath unit standalone (config against unitDir)"` — `mockReadConfig`/`mockDetectType` keyed on `dir.endsWith("/pluginA")` returning the unit's config/type; assert `detectType` called with `sourceDir + "/pluginA"` and `copyBareSkill` `sourceDir` is `sourceDir + "/pluginA"`.
- `"keys the manifest entry owner/repo/<subpath>"` — assert `addEntry` called with key `owner/my-collection/pluginA` (preserves existing assertion, new route).
- `"identity is the subpath basename"` — assert the copy `sourceDir` basename is `pluginA` (folder name derives from it).
- `"sources subpath agents from the subpath config"` — subpath config `{ agents: ["claude"] }` → `selectAgents` called with `declaredAgents: ["claude"]`; configless subpath (`null`) → `declaredAgents: []`.
- `"a configless subpath unit installs via the KNOWN_AGENTS default"` — subpath `readConfig` → `null`, `detectType` → `bare-skill`; assert install completes with `declaredAgents: []`.
- `"a tree URL with an @ref suffix is rejected"` — `mockParseSource` throws `Error("tree URLs cannot have @ref suffix")` (mirroring `parseDirectPath`); assert exit 1, no clone install. (Parser is mocked in this suite; assert the surfaced error path. Also covered structurally by `tests/source-parser.test.ts` for the real parser — do not duplicate parser-internal assertions here.)
- `"--plugin bundles a skills-only subpath unit"` — subpath `detectType` (with `forcePlugin`) → `{ type: "plugin", assetDirs: ["skills"] }`; assert `copyPluginAssets` called.
- `"--plugin on a non-bundleable subpath hard-errors"` — subpath `detectType` rejects `TypeConflictError`; assert exit 1, identity-prefixed cancel (reuses task 2-2's handling).
- `"a subpath unit that is not-agntc exits cleanly"` — subpath `detectType` → `not-agntc`; assert `ExitSignal(0)`, no `addEntry`.
- Rewrite the existing `"skips collection multiselect and installs targetPlugin directly"` and `"writes manifest with correct key for direct-path plugin"` tests so they reflect detection against `unitDir` (subpath) and the standalone route, preserving the key/files assertions.
- Note in a comment that the within-clone traversal guard for `<subpath>` is Phase 5.

**Edge Cases**:
- Tree URL → install the subpath unit standalone, key `owner/repo/<subpath>`, folder = subpath basename.
- `@`-suffix on a tree URL → parser rejects (unchanged); exit 1.
- `--plugin` + skills-only subpath → bundle that subpath unit (selector and flag orthogonal).
- `--plugin` + non-bundleable subpath → hard error (task 2-2 semantics).
- Subpath unit = `not-agntc` → clean exit 0.
- Whole-repo (no selector) install → `unitDir === sourceDir`, no behavioural change (the change is a no-op for non-`direct-path` sources).
- Multi-segment subpath (`path/to/unit`) → `targetPlugin` is the full subpath; identity is its last segment (`basename`).
- Subpath traversal/containment guard NOT implemented here — Phase 5.

**Context**:
> Spec — *Structural Type Detection → Source selector grammar (canonical)*: "Unit / member selection = the GitHub tree-path URL `https://<host>/<owner>/<repo>/tree/<ref>/<subpath>`. This is the existing `DirectPathSource`: it yields `ref = <ref>`, `targetPlugin = <subpath>`, and manifest key `owner/repo/<subpath>`. The `<subpath>` is the in-repo path of the unit to install (a collection member, or any nested unit). Tree URLs **cannot** also carry an `@ref` suffix (the parser rejects it; the ref lives in the URL path)."
> Spec — *Structural Type Detection → Selector / `--plugin` orthogonality*: "Selector = *which* unit to install. `--plugin` = *how to resolve the selected unit's* skills-only ambiguity. So a selector + `--plugin` reads as 'install the selected unit, resolve *its* ambiguity as plugin.' … There is no bespoke selector+flag combination rule."
> Spec — *Identity & Naming → Decision*: "Identity = directory basename, throughout. … each installs under its repo directory name." For a subpath unit, the install folder/key basename is the subpath's last segment.
> Spec — *Manifest Keying & Lifecycle → Keying*: "`owner/repo/<unit-dir>` for a collection member. … Configless adds no new keying scheme — it reuses the existing one." `parseDirectPath` already produces `owner/repo/<subpath>`.
> Spec — *Copy-Safety Hardening → In scope*: "Path-traversal guard — validate any source-supplied subpath … resolves *within* the clone before copying." Per the plan, this guard is **Phase 5** — explicitly deferred here.
> Existing parser (`src/source-parser.ts` `parseDirectPath`): rejects `@`-suffix on tree URLs, sets `targetPlugin`/`manifestKey = owner/repo/<subpath>`; consumed unchanged.
> Scope: deeper nested-collection/member semantics and the collection pipeline are Phase 3; this task only ensures the selector resolves to and installs the *subpath unit* via the standalone flow, with the traversal guard deferred to Phase 5.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Structural Type Detection* (Source selector grammar, Selector/`--plugin` orthogonality), *Identity & Naming*, *Manifest Keying & Lifecycle*, *Copy-Safety Hardening*.
