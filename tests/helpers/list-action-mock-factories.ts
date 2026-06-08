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
 * factory pattern this codebase already uses for `mockClack`/`mockCopySafety`.
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

/** Factory body for `vi.mock("../../src/config.js", ...)`. */
export function mockConfigModule() {
	return {
		readConfig: vi.fn(),
	};
}

/**
 * Factory body for `vi.mock("../../src/type-detection.js", ...)`. Mocks
 * `detectType` while keeping the real `ASSET_DIRS` constant both files rely on.
 */
export async function mockTypeDetectionModule(
	importOriginal: () => Promise<typeof import("../../src/type-detection.js")>,
) {
	const actual = await importOriginal();
	return {
		detectType: vi.fn(),
		ASSET_DIRS: actual.ASSET_DIRS,
	};
}

/** Factory body for `vi.mock("../../src/nuke-files.js", ...)`. */
export function mockNukeFilesModule() {
	return {
		nukeManifestFiles: vi.fn(),
	};
}

/** Factory body for `vi.mock("../../src/copy-plugin-assets.js", ...)`. */
export function mockCopyPluginAssetsModule() {
	return {
		copyPluginAssets: vi.fn(),
	};
}

/** Factory body for `vi.mock("../../src/copy-bare-skill.js", ...)`. */
export function mockCopyBareSkillModule() {
	return {
		copyBareSkill: vi.fn(),
	};
}

/** Factory body for `vi.mock("../../src/drivers/registry.js", ...)`. */
export function mockDriversRegistryModule() {
	return {
		getDriver: vi.fn(),
	};
}
