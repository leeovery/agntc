import { beforeEach, describe, expect, it } from "vitest";
import type { InstallItem } from "../src/install-item.js";
import { promptForItems } from "../src/item-menu.js";
import type { Row } from "../src/terminal/types.js";
import type { Choice } from "../src/ui.js";
import { type TestBlock, type TestUi, testUi } from "./helpers/test-ui.js";

let ui: TestUi;
let block: TestBlock;

const SOURCE: Row = {
	status: "done",
	subject: "owner/repo",
	meta: "HEAD",
	detail: "1 pack · 1 skill",
};

const OPTIONS: Choice<InstallItem>[] = [
	{
		value: {
			kind: "pack",
			pack: {
				name: "p",
				path: "p",
				skills: [],
				supportFolders: [],
				assetDirs: ["hooks"],
			},
		},
		label: "p",
		hint: "pack · 0 skills",
	},
	{ value: { kind: "skill", skill: { name: "a", path: "a" } }, label: "a" },
	{
		value: { kind: "skill", skill: { name: "a", path: "x/a" } },
		label: "a",
		aside: "x/a",
	},
];

beforeEach(() => {
	ui = testUi();
	block = ui.block([SOURCE]);
});

describe("promptForItems", () => {
	it("asks under the source's row, offering every option with its label, aside and hint, nothing preselected and none required", async () => {
		ui.multiselect.mockResolvedValue([]);

		await promptForItems(OPTIONS, SOURCE, block);

		expect(block.multiselect).toHaveBeenCalledWith(SOURCE, {
			message: "Select what to install",
			options: [
				{ value: 0, label: "p", hint: "pack · 0 skills" },
				{ value: 1, label: "a" },
				{ value: 2, label: "a", aside: "x/a" },
			],
			required: false,
		});
	});

	it("returns the picked items", async () => {
		ui.multiselect.mockResolvedValue([1]);

		expect(await promptForItems(OPTIONS, SOURCE, block)).toEqual([
			OPTIONS[1]!.value,
		]);
	});

	it("returns nothing when the menu is dismissed (an empty pick)", async () => {
		ui.multiselect.mockResolvedValue([]);

		expect(await promptForItems(OPTIONS, SOURCE, block)).toEqual([]);
	});
});
