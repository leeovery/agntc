import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import { makeEntry } from "../helpers/factories.js";

vi.mock("../../src/manifest.js", async (importOriginal) => ({
	removeEntry: (await importOriginal<typeof import("../../src/manifest.js")>())
		.removeEntry,
	writeManifest: vi.fn(),
}));

vi.mock("../../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

import {
	executeRemoveAction,
	type RemovedEntry,
} from "../../src/commands/list-remove-action.js";
import type { EntryAssets } from "../../src/entry-assets.js";
import { writeManifest } from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { globalScope, projectScope } from "../../src/scope.js";
import { type TestUi, testUi } from "../helpers/test-ui.js";

const mockWriteManifest = vi.mocked(writeManifest);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const PROJECT = projectScope("/fake/project");
let ui: TestUi;

beforeEach(() => {
	vi.clearAllMocks();
	ui = testUi();
	mockWriteManifest.mockResolvedValue(undefined);
	mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
});

function removing(
	entry: ManifestEntry,
	assets: EntryAssets = { counts: { skills: 1 }, other: 0, skills: ["a"] },
): RemovedEntry {
	return { key: "owner/repo", entry, subject: "owner/repo", assets };
}

describe("executeRemoveAction", () => {
	it("asks under the entry's row, naming what it installed, in a block of its own, counting it as the row does", async () => {
		const entry = makeEntry({
			type: "pack",
			files: [
				".claude/skills/my-skill/",
				".claude/skills/shared/",
				".claude/agents/executor.md",
			],
		});
		ui.confirm.mockResolvedValue(false);

		await executeRemoveAction(
			removing(entry, {
				counts: { skills: 1, folders: 1, agents: 1 },
				other: 0,
				skills: ["my-skill"],
			}),
			{ "owner/repo": entry },
			PROJECT,
			ui,
		);

		const row = {
			status: "subject",
			subject: "owner/repo",
			detail: "pack · 1 skill, 1 folder, 1 agent",
			fields: [
				{
					label: ".claude/skills/",
					value: ["my-skill", "shared"],
					noun: ["skill", "folder"],
				},
				{ label: ".claude/agents/", value: ["executor.md"], noun: "agent" },
			],
		};
		expect(ui.block).toHaveBeenCalledWith([row]);
		expect(ui.blocks[0]!.confirm).toHaveBeenCalledWith(row, {
			message: "Remove it and its 1 skill, 1 folder and 1 agent?",
		});
	});

	it("removes nothing, draws nothing and changes nothing when declined", async () => {
		const entry = makeEntry();
		ui.confirm.mockResolvedValue(false);

		const result = await executeRemoveAction(
			removing(entry),
			{ "owner/repo": entry },
			PROJECT,
			ui,
		);

		expect(result).toEqual({ key: "owner/repo", change: null });
		expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		expect(mockWriteManifest).not.toHaveBeenCalled();
		expect(ui.rows()).toEqual([]);
	});

	it("removes the files and the entry, keeping the rest, then draws the removed row", async () => {
		const entry = makeEntry({ files: [".claude/skills/a/"] });
		const other = makeEntry({ files: [".claude/skills/b/"] });
		const manifest: Manifest = { "owner/repo": entry, "owner/other": other };
		ui.confirm.mockResolvedValue(true);

		const result = await executeRemoveAction(
			removing(entry),
			manifest,
			PROJECT,
			ui,
		);

		expect(result).toEqual({ key: "owner/repo", change: "removed" });
		expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
			".claude/skills/a/",
		]);
		expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
			"owner/other": other,
		});
		expect(ui.rows()).toEqual([
			{
				status: "done",
				subject: "owner/repo",
				detail: { label: "removed", aside: "skill" },
			},
		]);
		expect(ui.blocks.at(-1)!.row).toHaveBeenCalledOnce();
	});

	it("writes an empty manifest once the last entry is removed", async () => {
		const entry = makeEntry();
		ui.confirm.mockResolvedValue(true);

		await executeRemoveAction(
			removing(entry),
			{ "owner/repo": entry },
			PROJECT,
			ui,
		);

		expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
	});

	it("removes a global entry's files and record below the home directory", async () => {
		const entry = makeEntry({ files: [".claude/skills/my-skill/"] });
		ui.confirm.mockResolvedValue(true);

		await executeRemoveAction(
			removing(entry),
			{ "owner/repo": entry },
			globalScope("/fake/home"),
			ui,
		);

		expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/home", [
			".claude/skills/my-skill/",
		]);
		expect(mockWriteManifest).toHaveBeenCalledWith("/fake/home", {});
	});

	it("keeps the entry recorded and draws why when removing its files fails", async () => {
		const entry = makeEntry();
		ui.confirm.mockResolvedValue(true);
		mockNukeManifestFiles.mockRejectedValue(
			new Error("EACCES: permission denied"),
		);

		const result = await executeRemoveAction(
			removing(entry),
			{ "owner/repo": entry },
			PROJECT,
			ui,
		);

		expect(result).toEqual({ key: "owner/repo", change: null });
		expect(mockWriteManifest).not.toHaveBeenCalled();
		expect(ui.rows()).toEqual([
			{
				status: "failed",
				subject: "owner/repo",
				detail: {
					label: "failed",
					aside: "EACCES: permission denied; it stays recorded",
				},
			},
		]);
	});
});
