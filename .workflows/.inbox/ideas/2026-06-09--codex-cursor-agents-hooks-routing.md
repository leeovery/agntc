# Route `agents/` and `hooks/` to Codex and Cursor (stale routing table)

agntc's asset-routing table currently sends **agents** and **hooks** to Claude **only** — codex/cursor get a dash. That was correct when written but is now stale: as of mid-2026 both Codex and Cursor support project-local agents *and* hooks. Skills are already routed correctly for all three (`.claude/skills/`, `.agents/skills/`, `.cursor/skills/`).

**Verified directory conventions (mid-2026, official docs):**

| Asset | Claude | Codex | Cursor |
|---|---|---|---|
| skills (done ✅) | `.claude/skills/` | `.agents/skills/` | `.cursor/skills/` |
| agents | `.claude/agents/*.md` | `.codex/agents/*.toml` | `.cursor/agents/*.md` |
| hooks | `.claude/hooks/` | `.codex/hooks.json` (or `[hooks]` in `.codex/config.toml`) | `.cursor/hooks.json` + `.cursor/hooks/` |

Sources: cursor.com/docs/skills · /subagents · /hooks · changelog 1-7 (hooks, Sep 2025) & 2-4 (skills+subagents, Jan 2026); developers.openai.com/codex/skills · /subagents · /hooks · /concepts/customization. (Codex skills ~Dec 2025, agents/hooks early–mid 2026.)

**Scope decision (per owner):** agntc is *pure routing* — it is NOT responsible for translating between formats. The skill/plugin **author** ships the appropriate file(s) per agent; agntc's only job is to copy the right file into the right location when present. So this feature is about **directory routing**, not format conversion.

**What that implies for the design — open questions to settle in spec:**
- The asset formats differ per agent (Claude/Cursor agents are markdown; Codex agents are TOML; hooks are config-file merges for Codex/Cursor, a script dir for Claude). Since agntc won't translate, the source must express *which file targets which agent*. **How does an author declare that in the source tree?** e.g. per-agent subdirs (`agents/claude/…`, `agents/codex/…`, `agents/cursor/…`), or filename/extension convention (`*.toml` → codex), or a manifest in the asset dir. Needs a convention.
- **Hooks aren't drop-in for Codex/Cursor** — they're a `hooks.json` / `config.toml [hooks]` entry plus referenced scripts. Routing a hook means *merging* into an existing config file, not copying a dir. Codex additionally gates hooks on the project `.codex/` layer being "trusted." Decide whether agntc does the merge, and how it handles an existing user config.
- **Codex splits across two top-level dirs:** skills → `.agents/skills/`, but agents+hooks → `.codex/`. The driver's `getTargetDir` must reflect that split.
- **Cursor compat reads:** Cursor explicitly reads `.claude/` and `.codex/` compat paths for skills+agents, so a Claude agent may already be picked up by Cursor with no agntc work — factor this in before duplicating files.

**Interaction with the configless/UX work (context):**
- Today an assets-only plugin (agents+hooks, no skills) installed for codex/cursor copies nothing for them. The interim UX fix (`formatPluginSummary` shows selected-but-empty agents as "nothing to install (no compatible files)" rather than silently dropping them) is a stopgap. When this routing lands, those agents start receiving files and the note disappears on its own.
- The manifest deliberately still records all selected agents (incl. ones that received zero files) — so once routing expands and an author ships codex/cursor files, a plain `update` (which replays recorded agents) delivers them with no re-add. Don't "fix" that by pruning empty agents from the manifest.

**Relevant files:** `src/drivers/codex.ts`, `src/drivers/cursor.ts` (`getTargetDir`), `src/copy-plugin-assets.ts` (asset-dir copy), `src/drivers/identify.ts` (ownership/counts), routing table in `CLAUDE.md`. Update the asset-routing table in `CLAUDE.md` when shipped.
