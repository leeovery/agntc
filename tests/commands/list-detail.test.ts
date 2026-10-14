import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManifestEntry } from "../../src/manifest.js";
import type { UpdateCheckResult } from "../../src/update-check.js";
import { makeEntry } from "../helpers/factories.js";
import { SSH_REFUSAL } from "../helpers/git-mocks.js";

vi.mock("@clack/prompts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@clack/prompts")>();
	return {
		...actual,
		select: vi.fn(),
		isCancel: vi.fn((value: unknown) => typeof value === "symbol"),
		log: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			success: vi.fn(),
			message: vi.fn(),
		},
	};
});

import * as p from "@clack/prompts";
import {
	type DetailAction,
	type DetailViewInput,
	renderDetailView,
} from "../../src/commands/list-detail.js";
import { interactiveUi } from "../../src/ui.js";

const mockSelect = vi.mocked(p.select);
const mockLog = vi.mocked(p.log);

let installRoot: string;

function makeInput(
	overrides: {
		key?: string;
		entry?: Partial<ManifestEntry>;
		updateStatus?: UpdateCheckResult;
	} = {},
): DetailViewInput {
	return {
		key: overrides.key ?? "owner/repo",
		entry: makeEntry(overrides.entry),
		updateStatus: overrides.updateStatus ?? { status: "up-to-date" },
		installRoot,
	};
}

/** Writes empty files under the install root. */
async function installedFiles(...paths: string[]): Promise<void> {
	for (const path of paths) {
		const full = join(installRoot, path);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, "");
	}
}

beforeEach(async () => {
	vi.clearAllMocks();
	installRoot = await mkdtemp(join(tmpdir(), "agntc-list-detail-"));
});

afterEach(async () => {
	await rm(installRoot, { recursive: true, force: true });
});

