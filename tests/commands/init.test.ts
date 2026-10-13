import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExitSignal } from "../../src/exit-signal.js";

vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	cancel: vi.fn(),
}));

vi.mock("../../src/init/type-select.js", () => ({
	selectInitType: vi.fn(),
}));

vi.mock("../../src/init/preview-confirm.js", () => ({
	previewAndConfirm: vi.fn(),
}));

vi.mock("../../src/init/scaffold-skill.js", () => ({
	scaffoldSkill: vi.fn(),
}));

vi.mock("../../src/init/scaffold-plugin.js", () => ({
	scaffoldPlugin: vi.fn(),
}));

vi.mock("../../src/init/scaffold-collection.js", () => ({
	scaffoldCollection: vi.fn(),
}));

import * as p from "@clack/prompts";
import { runInit } from "../../src/commands/init.js";
import { previewAndConfirm } from "../../src/init/preview-confirm.js";
import { scaffoldCollection } from "../../src/init/scaffold-collection.js";
import { scaffoldPlugin } from "../../src/init/scaffold-plugin.js";
import { scaffoldSkill } from "../../src/init/scaffold-skill.js";
import { selectInitType } from "../../src/init/type-select.js";

const mockIntro = vi.mocked(p.intro);
const mockOutro = vi.mocked(p.outro);
const mockCancel = vi.mocked(p.cancel);
const mockSelectInitType = vi.mocked(selectInitType);
const mockPreviewAndConfirm = vi.mocked(previewAndConfirm);
const mockScaffoldSkill = vi.mocked(scaffoldSkill);
const mockScaffoldPlugin = vi.mocked(scaffoldPlugin);
const mockScaffoldCollection = vi.mocked(scaffoldCollection);

beforeEach(() => {
	vi.clearAllMocks();
});

async function expectCleanCancel(): Promise<void> {
	const error = await runInit().catch((e: unknown) => e);

	expect(error).toBeInstanceOf(ExitSignal);
	expect((error as ExitSignal).code).toBe(0);
	expect(mockCancel).toHaveBeenCalledWith("Cancelled");
	expect(mockScaffoldSkill).not.toHaveBeenCalled();
	expect(mockScaffoldPlugin).not.toHaveBeenCalled();
	expect(mockScaffoldCollection).not.toHaveBeenCalled();
}

describe("runInit", () => {
	it("calls p.intro with 'agntc init'", async () => {
		mockSelectInitType.mockResolvedValue(null);

		await expect(runInit()).rejects.toThrow(ExitSignal);

		expect(mockIntro).toHaveBeenCalledWith("agntc init");
	});

	it("goes straight from type selection to the preview, asking nothing else", async () => {
		mockSelectInitType.mockResolvedValue("skill");
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldSkill.mockResolvedValue({ created: ["SKILL.md"], skipped: [] });

		await runInit();

		expect(mockPreviewAndConfirm).toHaveBeenCalledWith({ type: "skill" });
	});

	it("completes skill scaffolding end-to-end", async () => {
		mockSelectInitType.mockResolvedValue("skill");
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldSkill.mockResolvedValue({ created: ["SKILL.md"], skipped: [] });

		await runInit();

		expect(mockScaffoldSkill).toHaveBeenCalledWith({
			targetDir: expect.any(String),
		});
		expect(mockScaffoldPlugin).not.toHaveBeenCalled();
		expect(mockScaffoldCollection).not.toHaveBeenCalled();
		expect(mockOutro).toHaveBeenCalledWith(
			"SKILL.md\nDone. Edit `SKILL.md` to define your skill.",
		);
	});

	it("exits cleanly when type selection is cancelled", async () => {
		mockSelectInitType.mockResolvedValue(null);

		await expectCleanCancel();
	});

	it("exits cleanly when confirmation is declined", async () => {
		mockSelectInitType.mockResolvedValue("skill");
		mockPreviewAndConfirm.mockResolvedValue(false);

		await expectCleanCancel();
	});

	it("completes plugin scaffolding end-to-end", async () => {
		mockSelectInitType.mockResolvedValue("plugin");
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldPlugin.mockResolvedValue({
			created: ["skills/my-skill/SKILL.md", "agents/", "hooks/"],
			skipped: [],
		});

		await runInit();

		expect(mockScaffoldPlugin).toHaveBeenCalledWith({
			targetDir: expect.any(String),
		});
		expect(mockScaffoldSkill).not.toHaveBeenCalled();
		expect(mockScaffoldCollection).not.toHaveBeenCalled();
		expect(mockOutro).toHaveBeenCalledWith(
			"skills/my-skill/SKILL.md, agents/, hooks/\nDone. Add your skills, agents, and hooks.",
		);
	});

	it("exits cleanly when plugin confirmation is declined", async () => {
		mockSelectInitType.mockResolvedValue("plugin");
		mockPreviewAndConfirm.mockResolvedValue(false);

		await expectCleanCancel();
	});

	it("completes collection scaffolding end-to-end", async () => {
		mockSelectInitType.mockResolvedValue("collection");
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldCollection.mockResolvedValue({
			created: [
				"my-plugin/skills/my-skill/SKILL.md",
				"my-plugin/agents/",
				"my-plugin/hooks/",
			],
			skipped: [],
		});

		await runInit();

		expect(mockScaffoldCollection).toHaveBeenCalledWith({
			targetDir: expect.any(String),
		});
		expect(mockScaffoldSkill).not.toHaveBeenCalled();
		expect(mockScaffoldPlugin).not.toHaveBeenCalled();
		expect(mockOutro).toHaveBeenCalledWith(
			"my-plugin/skills/my-skill/SKILL.md, my-plugin/agents/, my-plugin/hooks/\nDone. Rename `my-plugin/` and duplicate for each plugin in your collection.",
		);
	});

	it("exits cleanly when collection confirmation is declined", async () => {
		mockSelectInitType.mockResolvedValue("collection");
		mockPreviewAndConfirm.mockResolvedValue(false);

		await expectCleanCancel();
	});

	it("reports skipped files in output", async () => {
		mockSelectInitType.mockResolvedValue("plugin");
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldPlugin.mockResolvedValue({
			created: ["hooks/"],
			skipped: ["skills/my-skill/SKILL.md", "agents/"],
		});

		await runInit();

		expect(mockOutro).toHaveBeenCalledWith(
			expect.stringContaining("agents/ (already exists)"),
		);
		expect(mockOutro).toHaveBeenCalledWith(
			expect.stringContaining("Done. Add your skills, agents, and hooks."),
		);
	});
});
