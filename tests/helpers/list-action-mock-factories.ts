import { vi } from "vitest";

/**
 * Factory bodies for the `vi.mock(path, factory)` calls shared by the two
 * list-action test files (`list-update-action.test.ts` and
 * `list-change-version-action.test.ts`).
 *
 * vitest hoists `vi.mock` to the top of the *declaring* file and needs the
 * literal module path at hoist time, so each `vi.mock(path, ...)` call must stay
 * in the test file. The factory *contents* — byte-identical across both files —
 * live here once and are delegated to via the dynamic-`import()`-inside-async-
 * factory pattern this codebase already uses for `mockCopySafety`.
 *
 * IMPORTANT: this module must NOT statically import any of the production
 * modules being mocked. Doing so would re-enter a half-evaluated mock factory
 * (the helper is `await import`ed *from inside* a `vi.mock` factory) and
 * deadlock module evaluation. Factories needing the real module receive
 * `importOriginal` as an argument instead.
 */

/**
 * Factory body for `vi.mock("../../src/manifest.js", ...)`. Spreads the real
 * module (preserving non-mocked exports) and replaces the three mutation
 * helpers with `vi.fn()`s. Both files mock manifest identically.
 */
export async function mockManifestModule(
	importOriginal: () => Promise<typeof import("../../src/manifest.js")>,
): Promise<typeof import("../../src/manifest.js")> {
	return {
		...(await importOriginal()),
		writeManifest: vi.fn(),
		addEntry: vi.fn(),
		removeEntry: vi.fn(),
	};
}

/** Factory body for `vi.mock("../../src/git-clone.js", ...)`. */
export function mockGitCloneModule() {
	return {
		cloneSource: vi.fn(),
		cleanupTempDir: vi.fn(),
	};
}

/** Factory body for `vi.mock("../../src/nuke-files.js", ...)`. */
export function mockNukeFilesModule() {
	return {
		nukeManifestFiles: vi.fn(),
	};
}

/**
 * Factory body for `vi.mock("../../src/copy-pack.js", ...)`. Keeps the real
 * target helpers update's in-the-way check predicts a pack's files with.
 */
export async function mockCopyPackModule(
	importOriginal: () => Promise<typeof import("../../src/copy-pack.js")>,
): Promise<typeof import("../../src/copy-pack.js")> {
	return {
		...(await importOriginal()),
		copyPack: vi.fn(),
	};
}

/**
 * Factory body for `vi.mock("../../src/discover.js", ...)`. Keeps the real
 * errors; `discover` itself is driven by each test, for the re-walk a skill
 * falls back to when its recorded path no longer holds one.
 */
export async function mockDiscoverModule(
	importOriginal: () => Promise<typeof import("../../src/discover.js")>,
): Promise<typeof import("../../src/discover.js")> {
	return {
		...(await importOriginal()),
		discover: vi.fn(),
	};
}

/**
 * Factory body for `vi.mock("../../src/unmanaged-check.js", ...)`. The files'
 * `node:fs/promises` mock can't tell a missing file from a present one, so
 * update's in-the-way check is driven directly.
 */
export function mockUnmanagedCheckModule() {
	return {
		checkUnmanagedConflicts: vi.fn(),
	};
}

/**
 * Factory body for `vi.mock("../../src/dropped-folders.js", ...)`. The files'
 * `node:fs/promises` mock can't list a source, so update's check for folders
 * it would drop that the source still has is driven directly.
 */
export function mockDroppedFoldersModule() {
	return {
		droppedButInSource: vi.fn(),
	};
}

/**
 * Factory body for `vi.mock("../../src/copy-bare-skill.js", ...)`. Keeps the
 * real skill unit update's symlink-escape pre-flight plans with.
 */
export async function mockCopyBareSkillModule(
	importOriginal: () => Promise<typeof import("../../src/copy-bare-skill.js")>,
): Promise<typeof import("../../src/copy-bare-skill.js")> {
	return {
		...(await importOriginal()),
		copyBareSkill: vi.fn(),
	};
}
