import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		// Only tests/: agents' worktrees under .claude/worktrees/ each hold a
		// whole copy of the repo, tests and all, and no other folder has any.
		include: ["tests/**/*.test.ts"],
		// The renderer's sweeps (every width, height and colour level) take
		// seconds by design, and a loaded machine stretches them past the 5s
		// default; a release's gate runs on whatever machine it gets.
		testTimeout: 30_000,
	},
});
