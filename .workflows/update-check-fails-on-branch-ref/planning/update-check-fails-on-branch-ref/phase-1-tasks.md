---
phase: 1
phase_name: Remote-truth ref classification in update-check
total: 3
---

## update-check-fails-on-branch-ref-1-1 | approved

### Task 1.1: Add exact-path ls-remote probe parser

**Problem**: The remote-truth classifier needs to read a *mixed* `ls-remote refs/heads/{ref} refs/tags/{ref}` response (up to three lines: a `refs/heads/{ref}` line, a `refs/tags/{ref}` line, and — for an annotated tag — a peeled `refs/tags/{ref}^{}` line) and decide which of the two exact ref paths are present. Neither existing helper can do this: `parseLsRemoteSha` reads only the first line and discards the ref path, and `parseTagRefs` strips `refs/tags/` while ignoring heads entirely. Without a dedicated parser there is no way to classify a ref as branch-vs-tag from remote truth.

**Solution**: Add a small, pure parsing function that scans the probe's stdout line-by-line and returns the head sha and/or the tag sha keyed by **exact** ref path — matching the full `refs/heads/{ref}` and `refs/tags/{ref}` strings (not a loose prefix), ignoring the peeled `^{}` line and any line that is neither exact path. This is the foundation the dispatch change (Task 1.2) consumes.

**Outcome**: A function that, given the probe stdout and the `{ref}` name, returns a result exposing (a) the branch tip sha when `refs/heads/{ref}` is present and (b) the tag sha when `refs/tags/{ref}` is present — each independently `null`/absent when its exact path is not in the output. Classification depends only on which of the two exact paths are present and is independent of line order.

**Do**:
- Add a parser (recommended signature: `parseRefProbe(stdout: string, ref: string): { headSha: string | null; tagSha: string | null }`). Recommended home is `src/update-check.ts` alongside the existing `parseLsRemoteSha`, keeping the probe and its parser co-located; `src/git-utils.ts` is an acceptable alternative if the implementation prefers to group it with the other ls-remote parsers. State the chosen home in the code, not both.
- Trim the stdout; on empty input return `{ headSha: null, tagSha: null }`.
- Split on newlines; for each non-empty line, split on tab into `[sha, refPath]`, trimming both.
- Compare `refPath` for **exact string equality** against `refs/heads/${ref}` (→ record as `headSha`) and against `refs/tags/${ref}` (→ record as `tagSha`). Any other `refPath` — including the peeled `refs/tags/${ref}^{}` line and any ref whose name merely shares a prefix — is ignored.
- Do not depend on line ordering: scan all lines and record matches regardless of position.

**Acceptance Criteria**:
- [ ] Given a line `sha\trefs/heads/{ref}` only, returns `{ headSha: sha, tagSha: null }`.
- [ ] Given a line `sha\trefs/tags/{ref}` only, returns `{ headSha: null, tagSha: sha }`.
- [ ] Given both `refs/heads/{ref}` and `refs/tags/{ref}` lines, returns both shas populated.
- [ ] The peeled `refs/tags/{ref}^{}` line is ignored (does not overwrite `tagSha` with the peeled sha, does not error).
- [ ] Empty stdout returns `{ headSha: null, tagSha: null }`.
- [ ] Matching is on the full ref path: for `ref = "release"`, a line `sha\trefs/heads/release-candidate` does NOT match `refs/heads/release` (no loose-prefix cross-match). A ref name containing a slash (e.g. `feature/x`) matches only its exact `refs/heads/feature/x` / `refs/tags/feature/x` path.
- [ ] Result is identical regardless of the order the lines appear in.

**Tests**:
- `"returns headSha and null tagSha when only refs/heads/{ref} present"`
- `"returns tagSha and null headSha when only refs/tags/{ref} present"`
- `"returns both shas when refs/heads/{ref} and refs/tags/{ref} both present"`
- `"ignores the peeled refs/tags/{ref}^{} annotated-tag line"`
- `"returns both null for empty stdout"`
- `"does not cross-match a ref name that is a prefix of another ref (refs/heads/release vs refs/heads/release-candidate)"`
- `"matches a ref name containing a slash only on its exact path"`
- `"classifies identically regardless of line order (heads-then-tags vs tags-then-heads)"`

