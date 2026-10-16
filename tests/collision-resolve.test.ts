import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../src/manifest.js";

// Mock nukeManifestFiles
vi.mock("../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn().mockResolvedValue({ removed: [], skipped: [] }),
}));

import {
	PartialRemovalError,
	removeCollidingEntries,
	resolveCollisions,
} from "../src/collision-resolve.js";
import { nukeManifestFiles } from "../src/nuke-files.js";
import { makeEntry } from "./helpers/factories.js";
import { type TestUi, testUi } from "./helpers/test-ui.js";

const mockedNuke = vi.mocked(nukeManifestFiles);
let ui: TestUi;

beforeEach(() => {
	vi.clearAllMocks();
	ui = testUi();
});

describe("resolveCollisions", () => {
	it("returns resolved true with unchanged manifest when no collisions", async () => {
		const manifest: Manifest = {
			"owner/repo-a": makeEntry({
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/skill-a/"],
			}),
		};
		const collisions = new Map<string, string[]>();

		const result = await resolveCollisions(
			collisions,
			manifest,
			"/project",
			ui,
		);

		expect(result.resolved).toBe(true);
		expect(result.updatedManifest).toEqual(manifest);
		expect(ui.select).not.toHaveBeenCalled();
	});

	it("removes colliding plugin when user chooses remove", async () => {
		const manifest: Manifest = {
			"owner/repo-a": makeEntry({
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/skill-a/", ".claude/agents/executor.md"],
			}),
			"owner/repo-b": makeEntry({
				ref: null,
				commit: "def456",
				installedAt: "2026-01-16T10:00:00.000Z",
				files: [".claude/skills/skill-b/"],
			}),
		};
		const collisions = new Map<string, string[]>([
			["owner/repo-a", [".claude/skills/skill-a/"]],
		]);

		ui.select.mockResolvedValueOnce("remove");

		const result = await resolveCollisions(
			collisions,
			manifest,
			"/project",
			ui,
		);

		expect(result.resolved).toBe(true);
		// repo-a should be removed from manifest
		expect(result.updatedManifest["owner/repo-a"]).toBeUndefined();
		// repo-b should remain
		expect(result.updatedManifest["owner/repo-b"]).toEqual(
			manifest["owner/repo-b"],
		);
		// nukeManifestFiles should have been called with all files from repo-a
		expect(mockedNuke).toHaveBeenCalledWith("/project", [
			".claude/skills/skill-a/",
			".claude/agents/executor.md",
		]);
	});

	it("returns resolved false when user chooses cancel", async () => {
		const manifest: Manifest = {
			"owner/repo-a": makeEntry({
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/skill-a/"],
			}),
		};
		const collisions = new Map<string, string[]>([
			["owner/repo-a", [".claude/skills/skill-a/"]],
		]);

		ui.select.mockResolvedValueOnce("cancel");

		const result = await resolveCollisions(
			collisions,
			manifest,
			"/project",
			ui,
		);

		expect(result.resolved).toBe(false);
		// Manifest unchanged
		expect(result.updatedManifest).toEqual(manifest);
		expect(mockedNuke).not.toHaveBeenCalled();
	});

	it("resolves multiple colliding plugins sequentially", async () => {
		const manifest: Manifest = {
			"owner/repo-a": makeEntry({
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/skill-a/"],
			}),
			"owner/repo-b": makeEntry({
				ref: null,
				commit: "def456",
				installedAt: "2026-01-16T10:00:00.000Z",
				files: [".claude/agents/my-agent.md"],
			}),
			"owner/repo-c": makeEntry({
				ref: "v1",
				commit: "ghi789",
				installedAt: "2026-01-17T10:00:00.000Z",
				files: [".claude/skills/skill-c/"],
			}),
		};
		const collisions = new Map<string, string[]>([
			["owner/repo-a", [".claude/skills/skill-a/"]],
			["owner/repo-b", [".claude/agents/my-agent.md"]],
		]);

		// User removes both
		ui.select.mockResolvedValueOnce("remove");
		ui.select.mockResolvedValueOnce("remove");

		const result = await resolveCollisions(
			collisions,
			manifest,
			"/project",
			ui,
		);

		expect(result.resolved).toBe(true);
		expect(result.updatedManifest["owner/repo-a"]).toBeUndefined();
		expect(result.updatedManifest["owner/repo-b"]).toBeUndefined();
		expect(result.updatedManifest["owner/repo-c"]).toEqual(
			manifest["owner/repo-c"],
		);
		expect(ui.select).toHaveBeenCalledTimes(2);
		expect(mockedNuke).toHaveBeenCalledTimes(2);
	});

	it("stops on cancel during sequential resolution", async () => {
		const manifest: Manifest = {
			"owner/repo-a": makeEntry({
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/skill-a/"],
			}),
			"owner/repo-b": makeEntry({
				ref: null,
				commit: "def456",
				installedAt: "2026-01-16T10:00:00.000Z",
				files: [".claude/agents/my-agent.md"],
			}),
			"owner/repo-c": makeEntry({
				ref: "v1",
				commit: "ghi789",
				installedAt: "2026-01-17T10:00:00.000Z",
				files: [".claude/skills/skill-c/"],
			}),
		};
		const collisions = new Map<string, string[]>([
			["owner/repo-a", [".claude/skills/skill-a/"]],
			["owner/repo-b", [".claude/agents/my-agent.md"]],
		]);

		// User removes first but cancels second
		ui.select.mockResolvedValueOnce("remove");
		ui.select.mockResolvedValueOnce("cancel");

		const result = await resolveCollisions(
			collisions,
			manifest,
			"/project",
			ui,
		);

		// Cancel stops everything
		expect(result.resolved).toBe(false);
		// First plugin was already removed
		expect(mockedNuke).toHaveBeenCalledTimes(1);
		expect(ui.select).toHaveBeenCalledTimes(2);
		// repo-a was already nuked from disk, so manifest must reflect its removal
		expect(result.updatedManifest["owner/repo-a"]).toBeUndefined();
		// repo-b cancel happened before processing — still present
		expect(result.updatedManifest["owner/repo-b"]).toEqual(
			manifest["owner/repo-b"],
		);
		// Non-colliding entry preserved
		expect(result.updatedManifest["owner/repo-c"]).toEqual(
			manifest["owner/repo-c"],
		);
	});

	it("treats a dismissed select (null) as cancel", async () => {
		const manifest: Manifest = {
			"owner/repo-a": makeEntry({
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/skill-a/"],
			}),
		};
		const collisions = new Map<string, string[]>([
			["owner/repo-a", [".claude/skills/skill-a/"]],
		]);

		ui.select.mockResolvedValueOnce(null);

		const result = await resolveCollisions(
			collisions,
			manifest,
			"/project",
			ui,
		);

		expect(result.resolved).toBe(false);
		expect(mockedNuke).not.toHaveBeenCalled();
	});

	it("calls box with file list and collision title before select", async () => {
		const manifest: Manifest = {
			"owner/repo-a": makeEntry({
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/skill-a/", ".claude/agents/executor.md"],
			}),
		};
		const collisions = new Map<string, string[]>([
			[
				"owner/repo-a",
				[".claude/skills/skill-a/", ".claude/agents/executor.md"],
			],
		]);

		ui.select.mockResolvedValueOnce("remove");

		await resolveCollisions(collisions, manifest, "/project", ui);

		expect(ui.box).toHaveBeenCalledWith(
			"  - .claude/skills/skill-a/\n  - .claude/agents/executor.md",
			'File collision with "owner/repo-a"',
		);
		// box() must be called before select()
		const boxOrder = ui.box.mock.invocationCallOrder[0];
		const selectOrder = ui.select.mock.invocationCallOrder[0];
		expect(boxOrder).toBeLessThan(selectOrder!);
	});

	it("select message is single-line with plugin key (collision)", async () => {
		const manifest: Manifest = {
			"owner/repo-a": makeEntry({
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/skill-a/"],
			}),
		};
		const collisions = new Map<string, string[]>([
			["owner/repo-a", [".claude/skills/skill-a/"]],
		]);

		ui.select.mockResolvedValueOnce("cancel");

		await resolveCollisions(collisions, manifest, "/project", ui);

		const call = ui.select.mock.calls[0]!;
		const { message } = call[0] as { message: string };
		expect(message).toBe('How would you like to proceed with "owner/repo-a"?');
		expect(message).not.toContain("\n");
	});

	it("calls box for each collision in sequential resolution", async () => {
		const manifest: Manifest = {
			"owner/repo-a": makeEntry({
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/skill-a/"],
			}),
			"owner/repo-b": makeEntry({
				ref: null,
				commit: "def456",
				installedAt: "2026-01-16T10:00:00.000Z",
				files: [".claude/agents/my-agent.md"],
			}),
		};
		const collisions = new Map<string, string[]>([
			["owner/repo-a", [".claude/skills/skill-a/"]],
			["owner/repo-b", [".claude/agents/my-agent.md"]],
		]);

		ui.select.mockResolvedValueOnce("remove");
		ui.select.mockResolvedValueOnce("remove");

		await resolveCollisions(collisions, manifest, "/project", ui);

		expect(ui.box).toHaveBeenCalledTimes(2);
		expect(ui.box).toHaveBeenNthCalledWith(
			1,
			"  - .claude/skills/skill-a/",
			'File collision with "owner/repo-a"',
		);
		expect(ui.box).toHaveBeenNthCalledWith(
			2,
			"  - .claude/agents/my-agent.md",
			'File collision with "owner/repo-b"',
		);
	});

	it("does not offer install-anyway option", async () => {
		const manifest: Manifest = {
			"owner/repo-a": makeEntry({
				ref: "main",
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/skill-a/"],
			}),
		};
		const collisions = new Map<string, string[]>([
			["owner/repo-a", [".claude/skills/skill-a/"]],
		]);

		ui.select.mockResolvedValueOnce("cancel");

		await resolveCollisions(collisions, manifest, "/project", ui);

		// Verify the options passed to select do NOT include "install-anyway"
		const call = ui.select.mock.calls[0]!;
		const options = (call[0] as { options: Array<{ value: string }> }).options;
		const values = options.map((o) => o.value);
		expect(values).not.toContain("install-anyway");
		expect(values).toContain("remove");
		expect(values).toContain("cancel");
	});
});

