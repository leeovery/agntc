# Investigation: Update Check Fails On Branch Ref

## Symptoms

### Problem Description

**Expected behavior:**
A source installed cleanly with `agntc add` from a branch ref (e.g. a GitHub
tree URL like `https://github.com/nuxt/ui/tree/v4/skills/nuxt-ui`, where `v4` is
a long-lived version **branch**, not a tag) should also be update-checkable and
updatable/removable without error. Invariant: **"installed fine ⇒ should
update/remove fine."**

**Actual behavior:**
`add` resolved `v4` against the remote, found the branch (`refs/heads/v4`), and
recorded `ref: "v4"` with the branch-tip commit and no `constraint`.
`update`/`list` instead treat the stored ref as a semver tag and do a
tag-existence lookup, which fails. The entry is **permanently un-updatable**
across every update/list surface — but the *severity* differs by path (confirmed
by synthesis validation):

- `agntc update <key>` (single) — **hard non-zero error**: logs
  `Update check failed for <key>: Tag 'v4' not found on remote` and exits 1
  (`update.ts:141`).
- `agntc update` (all) — **non-fatal loud warning**: emits the exact reported
  string `nuxt/ui/skills/nuxt-ui: Check failed — Tag 'v4' not found on remote`
  via `p.log.warn`; `check-failed` is excluded from `hasFailedOutcome`, so the
  command does **not** exit non-zero (`update.ts:597-603`, `623-631`).
- `agntc list` — permanent `✗ check failed` in the update-status column every
  run; detail view is degraded and the "change version" action is disabled
  (`list-detail.ts:133`).

Either way the source is stranded: it installs fine but can never resolve to a
real update status.

### Manifestation

Error surfaced on both `update` and the `list` update-status column:

```
nuxt/ui/skills/nuxt-ui: Check failed — Tag 'v4' not found on remote
```

### Reproduction Steps

1. `agntc add https://github.com/nuxt/ui/tree/v4/skills/nuxt-ui`
   (on the `nuxt/ui` remote, `v4` is `refs/heads/v4`; the repo's tags are
   `v4.9.0`, `v4.8.2`, `v4.7.1`, … — there is no tag literally named `v4`)
2. Install succeeds — skill lands locally, manifest entry written with
   `ref: "v4"`, `commit: 08bdab4…` (branch tip), and **no** `constraint`
3. Run `agntc update` (or `agntc list`)
4. Observe: `Check failed — Tag 'v4' not found on remote`

**Reproducibility:** Always (for any source pinned to a branch rather than a
semver tag)

### Environment

- **Affected environments:** local CLI (all)
- **User conditions:** manifest entry whose `ref` is a branch name, not a
  semver tag; typically no `constraint` recorded (contrast the working entry
  `leeovery/agentic-skills/nuxt`, pinned to the real tag `v0.1.4` with a
  `constraint`)

### Impact

- **Severity:** Medium — no data loss, but the entry is permanently
  un-updatable and emits a loud recurring error
- **Scope:** any source distributed from a long-lived version branch (e.g.
  nuxt/ui ships its skill from `skills/nuxt-ui/` on the `v4` branch)
- **Business impact:** breaks the core invariant that anything installable is
  serviceable; erodes trust via a persistent "Check failed" on every `list`

### References

- Seed: `.workflows/update-check-fails-on-branch-ref/seeds/2026-07-01-update-check-fails-on-branch-ref.md`
- Discovery: `.workflows/update-check-fails-on-branch-ref/discovery/session-001.md`
- Relevant areas flagged in discovery: `src/update-check.ts`,
  `src/version-resolve.ts`, `src/git-utils.ts`, `ManifestEntry` in
  `src/manifest.ts`

---

## Analysis

### Initial Hypotheses

Central open question left by discovery, deliberately unresolved to avoid
biasing the trace: **did `add` record the ref wrongly, or is `update`/`list`
mis-resolving a perfectly valid branch ref?** Either way the shape is an
internal-consistency defect: `add`'s ref resolution and `update`'s tag lookup
disagree about what a `ref` is.

