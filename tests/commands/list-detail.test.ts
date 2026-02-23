import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManifestEntry } from "../../src/manifest.js";
import type { UpdateCheckResult } from "../../src/update-check.js";

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

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
	return {
		ref: "v1.0.0",
		commit: "abc1234567890def",
		installedAt: "2026-01-15T10:30:45.000Z",
		agents: ["claude"],
		files: [".claude/skills/my-skill/SKILL.md"],
		cloneUrl: null,
		...overrides,
	};
}

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

		it("displays agents joined by comma", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ entry: { agents: ["claude", "codex"] } }),
			);

			expect(mockLog.info).toHaveBeenCalledWith("Agents: claude, codex");
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

			expect(mockLog.info).toHaveBeenCalledWith("  claude: 2 skill(s)");
		});

		it("displays per-agent asset counts for codex files", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: {
						files: [".agents/skills/a/SKILL.md"],
					},
				}),
			);

			expect(mockLog.info).toHaveBeenCalledWith("  codex: 1 skill(s)");
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
				"  claude: 2 skill(s), 1 hook(s)",
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
				"  claude: 2 skill(s), 1 hook(s)",
			);
			expect(mockLog.info).toHaveBeenCalledWith("  codex: 2 skill(s)");
		});

		it("groups unknown prefixes under other agent", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: {
						files: ["some/random/file.txt"],
					},
				}),
			);

			expect(mockLog.info).toHaveBeenCalledWith("  other: 1 other");
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

			expect(mockLog.info).toHaveBeenCalledWith("  claude: 1 agent(s)");
		});

		it("shows no asset lines when files array is empty", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(makeInput({ entry: { files: [] } }));

			// With no files, no per-agent lines should be logged
			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			const assetLines = infoCalls.filter(
				(line) =>
					line.startsWith("  claude:") ||
					line.startsWith("  codex:") ||
					line.startsWith("  other:"),
			);
			expect(assetLines).toHaveLength(0);
		});
	});

	describe("file list", () => {
		it("displays each file with indent", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					entry: {
						files: [".claude/skills/a/SKILL.md", ".claude/hooks/lint.sh"],
					},
				}),
			);

			expect(mockLog.message).toHaveBeenCalledWith(
				"  .claude/skills/a/SKILL.md",
			);
			expect(mockLog.message).toHaveBeenCalledWith("  .claude/hooks/lint.sh");
		});

		it("displays all files when many are present", async () => {
			mockSelect.mockResolvedValue("back");

			const files = Array.from(
				{ length: 20 },
				(_, i) => `.claude/skills/skill-${i}/SKILL.md`,
			);

			await renderDetailView(makeInput({ entry: { files } }));

			expect(mockLog.message).toHaveBeenCalledTimes(20);
			for (const file of files) {
				expect(mockLog.message).toHaveBeenCalledWith(`  ${file}`);
			}
		});
	});

	describe("actions by status", () => {
		it("update-available shows Update, Remove, Back", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					updateStatus: { status: "update-available", remoteCommit: "def456" },
				}),
			);

			const selectCall = mockSelect.mock.calls[0]![0];
			const options = selectCall.options as Array<{
				value: DetailAction;
				label: string;
			}>;
			expect(options).toEqual([
				{ value: "update", label: "Update" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("up-to-date shows Remove, Back", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({ updateStatus: { status: "up-to-date" } }),
			);

			const selectCall = mockSelect.mock.calls[0]![0];
			const options = selectCall.options as Array<{
				value: DetailAction;
				label: string;
			}>;
			expect(options).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("newer-tags shows Change version, Remove, Back", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					updateStatus: { status: "newer-tags", tags: ["v2.0.0"] },
				}),
			);

			const selectCall = mockSelect.mock.calls[0]![0];
			const options = selectCall.options as Array<{
				value: DetailAction;
				label: string;
			}>;
			expect(options).toEqual([
				{ value: "change-version", label: "Change version" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("check-failed shows Remove, Back", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(
				makeInput({
					updateStatus: { status: "check-failed", reason: "timeout" },
				}),
			);

			const selectCall = mockSelect.mock.calls[0]![0];
			const options = selectCall.options as Array<{
				value: DetailAction;
				label: string;
			}>;
			expect(options).toEqual([
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
		});

		it("local shows Update, Remove, Back", async () => {
			mockSelect.mockResolvedValue("back");

			await renderDetailView(makeInput({ updateStatus: { status: "local" } }));

			const selectCall = mockSelect.mock.calls[0]![0];
			const options = selectCall.options as Array<{
				value: DetailAction;
				label: string;
			}>;
			expect(options).toEqual([
				{ value: "update", label: "Update" },
				{ value: "remove", label: "Remove" },
				{ value: "back", label: "Back" },
			]);
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
