import { beforeEach, describe, expect, it } from "vitest";

import type { UnmanagedPluginConflicts } from "../src/unmanaged-resolve.js";
import { resolveUnmanagedConflicts } from "../src/unmanaged-resolve.js";
import { type TestUi, testUi } from "./helpers/test-ui.js";

let ui: TestUi;

beforeEach(() => {
	ui = testUi();
});

describe("resolveUnmanagedConflicts", () => {
	it("returns all approved when no conflicts", async () => {
		const result = await resolveUnmanagedConflicts([], ui);

		expect(result.approved).toEqual([]);
		expect(result.cancelled).toEqual([]);
		expect(ui.select).not.toHaveBeenCalled();
	});

	it("overwrite with double confirm approves files", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo-a",
				files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
			},
		];

		ui.select.mockResolvedValueOnce("overwrite");
		ui.confirm.mockResolvedValueOnce(true);

		const result = await resolveUnmanagedConflicts(conflicts, ui);

		expect(result.approved).toEqual([
			".claude/skills/my-skill/",
			".claude/agents/executor.md",
		]);
		expect(result.cancelled).toEqual([]);
		expect(ui.select).toHaveBeenCalledTimes(1);
		expect(ui.confirm).toHaveBeenCalledTimes(1);
	});

	it("overwrite with declined second confirm cancels plugin", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo-a",
				files: [".claude/skills/my-skill/"],
			},
		];

		ui.select.mockResolvedValueOnce("overwrite");
		ui.confirm.mockResolvedValueOnce(false);

		const result = await resolveUnmanagedConflicts(conflicts, ui);

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

		ui.select.mockResolvedValueOnce("cancel");

		const result = await resolveUnmanagedConflicts(conflicts, ui);

		expect(result.approved).toEqual([]);
		expect(result.cancelled).toEqual([
			".claude/skills/my-skill/",
			".claude/hooks/pre-commit.sh",
		]);
		expect(ui.confirm).not.toHaveBeenCalled();
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
		ui.select.mockResolvedValueOnce("overwrite");
		ui.confirm.mockResolvedValueOnce(true);
		// plugin-b: cancel
		ui.select.mockResolvedValueOnce("cancel");

		const result = await resolveUnmanagedConflicts(conflicts, ui);

		expect(result.approved).toEqual([".claude/skills/skill-a/"]);
		expect(result.cancelled).toEqual([".claude/skills/skill-b/"]);
		expect(ui.select).toHaveBeenCalledTimes(2);
		expect(ui.confirm).toHaveBeenCalledTimes(1);
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

		ui.select.mockResolvedValueOnce("cancel");
		ui.select.mockResolvedValueOnce("cancel");

		const result = await resolveUnmanagedConflicts(conflicts, ui);

		expect(result.approved).toEqual([]);
		expect(result.cancelled).toEqual([
			".claude/skills/skill-a/",
			".claude/skills/skill-b/",
		]);
	});

	it("treats a dismissed select (null) as cancel", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo-a",
				files: [".claude/skills/my-skill/"],
			},
		];

		ui.select.mockResolvedValueOnce(null);

		const result = await resolveUnmanagedConflicts(conflicts, ui);

		expect(result.approved).toEqual([]);
		expect(result.cancelled).toEqual([".claude/skills/my-skill/"]);
	});

	it("treats a dismissed confirm (a no) as cancel", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo-a",
				files: [".claude/skills/my-skill/"],
			},
		];

		ui.select.mockResolvedValueOnce("overwrite");
		ui.confirm.mockResolvedValueOnce(false);

		const result = await resolveUnmanagedConflicts(conflicts, ui);

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
		ui.select.mockResolvedValueOnce("overwrite");
		ui.confirm.mockResolvedValueOnce(true);
		// plugin-b: overwrite + decline confirm = cancelled
		ui.select.mockResolvedValueOnce("overwrite");
		ui.confirm.mockResolvedValueOnce(false);
		// plugin-c: cancel = cancelled
		ui.select.mockResolvedValueOnce("cancel");

		const result = await resolveUnmanagedConflicts(conflicts, ui);

		expect(result.approved).toEqual([".claude/skills/skill-a/"]);
		expect(result.cancelled).toEqual([
			".claude/skills/skill-b/",
			".claude/agents/agent-b.md",
			".claude/hooks/hook-c.sh",
		]);
	});

	it("calls box with file list and unmanaged title before select", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo-a",
				files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
			},
		];

		ui.select.mockResolvedValueOnce("cancel");

		await resolveUnmanagedConflicts(conflicts, ui);

		expect(ui.box).toHaveBeenCalledWith(
			"  - .claude/skills/my-skill/\n  - .claude/agents/executor.md",
			'Unmanaged files for "owner/repo-a"',
		);
		// box() must be called before select()
		const boxOrder = ui.box.mock.invocationCallOrder[0];
		const selectOrder = ui.select.mock.invocationCallOrder[0];
		expect(boxOrder).toBeLessThan(selectOrder!);
	});

	it("select message is single-line with plugin key (unmanaged)", async () => {
		const conflicts: UnmanagedPluginConflicts[] = [
			{
				pluginKey: "owner/repo-a",
				files: [".claude/skills/my-skill/"],
			},
		];

		ui.select.mockResolvedValueOnce("cancel");

		await resolveUnmanagedConflicts(conflicts, ui);

		const call = ui.select.mock.calls[0]!;
		const { message } = call[0] as { message: string };
		expect(message).toBe('How would you like to proceed with "owner/repo-a"?');
		expect(message).not.toContain("\n");
	});

	it("calls box for each conflict in collection resolution", async () => {
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

		ui.select.mockResolvedValueOnce("overwrite");
		ui.confirm.mockResolvedValueOnce(true);
		ui.select.mockResolvedValueOnce("cancel");

		await resolveUnmanagedConflicts(conflicts, ui);

		expect(ui.box).toHaveBeenCalledTimes(2);
		expect(ui.box).toHaveBeenNthCalledWith(
			1,
			"  - .claude/skills/skill-a/",
			'Unmanaged files for "owner/repo/plugin-a"',
		);
		expect(ui.box).toHaveBeenNthCalledWith(
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

		ui.select.mockResolvedValueOnce("cancel");

		await resolveUnmanagedConflicts(conflicts, ui);

		const call = ui.select.mock.calls[0]!;
		const options = (call[0] as { options: Array<{ value: string }> }).options;
		const values = options.map((o) => o.value);
		expect(values).toContain("overwrite");
		expect(values).toContain("cancel");
		expect(values).toHaveLength(2);
	});

	it("labels cancel as cancelling this install", async () => {
		ui.select.mockResolvedValueOnce("cancel");

		await resolveUnmanagedConflicts(
			[{ pluginKey: "owner/repo-a", files: [".claude/skills/my-skill/"] }],
			ui,
		);

		const { options } = ui.select.mock.calls[0]![0] as {
			options: Array<{ value: string; label: string }>;
		};
		expect(options.find((o) => o.value === "cancel")?.label).toBe(
			"Cancel this install",
		);
	});
});
