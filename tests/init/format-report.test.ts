import { describe, expect, it } from "vitest";
import { formatInitReport } from "../../src/init/format-report.js";

describe("formatInitReport", () => {
	it("renders created files without special label", () => {
		const result = formatInitReport(
			{ created: ["SKILL.md"], skipped: [] },
			"skill",
		);

		expect(result).toEqual(
			"SKILL.md\nDone. Edit `SKILL.md` to define your skill.",
		);
	});

	it("renders skipped files with already exists label", () => {
		const result = formatInitReport(
			{ created: ["hooks/"], skipped: ["agents/"] },
			"plugin",
		);

		expect(result).toEqual(
			"hooks/, agents/ (already exists)\nDone. Add your skills, agents, and hooks.",
		);
	});

	it("includes success message for plugin type when files created", () => {
		const result = formatInitReport(
			{
				created: ["skills/my-skill/SKILL.md", "agents/", "hooks/"],
				skipped: [],
			},
			"plugin",
		);

		expect(result).toEqual(
			"skills/my-skill/SKILL.md, agents/, hooks/\nDone. Add your skills, agents, and hooks.",
		);
	});

	it("includes success message for collection type when files created", () => {
		const result = formatInitReport(
			{
				created: [
					"my-plugin/skills/my-skill/SKILL.md",
					"my-plugin/agents/",
					"my-plugin/hooks/",
				],
				skipped: [],
			},
			"collection",
		);

		expect(result).toEqual(
			"my-plugin/skills/my-skill/SKILL.md, my-plugin/agents/, my-plugin/hooks/\nDone. Rename `my-plugin/` and duplicate for each plugin in your collection.",
		);
	});

	it("omits success message when all files skipped", () => {
		const result = formatInitReport(
			{ created: [], skipped: ["SKILL.md"] },
			"skill",
		);

		expect(result).toEqual("SKILL.md (already exists)");
	});

	it("lists created files before skipped ones", () => {
		const result = formatInitReport(
			{
				created: ["my-plugin/agents/"],
				skipped: ["my-plugin/skills/my-skill/SKILL.md", "my-plugin/hooks/"],
			},
			"collection",
		);

		expect(result).toEqual(
			"my-plugin/agents/, my-plugin/skills/my-skill/SKILL.md (already exists), my-plugin/hooks/ (already exists)\nDone. Rename `my-plugin/` and duplicate for each plugin in your collection.",
		);
	});
});
