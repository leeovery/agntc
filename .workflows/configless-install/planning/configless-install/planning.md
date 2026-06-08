# Plan: Configless Install

## Phases

### Phase 1: Configless detection foundation — structural type, lenient config, agent default
status: approved
approved_at: 2026-06-06

**Goal**: Make type/identity/installability derive from directory structure alone and demote config to its two narrow jobs (`agents`, `type?`). Establish the governing posture (missing info → lenient default; contradictory info → loud error) in the lowest-level modules that every install path consumes: `type-detection.ts`, `config.ts`, and `agent-select.ts`.

**Why this order**: This is the foundation the feature names as "the small part" structurally but the load-bearing primitive everything else builds on. Every subsequent phase (`add`, collections, lifecycle) calls into structural detection, lenient config reading, and the agent default. Building these contracts first means later phases add to a working detection core rather than depending on unbuilt behaviour. Per the feature Phase 1 strategy, it integrates with the existing `detectType`/`readConfig`/`selectAgents` shape rather than re-proving architecture.

**Dependencies**: None (builds on existing modules).

**Acceptance**:
- [ ] `detectType` resolves type from structure via a single structural path: root `SKILL.md` → bare skill; `skills/`-only → skills-only ambiguous (default collection); ≥1 asset-kind dir (any combination not skills-only) → plugin; non-asset child dirs structurally resolving to units → collection; nothing reachable → not-agntc. Config presence is no longer an input to detection.
- [ ] A bare `SKILL.md` repo with no `agntc.json` (the `refero_skill` shape) detects as bare skill and is installable (no longer rejected as not-agntc).
- [ ] The two-level override resolves only the skills-only case: config `type: "plugin"` bundles a skills-only repo; `--plugin` flag bundles it and beats config `type` on disagreement; precedence is `--plugin` > config `type` > structure.
- [ ] A recognised `type: "plugin"` that contradicts an unambiguous structure (bare skill, or member-dirs collection) is a hard error naming the source and conflict; `--plugin` on a bare skill or member-dirs collection errors identically. `type: "collection"` and all other/unknown values are silently ignored.
- [ ] `readConfig` is lenient: missing file, malformed JSON, and missing/empty `agents` all return "no usable config" without throwing; unknown keys are ignored; only `agents` and `type` are read.
- [ ] `selectAgents` sources candidates from `KNOWN_AGENTS` (pre-ticking detected agents, always prompting) when there is no valid declaration; a valid non-empty `agents` list remains a hard ceiling with single-detected-agent auto-select unchanged. The `return []` "install for nobody" path is gone.
- [ ] Existing detection/config/agent-selection behaviour for config-bearing repos (e.g. `agentic-workflows` Claude-only) is preserved; full suite green.

#### Tasks
status: approved
approved_at: 2026-06-06

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| configless-install-1-1 | Lenient config reading with optional type | missing file, malformed JSON, missing agents key, empty agents array, all-unknown agents, unknown extra keys, unrecognised type value, non-permission IO errors still propagate |
| configless-install-1-2 | Single structural detection path | bare SKILL.md no config (refero_skill shape), SKILL.md alongside asset dirs, skills-only defaults to collection, agents/hooks-only is plugin, one-level child scan, empty/unreadable dir, files-only root |
| configless-install-1-3 | Structural collection membership (one level down) | configless members, mixed config-bearing and configless members, child with neither SKILL.md nor asset dir skipped, nested-collection child not recursed, no qualifying children -> not-agntc |
| configless-install-1-4 | Two-level type override and conflict hard error | type:"plugin" bundles skills-only, --plugin bundles skills-only, --plugin beats config type, redundant no-op on multi-asset plugin, type:"plugin"/--plugin on bare skill -> error, type:"plugin"/--plugin on member-dirs collection -> error, type:"collection" ignored, unknown type ignored |
| configless-install-1-5 | KNOWN_AGENTS default in selectAgents | no declaration -> all KNOWN_AGENTS, empty declaration -> all KNOWN_AGENTS, default never auto-selects with one detected, detected pre-ticked, valid ceiling unchanged, single-declared-detected auto-selects, cancel/zero-selection returns [] |

