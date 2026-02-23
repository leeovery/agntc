import { describe, expect, it } from "vitest";
import { formatInitReport } from "../../src/init/format-report.js";

describe("formatInitReport", () => {
	it("renders created files without special label", () => {
		const result = formatInitReport(
			{ created: ["agntc.json", "SKILL.md"], skipped: [], overwritten: [] },
			"skill",
		);

		expect(result).toEqual(
			"agntc.json, SKILL.md\nDone. Edit `SKILL.md` to define your skill.",
		);
	});

	it("renders skipped files with already exists label", () => {
		const result = formatInitReport(
			{ created: ["agntc.json"], skipped: ["SKILL.md"], overwritten: [] },
			"skill",
		);

		expect(result).toEqual(
			"agntc.json, SKILL.md (already exists)\nDone. Edit `SKILL.md` to define your skill.",
		);
	});

	it("renders overwritten files with overwritten label", () => {
		const result = formatInitReport(
			{
				created: [],
				skipped: ["SKILL.md"],
				overwritten: ["agntc.json"],
			},
			"skill",
		);

		expect(result).toEqual(
			"agntc.json (overwritten), SKILL.md (already exists)\nDone. Edit `SKILL.md` to define your skill.",
		);
	});

	it("fresh-run report has no overwritten section", () => {
		const result = formatInitReport(
			{ created: ["agntc.json", "SKILL.md"], skipped: [], overwritten: [] },
			"skill",
		);

		expect(result).toEqual(
			"agntc.json, SKILL.md\nDone. Edit `SKILL.md` to define your skill.",
		);
	});

	it("reconfigure report renders mixed statuses correctly", () => {
		const result = formatInitReport(
			{
				created: ["hooks/"],
				skipped: ["SKILL.md"],
				overwritten: ["agntc.json"],
			},
			"plugin",
		);

		expect(result).toEqual(
			"hooks/, agntc.json (overwritten), SKILL.md (already exists)\nDone. Add your skills, agents, and hooks.",
		);
	});

	it("includes success message for skill type when files created", () => {
		const result = formatInitReport(
			{ created: ["agntc.json", "SKILL.md"], skipped: [], overwritten: [] },
			"skill",
		);

		expect(result).toEqual(
			"agntc.json, SKILL.md\nDone. Edit `SKILL.md` to define your skill.",
		);
	});

	it("includes success message for plugin type when files created", () => {
		const result = formatInitReport(
			{
				created: [
					"agntc.json",
					"skills/my-skill/SKILL.md",
					"agents/",
					"hooks/",
				],
				skipped: [],
				overwritten: [],
			},
			"plugin",
		);

		expect(result).toEqual(
			"agntc.json, skills/my-skill/SKILL.md, agents/, hooks/\nDone. Add your skills, agents, and hooks.",
		);
	});

	it("includes success message for collection type when files created", () => {
		const result = formatInitReport(
			{
				created: [
					"my-plugin/agntc.json",
					"my-plugin/skills/my-skill/SKILL.md",
					"my-plugin/agents/",
					"my-plugin/hooks/",
				],
				skipped: [],
				overwritten: [],
			},
			"collection",
		);

		expect(result).toEqual(
			"my-plugin/agntc.json, my-plugin/skills/my-skill/SKILL.md, my-plugin/agents/, my-plugin/hooks/\nDone. Rename `my-plugin/` and duplicate for each plugin in your collection.",
		);
	});

	it("includes success message when only overwritten files exist", () => {
		const result = formatInitReport(
			{
				created: [],
				skipped: ["SKILL.md"],
				overwritten: ["agntc.json"],
			},
			"skill",
		);

		expect(result).toEqual(
			"agntc.json (overwritten), SKILL.md (already exists)\nDone. Edit `SKILL.md` to define your skill.",
		);
	});

	it("omits success message when all files skipped", () => {
		const result = formatInitReport(
			{
				created: [],
				skipped: ["agntc.json", "SKILL.md"],
				overwritten: [],
			},
			"skill",
		);

		expect(result).toEqual(
			"agntc.json (already exists), SKILL.md (already exists)",
		);
	});

	it("lists files in order: created then overwritten then skipped", () => {
		const result = formatInitReport(
			{
				created: ["hooks/"],
				skipped: ["SKILL.md"],
				overwritten: ["agntc.json"],
			},
			"plugin",
		);

		expect(result).toEqual(
			"hooks/, agntc.json (overwritten), SKILL.md (already exists)\nDone. Add your skills, agents, and hooks.",
		);
	});

	it("works for collection type with mixed statuses", () => {
		const result = formatInitReport(
			{
				created: ["my-plugin/agents/"],
				skipped: ["my-plugin/skills/my-skill/SKILL.md", "my-plugin/hooks/"],
				overwritten: ["my-plugin/agntc.json"],
			},
			"collection",
		);

		expect(result).toEqual(
			"my-plugin/agents/, my-plugin/agntc.json (overwritten), my-plugin/skills/my-skill/SKILL.md (already exists), my-plugin/hooks/ (already exists)\nDone. Rename `my-plugin/` and duplicate for each plugin in your collection.",
		);
	});
});
