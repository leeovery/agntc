# Richer `add` intro: banner + source / unit / description

Today `add` opens with a plain "agntc add" intro line — boring and uninformative.
Vercel's `skills` opens with an ASCII-art "SKILLS" banner, then a connected tree
showing **Source** (repo URL), **Repository cloned**, **Found N skills**, the
**Skill name**, and a **description pulled from the skill** (e.g. its frontmatter
`description`). It reads as a proper, branded intro.

Want to improve agntc's intro UI in the same spirit:
- An `agntc` ASCII-art banner (clack `intro`/`note` or a printed banner) at the top.
- After clone/detect, surface: source URL, what was detected (bare skill / plugin /
  collection + count), the unit name(s), and — where available — a description.
  - NOTE: agntc deliberately does **not** parse skill frontmatter today (identity =
    dir basename; see spec "Identity & Naming"). Pulling a `description` would mean
    reading `SKILL.md` frontmatter — a scoped, read-only addition just for display
    (not for identity/validation). Decide whether that's worth it or skip the
    description line.
- Keep it tasteful for agntc's small agent set (claude/codex/cursor) — do NOT mimic
  Vercel's 71-agent list.

Source: e2e-fixtures testing session (2026-06-09); user comparison screenshot of
`npx skills add kitlangton/stack`.
