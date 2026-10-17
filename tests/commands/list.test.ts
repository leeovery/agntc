import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExitSignal } from "../../src/exit-signal.js";
import type { Manifest } from "../../src/manifest.js";
import type { UpdateCheckResult } from "../../src/update-check.js";
import { makeEntry, makeManifest } from "../helpers/factories.js";

vi.mock("../../src/manifest.js", () => ({
	readManifest: vi.fn(),
	readManifestOrExit: vi.fn(),
	writeManifest: vi.fn(),
	addEntry: vi.fn(),
}));

vi.mock("../../src/update-check-all.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/update-check-all.js")>()),
	checkAllForUpdates: vi.fn(),
}));

vi.mock("../../src/update-check.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/update-check.js")>()),
	checkForUpdate: vi.fn(),
}));

vi.mock("../../src/commands/list-detail.js", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../../src/commands/list-detail.js")
	>()),
	askAction: vi.fn(),
}));

vi.mock("../../src/commands/list-update-action.js", () => ({
	executeUpdateAction: vi.fn(),
}));

vi.mock("../../src/commands/list-remove-action.js", () => ({
	executeRemoveAction: vi.fn(),
}));

vi.mock("../../src/commands/list-change-version-action.js", () => ({
	executeChangeVersionAction: vi.fn(),
}));

import { listCommand, runListLoop } from "../../src/commands/list.js";
import { executeChangeVersionAction } from "../../src/commands/list-change-version-action.js";
import { askAction } from "../../src/commands/list-detail.js";
import { executeRemoveAction } from "../../src/commands/list-remove-action.js";
import { executeUpdateAction } from "../../src/commands/list-update-action.js";
import { readManifest, readManifestOrExit } from "../../src/manifest.js";
import { globalScope } from "../../src/scope.js";
import { checkForUpdate } from "../../src/update-check.js";
import { checkAllForUpdates } from "../../src/update-check-all.js";
import { SSH_REFUSAL } from "../helpers/git-mocks.js";
import { runMachine } from "../helpers/machine.js";
import { type TestUi, testUi } from "../helpers/test-ui.js";

const mockReadManifest = vi.mocked(readManifest);
const mockReadManifestOrExit = vi.mocked(readManifestOrExit);
const mockCheckAll = vi.mocked(checkAllForUpdates);
const mockCheckForUpdate = vi.mocked(checkForUpdate);
const mockAskAction = vi.mocked(askAction);
const mockExecuteUpdateAction = vi.mocked(executeUpdateAction);
const mockExecuteRemoveAction = vi.mocked(executeRemoveAction);
const mockExecuteChangeVersionAction = vi.mocked(executeChangeVersionAction);

const UP_TO_DATE: UpdateCheckResult = { status: "up-to-date" };

function checksOf(
	keys: string[],
	result: UpdateCheckResult = UP_TO_DATE,
): Map<string, UpdateCheckResult> {
	return new Map(keys.map((key) => [key, result]));
}

/** The manifest every read gives, checked as up to date unless given. */
function installed(
	manifest: Manifest,
	checks = checksOf(Object.keys(manifest)),
): void {
	mockReadManifestOrExit.mockResolvedValue(manifest);
	mockReadManifest.mockResolvedValue(manifest);
	mockCheckAll.mockResolvedValue(checks);
	mockCheckForUpdate.mockResolvedValue(UP_TO_DATE);
}

let ui: TestUi;

beforeEach(() => {
	vi.clearAllMocks();
	ui = testUi();
	vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
});

