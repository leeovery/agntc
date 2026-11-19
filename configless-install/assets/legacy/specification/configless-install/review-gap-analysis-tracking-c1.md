---
status: complete
created: 2026-06-06
cycle: 1
phase: Gap Analysis
topic: configless-install
---

# Review Tracking: configless-install - Gap Analysis

## Findings

### 1. Legacy backfill heuristic cannot distinguish a single-skill bundled plugin from a bare skill

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Manifest Keying & Lifecycle → Legacy backfill

**Details**:
The `files`→type backfill maps a single `.claude/skills/<name>/` → `skill`, but a single-skill bundled plugin has an identical footprint.

**Resolution**: Approved
**Notes**: Added "Single-skill ambiguity is accepted collateral" bullet — backfills as `skill`, behaviourally identical for replay; only divergence is a later asset-dir addition, remedy is manual remove+add. No tiebreaker.

---

### 2. Inconsistent definition of which asset-dir combinations constitute a plugin

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Structural Type Detection (table vs detection prose); Collection Membership

**Details**:
Table requires `skills/` + (`agents/`|`hooks/`); prose says any asset-kind dir → plugin. Disagreement on `agents/`-only / `hooks/`-only.

**Resolution**: Approved
**Notes**: Added "Canonical plugin rule" — plugin = ≥1 asset-kind dir (skills-only excepted), matching `detectType`'s `foundAssetDirs.length > 0`. `agents/`-only / `hooks/`-only → plugin. Table reframed as illustrative.

---

### 3. Source-string selector grammar referenced in three incompatible forms but never defined

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Config Model; Structural Type Detection; Collection Membership; Copy-Safety

**Details**:
`owner/repo@unit`, `tree/<branch>/<path>`, `#ref@skill` used inconsistently; collides with existing `@`=ref parser semantics.

**Resolution**: Approved
**Notes**: Added "Source selector grammar (canonical)" — `@` = ref/constraint only (existing parser); unit selection = tree-path URL (`DirectPathSource`); no `owner/repo@unit` shorthand introduced. Fixed Collection Membership UX line to match.

---

### 4. `--plugin` target is undefined when installing a collection

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Structural Type Detection

**Details**:
`--plugin` with a no-selector multi-member collection install is undefined.

**Resolution**: Approved
**Notes**: Added "`--plugin` scope" — acts on the resolved unit; valid only for skills-only; on an unambiguous member-dirs collection → hard error; select-all in prompt installs all members.

---

### 5. `type` field optionality + backfill-on-read timing unspecified

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Manifest Keying & Lifecycle

**Details**:
Is `type` required/optional on `ManifestEntry`? Backfill lazily on read (like `cloneUrl`) or only inside `update`?

**Resolution**: Approved
**Notes**: Added "`type` field: optionality and backfill timing" — `type?` optional; backfilled in-memory on read (mirrors `cloneUrl`), persisted on next write, available to all commands.

---

### 6. "Derive-before-delete" validation criteria for `update` abort not concretely defined

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Manifest Keying & Lifecycle

**Details**:
No concrete per-type pass/fail predicate; member "vanished subdir" wording seems to contradict root-level "structure incompatible → abort".

**Resolution**: Approved
**Notes**: Added "Derive-before-delete validation predicate (per recorded type)" — skill: root `SKILL.md` present; plugin: ≥1 asset dir; members apply same predicate to own subdir. Harmonised member rule with root rule.

---

### 7. No acceptance criteria / observable behaviour for hard-error and abort cases

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Structural Type Detection; Manifest Keying; Agent Selection; Backward-Compat

**Details**:
"hard error" / "loud alert" never define exit code, message, scope, or whether the command continues with other units.

**Resolution**: Approved
**Notes**: Added dedicated "## Error & Abort Behaviour" section — pre-flight hard errors (non-zero, nothing written); update abort (install intact, manual remedy); per-entry partial outcomes (non-zero if any failed, per-unit summary); residual copy-after-nuke acknowledged.

---

### 8. Symlink-escape guard boundary & update-path coverage underspecified

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Copy-Safety Hardening

**Details**:
Boundary (per-skill-dir vs clone root), broken symlinks, and whether `update` re-copy is guarded all unspecified.

**Resolution**: Approved
**Notes**: Added "Symlink guard: boundary, broken links, and update coverage" — boundary = clone root; broken links evaluated lexically; guard runs on both `add` and `update` copy paths.

---

### 9. type-value validation vs config leniency contradiction; `type: "collection"` allowed?

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Config Model; Agent Selection; Structural Type Detection

**Details**:
Lenient config-read vs hard type-conflict error tension; config shape says `type?: "plugin"` but conflict examples treat `type: collection` as a real value.

**Resolution**: Approved
**Notes**: Added "Recognised `type` values and the leniency-vs-error boundary" — unparseable/unusable config → lenient; well-formed recognised `type` unrealizable → loud error. Only `"plugin"` recognised; `"collection"` and any other value ignored. Supersedes the `type: collection` error example.

---

### 10. `agntc.json` deletion-after-copy scope across unit types unstated

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Copy-Safety Hardening; Identity & Naming

**Details**:
Whether the post-copy `agntc.json` deletion is retained/extended to plugins/members under configless.

**Resolution**: Approved
**Notes**: Added "Installed units never carry `agntc.json`" — deletion retained and generalised; config re-read from source on update, so no lifecycle impact.

---

### 11. "pre-tick detected agents" detection signal + auto-select interaction unspecified

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Agent Selection

**Details**:
How are agents "detected"? Does single-agent auto-select apply in the no-constraint default?

**Resolution**: Approved
**Notes**: Added "Agent detection signal and auto-select interaction" — detection via existing `detectAgents`/driver `.detect()`; no-constraint default always prompts (no auto-select); auto-select scoped to declared-single-agent case only.

---
