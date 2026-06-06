---
status: in-progress
created: 2026-06-06
cycle: 1
phase: Traceability Review
topic: Configless Install
---

# Review Tracking: Configless Install - Traceability

## Summary

Traceability analysis of the configless-install plan (planning.md + phase-1..5-tasks.md)
against the validated specification, both directions.

- **Direction 1 (Spec → Plan, completeness)**: Every spec section has plan coverage with
  adequate depth. Config Model, Structural Type Detection (four shapes, single path,
  canonical plugin rule, `--plugin` scope, skills-only resolution, type-vs-structure
  conflict, selector grammar), Identity & Naming (dir-basename, recursive keep-everything
  copy, no frontmatter parsing), Manifest Keying & Lifecycle (type field + optionality,
  replay, derive-before-delete predicates, abort, legacy backfill on read, keying),
  Agent Selection (KNOWN_AGENTS default, ceiling, auto-select scoping, three unified
  no-constraint cases), Collection Membership (structural one-level, per-child agents,
  select-all/selector UX, nested unsupported), Version Pinning (reuse tagless→HEAD, no
  new code — correctly carried as "unchanged" in P4 acceptance), Copy-Safety Hardening
  (path-traversal + symlink guards, clone-root boundary, broken-link lexical handling,
  pre-flight timing, add + update coverage, agntc.json deletion unchanged), Backward-Compat
  (init unchanged, config schema, stray root config, collection pipeline dependency),
  and Error & Abort Behaviour (hard errors, update abort, partial outcomes, copy-failed
  distinction) are all represented.

- **Direction 2 (Plan → Spec, fidelity)**: Plan content traces back to the spec. The
  `--plugin > config type` precedence "moot" framing, the EACCES/IO-propagation and
  cancel/zero-selection `[]` preservations, and the per-task scope boundaries are all
  either spec-grounded or faithful preservation of existing behaviour the spec leaves
  untouched.

One finding: the plan's `readConfig` leniency rule (task 1-1) drops a recognised
`type: "plugin"` declaration whenever `agents` is absent/empty, which defeats the spec's
primary stated use for `type` (a configless skills-only bundle, which by nature carries
no agent restriction).

## Findings

### 1. `type: "plugin"`-only config (no `agents`) is dropped, defeating the spec's primary use of `type`

**Type**: Incomplete coverage (fidelity gap)
**Spec Reference**: *Config Model → Config shape* (`agents` is **optional**; `type` "Reserved strictly for a pure skills-only repo the author wants bundled as a plugin"); *Config Model → Recognised `type` values and the leniency-vs-error boundary* ("missing/empty `agents` is treated as 'no usable config'" vs. "The error path fires only after the config parses successfully and yields a recognised `type`"); *Structural Type Detection → Skills-only resolution* ("Author override → config `type: plugin` bundles it (even a single skill)").
**Plan Reference**: Phase 1, task configless-install-1-1 (Lenient config reading with optional type) — the `Do` rules, the `{type:"plugin"}`-with-no-`agents` edge case, and the acceptance criteria that collapse "object with no `agents`" / "empty `agents` array" to `null`.
**Change Type**: update-task

