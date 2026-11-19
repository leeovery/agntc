---
phase: 4
phase_name: Safe-vs-major bump gating messaging
total: 3
---

## update-output-overhaul-4-1 | approved

### Task 4.1: Reword the out-of-constraint footer to the actionable, caret-mode re-add directive naming the post-bump current version

**Problem**: After Phase 2 (Task 2.7) the out-of-constraint footer collapses to one line per group but still carries today's **passive** wording — `  <label>  <latestOverall> available (constraint: <constraint>)` under the `Newer versions outside constraints:` header. The spec's *Safe-vs-Major Bump Gating → Blocking message* requires this to become an **actionable, mode-matched** directive: name the *current* version (the version this run actually landed on) vs the newer one, and give the exact re-add command. It must name the **post-bump** current version — captured before a same-run safe bump would report a stale `entry.ref` (e.g. `current v1.2.3 → v2.0.0` while the line right above says `Updated v1.2.3 → v1.3.0`), contradicting the inline outcome. `OutOfConstraintInfo` carries no current version today (`summary.ts:288-292`), so the applied version must be threaded in.

**Solution**: In one vertical slice, extend `OutOfConstraintInfo` with the post-bump `current` version and a bare `repo` (for the command), reword `renderOutOfConstraintSection` to the actionable current→newer line with the bare `npx agntc add <repo>` re-add directive, and thread the post-bump current + repo in at **both** call sites — single-key `extractOutOfConstraint` and the all-mode per-group footer build. No gating/resolver change: caret semantics already gate majors and 0.x-minors correctly (spec *Audit*); this is pure messaging over an already-correct footer that is **caret-only by construction**.

**Outcome**: The footer renders one informative (non-error, exit-0) line per group — `  <label>  <current> -> <latestOverall> available. To upgrade: npx agntc add <repo>` — where `<current>` is the version this run landed on (the resolved best-within-constraint tag), `<label>` is the Group label prefix (Task 2.1, `@intent`-disambiguated for a multi-group repo, or the plain key on the single-key path), and `<repo>` is the bare `owner/repo` so the re-add re-resolves latest and re-establishes caret at the new major — consistent with the inline `Updated` line when a safe bump ran the same run.

**Do**:
- **Interface** — in `src/summary.ts`, extend `OutOfConstraintInfo` (`:288-292`, already carrying `key?`, `label?`, `latestOverall`, `constraint` after Task 2.7) with two required fields: `current: string` (the post-bump current version) and `repo: string` (the bare `owner/repo` for the re-add command). Leave `key?`/`label?`/`constraint` as Task 2.7 left them (`constraint` is retained but no longer rendered by the new wording).
- **Render** — rewrite `renderOutOfConstraintSection` (`:294-306`) to keep the exact `"Newer versions outside constraints:"` header, and emit per info the actionable line `` `  ${info.label ?? info.key}  ${info.current} -> ${info.latestOverall} available. To upgrade: npx agntc add ${info.repo}` ``. The prefix `info.label ?? info.key` is unchanged from Task 2.7 (all-mode sets `label`, single-key sets `key`); the ` -> ` arrow matches the module's existing convention (`renderGitUpdateSummary`/`renderUpdateOutcomeSummary`). Drop the `(constraint: <constraint>)` tail. The `npx agntc add <repo>` form is the naming cross-cutting spec's canonical command; `<repo>` is the **bare** `owner/repo`, never the `@intent` label.
- **Single-key call site** — in `extractOutOfConstraint` (`src/commands/update.ts:106-122`): the gate is unchanged (`hasOutOfConstraintVersion(checkResult) && entry.constraint !== undefined`), which narrows `checkResult` to a constrained-with-latest result — so this footer is caret-only by construction and the command is always the bare add. Source the post-bump `current` from the check result: `constrained-update-available` → `checkResult.tag` (the landed tag this run applies); `constrained-up-to-date` → `entry.ref` (already at best-within-constraint, so pre and post coincide). Set `repo = key.split("/").slice(0, 2).join("/")` (the bare `owner/repo`, stripping any `/<member>` segment). Keep populating `latestOverall: checkResult.latestOverall` and `constraint: entry.constraint`.
- **All-mode call site** — in the Task 2.7 per-group footer build inside `runAllUpdates` (which replaced the old per-member collection at former `update.ts:457-468`): for each constrained group whose resolved `GroupTarget` is `{ kind: "constrained", tag, commit, latestOverall }` with `latestOverall !== null`, add `current: target.tag` (the group's resolved best-within-constraint tag — the post-bump current for every member: updating members land on it, up-to-date members are already at it) and `repo: repoOf(group)` (Task 2.1's `repoOf`, the bare `owner/repo`) to the pushed info, alongside the existing `label: groupLabel(group, groups)`, `latestOverall: target.latestOverall`, `constraint: group.versionIntent!`. Still one info per group (collection collapse preserved from Task 2.7).
- **Do NOT** add error styling, change the exit code, feed `hasFailedOutcome`, or introduce any `@<newest>` / exact-pin command here — that surface is the separate `newer-tags` line (Task 4.2). This footer is caret-only.

