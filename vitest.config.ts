import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		// Only tests/: agents' worktrees under .claude/worktrees/ each hold a
		// whole copy of the repo, tests and all, and no other folder has any.
		include: ["tests/**/*.test.ts"],
	},
});
