# Discovery Session 001

Date: 2026-10-05
Work unit: vercel-skills-compatibility

## Description (as of session)

Make agntc a like-for-like replacement for Vercel's skills CLI — anything built for their skills library installs through agntc (same source formats and flags, unattended installs, a pre-install summary) — without breaking agntc's own plugin bundling, and fixing the partially-done paths along the way (e.g. update's re-add advice dropping `--plugin`).

## Seed

- seeds/2026-06-09-non-interactive-install-flags.md (inbox:idea)
- seeds/2026-06-09-vercel-skills-cli-compatibility.md (inbox:idea)
- seeds/2026-06-09-add-post-clone-unit-info.md (inbox:idea)

## Imports

(none)

## Map State at Start

(n/a — single-topic work)

## Exploration

Three inbox ideas were pulled together as one working set: non-interactive install flags (`--yes`, `--agents`, collection member selection so installs can run unattended), Vercel Skills CLI compatibility (drop-in `npx skills add` → `npx agntc add`, audit their surface and produce a compatibility matrix), and a richer post-clone `add` intro (source, detected type, unit names, optional description). The validation bucket and the member-select wording idea were considered and left out — validation is separate, though two strands of it will surface during this work (Vercel rejects a skill whose frontmatter lacks `name` + `description`, so the compatibility contract must take a position on accepting repos Vercel would refuse; and unattended installs remove the last human look before hook scripts land). Member-select wording stays in the inbox as quick-fix material.

The owner wants it shipped as one thing. The core intent: use agntc to install skills built for Vercel's skills library directly into Claude Code (and the other agents), while still working with agntc's own formats and systems — in particular the `--plugin` feature, which bundles a skills-only source as one unit. That bundling is something Vercel's CLI does not do and is the reason agntc exists; the owner has used it to install a large set of skills by one author that are meant to be installed individually via Vercel's CLI.

A related defect rides along: when updating something installed with `--plugin`, the update path suggests a re-add (the out-of-constraint advice) but the suggested command omits `--plugin`, so following it fails. The owner flagged they may have the exact behaviour slightly wrong — to be verified when the work reaches it. They consider it part of this work rather than a separate bugfix.

Scope as framed by the owner: add the features missing for a like-for-like feature set with Vercel's CLI, without breaking what agntc already has, and fix anything partially done along the way. The unattended flags and the post-clone summary are both parts of Vercel's `add` surface, so they sit inside the compatibility surface rather than as separate deliverables.

Shape read: a single feature. The cue that would reshape it — if the audit of Vercel's CLI turns up whole capabilities agntc has no equivalent for (e.g. installing once for every project rather than per project, or searching their directory), it becomes several connected pieces and should be re-shaped then. The owner also mentioned possible extra work that might be roadmapped for later rather than ride along; nothing specific beyond the `--plugin` re-add defect was named.

## Edits

(none)

## Topics Identified

(none)

## Conclusion

Routed to research.