**Edge Cases**:
- Peeled `^{}` annotated-tag line present alongside the real tag line — ignore the `^{}` line, keep the real tag sha.
- Slash-in-ref-name — must match only the exact full path, never a loose prefix.
- Line order irrelevant — heads may appear before or after tags.
- Empty output (ref exists as neither) — both shas `null`.
- Only-heads present, only-tags present, both present — the three routing-relevant combinations.

**Context**:
> From the specification (Classification probe): "The probe output has up to three lines: a `refs/heads/{ref}` line, a `refs/tags/{ref}` line, and — for an annotated tag — a peeled `refs/tags/{ref}^{}` line. Classify by scanning the lines and recording, per line, whether its ref path is **exactly** `refs/heads/{ref}` or **exactly** `refs/tags/{ref}`. Match the full ref path, not a loose prefix, so a ref name containing a slash cannot cross-match; ignore the peeled `^{}` line and any line that is neither exact path. Classification depends only on *which of the two exact paths are present*, never on line order."
> "This needs a **new parse step**: the existing `parseLsRemoteSha` reads only the first line (discarding the prefix) and `parseTagRefs` strips `refs/tags/` while ignoring heads — neither classifies a mixed heads+tags response. A small dedicated parser (returning the head sha and/or the tag sha, keyed by exact ref path) is required."
>
> Existing reference implementations in the codebase to mirror in style: `parseLsRemoteSha` (`src/update-check.ts`, splits on tab, trims) and `parseTagRefs` (`src/git-utils.ts`, filters `^{}` lines via `!line.includes("^{}")`). This parser differs: it keys on the exact ref path rather than stripping a prefix, and it filters the `^{}` line by exact-path mismatch (the `^{}` path is neither `refs/heads/{ref}` nor `refs/tags/{ref}`), which is sufficient — an explicit `^{}` check is not required but is harmless.

**Spec Reference**: `.workflows/update-check-fails-on-branch-ref/specification/update-check-fails-on-branch-ref/specification.md` (Solution → Classification probe; Scope & Constraints → In scope, new probe-parsing step)

## update-check-fails-on-branch-ref-1-2 | approved

### Task 1.2: Replace isTagRef dispatch with remote-truth classification in checkForUpdate

**Problem**: `checkForUpdate` (`src/update-check.ts`) classifies a stored non-null, unconstrained `ref` as tag-vs-branch by the lexical heuristic `isTagRef` → `/^v?\d/`. A branch named `v4` (a long-lived major-version branch, as `nuxt/ui` ships from `v4`) matches, so it is misrouted to the tag path (`checkTag`), which does an exact tag lookup; no tag literally named `v4` exists, so every update-check surface reports `Tag 'v4' not found on remote` permanently. This misroutes the whole class of branch names that lexically parse as a leading digit (`v4`, `v3`, `4`, `v4.0`, `2024`) and, symmetrically, misroutes real tags whose names don't match `/^v?\d/` (e.g. `release-1.0`) to the branch path. It violates the invariant: installed fine ⇒ should update/remove fine.

**Solution**: Replace dispatch steps 4–5 (the `isTagRef` split) in `checkForUpdate` with a remote-truth classifier: for a non-null, unconstrained `ref`, run a single `ls-remote <url> refs/heads/{ref} refs/tags/{ref}` probe, parse it with the Task 1.1 parser, and route on which exact paths are present — only-heads → branch comparison (reusing the probed head sha, no second lookup), only-tags → tag comparison (its own `--tags` list), both → tiebreak to tag, neither → unified `check-failed`. Remove the now-dead `isTagRef` helper and the now-unreachable per-type not-found guards inside the comparison bodies. Steps 1–3 (`local`, `checkConstrained`, `checkHead`) are untouched.

