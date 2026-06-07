import { describe, expect, it } from "vitest";
import {
	assertSubpathWithinClone,
	PathTraversalError,
} from "../src/copy-safety.js";

// Interpretation note (per task 5-1 / spec Copy-Safety Hardening):
// This guard is a LEXICAL containment predicate over path strings. A source
// selector is a string, not a symlink — "resolves within the clone" is
// satisfied by normalising the subpath against the clone root with
// node:path.resolve and checking lexical containment. There are intentionally
// NO node:fs calls here, so the guard classifies non-existent paths without
// ENOENT. Symlink-following safety is a separate concern (task 5-2).

describe("assertSubpathWithinClone", () => {
	const cloneRoot = "/tmp/clone";

	describe("no-op cases (whole-repo / bare-skill)", () => {
		it("does not throw when subpath is null", () => {
			expect(() => assertSubpathWithinClone(cloneRoot, null)).not.toThrow();
		});

		it("does not throw when subpath is undefined", () => {
			expect(() =>
				assertSubpathWithinClone(cloneRoot, undefined),
			).not.toThrow();
		});

		it("does not throw when subpath is empty string", () => {
			expect(() => assertSubpathWithinClone(cloneRoot, "")).not.toThrow();
		});
	});

	describe("contained subpaths (allowed)", () => {
		it("allows a single-segment contained subpath", () => {
			expect(() => assertSubpathWithinClone(cloneRoot, "unit")).not.toThrow();
		});

		it("allows a nested multi-segment contained subpath", () => {
			expect(() =>
				assertSubpathWithinClone(cloneRoot, "path/to/unit"),
			).not.toThrow();
		});

		it("allows a subpath equal to the clone root via '.'", () => {
			expect(() => assertSubpathWithinClone(cloneRoot, ".")).not.toThrow();
		});

		it("allows a subpath that normalises back to the clone root", () => {
			// nested then back up to root -> equals clone root
			expect(() =>
				assertSubpathWithinClone(cloneRoot, "nested/.."),
			).not.toThrow();
		});
	});

	describe("normalisation before check", () => {
		it("treats 'unit/./' (trailing slash + dot segment) as 'unit'", () => {
			expect(() =>
				assertSubpathWithinClone(cloneRoot, "unit/./"),
			).not.toThrow();
		});

		it("normalises redundant separators in a contained subpath", () => {
			expect(() =>
				assertSubpathWithinClone(cloneRoot, "path//to///unit"),
			).not.toThrow();
		});
	});

	describe("escape attempts (rejected)", () => {
		it("rejects a ..-escape resolving above the clone root", () => {
			expect(() => assertSubpathWithinClone(cloneRoot, "../../x")).toThrow(
				PathTraversalError,
			);
		});

		it("error message names the offending subpath", () => {
			expect(() => assertSubpathWithinClone(cloneRoot, "../../x")).toThrow(
				'subpath "../../x" resolves outside the clone root',
			);
		});

		it("rejects an absolute subpath (/etc/passwd)", () => {
			expect(() => assertSubpathWithinClone(cloneRoot, "/etc/passwd")).toThrow(
				PathTraversalError,
			);
		});

		it("rejects a sibling dir sharing the clone-root prefix (boundary-correct, not startsWith)", () => {
			// /tmp/clone vs /tmp/clone-evil — startsWith would false-positive
			expect(() =>
				assertSubpathWithinClone(cloneRoot, "../clone-evil"),
			).toThrow(PathTraversalError);
		});
	});

	describe("filesystem independence", () => {
		it("classifies lexically against a non-existent clone root without ENOENT", () => {
			const missingRoot = "/this/path/definitely/does/not/exist-xyz";
			expect(() => assertSubpathWithinClone(missingRoot, "unit")).not.toThrow();
			expect(() => assertSubpathWithinClone(missingRoot, "../../etc")).toThrow(
				PathTraversalError,
			);
		});
	});

	describe("PathTraversalError", () => {
		it("is named 'PathTraversalError'", () => {
			try {
				assertSubpathWithinClone(cloneRoot, "../../x");
				expect.unreachable("expected throw");
			} catch (err) {
				expect(err).toBeInstanceOf(PathTraversalError);
				expect((err as PathTraversalError).name).toBe("PathTraversalError");
			}
		});
	});
});
