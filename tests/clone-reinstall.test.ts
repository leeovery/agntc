import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentId } from "../src/drivers/types.js";
import type { Manifest, ManifestEntry } from "../src/manifest.js";
import type { DetectedType } from "../src/type-detection.js";

vi.mock("@clack/prompts", () => ({
	spinner: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
		message: vi.fn(),
	})),
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		success: vi.fn(),
		message: vi.fn(),
	},
}));

vi.mock("../src/manifest.js", () => ({
	writeManifest: vi.fn(),
	removeEntry: vi.fn(),
}));

vi.mock("../src/git-clone.js", () => ({
	cloneSource: vi.fn(),
	cleanupTempDir: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
	readConfig: vi.fn(),
}));

vi.mock("../src/type-detection.js", () => ({
	detectType: vi.fn(),
}));

vi.mock("../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

vi.mock("../src/copy-plugin-assets.js", () => ({
	copyPluginAssets: vi.fn(),
}));

vi.mock("../src/copy-bare-skill.js", () => ({
	copyBareSkill: vi.fn(),
}));

vi.mock("../src/drivers/registry.js", () => ({
	getDriver: vi.fn(),
}));

import * as p from "@clack/prompts";
import type {
	CloneFailureHandlers,
	CloneReinstallFailed,
} from "../src/clone-reinstall.js";
import {
	buildFailureMessage,
	cloneAndReinstall,
	formatAgentsDroppedWarning,
	mapCloneFailure,
} from "../src/clone-reinstall.js";
import { readConfig } from "../src/config.js";
import { copyBareSkill } from "../src/copy-bare-skill.js";
import { copyPluginAssets } from "../src/copy-plugin-assets.js";
import { getDriver } from "../src/drivers/registry.js";
import { cleanupTempDir, cloneSource } from "../src/git-clone.js";
import { removeEntry, writeManifest } from "../src/manifest.js";
import { nukeManifestFiles } from "../src/nuke-files.js";
import { detectType } from "../src/type-detection.js";

const mockWriteManifest = vi.mocked(writeManifest);
const mockRemoveEntry = vi.mocked(removeEntry);

const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockReadConfig = vi.mocked(readConfig);
const mockDetectType = vi.mocked(detectType);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockGetDriver = vi.mocked(getDriver);
const mockLog = vi.mocked(p.log);

const INSTALLED_SHA = "a".repeat(40);
const REMOTE_SHA = "b".repeat(40);

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
	return {
		ref: null,
		commit: INSTALLED_SHA,
		installedAt: "2026-02-01T00:00:00.000Z",
		agents: ["claude"],
		files: [".claude/skills/my-skill/"],
		cloneUrl: null,
		...overrides,
	};
}

const fakeDriver = {
	detect: vi.fn().mockResolvedValue(true),
	getTargetDir: vi.fn((assetType: string) => {
		if (assetType === "skills") return ".claude/skills";
		if (assetType === "agents") return ".claude/agents";
		if (assetType === "hooks") return ".claude/hooks";
		return null;
	}),
};

beforeEach(() => {
	vi.clearAllMocks();
	mockCleanupTempDir.mockResolvedValue(undefined);
	mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
	mockGetDriver.mockReturnValue(fakeDriver);
	mockWriteManifest.mockResolvedValue(undefined);
	mockRemoveEntry.mockImplementation((manifest, key) => {
		const { [key]: _, ...rest } = manifest;
		return rest;
	});
});

describe("formatAgentsDroppedWarning", () => {
	it("formats the warning with key, dropped agents, installed agents, and new agents", () => {
		const result = formatAgentsDroppedWarning(
			"owner/repo",
			["codex"] as AgentId[],
			["claude", "codex"] as AgentId[],
			["claude"] as AgentId[],
		);

		expect(result).toBe(
			"Plugin owner/repo no longer declares support for codex. " +
				"Currently installed for: claude, codex. " +
				"New version supports: claude.",
		);
	});

	it("formats with multiple dropped agents", () => {
		const result = formatAgentsDroppedWarning(
			"owner/repo",
			["claude", "codex"] as AgentId[],
			["claude", "codex"] as AgentId[],
			[] as AgentId[],
		);

		expect(result).toContain("claude, codex");
	});
});