### Phase 2: Configless standalone install through `add`
status: approved
approved_at: 2026-06-06

**Goal**: Wire the Phase 1 primitives through the `runAdd` standalone path so a configless bare skill or plugin installs end-to-end: detect structurally, select agents via the new default, copy, and persist. Add the `--plugin` installer override and the tree-path subpath as the unit selector, keeping identity = directory basename throughout.

**Why this order**: This is the headline user-facing capability — installing `referodesign/refero_skill` with zero config. It depends on Phase 1's detection/config/agent contracts and delivers the first complete configless install a user can run. It precedes collections and lifecycle because the single-unit `add` path is the simpler vertical slice and establishes the install wiring those phases extend.

**Dependencies**: Phase 1 (structural detection, lenient config, `KNOWN_AGENTS` agent default).

**Acceptance**:
- [ ] `agntc add referodesign/refero_skill` (bare `SKILL.md`, no config, untagged) installs the skill under its repo-basename folder/manifest key, with no `agntc.json` left on disk, agents chosen from the `KNOWN_AGENTS` default.
- [ ] The `add` path no longer treats null config as "must be a collection" — a configless bare skill or configless multi-asset plugin installs standalone; a not-agntc source fails pre-flight loudly (source-named `p.cancel`, non-zero exit), per the spec's *Error & Abort Behaviour → Hard errors* contract.
- [ ] `--plugin` is accepted by the `add` command and forwarded as the skills-only override; it bundles a skills-only repo and is a hard error (non-zero, named conflict) on a bare skill or member-dirs collection.
- [ ] A tree-path URL selector (`.../tree/<ref>/<subpath>`) installs the unit at `<subpath>` keyed `owner/repo/<subpath>`; `@`-suffixes remain version refs only and are rejected on tree URLs.
- [ ] Config-bearing standalone installs (declared-agents ceiling, auto-select) behave exactly as before; full suite green.

#### Tasks
status: approved
approved_at: 2026-06-06

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| configless-install-2-1 | Configless standalone detect-and-install wiring | null config bare skill (refero_skill shape), null config multi-asset plugin, config-bearing standalone unchanged, detected collection still dispatches, not-agntc fails pre-flight loudly (source-named p.cancel, ExitSignal(1)), dead ConfigError catch removed, agents sourced from config?.agents ?? [] |
| configless-install-2-2 | `--plugin` installer-override flag surface and forwarding | --plugin bundles skills-only repo, --plugin on bare skill -> hard error (non-zero, named), --plugin on member-dirs collection -> hard error, --plugin redundant no-op on multi-asset plugin, flag absent unchanged, TypeConflictError message names source identity |
| configless-install-2-3 | Tree-path subpath as standalone unit selector | tree URL installs unit at subpath keyed owner/repo/<subpath>, identity = subpath basename folder, @-suffix on tree URL rejected, --plugin orthogonal to selector on skills-only subpath, subpath unit that is not-agntc fails pre-flight loudly (source-named p.cancel, ExitSignal(1)) |

### Phase 3: Structural collection membership and selection
status: approved
approved_at: 2026-06-06

**Goal**: Redefine collection membership as "a child dir that structurally resolves to a unit" by recursing Phase 1 detection one level down, replacing the `has-agntc.json` enumeration. Drive selection with the existing prompt and tree-path selector; read child config only for agents when present; keep nested collections unsupported.

**Why this order**: Collections are the multi-unit extension of the Phase 2 install path and reuse its detection, agent-default, and copy wiring. It comes after standalone install because the collection pipeline is a per-member fan-out over the single-unit logic already proven in Phase 2, and because the configless change here (structural membership) only matters once members can be configless.

**Dependencies**: Phase 1 (one-level-down structural detection), Phase 2 (single-unit install wiring the pipeline fans out over).

