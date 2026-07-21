# Plan: Update Output Overhaul

## Phases

### Phase 1: Group-first update engine and clone/check dedup
status: approved
approved_at: 2026-07-21

**Goal**: Reshape all-mode `update` (`runAllUpdates`) from per-member clone-and-check into a group-first pipeline — group non-local manifest entries by `(resolvedCloneUrl, versionIntent = constraint ?? ref)`, resolve/check once per group, clone once per updatable group via a new `cloneRepoOnce` plus a group orchestrator, and reinstall members from the shared clone — with correct per-member outcomes, failure isolation, lifecycle, and per-group manifest persistence, while the three singleton entry points (`update <key>`, list update, list change-version) stay on the existing `cloneAndReinstall` path.

**Why this order**: The dedup ownership seam reshapes `processUpdateForAll` and the per-member outcome model that the tag-wording and gating-message rewords later build on. Per the spec's seam-first build order this structural pivot must land first — doing the wording first and then refactoring the same call site for dedup would rewrite the wording work. It also establishes the grouped model that every later phase renders and messages over.

**Acceptance**:
- [ ] Non-local entries are grouped by `(resolvedCloneUrl, versionIntent = constraint ?? ref)` in a single pre-check pass; a caret group excludes the mutating `ref`, so a singly-updated constrained member stays grouped with its behind siblings; local entries (`commit === null`) are excluded from grouping.
- [ ] Distinct intents for the same repo form separate groups (`@^1` vs `@^2`, branch vs caret, exact-pin vs caret resolving to the same tag); the key uses `deriveCloneUrlFromKey` so a legacy (`cloneUrl === null`) entry and an explicit-URL entry for the same repo collapse into one group.
- [ ] Each group runs exactly one check/resolve probe and, when updatable, exactly one clone at the group's effective ref (stored `ref` for unconstrained, resolved target tag for constrained via `newRef` override); members are categorized against that single shared target using each member's own installed commit, so genuine-state splits are preserved (a member already at target reports up-to-date while behind siblings update).
- [ ] The orchestrator clones once via `cloneRepoOnce`, loops members through `runPipeline` with `cloneRoot = sharedTempDir` and `sourceDir = resolveUpdateSourceDir(...)`, runs the per-member `assertSubpathWithinClone` containment guard for each member, reinstalls members sequentially each wrapped in its own try/catch, and cleans up the shared temp dir once in a `finally` wrapping the whole member loop.
- [ ] Model-level failure isolation holds: a group-fatal clone failure yields N `failed` outcomes (one per member key, no entries removed, trips `hasFailedOutcome` → non-zero exit); a group-level check/resolve failure yields N `check-failed` outcomes (no clone, no manifest mutation, all-mode exit 0); per-member `copy-failed`/`aborted`/`blocked`/`no-agents` stay isolated to that member with today's remove-vs-intact semantics unchanged.
- [ ] The manifest is persisted per group, and `outcomes[]` is still collected to drive the `hasFailedOutcome` exit code.
- [ ] The three singleton entry points remain on `cloneAndReinstall`; existing `update` regression tests stay green.

#### Tasks
status: approved
approved_at: 2026-07-21

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| update-output-overhaul-1-1 | Group non-local manifest entries by (resolvedCloneUrl, versionIntent) | caret group excludes mutating ref (singly-updated member stays grouped), distinct intents split (@^1 vs @^2, branch vs caret, exact-pin vs caret-to-same-tag), legacy null-cloneUrl + explicit-URL collapse via deriveCloneUrlFromKey, HEAD-tracked ref===null, local entries (commit===null) excluded |
| update-output-overhaul-1-2 | Extract cloneRepoOnce clone primitive from cloneAndReinstall | clone failure surfaces as clone-failed signal (cloneSource retries 3x, throw is final), accepts explicit ref override (constrained resolved-tag), singleton regression stays green |
| update-output-overhaul-1-3 | Per-group resolve/check once and categorize members against the shared target | constrained group resolves target tag once (newRef override), genuine-state split (member at target up-to-date while behind sibling updates), branch/HEAD members at divergent commits advance to one resolved HEAD, exact-pin vs caret never keyed on resolved commit |
| update-output-overhaul-1-4 | Group orchestrator: clone once, reinstall members sequentially with isolation | per-member assertSubpathWithinClone guard (path-traversal preservation), per-member try/catch contains throws (siblings continue), cleanupTempDir once in finally wrapping whole loop, copy-safety boundary unchanged (cloneRoot = whole clone), sourceDir via resolveUpdateSourceDir |
| update-output-overhaul-1-5 | Wire runAllUpdates group-first (replace per-member check/categorize loops) | local group-of-one reinstalls (excluded from grouping), three singleton entry points stay on cloneAndReinstall, existing regression tests green, interim output functional (old per-clone spinner gone from grouped path) |
| update-output-overhaul-1-6 | Per-group manifest persistence with per-member remove-vs-intact semantics | N groups → N writes, copy-failed removes its entry, aborted/blocked/no-agents/skipped left intact, interrupt leaves manifest matching disk at group boundaries, outcomes[] still drives hasFailedOutcome |
| update-output-overhaul-1-7 | Clone-fatal fan-out: group clone failure → N failed outcomes | no manifest mutation (no removals), N failed outcomes trip hasFailedOutcome (non-zero exit), throw is final (retry internal), model stays N outcomes (display grouping deferred to Phase 2) |
| update-output-overhaul-1-8 | Check/resolve-fatal fan-out: group probe failure → N check-failed outcomes | no clone runs, no manifest mutation, all-mode exit 0 (excluded from hasFailedOutcome), per-key attribution for trailing summary |

