# agntc terminal UI design

agntc's terminal output is @clack/prompts' timeline, the same look as Vercel's skills CLI. agntc gets a look of its own. Three mock-ups were compared on 2026-10-16 (sitrep sr-x0305g) and Lee picked **Tree**: output grouped by repo, the way agntc's entries already are. This doc settles that look and how it's built.

**Scope.** Only the interactive terminal changes. Machine mode stays byte for byte: every JSON document, warning, note and error string. Exit codes, command behaviour, the questions asked and the answers they take all stay. Wording stays too, except where a command printed inside a sentence moves to a line of its own, and where a question or outcome is reworded because the row above it now names its subject.

**The frame.** There's no rail and no box. Every line has a one-space margin. A run opens with one header line: ` ■ agntc <command>` on the left, with the mark in the accent and `agntc` bold, and never the command's argument. On the right, dim, is `<where> · v<version>`, where being the scope: `global`, or the project root shortened to `~/…`. Short of room, the right side gives way in order: where is cut from the left, then dropped, keeping the version; below 60 columns nothing shows there. A dev build has no version. The layout is as wide as the terminal, between 20 and 100 columns, and 80 when the terminal gives none. Below 60, the header's right side and the prompts' key hints drop.

**Rows.** Each outcome is one row: a glyph, a bold subject, an optional dim meta column, then a detail. The glyph says what happened, and its shape carries the meaning without colour:

| Glyph | Colour | Meaning |
|---|---|---|
| ✓ | green | done: updated, installed, removed, refreshed, created |
| ○ | dim | nothing to do: up to date, already there (init), cancelled, add's source stopped before anything was copied, `No skills or packs installed.` The whole row is dim |
| ! | yellow | needs a look: not checked, kept, skipped, a warning |
| ✗ | red | not done: failed, not updated, an error |
| ● | accent | the subject of a question: what `remove` will remove, what `init` will create, the entry list's detail view manages |
| ↑ | accent | a newer version (list) |
| ◇ | dim | a local entry (list) |
| · | dim | a note, as a row or as a child (add's `already installed as part of the pack …`) |

**States and outcomes.** list's dashboard shows each entry's state: `✓ up to date` dim, glyph and all, `↑ <version>`, `! newer tags`, `✗ check failed`, `✗ no matching version`, `◇ local` dim. Its detail view's status field agrees with them. update's rows are outcomes: up to date is `○`, and so is a pin with newer tags, counted up to date, with its line under Next; a check that failed is `! not checked`. A run with a key that fails its check or finds no matching tag draws `✗`, as it exits 1; all-mode keeps `!` and exits 0.

A version move reads `v0.2.4 →` dim, then `v0.2.5` bold. It's tags when both refs are tags and the ref moved, and short hashes otherwise, as `formatVersionMove` decides today.

**Blocks and trees.** Rows sit in a block whose columns are fixed when it opens, from every subject it will hold, so rows streamed in one at a time still line up. The subject column takes the widest subject plus 3, up to 45% of the width. A longer subject pushes its own detail to the next line, indented to the detail column. A row's children hang under it on dim `├─`/`└─` branches, each with a name and a detail in the same detail column. A child's aside leads its detail, as an option's leads its hint (see Prompts), and the subject column is sized from names alone. A detail wraps inside its column. Below 60 columns every detail goes on its own line under its subject. Rows in a block print in the order they settle.

**Wrapping.** Every line but a command stays inside the width less one column, plain-string messages included: they wrap as rich ones do, and a failure's first line is bold with the rest dim. A word too long for its line breaks after a `/` where it can, and not before a `/` or a `,`. A count never ends a line apart from its noun, nor a `…` apart from its count: `1 hook` and `… 3 more skills` stay together. Together wider than a line, they break between their words, never inside one.

**Commands are copyable.** Every `npx agntc …` line agntc prints sits on a line of its own: indented, in the accent, with nothing before it but spaces. agntc never truncates one, never wraps one itself, and never puts one on a line with prose or frame characters, so a triple-click copies it clean. Steps in sequence are listed in order. A choice between commands gets a dim `then one of` line of its own between the steps (`one of` when the choice comes first).

**Next.** Remedies don't interrupt the results. A row says what happened, and anything the reader can do about it goes to a **Next** section printed when the run closes. Each item reads `<subject> — <lead>`: the subject bold, then what it's for running on from the dash (`— to update it anyway:`), then its commands. Where the row says less than the message, the lead opens with the message's own sentence. An item may have no subject, as list's `To get started:` when nothing is installed. A local entry's subject is its folder shortened to `~/…`, as its row names it; its commands keep the folder whole. That covers an abort's remove and re-add, the out-of-constraint upgrade, the newer-tags pin, a copy failure's re-add, a stray's `--pack` line and a moved skill's candidates.

**Close.** A run with more than one outcome, or one outcome and anything under Next, closes with Next, a dim rule across the layout width, then a tally: counts by outcome in a fixed order, each in its glyph's colour, joined by `  ·  `, with zero counts left out. The elapsed time sits dim on the right (`2.4s`, `1m 12s`). A run with no outcome but something under Next ends on Next alone, with no rule or tally: `add --list`, a cancelled add with strays, list after an aborted action. A run with a single outcome and nothing queued ends on that row. Every run ends one of these ways, which fixes the ending of `update`'s all-mode, where the outro printed only when everything was up to date (q3jk). The tally categories:

- **update:** updated (updated, absorbed), refreshed, up to date (including pinned with newer tags), not checked (check failed, no tag in range), not updated (aborted, blocked), failed (copy failed, clone failed), removed (gone upstream), kept (gone upstream).
- **add:** installed, skipped, failed. The source is its row's to name, so the tally doesn't repeat it.
- **remove:** removed, failed.
- **list:** what the session changed (updated, version changed, removed). Each change prints its row as it happens; the tally prints on leaving only when there was more than one change, and nothing prints when nothing changed.
- **init:** created, already there.

**Progress.** A running step spins in its row's glyph slot: braille ⠁⠂⠄⡀⢀⠠⠐⠈ in the accent, 80 ms a frame, with a dim `updating to v0.2.5…`. Its text is lowercase: `checking for updates…`, `checking N entries for updates…`, `checking <key> for updates…`, `cloning <key>…`, `copying…`, `refreshing…`, `fetching the versions of <key>…`, `updating to <ref>…`. A progress line is always one line: too long for it, its subject is cut from the left and its meta dropped first, its text keeping at least half the room. When the step finishes, the line becomes the finished row and its children. Progress that ends without a row of its own (`checking for updates…`, `cloning leeovery/agentic-skills…`) clears, so no "Update checks complete." lines are left behind. A note or warning raised while a step runs prints under the row the step settles into. The cursor is hidden while a step spins and is restored on any exit, a signal included.

**Signals.** A terminal run owns SIGINT, SIGTERM and SIGTSTP. An interrupt anywhere, spinning, asking or between steps, prints what was held and the Next items, then ` ○ Cancelled`, restores the terminal and exits 130 or 143. It prints no rule and no tally: a signal isn't a close. A signal that arrives after the run has printed its ending (close, cancel or failure) only restores the terminal and exits. A cancel prints the Next items first, then its `○ Cancelled` line, as a failure does. Ctrl-Z stops the whole process group (npx's `sh -c` chain included), shows the cursor, and redraws on `fg`. At a spinner with no prompt open it writes only the show-cursor sequence, so a shell that has already printed its prompt keeps it.

