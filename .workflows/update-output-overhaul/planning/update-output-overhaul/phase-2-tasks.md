---
phase: 2
phase_name: Per-unit progress stream and trailing collapse
total: 7
---

## update-output-overhaul-2-1 | approved

### Task 2.1: Add group-label helper with @intent disambiguation

**Problem**: The Phase 2 display surfaces — the streamed group header (Task 2.2/2.4), the collapsed trailing summary (Task 2.5), and the out-of-constraint footer (Task 2.7) — all need a single, shared human label for a group. Almost always a repo has one group per run, so its label is the bare `owner/repo`; but when one repo yields *multiple* groups (members added at different version intents), a bare repo label would merge two distinct groups' version info into one indistinguishable line — a correctness bug, not cosmetics. The three surfaces must render the identical label, so it must be authored once.

**Solution**: Add a pure `groupLabel(group, groups)` helper that returns the bare `owner/repo` when the group's repo appears in exactly one group in the run, and the disambiguated `owner/repo@<intent>` (`@^1.2.3`, `@v2.0.0`, `@main`, or the `@HEAD` sentinel) when the repo yields multiple groups.

**Outcome**: `groupLabel(group, groups)` returns `owner/repo` for a single-group repo and `owner/repo@<intent>` for a repo with two or more groups, where the intent form is the group's caret constraint, its branch/exact-pin ref, or the literal `HEAD` for a HEAD-tracked (`versionIntent === null`) group — the one label shared verbatim by the header, the trailing collapse, and the footer.

**Do**:
- Create `src/update-render.ts` (the Phase 2 pure-rendering module; all subsequent Phase 2 formatters live here). Import `EntryGroup` from `src/update-groups.ts` (Phase 1 Task 1.1: `{ cloneUrl, versionIntent: string | null, constrained, members: Array<{ key; entry }> }`).
- Add `function repoOf(group: EntryGroup): string` deriving the repo from the group's first member key: `group.members[0]!.key.split("/").slice(0, 2).join("/")` (all members of a group share one repo; a member key is `owner/repo` for a standalone or `owner/repo/<member>` for a collection member — the first two segments are the repo either way).
- Export `function groupLabel(group: EntryGroup, groups: EntryGroup[]): string`. Compute `base = repoOf(group)`. If `groups.filter((g) => repoOf(g) === base).length > 1`, append the intent suffix; otherwise return `base` unchanged.
- Intent suffix: `group.versionIntent === null ? "@HEAD" : "@" + group.versionIntent`. Because `versionIntent = constraint ?? ref` (Phase 1), this yields `@^1.2.3` for a constrained (caret) group, `@v2.0.0`/`@main` for an unconstrained exact-pin/branch group, and `@HEAD` for a HEAD-tracked (`ref === null`, unconstrained) group — no need to branch on `group.constrained` since both constraint and ref map through `versionIntent`.

**Acceptance Criteria**:
- [ ] A repo with a single group in `groups` yields the bare `owner/repo` (no `@` suffix).
- [ ] A repo appearing in two groups (e.g. a caret group and an exact-pin group) yields `owner/repo@^1.2.3` and `owner/repo@v2.0.0` respectively — each disambiguated by its own intent.
- [ ] A HEAD-tracked group (`versionIntent === null`) in a multi-group repo yields `owner/repo@HEAD` (the sentinel, not `@null`).
- [ ] A branch group yields `owner/repo@main` and an exact-pin group yields `owner/repo@v2.0.0` when their repo is multi-group.
- [ ] The label is computed identically regardless of whether the group is a standalone (member key `owner/repo`) or a collection (member keys `owner/repo/<member>`) — `repoOf` strips the member segment.

**Tests** (new file `tests/update-render.test.ts`, building `EntryGroup` fixtures directly or via a small `makeGroup` helper over `tests/helpers/factories.ts`):
- `"returns the bare owner/repo label when the repo has a single group"`
- `"disambiguates two groups of one repo with @<constraint> and @<tag> intent suffixes"`
- `"uses the @HEAD sentinel for a HEAD-tracked group (versionIntent === null) in a multi-group repo"`
- `"renders @main for a branch group and @v2.0.0 for an exact-pin group when the repo is multi-group"`
- `"derives the same repo label for a standalone (owner/repo) and a collection member (owner/repo/member)"`

**Edge Cases**:
- Single-group repo → bare label; multi-group repo → `@intent`.
- HEAD-tracked group → `@HEAD` sentinel (not `@null`).
- Caret / branch / exact-pin intent forms all render as `@<versionIntent>`.

**Context**:
> *Partial collections & counts → Group label* (spec): "Almost always a repo has a single group in a run, so its line reads `owner/repo: …`. When one repo yields *multiple* groups (members added at different intents), each line disambiguates by appending the intent: `owner/repo@^1.2.3: …`, `owner/repo@v2.0.0: …`, `owner/repo@main: …`, or `owner/repo@HEAD: …`. This same label is shared by the group header, the trailing collapse, and the out-of-constraint footer." "Collapsing by *repo* instead would merge distinct-intent groups of the same repo ... and silently drop one group's version info — a correctness bug, not cosmetics." The `EntryGroup.versionIntent` (`constraint ?? ref`, `null` for HEAD) is the Phase 1 Task 1.1 field; the `@HEAD` sentinel mirrors that task's ` HEAD` key sentinel for HEAD-tracked entries.

**Spec Reference**: `.workflows/update-output-overhaul/specification/update-output-overhaul/specification.md` — *Per-Unit Progress Output → Partial collections & counts (Group label)*, *Testing & Acceptance* (acceptance 4).

## update-output-overhaul-2-2 | approved

### Task 2.2: Format the group header — label, member count, shared-vs-divergent version move

**Problem**: A multi-member collection updating several members needs a single group header carrying *what* is happening — the group label, the count of members being updated, and the shared version move — because the per-member lines (Task 2.3) show `member → agents`, not a version, so without the header a multi-member collection would show the version move nowhere. The header's "old" is per-member, so when updating members share one old it belongs on the header, and when their olds diverge the header must fall back to the target only.

