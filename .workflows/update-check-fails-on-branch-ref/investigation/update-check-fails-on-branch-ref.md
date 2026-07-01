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
`agntc update` and `agntc list` fail with a hard error for the branch-pinned
entry. `add` resolved `v4` against the remote, found the branch
(`refs/heads/v4`), and recorded `ref: "v4"` with the branch-tip commit and no
`constraint`. `update`/`list` instead treat the stored ref as a semver tag and
do a tag-existence lookup, which throws. Any branch-pinned source is stranded:
it installs fine but is permanently un-updatable and surfaces a loud "Check
failed" every run.

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

---

## Fix Direction

_(to be filled during findings review)_

---

## Notes

- Parked / out of scope: Vercel `skills` CLI shorthand compatibility
  (`npx skills add nuxt/ui` resolving to the right subpath) — a separate,
  pre-existing inbox idea (`vercel-skills-cli-compatibility`).
