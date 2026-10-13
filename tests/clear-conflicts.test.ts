import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/collision-resolve.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/collision-resolve.js")>()),
	resolveCollisions: vi.fn(),
}));

vi.mock("../src/unmanaged-resolve.js", () => ({
	resolveUnmanagedConflicts: vi.fn(),
}));

import {
	type ConflictPolicy,
	clearConflicts,
	conflictPolicy,
} from "../src/clear-conflicts.js";
import { resolveCollisions } from "../src/collision-resolve.js";
import type { Manifest, ManifestEntry } from "../src/manifest.js";
import { interactiveUi } from "../src/ui.js";
import { resolveUnmanagedConflicts } from "../src/unmanaged-resolve.js";

const mockResolveCollisions = vi.mocked(resolveCollisions);
const mockResolveUnmanaged = vi.mocked(resolveUnmanagedConflicts);

const INCOMING = [".claude/skills/a/"];

let projectDir: string;

beforeEach(async () => {
	vi.clearAllMocks();
	projectDir = await mkdtemp(join(tmpdir(), "agntc-conflicts-"));
});

afterEach(async () => {
	await rm(projectDir, { recursive: true, force: true });
});

function entry(files: string[]): ManifestEntry {
	return {
		ref: null,
		commit: "c",
		installedAt: "2026-01-01T00:00:00.000Z",
		files,
		cloneUrl: null,
	};
}

async function onDisk(file: string): Promise<void> {
	const full = join(projectDir, file, "SKILL.md");
	await mkdir(dirname(full), { recursive: true });
	await writeFile(full, "");
}

function clear(manifest: Manifest, policy: ConflictPolicy) {
	return clearConflicts(
		{ incomingFiles: INCOMING, manifest, key: "owner/repo/a", projectDir },
		policy,
		interactiveUi,
	);
}

describe("conflictPolicy", () => {
	it.each([
		[true, "interactive", "overwrite"],
		[true, "machine", "overwrite"],
		[false, "interactive", "ask"],
		[false, "machine", "stop"],
	] as const)("with --overwrite %s in %s mode is %s", (overwrite, mode, policy) => {
		expect(conflictPolicy(overwrite, mode)).toBe(policy);
	});
});

describe("clearConflicts", () => {
	describe("against another entry's files", () => {
		const manifest: Manifest = { "other/repo": entry(INCOMING) };

		beforeEach(async () => {
			await onDisk(".claude/skills/a/");
		});

		it("removes that entry and its files when overwriting", async () => {
			const cleared = await clear(manifest, "overwrite");

			expect(cleared).toEqual({ manifest: {}, stop: null });
			expect(mockResolveCollisions).not.toHaveBeenCalled();
		});

		it("asks when it may", async () => {
			mockResolveCollisions.mockResolvedValue({
				resolved: false,
				updatedManifest: manifest,
			});

			const cleared = await clear(manifest, "ask");

			expect(cleared.stop).toEqual({ reason: "conflict not resolved" });
			expect(mockResolveCollisions).toHaveBeenCalledOnce();
		});

		it("stops the item, naming the owner, the files and --overwrite", async () => {
			const cleared = await clear(manifest, "stop");

			expect(cleared).toEqual({
				manifest,
				stop: {
					reason: "files in the way belong to other/repo: .claude/skills/a/",
					flags: ["--overwrite"],
				},
			});
		});
	});

	describe("against files agntc didn't install", () => {
		beforeEach(async () => {
			await onDisk(".claude/skills/a/");
		});

		it("lets them be replaced when overwriting", async () => {
			expect(await clear({}, "overwrite")).toEqual({
				manifest: {},
				stop: null,
			});
			expect(mockResolveUnmanaged).not.toHaveBeenCalled();
		});

		it("asks when it may", async () => {
			mockResolveUnmanaged.mockResolvedValue({
				approved: INCOMING,
				cancelled: [],
			});

			expect((await clear({}, "ask")).stop).toBeNull();
			expect(mockResolveUnmanaged).toHaveBeenCalledWith(
				[{ pluginKey: "owner/repo/a", files: INCOMING }],
				interactiveUi,
			);
		});

		it("stops the item, naming the files and --overwrite", async () => {
			expect((await clear({}, "stop")).stop).toEqual({
				reason:
					"files in the way weren't installed by agntc: .claude/skills/a/",
				flags: ["--overwrite"],
			});
		});
	});

	it("lets an item through with nothing in its way, whatever the policy", async () => {
		for (const policy of ["overwrite", "ask", "stop"] as const) {
			expect(await clear({}, policy)).toEqual({ manifest: {}, stop: null });
		}
		expect(mockResolveCollisions).not.toHaveBeenCalled();
		expect(mockResolveUnmanaged).not.toHaveBeenCalled();
	});
});
