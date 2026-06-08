import { type Mock, vi } from "vitest";

/**
 * The narrowed result of the production `checkEscapingSymlinks` wrapper.
 */
type CheckResult = { ok: true } | { ok: false; message: string };

/**
 * Constructor shape used for `instanceof` narrowing inside the mocked wrapper.
 * Either the real `SymlinkEscapeError` (passed by `...actual`-spread sites) or
 * a locally-declared class (full-replacement sites).
 */
type SymlinkEscapeErrorCtor = abstract new (
	// biome-ignore lint/suspicious/noExplicitAny: only used for instanceof narrowing
	...args: any[]
) => Error;

/**
 * The mocked subset of `src/copy-safety.js` produced by {@link mockCopySafety}.
 * `scanForEscapingSymlinks` is the per-test driver (`.mockResolvedValue` /
 * `.mockRejectedValue`); `checkEscapingSymlinks` mirrors the production
 * scan-and-narrow wrapper authored here exactly once.
 *
 * `assertSubpathWithinClone` and the `SymlinkEscapeError` /
 * `PathTraversalError` classes are intentionally NOT supplied here: spread
 * sites keep the real ones via `...actual`, and the only site that stubs
 * `assertSubpathWithinClone` adds its own `vi.fn()` — so each call site retains
 * its exact prior module shape.
 */
interface CopySafetyMock {
	scanForEscapingSymlinks: Mock;
	checkEscapingSymlinks: (
		unitDir: string,
		cloneRoot: string,
	) => Promise<CheckResult>;
}

/**
 * Builds the mocked `copy-safety` module members shared by every test that
 * stubs the symlink-escape pre-flight. The scan-and-narrow contract of the real
 * `checkEscapingSymlinks` wrapper (run scan → narrow {@link SymlinkEscapeError}
 * to `{ ok: false, message }` → rethrow anything else → `{ ok: true }`) lives
 * here in exactly one place so a contract change is a single edit.
 *
 * The wrapper narrows on the supplied `SymlinkEscapeError` constructor: pass the
 * real class from `...actual` (spread sites) or a locally-declared class
 * (full-replacement sites) to keep each call site's `instanceof` semantics
 * identical to the inline copy it replaces.
 *
 * The shared `scanForEscapingSymlinks` mock is returned on the module shape so
 * test bodies keep driving it via `vi.mocked(scanForEscapingSymlinks).mock*`.
 */
export function mockCopySafety(
	SymlinkEscapeError: SymlinkEscapeErrorCtor,
): CopySafetyMock {
	const scanForEscapingSymlinks = vi.fn();
	return {
		scanForEscapingSymlinks,
		checkEscapingSymlinks: async (
			unitDir: string,
			cloneRoot: string,
		): Promise<CheckResult> => {
			try {
				await scanForEscapingSymlinks(unitDir, cloneRoot);
				return { ok: true };
			} catch (err) {
				if (err instanceof SymlinkEscapeError) {
					return { ok: false, message: err.message };
				}
				throw err;
			}
		},
	};
}