**Outcome**: A branch ref that looks like a tag (`v4`) classifies as a branch and compares against its `refs/heads/v4` tip → `up-to-date` / `update-available`, never `Tag 'v4' not found`. Real semver tags, symmetric `release-1.0` tags, plain branches, the both-present tiebreak, the neither-present terminal failure, and probe network failures all resolve per the acceptance criteria. Untouched paths (`local`, HEAD `ref=null`, constrained) behave exactly as before.

**Do**:
- In `checkForUpdate`, delete the `if (isTagRef(entry.ref)) return checkTag(...)` branch and the trailing `return checkBranch(...)`. Replace with a call into a new classifier for the non-null, unconstrained `ref` case (e.g. `return classifyAndCheck(url, entry.ref, entry.commit!)`).
- Delete the `isTagRef` function and its comment entirely — it has exactly one caller (this branch) and no test references it; do not port its known-limitation comment (it documents only the opposite `release-1.0` symmetric failure, which this fix resolves).
- Implement the classifier: run `execGit(["ls-remote", url, `refs/heads/${ref}`, `refs/tags/${ref}`], { timeout: 15_000 })` — the module's 15s timeout, not `execGit`'s 30s default. Wrap in try/catch; on any exec/network error return `{ status: "check-failed", reason: (err as Error).message }`.
- Parse the stdout with the Task 1.1 parser into `{ headSha, tagSha }`. Route:
  - `tagSha !== null` → tag path (this covers both only-tags and the both-present tiebreak, since tag wins over branch). Reuse the existing tag comparison: `fetchRemoteTagRefs` + `findNewerTags` → `newer-tags` / `up-to-date`. Do NOT reuse the probe's `tagSha` (a single sha cannot yield the newer-tags set — it issues its own `--tags`).
  - else if `headSha !== null` → branch path: compare `headSha` directly against the installed commit → `headSha === installedCommit ? { status: "up-to-date" } : { status: "update-available", remoteCommit: headSha }`. Reuse the probed `headSha` — issue NO second `refs/heads/{ref}` lookup (required, not optional; it is what keeps the branch case at no extra round-trip).
  - else (both null / neither present) → `{ status: "check-failed", reason: `Ref '${ref}' not found on remote as a branch or tag` }`. This is terminal — no commit-based or HEAD fallback.
- Remove the now-unreachable per-type not-found guards: `checkTag`'s `Tag '…' not found on remote` (the `findNewerTags === null` branch return) and `checkBranch`'s `Branch '…' not found on remote` (the `remoteSha === null` branch return). The probe confirms existence before routing, so these are dead code; the unified neither-found reason is the single not-found path. If `checkBranch` becomes fully unused after inlining the branch comparison, remove it; if `checkTag`'s body is reused, keep only its live paths (`newer-tags` / `up-to-date` / catch → `check-failed`).
- Preserve the `UpdateCheckResult` union unchanged — no new status variants; the neither-present case reuses `check-failed`.

