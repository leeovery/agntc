import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collisionRow, unmanagedRow } from "../src/in-the-way-render.js";

const FILES = [".claude/skills/a/", ".claude/agents/x.md"];
const DIM = FILES.map((name) => ({ name, dim: true }));

describe("collisionRow", () => {
	it("needs a look: the entry whose files are in the way, then the files, dim", () => {
		expect(collisionRow("other/repo", FILES)).toEqual({
			status: "attention",
			subject: "other/repo",
			detail: "its files are in the way",
			children: DIM,
		});
	});
});

describe("unmanagedRow", () => {
	it("needs a look: the item files agntc didn't install are in the way of, then the files, dim", () => {
		expect(unmanagedRow("owner/repo/a", FILES)).toEqual({
			status: "attention",
			subject: "owner/repo/a",
			detail: "files agntc didn't install are in its way",
			children: DIM,
		});
	});

	it("names a local item by its folder, shortened against the home folder", () => {
		expect(unmanagedRow(join(homedir(), "src", "kit"), FILES).subject).toBe(
			join("~", "src", "kit"),
		);
	});
});
