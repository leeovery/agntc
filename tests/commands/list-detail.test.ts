import { describe, expect, it } from "vitest";
import {
	askAction,
	type DetailAction,
	detailActions,
} from "../../src/commands/list-detail.js";
import type { ManifestEntry } from "../../src/manifest.js";
import type { Row } from "../../src/terminal/types.js";
import type { UpdateCheckResult } from "../../src/update-check.js";
import { makeEntry } from "../helpers/factories.js";
import { testUi } from "../helpers/test-ui.js";

interface Viewed {
	entry: ManifestEntry;
	updateStatus: UpdateCheckResult;
}

function makeInput(
	overrides: {
		entry?: Partial<ManifestEntry>;
		updateStatus?: UpdateCheckResult;
	} = {},
): Viewed {
	return {
		entry: makeEntry(overrides.entry),
		updateStatus: overrides.updateStatus ?? { status: "up-to-date" },
	};
}

let actions: Array<{ value: DetailAction; label: string }>;

/** The actions offered for the entry its check found as it did. */
function offer({ entry, updateStatus }: Viewed): void {
	actions = detailActions(entry.ref, updateStatus);
}

describe("detailActions", () => {
	describe("update action by status", () => {
		// A HEAD-tracking ref (null) so change-version never appears — this isolates
		// which statuses surface the Update action.
		const headEntry = { ref: null, commit: "a".repeat(40) };

		it("update-available shows Update", async () => {
			offer(
				makeInput({
					entry: headEntry,
					updateStatus: { status: "update-available", remoteCommit: "def456" },
				}),
			);

			expect(actions).toEqual([
				{ value: "update", label: "Update" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("local shows Update", async () => {
			offer(makeInput({ entry: headEntry, updateStatus: { status: "local" } }));

			expect(actions).toEqual([
				{ value: "update", label: "Update" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("up-to-date shows no Update", async () => {
			offer(
				makeInput({ entry: headEntry, updateStatus: { status: "up-to-date" } }),
			);

			expect(actions).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("newer-tags on a HEAD ref shows neither Update nor Change version", async () => {
			offer(
				makeInput({
					entry: headEntry,
					updateStatus: { status: "newer-tags", tags: ["v2.0.0"] },
				}),
			);

			expect(actions).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("constrained-no-match shows no Update", async () => {
			offer(
				makeInput({
					entry: headEntry,
					updateStatus: { status: "constrained-no-match" },
				}),
			);

			expect(actions).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});
	});

	describe("change-version availability", () => {
		it("offers Change version for a tag-pinned install that is up to date", async () => {
			offer(
				makeInput({
					entry: { ref: "v2.0.0" },
					updateStatus: { status: "up-to-date" },
				}),
			);

			expect(actions).toEqual([
				{ value: "change-version", label: "Change version" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("offers Change version for newer-tags on a tag-pinned install", async () => {
			offer(
				makeInput({
					entry: { ref: "v1.0.0" },
					updateStatus: { status: "newer-tags", tags: ["v2.0.0"] },
				}),
			);

			expect(actions).toEqual([
				{ value: "change-version", label: "Change version" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("offers Update and Change version for constrained-update-available on a tag-pinned install", async () => {
			offer(
				makeInput({
					entry: { ref: "v1.2.0" },
					updateStatus: {
						status: "constrained-update-available",
						tag: "v1.3.0",
						commit: "abc123",
						latestOverall: null,
					},
				}),
			);

			expect(actions).toEqual([
				{ value: "update", label: "Update" },
				{ value: "change-version", label: "Change version" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("offers Change version for constrained-up-to-date on a tag-pinned install (even without latestOverall)", async () => {
			offer(
				makeInput({
					entry: { ref: "v1.2.0" },
					updateStatus: {
						status: "constrained-up-to-date",
						latestOverall: null,
					},
				}),
			);

			expect(actions).toEqual([
				{ value: "change-version", label: "Change version" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("offers Change version for constrained-no-match on a tag-pinned install (recovery path)", async () => {
			offer(
				makeInput({
					entry: { ref: "v1.0.0" },
					updateStatus: { status: "constrained-no-match" },
				}),
			);

			expect(actions).toEqual([
				{ value: "change-version", label: "Change version" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("does NOT offer Change version when the remote is unreachable (check-failed)", async () => {
			offer(
				makeInput({
					entry: { ref: "v1.0.0" },
					updateStatus: { status: "check-failed", reason: "timeout" },
				}),
			);

			expect(actions).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("does NOT offer Change version for a HEAD-tracking install (ref is null)", async () => {
			offer(
				makeInput({
					entry: { ref: null, commit: "a".repeat(40) },
					updateStatus: { status: "up-to-date" },
				}),
			);

			expect(actions).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("does NOT offer Change version for a branch-tracking install (ref is not a version)", async () => {
			offer(
				makeInput({
					entry: { ref: "main", commit: "a".repeat(40) },
					updateStatus: { status: "up-to-date" },
				}),
			);

			expect(actions).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("renders a real status for a v4-branch entry", async () => {
			// Cross-surface recovery: with the classification fix a "v4" branch install
			// reaches the detail view with a real status (update-available), so the
			// Update action is offered normally — no degraded check-failed rendering.
			offer(
				makeInput({
					entry: { ref: "v4", commit: "a".repeat(40) },
					updateStatus: {
						status: "update-available",
						remoteCommit: "b".repeat(40),
					},
				}),
			);

			expect(actions).toEqual([
				{ value: "update", label: "Update" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("does NOT offer Change version for a v4-branch ref (isVersionTag false, out of scope)", async () => {
			// "v4" resembles a tag but is not full semver, so isVersionTag("v4") is
			// false — Change version stays disabled by design, even though the status
			// is now a real one. Re-enabling it for branch refs is out of scope.
			offer(
				makeInput({
					entry: { ref: "v4", commit: "a".repeat(40) },
					updateStatus: { status: "up-to-date" },
				}),
			);

			expect(actions).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});
	});
});

describe("askAction", () => {
	const ROW: Row = {
		status: "subject",
		subject: "owner/repo",
		detail: "skill",
	};

	it("asks what to do under the entry's row, in a block measured from it", async () => {
		const ui = testUi();
		ui.select.mockResolvedValue("remove");

		const action = await askAction(ROW, null, { status: "up-to-date" }, ui);

		expect(action).toBe("remove");
		expect(ui.block).toHaveBeenCalledWith([ROW]);
		expect(ui.blocks[0]!.select).toHaveBeenCalledWith(ROW, {
			message: "Action",
			options: [
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			],
		});
	});

	it("goes back when the question is cancelled", async () => {
		const ui = testUi();
		ui.select.mockResolvedValue(null);

		expect(await askAction(ROW, null, { status: "up-to-date" }, ui)).toBe(
			"back",
		);
	});

	it("never asks through the old surface", async () => {
		const ui = testUi();
		ui.select.mockResolvedValue("back");

		await askAction(ROW, null, { status: "up-to-date" }, ui);

		expect(ui.select).toHaveBeenCalledOnce();
		expect(ui.blocks[0]!.select).toHaveBeenCalledOnce();
		expect(ui.log.info).not.toHaveBeenCalled();
	});
});