**Acceptance Criteria**:
- [ ] `ref = "v4"`, remote advertises `refs/heads/v4` and no `refs/tags/v4` → classifies as branch; returns `up-to-date` when the `refs/heads/v4` tip equals the installed commit, `update-available` (with the tip as `remoteCommit`) otherwise; never returns `Tag 'v4' not found on remote`. (Direct regression guard.)
- [ ] `ref = "v4.9.0"`, remote advertises `refs/tags/v4.9.0` plus newer tags → classifies as tag; returns `newer-tags` when later tags exist, else `up-to-date`. Unchanged from today.
- [ ] `ref = "release-1.0"`, remote advertises `refs/tags/release-1.0` (name not matching `/^v?\d/`) → classifies as tag; returns a tag-comparison result, never `Branch 'release-1.0' not found`.
- [ ] `ref = "main"` / `"dev"`, remote advertises `refs/heads/main` → classifies as branch; unchanged from today.
- [ ] Remote advertises both `refs/heads/{ref}` and `refs/tags/{ref}` → resolves deterministically to the tag (tiebreak), returning the tag-comparison result.
- [ ] Remote advertises neither → `{ status: "check-failed", reason: "Ref '{ref}' not found on remote as a branch or tag" }`; terminal, no commit/HEAD fallback even though a valid installed commit exists.
- [ ] The probe `ls-remote` errors (network/exec failure) → `{ status: "check-failed", reason: <underlying error message> }`.
- [ ] `isTagRef` is removed and has no remaining caller; the per-type `Tag '…' not found` / `Branch '…' not found` strings are gone from the codebase — the unified reason is the single not-found path.
- [ ] Untouched paths verified unchanged: `constraint` set → `checkConstrained`; `ref === null` (HEAD) → `checkHead`; `ref === null && commit === null` → `local`. No probe `ls-remote refs/heads/… refs/tags/…` call is issued for these three cases.
- [ ] The probe uses `{ timeout: 15_000 }` (module standard), not the 30s `execGit` default.

**Tests** (in `tests/update-check.test.ts`, with `git-mocks.ts` branching on the `ls-remote` args per invocation):
- `"branch ref matching /^v?\\d/ (v4) classifies as branch and compares the branch tip, never Tag 'v4' not found"` — probe returns `refs/heads/v4` only; assert `update-available` (tip != commit) and `up-to-date` (tip == commit); assert the result is never the `Tag 'v4' not found` reason.
- `"real semver tag (v4.9.0) still returns newer-tags when later tags exist"` — probe returns `refs/tags/v4.9.0`; the `--tags` call returns v4.9.0 + newer; assert `newer-tags`.
- `"real semver tag at latest returns up-to-date"` — assert `up-to-date` when no newer tags.
- `"symmetric tag not matching /^v?\\d/ (release-1.0) classifies as tag, not Branch 'release-1.0' not found"` — probe returns `refs/tags/release-1.0`; assert a tag-comparison result.
- `"plain branch (main) classifies as branch"` — probe returns `refs/heads/main`; assert branch comparison.
- `"ref present as both branch and tag resolves to the tag (tiebreak)"` — probe returns both `refs/heads/v4` and `refs/tags/v4`; assert the tag-comparison path runs (e.g. a `--tags` call is made and a `newer-tags` / `up-to-date` result is returned, not a branch-tip comparison).
- `"ref present as neither returns unified not-found check-failed"` — probe returns empty; assert `{ status: "check-failed", reason: "Ref 'v4' not found on remote as a branch or tag" }`.
- `"probe network failure returns check-failed carrying the underlying message"` — probe `ls-remote` rejects with `network error`; assert `{ status: "check-failed", reason: "network error" }`.
- `"branch classification reuses the probed head sha and issues no second refs/heads lookup"` — assert only the probe call (no separate `refs/heads/{ref}`-only call) is made for the branch case.
- Update/retire the existing old-heuristic tests: rewrite the `ref type detection` describe block (the `v1.2.3` / `1.0.0` "asserts `--tags` called directly" cases) against remote-truth classification; update the tag path's single-`--tags`-call assertion and the branch/tag exact-arg-shape assertions to the probe-then-compare sequence; replace the per-type not-found assertions (`Branch 'deleted-branch' not found on remote`, `Tag 'v2.0' not found on remote`) — where the ref exists as neither, assert the unified `Ref '…' not found on remote as a branch or tag`.
- Confirm untouched-path tests still pass: `local`, HEAD-tracking, and the constrained cases (including those in `tests/update-check-unconstrained-regression.test.ts`).