describe("a list session", () => {
	it("opens on the header", async () => {
		installed({});

		await runListLoop(ui);

		expect(ui.header).toHaveBeenCalledOnce();
	});

	it("draws an empty manifest as one row, the add that starts things under Next, and asks nothing", async () => {
		installed({});

		await runListLoop(ui);

		expect(ui.rows()).toEqual([
			{ status: "unchanged", subject: "No skills or packs installed." },
		]);
		expect(ui.next).toHaveBeenCalledWith({
			subject: "",
			remedy: {
				lead: "To get started:",
				steps: [{ command: "npx agntc add owner/repo" }],
			},
		});
		expect(ui.select).not.toHaveBeenCalled();
		expect(ui.close).toHaveBeenCalledWith({ command: "list", counts: {} });
	});

	it("checks every entry under progress of its own that clears, then asks with the dashboard's options and footer", async () => {
		installed(makeManifest(["owner/repo/a", "owner/repo/b"]));
		ui.select.mockResolvedValue(null);

		await runListLoop(ui);

		const [progress] = ui.blocks;
		expect(ui.block).toHaveBeenCalledWith([]);
		expect(progress!.task).toHaveBeenCalledWith({
			text: "checking 2 entries for updates…",
		});
		expect(progress!.tasks[0]!.clear).toHaveBeenCalledOnce();
		expect(progress!.tasks[0]!.settle).not.toHaveBeenCalled();
		const prompt = ui.select.mock.calls[0]![0];
		expect(prompt.message).toBe("Select a skill or pack to manage");
		expect(prompt.options).toEqual([
			{ heading: "owner/repo" },
			expect.objectContaining({ value: "owner/repo/a", label: "a" }),
			expect.objectContaining({ value: "owner/repo/b", label: "b" }),
		]);
		expect(prompt.footer?.keys).toEqual(["⏎ manage", "esc done"]);
	});

	it("ends when the dashboard is left, drawing nothing and closing on an empty tally", async () => {
		installed(makeManifest(["owner/skill"]));
		ui.select.mockResolvedValue(null);

		await runListLoop(ui);

		expect(ui.select).toHaveBeenCalledOnce();
		expect(mockAskAction).not.toHaveBeenCalled();
		expect(ui.rows()).toEqual([]);
		expect(ui.close).toHaveBeenCalledWith({ command: "list", counts: {} });
	});

	it("goes back to the dashboard, checked afresh, when the detail view is left", async () => {
		installed(makeManifest(["owner/skill"]));
		ui.select.mockResolvedValueOnce("owner/skill").mockResolvedValueOnce(null);
		mockAskAction.mockResolvedValueOnce("back");

		await runListLoop(ui);

		expect(ui.select).toHaveBeenCalledTimes(2);
		expect(mockCheckAll).toHaveBeenCalledTimes(2);
		expect(mockAskAction).toHaveBeenCalledOnce();
		expect(ui.rows()).toEqual([]);
	});

	it("asks under the entry's row, with the dashboard's check, its kind and what it installs", async () => {
		const manifest = makeManifest({
			"owner/repo/a": makeEntry({
				ref: "v1.0.0",
				constraint: "^1.0.0",
				type: "skill",
				files: [".claude/skills/a/"],
			}),
		});
		const check: UpdateCheckResult = {
			status: "constrained-update-available",
			tag: "v1.1.0",
			commit: "b".repeat(40),
			latestOverall: "v2.0.0",
		};
		installed(manifest, checksOf(["owner/repo/a"], check));
		ui.select.mockResolvedValueOnce("owner/repo/a").mockResolvedValueOnce(null);
		mockAskAction.mockResolvedValueOnce("back");

		await runListLoop(ui);

		expect(mockCheckForUpdate).not.toHaveBeenCalled();
		expect(mockAskAction).toHaveBeenCalledWith(
			{
				status: "subject",
				subject: "owner/repo/a",
				detail: "skill",
				fields: [
					{ label: "version", value: "v1.0.0" },
					{
						label: "constraint",
						value: "^1.0.0 (v2.0.0 available outside constraint)",
					},
					{ label: "commit", value: "aaaaaaa" },
					{ label: "installed", value: "2026-02-01" },
					{ label: "installs", value: "1 skill" },
					{ label: "status", value: "v1.1.0 available", status: "newer" },
				],
			},
			"v1.0.0",
			check,
			ui,
		);
	});

	it("names a local entry by its folder shortened against the home folder", async () => {
		const home = (await import("node:os")).homedir();
		const key = `${home}/skills/mine`;
		installed(
			makeManifest({ [key]: makeEntry({ commit: null, ref: null }) }),
			checksOf([key], { status: "local" }),
		);
		ui.select.mockResolvedValueOnce(key).mockResolvedValueOnce(null);
		mockAskAction.mockResolvedValueOnce("back");

		await runListLoop(ui);

		expect(mockAskAction.mock.calls[0]![0].subject).toBe("~/skills/mine");
	});

	describe("removing", () => {
		it("hands the action the entry with its kind and counts, then goes back to the dashboard, counting the removal", async () => {
			const before = makeManifest(["owner/skill-a", "owner/skill-b"]);
			const after = makeManifest(["owner/skill-b"]);
			mockReadManifestOrExit
				.mockResolvedValueOnce(before)
				.mockResolvedValueOnce(after);
			mockReadManifest.mockResolvedValue(before);
			mockCheckAll.mockResolvedValue(checksOf(Object.keys(before)));
			ui.select
				.mockResolvedValueOnce("owner/skill-a")
				.mockResolvedValueOnce(null);
			mockAskAction.mockResolvedValueOnce("remove");
			mockExecuteRemoveAction.mockResolvedValueOnce({
				key: "owner/skill-a",
				change: "removed",
			});

			await runListLoop(ui);

			expect(mockExecuteRemoveAction).toHaveBeenCalledWith(
				{
					key: "owner/skill-a",
					entry: before["owner/skill-a"],
					subject: "owner/skill-a",
					kind: "skill",
				},
				before,
				expect.objectContaining({ root: "/fake/project" }),
				ui,
			);
			expect(ui.select).toHaveBeenCalledTimes(2);
			expect(mockAskAction).toHaveBeenCalledOnce();
			expect(ui.close).toHaveBeenCalledWith({
				command: "list",
				counts: { removed: 1 },
			});
		});

		it("counts nothing when the removal is declined or fails, and goes back to the dashboard", async () => {
			installed(makeManifest(["owner/skill"]));
			ui.select
				.mockResolvedValueOnce("owner/skill")
				.mockResolvedValueOnce(null);
			mockAskAction.mockResolvedValueOnce("remove");
			mockExecuteRemoveAction.mockResolvedValueOnce({
				key: "owner/skill",
				change: null,
			});

			await runListLoop(ui);

			expect(ui.select).toHaveBeenCalledTimes(2);
			expect(ui.close).toHaveBeenCalledWith({ command: "list", counts: {} });
		});

		it("draws the empty manifest's row once the last entry is removed, then closes on the tally", async () => {
			const manifest = makeManifest(["owner/only"]);
			mockReadManifestOrExit
				.mockResolvedValueOnce(manifest)
				.mockResolvedValueOnce({});
			mockReadManifest.mockResolvedValue(manifest);
			mockCheckAll.mockResolvedValue(checksOf(["owner/only"]));
			ui.select.mockResolvedValueOnce("owner/only");
			mockAskAction.mockResolvedValueOnce("remove");
			mockExecuteRemoveAction.mockResolvedValueOnce({
				key: "owner/only",
				change: "removed",
			});

			await runListLoop(ui);

			expect(ui.rows()).toEqual([
				{ status: "unchanged", subject: "No skills or packs installed." },
			]);
			expect(ui.next).toHaveBeenCalledOnce();
			expect(ui.close).toHaveBeenCalledWith({
				command: "list",
				counts: { removed: 1 },
			});
		});
	});

	describe("updating", () => {
		it("hands the action the entry, its check, the manifest and an update's run, then shows the entry again, checked afresh", async () => {
			const manifest = makeManifest(["owner/skill"]);
			const check: UpdateCheckResult = {
				status: "update-available",
				remoteCommit: "b".repeat(40),
			};
			installed(manifest, checksOf(["owner/skill"], check));
			ui.select
				.mockResolvedValueOnce("owner/skill")
				.mockResolvedValueOnce(null);
			mockAskAction
				.mockResolvedValueOnce("update")
				.mockResolvedValueOnce("back");
			mockExecuteUpdateAction.mockResolvedValueOnce({
				key: "owner/skill",
				change: "updated",
			});

			await runListLoop(ui);

			expect(mockExecuteUpdateAction).toHaveBeenCalledWith(
				{ key: "owner/skill", entry: manifest["owner/skill"] },
				check,
				manifest,
				expect.objectContaining({
					ui,
					yes: false,
					scope: expect.objectContaining({ root: "/fake/project" }),
				}),
			);
			expect(mockAskAction).toHaveBeenCalledTimes(2);
			expect(mockCheckForUpdate).toHaveBeenCalledOnce();
			const checks = ui.blocks.filter((block) => block.tasks.length > 0);
			const texts = checks.map((block) => block.task.mock.calls[0]![0].text);
			expect(texts).toEqual([
				"checking 1 entry for updates…",
				"checking owner/skill for updates…",
				"checking 1 entry for updates…",
			]);
			for (const check of checks) {
				expect(check.tasks).toHaveLength(1);
				expect(check.tasks[0]!.clear).toHaveBeenCalledOnce();
			}
			expect(ui.close).toHaveBeenCalledWith({
				command: "list",
				counts: { updated: 1 },
			});
		});

		it("follows the entry to the key the update moved it to", async () => {
			const before = makeManifest(["owner/repo/old"]);
			const after = makeManifest(["owner/repo/new"]);
			mockReadManifestOrExit.mockResolvedValue(before);
			mockReadManifest.mockResolvedValueOnce(before).mockResolvedValue(after);
			mockCheckAll.mockResolvedValue(
				checksOf(["owner/repo/old"], { status: "local" }),
			);
			mockCheckForUpdate.mockResolvedValue(UP_TO_DATE);
			ui.select
				.mockResolvedValueOnce("owner/repo/old")
				.mockResolvedValueOnce(null);
			mockAskAction
				.mockResolvedValueOnce("update")
				.mockResolvedValueOnce("back");
			mockExecuteUpdateAction.mockResolvedValueOnce({
				key: "owner/repo/new",
				change: "updated",
			});

			await runListLoop(ui);

			expect(mockCheckForUpdate).toHaveBeenCalledWith(
				"owner/repo/new",
				after["owner/repo/new"],
			);
			expect(mockAskAction.mock.calls[1]![0].subject).toBe("owner/repo/new");
		});

		it("goes back to the dashboard once the entry is gone", async () => {
			const manifest = makeManifest(["owner/skill"]);
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockReadManifest.mockResolvedValueOnce(manifest).mockResolvedValue({});
			mockCheckAll.mockResolvedValue(
				checksOf(["owner/skill"], { status: "local" }),
			);
			ui.select
				.mockResolvedValueOnce("owner/skill")
				.mockResolvedValueOnce(null);
			mockAskAction.mockResolvedValueOnce("update");
			mockExecuteUpdateAction.mockResolvedValueOnce({
				key: "owner/skill",
				change: "removed",
			});

			await runListLoop(ui);

			expect(mockAskAction).toHaveBeenCalledOnce();
			expect(ui.select).toHaveBeenCalledTimes(2);
			expect(ui.close).toHaveBeenCalledWith({
				command: "list",
				counts: { removed: 1 },
			});
		});
	});

	describe("changing version", () => {
		it("hands the action the entry, the row it asks under, the manifest and the run, then shows the entry again", async () => {
			const manifest = makeManifest({
				"owner/skill": makeEntry({ ref: "v1.0.0" }),
			});
			installed(manifest);
			ui.select
				.mockResolvedValueOnce("owner/skill")
				.mockResolvedValueOnce(null);
			mockAskAction
				.mockResolvedValueOnce("change-version")
				.mockResolvedValueOnce("back");
			mockExecuteChangeVersionAction.mockResolvedValueOnce({
				key: "owner/skill",
				change: "versionChanged",
			});

			await runListLoop(ui);

			const row = mockAskAction.mock.calls[0]![0];
			expect(mockExecuteChangeVersionAction).toHaveBeenCalledWith(
				{ key: "owner/skill", entry: manifest["owner/skill"] },
				row,
				manifest,
				expect.objectContaining({ ui, yes: false }),
			);
			expect(mockAskAction).toHaveBeenCalledTimes(2);
			expect(ui.close).toHaveBeenCalledWith({
				command: "list",
				counts: { versionChanged: 1 },
			});
		});
	});

	it("tallies every change the session made", async () => {
		const manifest = makeManifest({
			"owner/a": makeEntry({ ref: "v1.0.0" }),
			"owner/b": makeEntry(),
		});
		installed(manifest, checksOf(["owner/a", "owner/b"], { status: "local" }));
		ui.select
			.mockResolvedValueOnce("owner/a")
			.mockResolvedValueOnce("owner/b")
			.mockResolvedValueOnce(null);
		mockAskAction
			.mockResolvedValueOnce("update")
			.mockResolvedValueOnce("change-version")
			.mockResolvedValueOnce("back")
			.mockResolvedValueOnce("remove");
		mockExecuteUpdateAction.mockResolvedValueOnce({
			key: "owner/a",
			change: "updated",
		});
		mockExecuteChangeVersionAction.mockResolvedValueOnce({
			key: "owner/a",
			change: "versionChanged",
		});
		mockExecuteRemoveAction.mockResolvedValueOnce({
			key: "owner/b",
			change: "removed",
		});

		await runListLoop(ui);

		expect(ui.close).toHaveBeenCalledOnce();
		expect(ui.close).toHaveBeenCalledWith({
			command: "list",
			counts: { updated: 1, versionChanged: 1, removed: 1 },
		});
	});

	it("reads and acts on the global manifest in the global scope", async () => {
		const scope = globalScope("/fake/home");
		installed(makeManifest(["owner/skill"]));
		ui.select.mockResolvedValueOnce("owner/skill").mockResolvedValueOnce(null);
		mockAskAction.mockResolvedValueOnce("remove");
		mockExecuteRemoveAction.mockResolvedValueOnce({
			key: "owner/skill",
			change: null,
		});

		await runListLoop(ui, scope);

		expect(mockReadManifestOrExit).toHaveBeenCalledWith("/fake/home", ui);
		expect(mockReadManifest).toHaveBeenCalledWith("/fake/home");
		expect(mockExecuteRemoveAction.mock.calls[0]![2]).toBe(scope);
	});

	it("ends with ExitSignal when the manifest can't be read", async () => {
		mockReadManifestOrExit.mockImplementation(async () => {
			throw new ExitSignal(1);
		});

		await expect(runListLoop(ui)).rejects.toThrow(ExitSignal);
		expect(ui.close).not.toHaveBeenCalled();
	});
});

