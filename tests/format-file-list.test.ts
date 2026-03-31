import { describe, expect, it } from "vitest";
import {
	FILE_LIST_MAX,
	formatFileList,
} from "../src/format-file-list.js";

describe("formatFileList", () => {
	it("formats single file without truncation", () => {
		const result = formatFileList([".claude/skills/skill-a/"]);

		expect(result).toBe("  - .claude/skills/skill-a/");
	});

	it("formats 5 files without truncation", () => {
		const files = Array.from({ length: 5 }, (_, i) => `.claude/skills/skill-${i}/`);

		const result = formatFileList(files);

		const expected = files.map((f) => `  - ${f}`).join("\n");
		expect(result).toBe(expected);
	});

	it("formats exactly 10 files without truncation", () => {
		const files = Array.from({ length: 10 }, (_, i) => `.claude/skills/skill-${i}/`);

		const result = formatFileList(files);

		const expected = files.map((f) => `  - ${f}`).join("\n");
		expect(result).toBe(expected);
		// No summary line
		expect(result).not.toContain("...and");
	});

	it("truncates 11 files with singular summary", () => {
		const files = Array.from({ length: 11 }, (_, i) => `.claude/skills/skill-${i}/`);

		const result = formatFileList(files);

		const lines = result.split("\n");
		expect(lines).toHaveLength(11); // 10 file lines + 1 summary line
		expect(lines[10]).toBe("  ...and 1 more file");
	});

	it("truncates 15 files with plural summary", () => {
		const files = Array.from({ length: 15 }, (_, i) => `.claude/skills/skill-${i}/`);

		const result = formatFileList(files);

		const lines = result.split("\n");
		expect(lines).toHaveLength(11); // 10 file lines + 1 summary line
		expect(lines[10]).toBe("  ...and 5 more files");
	});

	it("truncates 100 files with plural summary", () => {
		const files = Array.from({ length: 100 }, (_, i) => `.claude/skills/skill-${i}/`);

		const result = formatFileList(files);

		const lines = result.split("\n");
		expect(lines).toHaveLength(11); // 10 file lines + 1 summary line
		expect(lines[10]).toBe("  ...and 90 more files");
	});

	it("each line is indented with bullet prefix", () => {
		const files = Array.from({ length: 5 }, (_, i) => `file-${i}.ts`);

		const result = formatFileList(files);

		const lines = result.split("\n");
		for (const line of lines) {
			expect(line).toMatch(/^ {2}- /);
		}
	});

	it("summary line uses consistent indentation", () => {
		const files = Array.from({ length: 15 }, (_, i) => `file-${i}.ts`);

		const result = formatFileList(files);

		const lines = result.split("\n");
		const summaryLine = lines[lines.length - 1]!;
		expect(summaryLine).toMatch(/^ {2}\.\.\.and /);
	});

	it("exports FILE_LIST_MAX constant equal to 10", () => {
		expect(FILE_LIST_MAX).toBe(10);
	});
});