**Acceptance Criteria**:
- [ ] `renderOutOfConstraintSection` emits `Newer versions outside constraints:` then one line per info of the form `  <label|key>  <current> -> <latestOverall> available. To upgrade: npx agntc add <repo>` — no `(constraint: …)` tail, no error glyph.
- [ ] The re-add command is the **bare** `npx agntc add <repo>` (`owner/repo`), even when the line prefix is an `@intent`-disambiguated Group label for a multi-group repo.
- [ ] Single-key, `constrained-update-available`: `current` is the landed `checkResult.tag` (post-bump), not the pre-bump `entry.ref` — matching the inline `Updated … -> <tag>` line for the same run.
- [ ] Single-key, `constrained-up-to-date`: `current` is `entry.ref` (no safe bump this run; pre and post coincide).
- [ ] All-mode: `current` is the group's resolved `target.tag`; a constrained N-member collection still renders exactly one footer line (Task 2.7 collapse intact).
- [ ] 0.x-minor gate: an entry on `^0.3.3` with `0.4.0` out of constraint renders `… 0.3.x -> 0.4.0 available. To upgrade: npx agntc add owner/repo` — same path as a major, no special-casing.
- [ ] The footer keeps the informative tone (no `!`, no `warning`/`Warning`/`WARNING`) and the run exit stays 0 (it does not feed `hasFailedOutcome`).

**Tests**:
- Unit, `tests/summary-out-of-constraint.test.ts` (rewrite the passive-wording assertions to the actionable format):
  - `"renders the actionable '<current> -> <latestOverall> available' line with the bare re-add command"`
  - `"uses the Group label as the prefix but the bare owner/repo in the command for a multi-group repo"`
  - `"falls back to key as the prefix when no label is set (single-key path)"`
  - `"keeps the informative tone — no '!' or warning language and preserves the header"`
  - `"still emits one line per info (collection collapse preserved)"`
