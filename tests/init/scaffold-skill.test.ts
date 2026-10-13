import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discover } from "../../src/discover.js";
import { parseFrontmatter } from "../../src/frontmatter.js";
import { skillScaffold } from "../../src/init/scaffold-skill.js";
import { writeScaffold } from "../../src/init/scaffold-utils.js";

describe("skillScaffold", () => {
	let parent: string;
	let skillDir: string;

	beforeEach(async () => {
		parent = await mkdtemp(join(tmpdir(), "scaffold-skill-test-"));
		skillDir = join(parent, "code-review");
		await mkdir(skillDir);
	});

	afterEach(async () => {
		await rm(parent, { recursive: true, force: true });
	});

	it("is a single SKILL.md, with no agntc.json", () => {
		const paths = skillScaffold.files(skillDir).map(({ path }) => path);

		expect(paths).toEqual(["SKILL.md"]);
	});

	it("names the skill after its folder and gives a placeholder description", async () => {
		await writeScaffold(skillDir, skillScaffold.files(skillDir));

		const content = await readFile(join(skillDir, "SKILL.md"), "utf-8");
		expect(parseFrontmatter(content)).toEqual({
			name: "code-review",
			description:
				"Brief description of what this skill does and when to use it.",
		});
	});

	it("is what discovery finds as one skill named by its folder", async () => {
		await writeScaffold(skillDir, skillScaffold.files(skillDir));

		const discovery = await discover(skillDir, { rootName: "code-review" });

		expect(discovery).toEqual({
			packs: [],
			skills: [
				expect.objectContaining({
					name: "code-review",
					path: "",
					frontmatterName: "code-review",
				}),
			],
			strays: [],
		});
	});

	it("has nothing to warn about", async () => {
		expect(await skillScaffold.warnings(skillDir)).toEqual([]);
	});
});
