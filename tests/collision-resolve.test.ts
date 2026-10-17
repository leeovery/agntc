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
const HOME = "/home/lee";
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
			HOME,
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
			HOME,
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
			HOME,
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
			HOME,
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
			HOME,
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
			HOME,
		);

		expect(result.resolved).toBe(false);
		expect(mockedNuke).not.toHaveBeenCalled();
	});

	it("asks under the entry's row, naming the files of its in the way, dim", async () => {
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

		await resolveCollisions(collisions, manifest, "/project", ui, HOME);

		const row = {
			status: "attention",
			subject: "owner/repo-a",
			detail: "its files are in the way",
			children: [
				{ name: ".claude/skills/skill-a/", dim: true },
				{ name: ".claude/agents/executor.md", dim: true },
			],
		};
		expect(ui.block).toHaveBeenCalledExactlyOnceWith([row]);
		expect(ui.blocks[0]!.select).toHaveBeenCalledExactlyOnceWith(row, {
			message: "How would you like to proceed?",
			options: [
				{ value: "remove", label: "Remove it and continue" },
				{ value: "cancel", label: "Cancel installation" },
			],
		});
		expect(ui.blocks[0]!.row).not.toHaveBeenCalled();
	});

	it("names a local entry on its row by its folder, shortened against the home folder, and nowhere in the question", async () => {
		const key = `${HOME}/src/kit/loose1`;
		const manifest: Manifest = {
			[key]: makeEntry({
				commit: null,
				cloneUrl: null,
				files: [".claude/skills/loose1/"],
			}),
		};
		const collisions = new Map([[key, [".claude/skills/loose1/"]]]);

		ui.select.mockResolvedValueOnce("cancel");

		await resolveCollisions(collisions, manifest, "/project", ui, HOME);

		const [row, prompt] = ui.blocks[0]!.select.mock.calls[0]!;
		expect(row).toMatchObject({ subject: "~/src/kit/loose1" });
		expect(JSON.stringify(prompt)).not.toContain("kit");
	});

	it("asks about each collision under a row of its own", async () => {
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

		await resolveCollisions(collisions, manifest, "/project", ui, HOME);

		expect(ui.blocks.map((block) => block.select.mock.calls[0]![0])).toEqual([
			expect.objectContaining({
				subject: "owner/repo-a",
				children: [{ name: ".claude/skills/skill-a/", dim: true }],
			}),
			expect.objectContaining({
				subject: "owner/repo-b",
				children: [{ name: ".claude/agents/my-agent.md", dim: true }],
			}),
		]);
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

		await resolveCollisions(collisions, manifest, "/project", ui, HOME);

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

		const stdout = vi.spyOn(process.stdout, "write");
		const stderr = vi.spyOn(process.stderr, "write");

		const result = await removeCollidingEntries(
			["owner/repo-a", "owner/repo-b"],
			manifest,
			"/project",
		);
		const written = stdout.mock.calls.length + stderr.mock.calls.length;
		stdout.mockRestore();
		stderr.mockRestore();

		expect(result).toEqual({ "owner/repo-c": manifest["owner/repo-c"] });
		expect(mockedNuke).toHaveBeenCalledWith("/project", [".claude/skills/a/"]);
		expect(mockedNuke).toHaveBeenCalledWith("/project", [".claude/skills/b/"]);
		expect(written).toBe(0);
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
					HOME,
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
