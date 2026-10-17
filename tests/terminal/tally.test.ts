import { describe, expect, it } from "vitest";
import { outcomeCount, tallyItems } from "../../src/terminal/tally.js";

describe("tallyItems", () => {
	it("lists update's categories in order, each with its glyph's status", () => {
		expect(
			tallyItems({
				command: "update",
				counts: {
					kept: 8,
					removed: 7,
					failed: 6,
					notUpdated: 5,
					notChecked: 4,
					upToDate: 3,
					refreshed: 2,
					updated: 1,
				},
			}),
		).toEqual([
			{ count: 1, label: "updated", status: "done" },
			{ count: 2, label: "refreshed", status: "done" },
			{ count: 3, label: "up to date", status: "unchanged" },
			{ count: 4, label: "not checked", status: "attention" },
			{ count: 5, label: "not updated", status: "failed" },
			{ count: 6, label: "failed", status: "failed" },
			{ count: 7, label: "removed", status: "done" },
			{ count: 8, label: "kept", status: "attention" },
		]);
	});

	it("lists add's, remove's and list's, a category left out counted 0", () => {
		expect(tallyItems({ command: "add", counts: { failed: 1 } })).toEqual([
			{ count: 0, label: "installed", status: "done" },
			{ count: 0, label: "skipped", status: "attention" },
			{ count: 1, label: "failed", status: "failed" },
		]);
		expect(tallyItems({ command: "remove", counts: { removed: 2 } })).toEqual([
			{ count: 2, label: "removed", status: "done" },
			{ count: 0, label: "failed", status: "failed" },
		]);
		expect(
			tallyItems({ command: "list", counts: { versionChanged: 1 } }),
		).toEqual([
			{ count: 0, label: "updated", status: "done" },
			{ count: 1, label: "version changed", status: "done" },
			{ count: 0, label: "removed", status: "done" },
		]);
	});

	it("lists init's, a file left as it was counted as already there, dim as nothing to do", () => {
		expect(tallyItems({ command: "init", counts: { existing: 1 } })).toEqual([
			{ count: 0, label: "created", status: "done" },
			{ count: 1, label: "already there", status: "unchanged" },
		]);
	});
});

describe("outcomeCount", () => {
	it("adds up every category", () => {
		expect(
			outcomeCount({ command: "update", counts: { updated: 2, kept: 1 } }),
		).toBe(3);
		expect(outcomeCount({ command: "list", counts: {} })).toBe(0);
	});
});
