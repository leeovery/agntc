import { describe, expect, it } from "vitest";
import { collisionRow, unmanagedRow } from "../src/in-the-way-render.js";

const FILES = [".claude/skills/a/", ".claude/agents/x.md"];
const CHILDREN = [
	{ name: ".claude/skills/a/", dim: true, noun: "folder" },
	{ name: ".claude/agents/x.md", dim: true, noun: "file" },
];

describe("collisionRow", () => {
	it("needs a look: the entry whose files are in the way, then the files, dim, each a folder or a file", () => {
		expect(collisionRow({ subject: "other/repo" }, FILES)).toEqual({
			status: "attention",
			subject: "other/repo",
			detail: "its files are in the way",
			children: CHILDREN,
		});
	});
});

describe("unmanagedRow", () => {
	it("needs a look: the item files agntc didn't install are in the way of, then the files, dim", () => {
		expect(unmanagedRow({ subject: "owner/repo/a" }, FILES)).toEqual({
			status: "attention",
			subject: "owner/repo/a",
			detail: "files agntc didn't install are in its way",
			children: CHILDREN,
		});
	});
});

describe("an in-the-way row's head", () => {
	it("carries the meta a local entry's head has", () => {
		const head = { subject: "~/src/kit", meta: "local" };
		expect(collisionRow(head, FILES)).toMatchObject(head);
		expect(unmanagedRow(head, FILES)).toMatchObject(head);
	});
});
