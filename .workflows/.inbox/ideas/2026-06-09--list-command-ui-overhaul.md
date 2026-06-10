# `list` command UI overhaul

Three rough edges in `list` (the management dashboard), to redesign:

1. **Detail view "Agents" section is cluttered/redundant.** Today, after selecting
   a plugin, the `ref / commit / installed / agents` bullets are fine, but the
   agents block then repeats itself: an `Agents: claude, codex, cursor` line, then
   per-agent `claude: 1 skill(s)` / `codex: 1 skill(s)` lines, then the install
   paths listed separately. Collapse this into one tight, non-repetitive block
   (e.g. agents + per-agent counts on one line each, or a single summary line; drop
   the redundant agents-list + standalone path dump, or fold paths in compactly).

2. **"Done" is a fake plugin in the select list.** The "Select a plugin to manage"
   menu lists installed plugins plus a `Done` option — but `Done` isn't a plugin;
   it's a lazy way to add an exit. Find a proper UI affordance (check what clack
   0.11 offers — `select` cancel/Esc handling, a separate confirm, footer hint,
   etc.) so exiting isn't a pseudo-entry in the list.

3. **The status string is lazy / hard to read.** Pre-update it showed
   `^1.0 → v1.1.0 (✓ Up to date (v2.0.0 available outside constraint))` — nested
   parens, cramped. Improve: likely a second, indented, grey sub-line of
   "additional data" under the entry — but ALWAYS shown (not toggle-revealed on
   up/down), because it's important. Alternatively reconsider whether per-entry
   update status belongs in the *selection* list at all (you're picking a plugin to
   manage) vs. only in the detail view. Decide and make it read cleanly.

General: this is a UI/UX pass on `list` — look up the clack 0.11 primitives
available (note, select, groupMultiselect, etc.) and pick the right ones rather
than hand-rolling.

Source: e2e-fixtures testing session (2026-06-09); user feedback. To do at end of
session ("let's take a look at improving this command").