describe("cloneAndReinstall", () => {
	describe("git (remote) path — success", () => {
		it("returns success with manifest entry, copied files, and dropped agents", async () => {
			const entry = makeEntry({
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.manifestEntry.commit).toBe(REMOTE_SHA);
				expect(result.manifestEntry.agents).toEqual(["claude"]);
				expect(result.copiedFiles).toEqual([".claude/skills/my-skill/"]);
				expect(result.droppedAgents).toEqual([]);
			}
		});

		it("clones, nukes, copies in correct order", async () => {
			const entry = makeEntry();

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);

			const callOrder: string[] = [];
			mockCloneSource.mockImplementation(async () => {
				callOrder.push("clone");
				return { tempDir: "/tmp/agntc-clone", commit: REMOTE_SHA };
			});
			mockNukeManifestFiles.mockImplementation(async () => {
				callOrder.push("nuke");
				return { removed: [], skipped: [] };
			});
			mockCopyBareSkill.mockImplementation(async () => {
				callOrder.push("copy");
				return { copiedFiles: [".claude/skills/my-skill/"] };
			});

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(callOrder).toEqual(["clone", "nuke", "copy"]);
		});

		it("cleans up temp dir on success", async () => {
			const entry = makeEntry();

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("cleans up temp dir on failure", async () => {
			const entry = makeEntry();

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue(null);

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("uses spinner for clone", async () => {
			const entry = makeEntry();
			const mockSpinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
			vi.mocked(p.spinner).mockReturnValue(
				mockSpinner as ReturnType<typeof p.spinner>,
			);

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(mockSpinner.start).toHaveBeenCalledWith("Cloning repository...");
			expect(mockSpinner.stop).toHaveBeenCalledWith("Cloned successfully");
		});
	});

	describe("no-config status", () => {
		it("returns failed with no-config message for remote", async () => {
			const entry = makeEntry();

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue(null);

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("failed");
			if (result.status === "failed") {
				expect(result.failureReason).toBe("no-config");
				expect(result.message).toContain("no agntc.json");
			}
		});
	});

	describe("no-agents status", () => {
		it("returns failed with no-agents message", async () => {
			const entry = makeEntry({ agents: ["codex"] });

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// New version only supports claude, entry has codex
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("failed");
			if (result.status === "failed") {
				expect(result.failureReason).toBe("no-agents");
				expect(result.message).toContain(
					"no longer supports any of your installed agents",
				);
			}
		});

		it("does not nuke files when all agents dropped", async () => {
			const entry = makeEntry({ agents: ["codex"] });

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});
	});

	describe("invalid-type status", () => {
		it("returns failed with invalid-type message", async () => {
			const entry = makeEntry();

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "not-agntc",
			} as DetectedType);

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("failed");
			if (result.status === "failed") {
				expect(result.failureReason).toBe("invalid-type");
				expect(result.message).toContain("not a valid plugin");
			}
		});
	});

	describe("copy-failed status", () => {
		it("returns failed with copy-failed reason and recovery hint", async () => {
			const entry = makeEntry();

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("failed");
			if (result.status === "failed") {
				expect(result.failureReason).toBe("copy-failed");
				expect(result.message).toContain("npx agntc update owner/repo");
			}
		});

		it("removes entry from manifest when manifest is provided", async () => {
			const entry = makeEntry();
			const manifest: Manifest = { "owner/repo": entry };

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
				manifest,
			});

			expect(mockRemoveEntry).toHaveBeenCalledWith(manifest, "owner/repo");
			expect(mockWriteManifest).toHaveBeenCalledWith(
				"/fake/project",
				expect.not.objectContaining({ "owner/repo": expect.anything() }),
			);
		});

		it("does not write manifest when manifest is not provided", async () => {
			const entry = makeEntry();

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("clone failure", () => {
		it("returns failed with clone-failed reason", async () => {
			const entry = makeEntry();

			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("failed");
			if (result.status === "failed") {
				expect(result.failureReason).toBe("clone-failed");
				expect(result.message).toContain("git clone failed");
			}
		});

		it("does not nuke on clone failure", async () => {
			const entry = makeEntry();

			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});
	});

	describe("agents dropped warning", () => {
		it("emits warning when agents are partially dropped", async () => {
			const entry = makeEntry({
				agents: ["claude", "codex"],
				files: [".claude/skills/my-skill/", ".agents/skills/my-skill/"],
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.droppedAgents).toEqual(["codex"]);
			}
			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringContaining("codex"),
			);
		});
	});

	describe("local path (no clone)", () => {
		it("returns success without cloning for local entry", async () => {
			const key = "/Users/lee/Code/my-plugin";
			const entry = makeEntry({
				commit: null,
				ref: null,
				agents: ["claude"],
				files: [".claude/skills/my-plugin/"],
			});

			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			const result = await cloneAndReinstall({
				key,
				entry,
				projectDir: "/fake/project",
				sourceDir: key,
			});

			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.manifestEntry.commit).toBeNull();
				expect(result.manifestEntry.ref).toBeNull();
			}
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockCleanupTempDir).not.toHaveBeenCalled();
		});
	});

	describe("newRef and newCommit overrides", () => {
		it("uses newRef when provided", async () => {
			const entry = makeEntry({ ref: "v1.0.0" });

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
				newRef: "v2.0.0",
			});

			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.manifestEntry.ref).toBe("v2.0.0");
			}
		});
	});

	describe("collection key", () => {
		it("resolves sourceDir from key when key has 3+ segments", async () => {
			const entry = makeEntry({
				agents: ["claude"],
				files: [".claude/skills/go/"],
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			const result = await cloneAndReinstall({
				key: "owner/repo/go",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("success");
			// readConfig should be called with the subdir
			expect(mockReadConfig).toHaveBeenCalledWith(
				"/tmp/agntc-clone/go",
				expect.anything(),
			);
		});
	});
});

describe("mapCloneFailure", () => {
	function makeHandlers(): CloneFailureHandlers<string> {
		return {
			onCloneFailed: (msg) => `clone-failed: ${msg}`,
			onNoConfig: (msg) => `no-config: ${msg}`,
			onNoAgents: (msg) => `no-agents: ${msg}`,
			onInvalidType: (msg) => `invalid-type: ${msg}`,
			onCopyFailed: (msg) => `copy-failed: ${msg}`,
			onUnknown: (msg) => `unknown: ${msg}`,
		};
	}

	it("dispatches clone-failed to onCloneFailed handler", () => {
		const result = mapCloneFailure(
			{
				status: "failed",
				failureReason: "clone-failed",
				message: "network error",
			},
			makeHandlers(),
		);
		expect(result).toBe("clone-failed: network error");
	});

	it("dispatches no-config to onNoConfig handler", () => {
		const result = mapCloneFailure(
			{
				status: "failed",
				failureReason: "no-config",
				message: "no agntc.json",
			},
			makeHandlers(),
		);
		expect(result).toBe("no-config: no agntc.json");
	});

	it("dispatches no-agents to onNoAgents handler", () => {
		const result = mapCloneFailure(
			{ status: "failed", failureReason: "no-agents", message: "no agents" },
			makeHandlers(),
		);
		expect(result).toBe("no-agents: no agents");
	});

	it("dispatches invalid-type to onInvalidType handler", () => {
		const result = mapCloneFailure(
			{ status: "failed", failureReason: "invalid-type", message: "not valid" },
			makeHandlers(),
		);
		expect(result).toBe("invalid-type: not valid");
	});

	it("dispatches copy-failed to onCopyFailed handler", () => {
		const result = mapCloneFailure(
			{ status: "failed", failureReason: "copy-failed", message: "disk full" },
			makeHandlers(),
		);
		expect(result).toBe("copy-failed: disk full");
	});

	it("dispatches unknown to onUnknown handler", () => {
		const result = mapCloneFailure(
			{ status: "failed", failureReason: "unknown", message: "something" },
			makeHandlers(),
		);
		expect(result).toBe("unknown: something");
	});

	it("returns the typed result from handler", () => {
		const handlers: CloneFailureHandlers<number> = {
			onCloneFailed: () => 1,
			onNoConfig: () => 2,
			onNoAgents: () => 3,
			onInvalidType: () => 4,
			onCopyFailed: () => 5,
			onUnknown: () => 6,
		};
		const result = mapCloneFailure(
			{ status: "failed", failureReason: "no-config", message: "test" },
			handlers,
		);
		expect(result).toBe(2);
	});
});

describe("buildFailureMessage", () => {
	function makeFailed(
		failureReason: CloneReinstallFailed["failureReason"],
		message: string,
	): CloneReinstallFailed {
		return { status: "failed", failureReason, message };
	}

	describe("passthrough reasons (clone-failed, copy-failed, unknown)", () => {
		it("returns result.message for clone-failed", () => {
			const msg = buildFailureMessage(
				makeFailed("clone-failed", "network error"),
				"owner/repo",
			);
			expect(msg).toBe("network error");
		});

		it("returns result.message for copy-failed", () => {
			const msg = buildFailureMessage(
				makeFailed("copy-failed", "disk full hint"),
				"owner/repo",
			);
			expect(msg).toBe("disk full hint");
		});

		it("returns result.message for unknown", () => {
			const msg = buildFailureMessage(
				makeFailed("unknown", "something went wrong"),
				"owner/repo",
			);
			expect(msg).toBe("something went wrong");
		});
	});

	describe("no-agents", () => {
		it("returns standard message regardless of isChangeVersion", () => {
			const msg = buildFailureMessage(
				makeFailed("no-agents", "ignored"),
				"owner/repo",
			);
			expect(msg).toBe(
				"Plugin owner/repo no longer supports any of your installed agents",
			);
		});

		it("returns same message with isChangeVersion true", () => {
			const msg = buildFailureMessage(
				makeFailed("no-agents", "ignored"),
				"owner/repo",
				{ isChangeVersion: true },
			);
			expect(msg).toBe(
				"Plugin owner/repo no longer supports any of your installed agents",
			);
		});
	});

	describe("no-config without isChangeVersion", () => {
		it("returns plain message", () => {
			const msg = buildFailureMessage(
				makeFailed("no-config", "ignored"),
				"owner/repo",
			);
			expect(msg).toBe("owner/repo has no agntc.json");
		});
	});

	describe("no-config with isChangeVersion", () => {
		it("returns prefixed message", () => {
			const msg = buildFailureMessage(
				makeFailed("no-config", "ignored"),
				"owner/repo",
				{ isChangeVersion: true },
			);
			expect(msg).toBe("New version of owner/repo has no agntc.json");
		});
	});

	describe("invalid-type without isChangeVersion", () => {
		it("returns plain message", () => {
			const msg = buildFailureMessage(
				makeFailed("invalid-type", "ignored"),
				"owner/repo",
			);
			expect(msg).toBe("owner/repo is not a valid plugin");
		});
	});

	describe("invalid-type with isChangeVersion", () => {
		it("returns prefixed message", () => {
			const msg = buildFailureMessage(
				makeFailed("invalid-type", "ignored"),
				"owner/repo",
				{ isChangeVersion: true },
			);
			expect(msg).toBe("New version of owner/repo is not a valid plugin");
		});
	});
});