**Edge Cases**:
- Branch ref that looks like a tag (`v4`) — the reported exemplar; the whole leading-digit class (`v3`, `4`, `v4.0`, `2024`) is covered by construction.
- Real semver tag (`v4.9.0`) — must still take the tag path.
- Symmetric tag not matching `/^v?\d/` (`release-1.0`) — must now take the tag path (previously misrouted to branch).
- Plain branch (`main` / `dev`).
- Both a branch and a tag named `{ref}` — tiebreak resolves to tag.
- Ref exists as neither (deleted upstream) — unified not-found `check-failed`, terminal.
- Probe network/exec failure — `check-failed` carrying the underlying message.
- Untouched paths unchanged — `local`, HEAD `ref=null`, constrained.

**Context**:
> From the specification (Dispatch change): current order is (1) `ref===null && commit===null` → local; (2) `constraint !== undefined` → `checkConstrained`; (3) `ref===null` → `checkHead`; (4) `isTagRef(ref)` → `checkTag` (the bug); (5) else → `checkBranch`. "Steps 1–3 are **unchanged**. Steps 4–5 (the lexical `isTagRef` split) are replaced by remote-truth classification. The `isTagRef` helper is removed (it has no other caller)."
> From the specification (Classification probe): route only-heads → branch, only-tags → tag, both → tiebreak, neither → `check-failed` reason `Ref '{ref}' not found on remote as a branch or tag`. Run the probe "via `execGit` with the module's standard `{ timeout: 15_000 }` … **not** `execGit`'s 30s default."
> From the specification (Tiebreak): "Resolve to the **tag**, mirroring git's own ref-resolution precedence (gitrevisions disambiguates a bare name with `refs/tags/` before `refs/heads/`). … The manifest records no ref-type intent, so this is the principled default." Implementation consequence: routing on `tagSha !== null` first (before checking `headSha`) implements the tiebreak for free.
> From the specification (Comparison paths): "The branch path **reuses that [`refs/heads/{ref}`] sha and issues no second lookup** — required, not optional." "The tag path always issues its own `ls-remote --tags` for the full tag list … It does **not** reuse the probe's tag sha (a single probed sha cannot yield the newer-tags set)."
> From the specification (Error handling): the neither-found case "is **terminal**: even though the entry still holds a valid installed `commit`, there is **no** commit-based or HEAD fallback." "Because the probe confirms the ref exists before routing, the per-type 'not found' guards inside the comparison bodies (`checkTag`'s `Tag '…' not found`, `checkBranch`'s `Branch '…' not found`) become **unreachable**. They may be removed as dead code."
> From Scope & Constraints: "Preserve the existing `UpdateCheckResult` union — no new status variants; the neither-exists case reuses `check-failed`." No new dependencies.
>
> Mock-harness note (spec Testing Requirements): "The dispatch may issue more than one `ls-remote` invocation per check (probe, then tag list). The mock in `git-mocks.ts` must return the correct response **per invocation** — branch on the `ls-remote` args rather than returning one fixed payload." Practically: inspect `args` for `--tags` (→ return the tags list) vs the probe (contains `refs/heads/{ref}` and `refs/tags/{ref}` → return the probe payload). Existing `mockExecFile` already receives `_args` per call; switch on it. Add a `buildRefProbeOutput`-style helper in `git-mocks.ts` if it reduces duplication, mirroring the existing `buildTagsOutput`.
>
> Spec preference: "Where the harness allows, exercise classification against real `ls-remote` ref output, since the whole bug is the disagreement between lexical guess and remote reality." Prefer realistic mock payloads (`sha\trefs/heads/v4\n`, `sha\trefs/tags/v4.9.0\n`, annotated-tag `^{}` lines) over synthetic shapes.
>
> Out of scope — do NOT touch: manifest/`refType`, the `add` side, `checkConstrained` / `checkHead` / `local` logic, and the `isVersionTag` gating of the "change version" action in `list-detail.ts` (branch refs stay disabled — correct). Do not swap `isTagRef` for `isVersionTag`.

**Spec Reference**: `.workflows/update-check-fails-on-branch-ref/specification/update-check-fails-on-branch-ref/specification.md` (Solution → Dispatch change / Classification probe / Tiebreak / Comparison paths / Error handling; Acceptance Criteria 1–7; Testing Requirements → New regression coverage + Existing tests to update + Mock harness note)

