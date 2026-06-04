# Discovery Session 001

Date: 2026-06-04
Work unit: configless-install

## Description (as of session)

Install any skill or collection from an arbitrary GitHub repo without requiring an agntc.json — auto-detection plus disambiguating flags, with agntc.json optional.

## Seed

(none)

## Imports

(none)

## Map State at Start

(n/a — single-topic work)

## Exploration

The user built agntc as an alternative to the Vercel skills system (`npx skills add ...`), preferring its ergonomics. A core dislike of the Vercel system: it treats an `agents/` directory as the source of truth and symlinks skills into the Claude directory. The user only uses Claude Code, so they don't want an `agents/` directory at all — they had been deleting it, which inadvertently removed the skills lock file and broke updating. This left several already-installed skills (a TypeScript-management set in this project; Go-related skills in the Portal and Tick projects) un-updatable.

The work the user wants to build: let agntc install any skill or collection sourced from an arbitrary GitHub repo — the same repos the Vercel skills package can install from (e.g. `https://github.com/referodesign/refero_skill`, which is just a single skill in a repo) — but without forcing the skill owner to ship an `agntc.json` config. Skill owners can't be expected to add agntc-specific config, so agntc needs to work against repos as they already exist.

Shape cues that emerged: agntc would auto-assume the simple case (a standalone skill → install it directly), and use flags to disambiguate the harder cases — e.g. pointing at a skill nested in a directory, or marking a repo as a collection where multiple skills need selecting/installing. The user floated keeping `agntc.json` but making it optional, possibly superseding it entirely if enough can be auto-assumed — explicitly flagged as open for discussion and needing proper thought.

All facets (auto-detection of repo shape, flags for standalone/directory/collection, optional config) cluster around one install-flow capability rather than splitting into independently shippable pieces. Confirmed with the user as one focused capability → feature. The *how* (auto-assume vs flags vs optional config trade-offs) was deliberately deferred to the discussion phase.

A tangential operational task surfaced — reinstalling the skills the user lost when they deleted their `agents/` directory — noted as separate from building this capability, not folded into scope.

## Edits

(none)

## Topics Identified

(none)

## Conclusion

Routed to research.
