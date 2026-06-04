# Research: Configless Install

Exploring how agntc can install any skill or collection from an arbitrary GitHub repo without requiring an `agntc.json` — auto-detecting repo shape, using disambiguating flags for the harder cases, and treating `agntc.json` as optional (possibly superseded).

## Starting Point

What we know so far:

- **Prompted by:** The user built agntc as an ergonomics-preferring alternative to the Vercel skills system (`npx skills add ...`). Vercel treats an `agents/` directory as source of truth and symlinks skills into the Claude dir. The user works Claude-Code-only, doesn't want an `agents/` directory, and deleting it broke the Vercel skills lock file — leaving several already-installed skills un-updatable. They want agntc to install from the same arbitrary GitHub repos the Vercel package can (e.g. `https://github.com/referodesign/refero_skill`, a single skill in a repo) — but against repos as they already exist.
- **Core constraint:** Skill owners can't be expected to ship agntc-specific config. agntc must work against repos that have no `agntc.json`.
- **Shape cues from discovery:**
  - Auto-assume the simple case — a standalone skill in a repo → install it directly.
  - Use flags to disambiguate the harder cases — a skill nested in a subdirectory; a repo that is a *collection* where multiple skills need selecting/installing.
  - Keep `agntc.json` but make it optional — possibly superseding it entirely if enough can be auto-assumed. Explicitly flagged as open, needing proper thought (deferred to discussion).
- **Starting direction:** Technical feasibility of auto-detecting repo shape without config; the auto-assume vs. flags vs. optional-config trade-offs.
- **Out of scope:** Reinstalling the user's lost skills is a separate operational task, not part of building this capability.

---