## update-check-fails-on-branch-ref-1-3 | approved

### Task 1.3: Confirm cross-surface recovery for the v4-style branch ref

**Problem**: The bug's visible harm is spread across three surfaces, each keyed off `checkForUpdate`'s result: `agntc update <key>` hard-errored (exit 1) on `check-failed`; `agntc update` (all) emitted a loud non-fatal `check-failed` warning; `agntc list` showed a permanent `✗ check failed` status column and a degraded detail view. Now that `checkForUpdate` returns a real status for a `v4`-style branch ref, we must confirm the recovery actually lands on all three surfaces and that no surface regresses — and confirm the one deliberately-out-of-scope behaviour (the "change version" action staying disabled for branch refs) is unchanged.

**Solution**: Add/adjust cross-surface tests that feed a non-`check-failed` status (as Task 1.2 now produces for a branch ref) through the command surfaces and assert the recovered behaviour, plus a test locking in that a branch-ref detail view still disables "change version". These surfaces already mock `checkForUpdate` in their unit tests, so the verification here is that each surface handles a real status correctly — the classification itself is proven in Task 1.2.

**Outcome**: For an entry that previously reported `Check failed — Tag 'v4' not found on remote`: `agntc update <key>` reports a real status and exits 0; `agntc update` (all) emits no `check-failed` warning for it; `agntc list` status column and detail view show a real status; and the `list` "change version" action remains disabled for the branch ref (`isVersionTag("v4")` is `false`) — confirmed, out of scope, correct. The full suite is green.

**Do**:
- In `tests/update-check-all.test.ts`: confirm/adjust coverage that when `checkForUpdate` resolves a non-`check-failed` status (e.g. `up-to-date` / `update-available`) for a `v4`-branch entry, `checkAllForUpdates` surfaces that status and no `check-failed` entry appears for it. The existing mixed-status and single-result tests already assert `check-failed` only when the mock throws/returns it; add a branch-ref (`makeEntry({ ref: "v4", commit: … })`) case that resolves `up-to-date` and assert the map value is `up-to-date` (not `check-failed`).
- In `tests/commands/update.test.ts`: add single-key coverage that a `v4`-branch entry whose `checkForUpdate` resolves `up-to-date` exits 0 (no `ExitSignal`) and shows the up-to-date outro — mirroring the existing "up-to-date" describe block but with `ref: "v4"`. Add an all-plugins case asserting no `check-failed` warning is logged for a `v4`-branch entry resolving to a real status (contrast with the existing "notes check-failed plugins in summary" test). Confirm the existing `check-failed` single-key test (exit 1) is unchanged — it still applies when a genuine `check-failed` is returned (neither-found / network), just no longer for a `v4` branch.
- In `tests/commands/list-detail.test.ts`: add/confirm a case that a `v4`-branch entry with a real `updateStatus` (e.g. `up-to-date` or `update-available`) renders the corresponding real status and its normal actions, and that "change version" is NOT offered for `ref: "v4"` (because `isVersionTag("v4")` is `false`). The existing test "does NOT offer Change version for a branch-tracking install (ref is not a version)" covers `ref: "main"`; add or extend it to include the `v4` exemplar so the out-of-scope gate is explicitly locked for the reported ref. Do NOT change the `isVersionTag` gating in `src/commands/list-detail.ts` — it stays disabled for branch refs by design.
- Run the full suite (`npm test`) and confirm green, including the regression file `tests/update-check-unconstrained-regression.test.ts` and the Task 1.2 unit tests.

