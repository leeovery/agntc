# Clearer progress output during `agntc update`

When running `agntc update` (all-plugins mode), the live output is opaque about what's actually happening. Every plugin's clone step renders the same generic spinner text — `"Cloning repository..."` → `"Cloned successfully"` — with no plugin key attached. So the user sees a stack of identical "Cloned successfully" lines and only learns *what* was updated at the very end, when the per-plugin summary (`Updated 1361023 -> 34fe932`) is finally printed. There's no sense of progress or identity while the work is in flight.

Two root causes, and this idea bundles the fix for both:

**Generic, anonymous spinner text.** The clone spinner in `clone-reinstall.ts` (~lines 336, 349) has no idea which unit it's working on. It should name the unit and, ideally, resolve straight to that unit's outcome inline: start `"Updating <key>..."` and stop with the real result, `"<key>: Updated <old> -> <new>"`. That way each outcome surfaces the moment it completes instead of being batched into the end-of-run summary loop in `update.ts` (~lines 587-609). The trailing summary loop would then only be needed for the non-actioned categories (up-to-date, failed, newer-tags, etc.).

**Redundant per-member cloning.** Collection members (e.g. `rshankras/claude-code-apple-skills/design`, `.../macos`, `.../swift`, …) are independent manifest entries that all point at the same source repo. Today each member calls `cloneAndReinstall` on its own, so the same repo gets shallow-cloned ~10 times for a 10-member collection. That's both the source of the repeated "Cloned successfully" noise *and* a real performance cost. Grouping updatable entries by source repo, cloning each unique repo once, and reinstalling all its members from that single clone would eliminate the redundant work and the noise together. This is the larger structural piece — it changes clone ownership in `cloneAndReinstall` and the processing loop in `processUpdateForAll`.

The two parts compose: naming units in the spinner gives immediate clarity, and per-repo clone dedup makes the flow both quieter and faster. Together they turn the current wall of anonymous "Cloned successfully" lines into a legible, per-unit progress stream.

Relevant files: `src/clone-reinstall.ts`, `src/commands/update.ts`, `src/nuke-reinstall-pipeline.ts`.