### Code Trace

**Answer to the open question:** `add` recorded the ref **correctly**. It is
`update`/`list` that mis-resolves a perfectly valid branch ref. Trace below.

**`add` side (correct):** For the tree URL, `parseSource` sets `ref = "v4"`,
`constraint = null`. `resolveTagConstraint` (`src/commands/add.ts:150`) only
fetches tags / derives a constraint in two branches — bare add (`ref === null &&
constraint === null`) or explicit constraint (`constraint != null`). With an
explicit non-null `ref` and null `constraint`, **neither branch runs**: no tag
lookup, no constraint. Result recorded: `ref: "v4"`, `commit: <branch tip>`,
`constraint: undefined`. That is exactly what the `version-constraints` routing
table prescribes for "constraint absent + branch ref → track branch HEAD".

**Install works because clone is ref-type-agnostic:** `cloneSource`
(`src/git-clone.ts:34-38`) runs `git clone --depth 1 --branch <ref> …`. `git
clone --branch` resolves **either** a branch **or** a tag, so `--branch v4`
checks out the `v4` branch tip with no complaint. The same path is reused by
reinstall (`src/clone-reinstall.ts:327-340` → `cloneSource`), so a branch ref
re-clones fine on update too.

**`update`/`list` side (the bug):** Both route through `checkForUpdate`
(`src/update-check.ts:57`; callers: `update-check-all.ts:18`, `list.ts:123`,
`update.ts:131/413`). Dispatch logic:

1. `src/update-check.ts:67` — `entry.constraint === undefined` → skip
   `checkConstrained`.
2. `src/update-check.ts:71` — `entry.ref === "v4"` (not null) → skip `checkHead`.
3. `src/update-check.ts:75` — `isTagRef("v4")` → **`true`** → route to `checkTag`.
   ← **misroute**
4. `checkTag` (`src/update-check.ts:135`) fetches `ls-remote --tags`, maps to
   tag names, calls `findNewerTags(allTags, "v4")`. No tag is literally named
   `v4` (tags are `v4.9.0`, `v4.8.2`, …), so `allTags.indexOf("v4") === -1` →
   `findNewerTags` returns `null` → `checkTag` returns
   `{ status: "check-failed", reason: "Tag 'v4' not found on remote" }`.

The misroute is `isTagRef` (`src/update-check.ts:39`): a purely lexical
heuristic `/^v?\d/`. `v4` starts with `v` + a digit, so it matches and is
classified as a semver tag. Had it routed to `checkBranch`
(`src/update-check.ts:106`), the lookup `ls-remote refs/heads/v4` would have
found the branch and compared commits correctly.

**Two divergent ref-type classifiers already exist in the codebase:**

| Ref | `isTagRef` (`/^v?\d/`, update-check.ts) | `isVersionTag` (`semver.clean(ref)!==null`, version-resolve.ts:30) |
|-----|:--:|:--:|
| `v4` (branch) | **true** (wrong) | **false** (right) |
| `v4.0` | true | false |
| `4` | true | false |
| `v4.9.0` (tag) | true | true |
| `main` / `dev` | false | false |

`isVersionTag` (used by `list-detail.ts:133`) requires a *complete* semver and
correctly rejects `v4`; `checkForUpdate` uses the cruder `isTagRef` instead. The
two disagree precisely on `v4`.

### Root Cause

`checkForUpdate` classifies a stored `ref` as tag-vs-branch using the lexical
heuristic `isTagRef` (`/^v?\d/`, `src/update-check.ts:39`). The branch name `v4`
matches this pattern, so the ref is misrouted to `checkTag`, which performs an
exact tag-existence lookup. No tag literally named `v4` exists on the remote, so
the check throws `Tag 'v4' not found on remote` and the entry can never resolve
to a real update status.

