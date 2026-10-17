import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		// Only tests/: agents' worktrees under .claude/worktrees/ each hold a
		// whole copy of the repo, tests and all, and scripts/gated counts
		// design/, art/, demo/ and the like as folders no gate reads. The
		// renderer's sweeps (every width, height and colour level) take seconds
		// by design, and a loaded machine stretches them past the 5s default; a
		// release's gate runs on whatever machine it gets.
		include: ["tests/**/*.test.ts"],
		testTimeout: 30_000,
	},
});
