# agntc terminal UI design

agntc's terminal output is @clack/prompts' timeline, the same look as Vercel's skills CLI. agntc gets a look of its own. Three mock-ups were compared on 2026-10-16 (sitrep sr-x0305g) and Lee picked **Tree**: output grouped by repo, the way agntc's entries already are. This doc settles that look and how it's built.

**Scope.** Only the interactive terminal changes. Machine mode stays byte for byte: every JSON document, warning, note and error string. Exit codes, command behaviour, the questions asked and the answers they take all stay. Wording stays too, except where a command printed inside a sentence moves to a line of its own.

**The frame.** There's no rail and no box. Every line has a one-space margin. A run opens with one header line: ` ■ agntc <command>` on the left, with the mark in the accent and `agntc` bold, and on the right, dim, where it installs (`global`, or the project root shortened to `~/…` and cut from the left when long) and `v<version>`. The layout is as wide as the terminal, at most 100 columns. Below 60, the header's right side and the prompts' key hints drop.

**Rows.** Each outcome is one row: a glyph, a bold subject, an optional dim meta column, then a detail. The glyph says what happened, and its shape carries the meaning without colour:

| Glyph | Colour | Meaning |
|---|---|---|
| ✓ | green | done: updated, installed, removed, refreshed, created |
| ○ | dim | nothing to do: up to date. The whole row is dim |
| ! | yellow | needs a look: not checked, kept, skipped, a warning |
| ✗ | red | not done: failed, not updated, an error |
| ● | accent | the subject of a question (what `remove` will remove) |
| ↑ | accent | a newer version (list) |
| · | dim | a note |

A version move reads `v0.2.4 →` dim, then `v0.2.5` bold. It's tags when both refs are tags and the ref moved, and short hashes otherwise, as `formatVersionMove` decides today.

**Blocks and trees.** Rows sit in a block whose columns are fixed when it opens, from every subject it will hold, so rows streamed in one at a time still line up. The subject column takes the widest subject plus 3, up to 45% of the width. A longer subject pushes its own detail to the next line, indented to the detail column. A row's children hang under it on dim `├─`/`└─` branches, each with a name and a detail in the same detail column. A detail wraps inside its column. Below 60 columns every detail goes on its own line under its subject.

**Commands are copyable.** Every `npx agntc …` line agntc prints sits on a line of its own: indented, in the accent, with nothing before it but spaces. agntc never truncates one, never wraps one itself, and never puts one on a line with prose or frame characters, so a triple-click copies it clean. Steps in sequence are listed in order. A choice between commands gets a dim `then one of` line of its own between the steps.

**Next.** Remedies don't interrupt the results. A row says what happened, and anything the reader can do about it goes to a **Next** section printed when the run closes. Each item has a bold subject, what it's for (`to update it anyway:`), then its commands. That covers an abort's remove and re-add, the out-of-constraint upgrade, the newer-tags pin, a copy failure's re-add, a stray's `--pack` line and a moved skill's candidates.

**Close.** A run with more than one outcome, or anything under Next, closes with Next, a dim rule across the layout width, then a tally: counts by outcome in a fixed order, each in its glyph's colour, joined by ` · `, with zero counts left out. The elapsed time sits dim on the right (`2.4s`, `1m 12s`). A run with a single outcome and nothing queued ends on that row. Every run ends one of these two ways, which fixes the ending of `update`'s all-mode, where the outro printed only when everything was up to date (q3jk). The tally categories:

- **update:** updated (updated, absorbed), refreshed, up to date (including pinned with newer tags), not checked (check failed, no tag in range), not updated (aborted, blocked), failed (copy failed, clone failed), removed (gone upstream), kept (gone upstream).
- **add:** installed, skipped, failed.
- **remove:** removed, failed.
- **list:** what the session changed (updated, version changed, removed), printed on leaving. Nothing prints when nothing changed.

**Progress.** A running step spins in its row's glyph slot: braille ⠁⠂⠄⡀⢀⠠⠐⠈ in the accent, 80 ms a frame, with a dim `updating to v0.2.5…`. When the step finishes, the line becomes the finished row and its children. Progress that ends without a row of its own (`Checking 6 repos…`, `Cloning leeovery/agentic-skills…`) clears, so no "Update checks complete." lines are left behind. A note or warning raised while a step runs prints under the row the step settles into. The cursor is hidden while a step spins and is restored on any exit, a signal included.

**Prompts.** They're drawn by agntc and run on @clack/core's prompt engine (raw mode, keys, cancel), not on @clack/prompts:

