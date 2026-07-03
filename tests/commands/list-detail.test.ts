import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManifestEntry } from "../../src/manifest.js";
import type { UpdateCheckResult } from "../../src/update-check.js";
import { makeEntry } from "../helpers/factories.js";

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

const mockSelect = vi.mocked(p.select);
const mockLog = vi.mocked(p.log);

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
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("renderDetailView", () => {
	describe("info display", () => {
		it("displays plugin key", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(makeInput({ key: "acme/toolkit" }));

			expect(mockLog.info).toHaveBeenCalledWith("Plugin: acme/toolkit");
		});

		it("displays ref as tag value when ref is set", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(makeInput({ entry: { ref: "v2.3.1" } }));

			expect(mockLog.info).toHaveBeenCalledWith("Ref: v2.3.1");
		});

		it("displays ref as HEAD when ref is null but commit exists", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: { ref: null, commit: "abc1234567890def" } }),
			);

			expect(mockLog.info).toHaveBeenCalledWith("Ref: HEAD");
		});

		it("displays ref as local when ref and commit are both null", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(makeInput({ entry: { ref: null, commit: null } }));

			expect(mockLog.info).toHaveBeenCalledWith("Ref: local");
		});

		it("truncates commit to 7 characters", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: { commit: "abc1234567890def" } }),
			);

			expect(mockLog.info).toHaveBeenCalledWith("Commit: abc1234");
		});

		it("displays em dash when commit is null", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(makeInput({ entry: { commit: null } }));

			expect(mockLog.info).toHaveBeenCalledWith("Commit: \u2014");
		});

		it("formats install date as date only", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: { installedAt: "2026-02-10T14:22:33.000Z" } }),
			);

			expect(mockLog.info).toHaveBeenCalledWith("Installed: 2026-02-10");
		});

		it("displays agents with per-agent counts on one line", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: {
						agents: ["claude", "codex"],
						files: [".claude/skills/a/SKILL.md", ".agents/skills/b/SKILL.md"],
					},
				}),
			);

			expect(mockLog.info).toHaveBeenCalledWith(
				"Agents: claude (1 skill), codex (1 skill)",
			);
		});

		it("displays constraint line when entry has constraint", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(makeInput({ entry: { constraint: "^1.0.0" } }));

			expect(mockLog.info).toHaveBeenCalledWith("Constraint: ^1.0.0");
		});

		it("does not display constraint line when entry has no constraint", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(makeInput());

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			const constraintLines = infoCalls.filter((line) =>
				line.startsWith("Constraint:"),
			);
			expect(constraintLines).toHaveLength(0);
		});
	});

	describe("asset counts", () => {
		it("displays per-agent asset counts for claude files", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: {
						files: [".claude/skills/a/SKILL.md", ".claude/skills/b/SKILL.md"],
					},
				}),
			);

			expect(mockLog.info).toHaveBeenCalledWith("Agents: claude (2 skills)");
		});

		it("displays per-agent asset counts for codex files", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: {
						agents: ["codex"],
						files: [".agents/skills/a/SKILL.md"],
					},
				}),
			);

			expect(mockLog.info).toHaveBeenCalledWith("Agents: codex (1 skill)");
		});

		it("displays mixed asset types for a single agent", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: {
						files: [
							".claude/skills/a/SKILL.md",
							".claude/skills/b/SKILL.md",
							".claude/hooks/pre-commit.sh",
						],
					},
				}),
			);

			expect(mockLog.info).toHaveBeenCalledWith(
				"Agents: claude (2 skills, 1 hook)",
			);
		});

		it("displays both agent lines for multi-agent plugin", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: {
						agents: ["claude", "codex"],
						files: [
							".claude/skills/a/SKILL.md",
							".claude/skills/b/SKILL.md",
							".claude/hooks/pre-commit.sh",
							".agents/skills/c/SKILL.md",
							".agents/skills/d/SKILL.md",
						],
					},
				}),
			);

			expect(mockLog.info).toHaveBeenCalledWith(
				"Agents: claude (2 skills, 1 hook), codex (2 skills)",
			);
		});

		it("counts agent files within an agent group", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: {
						files: [".claude/agents/agent-a.md"],
					},
				}),
			);

			expect(mockLog.info).toHaveBeenCalledWith("Agents: claude (1 agent)");
		});

		it("lists an agent without counts when it has no files", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(makeInput({ entry: { files: [] } }));

			// No files → the agent is still listed, just without a count suffix.
			expect(mockLog.info).toHaveBeenCalledWith("Agents: claude");
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
			);

			expect(mockLog.error).toHaveBeenCalledWith(
				'No matching version found for constraint "^1.0.0"',
			);
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

			const result = await renderDetailView(makeInput());

			expect(result).toBe("remove");
		});

		it("cancel returns back", async () => {
			mockSelect.mockResolvedValue(Symbol("cancel"));

			const result = await renderDetailView(makeInput());

			expect(result).toBe("back");
		});
	});

	describe("select prompt", () => {
		it("uses Action as the select message", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(makeInput());

			const selectCall = mockSelect.mock.calls[0]![0];
			expect(selectCall.message).toBe("Action");
		});
	});
});
