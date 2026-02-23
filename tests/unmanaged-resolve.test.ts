import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @clack/prompts before importing module under test
vi.mock("@clack/prompts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@clack/prompts")>();
	return {
		...actual,
		select: vi.fn(),
		confirm: vi.fn(),
		isCancel: vi.fn((value: unknown) => typeof value === "symbol"),
	};
});

import * as p from "@clack/prompts";
import type { UnmanagedPluginConflicts } from "../src/unmanaged-resolve.js";
import { resolveUnmanagedConflicts } from "../src/unmanaged-resolve.js";

const mockedSelect = vi.mocked(p.select);
const mockedConfirm = vi.mocked(p.confirm);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("resolveUnmanagedConflicts", () => {
	it("returns all approved when no conflicts", async () => {
		const result = await resolveUnmanagedConflicts([]);

		expect(result.approved).toEqual([]);
		expect(result.cancelled).toEqual([]);
		expect(mockedSelect).not.toHaveBeenCalled();
	});

	it("overwrite with double confirm approves files", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo-a",
				files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
			},
		];

		mockedSelect.mockResolvedValueOnce("overwrite");
		mockedConfirm.mockResolvedValueOnce(true);

		const result = await resolveUnmanagedConflicts(conflicts);

		expect(result.approved).toEqual([
			".claude/skills/my-skill/",
			".claude/agents/executor.md",
		]);
		expect(result.cancelled).toEqual([]);
		expect(mockedSelect).toHaveBeenCalledTimes(1);
		expect(mockedConfirm).toHaveBeenCalledTimes(1);
	});

	it("overwrite with declined second confirm cancels plugin", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo-a",
				files: [".claude/skills/my-skill/"],
			},
		];

		mockedSelect.mockResolvedValueOnce("overwrite");
		mockedConfirm.mockResolvedValueOnce(false);

		const result = await resolveUnmanagedConflicts(conflicts);

		expect(result.approved).toEqual([]);
		expect(result.cancelled).toEqual([".claude/skills/my-skill/"]);
	});

	it("cancel places files in cancelled list", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo-a",
				files: [".claude/skills/my-skill/", ".claude/hooks/pre-commit.sh"],
			},
		];

		mockedSelect.mockResolvedValueOnce("cancel");

		const result = await resolveUnmanagedConflicts(conflicts);

		expect(result.approved).toEqual([]);
		expect(result.cancelled).toEqual([
			".claude/skills/my-skill/",
			".claude/hooks/pre-commit.sh",
		]);
		expect(mockedConfirm).not.toHaveBeenCalled();
	});

	it("collections: each plugin checked independently", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo/plugin-a",
				files: [".claude/skills/skill-a/"],
			},
			{
				pluginKey: "owner/repo/plugin-b",
				files: [".claude/skills/skill-b/"],
			},
		];

		// plugin-a: overwrite + confirm
		mockedSelect.mockResolvedValueOnce("overwrite");
		mockedConfirm.mockResolvedValueOnce(true);
		// plugin-b: cancel
		mockedSelect.mockResolvedValueOnce("cancel");

		const result = await resolveUnmanagedConflicts(conflicts);

		expect(result.approved).toEqual([".claude/skills/skill-a/"]);
		expect(result.cancelled).toEqual([".claude/skills/skill-b/"]);
		expect(mockedSelect).toHaveBeenCalledTimes(2);
		expect(mockedConfirm).toHaveBeenCalledTimes(1);
	});

	it("all cancelled returns empty approved", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo/plugin-a",
				files: [".claude/skills/skill-a/"],
			},
			{
				pluginKey: "owner/repo/plugin-b",
				files: [".claude/skills/skill-b/"],
			},
		];

		mockedSelect.mockResolvedValueOnce("cancel");
		mockedSelect.mockResolvedValueOnce("cancel");

		const result = await resolveUnmanagedConflicts(conflicts);

		expect(result.approved).toEqual([]);
		expect(result.cancelled).toEqual([
			".claude/skills/skill-a/",
			".claude/skills/skill-b/",
		]);
	});

	it("treats clack cancel (symbol) on select as cancel", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo-a",
				files: [".claude/skills/my-skill/"],
			},
		];

		mockedSelect.mockResolvedValueOnce(Symbol("cancel") as unknown as string);

		const result = await resolveUnmanagedConflicts(conflicts);

		expect(result.approved).toEqual([]);
		expect(result.cancelled).toEqual([".claude/skills/my-skill/"]);
	});

	it("treats clack cancel (symbol) on confirm as cancel", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo-a",
				files: [".claude/skills/my-skill/"],
			},
		];

		mockedSelect.mockResolvedValueOnce("overwrite");
		mockedConfirm.mockResolvedValueOnce(Symbol("cancel") as unknown as boolean);

		const result = await resolveUnmanagedConflicts(conflicts);

		expect(result.approved).toEqual([]);
		expect(result.cancelled).toEqual([".claude/skills/my-skill/"]);
	});

	it("mixed collection: some overwrite, some decline confirm, some cancel", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo/plugin-a",
				files: [".claude/skills/skill-a/"],
			},
			{
				pluginKey: "owner/repo/plugin-b",
				files: [".claude/skills/skill-b/", ".claude/agents/agent-b.md"],
			},
			{
				pluginKey: "owner/repo/plugin-c",
				files: [".claude/hooks/hook-c.sh"],
			},
		];

		// plugin-a: overwrite + confirm = approved
		mockedSelect.mockResolvedValueOnce("overwrite");
		mockedConfirm.mockResolvedValueOnce(true);
		// plugin-b: overwrite + decline confirm = cancelled
		mockedSelect.mockResolvedValueOnce("overwrite");
		mockedConfirm.mockResolvedValueOnce(false);
		// plugin-c: cancel = cancelled
		mockedSelect.mockResolvedValueOnce("cancel");

		const result = await resolveUnmanagedConflicts(conflicts);

		expect(result.approved).toEqual([".claude/skills/skill-a/"]);
		expect(result.cancelled).toEqual([
			".claude/skills/skill-b/",
			".claude/agents/agent-b.md",
			".claude/hooks/hook-c.sh",
		]);
	});

	it("select options offer only overwrite and cancel", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo-a",
				files: [".claude/skills/my-skill/"],
			},
		];

		mockedSelect.mockResolvedValueOnce("cancel");

		await resolveUnmanagedConflicts(conflicts);

		const call = mockedSelect.mock.calls[0]!;
		const options = (call[0] as { options: Array<{ value: string }> }).options;
		const values = options.map((o) => o.value);
		expect(values).toContain("overwrite");
		expect(values).toContain("cancel");
		expect(values).toHaveLength(2);
	});
});
