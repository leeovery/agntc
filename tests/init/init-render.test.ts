import { describe, expect, it } from "vitest";
import {
	initTally,
	NEXT_STEP,
	scaffoldedRows,
	scaffoldRow,
	scaffoldTree,
} from "../../src/init/init-render.js";
import { packScaffold } from "../../src/init/scaffold-pack.js";

const PACK = packScaffold.files("/work/my-pack").map(({ path }) => path);

describe("scaffoldTree", () => {
	it("names a lone file at the top, a file", () => {
		expect(scaffoldTree(["SKILL.md"])).toEqual([
			{ name: "SKILL.md", depth: 0, noun: "file" },
		]);
	});

	it("names each folder once, before the first path in it, what's in it a level under it, each file a file", () => {
		expect(scaffoldTree(PACK)).toEqual([
			{ name: "agntc.json", depth: 0, noun: "file" },
			{ name: "skills/", depth: 0 },
			{ name: "my-skill/", depth: 1 },
			{ name: "SKILL.md", depth: 2, noun: "file" },
			{ name: "agents/", depth: 0 },
			{ name: "my-agent.md", depth: 1, noun: "file" },
			{ name: "hooks/", depth: 0 },
			{ name: "my-hook.sh", depth: 1, noun: "file" },
		]);
	});

	it("names a folder two paths share once", () => {
		expect(scaffoldTree(["a/x.md", "a/y.md"])).toEqual([
			{ name: "a/", depth: 0 },
			{ name: "x.md", depth: 1, noun: "file" },
			{ name: "y.md", depth: 1, noun: "file" },
		]);
	});
});

describe("scaffoldRow", () => {
	it("is the subject of the question: the folder, as what, how many files it will create, then their tree", () => {
		expect(scaffoldRow("~/my-skill", "skill", ["SKILL.md"])).toEqual({
			status: "subject",
			subject: "~/my-skill",
			detail: "skill · will create 1 file",
			children: [{ name: "SKILL.md", depth: 0, noun: "file" }],
		});
		expect(scaffoldRow("~/my-pack", "pack", PACK).detail).toBe(
			"pack · will create 4 files",
		);
	});

	it("counts only the files it will create, marking those already there in the tree", () => {
		const row = scaffoldRow("~/my-pack", "pack", PACK, [
			"agntc.json",
			"hooks/my-hook.sh",
		]);
		expect(row.detail).toBe("pack · will create 2 files");
		expect(row.children).toContainEqual({
			name: "agntc.json",
			depth: 0,
			noun: "file",
			detail: "already there",
		});
		expect(row.children).toContainEqual({
			name: "my-hook.sh",
			depth: 1,
			noun: "file",
			detail: "already there",
		});
		expect(row.children).toContainEqual({
			name: "SKILL.md",
			depth: 2,
			noun: "file",
		});
	});
});

describe("scaffoldedRows", () => {
	it("gives each file a row in the scaffold's order: created, or already there", () => {
		expect(
			scaffoldedRows(PACK, {
				created: PACK.slice(1),
				skipped: ["agntc.json"],
			}),
		).toEqual([
			{
				status: "unchanged",
				subject: "agntc.json",
				detail: { label: "already there" },
			},
			...PACK.slice(1).map((subject) => ({
				status: "done",
				subject,
				detail: { label: "created" },
			})),
		]);
	});
});

describe("initTally", () => {
	it("counts each file by what became of it", () => {
		expect(initTally({ created: ["a", "b"], skipped: ["c"] })).toEqual({
			created: 2,
			existing: 1,
		});
	});
});

describe("NEXT_STEP", () => {
	it("says what each type's scaffold needs next", () => {
		expect(NEXT_STEP).toEqual({
			skill: "Done. Edit `SKILL.md` to define your skill.",
			pack: "Done. Add skills under `skills/`, agents to `agents/` and hooks to `hooks/`.",
		});
	});
});
