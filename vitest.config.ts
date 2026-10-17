import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		// Agents' worktrees live under .claude/worktrees/, each a whole copy of
		// the repo, so without this a run collects every copy's tests too.
		exclude: [...configDefaults.exclude, ".claude/**"],
	},
});
