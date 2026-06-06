---
status: complete
created: 2026-06-06
cycle: 3
phase: Traceability Review
topic: Configless Install
---

# Review Tracking: Configless Install - Traceability

## Summary

Cycle-3 traceability analysis of the configless-install plan (planning.md + phase-1..5-tasks.md,
25 tasks) against the validated specification, both directions, read fresh. The cycle-1 finding
(a `type`-only config being dropped) and its cascade remain resolved and internally consistent;
cycle-2 was clean. This cycle re-examined the spec's *Error & Abort Behaviour* contract against
the plan's exit-code handling and surfaced **one** previously-unraised gap: the plan preserves the
**legacy `ExitSignal(0)` (clean) exit** for a top-level **not-agntc source**, whereas the spec's
*Hard errors* section explicitly reclassifies a not-agntc source as a **loud pre-flight failure
that exits non-zero with a named message**.

### Direction 1: Specification → Plan (completeness)

Every spec section has plan coverage with adequate depth, except the one gap below:

- **Overview / anchor cases** — `refero_skill` and `agentic-workflows` paths covered (1-2, 2-1,
  4-1, 5-2/5-3; 1-5).
- **Config Model** — lenient reading (1-1), `{agents, type?}` shape, presence-never-signals-type,
  unknown-key tolerance, recognised-`type`/leniency boundary; the cycle-1 fix holds.
- **Structural Type Detection** — four shapes, single path, canonical plugin rule, two-level
  override precedence, skills-only resolution, type-vs-structure hard error, selector grammar,
  orthogonality (1-2..1-4, 2-2, 2-3, 3-5, 3-6).
- **Identity & Naming** — dir-basename, no frontmatter parsing, recursive keep-everything copy
  (2-1, 2-3, 4-1/4-2).
- **Manifest Keying & Lifecycle** — type field + optionality, persist (4-1/4-2), replay
  (4-4/4-5), derive-before-delete predicates, irreconcilable abort intact (4-6), per-entry
  granularity + partial-success **non-zero exit** (4-7), in-memory legacy backfill (4-3), keying.
- **Agent Selection** — KNOWN_AGENTS default, ceiling, auto-select scoping, three unified
  no-constraint cases (1-5; per-member 3-2).
- **Collection Membership & Selection Flow** — structural one-level membership (1-3, 3-1),
  per-child agents (3-2), select-all/selector UX (3-6), nested unsupported with pipeline
  warning (3-4), stray-root config (3-5). A collection member that **re-detects** not-agntc is
  correctly handled as a loud per-member skip with siblings continuing (3-4) — consistent with
  *Partial outcomes for collections*; the finding below does **not** apply to that per-member case.
- **Version Pinning** — reuse tagless→HEAD unchanged, no new code (carried as "unchanged").
- **Copy-Safety Hardening** — path-traversal (5-1), symlink-escape with clone-root boundary +
  lexical broken-link handling (5-2), add (5-3) and update (5-4) wiring; copy mechanism +
  post-copy `agntc.json` deletion unchanged (re-verified against `src/copy-bare-skill.ts`:34 —
  bare-skill deletes it post-copy; plugin asset copy never copies a root config).
- **Backward-Compat / Migration** — legacy backfill (4-3), `init` unchanged (correctly no task),
  config schema (1-1/1-2), stray root config (3-5), collection child-config dependency (3-1).