**Acceptance**:
- [ ] Collection membership comes from structural detection per immediate child dir (child `SKILL.md` → bare-skill member; child with ≥1 asset-kind dir → plugin member; neither → skipped), not from `agntc.json` presence.
- [ ] A collection of configless members enumerates and installs selected members, each keyed `owner/repo/<unit>` under its basename; config-bearing and configless members coexist, each member's agents resolved per the Phase 1 rules.
- [ ] A stray root `agntc.json` on a member-dirs structure does not reclassify it (no-`type` ignored; `type: "plugin"` is a hard error); a collection container is never treated as carrying installable config.
- [ ] Select-all installs every member; the tree-path selector targets a single member directly without prompting; nested collection members are skipped with a warning (one level only).
- [ ] Existing collection behaviour for config-bearing collections still works; full suite green.

#### Tasks
status: approved
approved_at: 2026-06-06

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| configless-install-3-1 | Structural member enumeration without config dependency | configless member (null config) no longer skipped, config-bearing and configless members coexist, member dropped only by structural re-detect not missing config, member re-detect uses Phase 1 options shape (no hasConfig), all-configless collection installs members |
| configless-install-3-2 | Per-member agent resolution replacing the union prompt | configless member sources KNOWN_AGENTS default, config-bearing member keeps declared ceiling, mixed members resolve agents independently, member with zero applicable agents silently skipped, declared-single-detected auto-select per member, per-member manifest records only its agents |
| configless-install-3-3 | Remove dead ConfigError handling from the collection pipeline | ConfigError catch removed, ConfigError import dropped from add.ts once no live reference, build and full suite stay green |
| configless-install-3-4 | Nested-collection member skipped with a pipeline warning (one level only) | nested-collection child skipped with warning, sibling members still install, member re-detecting not-agntc skipped, one-level-only recursion, warning emitted by pipeline not detector |
| configless-install-3-5 | Stray root agntc.json does not reclassify a member-dirs collection | root config with no type ignored (still collection), root type:"plugin" on member-dirs -> TypeConflictError pre-flight non-zero, container config never read as installable unit, configless-root collection unchanged |
| configless-install-3-6 | Select-all and tree-path selector target structural members | select-all installs every structural member, tree-path selector installs single member without prompting, selector member keyed owner/repo/<unit>, selector target absent from structural list -> clear error, config-bearing collection selection flow unchanged |

### Phase 4: Manifest type lifecycle — record, replay, derive-before-delete, legacy backfill
status: approved
approved_at: 2026-06-06

**Goal**: Add `type?: "skill" | "plugin"` to `ManifestEntry`, persist the resolved type on install, and make `update` replay the recorded type rather than blind re-detection — with derive-before-delete validation, irreconcilable-change abort that leaves the install intact, per-entry abort granularity, and in-memory legacy backfill from `files` on manifest read.

**Why this order**: Lifecycle correctness depends on installs already recording a resolved type, which Phases 2–3 produce. This phase closes the hazard the spec calls out: that configless `update` re-clones and could silently morph type. It comes after the install paths because there must be a "resolved type" to record and replay, and its abort/backfill rules are a distinct risk profile (data migration, non-destructive validation) warranting its own checkpoint. Backfill on read makes `type` available uniformly to `list`/`remove`/`update`.

**Dependencies**: Phase 1 (per-type detection predicates), Phases 2–3 (installs that record the resolved type).

