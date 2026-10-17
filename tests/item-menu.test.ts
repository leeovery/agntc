import { beforeEach, describe, expect, it } from "vitest";
import type { MenuOption } from "../src/choose-items.js";
import { promptForItems } from "../src/item-menu.js";
import { type TestUi, testUi } from "./helpers/test-ui.js";

let ui: TestUi;

const OPTIONS: MenuOption[] = [
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
];

beforeEach(() => {
	ui = testUi();
});

describe("promptForItems", () => {
	it("offers every option with its label and hint, nothing preselected and none required", async () => {
		ui.multiselect.mockResolvedValue([]);

		await promptForItems(OPTIONS, ui);

		expect(ui.multiselect).toHaveBeenCalledWith({
			message: "Select what to install",
			options: [
				{ value: 0, label: "p", hint: "pack · 0 skills" },
				{ value: 1, label: "a" },
			],
			required: false,
		});
	});

	it("returns the picked items", async () => {
		ui.multiselect.mockResolvedValue([1]);

		expect(await promptForItems(OPTIONS, ui)).toEqual([OPTIONS[1]!.value]);
	});

	it("returns nothing when the menu is dismissed (an empty pick)", async () => {
		ui.multiselect.mockResolvedValue([]);

		expect(await promptForItems(OPTIONS, ui)).toEqual([]);
	});
});
