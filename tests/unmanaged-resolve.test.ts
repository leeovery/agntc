import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @clack/prompts before importing module under test
vi.mock("@clack/prompts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@clack/prompts")>();
	return {
		...actual,
		note: vi.fn(),
		select: vi.fn(),
		confirm: vi.fn(),
		isCancel: vi.fn((value: unknown) => typeof value === "symbol"),
	};
});

import * as p from "@clack/prompts";
import type { UnmanagedPluginConflicts } from "../src/unmanaged-resolve.js";
import { resolveUnmanagedConflicts } from "../src/unmanaged-resolve.js";

const mockedNote = vi.mocked(p.note);
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

	it("calls note with file list and unmanaged title before select", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo-a",
				files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
			},
		];

		mockedSelect.mockResolvedValueOnce("cancel");

		await resolveUnmanagedConflicts(conflicts);

		expect(mockedNote).toHaveBeenCalledWith(
			"  - .claude/skills/my-skill/\n  - .claude/agents/executor.md",
			'Unmanaged files for "owner/repo-a"',
		);
		// note() must be called before select()
		const noteOrder = mockedNote.mock.invocationCallOrder[0];
		const selectOrder = mockedSelect.mock.invocationCallOrder[0];
		expect(noteOrder).toBeLessThan(selectOrder!);
	});

	it("select message is single-line with plugin key (unmanaged)", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo-a",
				files: [".claude/skills/my-skill/"],
			},
		];

		mockedSelect.mockResolvedValueOnce("cancel");

		await resolveUnmanagedConflicts(conflicts);

		const call = mockedSelect.mock.calls[0]!;
		const { message } = call[0] as { message: string };
		expect(message).toBe('How would you like to proceed with "owner/repo-a"?');
		expect(message).not.toContain("\n");
	});

	it("calls note for each conflict in collection resolution", async () => {
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

		mockedSelect.mockResolvedValueOnce("overwrite");
		mockedConfirm.mockResolvedValueOnce(true);
		mockedSelect.mockResolvedValueOnce("cancel");

		await resolveUnmanagedConflicts(conflicts);

		expect(mockedNote).toHaveBeenCalledTimes(2);
		expect(mockedNote).toHaveBeenNthCalledWith(
			1,
			"  - .claude/skills/skill-a/",
			'Unmanaged files for "owner/repo/plugin-a"',
		);
		expect(mockedNote).toHaveBeenNthCalledWith(
			2,
			"  - .claude/skills/skill-b/",
			'Unmanaged files for "owner/repo/plugin-b"',
		);
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
