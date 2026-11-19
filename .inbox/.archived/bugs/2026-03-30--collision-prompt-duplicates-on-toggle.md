# Collision prompt duplicates on arrow key toggle

When running `npx agntc@latest add ../agentic-workflows` against a local path where the plugin is already installed, agntc correctly detects the file collision and presents a two-option prompt: "Remove leeovery/agentic-workflows and continue" or "Cancel installation." The core bug is that toggling between these options with the arrow keys causes the entire prompt block to duplicate in the terminal output. Each toggle appends another copy of the "How would you like to proceed?" section with both options, resulting in a rapidly growing wall of duplicated UI. This makes the prompt unusable after a few key presses.

There are also two minor UI issues with this same collision prompt. First, the file list shown above the prompt is dense and cramped — two pages worth of colliding files are dumped inline with no pagination or truncation, making it unpleasant to scroll through. Showing a condensed summary or limiting visible files would help. Second, the "How would you like to proceed?" line has no vertical spacing separating it from the file list above, making the transition from file listing to action prompt feel cramped and hard to parse visually.

The duplication bug is the priority. The prompt should re-render in place on each arrow key press rather than appending a new copy of itself. The spacing and file list presentation are secondary polish items.

Relevant area: `src/commands/add.ts` (the collision-handling prompt logic).
