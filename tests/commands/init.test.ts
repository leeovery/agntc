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

vi.mock("../../src/init/agent-select.js", () => ({
	selectInitAgents: vi.fn(),
}));

vi.mock("../../src/init/preview-confirm.js", () => ({
	previewAndConfirm: vi.fn(),
}));

vi.mock("../../src/init/scaffold-skill.js", () => ({
	scaffoldSkill: vi.fn(),
}));

import * as p from "@clack/prompts";
import { runInit } from "../../src/commands/init.js";
import { selectInitAgents } from "../../src/init/agent-select.js";
import { previewAndConfirm } from "../../src/init/preview-confirm.js";
import { scaffoldSkill } from "../../src/init/scaffold-skill.js";
import { selectInitType } from "../../src/init/type-select.js";

const mockIntro = vi.mocked(p.intro);
const mockOutro = vi.mocked(p.outro);
const mockCancel = vi.mocked(p.cancel);
const mockSelectInitType = vi.mocked(selectInitType);
const mockSelectInitAgents = vi.mocked(selectInitAgents);
const mockPreviewAndConfirm = vi.mocked(previewAndConfirm);
const mockScaffoldSkill = vi.mocked(scaffoldSkill);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("runInit", () => {
	it("calls p.intro with 'agntc init'", async () => {
		mockSelectInitType.mockResolvedValue(null);

		await expect(runInit()).rejects.toThrow(ExitSignal);

		expect(mockIntro).toHaveBeenCalledWith("agntc init");
	});

	it("completes skill scaffolding end-to-end", async () => {
		mockSelectInitType.mockResolvedValue("skill");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldSkill.mockResolvedValue({
			created: ["agntc.json", "SKILL.md"],
			skipped: [],
		});

		await runInit();

		expect(mockScaffoldSkill).toHaveBeenCalledWith({
			agents: ["claude"],
			targetDir: expect.any(String),
		});
		expect(mockOutro).toHaveBeenCalledWith(
			"Done. Edit `SKILL.md` to define your skill.",
		);
	});

	it("exits cleanly when type selection is cancelled", async () => {
		mockSelectInitType.mockResolvedValue(null);

		const error = await runInit().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ExitSignal);
		expect((error as ExitSignal).code).toBe(0);
		expect(mockCancel).toHaveBeenCalledWith("Cancelled");
		expect(mockScaffoldSkill).not.toHaveBeenCalled();
	});

	it("exits cleanly when agent selection is cancelled", async () => {
		mockSelectInitType.mockResolvedValue("skill");
		mockSelectInitAgents.mockResolvedValue(null);

		const error = await runInit().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ExitSignal);
		expect((error as ExitSignal).code).toBe(0);
		expect(mockCancel).toHaveBeenCalledWith("Cancelled");
		expect(mockScaffoldSkill).not.toHaveBeenCalled();
	});

	it("exits cleanly when confirmation is declined", async () => {
		mockSelectInitType.mockResolvedValue("skill");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(false);

		const error = await runInit().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ExitSignal);
		expect((error as ExitSignal).code).toBe(0);
		expect(mockCancel).toHaveBeenCalledWith("Cancelled");
		expect(mockScaffoldSkill).not.toHaveBeenCalled();
	});

	it("exits with coming-soon for plugin type", async () => {
		mockSelectInitType.mockResolvedValue("plugin");

		const error = await runInit().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ExitSignal);
		expect((error as ExitSignal).code).toBe(0);
		expect(mockCancel).toHaveBeenCalledWith(
			"Plugin and Collection scaffolding coming soon",
		);
		expect(mockScaffoldSkill).not.toHaveBeenCalled();
	});

	it("exits with coming-soon for collection type", async () => {
		mockSelectInitType.mockResolvedValue("collection");

		const error = await runInit().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ExitSignal);
		expect((error as ExitSignal).code).toBe(0);
		expect(mockCancel).toHaveBeenCalledWith(
			"Plugin and Collection scaffolding coming soon",
		);
		expect(mockScaffoldSkill).not.toHaveBeenCalled();
	});

	it("reports skipped files in output", async () => {
		mockSelectInitType.mockResolvedValue("skill");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldSkill.mockResolvedValue({
			created: ["agntc.json"],
			skipped: ["SKILL.md"],
		});

		await runInit();

		expect(mockOutro).toHaveBeenCalledWith(
			expect.stringContaining("Skipped (already exists): SKILL.md"),
		);
		expect(mockOutro).toHaveBeenCalledWith(
			expect.stringContaining("Done. Edit `SKILL.md` to define your skill."),
		);
	});

	it("passes selected agents to scaffoldSkill", async () => {
		mockSelectInitType.mockResolvedValue("skill");
		mockSelectInitAgents.mockResolvedValue(["claude", "codex"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldSkill.mockResolvedValue({
			created: ["agntc.json", "SKILL.md"],
			skipped: [],
		});

		await runInit();

		expect(mockScaffoldSkill).toHaveBeenCalledWith({
			agents: ["claude", "codex"],
			targetDir: expect.any(String),
		});
	});
});
