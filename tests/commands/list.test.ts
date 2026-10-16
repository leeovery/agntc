import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExitSignal } from "../../src/exit-signal.js";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
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

vi.mock("../../src/update-check.js", () => ({
	checkForUpdate: vi.fn(),
}));

vi.mock("../../src/commands/list-detail.js", () => ({
	renderDetailView: vi.fn(),
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
import { renderDetailView } from "../../src/commands/list-detail.js";
import { executeRemoveAction } from "../../src/commands/list-remove-action.js";
import { executeUpdateAction } from "../../src/commands/list-update-action.js";
import { readManifest, readManifestOrExit } from "../../src/manifest.js";
import { globalScope, projectScope } from "../../src/scope.js";
import { checkForUpdate } from "../../src/update-check.js";
import { checkAllForUpdates } from "../../src/update-check-all.js";
import { SSH_REFUSAL } from "../helpers/git-mocks.js";
import { runMachine } from "../helpers/machine.js";
import { type TestUi, testUi } from "../helpers/test-ui.js";

const mockReadManifest = vi.mocked(readManifest);
const mockReadManifestOrExit = vi.mocked(readManifestOrExit);
const mockCheckAll = vi.mocked(checkAllForUpdates);
const mockCheckForUpdate = vi.mocked(checkForUpdate);
const mockRenderDetailView = vi.mocked(renderDetailView);
const mockExecuteUpdateAction = vi.mocked(executeUpdateAction);
const mockExecuteRemoveAction = vi.mocked(executeRemoveAction);
const mockExecuteChangeVersionAction = vi.mocked(executeChangeVersionAction);

function setupCheckResults(
	keys: string[],
	status: UpdateCheckResult["status"] = "up-to-date",
): Map<string, UpdateCheckResult> {
	const map = new Map<string, UpdateCheckResult>();
	for (const key of keys) {
		if (status === "up-to-date") {
			map.set(key, { status: "up-to-date" });
		} else if (status === "check-failed") {
			map.set(key, { status: "check-failed", reason: "unknown" });
		}
	}
	return map;
}

let ui: TestUi;

beforeEach(() => {
	vi.clearAllMocks();
	ui = testUi();
	vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
});

describe("runListLoop", () => {
	describe("intro", () => {
		it("shows the 'agntc list' intro", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			await runListLoop(ui);

			expect(ui.intro).toHaveBeenCalledWith("agntc list");
		});
	});

	describe("empty manifest", () => {
		it("shows empty message and exits loop", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			await runListLoop(ui);

			expect(ui.outro).toHaveBeenCalledWith(
				"No skills or packs installed. Run npx agntc add owner/repo to get started.",
			);
			expect(ui.select).not.toHaveBeenCalled();
		});
	});

	describe("no Done pseudo-entry", () => {
		it("does not add a 'Done' option to the list (Esc exits instead)", async () => {
			const manifest = makeManifest(["owner/skill"]);
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockCheckAll.mockResolvedValue(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValue(null);

			await runListLoop(ui);

			const options = ui.select.mock.calls[0]![0].options as Array<{
				value: string;
				label: string;
			}>;
			expect(
				options.some((o) => o.value === "__done__" || o.label === "Done"),
			).toBe(false);
			expect(mockRenderDetailView).not.toHaveBeenCalled();
		});
	});

	it("asks for a skill or pack to manage", async () => {
		mockReadManifestOrExit.mockResolvedValue(makeManifest(["owner/skill"]));
		mockCheckAll.mockResolvedValue(setupCheckResults(["owner/skill"]));
		ui.select.mockResolvedValue(null);

		await runListLoop(ui);

		expect(ui.select.mock.calls[0]![0].message).toBe(
			"Select a skill or pack to manage  (Esc when done)",
		);
	});

	describe("cancel", () => {
		it("exits loop when user cancels", async () => {
			const manifest = makeManifest(["owner/skill"]);
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockCheckAll.mockResolvedValue(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValue(null);

			await runListLoop(ui);

			expect(ui.select).toHaveBeenCalledTimes(1);
			expect(mockRenderDetailView).not.toHaveBeenCalled();
		});
	});

	describe("back from detail", () => {
		it("returns to list when detail view returns back", async () => {
			const manifest = makeManifest(["owner/skill"]);
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockReadManifest.mockResolvedValue(manifest);
			mockCheckAll.mockResolvedValue(setupCheckResults(["owner/skill"]));
			mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" as const });

			// First iteration: select plugin
			ui.select.mockResolvedValueOnce("owner/skill");
			// Inner loop reads fresh manifest + checkForUpdate, detail returns "back"
			mockRenderDetailView.mockResolvedValueOnce("back");

			// Second iteration: user exits (Esc)
			ui.select.mockResolvedValueOnce(null);

			await runListLoop(ui);

			expect(ui.select).toHaveBeenCalledTimes(2);
			expect(mockRenderDetailView).toHaveBeenCalledTimes(1);
			// readManifestOrExit: 2 outer, readManifest: 1 inner
			expect(mockReadManifestOrExit).toHaveBeenCalledTimes(2);
			expect(mockReadManifest).toHaveBeenCalledTimes(1);
		});
	});

	describe("remove action", () => {
		it("returns to list without removed plugin", async () => {
			const fullManifest = makeManifest(["owner/skill-a", "owner/skill-b"]);
			const reducedManifest = makeManifest(["owner/skill-b"]);

			// First outer iteration: full manifest
			mockReadManifestOrExit.mockResolvedValueOnce(fullManifest);
			mockCheckAll.mockResolvedValueOnce(
				setupCheckResults(["owner/skill-a", "owner/skill-b"]),
			);
			ui.select.mockResolvedValueOnce("owner/skill-a");

			// Inner loop: re-read manifest, checkForUpdate, render detail -> remove
			mockReadManifest.mockResolvedValueOnce(fullManifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "up-to-date" as const,
			});
			mockRenderDetailView.mockResolvedValueOnce("remove");
			mockExecuteRemoveAction.mockResolvedValueOnce({
				removed: true,
				message: "Removed owner/skill-a",
			});

			// Second outer iteration: reduced manifest
			mockReadManifestOrExit.mockResolvedValueOnce(reducedManifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill-b"]));
			ui.select.mockResolvedValueOnce(null);

			await runListLoop(ui);

			expect(mockExecuteRemoveAction).toHaveBeenCalledTimes(1);
			expect(ui.log.success).toHaveBeenCalledWith("Removed owner/skill-a");
			// readManifestOrExit: 2 outer, readManifest: 1 inner
			expect(mockReadManifestOrExit).toHaveBeenCalledTimes(2);
			expect(mockReadManifest).toHaveBeenCalledTimes(1);
			expect(ui.select).toHaveBeenCalledTimes(2);
		});

		it("reports a failed removal and returns to the list, the entry still there", async () => {
			const fullManifest = makeManifest(["owner/skill-a", "owner/skill-b"]);
			const failure =
				"Couldn't remove owner/skill-a: EACCES; it stays recorded";

			mockReadManifestOrExit.mockResolvedValue(fullManifest);
			mockCheckAll.mockResolvedValue(
				setupCheckResults(["owner/skill-a", "owner/skill-b"]),
			);
			ui.select
				.mockResolvedValueOnce("owner/skill-a")
				.mockResolvedValueOnce(null);
			mockReadManifest.mockResolvedValueOnce(fullManifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "up-to-date" as const,
			});
			mockRenderDetailView.mockResolvedValueOnce("remove");
			mockExecuteRemoveAction.mockResolvedValueOnce({
				removed: false,
				message: failure,
			});

			await runListLoop(ui);

			expect(ui.log.error).toHaveBeenCalledWith(failure);
			expect(ui.said("success")).toEqual([]);
			expect(ui.select).toHaveBeenCalledTimes(2);
			expect(ui.select.mock.calls[1]?.[0]).toMatchObject({
				options: expect.arrayContaining([
					expect.objectContaining({ value: "owner/skill-a" }),
				]),
			});
		});

		it("says nothing when the removal is cancelled", async () => {
			const fullManifest = makeManifest(["owner/skill-a"]);

			mockReadManifestOrExit.mockResolvedValue(fullManifest);
			mockCheckAll.mockResolvedValue(setupCheckResults(["owner/skill-a"]));
			ui.select
				.mockResolvedValueOnce("owner/skill-a")
				.mockResolvedValueOnce(null);
			mockReadManifest.mockResolvedValueOnce(fullManifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "up-to-date" as const,
			});
			mockRenderDetailView.mockResolvedValueOnce("remove");
			mockExecuteRemoveAction.mockResolvedValueOnce({
				removed: false,
				message: "Cancelled",
			});

			await runListLoop(ui);

			expect(ui.said("error")).toEqual([]);
			expect(ui.said("success")).toEqual([]);
		});
	});

	describe("remove last plugin", () => {
		it("shows empty state message after removing last plugin", async () => {
			const manifest = makeManifest(["owner/only-skill"]);

			// First outer iteration: one plugin
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(
				setupCheckResults(["owner/only-skill"]),
			);
			ui.select.mockResolvedValueOnce("owner/only-skill");

			// Inner loop: re-read manifest, checkForUpdate, render detail -> remove
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "up-to-date" as const,
			});
			mockRenderDetailView.mockResolvedValueOnce("remove");
			mockExecuteRemoveAction.mockResolvedValueOnce({
				removed: true,
				message: "Removed owner/only-skill",
			});

			// Second outer iteration: empty manifest
			mockReadManifestOrExit.mockResolvedValueOnce({});

			await runListLoop(ui);

			expect(ui.log.success).toHaveBeenCalledWith("Removed owner/only-skill");
			expect(ui.outro).toHaveBeenCalledWith(
				"No skills or packs installed. Run npx agntc add owner/repo to get started.",
			);
		});
	});

	describe("update action", () => {
		it("remains in detail view after successful update", async () => {
			const manifest = makeManifest(["owner/skill"]);
			const updatedEntry = makeEntry({ commit: "def456" });
			const updatedManifest: Manifest = { "owner/skill": updatedEntry };

			// Outer loop iteration 1: select plugin
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(
				new Map([
					[
						"owner/skill",
						{ status: "update-available" as const, remoteCommit: "def456" },
					],
				]),
			);
			ui.select.mockResolvedValueOnce("owner/skill");

			// Inner detail loop iteration 1: re-read manifest, checkForUpdate, render detail -> "update"
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "update-available" as const,
				remoteCommit: "def456",
			});
			mockRenderDetailView.mockResolvedValueOnce("update");
			mockExecuteUpdateAction.mockResolvedValueOnce({
				success: true,
				key: "owner/skill",
				message: "Updated owner/skill",
				notes: [],
			});

			// Inner detail loop iteration 2: re-read manifest returns updated entry, user picks "back"
			mockReadManifest.mockResolvedValueOnce(updatedManifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "up-to-date" as const,
			});
			mockRenderDetailView.mockResolvedValueOnce("back");

			// Outer loop iteration 2: Done
			mockReadManifestOrExit.mockResolvedValueOnce(updatedManifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce(null);

			await runListLoop(ui);

			expect(mockExecuteUpdateAction).toHaveBeenCalledTimes(1);
			expect(ui.log.success).toHaveBeenCalledWith("Updated owner/skill");
			// Detail view rendered twice (once before update, once after)
			expect(mockRenderDetailView).toHaveBeenCalledTimes(2);
			// readManifestOrExit: 2 outer, readManifest: 2 inner
			expect(mockReadManifestOrExit).toHaveBeenCalledTimes(2);
			expect(mockReadManifest).toHaveBeenCalledTimes(2);
			expect(ui.select).toHaveBeenCalledTimes(2);
		});
	});

	describe("change version action", () => {
		it("remains in detail view after successful version change", async () => {
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { "owner/skill": entry };
			const updatedEntry = makeEntry({ ref: "v1.1.0", commit: "new123" });
			const updatedManifest: Manifest = { "owner/skill": updatedEntry };

			const updateStatus: UpdateCheckResult = {
				status: "newer-tags",
				tags: ["v1.1.0"],
			};

			// Outer loop iteration 1: select plugin
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(
				new Map([["owner/skill", updateStatus]]),
			);
			ui.select.mockResolvedValueOnce("owner/skill");

			// Inner detail loop iteration 1: re-read manifest, checkForUpdate, render detail -> "change-version"
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce(updateStatus);
			mockRenderDetailView.mockResolvedValueOnce("change-version");
			mockExecuteChangeVersionAction.mockResolvedValueOnce({
				changed: true,
				key: "owner/skill",
				message: "Changed owner/skill to v1.1.0",
				notes: [],
			});

			// Inner detail loop iteration 2: re-read manifest, user picks "back"
			mockReadManifest.mockResolvedValueOnce(updatedManifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "up-to-date" as const,
			});
			mockRenderDetailView.mockResolvedValueOnce("back");

			// Outer loop iteration 2: Done
			mockReadManifestOrExit.mockResolvedValueOnce(updatedManifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce(null);

			await runListLoop(ui);

			expect(mockExecuteChangeVersionAction).toHaveBeenCalledTimes(1);
			expect(ui.log.success).toHaveBeenCalledWith(
				"Changed owner/skill to v1.1.0",
			);
			// Detail view rendered twice (before change, after change)
			expect(mockRenderDetailView).toHaveBeenCalledTimes(2);
			// readManifestOrExit: 2 outer, readManifest: 2 inner
			expect(mockReadManifestOrExit).toHaveBeenCalledTimes(2);
			expect(mockReadManifest).toHaveBeenCalledTimes(2);
			expect(ui.select).toHaveBeenCalledTimes(2);
		});
	});

	describe("an action that moves the entry to a new key", () => {
		it.each([
			"update",
			"change-version",
		] as const)("%s: the detail view follows the entry to that key", async (action) => {
			const oldKey = "owner/repo/packs/foo";
			const newKey = "owner/repo/foo";
			const moved = makeEntry({ type: "skill", sourceSubpath: "packs/foo" });
			const before: Manifest = { [oldKey]: makeEntry({ type: "pack" }) };
			const after: Manifest = { [newKey]: moved };
			const status: UpdateCheckResult = {
				status: "update-available",
				remoteCommit: "def456",
			};
			mockReadManifestOrExit.mockResolvedValueOnce(before);
			mockCheckAll.mockResolvedValueOnce(new Map([[oldKey, status]]));
			ui.select.mockResolvedValueOnce(oldKey);
			mockReadManifest.mockResolvedValueOnce(before);
			mockRenderDetailView.mockResolvedValueOnce(action);
			const result = { key: newKey, message: `Moved ${newKey}`, notes: [] };
			if (action === "update") {
				mockExecuteUpdateAction.mockResolvedValueOnce({
					success: true,
					...result,
				});
			} else {
				mockExecuteChangeVersionAction.mockResolvedValueOnce({
					changed: true,
					...result,
				});
			}
			mockReadManifest.mockResolvedValueOnce(after);
			mockCheckForUpdate.mockResolvedValueOnce({ status: "up-to-date" });
			mockRenderDetailView.mockResolvedValueOnce("back");
			mockReadManifestOrExit.mockResolvedValueOnce(after);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults([newKey]));
			ui.select.mockResolvedValueOnce(null);

			await runListLoop(ui);

			expect(mockCheckForUpdate).toHaveBeenCalledExactlyOnceWith(newKey, moved);
			expect(mockRenderDetailView).toHaveBeenLastCalledWith(
				{
					key: newKey,
					entry: moved,
					updateStatus: { status: "up-to-date" },
					installRoot: "/fake/project",
				},
				expect.anything(),
			);
		});
	});

	describe("action notes", () => {
		function arrangeOneAction(action: "update" | "change-version"): void {
			const manifest: Manifest = { "owner/repo/laravel": makeEntry() };
			const status: UpdateCheckResult = {
				status: "update-available",
				remoteCommit: "def456",
			};
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(
				new Map([["owner/repo/laravel", status]]),
			);
			ui.select.mockResolvedValueOnce("owner/repo/laravel");
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockRenderDetailView.mockResolvedValueOnce(action);
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({ status: "up-to-date" });
			mockRenderDetailView.mockResolvedValueOnce("back");
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(
				setupCheckResults(["owner/repo/laravel"]),
			);
			ui.select.mockResolvedValueOnce(null);
		}

		const NOTE =
			"owner/repo/laravel is a single skill — reinstalled as a skill";

		it("prints an update's note before its message", async () => {
			arrangeOneAction("update");
			mockExecuteUpdateAction.mockResolvedValueOnce({
				success: true,
				key: "owner/repo/laravel",
				message: "Updated owner/repo/laravel",
				notes: [NOTE],
			});

			await runListLoop(ui);

			expect(ui.note).toHaveBeenCalledWith(NOTE);
			expect(ui.note.mock.invocationCallOrder[0]).toBeLessThan(
				ui.log.success.mock.invocationCallOrder[0]!,
			);
		});

		it("prints a version change's note", async () => {
			arrangeOneAction("change-version");
			mockExecuteChangeVersionAction.mockResolvedValueOnce({
				changed: true,
				key: "owner/repo/laravel",
				message: "Changed owner/repo/laravel to v2.0.0",
				notes: [NOTE],
			});

			await runListLoop(ui);

			expect(ui.note).toHaveBeenCalledWith(NOTE);
		});
	});

	describe("successive actions", () => {
		it("handles select-back-select-remove-empty flow", async () => {
			const manifest = makeManifest(["owner/skill"]);

			// Outer iteration 1: select plugin
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce("owner/skill");
			// Inner loop: re-read manifest, checkForUpdate, back
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "up-to-date" as const,
			});
			mockRenderDetailView.mockResolvedValueOnce("back");

			// Outer iteration 2: select plugin
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce("owner/skill");
			// Inner loop: re-read manifest, checkForUpdate, remove
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "up-to-date" as const,
			});
			mockRenderDetailView.mockResolvedValueOnce("remove");
			mockExecuteRemoveAction.mockResolvedValueOnce({
				removed: true,
				message: "Removed owner/skill",
			});

			// Outer iteration 3: empty manifest
			mockReadManifestOrExit.mockResolvedValueOnce({});

			await runListLoop(ui);

			expect(ui.select).toHaveBeenCalledTimes(2);
			expect(mockRenderDetailView).toHaveBeenCalledTimes(2);
			expect(mockExecuteRemoveAction).toHaveBeenCalledTimes(1);
			expect(ui.outro).toHaveBeenCalledWith(
				"No skills or packs installed. Run npx agntc add owner/repo to get started.",
			);
		});
	});

	describe("update failure", () => {
		it("remains in detail view on update failure and shows error", async () => {
			const manifest = makeManifest(["owner/skill"]);

			// Outer loop iteration 1: select plugin
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(
				new Map([
					[
						"owner/skill",
						{ status: "update-available" as const, remoteCommit: "def456" },
					],
				]),
			);
			ui.select.mockResolvedValueOnce("owner/skill");

			// Inner detail loop iteration 1: re-read manifest, checkForUpdate, update fails
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "update-available" as const,
				remoteCommit: "def456",
			});
			mockRenderDetailView.mockResolvedValueOnce("update");
			mockExecuteUpdateAction.mockResolvedValueOnce({
				success: false,
				key: "owner/skill",
				message: "Clone failed",
				notes: [],
			});

			// Inner detail loop iteration 2: re-read manifest, user picks "back"
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "update-available" as const,
				remoteCommit: "def456",
			});
			mockRenderDetailView.mockResolvedValueOnce("back");

			// Outer loop iteration 2: Done
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce(null);

			await runListLoop(ui);

			expect(mockExecuteUpdateAction).toHaveBeenCalledTimes(1);
			expect(ui.log.error).toHaveBeenCalledWith("Clone failed");
			// Detail view rendered twice (before update, after failure)
			expect(mockRenderDetailView).toHaveBeenCalledTimes(2);
			// readManifestOrExit: 2 outer, readManifest: 2 inner
			expect(mockReadManifestOrExit).toHaveBeenCalledTimes(2);
			expect(mockReadManifest).toHaveBeenCalledTimes(2);
			expect(ui.select).toHaveBeenCalledTimes(2);
		});
	});

	describe("detail view receives correct input", () => {
		it("passes entry and update status from checkForUpdate to detail view", async () => {
			const entry = makeEntry({ ref: "main", commit: "abc123" });
			const manifest: Manifest = { "owner/skill": entry };
			const updateStatus: UpdateCheckResult = {
				status: "update-available",
				remoteCommit: "def456",
			};

			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(
				new Map([["owner/skill", updateStatus]]),
			);
			ui.select.mockResolvedValueOnce("owner/skill");

			// Inner loop: re-read manifest, checkForUpdate for single plugin, then "back"
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce(updateStatus);
			mockRenderDetailView.mockResolvedValueOnce("back");

			// Second outer iteration: Done
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(
				new Map([["owner/skill", updateStatus]]),
			);
			ui.select.mockResolvedValueOnce(null);

			await runListLoop(ui);

			expect(mockRenderDetailView).toHaveBeenCalledWith(
				{
					key: "owner/skill",
					entry,
					updateStatus,
					installRoot: "/fake/project",
				},
				ui,
			);
		});
	});

	describe("action functions receive correct arguments", () => {
		it("passes fresh entry and manifest to executeUpdateAction", async () => {
			const entry = makeEntry({ commit: "abc123" });
			const manifest: Manifest = { "owner/skill": entry };
			const updateStatus: UpdateCheckResult = {
				status: "update-available",
				remoteCommit: "def456",
			};

			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(
				new Map([["owner/skill", updateStatus]]),
			);
			ui.select.mockResolvedValueOnce("owner/skill");

			// Inner loop iteration 1: re-read manifest, checkForUpdate, render detail -> update
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce(updateStatus);
			mockRenderDetailView.mockResolvedValueOnce("update");
			mockExecuteUpdateAction.mockResolvedValueOnce({
				success: true,
				key: "owner/skill",
				message: "Updated owner/skill",
				notes: [],
			});

			// Inner loop iteration 2: re-read, back
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "up-to-date" as const,
			});
			mockRenderDetailView.mockResolvedValueOnce("back");

			// Second outer iteration: Done
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce(null);

			await runListLoop(ui);

			expect(mockExecuteUpdateAction).toHaveBeenCalledWith(
				"owner/skill",
				entry,
				manifest,
				projectScope("/fake/project"),
				ui,
				undefined,
			);
		});

		it("passes constrained-update overrides to executeUpdateAction", async () => {
			const entry = makeEntry({
				commit: "abc123",
				ref: "v1.0.0",
				constraint: "^1.0",
			});
			const manifest: Manifest = { "owner/skill": entry };
			const constrainedCommit = "ccc123";
			const constrainedStatus: UpdateCheckResult = {
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: constrainedCommit,
				latestOverall: null,
			};

			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(
				new Map([["owner/skill", constrainedStatus]]),
			);
			ui.select.mockResolvedValueOnce("owner/skill");

			// Inner loop iteration 1: re-read manifest, checkForUpdate returns constrained-update, render detail -> update
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce(constrainedStatus);
			mockRenderDetailView.mockResolvedValueOnce("update");
			mockExecuteUpdateAction.mockResolvedValueOnce({
				success: true,
				key: "owner/skill",
				message: "Updated owner/skill",
				notes: [],
			});

			// Inner loop iteration 2: re-read, back
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "constrained-up-to-date" as const,
				latestOverall: null,
			});
			mockRenderDetailView.mockResolvedValueOnce("back");

			// Second outer iteration: Done
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce(null);

			await runListLoop(ui);

			expect(mockExecuteUpdateAction).toHaveBeenCalledWith(
				"owner/skill",
				entry,
				manifest,
				projectScope("/fake/project"),
				ui,
				{ newRef: "v1.3.0", newCommit: constrainedCommit },
			);
		});

		it("does not pass overrides for non-constrained update", async () => {
			const entry = makeEntry({ commit: "abc123" });
			const manifest: Manifest = { "owner/skill": entry };
			const updateStatus: UpdateCheckResult = {
				status: "update-available",
				remoteCommit: "def456",
			};

			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(
				new Map([["owner/skill", updateStatus]]),
			);
			ui.select.mockResolvedValueOnce("owner/skill");

			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce(updateStatus);
			mockRenderDetailView.mockResolvedValueOnce("update");
			mockExecuteUpdateAction.mockResolvedValueOnce({
				success: true,
				key: "owner/skill",
				message: "Updated owner/skill",
				notes: [],
			});

			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "up-to-date" as const,
			});
			mockRenderDetailView.mockResolvedValueOnce("back");

			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce(null);

			await runListLoop(ui);

			// 6th arg should be undefined (no overrides for non-constrained)
			const callArgs = mockExecuteUpdateAction.mock.calls[0]!;
			expect(callArgs[5]).toBeUndefined();
		});

		it("passes fresh entry and manifest to executeRemoveAction", async () => {
			const entry = makeEntry();
			const manifest: Manifest = { "owner/skill": entry };

			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce("owner/skill");

			// Inner loop: re-read manifest, checkForUpdate, render detail -> remove
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "up-to-date" as const,
			});
			mockRenderDetailView.mockResolvedValueOnce("remove");
			mockExecuteRemoveAction.mockResolvedValueOnce({
				removed: true,
				message: "Removed owner/skill",
			});

			// Second outer iteration: empty
			mockReadManifestOrExit.mockResolvedValueOnce({});

			await runListLoop(ui);

			expect(mockExecuteRemoveAction).toHaveBeenCalledWith(
				"owner/skill",
				entry,
				manifest,
				projectScope("/fake/project"),
				ui,
			);
		});

		it("reads and acts on the global manifest in the global scope", async () => {
			const entry = makeEntry();
			const manifest: Manifest = { "owner/skill": entry };
			const scope = globalScope("/home/lee");

			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce("owner/skill");
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "up-to-date" as const,
			});
			mockRenderDetailView.mockResolvedValueOnce("remove");
			mockExecuteRemoveAction.mockResolvedValueOnce({
				removed: true,
				message: "Removed owner/skill",
			});
			mockReadManifestOrExit.mockResolvedValueOnce({});

			await runListLoop(ui, scope);

			expect(mockReadManifestOrExit).toHaveBeenCalledWith("/home/lee", ui);
			expect(mockReadManifest).toHaveBeenCalledWith("/home/lee");
			expect(mockRenderDetailView).toHaveBeenCalledWith(
				expect.objectContaining({ installRoot: "/home/lee" }),
				ui,
			);
			expect(mockExecuteRemoveAction).toHaveBeenCalledWith(
				"owner/skill",
				entry,
				manifest,
				scope,
				ui,
			);
		});
	});

	describe("spinner behavior", () => {
		it("shows spinner during update checks each outer iteration", async () => {
			const manifest = makeManifest(["owner/skill"]);

			// First outer iteration: back
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce("owner/skill");
			// Inner loop: re-read manifest, checkForUpdate, back
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "up-to-date" as const,
			});
			mockRenderDetailView.mockResolvedValueOnce("back");

			// Second outer iteration: Done
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce(null);

			await runListLoop(ui);

			expect(ui.spinners.flatMap((spin) => spin.start.mock.calls)).toHaveLength(
				2,
			);
			expect(ui.spinners.flatMap((spin) => spin.stop.mock.calls)).toHaveLength(
				2,
			);
		});
	});

	describe("label and hint formatting", () => {
		async function optionFor(
			entry: Partial<ManifestEntry>,
			result: UpdateCheckResult,
		): Promise<{ value: string; label: string; hint: string }> {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/skill": makeEntry(entry),
			});
			mockCheckAll.mockResolvedValue(new Map([["owner/skill", result]]));
			ui.select.mockResolvedValue(null);
			await runListLoop(ui);
			const options = ui.select.mock.calls.at(-1)![0].options as Array<{
				value: string;
				label: string;
				hint: string;
			}>;
			return options.find((o) => o.value === "owner/skill")!;
		}

		const upToDate: UpdateCheckResult = { status: "up-to-date" };

		// Label = "<key>  <ref|HEAD|local>"; the constraint is NOT shown in the list.
		it("labels with the tag when ref is a tag", async () => {
			expect((await optionFor({ ref: "v2.1.6" }, upToDate)).label).toBe(
				"owner/skill  v2.1.6",
			);
		});

		it("labels with the branch when ref is a branch", async () => {
			expect((await optionFor({ ref: "main" }, upToDate)).label).toBe(
				"owner/skill  main",
			);
		});

		it("labels HEAD when ref is null but a commit exists", async () => {
			expect(
				(await optionFor({ ref: null, commit: "a".repeat(40) }, upToDate))
					.label,
			).toBe("owner/skill  HEAD");
		});

		it("labels local when ref and commit are null", async () => {
			expect(
				(await optionFor({ ref: null, commit: null }, upToDate)).label,
			).toBe("owner/skill  local");
		});

		it("does not put the constraint in the list label", async () => {
			expect(
				(await optionFor({ ref: "v1.2.3", constraint: "^1.0" }, upToDate))
					.label,
			).toBe("owner/skill  v1.2.3");
		});

		it("shows terse status hints", async () => {
			expect((await optionFor({}, { status: "up-to-date" })).hint).toBe(
				"\u2713 up to date",
			);
			expect(
				(await optionFor({}, { status: "update-available", remoteCommit: "x" }))
					.hint,
			).toBe("\u2191 update available");
			expect(
				(
					await optionFor(
						{ ref: "v1.0.0" },
						{ status: "newer-tags", tags: ["v1.1.0"] },
					)
				).hint,
			).toBe("\u2691 newer tags");
			expect(
				(await optionFor({}, { status: "check-failed", reason: "timeout" }))
					.hint,
			).toBe("\u2717 check failed");
			expect(
				(await optionFor({ ref: null, commit: null }, { status: "local" }))
					.hint,
			).toBe("\u25CF local");
		});

		it("collapses constrained statuses to terse hints (detail carries the rest)", async () => {
			expect(
				(
					await optionFor(
						{ ref: "v1.3.0", constraint: "^1.0" },
						{ status: "constrained-up-to-date", latestOverall: "v2.0.0" },
					)
				).hint,
			).toBe("\u2713 up to date");
			expect(
				(
					await optionFor(
						{ ref: "v1.0.0", constraint: "^1.0" },
						{
							status: "constrained-update-available",
							tag: "v1.3.0",
							commit: "abc123",
							latestOverall: "v2.0.0",
						},
					)
				).hint,
			).toBe("\u2191 update available");
			expect(
				(
					await optionFor(
						{ ref: "v1.0.0", constraint: "^2.0" },
						{ status: "constrained-no-match" },
					)
				).hint,
			).toBe("\u2717 no matching version");
		});
	});

	describe("error handling", () => {
		it("throws ExitSignal on manifest read failure", async () => {
			mockReadManifestOrExit.mockRejectedValue(new ExitSignal(1));

			const err = await runListLoop(ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});
	});

	describe("update refreshes detail view with new data", () => {
		it("passes updated entry to detail view after successful update", async () => {
			const originalEntry = makeEntry({ commit: "abc123", ref: "main" });
			const manifest: Manifest = { "owner/skill": originalEntry };
			const updatedEntry = makeEntry({ commit: "def456", ref: "main" });
			const updatedManifest: Manifest = { "owner/skill": updatedEntry };

			// Outer loop iteration 1
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(
				new Map([
					[
						"owner/skill",
						{ status: "update-available" as const, remoteCommit: "def456" },
					],
				]),
			);
			ui.select.mockResolvedValueOnce("owner/skill");

			// Inner detail loop iteration 1: re-read manifest (returns original), checkForUpdate, update
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "update-available" as const,
				remoteCommit: "def456",
			});
			mockRenderDetailView.mockResolvedValueOnce("update");
			mockExecuteUpdateAction.mockResolvedValueOnce({
				success: true,
				key: "owner/skill",
				message: "Updated owner/skill",
				notes: [],
			});

			// Inner detail loop iteration 2: re-read manifest (returns updated), checkForUpdate, back
			mockReadManifest.mockResolvedValueOnce(updatedManifest);
			const newUpdateStatus: UpdateCheckResult = { status: "up-to-date" };
			mockCheckForUpdate.mockResolvedValueOnce(newUpdateStatus);
			mockRenderDetailView.mockResolvedValueOnce("back");

			// Outer loop iteration 2: Done
			mockReadManifestOrExit.mockResolvedValueOnce(updatedManifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce(null);

			await runListLoop(ui);

			// First detail render: original entry with update-available status
			expect(mockRenderDetailView).toHaveBeenNthCalledWith(
				1,
				{
					key: "owner/skill",
					entry: originalEntry,
					updateStatus: { status: "update-available", remoteCommit: "def456" },
					installRoot: "/fake/project",
				},
				ui,
			);

			// Second detail render: updated entry with fresh status
			expect(mockRenderDetailView).toHaveBeenNthCalledWith(
				2,
				{
					key: "owner/skill",
					entry: updatedEntry,
					updateStatus: newUpdateStatus,
					installRoot: "/fake/project",
				},
				ui,
			);
		});
	});

	describe("remove cancelled does not show success", () => {
		it("does not show success message when remove is cancelled", async () => {
			const manifest = makeManifest(["owner/skill"]);

			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce("owner/skill");

			// Inner loop: re-read manifest, checkForUpdate, render detail -> remove (cancelled)
			mockReadManifest.mockResolvedValueOnce(manifest);
			mockCheckForUpdate.mockResolvedValueOnce({
				status: "up-to-date" as const,
			});
			mockRenderDetailView.mockResolvedValueOnce("remove");
			mockExecuteRemoveAction.mockResolvedValueOnce({
				removed: false,
				message: "Cancelled",
			});

			// Remove cancelled -> breaks inner loop, returns to outer list
			// Second outer iteration: Done
			mockReadManifestOrExit.mockResolvedValueOnce(manifest);
			mockCheckAll.mockResolvedValueOnce(setupCheckResults(["owner/skill"]));
			ui.select.mockResolvedValueOnce(null);

			await runListLoop(ui);

			expect(ui.said("success")).toEqual([]);
		});
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
		expect(mockRenderDetailView).not.toHaveBeenCalled();
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
			ui.fail("Failed to read manifest: bad json", { style: "error" }),
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