### Phase 2: Per-unit progress stream and trailing collapse
status: approved
approved_at: 2026-07-21

**Goal**: Replace the interim output with the designed two-granularity stream over Phase 1's grouped shape — a batched `Checking for updates…` phase (per-group probes parallel across distinct repos), then per-group `Updating <repo> v… → v… (N members)` spinners streamed in manifest processing order, each emitting persistent per-member outcome lines on completion — with the end-of-run summary reduced to non-actioned categories plus the out-of-constraint footer, each collapsed to one line per group.

**Why this order**: The progress stream is the display over Phase 1's grouped model — it cannot be designed until the group/member shape and per-group timing exist (the orchestrator has removed the old per-clone spinner from the grouped path), and it must exist before Phase 3's tag wording can render the version move on the group header. It converts the dedup's structural win into the legible output that motivates the feature.

**Acceptance**:
- [ ] Updatable groups stream in manifest processing order, each under a group header carrying the *Group label*, the `(N members)` attempted count (fixed when the spinner starts), and the shared version move; a standalone unit and a single updated collection member collapse to one line; a local entry renders as a group-of-one `Refreshed from local path` line interleaved at its manifest position.
- [ ] Each attempted member renders its own line beneath the header at the matching log level: success `✓ member → agents`; `copy-failed`/`aborted`/`blocked` as `✗` errors (abort carrying its recorded-type + remove/add remedy inline); `no-agents` as a `⚠` skip; a mixed-outcome group is one self-contained block under its header.
- [ ] Version-move placement follows the shared-old vs divergent-old rule: shared old ref → header shows `old → new`; divergent olds → header shows the resolved target only and every updating member carries its own `old → new` parenthetical; the dropped-agents "support removed by author" notice rides the member line, sharing the parenthetical when a move is also present.
- [ ] Actioned outcomes emit on group completion; the trailing summary is reduced to `up-to-date`, `newer-tags`, `check-failed`, `constrained-no-match`, plus the out-of-constraint footer, each collapsed to one line per group keyed by the grouping key (the *Group label* disambiguating multiple groups of one repo).
- [ ] A group-fatal clone failure renders as one grouped enumerated line (`owner/repo: clone failed — affects N members: a, b, c`); `check-failed` and `constrained-no-match` count-collapse to one group line; Phase 1's N-outcome model and exit accounting are unchanged (only the display groups).
- [ ] The streamed group success appears only after that group's per-group manifest write; an interrupt leaves the manifest matching disk at group boundaries (the mid-member nuke-and-reinstall window is the pre-existing SIGINT gap, out of scope).

#### Tasks
status: approved
approved_at: 2026-07-21