describe("list without a terminal", () => {
	it("prints every entry with its update status as one document, with no dashboard", async () => {
		const manifest: Manifest = {
			"owner/branch": makeEntry({ ref: "main", commit: "a1", type: "skill" }),
			"owner/caret": makeEntry({
				ref: "v1.0.0",
				commit: "b1",
				constraint: "^1.0.0",
				type: "pack",
			}),
			"owner/pinned": makeEntry({ ref: "v2.0.0", commit: "c1" }),
			"owner/broken": makeEntry({ ref: null, commit: "d1" }),
		};
		mockReadManifestOrExit.mockResolvedValue(manifest);
		mockCheckAll.mockResolvedValue(
			new Map<string, UpdateCheckResult>([
				["owner/branch", { status: "update-available", remoteCommit: "a2" }],
				[
					"owner/caret",
					{
						status: "constrained-update-available",
						tag: "v1.4.0",
						commit: "b2",
						latestOverall: "v2.1.0",
					},
				],
				["owner/pinned", { status: "newer-tags", tags: ["v2.1.0", "v2.2.0"] }],
				["owner/broken", { status: "check-failed", reason: "network down" }],
			]),
		);

		const run = await runMachine(listCommand, []);

		expect(run.exitCode).toBe(0);
		expect(run.document).toEqual({
			ok: true,
			command: "list",
			scope: "project",
			entries: [
				{
					key: "owner/branch",
					type: "skill",
					ref: "main",
					commit: "a1",
					constraint: null,
					installedAt: "2026-02-01T00:00:00.000Z",
					status: "update-available",
					availableRef: "main",
					availableCommit: "a2",
				},
				{
					key: "owner/caret",
					type: "pack",
					ref: "v1.0.0",
					commit: "b1",
					constraint: "^1.0.0",
					installedAt: "2026-02-01T00:00:00.000Z",
					status: "constrained-update-available",
					availableRef: "v1.4.0",
					availableCommit: "b2",
					latestOutsideConstraint: "v2.1.0",
				},
				{
					key: "owner/pinned",
					type: "skill",
					ref: "v2.0.0",
					commit: "c1",
					constraint: null,
					installedAt: "2026-02-01T00:00:00.000Z",
					status: "newer-tags",
					newerTags: ["v2.1.0", "v2.2.0"],
				},
				{
					key: "owner/broken",
					type: "skill",
					ref: null,
					commit: "d1",
					constraint: null,
					installedAt: "2026-02-01T00:00:00.000Z",
					status: "check-failed",
					reason: "network down",
				},
			],
			warnings: [],
			notes: [],
		});
		expect(run.stdout).toBe(`${JSON.stringify(run.document, null, 2)}\n`);
		expect(mockAskAction).not.toHaveBeenCalled();
	});

	it("keeps git's whole error in a failed check's reason", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/broken": makeEntry({ commit: "d1" }),
		});
		mockCheckAll.mockResolvedValue(
			new Map<string, UpdateCheckResult>([
				["owner/broken", { status: "check-failed", reason: SSH_REFUSAL }],
			]),
		);

		const run = await runMachine(listCommand, []);

		expect(run.document).toMatchObject({
			entries: [
				{ key: "owner/broken", status: "check-failed", reason: SSH_REFUSAL },
			],
		});
	});

	it("prints no entries when nothing is installed", async () => {
		mockReadManifestOrExit.mockResolvedValue({});
		mockCheckAll.mockResolvedValue(new Map());

		const run = await runMachine(listCommand, []);

		expect(run.document).toMatchObject({ ok: true, entries: [] });
	});

	it("prints an error document when the manifest can't be read", async () => {
		mockReadManifestOrExit.mockImplementation(async (_, ui) =>
			ui.fail("Failed to read manifest: bad json"),
		);

		const run = await runMachine(listCommand, []);

		expect(run.exitCode).toBe(1);
		expect(run.document).toEqual({
			ok: false,
			command: "list",
			scope: "project",
			error: { message: "Failed to read manifest: bad json" },
			warnings: [],
			notes: [],
		});
	});
});
