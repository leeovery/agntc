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

_(to be filled during code analysis)_

### Root Cause

_(to be filled)_

---

## Fix Direction

_(to be filled during findings review)_

---

## Notes

- Parked / out of scope: Vercel `skills` CLI shorthand compatibility
  (`npx skills add nuxt/ui` resolving to the right subpath) — a separate,
  pre-existing inbox idea (`vercel-skills-cli-compatibility`).
