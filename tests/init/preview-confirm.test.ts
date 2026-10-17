import { beforeEach, describe, expect, it } from "vitest";
import {
	previewAndConfirm,
	previewTree,
} from "../../src/init/preview-confirm.js";
import { packScaffold } from "../../src/init/scaffold-pack.js";
import { skillScaffold } from "../../src/init/scaffold-skill.js";
import { type TestUi, testUi } from "../helpers/test-ui.js";

let ui: TestUi;

const skillFiles = skillScaffold.files("/work/my-skill");
const packFiles = packScaffold.files("/work/my-pack");

beforeEach(() => {
	ui = testUi();
});

describe("previewAndConfirm", () => {
	it("displays SKILL.md for a skill", async () => {
		ui.confirm.mockResolvedValue(true);

		await previewAndConfirm(skillFiles, ui);

		expect(ui.box).toHaveBeenCalledOnce();
		expect(ui.box.mock.calls[0]?.[0]).toBe("  SKILL.md");
	});

	it("displays a pack's files as a tree, each folder once", async () => {
		ui.confirm.mockResolvedValue(true);

		await previewAndConfirm(packFiles, ui);

		expect(ui.box).toHaveBeenCalledOnce();
		expect(ui.box.mock.calls[0]?.[0]).toBe(
			[
				"  agntc.json",
				"  skills/",
				"    my-skill/",
				"      SKILL.md",
				"  agents/",
				"    my-agent.md",
				"  hooks/",
				"    my-hook.sh",
			].join("\n"),
		);
	});

	it("preview message includes 'This will create:'", async () => {
		ui.confirm.mockResolvedValue(true);

		await previewAndConfirm(skillFiles, ui);

		const title = ui.box.mock.calls[0]?.[1];
		expect(title).toBe("This will create:");
	});

	it("shows the preview before the confirmation prompt", async () => {
		const callOrder: string[] = [];
		ui.box.mockImplementation(() => {
			callOrder.push("note");
		});
		ui.confirm.mockImplementation(() => {
			callOrder.push("confirm");
			return Promise.resolve(true);
		});

		await previewAndConfirm(packFiles, ui);

		expect(callOrder).toEqual(["note", "confirm"]);
	});

	it("asks 'Proceed?' via confirm prompt", async () => {
		ui.confirm.mockResolvedValue(true);

		await previewAndConfirm(skillFiles, ui);

		expect(ui.confirm).toHaveBeenCalledOnce();
		expect(ui.confirm.mock.calls[0]?.[0].message).toBe("Proceed?");
	});

	it("returns true when user confirms", async () => {
		ui.confirm.mockResolvedValue(true);

		expect(await previewAndConfirm(skillFiles, ui)).toBe(true);
	});

	it("returns false when user declines", async () => {
		ui.confirm.mockResolvedValue(false);

		expect(await previewAndConfirm(skillFiles, ui)).toBe(false);
	});

	it("returns false when the confirm is dismissed (a no)", async () => {
		ui.confirm.mockResolvedValue(false);

		expect(await previewAndConfirm(packFiles, ui)).toBe(false);
	});
});

describe("previewTree", () => {
	it("shows a shared folder once and a repeated name under each of its folders", () => {
		expect(
			previewTree(["agntc.json", "skills/a/SKILL.md", "skills/b/SKILL.md"]),
		).toBe(
			[
				"  agntc.json",
				"  skills/",
				"    a/",
				"      SKILL.md",
				"    b/",
				"      SKILL.md",
			].join("\n"),
		);
	});
});
