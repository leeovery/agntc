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

vi.mock("../../src/init/scaffold-plugin.js", () => ({
	scaffoldPlugin: vi.fn(),
}));

vi.mock("../../src/init/scaffold-collection.js", () => ({
	scaffoldCollection: vi.fn(),
}));

vi.mock("../../src/init/pre-check.js", () => ({
	preCheck: vi.fn(),
}));

import * as p from "@clack/prompts";
import { runInit } from "../../src/commands/init.js";
import { selectInitAgents } from "../../src/init/agent-select.js";
import { preCheck } from "../../src/init/pre-check.js";
import { previewAndConfirm } from "../../src/init/preview-confirm.js";
import { scaffoldCollection } from "../../src/init/scaffold-collection.js";
import { scaffoldPlugin } from "../../src/init/scaffold-plugin.js";
import { scaffoldSkill } from "../../src/init/scaffold-skill.js";
import { selectInitType } from "../../src/init/type-select.js";

const mockIntro = vi.mocked(p.intro);
const mockOutro = vi.mocked(p.outro);
const mockCancel = vi.mocked(p.cancel);
const mockSelectInitType = vi.mocked(selectInitType);
const mockSelectInitAgents = vi.mocked(selectInitAgents);
const mockPreviewAndConfirm = vi.mocked(previewAndConfirm);
const mockScaffoldSkill = vi.mocked(scaffoldSkill);
const mockScaffoldPlugin = vi.mocked(scaffoldPlugin);
const mockScaffoldCollection = vi.mocked(scaffoldCollection);
const mockPreCheck = vi.mocked(preCheck);