**Prompts.** They're drawn by agntc and run on @clack/core's prompt engine (raw mode, keys, cancel), not on @clack/prompts:

- **Layout.** A question line ` ? <question>` has the `?` in the accent, the question bold, and dim key hints on the right, three spaces apart (`↑↓ move   ⏎ done   esc cancel`). Enter reads `⏎ choose` in a select, `⏎ done` in a multiselect and `⏎ manage` on list's dashboard; where esc goes back (list's detail and its selects) it reads `esc back`. Options sit under it, with hints dim in a column. Where two options share a name, each carries an aside: the folder it sits in, dim, leading the hint column, then ` · ` and the hint (`○ testing   skills/frontend · Generic testing advice`). It never widens a column: labels are sized from names alone. Short of room, the hint is cut first, then the aside from its start, so the folder nearest the name stays; it goes whenever fewer than three columns are left for it, however short, so twins lose theirs together. Where keeping a label its 10 columns leaves the hint column no room, the hint goes but the aside stays, two columns past the label cut to its 10. A column with nothing in any of its cells takes no room, not even its gap. Labels and headings are cut from the left with `…`, and a label keeps 10 columns before the hints or cells beside it go. A hint is truncated with `…` to fit the width; hints are descriptions, never commands.
- **Cursor.** The cursor row has an accent `▌` bar and a bold label. At 256 colours or more, before the first prompt opens, agntc asks the terminal for its background colour (OSC 11) and waits up to 150 ms; the answer settles before the prompt exists. If the terminal answers, the cursor row also gets a band of the accent mixed 22% into that background, which is right on light and dark themes alike. With no answer, or fewer colours, there's no band, and a late answer is swallowed, never read as keys.
- **Multiselect.** `●` marks a picked option and `○` an unpicked one; the footer reads `N of M picked`. Keys: ↑↓ or j/k move, space toggles, a toggles all, enter submits, esc or ctrl-c cancels. A required multiselect holds enter back until something is picked.
- **Select.** A select can carry bold headings the cursor skips (list's repos). A long list scrolls in a window, with dim `↑ 3 more`/`↓ 5 more` lines.
- **Confirm.** Shows `Yes` and `No` as buttons on the question line, or on a line of their own when the question wraps. The chosen one is in the accent with dark text, the other dim; without colour the chosen one is bracketed. ← picks Yes, → picks No, tab switches, and y or n answers at once.
- **A question about a row.** A block's select, confirm and multiselect draw the row they ask about above the question and erase it with the question. The row is fitted to the room by whole children, with a dim `… N more <noun>` counting what it leaves out. It always names its subject, a one-line head being the last resort. Several rows end with a `… N more entries` line at the rows' level. The options keep their share of the screen first.
- **After answering.** A prompt erases itself on submit, and what follows reports the outcome in its place: add's menu gives way to the installed tree, remove's confirm to the removed row. A cancel erases the prompt and prints ` ○ Cancelled` (or the caller's words).

**Colour.** Statuses use the terminal's own 16 colours, so the theme decides how they look. The one brand colour is the accent, violet `#A78BFA`: in truecolor where `COLORTERM` says so, as the nearest 256-colour where `TERM` says so, and magenta otherwise. Subjects are bold and metadata dim. `NO_COLOR` turns colour off and `FORCE_COLOR` turns it on. Meaning never rests on colour alone. agntc writes its own escape codes, so `picocolors` goes along with `@clack/prompts`.

**Banner.** The ASCII banner stays on help and bare `agntc`, recoloured in the accent: blocks in the accent, the shadow dim. Command runs print only the header.

**Per command:**
- **update:**
  - Each group is a row: repo, intent dim, then the move or `up to date`.
  - Members hang under a group that did something, with their kind and counts. Members a pack absorbed show as its children, once, under a local pack's row too.
  - A group whose members ended differently shows each member's own glyph on its branch, and the group's glyph is the worst of them.
  - Members that moved key say `now keyed <new>` dim.
  - A skill a pack took over, when the pack's copy fails after it removed that skill, reads `✗` on its branch and counts as failed.
  - A local entry is its own row, under its home-shortened path.
  - A singleton update (one key, list's update, list's change version) is the same row as all-mode, except that a key's left-alone row keeps its member child, as its reinstalled row does. All-mode's and a prefix key's left-alone group rows have no children.
  - Rows word what was a sentence: `no tags satisfy ^9.0.0`, `not checked · <cause>`, `kept — it's gone upstream; …`. The "Everything is up to date." line is gone, as the rows say it.
  - Gone upstream is asked under a `!` row naming the entry, its kind and counts and its folders: `Remove it and its 9 skills and 2 folders?`.
- **add:**
  - The source is a row: key, ref and constraint dim, and in the detail column what it holds.
  - The menu sits under it, the row `✓` while the menu is up. Each item is named by its folder, as update and list name it, packs first then loose skills, each in path order; where two items share a name, each carries the folder it sits in as its aside, leading the hint. A pack is counted as its installed row counts it: `pack · 2 skills, 1 folder, 1 agent, 1 hook`. What installed is named the same way, its asides leading the detail, told apart only from what the row itself shows. On submit the menu clears, the row reads `N of M installed`, and what installed hangs under it with kind and counts. A cancelled menu redraws the row as `○`, then prints ` ○ Cancelled — nothing selected`; when a stray left a line under Next, Next prints first.
  - Every stop after the source is read draws the row once: `○` before the copy, `✗` after it.
  - A skill taken from a pack carries its note as a second detail line, shown only once it has installed.
  - What was cleared out of an item's way shows under it: `removed <entry>, whose files were in the way: …`, or `replaced files agntc didn't install: …`. Names are compact, with `and N more` after the first three. The "Installed X@v" line is gone, as the row says it.
  - A stray's `--pack` line goes to Next.
  - `--list` prints the same source row with everything it holds as children, named and counted as the menu names and counts them, and no menu. It counts no outcome, so it ends on Next when a stray put a line there, and on its row otherwise.
- **list:**
  - The dashboard is a select grouped by repo, asking `? Select a skill or pack to manage`: each repo a heading, each entry a row labelled by its path under the source, with its kind dim, ref with its constraint dim, and its state. A local entry has no ref there, as its state, `◇ local`, says it.
  - The footer reads `↑↓ move   ⏎ manage   esc done` on the left with the counts on the right; short of room, whole counts drop from the right.
  - The detail view is an `●` row for the entry, then aligned dim labels with their values (version, constraint, commit, installed as a date, what it installs, status), then the actions select.
  - Moving between the dashboard and the detail view leaves nothing behind.
  - A manifest that can't be written after a list update is a `✓` row with the warning under it.
- **remove:** the entry is an `●` row with its kind and counts, then its installed folders under a dim `.claude/skills/` (and agents and hooks under theirs), then the confirm. The confirm counts what its rows say, worded as their counts are: `Remove it and its 2 skills, 1 folder, 1 agent and 1 hook?`, `them and their` for several entries, the noun alone for one (`its skill`). A skill entry counts as the one skill its row names, whatever its paths; a pack's paths outside `.claude/` are other items. A row cut short counts what it leaves out the same way, `… 9 more skills, 2 more folders`: a pack's skills apart from its support folders, a skill entry's folder as its skill. The removed row keeps update's row grammar, `✓ <key>   removed · <kind and counts>`, with its folder fields.
- **init:** the type select; then an `●` row naming the folder, `<type> · will create N files` (N counts only the files that aren't there yet), with the files as a tree, those already there marked; the confirm; then a `✓ created` or `○ already there` row per file, and a `· Done …` note. With nothing to create there's no confirm: it goes straight to the `○ already there` rows and the tally.
- **Files in the way** (collision and unmanaged): a `!` row naming the entry, the files as dim children, then the select `How would you like to proceed?`, with `Remove it and continue`. Declining stops the item with the stop policy's own reason.
- **Errors:** `ui.fail` prints ` ✗ <message>` with the message bold and its cause dim on the next line, after any Next items queued so far.

**The Ui surface.** Every word and prompt still goes through `Ui`, but it describes what the output means rather than how clack draws it:

- **Methods:**
  - `header`;
  - a `block` of rows, with `row`, `task` (a row that spins until it settles), and `select`, `confirm` and `multiselect`, each asking about a row;
  - `next`, which queues a remedy;
  - `close`, given the tally;
  - `cancel`;
  - `warn`, `note` and `fail`, each given a `Message`;
  - the three prompts.
- **Messages.** A `Message` is text plus an optional cause and remedy. The remedy has a lead (`To update it anyway:`) and steps, each a command, a choice of commands, or words. The builders that write commands into sentences today return Messages: `buildAbortMessage`, the stray notice, `upgradeAdvice`, the newer-tags line, a copy failure's recovery and the moved-skill candidates.
- **Machine mode.** It flattens a Message back to today's sentence, which is what keeps every document byte for byte.
- **What goes.** `log.*`, `intro`, `outro`, `box` and `spinner` go once nothing calls them.

**Testing:**
- **Commands.** Tests stop mocking `@clack/prompts`. A recording `Ui` takes the calls and scripted answers, so command tests assert what was said, not how it was drawn.
- **Renderer.** Pure functions from rows, messages and tallies to lines, tested at widths 40, 80 and 100 with colour off, plus exact escape codes for each element with colour on.
- **Prompts.** Driven through @clack/core's input and output streams, asserting each frame and the value returned.
- **Golden runs.** A handful render whole runs (update with mixed outcomes, add through the menu, list, remove, a failure) at width 100 with colour off and compare against expected text, so the look can't drift unnoticed.
- **Machine mode.** The document tests stay as they are and must pass unchanged.

**Out of scope:** an ASCII fallback for terminals without Unicode, colour settings, a `--no-color` flag (`NO_COLOR` covers it), and rewording messages beyond moving commands onto their own lines and the rewording above.

## Known limits

- **Ctrl-Z under `npm exec -c`.** It stops `sh` and node together. A spinner frame that fires after bash has printed its prompt, but before node's handler runs, draws over that prompt. In testing this happened about 1 time in 9. A direct run has no such race.
- **Two groups of one repo, each holding a pack.** A loose skill that the first group reinstalls and the second group's pack then takes over shows under both rows. It is still counted once.

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