**Solution**: Add a pure `formatGroupHeader(input)` that renders `Updating <label>  <old> -> <new>  (N members)` when the updating members share one installed commit, and `Updating <label> -> <new>  (N members)` (target only) when their installed commits diverge — with the version move rendered by an interim, hash-based `formatVersionMove` helper.

**Outcome**: `formatGroupHeader` returns the spinner-start header string: shared-old groups carry `<oldShort> -> <newShort>` on the header; divergent-old groups carry only `-> <newShort>` (each updating member then carries its own move on its line, Task 2.3); `(N members)` counts the attempted (updating) members and is fixed at call time; up-to-date siblings contribute no old and are absent from the count.

**Do**:
- In `src/update-render.ts`, export the single interim version-move helper `function formatVersionMove(oldCommit: string, newCommit: string): string` returning `` `${oldCommit.slice(0, 7)} -> ${newCommit.slice(0, 7)}` `` — short commit hashes with the ` -> ` arrow, matching today's `renderUpdateOutcomeSummary` (`summary.ts:263-269`). This is the **interim** formatter: it renders hashes, NOT tags. Do NOT encode the tag-vs-hash rule here — Phase 3 rewords this one helper (and its callers) to speak in tags where both refs are genuine semver tags. Task 2.3 reuses `formatVersionMove` for the per-member divergent-old move.
- Export `function formatGroupHeader(input: { label: string; oldCommits: string[]; newCommit: string }): string`, where `label` comes from `groupLabel` (Task 2.1), `oldCommits` are the *updating* members' installed `entry.commit` values (one per attempted member; up-to-date siblings excluded), and `newCommit` is the group's resolved target commit (constrained target commit, or the resolved branch/HEAD sha — already known from the check phase, Phase 1 Task 1.3).
- Compute `count = input.oldCommits.length` (the attempted-member count) and `distinct = new Set(input.oldCommits).size`.
- Shared-old (`distinct === 1`): return `` `Updating ${label}  ${formatVersionMove(oldCommits[0]!, newCommit)}  (${count} members)` ``.
- Divergent-old (`distinct > 1`): return `` `Updating ${label} -> ${newCommit.slice(0, 7)}  (${count} members)` `` — the header shows the resolved target only; the shared "old" is not representable, so it moves to each member line (Task 2.3).
- Keying shared-vs-divergent on the installed *commit* (not ref) is deliberate and covers both cases uniformly: an atomically-added constrained collection shares one commit (shared old); members manually installed at different tags, and branch/HEAD members sitting at different commits, diverge (target-only header). The `(N members)` noun is generic ("members", not "skills") because a collection can hold plugin members, not only skills.

**Acceptance Criteria**:
- [ ] Shared-old group (all `oldCommits` equal) → `Updating <label>  <oldShort> -> <newShort>  (N members)`.
- [ ] Divergent-old group (`oldCommits` contains ≥2 distinct values) → `Updating <label> -> <newShort>  (N members)`, with no old ref on the header.
- [ ] `(N members)` equals `oldCommits.length` — the attempted-member count — and reflects only updating members (the caller excludes up-to-date siblings from `oldCommits`).
- [ ] The version move renders as 7-character short commit hashes (interim), never as semver tags — no tag-vs-hash branching is present in `formatGroupHeader` or `formatVersionMove`.
- [ ] `formatVersionMove(a, b)` is the single move renderer reused verbatim by the divergent-old member line (Task 2.3).

**Tests** (add to `tests/update-render.test.ts`):
- `"renders a shared-old header with old -> new and the attempted member count"`
- `"renders a divergent-old header with the resolved target only (no old ref)"`
- `"counts only the updating members passed in oldCommits (up-to-date siblings excluded upstream)"`
- `"renders the version move as short commit hashes, not tags (interim — Phase 3 rewords)"`
- `"formatVersionMove returns <oldShort> -> <newShort> for reuse on member lines"`

**Edge Cases**:
- Shared old → header `old -> new`; divergent olds → header target-only.
- Up-to-date siblings excluded from the count and old-set (caller-enforced; header sees only attempted olds).
- `(N members)` fixed at call time over the attempted set.
- Interim hash move — Phase 3 rewords to tags. Do NOT encode the tag rule here.

**Context**:
> *Version move & dropped-agents placement → Header "old" ref when updating members diverge* (spec): "The *new* ref is genuinely shared (the group's resolved target); the *old* ref is per-member ... When the updating members share one old ref — the common case, an atomically-added collection all at the same tag — the header shows that shared `old → new`. When their olds diverge ... the header shows **only the resolved target** (`◒ Updating owner/repo → v1.3.0 (N members)`) and **every** updating member carries its own `old → new` on its member line ... Up-to-date members are excluded from the count and contribute no 'old'." *Partial collections & counts → Header count/noun is generic*: "`(N members)` counts the members this group is **updating** (the *attempted* set ...), not `(N skills)` ... The count is fixed when the spinner starts, *before* per-member outcomes resolve." *Genuine-state splits* / *Group-first pipeline*: a branch/HEAD split is at the commit level (members share the branch ref but sit at different installed commits) — which is why shared-vs-divergent keys on the installed commit. INTERIM CONSTRAINT: this is the hash-based formatter; *Tag-Based Summary Wording* ("Render `Updated <old> → <new>` in tags when both refs are genuine version tags AND the ref moved") is Phase 3 and must NOT be encoded here.

**Spec Reference**: `.workflows/update-output-overhaul/specification/update-output-overhaul/specification.md` — *Per-Unit Progress Output → Version move & dropped-agents placement*, *Partial collections & counts (Header count/noun)*, *Testing & Acceptance* (acceptance 2).

## update-output-overhaul-2-3 | approved

### Task 2.3: Format per-member outcome lines — glyphs, agents, move parenthetical, dropped-agents