beforeEach(() => {
	vi.clearAllMocks();
	mockPreCheck.mockResolvedValue({ status: "fresh" });
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
			overwritten: [],
		});

		await runInit();

		expect(mockScaffoldSkill).toHaveBeenCalledWith({
			agents: ["claude"],
			targetDir: expect.any(String),
		});
		expect(mockScaffoldPlugin).not.toHaveBeenCalled();
		expect(mockScaffoldCollection).not.toHaveBeenCalled();
		expect(mockOutro).toHaveBeenCalledWith(
			"agntc.json, SKILL.md\nDone. Edit `SKILL.md` to define your skill.",
		);
	});

	it("exits cleanly when type selection is cancelled", async () => {
		mockSelectInitType.mockResolvedValue(null);

		const error = await runInit().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ExitSignal);
		expect((error as ExitSignal).code).toBe(0);
		expect(mockCancel).toHaveBeenCalledWith("Cancelled");
		expect(mockScaffoldSkill).not.toHaveBeenCalled();
		expect(mockScaffoldPlugin).not.toHaveBeenCalled();
		expect(mockScaffoldCollection).not.toHaveBeenCalled();
	});

	it("exits cleanly when agent selection is cancelled", async () => {
		mockSelectInitType.mockResolvedValue("skill");
		mockSelectInitAgents.mockResolvedValue(null);

		const error = await runInit().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ExitSignal);
		expect((error as ExitSignal).code).toBe(0);
		expect(mockCancel).toHaveBeenCalledWith("Cancelled");
		expect(mockScaffoldSkill).not.toHaveBeenCalled();
		expect(mockScaffoldPlugin).not.toHaveBeenCalled();
		expect(mockScaffoldCollection).not.toHaveBeenCalled();
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
		expect(mockScaffoldPlugin).not.toHaveBeenCalled();
		expect(mockScaffoldCollection).not.toHaveBeenCalled();
	});

	it("completes plugin scaffolding end-to-end", async () => {
		mockSelectInitType.mockResolvedValue("plugin");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldPlugin.mockResolvedValue({
			created: ["agntc.json", "skills/my-skill/SKILL.md", "agents/", "hooks/"],
			skipped: [],
			overwritten: [],
		});

		await runInit();

		expect(mockScaffoldPlugin).toHaveBeenCalledWith(expect.any(String), [
			"claude",
		]);
		expect(mockScaffoldSkill).not.toHaveBeenCalled();
		expect(mockScaffoldCollection).not.toHaveBeenCalled();
		expect(mockOutro).toHaveBeenCalledWith(
			"agntc.json, skills/my-skill/SKILL.md, agents/, hooks/\nDone. Add your skills, agents, and hooks.",
		);
	});

	it("shows plugin success message with skipped files", async () => {
		mockSelectInitType.mockResolvedValue("plugin");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldPlugin.mockResolvedValue({
			created: ["skills/my-skill/SKILL.md", "agents/", "hooks/"],
			skipped: ["agntc.json"],
			overwritten: [],
		});

		await runInit();

		expect(mockOutro).toHaveBeenCalledWith(
			expect.stringContaining("agntc.json (already exists)"),
		);
		expect(mockOutro).toHaveBeenCalledWith(
			expect.stringContaining("Done. Add your skills, agents, and hooks."),
		);
	});

	it("exits cleanly when plugin confirmation is declined", async () => {
		mockSelectInitType.mockResolvedValue("plugin");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(false);

		const error = await runInit().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ExitSignal);
		expect((error as ExitSignal).code).toBe(0);
		expect(mockCancel).toHaveBeenCalledWith("Cancelled");
		expect(mockScaffoldSkill).not.toHaveBeenCalled();
		expect(mockScaffoldPlugin).not.toHaveBeenCalled();
		expect(mockScaffoldCollection).not.toHaveBeenCalled();
	});

	it("completes collection scaffolding end-to-end", async () => {
		mockSelectInitType.mockResolvedValue("collection");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldCollection.mockResolvedValue({
			created: [
				"my-plugin/agntc.json",
				"my-plugin/skills/my-skill/SKILL.md",
				"my-plugin/agents/",
				"my-plugin/hooks/",
			],
			skipped: [],
			overwritten: [],
		});

		await runInit();

		expect(mockScaffoldCollection).toHaveBeenCalledWith(expect.any(String), [
			"claude",
		]);
		expect(mockScaffoldSkill).not.toHaveBeenCalled();
		expect(mockScaffoldPlugin).not.toHaveBeenCalled();
		expect(mockOutro).toHaveBeenCalledWith(
			"my-plugin/agntc.json, my-plugin/skills/my-skill/SKILL.md, my-plugin/agents/, my-plugin/hooks/\nDone. Rename `my-plugin/` and duplicate for each plugin in your collection.",
		);
	});

	it("exits cleanly when collection confirmation is declined", async () => {
		mockSelectInitType.mockResolvedValue("collection");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(false);

		const error = await runInit().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ExitSignal);
		expect((error as ExitSignal).code).toBe(0);
		expect(mockCancel).toHaveBeenCalledWith("Cancelled");
		expect(mockScaffoldSkill).not.toHaveBeenCalled();
		expect(mockScaffoldPlugin).not.toHaveBeenCalled();
		expect(mockScaffoldCollection).not.toHaveBeenCalled();
	});

	it("reports skipped files in output", async () => {
		mockSelectInitType.mockResolvedValue("skill");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldSkill.mockResolvedValue({
			created: ["agntc.json"],
			skipped: ["SKILL.md"],
			overwritten: [],
		});

		await runInit();

		expect(mockOutro).toHaveBeenCalledWith(
			expect.stringContaining("SKILL.md (already exists)"),
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
			overwritten: [],
		});

		await runInit();

		expect(mockScaffoldSkill).toHaveBeenCalledWith({
			agents: ["claude", "codex"],
			targetDir: expect.any(String),
		});
	});

	it("passes selected agents to scaffoldPlugin", async () => {
		mockSelectInitType.mockResolvedValue("plugin");
		mockSelectInitAgents.mockResolvedValue(["claude", "codex"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldPlugin.mockResolvedValue({
			created: ["agntc.json", "skills/my-skill/SKILL.md", "agents/", "hooks/"],
			skipped: [],
			overwritten: [],
		});

		await runInit();

		expect(mockScaffoldPlugin).toHaveBeenCalledWith(expect.any(String), [
			"claude",
			"codex",
		]);
	});

	it("passes selected agents to scaffoldCollection", async () => {
		mockSelectInitType.mockResolvedValue("collection");
		mockSelectInitAgents.mockResolvedValue(["claude", "codex"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldCollection.mockResolvedValue({
			created: [
				"my-plugin/agntc.json",
				"my-plugin/skills/my-skill/SKILL.md",
				"my-plugin/agents/",
				"my-plugin/hooks/",
			],
			skipped: [],
			overwritten: [],
		});

		await runInit();

		expect(mockScaffoldCollection).toHaveBeenCalledWith(expect.any(String), [
			"claude",
			"codex",
		]);
	});

	it("orchestrator exits cleanly on cancel", async () => {
		mockPreCheck.mockResolvedValue({ status: "cancel" });

		const error = await runInit().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ExitSignal);
		expect((error as ExitSignal).code).toBe(0);
		expect(mockCancel).toHaveBeenCalledWith("Operation cancelled.");
		expect(mockSelectInitType).not.toHaveBeenCalled();
		expect(mockSelectInitAgents).not.toHaveBeenCalled();
		expect(mockScaffoldSkill).not.toHaveBeenCalled();
		expect(mockScaffoldPlugin).not.toHaveBeenCalled();
		expect(mockScaffoldCollection).not.toHaveBeenCalled();
	});

	it("orchestrator proceeds normally on fresh", async () => {
		mockPreCheck.mockResolvedValue({ status: "fresh" });
		mockSelectInitType.mockResolvedValue("skill");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldSkill.mockResolvedValue({
			created: ["agntc.json", "SKILL.md"],
			skipped: [],
			overwritten: [],
		});

		await runInit();

		expect(mockSelectInitType).toHaveBeenCalled();
		expect(mockSelectInitAgents).toHaveBeenCalled();
		expect(mockPreviewAndConfirm).toHaveBeenCalled();
		expect(mockScaffoldSkill).toHaveBeenCalled();
	});

	it("orchestrator proceeds normally on reconfigure", async () => {
		mockPreCheck.mockResolvedValue({ status: "reconfigure" });
		mockSelectInitType.mockResolvedValue("skill");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldSkill.mockResolvedValue({
			created: ["agntc.json", "SKILL.md"],
			skipped: [],
			overwritten: [],
		});

		await runInit();

		expect(mockSelectInitType).toHaveBeenCalled();
		expect(mockSelectInitAgents).toHaveBeenCalled();
		expect(mockPreviewAndConfirm).toHaveBeenCalled();
		expect(mockScaffoldSkill).toHaveBeenCalled();
	});

	it("passes reconfigure true to scaffoldSkill when preCheck returns reconfigure", async () => {
		mockPreCheck.mockResolvedValue({ status: "reconfigure" });
		mockSelectInitType.mockResolvedValue("skill");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldSkill.mockResolvedValue({
			created: [],
			skipped: ["SKILL.md"],
			overwritten: ["agntc.json"],
		});

		await runInit();

		expect(mockScaffoldSkill).toHaveBeenCalledWith({
			agents: ["claude"],
			targetDir: expect.any(String),
			reconfigure: true,
		});
	});

	it("passes reconfigure true to scaffoldPlugin when preCheck returns reconfigure", async () => {
		mockPreCheck.mockResolvedValue({ status: "reconfigure" });
		mockSelectInitType.mockResolvedValue("plugin");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldPlugin.mockResolvedValue({
			created: [],
			skipped: ["skills/my-skill/SKILL.md", "agents/", "hooks/"],
			overwritten: ["agntc.json"],
		});

		await runInit();

		expect(mockScaffoldPlugin).toHaveBeenCalledWith(
			expect.any(String),
			["claude"],
			{ reconfigure: true },
		);
	});

	it("passes reconfigure true to scaffoldCollection when preCheck returns reconfigure", async () => {
		mockPreCheck.mockResolvedValue({ status: "reconfigure" });
		mockSelectInitType.mockResolvedValue("collection");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldCollection.mockResolvedValue({
			created: [],
			skipped: [
				"my-plugin/skills/my-skill/SKILL.md",
				"my-plugin/agents/",
				"my-plugin/hooks/",
			],
			overwritten: ["my-plugin/agntc.json"],
		});

		await runInit();

		expect(mockScaffoldCollection).toHaveBeenCalledWith(
			expect.any(String),
			["claude"],
			{ reconfigure: true },
		);
	});

	it("does not pass reconfigure to scaffoldSkill when preCheck returns fresh", async () => {
		mockPreCheck.mockResolvedValue({ status: "fresh" });
		mockSelectInitType.mockResolvedValue("skill");
		mockSelectInitAgents.mockResolvedValue(["claude"]);
		mockPreviewAndConfirm.mockResolvedValue(true);
		mockScaffoldSkill.mockResolvedValue({
			created: ["agntc.json", "SKILL.md"],
			skipped: [],
			overwritten: [],
		});

		await runInit();

		expect(mockScaffoldSkill).toHaveBeenCalledWith({
			agents: ["claude"],
			targetDir: expect.any(String),
		});
	});
});