**Acceptance**:
- [ ] `ManifestEntry.type` is optional (`"skill" | "plugin"`); the resolved type from any derivation path (structure, config `type`, `--plugin`) is persisted on install for standalone units and collection members alike (no collection-level entry).
- [ ] `update` replays the recorded type: recorded `skill` re-copies the unit dir if root `SKILL.md` still exists (benign added asset dirs ignored); recorded `plugin` re-copies present asset dirs if ≥1 asset-kind dir remains. The re-cloned tree is validated against the recorded-type predicate **before** any file removal.
- [ ] Irreconcilable change (vanished unit/subpath, structure no longer supports recorded type) aborts that unit's update with the existing install left fully intact, a clear message naming recorded-vs-current and the manual `remove`+`add` remedy, and an "aborted" report.
- [ ] Abort granularity is per manifest entry: a plugin aborts atomically; a collection member aborts independently of its siblings; each failure is reported loudly with its own reason.
- [ ] Legacy `type`-less entries backfill in-memory on manifest read from `files` (asset-target/multi-skill-under-one-key → plugin; single skills dir → skill), persisted on next write; reading legacy manifests never errors; backfill derives from local `files`, never a re-clone.
- [ ] Tagless `ref: null` → HEAD tracking and existing tagged-constraint behaviour are unchanged; commands reading the manifest (`list`, `remove`) tolerate and benefit from the backfilled `type`; full suite green.

#### Tasks
status: approved
approved_at: 2026-06-06

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| configless-install-4-1 | Add optional type field and persist on standalone install | bare-skill maps to "skill", plugin maps to "plugin", field optional so absent-type readers tolerate it, direct-path standalone subpath records own resolved type, --plugin/config-type-derived plugin records "plugin" |
| configless-install-4-2 | Persist resolved type on each collection member entry | mixed skill/plugin members each record own type, configless and config-bearing members both record type, no collection container entry written, direct-path single member keyed owner/repo/<unit> records its type |
| configless-install-4-3 | Legacy backfill of type from files on manifest read | single skills dir → skill (single-skill ambiguity accepted), agents/hooks targets → plugin, multiple skill dirs under one key → plugin, entry already has type not overwritten, per-agent skills target paths, empty files array, reading legacy manifest never errors, list/remove benefit from backfilled type |
| configless-install-4-4 | Update replays recorded skill type with derive-before-delete validation | recorded skill + SKILL.md present re-copies unit dir, benign added asset dirs ignored not re-derived, SKILL.md vanished → abort before nuke, member subpath vanished → abort, validation runs before nukeManifestFiles |
| configless-install-4-5 | Update replays recorded plugin type with the plugin predicate | recorded plugin + ≥1 asset dir re-copies present dirs, benign added asset dir picked up, all asset dirs gone (now bare skill/member-dirs collection) → abort, member subpath no longer supports plugin → abort, validation before nuke |
| configless-install-4-6 | Surface irreconcilable-change abort intact through update reporting | install files left fully intact (no nuke ran), message names recorded type vs current structure, manual remove+add remedy present, "aborted" report, single-key update exits non-zero, distinct from copy-failed-after-nuke residual |
| configless-install-4-7 | Per-entry abort granularity and partial-success exit status | one member aborts while siblings update, plugin abort whole-entry atomic, each aborted entry reported with own reason, exit non-zero on partial abort, all-updates summary lists per-unit outcomes, no collection-level coherence rollback |

### Phase 5: Copy-safety hardening — path-traversal and symlink-escape guards
status: approved
approved_at: 2026-06-06

**Goal**: Add the two pre-flight guards the configless input demands: a path-traversal guard validating any source-supplied subpath resolves within the clone, and a symlink-escape guard rejecting any symlink whose target resolves outside the cloned repository root. Both run as a pre-flight scan of the unit tree before any copy, on both `add` and `update`'s re-copy.

**Why this order**: This is hardening that protects the copy path configless newly exposes (the trust gate `agntc.json`-presence is removed in earlier phases). It comes last because it guards the copy operations established across Phases 2–4 and is orthogonal to install/lifecycle correctness — a distinct security-risk checkpoint. The bare-skill case (Phase 2) and the re-copy on update (Phase 4) must exist before their copy paths can be routed through the guards.

**Dependencies**: Phase 2 (bare-skill/standalone copy), Phase 3 (member copy), Phase 4 (`update` re-copy path).

