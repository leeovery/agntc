import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
	confirm: vi.fn(),
	note: vi.fn(),
	isCancel: (value: unknown): value is symbol => typeof value === "symbol",
}));

import * as p from "@clack/prompts";
import { previewAndConfirm } from "../../src/init/preview-confirm.js";

const mockConfirm = vi.mocked(p.confirm);
const mockNote = vi.mocked(p.note);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("previewAndConfirm", () => {
	it("displays agntc.json and SKILL.md for skill type", async () => {
		mockConfirm.mockResolvedValue(true);

		await previewAndConfirm({ type: "skill" });

		expect(mockNote).toHaveBeenCalledOnce();
		const message = mockNote.mock.calls[0]![0]!;
		expect(message).toBe("  agntc.json\n  SKILL.md");
	});

	it("preview message includes 'This will create:'", async () => {
		mockConfirm.mockResolvedValue(true);

		await previewAndConfirm({ type: "skill" });

		const title = mockNote.mock.calls[0]![1];
		expect(title).toBe("This will create:");
	});

	it("returns true when user confirms", async () => {
		mockConfirm.mockResolvedValue(true);

		const result = await previewAndConfirm({ type: "skill" });

		expect(result).toBe(true);
	});

	it("returns false when user declines", async () => {
		mockConfirm.mockResolvedValue(false);

		const result = await previewAndConfirm({ type: "skill" });

		expect(result).toBe(false);
	});

	it("returns false when user cancels", async () => {
		mockConfirm.mockResolvedValue(Symbol("cancel"));

		const result = await previewAndConfirm({ type: "skill" });

		expect(result).toBe(false);
	});

	it("builds plugin preview lines matching spec tree format", async () => {
		mockConfirm.mockResolvedValue(true);

		await previewAndConfirm({ type: "plugin" });

		expect(mockNote).toHaveBeenCalledOnce();
		const message = mockNote.mock.calls[0]![0]!;
		expect(message).toBe(
			[
				"  agntc.json",
				"  skills/",
				"    my-skill/",
				"      SKILL.md",
				"  agents/",
				"  hooks/",
			].join("\n"),
		);
	});

	it("plugin preview is shown before confirmation prompt", async () => {
		mockConfirm.mockResolvedValue(true);
		const callOrder: string[] = [];
		mockNote.mockImplementation(() => {
			callOrder.push("note");
		});
		mockConfirm.mockImplementation(() => {
			callOrder.push("confirm");
			return Promise.resolve(true);
		});

		await previewAndConfirm({ type: "plugin" });

		expect(callOrder).toEqual(["note", "confirm"]);
	});

	it("cancelling plugin confirm returns false", async () => {
		mockConfirm.mockResolvedValue(Symbol("cancel"));

		const result = await previewAndConfirm({ type: "plugin" });

		expect(result).toBe(false);
	});

	it("throws for collection type", async () => {
		await expect(previewAndConfirm({ type: "collection" })).rejects.toThrow();
	});

	it("asks 'Proceed?' via confirm prompt", async () => {
		mockConfirm.mockResolvedValue(true);

		await previewAndConfirm({ type: "skill" });

		expect(mockConfirm).toHaveBeenCalledOnce();
		const call = mockConfirm.mock.calls[0]![0];
		expect(call.message).toBe("Proceed?");
	});
});
