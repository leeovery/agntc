# Richer `add` intro: surface source / unit / description after clone

The ASCII-banner half of this idea shipped (commit `abfe6c9` — `src/banner.ts`, shown on every command). What remains is the **post-clone information** part.

Today, after cloning, `add` jumps to the agent prompt with little context. Vercel's `skills` instead shows a connected tree — **Source** (repo URL), **Repository cloned**, **Found N skills**, the **unit name(s)**, and a **description pulled from the skill** — so the user can confirm they're installing the right thing before picking agents.

Want to surface, after clone/detect (around the agent prompt):
- The source URL.
- What was detected — bare skill / plugin / collection, plus member count for a collection.
- The unit name(s) about to be installed.
- Where available, a one-line description.
  - NOTE: agntc deliberately does **not** parse skill frontmatter today (identity = dir basename; see spec "Identity & Naming"). Pulling a `description` would mean reading `SKILL.md` frontmatter — a scoped, read-only addition just for display (not for identity/validation). Decide whether that's worth it, or skip the description line.
- Keep it tasteful for agntc's small agent set (claude/codex/cursor) — do NOT mimic Vercel's 71-agent list.

Source: e2e-fixtures testing session (2026-06-09); user comparison screenshot of `npx skills add kitlangton/stack`. Banner portion delivered 2026-06-10.