- Integration, `tests/commands/update.test.ts` (single-key arranges mock `checkForUpdate`; all-mode arranges mock the `resolveGroupTarget` group seam, per the Phase 1 Task 1.5 migration — update the existing out-of-constraint section's `msg.includes("^1.0")` assertions to the new current→newer + command wording):
  - `"single-key names the post-bump landed tag as current (v1.3.0 -> v2.0.0), consistent with the inline Updated line"`
  - `"single-key constrained-up-to-date names entry.ref as current (pre/post coincide)"`
  - `"all-mode footer names the group target tag as current and the bare 'npx agntc add owner/repo' command"`
  - `"a ^0.3.3 entry with 0.4.0 out of constraint renders the same actionable line (0.x-minor gate)"`
  - `"a multi-group repo renders two @intent-prefixed footer lines, each with the bare owner/repo command"`
  - `"the out-of-constraint footer keeps the all-mode (and single-key) exit at 0"`

**Edge Cases**:
- Same-run safe bump → footer names the landed version (matches the inline `Updated` line, not the stale pre-bump `entry.ref`).
- No safe bump this run (`constrained-up-to-date`) → pre/post current coincide (`entry.ref`).
- 0.x-minor gate (`^0.3.3` → `0.4.0`) rides the same out-of-constraint path as a major, same wording.
- Single-key key-only path → prefix falls back to `key`; command still the bare `owner/repo` (member segment stripped).
- Multi-group repo → prefix is the `@intent`-disambiguated Group label; command stays the bare `owner/repo`.
- Extreme-edge note (not special-cased): a single-key `constrained-update-available` that hits the never-downgrade guard (`isAtOrAboveVersion(entry.ref, result.tag)`, `update.ts:168`) names `result.tag` as current per this task's sourcing rule, even though no bump applies — this only arises when the installed `entry.ref` is a tag above the constraint-resolved best (locally-ahead / deleted remote tag), a pathological case; follow the ruled sourcing (`result.tag`) rather than inventing a branch.
- Exit stays 0; no error styling; no `@<newest>` command (that is the `newer-tags` surface, Task 4.2).

**Context**:
> *Safe-vs-Major Bump Gating → Blocking message* (spec): "Upgrade the out-of-constraint message from passive to actionable. Today: `Newer versions outside constraints: key 2.0.0 available (constraint: ^1.2.3)`. Target: name the current version vs the newer one *and* give the exact re-add command to cross the boundary." "**Constrained / caret user** → suggest **bare `npx agntc add owner/repo`**. A bare add re-resolves the latest semver tag and stores the default `^major.minor.patch` constraint, so it jumps to the newest major *and* re-establishes caret tracking … the prose names the target version, the command stays trivial." "**Names the *post-bump* current version.** The out-of-constraint info is captured at check time … *before* a same-run safe bump is applied. Naming the pre-bump `entry.ref` would report a stale current … **Decision:** the footer names the version this run actually landed on (`v1.3.0 → v2.0.0`), consistent with the inline outcome. This requires the footer's current-version reference to come from the post-bump entry … so the applied version must be threaded in; that plumbing is mechanics. When no safe bump happened this run, pre and post coincide." "**Tone: informative opt-in, not an error** … No error styling; **exit stays 0**; it does not feed `hasFailedOutcome`." *Audit*: "The *gating behaviour* already exists, entirely via semver caret semantics — **no resolver/gating work is needed**." *0.x-line + exact-pin edge cases*: "**0.x-minor** confirmed gated by caret … it rides the same out-of-constraint path as a major, with the same actionable message."
>
> The footer is **caret-only by construction**: `extractOutOfConstraint` gates on `hasOutOfConstraintVersion(checkResult) && entry.constraint !== undefined`, and `hasOutOfConstraintVersion` (`update-check.ts:26-33`) only holds for `constrained-update-available` / `constrained-up-to-date` — so the re-add command is always the bare `npx agntc add owner/repo`; no runtime mode discriminator is needed. Post-bump current sourcing (mechanics): single-key from the check result (`constrained-update-available` → `checkResult.tag`; `constrained-up-to-date` → `entry.ref`); all-mode from the group's `GroupTarget.constrained.tag` (Phase 1 Task 1.3). This task rewords WITHIN Task 2.7's per-group structure and `label?` field — it does not rebuild the collapse. Command form (`npx agntc add owner/repo`) is fixed by the naming cross-cutting spec (`.workflows/naming-and-identity/specification/naming-and-identity/specification.md`, *Touchpoints*).

**Spec Reference**: `.workflows/update-output-overhaul/specification/update-output-overhaul/specification.md` — *Safe-vs-Major Bump Gating → Audit*, *Blocking message*, *0.x-line + exact-pin edge cases*, *Testing & Acceptance* (acceptance 8). Command form: `.workflows/naming-and-identity/specification/naming-and-identity/specification.md` — *Touchpoints*.

## update-output-overhaul-4-2 | approved

### Task 4.2: Regression-lock the exact-pin newer-tags re-add command across all-mode and single-key

**Problem**: The exact-pin `newer-tags` re-add command is already built — the single-key path prints `To upgrade: npx agntc add <key>@<newest>` (`update.ts:151`, pre-existing) and Phase 2 Task 2.5 added the **repo-level** `npx agntc add owner/repo@<newest>` to the collapsed all-mode `newer-tags` line (acceptance-9 consistency fix). Phase 4 must **verify and regression-lock** this — no behaviour change — so the two properties the spec ratifies are pinned by explicit tests: an exact-pin collection collapses to *one* repo-level `@newest` line, the single-key path stays member/key-scoped, and a caret user is **never** routed onto the `@newest` surface (they surface via the caret footer from Task 4.1 instead).

**Solution**: Author regression tests only (no source change). Assert the all-mode collapsed `newer-tags` line for an exact-pin collection is exactly one line carrying `npx agntc add owner/repo@<newest>`; assert the single-key `newer-tags` outro stays `npx agntc add <key>@<newest>` for both a standalone and a collection-member key; and assert a constrained (caret) entry with an out-of-constraint newer major never emits a `@<newest>` newer-tags line (it emits the bare-add caret footer from Task 4.1). If any assertion cannot be satisfied by the code as built by Phases 2 and 4.1, that is a genuine regression to flag, not a wording change to make here.

**Outcome**: Named, durable tests lock the exact-pin re-add wording at both granularities (repo-level for all-mode, key-scoped for single-key) and prove the caret/exact-pin surfaces stay disjoint, so a later refactor cannot silently drift them.

**Do**:
- **No source edits.** This is a test-authoring/regression task over behaviour already shipped in Phase 2 (Task 2.5) and Phase 4 (Task 4.1).
- **All-mode exact-pin collapse** — in `tests/commands/update.test.ts`, arrange an exact-pin collection (multiple members sharing one unconstrained tag `ref`, e.g. `owner/repo/a` and `owner/repo/b` both at `v1.0`, `constraint` undefined) whose group resolves to a `newer-tags` `GroupTarget` (mock `resolveGroupTarget` per the Phase 1 seam) with newer tags `[…, v3.0]`. Assert exactly **one** trailing line for the group and that it contains `npx agntc add owner/repo@v3.0` (the repo-level command from Task 2.5's `formatNewerTagsLine`), not N per-member lines and not a member-scoped command.
- **Single-key key-scoped** — assert the pre-existing single-key behaviour stays green: a standalone `owner/repo` at exact-pin `v1.0` with `newer-tags` tags `["v2.0","v3.0"]` outros `To upgrade: npx agntc add owner/repo@v3.0` (existing test `update.test.ts:2235`), and a collection-member key `owner/repo/go` outros `To upgrade: npx agntc add owner/repo/go@v3.0` (existing test `:2279`) — the member/key-scoped command. Reference these rather than duplicating; add an explicit assertion if the member-scoped case is not already locked.
- **Caret user never routed to `@newest`** — arrange a constrained (caret) entry (`constraint: "^1.2.3"`, `ref: "v1.2.3"`) whose remote has an out-of-constraint major (`latestOverall: "v2.0.0"`). Assert that **no** emitted line matches `@<newest>` newer-tags wording (`add owner/repo@v2.0.0` / "newer tags available"); assert instead the caret out-of-constraint footer from Task 4.1 (bare `npx agntc add owner/repo`, no `@` suffix) is emitted. This proves `newer-tags` (unconstrained exact-pin) and the caret footer (constrained) are disjoint surfaces — a constrained entry never produces a `newer-tags` status.
- Keep all-mode arranges on the `resolveGroupTarget`/`categorizeMember` group seam and single-key arranges on `checkForUpdate`, matching the established test split.

**Acceptance Criteria**:
- [ ] An exact-pin collection in all-mode renders exactly one collapsed `newer-tags` line for the group, containing the repo-level `npx agntc add owner/repo@<newest>` (not N lines, not a member-scoped command).
- [ ] The single-key standalone path outros `npx agntc add owner/repo@<newest>` and the single-key collection-member path outros `npx agntc add owner/repo/<member>@<newest>` (member/key-scoped, unchanged).
- [ ] A caret/constrained entry with an out-of-constraint newer major emits **no** `@<newest>` newer-tags line; it emits the bare `npx agntc add owner/repo` caret footer (Task 4.1) instead.
- [ ] No source file is modified by this task (verification only); all assertions pass against the code as built by Phases 2 and 4.1.

**Tests** (`tests/commands/update.test.ts`; reuse the existing `newer-tags` and out-of-constraint describe blocks):
- `"all-mode collapses an exact-pin collection to one repo-level 'npx agntc add owner/repo@<newest>' newer-tags line"`
- `"single-key exact-pin standalone outros 'npx agntc add owner/repo@<newest>'"` (lock/extend existing `:2235`)
- `"single-key exact-pin collection member outros 'npx agntc add owner/repo/<member>@<newest>'"` (lock/extend existing `:2279`)
- `"a caret entry with an out-of-constraint major is never routed to a '@<newest>' newer-tags line"`
- `"a caret entry with an out-of-constraint major emits the bare 'npx agntc add owner/repo' footer instead"`

**Edge Cases**:
- Exact-pin collection collapses to one repo-level `@newest` line (per-group, not per-member).
- Single-key stays key/member-scoped `@newest` (standalone and `/member` key).
- Caret user never routed to `@newest` — constrained entries take the `constrained-*` path and surface via the caret footer, never `newer-tags`.

**Context**:
> *Safe-vs-Major Bump Gating → 0.x-line + exact-pin edge cases* (spec): "**Consistency fix:** the all-mode `newer-tags` line (`update.ts:541`) currently says 'newer tags available (latest: X)' but omits the `agntc add` command the single-key path includes. Align it so exact-pin messaging is consistent across single-key and all-mode." "**Command granularity for the collapsed line:** because the all-mode `newer-tags` line collapses to **one line per group** …, its command is **repo-level** — `npx agntc add owner/repo@<newest>` … The single-key path stays member/key-scoped (`npx agntc add <key>@<newest>`), since it targets one plugin." "**Exact-pin user** (`newer-tags`, no constraint) → keep suggesting a specific **`@<newest>`** tag … a bare re-add would silently switch them into caret tracking — a versioning-mode change they didn't ask for. Rule: **suggest the re-add that preserves how they pinned.**"
>
> This is a verification/regression task: the all-mode repo-level command landed in Phase 2 Task 2.5 (`formatNewerTagsLine`), the single-key command is pre-existing (`update.ts:151`), and the caret footer is Task 4.1. `newer-tags` only ever fires for an **unconstrained** exact-pin/branch entry — a constrained (caret) entry resolves to a `constrained-*` status and can only reach the out-of-constraint footer, never `newer-tags`; that disjointness is the "caret user never routed to `@newest`" guarantee. Command forms are fixed by the naming cross-cutting spec (`npx agntc add owner/repo`).

**Spec Reference**: `.workflows/update-output-overhaul/specification/update-output-overhaul/specification.md` — *Safe-vs-Major Bump Gating → 0.x-line + exact-pin edge cases*, *Blocking message (Re-add suggestion matches … mode)*, *Testing & Acceptance* (acceptance 9). Command form: `.workflows/naming-and-identity/specification/naming-and-identity/specification.md` — *Touchpoints*.

## update-output-overhaul-4-3 | approved

### Task 4.3: Lock the ratified exit-code posture explicitly for check-failed / constrained-no-match

**Problem**: The `check-failed` and `constrained-no-match` exit divergence between single-key (exit 1) and all-mode (warn, exit 0) is **intentional and already implemented** — the spec ratifies it and says to "keep it, and state it explicitly". Phase 1 (Task 1.8) fanned an all-mode group probe failure into N `check-failed` outcomes excluded from `hasFailedOutcome`; single-key exits 1 on both (`update.ts:139-142`, `160-165`); and only `aborted`/`blocked`/`failed`/`copy-failed` trip the non-zero all-mode exit (`hasFailedOutcome`, `:623-631`). Phase 4 must pin this posture with explicit, named regression tests so it cannot drift — no behaviour change.

**Solution**: Author regression tests only (no source change) asserting the full exit matrix: single-key `check-failed` → exit 1; single-key `constrained-no-match` → exit 1; all-mode `check-failed` → warn + exit 0; all-mode `constrained-no-match` → warn + exit 0; all-mode `aborted`/`blocked`/`failed`/`copy-failed` → exit 1. Where an existing test already covers a cell, reference/strengthen it; add the missing cells so every entry in the ratified matrix has a named lock.

**Outcome**: Every cell of the ratified exit matrix is covered by a named test — the mode-dependent divergence (single-key strict, all-mode partial-success) is durable against refactors, and the `hasFailedOutcome` membership (only `aborted`/`blocked`/`failed`/`copy-failed`) is pinned.

**Do**:
- **No source edits.** Verification/regression only; the posture is already implemented by Phase 1 and pre-existing single-key code.
- **Single-key `check-failed` → exit 1** — arrange single-key `runUpdate("owner/repo")` with `checkForUpdate` returning `{ status: "check-failed", reason }`; assert it throws `ExitSignal` code `1` and logs `Update check failed for owner/repo: <reason>` (lock existing `update.test.ts:779-796`).
- **Single-key `constrained-no-match` → exit 1** — arrange `checkForUpdate` returning `{ status: "constrained-no-match" }`; assert `ExitSignal` code `1` and the `No tags satisfy the constraint for owner/repo` error (lock existing `:3337-3355`).
- **All-mode `check-failed` → warn + exit 0** — arrange an all-mode run where one group's `resolveGroupTarget` returns `{ kind: "check-failed", reason }` (Phase 1 seam) and other groups succeed; assert the run resolves without throwing (exit 0), the failure is surfaced via `p.log.warn` (not `p.log.error`), and no manifest mutation occurs for that group. (Lock the Phase 1 Task 1.8 behaviour: `check-failed` excluded from `hasFailedOutcome`.)
- **All-mode `constrained-no-match` → warn + exit 0** — arrange a group resolving to `constrained-no-match`; assert exit 0, a `p.log.warn` line, and the entry left untouched (existing coverage near `:3459`/`:3520`; add an explicit exit-0 assertion if absent).
- **All-mode `aborted`/`blocked`/`failed`/`copy-failed` → exit 1** — assert each of the four trips `ExitSignal` code `1` via `hasFailedOutcome`, while the successful siblings still persist (partial-success): `aborted` (derive-before-delete, entry intact), `blocked` (symlink-escape, entry intact), `failed` (e.g. group clone failure fan-out, entries intact), `copy-failed` (entry removed). Reference existing locks where present (`aborted`/`blocked` around `:1600-1700`, copy-failed `:3836-3947`, clone-failure fan-out from Task 1.7) and add explicit named cells for any of the four not already exit-asserted.
- Keep all-mode arranges on the `resolveGroupTarget`/`categorizeMember` group seam; keep single-key arranges on `checkForUpdate`.

**Acceptance Criteria**:
- [ ] Single-key `check-failed` throws `ExitSignal(1)`.
- [ ] Single-key `constrained-no-match` throws `ExitSignal(1)`.
- [ ] All-mode `check-failed` (with succeeding siblings) resolves without throwing (exit 0), warns rather than errors, and mutates no manifest state for the failed group.
- [ ] All-mode `constrained-no-match` resolves without throwing (exit 0), warns, and leaves the entry untouched.
- [ ] All-mode `aborted`, `blocked`, `failed`, and `copy-failed` each throw `ExitSignal(1)`; successful siblings still persist (partial-success), and no other status trips the non-zero exit.
- [ ] No source file is modified by this task (verification only).

**Tests** (`tests/commands/update.test.ts`):
- `"single-key check-failed exits 1"` (lock `:779`)
- `"single-key constrained-no-match exits 1"` (lock `:3337`)
- `"all-mode check-failed warns and exits 0 (excluded from hasFailedOutcome), no manifest mutation"`
- `"all-mode constrained-no-match warns and exits 0, entry left untouched"`
- `"all-mode aborted exits 1 while the succeeded sibling persists"`
- `"all-mode blocked exits 1 while the succeeded sibling persists"`
- `"all-mode failed (clone-failure fan-out) exits 1, no entries removed"`
- `"all-mode copy-failed exits 1, its entry removed, siblings persist"`
- `"no non-actioned status (up-to-date / newer-tags / check-failed / constrained-no-match / skipped-no-agents) trips the all-mode non-zero exit"`

**Edge Cases**:
- Single-key strict: `check-failed` and `constrained-no-match` both exit 1 (the targeted action didn't happen).
- All-mode partial-success: `check-failed` and `constrained-no-match` warn and exit 0 (a batch isn't sunk by one dead remote / stuck constraint).
- Only `aborted`/`blocked`/`failed`/`copy-failed` trip the all-mode non-zero exit; `skipped-no-agents` and every non-actioned check category stay exit 0.
- Partial-success: siblings that succeeded still persist when another entry trips exit 1.

**Context**:
> *Safe-vs-Major Bump Gating → Exit-code posture — single-key vs all-mode (ratified, not changed)* (spec): "`check-failed` and `constrained-no-match` exit differently by mode today, and the divergence is **intentional — keep it, and state it explicitly**: **Single-key** `update <key>` exits `1` on both (`update.ts:139-142`, `160-165`): the one plugin you targeted couldn't be checked / has no matching tag → the requested action didn't happen. **All-mode** `update` warns and exits `0` (both excluded from `hasFailedOutcome`, `update.ts:623-630`): a batch shouldn't be sunk by one dead remote or one stuck constraint when everything else succeeded — partial-success, failure surfaced as a warning. Consistent with the existing posture where only `aborted`/`blocked`/`failed`/`copy-failed` trip the non-zero exit." *Failure isolation & lifecycle → Check/resolve failure (group-level)*: "all-mode `check-failed` warns and **exits 0** (it does not feed `hasFailedOutcome`)." `hasFailedOutcome` (`update.ts:623-631`) membership is exactly `aborted | blocked | failed | copy-failed`.
>
> This is a verification/regression task — the posture is already implemented (Phase 1 Task 1.8 for all-mode `check-failed`; pre-existing single-key exits; pre-existing `hasFailedOutcome`). It authors named locks for each matrix cell; it introduces no behaviour change. If any cell fails against the built code, that is a real regression to flag, not a posture to change.

**Spec Reference**: `.workflows/update-output-overhaul/specification/update-output-overhaul/specification.md` — *Safe-vs-Major Bump Gating → Exit-code posture*, *Per-Repo Clone Dedup → Failure isolation & lifecycle*, *Testing & Acceptance* (acceptance 10).