**Acceptance**:
- [ ] A pre-flight scan runs before every copy that ingests cloned content (`add` and `update`'s re-copy); on any violation it errors before writing anything, exits non-zero, and names the offending unit/path — no on-disk window for escaping content.
- [ ] The path-traversal guard rejects a selector `<subpath>` that resolves outside the clone and is a no-op for whole-repo (no-selector) installs like the bare-skill case.
- [ ] The symlink-escape guard rejects any symlink whose target resolves outside the cloned repository root (absolute paths, `..`-escapes), runs on every install including bare skills, and allows symlinks resolving anywhere inside the clone.
- [ ] Broken (nonexistent-target) symlinks are evaluated lexically: lexical escape above the clone root → reject; otherwise copied verbatim.
- [ ] A collection-`add` in which any member hard-errors (e.g. an escaping-symlink violation, or the pre-existing per-member copy failure) commits the successful members, renders the per-unit summary, and then exits **non-zero** (`ExitSignal(1)`); a `skipped` member (not-agntc / nested-collection) is non-fatal — the multi-member-install analogue of the Phase 4 `update` partial-success exit, per spec *Error & Abort Behaviour → Partial outcomes for collections*.
- [ ] The single recursive `cp` runs only on a verified-clean tree; the copy mechanism itself (recursive copy, keep everything, post-copy `agntc.json` deletion) is otherwise unchanged; full suite green.

#### Tasks
status: approved
approved_at: 2026-06-06

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| configless-install-5-1 | Path-traversal guard utility (subpath-within-clone containment) | empty/no subpath is a no-op, ..-escape above clone root rejected, absolute subpath rejected, subpath equal to clone root allowed, nested-but-contained subpath allowed, resolves real path before containment, trailing-slash/dot/redundant segments normalised |
| configless-install-5-2 | Symlink-escape pre-flight scan utility (clone-root boundary) | absolute-target symlink rejected, ..-escape-above-clone-root symlink rejected, symlink resolving inside clone allowed, symlink to sibling dir inside clone allowed, broken symlink lexically inside clone copied verbatim, broken symlink lexically escaping clone root rejected, deeply-nested symlink found, symlink-to-directory traversed without recursion blow-up, non-symlink tree is a clean no-op, error names the offending relative path/unit |
| configless-install-5-3 | Wire path-traversal + symlink guards as the add copy pre-flight | whole-repo bare skill (traversal no-op, symlink scan still runs), selector subpath escaping clone errors pre-flight non-zero before any copy, valid subpath but escaping symlink errors, collection members each scanned independently before their copy, configless plugin tree scanned, violation names offending unit/path, no manifest write or copy on violation, collection-add with a failed member exits non-zero (ExitSignal(1)) after committing siblings + rendering the summary, skipped member (not-agntc/nested-collection) non-fatal |
| configless-install-5-4 | Wire the symlink-escape guard into update's re-copy pre-flight | clone-mode update scans against the tempDir clone root, local-path update scans against the provided sourceDir root, escaping symlink aborts before nukeManifestFiles (install left intact), member subdir scanned against its own clone root, violation surfaced as a pre-flight failure that exits non-zero, no nuke or copy on violation |

### Phase 6: Analysis (Cycle 1)

**Goal**: Address findings from Analysis (Cycle 1).

#### Tasks

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| configless-install-analysis-1-1 | Consolidate the clone-and-reinstall flow across the four update entry points | local vs remote entry prep via prepareReinstall, list-action abort output includes recordedType + remedy, all four flows behaviourally unchanged |
| configless-install-analysis-1-2 | Move the lexical path-traversal subpath check ahead of detection/config reads | escaping single-plugin subpath rejected before reads, escaping collection member aborts before runCollectionPipeline reads configs, valid in-bounds subpath still installs, symlink scan remains pre-copy |
| configless-install-analysis-1-3 | Add integration coverage for the configless cross-task seams | configless bare-skill detect->copy->write->read type:skill, legacy entry without type backfill persists derived type, recorded-plugin reshaped to bare-skill abort with files intact, escaping-symlink source aborts before nuke |
| configless-install-analysis-1-4 | De-duplicate the asset-dir presence scan | findPresentAssetDirs for zero/one/many dirs, detection/membership/replay consumers unchanged, single existence primitive |
| configless-install-analysis-1-5 | De-duplicate the fs-existence helper and the ManifestEntry construction | buildManifestEntry with/without constraint and cloneUrl, no local exists, three sites produce byte-identical entries |
| configless-install-analysis-1-6 | Simplify the clone-reinstall failure-status modelling | mapCloneFailure aborted via status and failed variants via failureReason, no-agents single-key returns null/exit 0 untouched, all-updates non-fatal skip unchanged |

### Phase 7: Analysis (Cycle 2)

**Goal**: Address findings from Analysis (Cycle 2).

#### Tasks

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| configless-install-analysis-2-1 | Skills-only collection member is silently skipped at install instead of installing as a plugin member | skills-only member resolves to plugin and installs (files copied + manifest entry), member-level type:plugin config consulted in per-member detection, genuine nested members-collection still skipped with "nested collections not supported", not-agntc child still skipped, real member dir test replaces mocked detectType |
| configless-install-analysis-2-2 | Tighten the collection-member result type seam to eliminate the runtime narrowing throw | detectedType narrowed to Extract bare-skill|plugin and required on installed variant, runtime "missing a resolved type" throw removed, manifestTypeFromDetected keys on discriminated t.type, no any/cast escape hatch, type-check + tests pass |
| configless-install-analysis-2-3 | Extract a single copyUnit / unit-descriptor helper for the plugin-vs-bare-skill dispatch | single copyUnit helper called from both standalone and collection-member paths, single toComputeInput mapping for both paths, both plugin and bare-skill arms exercised, nuke-reinstall replay left as-is, install behaviour unchanged |
| configless-install-analysis-2-4 | Extract an isCloneReinstallFailure type-guard for the four-site non-success guard | failure-set defined once beside mapCloneFailure, all four reinstall entry points use the guard, mapCloneFailure receives narrowed type, per-site behaviour unchanged |
| configless-install-analysis-2-5 | selectAgents must distinguish cancellation from deliberate empty-selection | discriminated cancelled|selected result, standalone emits single accurate cancel message (no emit-then-overwrite), collection-member empty-selection still skips per-member, assertions updated for new return shape |
| configless-install-analysis-2-6 | Type-conflict error message must not attribute a --plugin-flag conflict to a config type plugin declaration | --plugin conflict on bare skill/members-collection names the flag, config type:plugin conflict names the config, non-zero pre-flight exit unchanged for both |
| configless-install-analysis-2-7 | Remove the dead ConfigError class | ConfigError class + export removed from config.ts, no remaining references in codebase, config module exposes no error type, type-check + leniency tests pass |

### Phase 8: Analysis (Cycle 3)

**Goal**: Address findings from Analysis (Cycle 3).

#### Tasks

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| configless-install-analysis-3-1 | Give update's symlink-escape its own copy-safety outcome and message | escaping symlink on update yields copy-safety/blocked message (no "type no longer supported" / remove+add), install + manifest left intact, aborted/buildAbortMessage reserved for genuine recorded-type mismatches, add and update describe the violation with consistent copy-safety framing |
| configless-install-analysis-3-2 | Extract a shared CloneReinstallFailure-to-message helper for the two list actions | both list actions surface the same helper-produced message for every CloneReinstallFailure variant, change-version success still strips constraint while update success does not, success discriminators (success vs changed) + messages unchanged, processUpdateForAll untouched, no duplicated mapCloneFailure handler object remains |

### Phase 9: Analysis (Cycle 4)

**Goal**: Address findings from Analysis (Cycle 4).

#### Tasks

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| configless-install-analysis-4-1 | Remove dead buildFailureMessage paralleling the centralised failureMessage | dead function deleted, no production caller, no-agents sentence single source of truth across clone-reinstall.ts:434 + update.ts:216 + failureMessage, buildFailureMessage tests removed/migrated, no behaviour change |
| configless-install-analysis-4-2 | Consolidate the symlink-escape scan-and-narrow block across the three install/replay sites | single copy-safety helper returns discriminated ok result, three call sites drop instanceof narrowing, standalone cancel+ExitSignal(1) / member failed-result+continue / pipeline blocked-status preserved, non-SymlinkEscapeError errors still propagate, scan boundaries unchanged |

### Phase 10: Analysis (Cycle 5)

**Goal**: Address findings from Analysis (Cycle 5).

#### Tasks

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| configless-install-analysis-5-1 | Consolidate add.ts manifest-entry literal and collection member-key ternary | buildManifestEntry literal authored at one site, both former call sites invoke the helper, member-key ternary authored once and reused by 5a + step-6, manifest entries and keys byte-for-byte identical for standalone and collection paths, helpers stay local to add.ts, npm test passes unchanged |

### Phase 11: Review Remediation (Cycle 1)

**Goal**: Address findings from Review Remediation (Cycle 1).

#### Tasks

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| configless-install-review-1-1 | Add integration scenario exercising the update-time symlink-escape pipeline seam (blocked-before-nuke) | drives production executeNukeAndReinstall (not scanForEscapingSymlinks/copyBareSkill directly) on an existing recorded install with escaping symlink in re-cloned source, asserts status === "blocked", asserts install files remain on disk (no nuke before block), asserts manifest entry unchanged via readRawManifest, retains pre-existing guard-level scenario at :729-772 with describe rename distinguishing guard-level from pipeline-level blocked, no mocks introduced, tsc --noEmit clean, full suite passes |
| configless-install-review-1-2 | Remove the orphaned, now-incorrect JSDoc block above isCloneReinstallFailure | orphaned block at former :126-133 removed, mapCloneFailure gains leading doc correctly listing aborted (derive-before-delete) / blocked (symlink-escape copy-safety) / no-agents (lenient skip) with no symlink-escape-under-aborted conflation, isCloneReinstallFailure retains its own unchanged comment, no code/behaviour change, tsc --noEmit clean, full suite passes (documentation-only edit) |

### Phase 12: Analysis (Cycle 7)

**Goal**: Address findings from Analysis (Cycle 7).

#### Tasks

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| configless-install-analysis-7-1 | Extract shared copy-safety mock helper to stop six test files re-encoding production narrowing logic | single scan-and-narrow authored in tests/helpers/copy-safety-mock.ts, none of the six files keep an inline copy, supports both ...actual-spread (update/list/pipeline narrowing on actual.SymlinkEscapeError) and full-replacement (add.test.ts local PathTraversalError/SymlinkEscapeError) shapes, scanForEscapingSymlinks remains drivable per-test via exposed handle, assertSubpathWithinClone preserved, helper returns { ok: true } on clean scan / { ok: false, message } on SymlinkEscapeError / rethrows non-SymlinkEscapeError, no production change, npm test passes unchanged |
| configless-install-analysis-7-2 | Extract canonical @clack/prompts mock to stop spinner/log shape drifting across command test files | base intro/outro/spinner({start,stop,message})/log{info,warn,error,success}/cancel authored once in tests/helpers/clack-mock.ts, four command test files delegate to factory, files needing select/isCancel/log.message obtain them via extension mechanism not base redefinition, no test loses a vi.fn() it asserts against, no production change, npm test passes unchanged |

### Phase 13: Analysis (Cycle 8)

**Goal**: Address findings from Analysis (Cycle 8).

#### Tasks

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| configless-install-analysis-8-1 | Skills-only default must enumerate inner skills as an installable collection menu | populated skills/-only root flag-free enumerates inner skills/<name> as members (not empty plugins:[]), member dir resolves to skills/<name> while manifest key stays owner/repo/<name> basename, configType:plugin and forcePlugin still bundle as single plugin (assetDirs:["skills"]), genuinely-empty skills/ resolves to no-member outcome without crash, each selected member installs as bare skill to per-agent bare-skill location, existing root-child member-dirs collection path and all other detection branches unchanged |