- **Error & Abort Behaviour** — `update` abort intact + non-zero (4-6), partial outcomes +
  command exit status (4-7), copy-failed distinct (4-6), detection-time hard errors for
  type-conflicts/`--plugin`/traversal/symlink (1-4, 2-2, 3-5, 5-3). **Gap**: the *Hard errors*
  list also names **a not-agntc source** as a non-zero pre-flight failure — the plan instead
  exits `0` for a top-level not-agntc source (finding #1).

### Direction 2: Plan → Specification (fidelity)

All plan content traces back to the spec; no hallucinated content found. The one fidelity issue
is the inverse of the completeness gap above: the plan's `ExitSignal(0)` for a not-agntc source
(tasks 2-1, 2-3, Phase 2 acceptance) traces to **existing v1 code behaviour**, not to the spec —
and the spec deliberately *changed* that behaviour (adding not-agntc to the loud non-zero
pre-flight-failure list). Preserving the old exit-0 behaviour is therefore a fidelity miss, not a
faithful preservation of behaviour the spec left untouched.

## Findings

### 1. Top-level not-agntc source exits `0`; spec mandates a loud non-zero pre-flight failure

**Type**: Incomplete coverage (fidelity gap — plan preserves legacy behaviour the spec changed)
**Spec Reference**: *Error & Abort Behaviour → Hard errors (detection-time, before any write)*: "Type-vs-structure conflicts, `--plugin` on a non-bundleable structure, **a not-agntc source**, and a path-traversal/symlink-escape violation are **pre-flight failures**: nothing is written, the command exits **non-zero**, and the message names the offending source/unit and what conflicted. These fire before any clone content is copied." (Reinforced by the section preamble: "The governing posture's 'loud' paths are the spec's **primary behavioural contract**.")
**Plan Reference**: Phase 2 **Acceptance** ("not-agntc still exits cleanly"); task configless-install-2-1 (Solution/Outcome/Do/Acceptance/Tests/Edge Cases — `ExitSignal(0)` for not-agntc); task configless-install-2-3 (Outcome/Acceptance/Edge Cases — subpath not-agntc "exits cleanly (code 0)").
**Change Type**: update-task (2-1 and 2-3) + update-phase acceptance (Phase 2)

**Details**:
The spec's *Error & Abort Behaviour* section is explicit and is framed as the feature's primary
behavioural contract: a **not-agntc source** is one of four "loud" pre-flight failures that must
exit **non-zero** with a message naming the offending source. The existing v1 code exits `0` for
not-agntc (`src/commands/add.ts` ~195/206 — `p.cancel(...)` + `throw new ExitSignal(0)`), and the
plan carries that legacy exit-0 behaviour forward verbatim (task 2-1: "A not-agntc source still
exits cleanly (code 0)"; task 2-3: subpath not-agntc "exits cleanly (code 0)"; Phase 2 acceptance:
"not-agntc still exits cleanly").

Under configless this exit code is load-bearing, not cosmetic: configless removes the
`agntc.json`-presence trust gate, so feeding `agntc add` an arbitrary repo that resolves to
not-agntc is now a common, scriptable user error. The spec deliberately promotes not-agntc from a
silent no-op to a loud failure precisely because it now sits alongside the other configless
pre-flight rejections (type conflict, `--plugin` abuse, traversal/symlink escape) — all of which
the plan *does* exit non-zero. Leaving not-agntc at exit 0 is internally inconsistent with those
sibling rejections and breaks scripts/CI that rely on a non-zero exit to detect "this source
installed nothing."

Scope of the fix is the **top-level / whole-repo (and selector-subpath) not-agntc source** reached
in `runAdd`'s standalone branch. It does **not** change the **collection-member** case: a member
that *re-detects* not-agntc is correctly a loud per-member **skip** (warned, siblings continue,
no entry) under *Partial outcomes for collections* — task 3-4 already handles that and must stay
as-is. (The all-collection command exit status — non-zero if any unit hard-errored or aborted — is
task 4-7's concern and is unaffected; a per-member skip is not itself a command-level hard error.)

The fix: where the standalone path currently `throw new ExitSignal(0)` for a not-agntc `detected.type`,
it must instead emit a message naming the source (`parsed.manifestKey` / `owner/repo[/subpath]`) and
that it is not an installable agntc source, then `throw new ExitSignal(1)`. This mirrors the
identity-prefixed `p.cancel` + `ExitSignal(1)` shape task 2-2 already established for
`TypeConflictError`. The existing `p.cancel("Not an agntc source — …")` message at the old
`config === null` gate (~192) is the natural message to retain, prefixed with the source identity.

**Current** (task configless-install-2-1):

> **Outcome**: `agntc add referodesign/refero_skill` (bare `SKILL.md`, no `agntc.json`, untagged) installs the skill standalone under its repo-basename folder/manifest key with agents chosen from the `KNOWN_AGENTS` default; a configless multi-asset plugin installs standalone the same way. A configless source whose structure is a collection still dispatches to `runCollectionPipeline`. A not-agntc source still exits cleanly (code 0). Config-bearing standalone installs (e.g. `agentic-workflows`, declared `agents:[claude]`) behave exactly as before. The `config === null` → "must be a collection" gate, the second standalone `detectType` call, and the dead `ConfigError` catch are gone.

(and, in the same task's **Do**:)

> - `detected.type === "not-agntc"` → `throw new ExitSignal(0)` (clean exit; the existing standalone `not-agntc` handling at lines ~205–207 already does this — keep that behaviour, now reachable for configless sources too).

(and acceptance criterion:)

> - [ ] A `not-agntc` source (config-bearing or configless) exits with `ExitSignal(0)` and writes no manifest entry.

(and two tests:)

> - `"a configless not-agntc source exits 0 without installing"` — null config, `mockDetectType` → `{ type: "not-agntc" }`; assert `ExitSignal` code 0, no `addEntry`, no copy.
> - `"a config-bearing not-agntc source exits 0"` — config present, `detectType` → `not-agntc`; assert exit 0 (preserves existing standalone not-agntc handling).

(and edge case:)

> - `not-agntc` (either config state) → clean exit 0, no write.

**Proposed** (task configless-install-2-1):

> **Outcome**: `agntc add referodesign/refero_skill` (bare `SKILL.md`, no `agntc.json`, untagged) installs the skill standalone under its repo-basename folder/manifest key with agents chosen from the `KNOWN_AGENTS` default; a configless multi-asset plugin installs standalone the same way. A configless source whose structure is a collection still dispatches to `runCollectionPipeline`. A not-agntc source fails pre-flight: a `p.cancel` message names the source (`owner/repo[/subpath]`) and that it is not an installable agntc source, nothing is written, and the command exits **non-zero** (`ExitSignal(1)`) — the spec's loud pre-flight contract for a not-agntc source. Config-bearing standalone installs (e.g. `agentic-workflows`, declared `agents:[claude]`) behave exactly as before. The `config === null` → "must be a collection" gate, the second standalone `detectType` call, and the dead `ConfigError` catch are gone.

(and, in the same task's **Do**:)

> - `detected.type === "not-agntc"` → emit a source-named `p.cancel` and `throw new ExitSignal(1)` (a **loud non-zero pre-flight failure**, per spec *Error & Abort Behaviour → Hard errors*, which lists "a not-agntc source" alongside type-conflict/`--plugin`/traversal failures as exiting non-zero with a named message). Build the message by prepending the source identity (`parsed.manifestKey` / `owner/repo[/subpath]`) to the existing "Not an agntc source — …" text, e.g. `` `${parsed.manifestKey}: not an agntc source — no installable skill, plugin, or collection found` ``. This **replaces** the legacy `ExitSignal(0)` clean-exit behaviour at the old lines ~205–207 — the spec deliberately reclassifies not-agntc from a silent no-op to a loud failure now that configless removes the `agntc.json` trust gate. Mirror the identity-prefixed `p.cancel` + `ExitSignal(1)` shape task 2-2 uses for `TypeConflictError`. (The collection-**member** not-agntc *skip* — warned, siblings continue — is unchanged and owned by task 3-4; this change is the top-level/standalone source only.)

(and acceptance criterion:)

> - [ ] A `not-agntc` source (config-bearing or configless) fails pre-flight: a source-named `p.cancel` is emitted, no manifest entry is written, no copy runs, and the command exits **non-zero** (`ExitSignal(1)`).

(and two tests:)

> - `"a configless not-agntc source exits non-zero with a named message"` — null config, `mockDetectType` → `{ type: "not-agntc" }`; assert `ExitSignal` code 1, `p.cancel` called with a message containing the source identity (`owner/repo`) and "not an agntc source", and no `addEntry`/no copy.
> - `"a config-bearing not-agntc source exits non-zero"` — config present, `detectType` → `not-agntc`; assert `ExitSignal(1)` and the named `p.cancel` (the spec's loud pre-flight contract; replaces the legacy exit-0 behaviour).

(and edge case:)

> - `not-agntc` (either config state) → loud pre-flight failure: source-named `p.cancel`, no write, **non-zero** exit (`ExitSignal(1)`).

**Current** (task configless-install-2-3 — Outcome / Acceptance / Edge Cases):

> **Outcome**: … `--plugin` on a skills-only subpath bundles that subpath unit; on a not-bundleable subpath it hard-errors (task 2-2 semantics). A subpath that resolves to `not-agntc` exits cleanly (code 0).

> - [ ] A subpath unit that resolves to `not-agntc` exits cleanly with `ExitSignal(0)` and writes nothing.

> - `"a subpath unit that is not-agntc exits cleanly"` — subpath `detectType` → `not-agntc`; assert `ExitSignal(0)`, no `addEntry`.

> (Edge Cases) - Subpath unit = `not-agntc` → clean exit 0.

**Proposed** (task configless-install-2-3 — Outcome / Acceptance / Edge Cases):

> **Outcome**: … `--plugin` on a skills-only subpath bundles that subpath unit; on a not-bundleable subpath it hard-errors (task 2-2 semantics). A subpath that resolves to `not-agntc` fails pre-flight with a source-named `p.cancel` and exits **non-zero** (`ExitSignal(1)`), per the shared standalone not-agntc handling established in task 2-1.

> - [ ] A subpath unit that resolves to `not-agntc` fails pre-flight: a `p.cancel` naming the source (`owner/repo/<subpath>`) is emitted, the command exits **non-zero** (`ExitSignal(1)`), and nothing is written. (Shared with the standalone not-agntc path from task 2-1.)

> - `"a subpath unit that is not-agntc exits non-zero with a named message"` — subpath `detectType` → `not-agntc`; assert `ExitSignal(1)`, a source-named `p.cancel` (key `owner/repo/<subpath>`), and no `addEntry`.

> (Edge Cases) - Subpath unit = `not-agntc` → loud pre-flight failure: source-named `p.cancel`, non-zero exit (`ExitSignal(1)`), no write.

**Current** (Phase 2 **Acceptance**, planning.md):

> - [ ] The `add` path no longer treats null config as "must be a collection" — a configless bare skill or configless multi-asset plugin installs standalone; not-agntc still exits cleanly.

**Proposed** (Phase 2 **Acceptance**, planning.md):

> - [ ] The `add` path no longer treats null config as "must be a collection" — a configless bare skill or configless multi-asset plugin installs standalone; a not-agntc source fails pre-flight loudly (source-named `p.cancel`, non-zero exit), per the spec's *Error & Abort Behaviour → Hard errors* contract.

**Resolution**: Fixed
**Notes**: Verified against spec line 454 (Error & Abort Behaviour → Hard errors) — "a not-agntc source" is explicitly listed among the loud non-zero pre-flight failures. Applied all edits to phase-2-tasks.md task 2-1 (Outcome, Do bullet, Acceptance, two Tests, Edge Case), task 2-3 (Outcome, Acceptance, Test, Edge Case), and the Phase 2 acceptance bullet in planning.md. Synced mirroring tick tasks tick-e6e0d2 (2-1) and tick-f8f897 (2-3). Scope is top-level/standalone (incl. subpath) not-agntc only; the collection-member not-agntc re-detect skip (task 3-4) is unchanged.

---