**Acceptance Criteria**:
- [ ] `agntc update v4-branch-key` with `checkForUpdate` → `up-to-date` exits 0 (no `ExitSignal`) and shows the up-to-date message; it does not hit the `check-failed` exit-1 branch.
- [ ] `agntc update` (all) with a `v4`-branch entry resolving to a real status emits no `check-failed`/"failed" warning for that entry.
- [ ] `checkAllForUpdates` surfaces the real status for a `v4`-branch entry (map value is the real status, not `check-failed`).
- [ ] `agntc list` detail view for a `v4`-branch entry with a real `updateStatus` renders that status and its normal actions.
- [ ] The `list` "change version" action is NOT offered for `ref: "v4"` (gated by `isVersionTag`, which returns `false` for `v4`) — confirmed unchanged, out of scope.
- [ ] The genuine `check-failed` behaviours stay intact: `update <key>` still exits 1 on a real `check-failed` (neither-found / network); `update` (all) still notes real `check-failed` entries; `list` still disables "change version" on `check-failed`.
- [ ] The full test suite is green: new regression + rewritten unit tests in `tests/update-check.test.ts`, `tests/update-check-all.test.ts`, `tests/commands/update.test.ts`, `tests/commands/list-detail.test.ts`, and `tests/update-check-unconstrained-regression.test.ts` all pass; no existing behaviour regresses.

**Tests**:
- `tests/update-check-all.test.ts`: `"surfaces a real status (not check-failed) for a v4-branch entry"`.
- `tests/commands/update.test.ts`: `"single-key update of a v4-branch entry that is up-to-date exits 0"`; `"all-plugins update emits no check-failed warning for a v4-branch entry resolving to a real status"`.
- `tests/commands/list-detail.test.ts`: `"renders a real status for a v4-branch entry"`; `"does NOT offer Change version for a v4-branch ref (isVersionTag false, out of scope)"`.
- Full-suite green check via `npm test`.

**Edge Cases**:
- `update` single exits 0 (not 1) once the status is real.
- `update` all emits no `check-failed` warning for the recovered entry.
- `list` status column and detail show the real status.
- `list` "change version" stays disabled for the branch ref (`isVersionTag("v4")` is `false`) — out of scope, must remain unchanged.
- Genuine `check-failed` (neither-found / network) must still drive the original loud/exit-1 behaviour on each surface — recovery is specific to refs that now classify successfully.

**Context**:
> From the specification (Acceptance Criteria → Cross-surface): "an entry that previously showed `Check failed — Tag 'v4' not found on remote` now — `agntc update <key>` — reports a real status and exits 0 (no hard error). `agntc update` (all) — no `check-failed` warning for that entry. `agntc list` — update-status column and detail view show a real status (no longer `check-failed`). The **'change version' action is gated separately** by `isVersionTag(entry.ref)` in `list-detail.ts` — **outside this fix's scope**. For a branch ref like `v4`, `isVersionTag` stays `false`, so the action remains disabled (correct — a branch is not tag-pinned). This fix recovers the status column and detail view; it does not re-enable 'change version' for branch refs."
> Severity-by-surface (spec Overview): `update <key>` was a hard non-zero error (exit 1); `update` (all) was a loud non-fatal warning (`check-failed` excluded from the failed-outcome set, so no non-zero exit); `list` was a permanent `✗ check failed`.
>
> Codebase grounding: `src/commands/list-detail.ts` line 133 gates the action with `const canChangeVersion = isVersionTag(entry.ref) && updateStatus.status !== "check-failed";`. `isVersionTag` (`src/version-resolve.ts`) returns `false` for `v4` (not a full semver), so the action is disabled for branch refs regardless of this fix — do not modify this line. The command test files (`update.test.ts`, `list-detail.test.ts`) already mock `checkForUpdate`, so these tests exercise the surface's handling of a given status, not the classification itself (which Task 1.2 proves).
>
> `remove` is unaffected (no ref resolution) — no coverage needed. This task adds no production code beyond what Task 1.2 changes; it is verification-and-lock-in of the emergent cross-surface recovery within the same phase.

**Spec Reference**: `.workflows/update-check-fails-on-branch-ref/specification/update-check-fails-on-branch-ref/specification.md` (Overview → severity by surface; Acceptance Criteria → Cross-surface; Testing Requirements → cross-surface files; Out of Scope → `isVersionTag` gating stays)
