import { beforeEach, describe, expect, it, vi } from "vitest";

const { CANCEL } = vi.hoisted(() => ({ CANCEL: Symbol("cancel") }));

vi.mock("@clack/prompts", () => ({
	multiselect: vi.fn(),
	isCancel: vi.fn((value: unknown) => value === CANCEL),
}));

import { multiselect } from "@clack/prompts";
import type { MenuOption } from "../src/choose-items.js";
import { promptForItems } from "../src/item-menu.js";
import { interactiveUi } from "../src/ui.js";

const mockMultiselect = vi.mocked(multiselect);

const OPTIONS: MenuOption[] = [
	{
		value: {
			kind: "pack",
			pack: { name: "p", path: "p", skills: [], assetDirs: ["hooks"] },
		},
		label: "p",
		hint: "pack · 0 skills",
	},
	{ value: { kind: "skill", skill: { name: "a", path: "a" } }, label: "a" },
];

beforeEach(() => {
	vi.clearAllMocks();
});

describe("promptForItems", () => {
	it("offers every option with its label and hint, nothing preselected and none required", async () => {
		mockMultiselect.mockResolvedValue([]);

		await promptForItems(OPTIONS, interactiveUi);

		expect(mockMultiselect).toHaveBeenCalledWith({
			message: "Select what to install",
			options: [
				{ value: 0, label: "p", hint: "pack · 0 skills" },
				{ value: 1, label: "a" },
			],
			required: false,
		});
	});

	it("returns the picked items", async () => {
		mockMultiselect.mockResolvedValue([1]);

		expect(await promptForItems(OPTIONS, interactiveUi)).toEqual([
			OPTIONS[1]!.value,
		]);
	});

	it("returns nothing when cancelled", async () => {
		mockMultiselect.mockResolvedValue(CANCEL);

		expect(await promptForItems(OPTIONS, interactiveUi)).toEqual([]);
	});
});