**Details**:
Task 1-1 specifies that `readConfig` returns `null` ("no usable config") for *any* config
lacking a usable non-empty `agents` array — explicitly including a `{ "type": "plugin" }`
config with no `agents` (the task's own edge case: "`{type:"plugin"}` with no `agents` →
`null` … the `type` is irrelevant without a unit to install"). Because `runAdd`/detection
read the disambiguator via `configType: config?.type` (Phase 2 task 2-1, Phase 3 task 3-5),
a `null` config yields `configType: undefined`, so the `type` never reaches detection.

This contradicts the spec's stated purpose for `type`. The spec config shape makes `agents`
**optional** and reserves `type: "plugin"` precisely for "a pure skills-only repo the author
**wants bundled as a plugin**." A configless skills-only repo that the author wants bundled
*for any agent* is the natural case for a config that carries **only** `type: "plugin"`
(no agent restriction) — yet under the plan that exact file is read as `null`, the bundle
intent is silently lost, and the repo defaults to a collection menu. The spec also locates
the realizability handling on `type` "after the config parses successfully and yields a
recognised `type`," which a `type`-only config does; the plan instead discards the parsed
`type` before that point.

The spec is internally tense here (the leniency clause names "missing/empty `agents` →
no usable config" while the shape marks `agents` optional and `type` independently meaningful).
The plan resolved that tension by letting the `agents`-leniency rule swallow a valid `type`,
which is the resolution that defeats a spec-promised capability. The fidelity-preserving
resolution is: a config is "usable" if it yields *either* a usable `agents` list *or* a
recognised `type` — a `type`-only config is usable (its `agents` simply defaults to the
no-restriction / `KNOWN_AGENTS` path). `agents`-only and `type`-only and both-present all
parse; only a config with neither a usable `agents` nor a recognised `type` (and malformed/
missing files) collapses to `null`.

This keeps every other leniency outcome the task already specifies unchanged (missing file,
malformed JSON, all-unknown `agents` with no `type`, unknown keys), and keeps recognition of
`"plugin"` vs. unrecognised values in detection (task 1-4) — `readConfig` still passes `type`
through raw; it just must not throw away a `type`-only config.

**Current**:
```markdown
**Solution**: Rewrite `readConfig` so the *only* outcomes are (a) a usable `AgntcConfig` (`{ agents, type? }`) or (b) `null` ("no usable config"). Missing file, malformed JSON, missing/empty/non-array `agents`, and an all-unknown `agents` list all collapse to `null` (the empty-after-filtering case stays as the spec's "no valid constraint" condition — see note below). Non-permission/non-ENOENT IO errors still propagate. Read the optional `type` property; pass its raw value through untouched (recognition/validation belongs to detection in task 1-4, not here). Unknown keys are ignored.

**Outcome**: `readConfig` never throws a `ConfigError`. A bare-`SKILL.md` repo with no `agntc.json` (the `refero_skill` shape) yields `null`. A config of `{agents:[claude]}` yields `{agents:["claude"]}`. A config of `{agents:["claude"], type:"plugin"}` yields `{agents:["claude"], type:"plugin"}`. Malformed JSON yields `null` (with a warning), not a throw.

**Do**:
- In `src/config.ts`, extend the `AgntcConfig` interface to `{ agents: AgentId[]; type?: string }`. Keep `type` as a raw `string` (or `string | undefined`) — do **not** narrow to a union here; recognition of `"plugin"` vs. unrecognised values is detection's job (task 1-4). This keeps `readConfig` purely lenient.
- Change the `JSON.parse` failure branch (currently `throw new ConfigError(...)`) to call `options?.onWarn?.(...)` with a message like `Ignoring malformed agntc.json: <detail>` and `return null`.
- Change the "not an object / no `agents`" branch (currently throws "agents field is required") to `return null` (optionally warn). A config object that exists but has no usable `agents` is "no usable config."
- Change the "`agents` not an array or empty" branch (currently throws "agents must not be empty") to `return null`.
- Keep the existing unknown-agent filtering loop (warn per unknown agent, keep known ones). After filtering, if the resulting `agents` array is **empty** (all entries were unknown), `return null` — an all-unknown declaration carries no usable author intent, identical to no config (spec: *Agent Selection → "No valid constraint" — unified across three cases*, and the all-unknown case reduces to the empty case). Update the existing test `"returns empty known agents when all unknown"` accordingly (it must now expect `null`).
- Read `type` from the parsed object when present and a string; attach it to the returned config as-is. Ignore any other (unknown) keys silently.
- Keep the ENOENT branch returning `null`. Keep the non-ENOENT IO error (e.g. `EACCES`) re-throwing the raw error unchanged (it must **not** be wrapped or swallowed — a real filesystem failure is not "no usable config").
- The `ConfigError` class may become unused; remove its export only if no other module imports it (grep first — it is imported in `src/commands/add.ts`). If still imported, leave the class defined but stop throwing it from `readConfig`; note in task wiring that add.ts's `ConfigError` catch becomes dead in Phase 2. To keep the build green in Phase 1, leave the `ConfigError` class exported.

**Acceptance Criteria**:
- [ ] `readConfig` returns `null` (never throws `ConfigError`) for: missing file (ENOENT), malformed JSON, non-object JSON, object with no `agents`, `agents` not an array, empty `agents` array, and `agents` containing only unknown agents.
- [ ] `readConfig` returns `{ agents: [...known], type?: <raw> }` for a config with at least one known agent; unknown agents are filtered with a per-agent warning; the optional `type` value is passed through verbatim.
- [ ] Unknown/extra top-level keys are ignored (do not appear on the returned object, do not cause warnings).
- [ ] A non-ENOENT, non-parse IO error (e.g. `EACCES`) propagates unchanged and is **not** an instance of `ConfigError`.
- [ ] Existing config-bearing behaviour is preserved: `{agents:["claude"]}` still yields `{agents:["claude"]}` (the `agentic-workflows` Claude-only case).
```

**Proposed**:
```markdown
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
```

Additionally, the task's **Tests**, **Edge Cases**, and **Context** for task 1-1 must be updated to match:

- In **Tests**, replace the line
  `- "returns null when agents is an empty array" (rewrite of throws when agents is empty array)`
  with `- "returns null when agents is an empty array and no type is present"` and add
  `- "retains a type-only config with empty agents (configless skills-only bundle)" — {type:"plugin"} → {agents:[], type:"plugin"} (the bundle intent survives; not null)`.
  Likewise qualify `"returns null when agents field is missing"` and `"returns null when all agents are unknown"` to `"... and no type is present"`, and add a companion
  `- "retains a type-bearing config even when agents is missing/empty/all-unknown" — asserts {agents:[], type:"plugin"} is returned in each such case`.

- In **Edge Cases**, replace
  `- {type:"plugin"} with no agents → null (no usable agents ⇒ no usable config; ...)`
  with
  `- {type:"plugin"} with no agents → {agents:[], type:"plugin"} (usable: the type disambiguator is the spec's reserved configless-bundle case; empty agents resolves to the KNOWN_AGENTS default downstream).`
  and add
  `- {} / {agents:[]} / all-unknown agents, no type → null (neither usable agents nor a type).`

- In **Context**, the closing note "an authorless `type`-only file is not a usable config" must be removed/inverted to state that a `type`-only config **is** usable per *Config Model → Config shape* (`agents` optional) and *Structural Type Detection → Skills-only resolution* ("config `type: plugin` bundles it, even a single skill"), since `type` is reserved for exactly the configless skills-only bundle.

**Resolution**: Fixed
**Notes**: Applied verbatim to phase-1-tasks.md (Solution/Outcome/Do/Acceptance/Tests/Edge Cases/Context) and the tick task tick-7f9ea4. Beneficial cascade: with a `type`-only config now retained, task 3-5's stray-root `type:"plugin"` on a member-dirs collection correctly forwards `configType:"plugin"` to detection and fires the `TypeConflictError` — which the prior (null-dropping) behaviour would have silently swallowed.

---