describe("removeCollidingEntries", () => {
	const entry = (files: string[]) =>
		makeEntry({
			ref: "main",
			commit: "abc123",
			installedAt: "2026-01-15T10:00:00.000Z",
			files,
		});

	it("deletes each named entry's files and drops it from the manifest, asking nothing", async () => {
		const manifest: Manifest = {
			"owner/repo-a": entry([".claude/skills/a/"]),
			"owner/repo-b": entry([".claude/skills/b/"]),
			"owner/repo-c": entry([".claude/skills/c/"]),
		};

		const result = await removeCollidingEntries(
			["owner/repo-a", "owner/repo-b"],
			manifest,
			"/project",
		);

		expect(result).toEqual({ "owner/repo-c": manifest["owner/repo-c"] });
		expect(mockedNuke).toHaveBeenCalledWith("/project", [".claude/skills/a/"]);
		expect(mockedNuke).toHaveBeenCalledWith("/project", [".claude/skills/b/"]);
		expect(ui.select).not.toHaveBeenCalled();
		expect(ui.box).not.toHaveBeenCalled();
	});

	describe("when a removal fails", () => {
		const manifest: Manifest = {
			"owner/repo-a": entry([".claude/skills/a/"]),
			"owner/repo-b": entry([".claude/skills/b/"]),
			"owner/repo-c": entry([".claude/skills/c/"]),
		};

		async function partialRemoval(
			run: Promise<unknown>,
		): Promise<PartialRemovalError> {
			const err = await run.then(
				() => null,
				(error: unknown) => error,
			);
			expect(err).toBeInstanceOf(PartialRemovalError);
			return err as PartialRemovalError;
		}

		beforeEach(() => {
			mockedNuke
				.mockResolvedValueOnce({ removed: [], skipped: [] })
				.mockRejectedValueOnce(new Error("EACCES: permission denied"));
		});

		it("throws with the manifest that drops the entries removed before it and keeps the one that failed", async () => {
			const err = await partialRemoval(
				removeCollidingEntries(
					["owner/repo-a", "owner/repo-b"],
					manifest,
					"/project",
				),
			);

			expect(err.message).toBe("EACCES: permission denied");
			expect(err.manifest).toEqual({
				"owner/repo-b": manifest["owner/repo-b"],
				"owner/repo-c": manifest["owner/repo-c"],
			});
		});

		it("carries the same manifest out of the prompt", async () => {
			ui.select.mockResolvedValueOnce("remove").mockResolvedValueOnce("remove");

			const err = await partialRemoval(
				resolveCollisions(
					new Map([
						["owner/repo-a", [".claude/skills/a/"]],
						["owner/repo-b", [".claude/skills/b/"]],
					]),
					manifest,
					"/project",
					ui,
				),
			);

			expect(err.manifest).toEqual({
				"owner/repo-b": manifest["owner/repo-b"],
				"owner/repo-c": manifest["owner/repo-c"],
			});
		});
	});

	it("passes over a key the manifest no longer holds", async () => {
		const manifest: Manifest = {
			"owner/repo-a": entry([".claude/skills/a/"]),
		};

		const result = await removeCollidingEntries(
			["owner/gone"],
			manifest,
			"/project",
		);

		expect(result).toEqual(manifest);
		expect(mockedNuke).not.toHaveBeenCalled();
	});
});