**Why this happens:** The **install/clone path is ref-type-agnostic** (`git
clone --branch` resolves branch or tag), but the **update-check path is
ref-type-sensitive** and pre-classifies the ref by string shape before choosing
a type-specific remote lookup. For a branch whose name lexically resembles a
version tag (`v4`), the classifier picks the tag lookup, which cannot succeed.
`add` and `update` "disagree about what a ref is" exactly here: git resolution
(agnostic) vs `isTagRef` (lexical).

### Contributing Factors

- **Ref-type is inferred, never recorded.** `ManifestEntry` stores `ref`,
  `commit`, optional `constraint` — but no `refType`. Nothing captures whether
  `add` resolved a branch or a tag, so `update` must guess from the string.
- **Asymmetric resolution strategies.** Install resolves refs by *asking git*
  (`git clone --branch`, agnostic); update-check resolves them by *pattern-
  matching the string* then doing a type-specific `ls-remote`. The two can
  disagree whenever a name is ambiguous.
- **A branch name that lexically resembles a version tag** (`v4`). Not exotic —
  distributing a skill from a long-lived major-version branch (`v4`, `v3`) is a
  common upstream pattern (nuxt/ui does exactly this).
- **Two divergent classifiers coexist.** The stricter, more-correct
  `isVersionTag` (semver-clean) already exists and is used elsewhere
  (`list-detail.ts`), but `checkForUpdate` uses the cruder `isTagRef` regex.

### Why It Wasn't Caught

- **No test covers a branch ref whose name matches `/^v?\d/`.** Tests likely
  exercise real semver tags (`v1.2.3`) and clearly-branch names (`main`,
  `dev`), missing the "looks like a tag, is a branch" middle case.
- **The `constraint`-based routing added later** (version-constraints work)
  layered a new path in front of the legacy tag/branch split without
  revisiting the `isTagRef` heuristic that governs the unconstrained branch.
- **The heuristic's own comment flags only the *opposite* failure** (tags with
  a non-`v`/non-numeric prefix like `release-1.0`), not the branch-looks-like-
  tag case that actually bites here.

### Blast Radius

**Directly affected:**
- `agntc update <key>` (single) — any entry whose `ref` is a branch matching
  `/^v?\d/` with no `constraint`: **hard non-zero error**, never updates.
- `agntc update` (all) — same entries: **non-fatal loud warning** (does not exit
  non-zero), never updates.
- `agntc list` — permanent "Check failed" in the update-status column every run;
  detail view degraded, "change version" action disabled (`list-detail.ts:133`).

**Potentially affected:**
- Any branch ref that lexically parses as a (partial) version: `v4`, `v3`, `4`,
  `v4.0`, `2024` (date-branch), etc. — all misrouted to `checkTag`.
