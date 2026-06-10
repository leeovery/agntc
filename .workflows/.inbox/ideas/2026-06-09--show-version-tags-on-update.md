# Show version tags (not commit hashes) on update

`update` currently reports e.g. `Updated …: 6500f65 -> f395397` — commit hashes,
which installers usually don't recognise. When the repo is **tagged**, show the
semver tags instead: `Updated … from v1.2.3 to v1.3.0`. **Fall back to the short
commit hash only when there are no tags** (the untagged / HEAD-tracked case, where
a hash is the only meaningful identifier).

Also confirm / align the semver-gating UX (npm/Composer-style; some of this may
already exist):
- `npx agntc update` auto-applies **safe** bumps (patch + minor within the
  constraint's major) and shows the tag move.
- A **major** bump (or a minor bump on a `0.x` line) is **not** auto-applied —
  block it and tell the user to explicitly re-add (`agntc add owner/repo@<newer>`),
  naming the version it's at vs the newer one available.

Verify what's implemented today (constraint resolution, `list` out-of-constraint
display, `update` summary wording) and close the gap so update messaging speaks in
tags wherever tags exist.

Source: e2e-fixtures testing session (2026-06-09); user request. Worth doing at the
end of this session.
