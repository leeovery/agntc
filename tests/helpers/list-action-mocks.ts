import { access } from "node:fs/promises";
import { basename } from "node:path";
import { beforeEach, type Mock, vi } from "vitest";
import { copyBareSkill } from "../../src/copy-bare-skill.js";
import { copyPack } from "../../src/copy-pack.js";
import { scanForEscapingSymlinks } from "../../src/copy-safety.js";
import { type Discovery, discover } from "../../src/discover.js";
import { cleanupTempDir, cloneSource } from "../../src/git-clone.js";
import { addEntry, removeEntry, writeManifest } from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { checkUnmanagedConflicts } from "../../src/unmanaged-check.js";

/**
 * Shared non-hoisted test wiring for the two list-action test files
 * (`list-update-action.test.ts` and `list-change-version-action.test.ts`): the
 * `vi.mocked` handles both drive and assert against, the `INSTALLED_SHA` /
 * `REMOTE_SHA` constants, and the common `beforeEach`
 * defaults. Authored once so a change to the clone-reinstall surface is a
 * single edit.
 *
 * This module statically imports the production modules it resolves handles
 * from, so it is consumed at *module scope* in each test file — never from
 * inside a `vi.mock` factory. (The hoisted factory bodies live in the
 * import-free `./list-action-mock-factories.js`; mixing the two would re-enter a
 * half-evaluated mock and deadlock.) By the time `setupListActionMocks` runs,
 * the test file's `vi.mock` calls have already replaced these modules, so the
 * imported bindings are the mocks.
 */

/** The recorded commit SHA standing in for the currently-installed version. */
export const INSTALLED_SHA = "a".repeat(40);
/** The commit SHA standing in for the re-cloned remote version. */
export const REMOTE_SHA = "b".repeat(40);

/**
 * The shared `vi.mocked` handles both list-action test files drive and assert
 * against. Each is the same `vi.fn()` the production code under test invoked,
 * because the underlying modules are mocked identically in both files.
 */
export interface ListActionMocks {
	writeManifest: Mock;
	addEntry: Mock;
	removeEntry: Mock;
	cloneSource: Mock;
	cleanupTempDir: Mock;
	nukeManifestFiles: Mock;
	copyPack: Mock;
	copyBareSkill: Mock;
	access: Mock;
	scanForEscapingSymlinks: Mock;
	checkUnmanagedConflicts: Mock;
	discover: Mock;
}

/**
 * Resolves the shared `vi.mocked` handles from the modules the calling test
 * file mocked, and registers the common
 * `beforeEach` defaults (`vi.clearAllMocks` plus the resolved/implementation
 * defaults both files installed identically). Returns the handles so test
 * bodies keep driving them via `.mock*` and asserting `toHaveBeenCalled*`.
 *
 * Call once at module scope in each test file; the returned object is the
 * single source for the shared handles. File-specific mocks (the change-version
 * `select`/`isCancel`/`fetchRemoteTags`, the list-update `stat`) are wired up
 * by each file on top of this.
 */
export function setupListActionMocks(): ListActionMocks {
	const handles: ListActionMocks = {
		writeManifest: vi.mocked(writeManifest),
		addEntry: vi.mocked(addEntry),
		removeEntry: vi.mocked(removeEntry),
		cloneSource: vi.mocked(cloneSource),
		cleanupTempDir: vi.mocked(cleanupTempDir),
		nukeManifestFiles: vi.mocked(nukeManifestFiles),
		copyPack: vi.mocked(copyPack),
		copyBareSkill: vi.mocked(copyBareSkill),
		access: vi.mocked(access),
		scanForEscapingSymlinks: vi.mocked(scanForEscapingSymlinks),
		checkUnmanagedConflicts: vi.mocked(checkUnmanagedConflicts),
		discover: vi.mocked(discover),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		handles.writeManifest.mockResolvedValue(undefined);
		handles.cleanupTempDir.mockResolvedValue(undefined);
		handles.nukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
		// Default: the recorded structural unit still exists in the re-clone, so the
		// derive-before-delete gate passes (pathExists -> access resolves).
		handles.access.mockResolvedValue(undefined);
		// Default: no escaping symlink in the re-clone (copy-safety scan passes).
		handles.scanForEscapingSymlinks.mockResolvedValue(undefined);
		// Default: nothing agntc didn't install sits where the update would copy.
		handles.checkUnmanagedConflicts.mockResolvedValue([]);
		handles.addEntry.mockImplementation((manifest, key, entry) => ({
			...manifest,
			[key]: entry,
		}));
		handles.removeEntry.mockImplementation((manifest, key) => {
			const { [key]: _, ...rest } = manifest;
			return rest;
		});
	});

	return handles;
}

/** What a re-walk finds: a loose skill at each path, named for its folder. */
export function looseSkillsAt(...paths: string[]): Discovery {
	return {
		packs: [],
		skills: paths.map((path) => ({ name: basename(path), path })),
		strays: [],
	};
}