- Symmetric latent bug: a real **tag** whose name does *not* match `/^v?\d/`
  (e.g. `release-1.0`, `stable`) is misrouted to `checkBranch` and would fail
  its `refs/heads/…` lookup — the same lexical heuristic failing the other way
  (the code's own comment calls this out).
- `remove` is unaffected (no ref resolution); the "installed fine ⇒ remove fine"
  half of the invariant holds. Only the update/check half is broken.

---

## Fix Direction

### Chosen Approach

**Option 2 — Resolve ref type from remote truth.** On check, stop guessing the
ref's type from its string shape. Use `ls-remote` to determine whether the
stored `ref` exists as `refs/heads/{ref}` (branch) or `refs/tags/{ref}` (tag)
on the remote, and dispatch to the branch- vs tag-comparison path based on what
actually exists. For a repo where both a branch and a tag share the name,
define a deterministic tiebreak (mirror git's own ref-resolution precedence) —
to be nailed down in the specification.

**Deciding factor:** It is the only option that makes `update` *know* the ref
type rather than guess it, and it does so **without a manifest migration**. The
user's explicit priority (twice stated) was that update should reliably tell a
branch from a tag rather than infer from the string. Remote-truth delivers that
and, as a bonus, fixes the **symmetric latent bug** (a real tag whose name
doesn't match `/^v?\d/`, e.g. `release-1.0`, currently misrouted to
`checkBranch`) in the same stroke. Because `update`/`list` already contact the
remote via `ls-remote` in both `checkTag` and `checkBranch`, classifying from
that same fetch is close to free.

### Options Explored

1. **Guess better — swap `isTagRef` for the stricter `isVersionTag`
   (semver-clean).** Smallest change; reuses an existing, already-correct helper
   (`version-resolve.ts:30`, used in `list-detail.ts`). `v4` → not a full semver
   → routed to `checkBranch` → works; also removes the duplicate-heuristic
   drift. **Why not chosen:** still a lexical guess — rides on naming convention.
   A repo shipping a literal bare-major *tag* `v4` would now be misread as a
   branch (`Branch 'v4' not found`), and it does **not** fix the symmetric
   `release-1.0`-tag case (orthogonal — routes to `checkBranch` before and after
   the swap). Retained as the **fallback quick-patch** if a one-line fix is ever
   wanted ahead of the fuller change.
2. **Resolve ref type from remote truth.** — *Chosen (see above).*
3. **Record `refType` in the manifest at `add` time** (`"branch" | "tag"`),
   authoritatively, from what git resolved; `update` reads it. Most robust at
   *classification* time. **Why not chosen:** biggest change — new manifest field
   plus a backfill story for legacy entries written before the field existed
   (which would still need a remote check or a guess on first update). It also
   buys little over Option 2 here: `update` must contact the remote to check for
   updates anyway, so a stored `refType` saves no network at check time. Noted
   as a possible future enhancement, not required to fix this bug.

### Discussion

Journey notes from the review:

- Discovery's open question — *did `add` record the ref wrongly, or is
  `update`/`list` mis-resolving a valid branch ref?* — resolved firmly to the
  latter. `add` records `ref:"v4"` faithfully (it's the user's stated intent:
  track the `v4` branch); the defect is entirely in `update`/`list`
  classification.
- The user pushed on **"how will update tell the difference between a tag and a
  branch when the branch is called `v4`?"** twice. The honest answer — *from the
  string alone it can't; any lexical rule is a guess* — is what steered the
  decision away from Option 1 (guess better) toward Option 2 (know via the
  remote). This was the pivot of the discussion.
- Synthesis validation corrected a severity-framing overstatement (the
  `update`-all path is a loud non-fatal warning, not a hard non-zero exit; the
  hard exit is confined to single-key `update <key>`). It does not change the
  fix — permanent un-updatability holds across every surface.

### Testing Recommendations

- **Add: branch ref whose name matches `/^v?\d/`** (the missing middle case).
  A `v4`-style branch install should update-check as a branch (compare
  `refs/heads/v4` tip), not fail with a tag error. This is the direct
  regression guard.
- **Add: real semver tag** (`v4.9.0`) still classifies and checks as a tag
  (guard against the remote-truth change breaking the tag path).
- **Add: symmetric case — a tag whose name does not match `/^v?\d/`**
  (`release-1.0`) checks as a tag, not a branch. Confirms Option 2 clears the
  latent bug.
- **Consider: both a branch and a tag with the same name** — asserts the chosen
  tiebreak behaves deterministically.
- Prefer to exercise the classification via the real `ls-remote` path where the
  harness allows, since the whole bug is the disagreement between lexical guess
  and remote reality.

### Risk Assessment

- **Fix complexity:** Medium. Reshapes the dispatch in `checkForUpdate`
  (`update-check.ts`); no manifest or `add`-side changes.
- **Regression risk:** Low–Medium. The tag and branch comparison paths already
  exist and are unchanged; only the *routing decision* between them changes,
  plus the new both-exist tiebreak. Constrained and `checkHead` paths are
  untouched.
- **Recommended approach:** Regular release. No hotfix urgency — the bug is a
  loud warning + degraded `list`, not data loss; `remove` and constrained
  installs are unaffected.

---

## Notes

- Parked / out of scope: Vercel `skills` CLI shorthand compatibility
  (`npx skills add nuxt/ui` resolving to the right subpath) — a separate,
  pre-existing inbox idea (`vercel-skills-cli-compatibility`).
