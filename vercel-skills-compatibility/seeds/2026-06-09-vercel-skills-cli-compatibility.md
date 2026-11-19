# Vercel Skills CLI compatibility (drop-in `skills` → `agntc`)

Goal: make agntc **cross-compatible** with Vercel's `skills` CLI so that installing
anything from their directory is just swapping the binary —
`npx skills add owner/repo` → `npx agntc add owner/repo` — with the same source
formats, flags, and behaviour producing an equivalent install.

Work involved:
- **Audit the Vercel Skills CLI surface**: its `add` (and other) commands, flags
  /options, source-string formats, selectors, and install semantics (their
  `discoverSkills` one-level-into-`skills/` model, agent targeting, etc.).
- **Map to agntc**: for each Vercel flag/behaviour, decide — already supported,
  add an alias, add the feature, or document a deliberate divergence. Produce a
  compatibility matrix.
- Cover the headline case: any repo in their directory installs cleanly via agntc.
  (We already share a lot — tagless→HEAD, dir-basename identity, skills-only →
  menu. This is about closing the remaining flag/format gaps.)
- Relates to the non-interactive flags idea (some Vercel flags may be the same
  ones) — design together.

This is research + feature work → run through the workflow pipeline (research the
Vercel surface → spec the compatibility contract → plan → implement).

Source: e2e-fixtures testing session (2026-06-09); user idea — "make our system
completely cross-compatible with theirs."
