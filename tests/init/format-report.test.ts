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
			{ created: ["hooks/my-hook.sh"], skipped: ["agents/my-agent.md"] },
			"pack",
		);

		expect(result).toEqual(
			"hooks/my-hook.sh, agents/my-agent.md (already exists)\nDone. Add skills under `skills/`, agents to `agents/` and hooks to `hooks/`.",
		);
	});

	it("includes success message for pack type when files created", () => {
		const result = formatInitReport(
			{
				created: [
					"agntc.json",
					"skills/my-skill/SKILL.md",
					"agents/my-agent.md",
					"hooks/my-hook.sh",
				],
				skipped: [],
			},
			"pack",
		);

		expect(result).toEqual(
			"agntc.json, skills/my-skill/SKILL.md, agents/my-agent.md, hooks/my-hook.sh\nDone. Add skills under `skills/`, agents to `agents/` and hooks to `hooks/`.",
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
				created: ["agents/my-agent.md"],
				skipped: ["skills/my-skill/SKILL.md", "hooks/my-hook.sh"],
			},
			"pack",
		);

		expect(result).toEqual(
			"agents/my-agent.md, skills/my-skill/SKILL.md (already exists), hooks/my-hook.sh (already exists)\nDone. Add skills under `skills/`, agents to `agents/` and hooks to `hooks/`.",
		);
	});
});