| Internal ID | Name | Edge Cases |
|-------------|------|------------|
| update-output-overhaul-2-1 | Add group-label helper with @intent disambiguation | single-group repo → bare label, multi-group repo → @intent, HEAD-tracked group → @HEAD sentinel, caret/branch/exact-pin intent forms |
| update-output-overhaul-2-2 | Format group header: label, member count, shared-vs-divergent version move | shared old → header old→new, divergent olds → header target-only, up-to-date siblings excluded from count and old-set, (N members) fixed at spinner start over attempted set, interim hash move (Phase 3 rewords tags) |
| update-output-overhaul-2-3 | Format per-member outcome lines: glyphs, agents, move parenthetical, dropped-agents | success ✓ member → agents, divergent-old success carries own (old → new), dropped-agents suffix on member line, move + dropped share one parenthetical, copy-failed ✗ recovery hint, aborted ✗ recorded-type + remove/add remedy inline, blocked ✗ copy-safety message no remedy, no-agents ⚠ skip |
| update-output-overhaul-2-4 | Stream the actioned phase — batched check then per-group Updating spinner emitting member lines | processing = manifest order, group-of-one standalone collapse, single updated collection member keeps /member suffix, local group-of-one interleaved at manifest position, mixed-outcome group one self-contained block, ✓ streams only after per-group manifest write, spinner does not tick per member, non-updatable group emits no Updating spinner |
| update-output-overhaul-2-5 | Collapse the trailing summary to one line per group per non-actioned category | up-to-date count-collapse, newer-tags one line per group (interim wording), check-failed count-collapse shared reason, constrained-no-match count-collapse shared constraint, distinct-intent groups of one repo → separate @intent lines, genuine-state split (behind stream vs current trailing) |
| update-output-overhaul-2-6 | Render a group clone failure as one enumerated grouped line | enumerates members not a count, one line not N, model stays N failed outcomes → non-zero exit unchanged, sibling group still streams and persists |
| update-output-overhaul-2-7 | Collapse the out-of-constraint footer to one line per group (structure) | one line per group, two distinct-intent groups of one repo keep separate current→newer lines, collection footer collapses to one line, passive wording preserved + exit stays 0 |

### Phase 3: Tag-based summary wording
status: approved
approved_at: 2026-07-21

**Goal**: Render the version move in semver tags where the repo is genuinely tagged and the ref actually moved, with a short-hash fallback for the untagged / HEAD-tracked / branch case, applied identically to the single-key surface (`renderGitUpdateSummary`) and the all-mode grouped surface (`renderUpdateOutcomeSummary` / group header).

**Why this order**: This rewords the outcome/header version move built on Phase 1's new outcome construction and Phase 2's group header; per the seam-first build order it layers onto the stable construction rather than being rewritten by it, and it touches both surfaces together so wording cannot drift.

**Acceptance**:
- [ ] The move renders in tags only when both old and new refs parse as genuine semver tags (`isVersionTag`, `clean()`-based) AND the ref actually moved (`oldRef !== newRef`); otherwise it falls back to short commit hashes.
- [ ] Edge cases hold: a `v4` branch (not full semver via `clean()`) falls to hashes; a branch literally named `v4.0.0` whose only the commit moved falls to hashes (ref name unchanged); a constrained update `v1.2.3 → v1.3.0` renders in tags.
- [ ] The old ref sources from the pre-update `entry.ref` and the new ref from the post-update resolved ref (`result.manifestEntry.ref` / `result.tag`); the rule is applied identically on the single-key and all-mode surfaces so wording cannot diverge.

### Phase 4: Safe-vs-major bump gating messaging
status: approved
approved_at: 2026-07-21

**Goal**: Upgrade the gating surface from passive to actionable without changing any gating behaviour — the out-of-constraint footer becomes an actionable, mode-matched, per-group re-add directive naming the post-bump current version and the newest available; align the all-mode `newer-tags` line with the single-key command; and keep the exit posture unchanged and explicit.

**Why this order**: This is pure messaging over gating logic that already works via caret semantics; it reuses Phase 1's grouping (per-group footer collapse) and Phase 2's trailing-collapse structure, and depends on Phase 3's tag wording to name versions consistently. It closes the feature by making the constraint boundary legible.

**Acceptance**:
- [ ] The out-of-constraint footer renders as an actionable line (informative tone, no error styling, exit stays 0) naming the current-vs-newer versions and the exact re-add command; the current version is the post-bump entry version (threaded into `OutOfConstraintInfo`), consistent with the inline `Updated` line when a safe bump ran the same run.
- [ ] The re-add command preserves the user's pinning mode: a constrained/caret user gets bare `npx agntc add owner/repo`; an exact-pin user gets `npx agntc add <key>@<newest>`.
- [ ] The footer collapses to one line per group (grouping key / *Group label*), never per bare repo, so two distinct-intent groups of one repo keep their own current→newer pairs.
- [ ] The all-mode `newer-tags` line includes the repo-level `npx agntc add owner/repo@<newest>` command, matching single-key (which stays member/key-scoped `npx agntc add <key>@<newest>`); its trailing line collapses per group.
- [ ] Exit-code posture is unchanged and explicit: single-key exits 1 on `check-failed` / `constrained-no-match`; all-mode warns and exits 0 for those; only `aborted` / `blocked` / `failed` / `copy-failed` trip a non-zero all-mode exit.
