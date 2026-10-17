import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		// Only tests/: agents' worktrees under .claude/worktrees/ each hold a
		// whole copy of the repo, tests and all, and scripts/gated counts
		// design/, art/, demo/ and the like as folders no gate reads.
		include: ["tests/**/*.test.ts"],
	},
});