**Problem**: A group's streamed block must contain *every* attempted member's outcome under the one header — successes, failures, and skips — each at the log level matching its severity, and each carrying only the information that belongs on the member line: the effective agents, the divergent-old version move (when the header couldn't carry it), and the per-member dropped-agents notice. Today none of these have a home on a per-member line; the loud abort/copy-safety messages are deferred to an end-of-run loop.

**Solution**: Add a pure `formatMemberLine(input)` that maps a member's outcome to `{ level, text }` — success at `success` level as `<name> → <agents>` with an optional `(move; dropped)` parenthetical, `copy-failed`/`aborted`/`blocked` at `error` level carrying their inline messages, and `no-agents` at `warn` level as a skip — for the streaming layer (Task 2.4) to dispatch via `p.log[level](text)`.

**Outcome**: `formatMemberLine` returns the exact per-member line and its clack log level: a success renders `<name> → <agents>` (plus `(move)` only in the divergent-old case, plus `; <agents> support removed by plugin author` sharing that parenthetical when agents were dropped); an aborted member's line carries the recorded-type + `remove`+`add` remedy inline; a blocked member's line carries the copy-safety message with no remedy; a copy-failed member's line carries the recovery hint; a no-agents member's line is a `⚠` skip.

**Do**:
- The `✓`/`✗`/`⚠` glyphs in the spec map to the clack **log level** (matching today's summary convention where message text carries no glyph and `p.log.success`/`error`/`warn` supply the gutter symbol — `update.ts:588-609`). So `formatMemberLine` returns `{ level: "success" | "error" | "warn"; text: string }`; text has no embedded glyph. Task 2.4 calls `p.log[level](text)`.
- In `src/update-render.ts`, export `function formatMemberLine(input: MemberLineInput): { level: "success" | "error" | "warn"; text: string }` with the discriminated input:
  - `{ kind: "success"; name: string; agents: string[]; droppedAgents: string[]; move?: { oldCommit: string; newCommit: string } | null }`
  - `{ kind: "copy-failed"; name: string; recoveryHint: string }`
  - `{ kind: "aborted"; name: string; message: string }` (`message` = `buildAbortMessage(key, recordedType, reason)` output, `clone-reinstall.ts:263-273`)
  - `{ kind: "blocked"; name: string; message: string }` (`message` = `buildCopySafetyMessage(key, reason)` output, `clone-reinstall.ts:285-290`)
  - `{ kind: "no-agents"; name: string }`
- Success → level `"success"`, `text = `${name} → ${agents.join(", ")}${suffix}`` (the `→` separator matches `renderCollectionAddSummary`, `summary.ts:198`). Build `suffix` from an ordered parts list: push `formatVersionMove(move.oldCommit, move.newCommit)` (Task 2.2) when `move` is present (divergent-old case only); push the dropped-agents body when `droppedAgents.length > 0`; then `suffix = parts.length ? ` (${parts.join("; ")})` : ""`. So a move + dropped share one parenthetical: `<name> → <agents>  (…move…; …dropped…)`.
- Source the dropped-agents body from a single place to prevent wording drift: extend `formatDroppedAgentsSuffix` (`summary.ts:31-41`) with a `"parenthetical"` style that returns the bare body `` `${droppedAgents.join(", ")} support removed by plugin author` `` (no leading `. ` or ` — ` separator), reusing the existing agents join and the canonical "support removed by plugin author" phrase.
- `copy-failed` → level `"error"`, `text = `${name}: copy failed — ${recoveryHint}`` (the recovery hint is today's copy-failed message — the member is now uninstalled, re-run `update`).
- `aborted` → level `"error"`, `text = `${name}: ${message}`` — the loud message rides the line, already naming the recorded type and the `npx agntc remove <key>` then `npx agntc add <key>` remedy inline.
- `blocked` → level `"error"`, `text = `${name}: ${message}`` — the copy-safety message describing the escaping symlink; it offers **no** remove+add remedy.
- `no-agents` → level `"warn"`, `text = `${name}: skipped — no longer supports installed agents`` — a skip, not a failure.

**Acceptance Criteria**:
- [ ] A success with no move and no dropped agents → `{ level: "success", text: "<name> → <agents>" }` with no parenthetical.
- [ ] A divergent-old success → `<name> → <agents>  (<oldShort> -> <newShort>)` carrying its own move via `formatVersionMove`.
- [ ] A success that dropped agents → `<name> → <agents>  (codex support removed by plugin author)`; a success with both a move and dropped agents → `<name> → <agents>  (<oldShort> -> <newShort>; codex support removed by plugin author)` — one shared parenthetical, parts joined by `; `.
- [ ] `copy-failed` → `error` level, `<name>: copy failed — <recovery hint>`.
- [ ] `aborted` → `error` level, `<name>: <abort message>` carrying the recorded type and the `remove`+`add` remedy inline.
- [ ] `blocked` → `error` level, `<name>: <copy-safety message>` with no remove+add remedy.
- [ ] `no-agents` → `warn` level, `<name>: skipped — no longer supports installed agents`.

**Tests** (add to `tests/update-render.test.ts`):
- `"success renders <name> → <agents> at success level with no parenthetical when no move or drop"`
- `"divergent-old success carries its own (old -> new) move parenthetical"`
- `"success with dropped agents appends the 'support removed by plugin author' notice in the parenthetical"`
- `"success with both a move and a drop shares one parenthetical joined by ';'"`
- `"copy-failed renders at error level with the recovery hint"`
- `"aborted renders at error level carrying the recorded type and the remove+add remedy inline"`
- `"blocked renders at error level with the copy-safety message and no remove+add remedy"`
- `"no-agents renders at warn level as a skip"`

**Edge Cases**:
- success `✓ member → agents`; divergent-old success carries its own `(old -> new)`.
- dropped-agents suffix on the member line; move + dropped share one parenthetical.
- copy-failed `✗` recovery hint; aborted `✗` recorded-type + remove/add remedy inline; blocked `✗` copy-safety message with no remedy; no-agents `⚠` skip.
- Glyphs are clack log levels (success/error/warn), not embedded characters — text carries no glyph.

**Context**:
> *Failed & skipped member lines* (spec): "A group's streamed member block contains **every** attempted member's outcome ... at the log level matching its severity: **Success** → `✓ member → agents` (`p.log.success`). **`copy-failed`** → `✗ member: copy failed — <recovery hint>` (`p.log.error`) ... **`aborted`** ... carrying the recorded-type + `remove`+`add` remedy **inline** on the member line (the loud message rides the line rather than being deferred) ... **`blocked`** ... Entry left intact; no remove+add remedy. **`no-agents`** → `⚠ member: skipped — no longer supports installed agents` (`p.log.warn`). A skip, not a failure." *Version move & dropped-agents placement*: "Member-line version move rides a parenthetical suffix ... `✓ macos → claude  (v1.2.0 → v1.3.0)`. When a member also drops agents, both share the suffix: `✓ macos → claude  (v1.2.0 → v1.3.0; codex support removed by author)`. (This per-member move appears only in the divergent-old case ...) ... **Dropped-agents notice → the member line** ... This is the `formatDroppedAgentsSuffix` 'support removed by author' notice (`summary.ts:261-277`)." NOTE: the spec writes "removed by author"; the canonical code phrase (`summary.ts:40`) is "removed by plugin author" — this task reuses the canonical phrase to avoid an unlegislated wording change (Phase 2 restructures placement, not wording). INTERIM CONSTRAINT: the move uses `formatVersionMove` (hashes) — do NOT encode tags (Phase 3).

**Spec Reference**: `.workflows/update-output-overhaul/specification/update-output-overhaul/specification.md` — *Per-Unit Progress Output → Failed & skipped member lines*, *Version move & dropped-agents placement*, *Testing & Acceptance* (acceptance 2, 7).

## update-output-overhaul-2-4 | approved

### Task 2.4: Stream the actioned phase — batched check, then per-group Updating spinner emitting member lines

**Problem**: Phase 1 ships functional-but-interim output: the grouped engine runs, but every actioned outcome is still deferred to a single end-of-run summary loop (`update.ts:588-609`), so the user learns *what* changed only after everything finishes. The designed two-granularity stream — a batched check, then per-group `Updating` spinners emitting persistent per-member outcome lines on completion — must replace that loop for actioned outcomes.

**Solution**: Rewire `runAllUpdates`'s actioned phase into a streamed loop: keep the single leading `Checking for updates…` spinner (Phase 1), then iterate the updatable groups and local entries in manifest (processing) order — each updatable group getting its own `p.spinner()` started with the group header (Task 2.2), spinning through `processGroupUpdate`'s clone, then emitting the per-member lines (Task 2.3) via `p.log.*` on completion, after that group's per-group manifest write.

**Outcome**: Updatable groups stream inline in manifest order under a header carrying the label, `(N members)`, and the shared version move; each attempted member renders its own line beneath at the matching level; a standalone or single-updated-collection-member group collapses to one line (keeping the `/member` suffix for a collection member); a local entry renders as a group-of-one `Refreshed from local path` line interleaved at its manifest position with no spinner; a mixed-outcome group is one self-contained block; each group's `✓` appears only after its manifest write; the spinner spins on the group name through the clone without ticking per member; and a group with no updating members emits no `Updating` spinner.

**Do**:
- Keep the single leading `Checking for updates…` spinner and the up-front parallel group resolution + per-member categorization from Phase 1 Task 1.5. The check phase resolves every group's target (and thus its version move) *before* streaming begins — which is why the streamed spinner can carry the resolved move.
- Build the ordered **processing list** in manifest order: each unit is either an *updatable group* (a non-local group with ≥1 member categorized `update-available`/`constrained-update-available`) positioned at its first member's manifest index, or a *local entry* (`commit === null`) positioned at its manifest index. Non-updatable groups (all members up-to-date/`newer-tags`/`constrained-no-match`, or a `check-failed` group) are NOT in this list — they are silent in the stream and handled only by the trailing summary (Task 2.5). Stream the list in order.
- For a **local entry** (group-of-one, no clone): reinstall it (Phase 1 Task 1.5 path), write its manifest (Phase 1 Task 1.6), then emit its single outcome line — success → `p.log.success(outcome.summary)` (the interim `renderUpdateOutcomeSummary` `local-update` text `<key>: Refreshed from local path`), or the matching `formatMemberLine` line (Task 2.3, `name = full key`) for a failure/skip. No `p.spinner()` is started.
- For an **updatable group**: derive `oldCommits` = the updating members' installed `entry.commit` and `newCommit` = the resolved target commit; `label = groupLabel(group, groups)` (Task 2.1). Then:
  1. `const spin = p.spinner(); spin.start(formatGroupHeader({ label, oldCommits, newCommit }))` (Task 2.2). The spinner spins on this header through the clone — it does **not** tick per member.
  2. `const outcomes = await processGroupUpdate(...)` (Phase 1 Task 1.4) — clones once, reinstalls the updating members sequentially.
  3. Write the group's manifest (Phase 1 Task 1.6) **before** emitting any line — the `✓` must be honest (persisted before shown).
  4. `spin.stop(<header>)`, then emit outcomes:
     - **Attempted count === 1** (a standalone, or a collection with exactly one updating member): collapse to one line — success → `p.log.success(outcome.summary)` (interim `renderUpdateOutcomeSummary` `git-update` text `<memberKey>: Updated <oldShort> -> <newShort>`, the full member key preserving the `/member` suffix that distinguishes a single-updated collection member from a true standalone); failure/skip → `formatMemberLine` with `name = full member key`, dispatched via `p.log[level](text)`. No separate header line and no `(N members)`.
     - **Attempted count ≥ 2**: emit one `formatMemberLine` line per attempted member (in member order), `name = member basename` (`key.split("/").pop()`), passing `move` only when the group is divergent-old (Task 2.2's `distinct > 1`), dispatched via `p.log[level](text)`. Successes, failures (`✗`), and skips (`⚠`) all appear under the one header — the mixed-outcome self-contained block.
- Remove the interim per-plugin summary loop for actioned outcomes (`update.ts:588-609`): actioned statuses (`updated`/`refreshed`/`failed`/`copy-failed`/`aborted`/`blocked`/`skipped-no-agents`) now stream inline here; the loop is retained only for the non-actioned trailing categories (Task 2.5) and the footer (Task 2.7). Continue accumulating every member outcome into `outcomes[]` so `hasFailedOutcome` (`update.ts:618-631`) gates the exit unchanged. Leave the group-clone-failure rendering variant to Task 2.6.

**Acceptance Criteria**:
- [ ] Updatable groups and local entries stream in manifest (processing) order — updatable groups at their first member's index, local group-of-one lines interleaved at their own manifest positions.
- [ ] A standalone updatable group (member key `owner/repo`) collapses to one line `owner/repo: Updated <oldShort> -> <newShort>`; a collection group with exactly one updating member collapses to `owner/repo/member: Updated …`, keeping the `/member` suffix.
- [ ] An updatable group with ≥2 updating members emits the header (spinner) plus one `p.log.*` line per attempted member, all under the one header (mixed `✓`/`✗`/`⚠` in one block).
- [ ] A local entry emits its `Refreshed from local path` line with no `p.spinner()` call and no clone, interleaved at its manifest position.
- [ ] For each updatable group, `writeManifest` for that group is called before any `p.log.success` for that group's members (persistence-before-stream).
- [ ] The spinner's `message`/tick is not invoked per member during reinstall — one `start` on the header, one `stop` on completion.
- [ ] A non-updatable group (all members up-to-date/`newer-tags`/`constrained-no-match`, or `check-failed`) starts no `Updating` spinner and emits no streamed member line.

**Tests** (add to `tests/commands/update.test.ts`, overriding `vi.mocked(p.spinner).mockReturnValue(handle)` to capture `start`/`stop` and using a shared call-order array or `mock.invocationCallOrder` to assert write-before-success):
- `"streams updatable groups and local entries in manifest order"`
- `"collapses a standalone updatable group to one Updated line"`
- `"collapses a single updated collection member to one line keeping the /member suffix"`
- `"emits header + one member line per attempted member for a ≥2-member group (mixed success/failure/skip in one block)"`
- `"emits a local entry's Refreshed line with no spinner and no clone, interleaved at its manifest position"`
- `"writes the group's manifest before emitting that group's ✓ (persistence before stream)"`
- `"does not tick the spinner per member during reinstall"`
- `"starts no Updating spinner for a group whose members are all non-updatable"`

**Edge Cases**:
- Processing = manifest order; group-of-one standalone collapse; single updated collection member keeps `/member` suffix.
- Local group-of-one interleaved at manifest position; mixed-outcome group one self-contained block.
- `✓` streams only after the per-group manifest write; spinner does not tick per member.
- Non-updatable group emits no `Updating` spinner.

**Context**:
> *Outcome timing — emit-on-completion, stream inline* (spec): "Two phases: batched check, then streamed updates. All groups are resolved/checked up front under a single leading `Checking for updates…` spinner ... Only *updatable* groups then enter the streaming phase, each with its own `Updating <repo> v… → v… (N members)` spinner in deterministic processing order. **Processing order** = manifest order ... local group-of-one lines interleave at their own manifest positions ... A group whose check finds every member non-updatable ... never clones and never emits an `Updating` spinner ... **The spinner does NOT tick live per member during reinstall** ... then emits the per-member lines on completion." *Per-group manifest persistence before streaming*: "write the manifest **per group, right before streaming that group's ✓** — so the ✓ is honest (persisted before shown)." *Progress granularities* / *Local entries*: "A standalone unit is a group of one — its group header and single outcome collapse into one line"; a local entry "renders as a **group-of-one** line in the actioned stream — `✓ <key>: Refreshed from local path` ... with no clone spinner and no version move." *Partial collections & counts → Group-of-one collapse*: "a single updated member of a collection collapses to `✓ owner/repo/member: Updated…`; the `/member` suffix already distinguishes it from a true standalone." INTERIM CONSTRAINT: the collapsed one-line success reuses today's `renderUpdateOutcomeSummary` (hash-based) — Phase 3 rewords it to tags. Group-clone-failure rendering is Task 2.6.

**Spec Reference**: `.workflows/update-output-overhaul/specification/update-output-overhaul/specification.md` — *Per-Unit Progress Output → Progress granularities*, *Local entries*, *Outcome timing*, *Per-group manifest persistence before streaming*, *Partial collections & counts (Group-of-one collapse)*, *Testing & Acceptance* (acceptance 2, 5).

## update-output-overhaul-2-5 | approved

### Task 2.5: Collapse the trailing summary to one line per group per non-actioned category

**Problem**: The end-of-run summary must shrink to the non-actioned check categories only (`up-to-date`, `newer-tags`, `check-failed`, `constrained-no-match`) now that actioned outcomes stream inline (Task 2.4) — and each category must collapse to **one line per group**, or an exact-pinned 10-member collection re-emits 10 near-identical `newer-tags` lines: the wall this feature exists to kill, resurfacing in the trailing summary. Additionally, the all-mode `newer-tags` line today omits the `agntc add` command the single-key path includes.

**Solution**: Replace the per-key trailing collection and non-actioned summary emission (`update.ts:533-570`, and the non-actioned arms of `:588-609`) with per-group collapse: for each group, gather its non-actioned members by category and emit one group-labelled line per category — `up-to-date` count, `newer-tags` notice + repo-level `add` command, `check-failed` shared reason, `constrained-no-match` shared constraint — keyed by the grouping key so distinct-intent groups of one repo stay separate.

**Outcome**: The trailing summary carries at most one line per group per non-actioned category: `owner/repo: 7 up to date`, `owner/repo: Pinned to <ref> — newer tags available (latest: <newest>). To upgrade: npx agntc add owner/repo@<newest>`, `owner/repo: check failed — <reason>`, and `owner/repo: no tags satisfy <constraint> — left untouched`; two distinct-intent groups of one repo render as separate `@intent`-disambiguated lines; and a group with some updating members (streamed under its header, Task 2.4) and some up-to-date members renders those up-to-date members only as the collapsed count.

**Do**:
- In `src/update-render.ts`, add pure per-category formatters (each returns the line string):
  - `formatUpToDateLine(label, count)` → `` `${label}: ${count} up to date` ``.
  - `formatNewerTagsLine(label, pinnedRef, newestTag)` → `` `${label}: Pinned to ${pinnedRef} — newer tags available (latest: ${newestTag}). To upgrade: npx agntc add ${label}@${newestTag}` `` — today's all-mode notice (`update.ts:541`) collapsed per group, now including the **repo-level** `add` command (the acceptance-9 consistency fix). `label` is the *Group label* (Task 2.1); the command is `add <label>@<newest>` (repo-level: re-adds the collection/plugin at the pinned newest tag), mirroring the single-key path's `add <key>@<newest>` but at group granularity.
  - `formatCheckFailedLine(label, reason)` → `` `${label}: check failed — ${reason}` `` (the group's shared probe reason).
  - `formatConstrainedNoMatchLine(label, constraint)` → `` `${label}: no tags satisfy ${constraint} — left untouched` `` (the group's shared constraint).
- In `runAllUpdates`, after the streamed phase (Task 2.4), iterate groups in manifest order and, for each group, emit its collapsed non-actioned lines using `groupLabel(group, groups)`:
  - `up-to-date`: `count` = number of members categorized up-to-date (`up-to-date`/`constrained-up-to-date`) in this group — the genuine-state split means these are the members that did NOT stream under the header; emit `formatUpToDateLine` via `p.log.message` (today's level for up-to-date).
  - `newer-tags`: the group's members share one exact-pin intent, so one notice per group; take `newestTag` from the group's resolved target newer-tags list (Phase 1 Task 1.3, reverse-newest as `update.ts:536`), `pinnedRef` from the group's `versionIntent`; emit `formatNewerTagsLine` via `p.log.info`.
  - `check-failed`: a `check-failed` group (Phase 1 Task 1.8) collapses to one line — emit `formatCheckFailedLine(label, target.reason)` via `p.log.warn` (all-mode warns, exit 0).
  - `constrained-no-match`: one line per group — emit `formatConstrainedNoMatchLine(label, group.versionIntent)` via `p.log.warn`.
- Count-collapse, do not enumerate, for every non-actioned category: `check-failed` and `constrained-no-match` are group-level (one shared probe / one shared constraint), and `up-to-date`/`newer-tags` are group-uniform under group-first — one line per group each. (Clone-failure is the sole enumerating case — Task 2.6.)
- Preserve the "all up to date" short-circuit (`update.ts:572-585`): when no group was updatable and no local entry actioned, emit the existing `All plugins are up to date.` outro before the footer (Task 2.7). The `outcomes[]` exit accounting is untouched — this task changes only the *display* of the non-actioned categories.

**Acceptance Criteria**:
- [ ] A group with 7 up-to-date members collapses to one `owner/repo: 7 up to date` line (not 7 lines), keyed by the group.
- [ ] An exact-pinned collection with newer tags collapses to one `newer-tags` line per group, and that line includes `npx agntc add <label>@<newest>` (the repo-level command).
- [ ] A `check-failed` group collapses to one `owner/repo: check failed — <reason>` line carrying the shared probe reason (count-collapse, no per-member enumeration); all-mode exit stays 0.
- [ ] A `constrained-no-match` group collapses to one `owner/repo: no tags satisfy <constraint> — left untouched` line carrying the shared constraint.
- [ ] Two distinct-intent groups of one repo (e.g. `@^1.2.3` and `@v2.0.0`) each render their own trailing line, `@intent`-disambiguated by `groupLabel`.
- [ ] In a group with both updating and up-to-date members, the up-to-date members appear only as the collapsed count (they never streamed under the header — the behind-vs-current genuine-state split).

**Tests** (add to `tests/commands/update.test.ts` and `tests/update-render.test.ts`):
- `"collapses N up-to-date members of a group to one 'N up to date' line"`
- `"collapses newer-tags to one line per group including the repo-level agntc add command"`
- `"collapses a check-failed group to one line with the shared probe reason (exit 0)"`
- `"collapses a constrained-no-match group to one line with the shared constraint"`
- `"renders separate @intent-disambiguated trailing lines for two distinct-intent groups of one repo"`
- `"reports only the up-to-date members of a split group as the trailing count (behind members streamed, not counted here)"`

**Edge Cases**:
- up-to-date count-collapse; newer-tags one line per group (interim notice wording) + repo-level add command.
- check-failed count-collapse shared reason; constrained-no-match count-collapse shared constraint.
- distinct-intent groups of one repo → separate `@intent` lines.
- genuine-state split: behind members stream (Task 2.4) vs up-to-date members collapse trailing (here).

**Context**:
> *Partial collections & counts* (spec): "Trailing lines collapse to **one line per group** — keyed by the grouping key `(resolvedCloneUrl, versionIntent)`, *not* the bare repo — across *all* trailing categories: `up-to-date`, out-of-constraint, `newer-tags`, `check-failed`, and `constrained-no-match` ... `check-failed` and `constrained-no-match` are group-level results ... so they **count-collapse** rather than enumerate. ... Collapsed trailing formats: `up-to-date` → a count (`owner/repo: 7 up to date`); `newer-tags` → the pinned-ref notice plus the repo-level `add` command; ... `check-failed` → `owner/repo: check failed — <reason>` ...; `constrained-no-match` → `owner/repo: no tags satisfy <constraint> — left untouched`." *0.x-line + exact-pin edge cases*: "the all-mode `newer-tags` line (`update.ts:541`) currently says 'newer tags available (latest: X)' but omits the `agntc add` command ... Align it." "Command granularity for the collapsed line: ... its command is **repo-level** — `npx agntc add owner/repo@<newest>` ... The single-key path stays member/key-scoped." *Genuine-state splits*: behind members update inline; already-current members are up-to-date in the trailing summary. INTERIM: newer-tags keeps today's notice wording (it is already tag-based; no hash conflict), collapsed per group with the add command added — the out-of-constraint footer is Task 2.7 (structure only, Phase 4 rewords).

**Spec Reference**: `.workflows/update-output-overhaul/specification/update-output-overhaul/specification.md` — *Per-Unit Progress Output → Partial collections & counts*, *Outcome timing (End-of-run loop retained)*, *Safe-vs-Major Bump Gating → 0.x-line + exact-pin edge cases*, *Testing & Acceptance* (acceptance 4, 9).

## update-output-overhaul-2-6 | approved

### Task 2.6: Render a group clone failure as one enumerated grouped line

**Problem**: When a group's single clone fails, Phase 1 (Task 1.7) fans it into N `failed` outcomes for exit accounting — but rendering those N outcomes as N lines would reintroduce the "stack of identical anonymous lines" this feature exists to kill. A group-fatal clone failure must display as **one** line that names the affected members, while the underlying N-outcome model and non-zero exit stay exactly as Phase 1 built them.

**Solution**: Surface the clone-fatal condition from `processGroupUpdate` to the streaming layer (Task 2.4) and, when a group is clone-fatal, render one enumerated `p.log.error` line — `owner/repo: clone failed — affects N members: a, b, c` — instead of the header + per-member lines, leaving the N `failed` outcomes and exit accounting untouched.

**Outcome**: A group-fatal clone failure renders as a single enumerated line naming the affected member basenames; the model stays N `failed` outcomes (so `hasFailedOutcome` → non-zero exit is unchanged); no entries are removed; and a sibling group in the same run still streams and persists normally.

**Do**:
- Expose the clone-fatal condition to the render layer without changing Phase 1's N-outcome model. Extend `processGroupUpdate`'s return (Phase 1 Task 1.4/1.7) to an additive discriminated shape — `{ cloneFailed: true; reason: string; outcomes: PluginOutcome[] } | { cloneFailed: false; outcomes: PluginOutcome[] }` — where on clone failure `outcomes` is still the N `failed` outcomes Task 1.7 produces (one per attempted member, for exit accounting). Only the display reads `cloneFailed`; the model (N outcomes, exit) is unchanged.
- In `src/update-render.ts`, add pure `function formatCloneFailureLine(label: string, memberNames: string[]): string` returning `` `${label}: clone failed — affects ${memberNames.length} members: ${memberNames.join(", ")}` `` — a count *and* an enumeration of the affected member basenames.
- In the streaming loop (Task 2.4), for an updatable group whose `processGroupUpdate` result has `cloneFailed === true`: `spin.stop(<header>)`, then `p.log.error(formatCloneFailureLine(groupLabel(group, groups), attemptedBasenames))` — one line, in place of the header's member lines. `attemptedBasenames` = the updating members' `key.split("/").pop()`. Do NOT emit one line per member.
- Feed the N `failed` outcomes into `outcomes[]` (as Phase 1 already does) so `hasFailedOutcome` (`update.ts:618-631`) trips the non-zero exit; do not remove any entries (clone-failed mutates no manifest state — Phase 1 Task 1.7). A sibling group's streaming and per-group persistence are independent and continue.

**Acceptance Criteria**:
- [ ] A group-fatal clone failure renders exactly one `p.log.error` line, not N lines.
- [ ] The line enumerates the affected member basenames (`a, b, c`) alongside the count (`affects N members:`) — not a count alone.
- [ ] The N `failed` outcomes remain in `outcomes[]`; `hasFailedOutcome` returns true and `runAllUpdates` throws `ExitSignal(1)` (exit accounting unchanged from Phase 1).
- [ ] No `removeEntry`/`writeManifest` mutation occurs for the clone-failed group.
- [ ] A sibling updatable group in the same run still streams its member lines and writes its manifest.

**Tests** (add to `tests/commands/update.test.ts`, mocking `cloneSource` to reject for one group; and `tests/update-render.test.ts` for the pure formatter):
- `"formatCloneFailureLine enumerates member basenames with the affected count"`
- `"renders a group clone failure as one enumerated error line, not N lines"`
- `"keeps N failed outcomes in the model so the run exits non-zero (ExitSignal 1)"`
- `"mutates no manifest state for the clone-failed group"`
- `"a sibling group still streams and persists when another group's clone fails"`

**Edge Cases**:
- Enumerates members, not a bare count; one line, not N.
- Model stays N `failed` outcomes → non-zero exit unchanged.
- Sibling group still streams and persists (isolation across groups).

**Context**:
> *Clone-failure rendering* (spec): "A group-fatal clone failure ... renders as **one grouped line** under the group header — `owner/repo: clone failed — affects N members: a, b, c` — not N copies, so a group failure doesn't reintroduce the 'stack of identical anonymous lines' this feature exists to kill. The underlying model stays N `failed` outcomes for exit accounting; only the *display* groups." *Failure isolation & lifecycle → Clone failure (group-fatal)*: "No manifest mutation ... Exit accounting unchanged — N `failed` outcomes trip `hasFailedOutcome` → non-zero exit ... **Rendering** collapses to one grouped line ... The *model* stays N outcomes (for accounting); only the *display* groups." *Partial collections & counts*: "Clone-failure is the exception that **enumerates** members ... because the clone is the group's single fatal action and naming the affected members is the useful signal." The `cloneFailed` discriminator is an additive display signal over Phase 1 Task 1.7's N-outcome fan-out; it does not change the outcomes array or the exit.

**Spec Reference**: `.workflows/update-output-overhaul/specification/update-output-overhaul/specification.md` — *Per-Unit Progress Output → Clone-failure rendering*, *Per-Repo Clone Dedup → Failure isolation & lifecycle (Clone failure)*, *Partial collections & counts*, *Testing & Acceptance* (acceptance 6).

## update-output-overhaul-2-7 | approved

### Task 2.7: Collapse the out-of-constraint footer to one line per group (structure only)

**Problem**: `renderOutOfConstraintSection` (`summary.ts:294-306`) emits one line per key, so a major-available N-member collection (members sharing one intent) produces N near-identical footer lines — the "wall" this feature kills, reappearing in the footer. The footer must collapse to one line per group, keyed by the grouping key so two distinct-intent groups of one repo keep their own current→newer pairs — **restructuring only**, preserving today's passive wording verbatim.

**Solution**: Change the out-of-constraint footer to render one line per group using the *Group label* (Task 2.1), building per-group infos from the group targets' `latestOverall` and deduping so an N-member collection yields one footer line — while keeping the exact `Newer versions outside constraints:` header and `  <label>  <latestOverall> available (constraint: <constraint>)` line format unchanged.

**Outcome**: The out-of-constraint footer shows one line per group (label-disambiguated for multi-group repos) instead of one per member; a major-available collection collapses from N lines to one; two distinct-intent groups of one repo keep separate current→newer lines; today's passive wording is preserved verbatim (no re-add command, no current-version — those are Phase 4); and exit stays 0.

**Do**:
- In `src/summary.ts`, extend `OutOfConstraintInfo` (`:288-292`) with an optional `label?: string` (the Group label) and change `renderOutOfConstraintSection` to render `info.label ?? info.key` in the line — preserving the exact format verbatim: the `"Newer versions outside constraints:"` header and each line `` `  ${info.label ?? info.key}  ${info.latestOverall} available (constraint: ${info.constraint})` ``. The `?? info.key` fallback keeps the single-key path (`runSingleUpdate` → `renderOutOfConstraintOutput`, which populates `key` only) byte-identical.
- In `runAllUpdates`, replace the per-member out-of-constraint collection (`update.ts:457-468`) with a per-group build: for each constrained group whose resolved target carries a non-null `latestOverall` (Phase 1 Task 1.3 `GroupTarget.constrained.latestOverall`; `latestOverall !== null` ⟺ out of constraint, matching `hasOutOfConstraintVersion`, `update-check.ts:26-33`), push **one** info `{ label: groupLabel(group, groups), latestOverall: target.latestOverall, constraint: group.versionIntent! }`. One info per group — not per member — so a collection collapses to one footer line; two distinct-intent groups of one repo yield two infos with `@intent`-disambiguated labels.
- Preserve today's **passive** wording verbatim: this task changes structure (per-key → per-group) only. Do NOT add the post-bump current version, the actionable current→newer phrasing, or the mode-matched re-add command — those are Phase 4. The footer stays informative-opt-in: it does not feed `hasFailedOutcome`, so exit stays 0.
- Leave `renderOutOfConstraintOutput` (`update.ts:633-638`) emitting the lines via `p.log.info` unchanged.

**Acceptance Criteria**:
- [ ] A constrained N-member collection with an out-of-constraint version renders exactly one footer line (keyed by the group), not N.
- [ ] Two distinct-intent groups of one repo (e.g. `@^1.2.3` and `@^2.0.0`) render two separate footer lines, `@intent`-disambiguated by `groupLabel`.
- [ ] The footer line format is preserved verbatim: `Newer versions outside constraints:` header + `  <label>  <latestOverall> available (constraint: <constraint>)` — no re-add command, no current-version, no error styling.
- [ ] Exit stays 0 for an out-of-constraint situation (it does not feed `hasFailedOutcome`).
- [ ] The single-key path (`renderOutOfConstraintSection` with `key` only, no `label`) renders byte-identically to today (regression).

**Tests** (update `tests/summary-out-of-constraint.test.ts` and add to `tests/commands/update.test.ts`):
- `"renders one footer line per group for a constrained N-member collection (not N lines)"`
- `"renders separate @intent-disambiguated footer lines for two distinct-intent groups of one repo"`
- `"preserves the passive footer wording verbatim (no re-add command, no current version)"`
- `"out-of-constraint footer keeps the all-mode exit at 0"`
- `"single-key path with key-only infos renders byte-identically (regression)"`

**Edge Cases**:
- One line per group; two distinct-intent groups of one repo keep separate current→newer lines.
- Collection footer collapses to one line.
- Passive wording preserved verbatim; exit stays 0.
- Single-key `key`-only path unchanged (label fallback).

**Context**:
> *Safe-vs-Major Bump Gating → Blocking message* (spec): "The footer collapses per group, not per member. Today `renderOutOfConstraintSection` emits one line per key (`summary.ts:294-306`); a major-available N-member collection (members share intent) produces N near-identical actionable lines ... **Decision:** collapse to **one line per group** (the grouping key, using the *Group label*), reusing Part 1's grouping — never per bare repo, so two distinct-intent groups of one repo keep their own current→newer pairs." *Tone: informative opt-in, not an error* — "exit stays 0; it does not feed `hasFailedOutcome`." *Partial collections & counts*: the out-of-constraint footer is one of the trailing categories that collapse one line per group. HARD CONSTRAINT (Phase boundary): this task restructures the collapse only and preserves today's passive wording (`<latestOverall> available (constraint: <constraint>)`) verbatim — Phase 4 rewords the footer to the actionable, mode-matched, post-bump message (naming the post-bump current version and the re-add command). Do NOT encode any of that here.

**Spec Reference**: `.workflows/update-output-overhaul/specification/update-output-overhaul/specification.md` — *Safe-vs-Major Bump Gating → Blocking message (footer collapses per group)*, *Per-Unit Progress Output → Partial collections & counts*, *Testing & Acceptance* (acceptance 4, 8).
