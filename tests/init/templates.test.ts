import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../../src/frontmatter.js";
import { skillMd } from "../../src/init/templates.js";

function nameLine(content: string): string | undefined {
	return content.split("\n").find((line) => line.startsWith("name:"));
}

describe("skillMd", () => {
	it.each([
		"my-skill",
		"code_review",
		"v2.tools",
	])("writes the plain name %j unquoted", (name) => {
		expect(nameLine(skillMd(name))).toBe(`name: ${name}`);
	});

	it.each([
		"foo: bar",
		"#notes",
		"- x",
		"true",
		"No",
		"null",
		"[x]",
		"{x}",
		"123",
		"* star",
		'say "hi"',
		"back\\slash",
		"it's",
	])("quotes %j and it reads back exactly", (name) => {
		const content = skillMd(name);

		expect(nameLine(content)).toBe(`name: ${JSON.stringify(name)}`);
		expect(parseFrontmatter(content).name).toBe(name);
	});

	it("keeps the heading as the bare name", () => {
		expect(skillMd("foo: bar")).toContain("\n# foo: bar\n");
	});
});
