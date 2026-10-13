import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFrontmatter, readSkillFrontmatter } from "../src/frontmatter.js";

function doc(...lines: string[]): string {
	return lines.join("\n");
}

describe("parseFrontmatter", () => {
	describe("plain scalars", () => {
		it("reads name and description", () => {
			const content = doc(
				"---",
				"name: my-skill",
				"description: Does a thing",
				"---",
				"# Body",
			);

			expect(parseFrontmatter(content)).toEqual({
				name: "my-skill",
				description: "Does a thing",
			});
		});

		it("keeps colons inside an unquoted value", () => {
			const content = doc(
				"---",
				"description: Use when: the user asks for X",
				"---",
			);

			expect(parseFrontmatter(content)).toEqual({
				description: "Use when: the user asks for X",
			});
		});

		it("folds an indented multi-line plain value with spaces", () => {
			const content = doc(
				"---",
				"description: First line",
				"  second line",
				"  third line",
				"---",
			);

			expect(parseFrontmatter(content).description).toBe(
				"First line second line third line",
			);
		});

		it("reads a plain value that starts on the next line", () => {
			const content = doc("---", "description:", "  Starts below", "---");

			expect(parseFrontmatter(content).description).toBe("Starts below");
		});

		it("strips a trailing comment", () => {
			const content = doc("---", "name: my-skill # the id", "---");

			expect(parseFrontmatter(content).name).toBe("my-skill");
		});

		it("keeps a # that isn't preceded by whitespace", () => {
			const content = doc("---", "description: Writes C# code", "---");

			expect(parseFrontmatter(content).description).toBe("Writes C# code");
		});
	});

	describe("quoted scalars", () => {
		it("reads a double-quoted description containing colons", () => {
			const content = doc(
				"---",
				'description: "Use when: reviewing PRs. Triggers: review, audit"',
				"---",
			);

			expect(parseFrontmatter(content).description).toBe(
				"Use when: reviewing PRs. Triggers: review, audit",
			);
		});

		it("decodes double-quoted escapes", () => {
			const content = doc(
				"---",
				String.raw`description: "Say \"hi\"\nthen a \\ backslash"`,
				"---",
			);

			expect(parseFrontmatter(content).description).toBe(
				'Say "hi"\nthen a \\ backslash',
			);
		});

		it("reads a single-quoted description with colons and doubled quotes", () => {
			const content = doc("---", "description: 'It''s for: everything'", "---");

			expect(parseFrontmatter(content).description).toBe(
				"It's for: everything",
			);
		});

		it("folds a quoted value that wraps onto indented lines", () => {
			const content = doc(
				"---",
				'description: "A long description',
				'  that wraps"',
				"---",
			);

			expect(parseFrontmatter(content).description).toBe(
				"A long description that wraps",
			);
		});

		it("ignores a comment after the closing quote", () => {
			const content = doc("---", "name: 'my-skill' # id", "---");

			expect(parseFrontmatter(content).name).toBe("my-skill");
		});
	});

	describe("block scalars", () => {
		it("| keeps newlines and trims trailing whitespace", () => {
			const content = doc(
				"---",
				"description: |",
				"  Line one",
				"    indented",
				"",
				"  Line three",
				"",
				"name: s",
				"---",
			);

			expect(parseFrontmatter(content)).toEqual({
				description: "Line one\n  indented\n\nLine three",
				name: "s",
			});
		});

		it("> folds lines with spaces and keeps paragraph breaks", () => {
			const content = doc(
				"---",
				"description: >",
				"  Use this skill when the user",
				"  asks for a review.",
				"",
				"  Second paragraph.",
				"---",
			);

			expect(parseFrontmatter(content).description).toBe(
				"Use this skill when the user asks for a review.\nSecond paragraph.",
			);
		});

		it.each([
			">-",
			">+",
			"|-",
			"|+",
		])("accepts the %s chomping indicator and trims trailing whitespace", (header) => {
			const content = doc(
				"---",
				`description: ${header}`,
				"  Only line",
				"",
				"",
				"---",
			);

			expect(parseFrontmatter(content).description).toBe("Only line");
		});

		it("omits a block scalar with an unsupported header", () => {
			const content = doc("---", "description: |2", "  text", "name: s", "---");

			expect(parseFrontmatter(content)).toEqual({ name: "s" });
		});
	});

	describe("line endings", () => {
		it("reads CRLF frontmatter", () => {
			const content =
				"---\r\nname: crlf-skill\r\ndescription: >\r\n  Folded\r\n  over CRLF\r\n---\r\nBody\r\n";

			expect(parseFrontmatter(content)).toEqual({
				name: "crlf-skill",
				description: "Folded over CRLF",
			});
		});

		it("reads frontmatter after a byte-order mark", () => {
			const content = `﻿${doc("---", "name: bom", "---")}`;

			expect(parseFrontmatter(content).name).toBe("bom");
		});
	});

	describe("ignored keys", () => {
		it("ignores other keys and nested maps, including a nested name", () => {
			const content = doc(
				"---",
				"license: MIT",
				"metadata:",
				"  name: nested-name",
				"  description: nested description",
				"allowed-tools:",
				"  - Read",
				"name: real-name",
				"---",
			);

			expect(parseFrontmatter(content)).toEqual({ name: "real-name" });
		});

		it("omits a name or description whose value is a map or a list", () => {
			const content = doc(
				"---",
				"name:",
				"  first: a",
				"description:",
				"  - item",
				"---",
			);

			expect(parseFrontmatter(content)).toEqual({});
		});

		it("ignores keys after the closing delimiter", () => {
			const content = doc("---", "name: s", "---", "description: body text");

			expect(parseFrontmatter(content)).toEqual({ name: "s" });
		});
	});

	describe("leniency", () => {
		it("returns {} when there is no frontmatter", () => {
			expect(parseFrontmatter("# Just a heading\n\nname: no")).toEqual({});
		});

		it("returns {} when the frontmatter doesn't start on the first line", () => {
			expect(parseFrontmatter(doc("", "---", "name: s", "---"))).toEqual({});
		});

		it("returns {} when the frontmatter is unterminated", () => {
			expect(parseFrontmatter(doc("---", "name: s", "description: d"))).toEqual(
				{},
			);
		});

		it("keeps the fields it can read when one value is unparseable", () => {
			const content = doc(
				"---",
				'description: "never closed',
				"name: readable",
				"---",
			);

			expect(parseFrontmatter(content)).toEqual({ name: "readable" });
		});

		it("omits empty values", () => {
			const content = doc("---", "name:", 'description: ""', "---");

			expect(parseFrontmatter(content)).toEqual({});
		});

		it("returns {} for an empty string", () => {
			expect(parseFrontmatter("")).toEqual({});
		});
	});
});

describe("readSkillFrontmatter", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "agntc-frontmatter-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("reads SKILL.md in the given folder", async () => {
		await writeFile(
			join(dir, "SKILL.md"),
			doc("---", "name: on-disk", "description: From disk", "---"),
		);

		expect(await readSkillFrontmatter(dir)).toEqual({
			name: "on-disk",
			description: "From disk",
		});
	});

	it("returns {} when SKILL.md is missing", async () => {
		expect(await readSkillFrontmatter(dir)).toEqual({});
	});

	it("returns {} when SKILL.md can't be read as a file", async () => {
		await mkdir(join(dir, "SKILL.md"));

		expect(await readSkillFrontmatter(dir)).toEqual({});
	});
});