- **Layout.** A question line ` ? <question>` has the `?` in the accent, the question bold, and dim key hints on the right. Options sit under it, with hints dim in a column. A hint is truncated with `…` to fit the width; hints are descriptions, never commands.
- **Cursor.** The cursor row has an accent `▌` bar and a bold label. When the first prompt opens, agntc asks the terminal for its background colour (OSC 11) and waits up to 150 ms. If the terminal answers, the cursor row also gets a band of the accent mixed 22% into that background, which is right on light and dark themes alike. With no answer there's no band, and a late answer is swallowed, never read as keys.
- **Multiselect.** `●` marks a picked option and `○` an unpicked one; the footer reads `N of M picked`. Keys: ↑↓ or j/k move, space toggles, a toggles all, enter submits, esc or ctrl-c cancels.
- **Select.** A select can carry bold headings the cursor skips (list's repos). A long list scrolls in a window, with dim `↑ 3 more`/`↓ 5 more` lines.
- **Confirm.** Shows `Yes` and `No` as buttons. The chosen one is in the accent with dark text, the other dim. ← picks Yes, → picks No, tab switches, and y or n answers at once.
- **After answering.** A prompt erases itself on submit, and what follows reports the outcome: add's menu gives way to the installed tree, remove's confirm to the removed row. A cancel erases the prompt and prints ` ○ Cancelled` (or the caller's words).

**Colour.** Statuses use the terminal's own 16 colours, so the theme decides how they look. The one brand colour is the accent, violet `#A78BFA`: in truecolor where `COLORTERM` says so, as the nearest 256-colour where `TERM` says so, and magenta otherwise. Subjects are bold and metadata dim. `NO_COLOR` turns colour off and `FORCE_COLOR` turns it on. Meaning never rests on colour alone. agntc writes its own escape codes, so `picocolors` goes along with `@clack/prompts`.

**Banner.** The ASCII banner stays on help and bare `agntc`, recoloured in the accent: blocks in the accent, the shadow dim. Command runs print only the header.

**Per command:**
- **update:**
  - Each group is a row: repo, intent dim, then the move or `up to date`.
  - Members hang under a group that did something, with their kind and counts.
  - A group whose members ended differently shows each member's own glyph on its branch, and the group's glyph is the worst of them.
  - Members that moved key say `now keyed <new>` dim.
  - A local entry is its own row, under its home-shortened path.
  - A singleton update (one key, list's update, list's change version) is the same row.
- **add:**
  - The source is a row: key, ref, constraint, and on the right what it holds.
  - The menu sits under it. On submit the menu clears, and what installed hangs under the source row with kind and counts.
  - A skill taken from a pack carries its note as a dim child line.
  - `--list` prints the same source row with everything it holds as children, and no menu.
- **list:**
  - The dashboard is a select grouped by repo: each repo a heading, each entry a row with its name, kind dim, ref with its constraint dim, and status (`↑ v0.2.5`, `✓ up to date` dim, `✗ check failed`, `! newer tags`, `◇ local` dim).
  - The footer carries the key hints on the left and the counts on the right.
  - The detail view is an `●` row for the entry, then aligned dim labels with their values (version, constraint, commit, installed, what it installs), then the actions select.
- **remove:** the entry is an `●` row with its kind and counts, then its installed folders under a dim `.claude/skills/` (and agents and hooks under theirs), then the confirm.
- **init:** the type select, the files it will create as a tree, the confirm, then a `✓` row per file created.
- **Files in the way** (collision and unmanaged): a `!` row naming the entry, the files as dim children, then the select.
- **Errors:** `ui.fail` prints ` ✗ <message>` with the message bold and its cause dim on the next line, after any Next items queued so far.

**The Ui surface.** Every word and prompt still goes through `Ui`, but it describes what the output means rather than how clack draws it:

- **Methods:**
  - `header`;
  - a `block` of rows, with `row` and `task` (a row that spins until it settles);
  - `next`, which queues a remedy;
  - `close`, given the tally;
  - `cancel`;
  - `warn`, `note` and `fail`, each given a `Message`;
  - the three prompts.
- **Messages.** A `Message` is text plus an optional remedy. The remedy has a lead (`To update it anyway:`) and steps, each a command, a choice of commands, or words. The builders that write commands into sentences today return Messages: `buildAbortMessage`, the stray notice, `upgradeAdvice`, the newer-tags line, a copy failure's recovery and the moved-skill candidates.
- **Machine mode.** It flattens a Message back to today's sentence, which is what keeps every document byte for byte.
- **What goes.** `log.*`, `intro`, `outro`, `box` and `spinner` go once nothing calls them.

**Testing:**
- **Commands.** Tests stop mocking `@clack/prompts`. A recording `Ui` takes the calls and scripted answers, so command tests assert what was said, not how it was drawn.
- **Renderer.** Pure functions from rows, messages and tallies to lines, tested at widths 40, 80 and 100 with colour off, plus exact escape codes for each element with colour on.
- **Prompts.** Driven through @clack/core's input and output streams, asserting each frame and the value returned.
- **Golden runs.** A handful render whole runs (update with mixed outcomes, add through the menu, list, remove, a failure) at width 100 with colour off and compare against expected text, so the look can't drift unnoticed.
- **Machine mode.** The document tests stay as they are and must pass unchanged.

**Out of scope:** an ASCII fallback for terminals without Unicode, colour settings, a `--no-color` flag (`NO_COLOR` covers it), and rewording messages beyond moving commands onto their own lines.

## Build

A stack of three PRs, each reviewed at `/code-review high` as it's ready, and the whole change at `xhigh` before marking ready:

1. **Tests observe a recording Ui.** The 23 test files that mock `@clack/prompts` move to a recording `Ui` with today's surface. No behaviour changes, and every test keeps what it asserts. This runs in parallel with 2a.
2. **The terminal renderer**, built under `src/terminal/` and not yet wired in.
   - **2a.** Colour levels and the palette; visible width (escape codes ignored, wide characters as two) and wrapping; the renderers for header, rows, trees, messages and remedies, Next, close, cancel and errors; the task spinner.
   - **2b.** The prompts on @clack/core, with the OSC 11 band. This is an xhigh slice: raw-mode input and late replies.
3. **The switch.**
   - **3a.** The new Ui surface, the terminal Ui behind `interactiveUi`, machine mode flattening Messages, the banner off command runs and recoloured, and `@clack/prompts` and `picocolors` dropped. Until each command moves over, `log.*` draws as plain glyph rows.
   - **Then one slice per command,** in this order:
     - update, which fixes q3jk;
     - add;
     - list, with its detail view and actions;
     - remove, init, and the files-in-the-way prompts.
   - **Last,** the old methods go and CLAUDE.md describes the new surface.
