# Discovery Session 001

Date: 2026-07-01
Work unit: update-check-fails-on-branch-ref

## Description (as of session)

update and list fail with a Tag-not-found error for a source installed from a branch ref (a GitHub tree URL); add records the branch tip fine, but the update path treats the stored ref as a semver tag.

## Seed

- seeds/2026-07-01-update-check-fails-on-branch-ref.md (inbox:bug)

## Imports

(none)

## Map State at Start

(n/a — single-topic work)

## Exploration

Origin is an inbox bug: a skill installed cleanly with `agntc add` cannot be
update-checked and reports a hard error on both `update` and `list`. The
concrete case is `nuxt/ui/skills/nuxt-ui`, installed from the GitHub tree URL
`https://github.com/nuxt/ui/tree/v4/skills/nuxt-ui`. On the `nuxt/ui` remote,
`v4` is a long-lived version **branch** (`refs/heads/v4`), not a tag — the repo
tags are `v4.9.0`, `v4.8.2`, etc. `add` resolved `v4` against the remote, found
the branch, and recorded `ref: "v4"` with the branch-tip commit and no
`constraint`. `update`/`list` instead treat the stored ref as a semver tag and
do a tag-existence lookup, which throws `Tag 'v4' not found on remote`. So any
source pinned to a branch is stranded: it installs fine but is permanently
un-updatable and surfaces a loud "Check failed" every run.

Shaping widened the lens, then settled it. The user first wondered whether the
long advertised GitHub path meant this was really about *how install works*, and
later whether it was simply user error — they lifted the URL from nuxt's
advertised `claude skill add` command and fed it to `agntc add` instead of using
the `npx skills add nuxt/ui` shorthand also shown on the docs page. Conclusion
reached together: it's still a bug, independent of "which URL is better," because
agntc accepted the source, installed it, and wrote a manifest it then cannot
service — an internal-consistency defect where `add`'s ref resolution and
`update`'s tag lookup disagree about what a `ref` is. The invariant is
"installed fine ⇒ should update/remove fine."

The central open question — *did `add` record the ref wrongly, or is `update`/`list`
mis-resolving a perfectly valid branch ref?* — was deliberately left unresolved:
it is the investigation phase's opening thread, and guessing now would bias it.
Either way the shape is the same: something that should work doesn't, with a root
cause to trace across `update-check.ts`, `version-resolve.ts`, `git-utils.ts`,
and the `ManifestEntry` shape in `manifest.ts`. Hence bugfix → investigation.

Parked, not folded in: Vercel `skills` CLI shorthand compatibility
(`npx skills add nuxt/ui` resolving to the right subpath). It's a separate,
pre-existing inbox idea (`vercel-skills-cli-compatibility`); bare `agntc add
nuxt/ui` resolves as owner/repo at repo root and would miss the `skills/nuxt-ui`
subpath, so it's a genuine but distinct gap.

## Edits

(none)

## Topics Identified

(none)

## Conclusion

Routed to investigation.