describe("renderDetailView", () => {
	describe("info display", () => {
		it("displays a skill's key under Skill", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ key: "acme/toolkit", entry: { type: "skill" } }),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Skill: acme/toolkit");
		});

		it("displays a pack's key under Pack", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ key: "acme/toolkit/laravel", entry: { type: "pack" } }),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Pack: acme/toolkit/laravel");
		});

		it("displays an untyped entry's key under Skill", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(makeInput({ key: "acme/toolkit" }), interactiveUi);

			expect(mockLog.info).toHaveBeenCalledWith("Skill: acme/toolkit");
		});

		it("displays ref as tag value when ref is set", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: { ref: "v2.3.1" } }),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Ref: v2.3.1");
		});

		it("displays ref as HEAD when ref is null but commit exists", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: { ref: null, commit: "abc1234567890def" } }),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Ref: HEAD");
		});

		it("displays ref as local when ref and commit are both null", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: { ref: null, commit: null } }),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Ref: local");
		});

		it("truncates commit to 7 characters", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: { commit: "abc1234567890def" } }),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Commit: abc1234");
		});

		it("displays em dash when commit is null", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: { commit: null } }),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Commit: \u2014");
		});

		it("formats install date as date only", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: { installedAt: "2026-02-10T14:22:33.000Z" } }),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Installed: 2026-02-10");
		});

		it("names no agent anywhere in the detail view", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: { files: [".claude/skills/a/SKILL.md"] } }),
				interactiveUi,
			);

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			expect(infoCalls.some((line) => line.startsWith("Agents:"))).toBe(false);
			expect(infoCalls.some((line) => /claude/i.test(line))).toBe(false);
		});

		it("displays constraint line when entry has constraint", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: { constraint: "^1.0.0" } }),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Constraint: ^1.0.0");
		});

		it("does not display constraint line when entry has no constraint", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(makeInput(), interactiveUi);

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			const constraintLines = infoCalls.filter((line) =>
				line.startsWith("Constraint:"),
			);
			expect(constraintLines).toHaveLength(0);
		});
	});

	describe("asset counts", () => {
		it("displays asset counts on one line", async () => {
			mockSelect.mockResolvedValue("back");
			await installedFiles(
				".claude/skills/a/SKILL.md",
				".claude/skills/b/SKILL.md",
			);

			await renderDetailView(
				makeInput({
					entry: { files: [".claude/skills/a/", ".claude/skills/b/"] },
				}),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Assets: 2 skills");
		});

		it("counts a skill folder once, however many of its paths are recorded", async () => {
			mockSelect.mockResolvedValue("back");
			await installedFiles(".claude/skills/a/SKILL.md");

			await renderDetailView(
				makeInput({
					entry: {
						files: [
							".claude/skills/a/",
							".claude/skills/a/SKILL.md",
							".claude/skills/a/refs/guide.md",
						],
					},
				}),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Assets: 1 skill");
		});

		it("displays mixed asset types", async () => {
			mockSelect.mockResolvedValue("back");
			await installedFiles(
				".claude/skills/a/SKILL.md",
				".claude/skills/b/SKILL.md",
			);

			await renderDetailView(
				makeInput({
					entry: {
						files: [
							".claude/skills/a/",
							".claude/skills/b/",
							".claude/hooks/pre-commit.sh",
						],
					},
				}),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Assets: 2 skills, 1 hook");
		});

		it("counts a pack's installed folders without a SKILL.md as support folders, worded as add words them", async () => {
			mockSelect.mockResolvedValue("back");
			await installedFiles(
				".claude/skills/a/SKILL.md",
				".claude/skills/b/SKILL.md",
				".claude/skills/shared/references/x.md",
				".claude/skills/gates/.claude-plugin/plugin.json",
				".claude/skills/rows/hooks/hooks.json",
			);

			await renderDetailView(
				makeInput({
					entry: {
						type: "pack",
						files: [
							".claude/skills/a/",
							".claude/skills/b/",
							".claude/skills/gates/",
							".claude/skills/rows/",
							".claude/skills/shared/",
							".claude/agents/x.md",
						],
					},
				}),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith(
				"Assets: 2 skills, 3 folders, 1 agent",
			);
		});

		it("gives a pack's skill count even when it holds only support folders", async () => {
			mockSelect.mockResolvedValue("back");
			await installedFiles(".claude/skills/shared/references/x.md");

			await renderDetailView(
				makeInput({
					entry: { type: "pack", files: [".claude/skills/shared/"] },
				}),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Assets: 0 skills, 1 folder");
		});

		it("never counts a loose file v1 recorded in .claude/skills as a folder", async () => {
			mockSelect.mockResolvedValue("back");
			await installedFiles(
				".claude/skills/a/SKILL.md",
				".claude/skills/README.md",
			);

			await renderDetailView(
				makeInput({
					entry: {
						type: "pack",
						files: [".claude/skills/README.md", ".claude/skills/a/"],
					},
				}),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Assets: 1 skill");
		});

		it("counts agent files", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: {
						files: [".claude/agents/agent-a.md"],
					},
				}),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith("Assets: 1 agent");
		});

		it("omits the assets line when the entry has no files", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: { files: [] } }),
				interactiveUi,
			);

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			expect(infoCalls.some((line) => line.startsWith("Assets:"))).toBe(false);
		});
	});

	describe("file list", () => {
		it("does NOT dump the raw file paths (removed for a cleaner detail view)", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: {
						files: [".claude/skills/a/SKILL.md", ".claude/hooks/lint.sh"],
					},
				}),
				interactiveUi,
			);

			const messages = mockLog.message.mock.calls.map((c) => c[0] as string);
			expect(messages.some((m) => m.includes(".claude/skills/"))).toBe(false);
			expect(messages.some((m) => m.includes(".claude/hooks/"))).toBe(false);
		});
	});

	// Extracts the action options passed to the select prompt from the most
	// recent renderDetailView call.
	function renderedActions(): Array<{ value: DetailAction; label: string }> {
		const selectCall = mockSelect.mock.calls[0]![0];
		return selectCall.options as Array<{ value: DetailAction; label: string }>;
	}

	describe("update action by status", () => {
		// A HEAD-tracking ref (null) so change-version never appears — this isolates
		// which statuses surface the Update action.
		const headEntry = { ref: null, commit: "a".repeat(40) };

		it("update-available shows Update", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: headEntry,
					updateStatus: { status: "update-available", remoteCommit: "def456" },
				}),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "update", label: "Update" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("local shows Update", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: headEntry, updateStatus: { status: "local" } }),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "update", label: "Update" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("up-to-date shows no Update", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: headEntry, updateStatus: { status: "up-to-date" } }),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("newer-tags on a HEAD ref shows neither Update nor Change version", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: headEntry,
					updateStatus: { status: "newer-tags", tags: ["v2.0.0"] },
				}),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("constrained-no-match shows no Update", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: headEntry,
					updateStatus: { status: "constrained-no-match" },
				}),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});
	});

	describe("change-version availability", () => {
		it("offers Change version for a tag-pinned install that is up to date", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { ref: "v2.0.0" },
					updateStatus: { status: "up-to-date" },
				}),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "change-version", label: "Change version" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("offers Change version for newer-tags on a tag-pinned install", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { ref: "v1.0.0" },
					updateStatus: { status: "newer-tags", tags: ["v2.0.0"] },
				}),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "change-version", label: "Change version" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("offers Update and Change version for constrained-update-available on a tag-pinned install", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { ref: "v1.2.0" },
					updateStatus: {
						status: "constrained-update-available",
						tag: "v1.3.0",
						commit: "abc123",
						latestOverall: null,
					},
				}),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "update", label: "Update" },
				{ value: "change-version", label: "Change version" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("offers Change version for constrained-up-to-date on a tag-pinned install (even without latestOverall)", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { ref: "v1.2.0" },
					updateStatus: {
						status: "constrained-up-to-date",
						latestOverall: null,
					},
				}),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "change-version", label: "Change version" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("offers Change version for constrained-no-match on a tag-pinned install (recovery path)", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { ref: "v1.0.0" },
					updateStatus: { status: "constrained-no-match" },
				}),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "change-version", label: "Change version" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("does NOT offer Change version when the remote is unreachable (check-failed)", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { ref: "v1.0.0" },
					updateStatus: { status: "check-failed", reason: "timeout" },
				}),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("does NOT offer Change version for a HEAD-tracking install (ref is null)", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { ref: null, commit: "a".repeat(40) },
					updateStatus: { status: "up-to-date" },
				}),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("does NOT offer Change version for a branch-tracking install (ref is not a version)", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { ref: "main", commit: "a".repeat(40) },
					updateStatus: { status: "up-to-date" },
				}),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("renders a real status for a v4-branch entry", async () => {
			// Cross-surface recovery: with the classification fix a "v4" branch install
			// reaches the detail view with a real status (update-available), so the
			// Update action is offered normally — no degraded check-failed rendering.
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { ref: "v4", commit: "a".repeat(40) },
					updateStatus: {
						status: "update-available",
						remoteCommit: "b".repeat(40),
					},
				}),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "update", label: "Update" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("does NOT offer Change version for a v4-branch ref (isVersionTag false, out of scope)", async () => {
			// "v4" resembles a tag but is not full semver, so isVersionTag("v4") is
			// false — Change version stays disabled by design, even though the status
			// is now a real one. Re-enabling it for branch refs is out of scope.
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { ref: "v4", commit: "a".repeat(40) },
					updateStatus: { status: "up-to-date" },
				}),
				interactiveUi,
			);

			expect(renderedActions()).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});
	});

	describe("contextual messages", () => {
		it("constrained-no-match shows error with constraint expression", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { constraint: "^1.0.0" },
					updateStatus: { status: "constrained-no-match" },
				}),
				interactiveUi,
			);

			expect(mockLog.error).toHaveBeenCalledWith(
				'No matching version found for constraint "^1.0.0"',
			);
		});

		it("check-failed says why, in one line", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					updateStatus: { status: "check-failed", reason: SSH_REFUSAL },
				}),
				interactiveUi,
			);

			expect(mockLog.warn.mock.calls).toEqual([
				[
					"Couldn't check for updates (git@github.com: Permission denied (publickey).)",
				],
			]);
		});

		it("a check that didn't fail says nothing of one", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ updateStatus: { status: "up-to-date" } }),
				interactiveUi,
			);

			expect(mockLog.warn).not.toHaveBeenCalled();
		});

		it("constrained-up-to-date with latestOverall shows info about version outside constraint", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { constraint: "^1.0.0" },
					updateStatus: {
						status: "constrained-up-to-date",
						latestOverall: "v2.0.0",
					},
				}),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith(
				"Constraint: ^1.0.0 (v2.0.0 available outside constraint)",
			);
		});

		it("constrained-up-to-date without latestOverall shows no extra info", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { constraint: "^1.0.0" },
					updateStatus: {
						status: "constrained-up-to-date",
						latestOverall: null,
					},
				}),
				interactiveUi,
			);

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			const outsideConstraintCalls = infoCalls.filter((line) =>
				line.includes("outside constraint"),
			);
			expect(outsideConstraintCalls).toHaveLength(0);
		});

		it("constrained-update-available with latestOverall shows info about version outside constraint", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { constraint: "^1.0.0" },
					updateStatus: {
						status: "constrained-update-available",
						tag: "v1.3.0",
						commit: "abc123",
						latestOverall: "v2.0.0",
					},
				}),
				interactiveUi,
			);

			expect(mockLog.info).toHaveBeenCalledWith(
				"Constraint: ^1.0.0 (v2.0.0 available outside constraint)",
			);
		});

		it("constrained-update-available without latestOverall shows no extra info", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: { constraint: "^1.0.0" },
					updateStatus: {
						status: "constrained-update-available",
						tag: "v1.3.0",
						commit: "abc123",
						latestOverall: null,
					},
				}),
				interactiveUi,
			);

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			const outsideConstraintCalls = infoCalls.filter((line) =>
				line.includes("outside constraint"),
			);
			expect(outsideConstraintCalls).toHaveLength(0);
		});
	});

	describe("action selection", () => {
		it("returns selected action value", async () => {
			mockSelect.mockResolvedValue("remove");

			const result = await renderDetailView(makeInput(), interactiveUi);

			expect(result).toBe("remove");
		});

		it("cancel returns back", async () => {
			mockSelect.mockResolvedValue(Symbol("cancel"));

			const result = await renderDetailView(makeInput(), interactiveUi);

			expect(result).toBe("back");
		});
	});

	describe("select prompt", () => {
		it("uses Action as the select message", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(makeInput(), interactiveUi);

			const selectCall = mockSelect.mock.calls[0]![0];
			expect(selectCall.message).toBe("Action");
		});
	});
});
