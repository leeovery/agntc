import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
	confirm: vi.fn(),
	note: vi.fn(),
	isCancel: (value: unknown): value is symbol => typeof value === "symbol",
}));

import * as p from "@clack/prompts";
import {
	previewAndConfirm,
	previewTree,
} from "../../src/init/preview-confirm.js";
import { packScaffold } from "../../src/init/scaffold-pack.js";
import { skillScaffold } from "../../src/init/scaffold-skill.js";
import { interactiveUi } from "../../src/ui.js";

const mockConfirm = vi.mocked(p.confirm);
const mockNote = vi.mocked(p.note);

const skillFiles = skillScaffold.files("/work/my-skill");
const packFiles = packScaffold.files("/work/my-pack");

beforeEach(() => {
	vi.clearAllMocks();
});

describe("previewAndConfirm", () => {
	it("displays SKILL.md for a skill", async () => {
		mockConfirm.mockResolvedValue(true);

		await previewAndConfirm(skillFiles, interactiveUi);

		expect(mockNote).toHaveBeenCalledOnce();
		expect(mockNote.mock.calls[0]?.[0]).toBe("  SKILL.md");
	});

	it("displays a pack's files as a tree, each folder once", async () => {
		mockConfirm.mockResolvedValue(true);

		await previewAndConfirm(packFiles, interactiveUi);

		expect(mockNote).toHaveBeenCalledOnce();
		expect(mockNote.mock.calls[0]?.[0]).toBe(
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
		mockConfirm.mockResolvedValue(true);

		await previewAndConfirm(skillFiles, interactiveUi);

		const title = mockNote.mock.calls[0]?.[1];
		expect(title).toBe("This will create:");
	});

	it("shows the preview before the confirmation prompt", async () => {
		const callOrder: string[] = [];
		mockNote.mockImplementation(() => {
			callOrder.push("note");
		});
		mockConfirm.mockImplementation(() => {
			callOrder.push("confirm");
			return Promise.resolve(true);
		});

		await previewAndConfirm(packFiles, interactiveUi);

		expect(callOrder).toEqual(["note", "confirm"]);
	});

	it("asks 'Proceed?' via confirm prompt", async () => {
		mockConfirm.mockResolvedValue(true);

		await previewAndConfirm(skillFiles, interactiveUi);

		expect(mockConfirm).toHaveBeenCalledOnce();
		expect(mockConfirm.mock.calls[0]?.[0].message).toBe("Proceed?");
	});

	it("returns true when user confirms", async () => {
		mockConfirm.mockResolvedValue(true);

		expect(await previewAndConfirm(skillFiles, interactiveUi)).toBe(true);
	});

	it("returns false when user declines", async () => {
		mockConfirm.mockResolvedValue(false);

		expect(await previewAndConfirm(skillFiles, interactiveUi)).toBe(false);
	});

	it("returns false when user cancels", async () => {
		mockConfirm.mockResolvedValue(Symbol("cancel"));

		expect(await previewAndConfirm(packFiles, interactiveUi)).toBe(false);
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
