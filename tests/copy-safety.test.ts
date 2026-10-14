import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assertSubpathWithinClone,
	type CopySource,
	checkEscapingSymlinks,
	inspectSourcePath,
	PathTraversalError,
	SymlinkEscapeError,
	scanForEscapingSymlinks,
} from "../src/copy-safety.js";

function remote(root: string): CopySource {
	return { root, local: false };
}

function local(root: string): CopySource {
	return { root, local: true };
}

/** A filter keeping everything, so a scan reads all a copy of the folder could. */
function everything(): boolean {
	return true;
}

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

describe("inspectSourcePath", () => {
	let root: string;

	beforeEach(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), "agntc-source-path-")));
		await mkdir(join(root, "skills/foo"), { recursive: true });
		await writeFile(join(root, "skills/foo/SKILL.md"), "");
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it.each(["skills/foo", ""])("finds a real folder at %j", async (path) => {
		expect(await inspectSourcePath(root, path)).toEqual({ kind: "directory" });
	});

	it("is missing from the first segment that isn't there", async () => {
		expect(await inspectSourcePath(root, "skills/bar/baz")).toEqual({
			kind: "missing",
		});
	});

	it("isn't a directory when a segment is a file", async () => {
		expect(await inspectSourcePath(root, "skills/foo/SKILL.md")).toEqual({
			kind: "not-directory",
		});
	});

	it.each([
		["above the path", "linked", "linked/foo"],
		["at the path", "skills/bar", "skills/bar"],
	])("names a link %s without following it", async (_where, at, path) => {
		await symlink(join(root, "skills"), join(root, "linked"));
		await symlink("foo", join(root, "skills/bar"));

		expect(await inspectSourcePath(root, path)).toEqual({ kind: "link", at });
	});

	it("names a dangling link rather than calling the path missing", async () => {
		await symlink("gone", join(root, "dangling"));

		expect(await inspectSourcePath(root, "dangling/foo")).toEqual({
			kind: "link",
			at: "dangling",
		});
	});
});

describe("scanForEscapingSymlinks", () => {
	// Real temp-dir fixtures: clone root with a unit subtree containing real
	// files/dirs plus symlinks. The boundary is the CLONE ROOT, not the unit dir.
	let cloneRoot: string;
	let unitDir: string;

	beforeEach(async () => {
		cloneRoot = await mkdtemp(join(tmpdir(), "agntc-symlink-test-"));
		unitDir = join(cloneRoot, "unit");
		await mkdir(unitDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(cloneRoot, { recursive: true, force: true });
	});

	it("clean no-op on a tree with no symlinks (no false positives)", async () => {
		await writeFile(join(unitDir, "a.txt"), "a");
		await mkdir(join(unitDir, "sub"), { recursive: true });
		await writeFile(join(unitDir, "sub", "b.txt"), "b");

		await expect(
			scanForEscapingSymlinks(unitDir, remote(cloneRoot), everything),
		).resolves.toBeUndefined();
	});

	it.each([
		["a clone", remote],
		["a local source", local],
	])("rejects an absolute-target symlink (-> /etc/passwd) in %s", async (_kind, kind) => {
		await symlink("/etc/passwd", join(unitDir, "leak"));

		await expect(
			scanForEscapingSymlinks(unitDir, kind(cloneRoot), everything),
		).rejects.toBeInstanceOf(SymlinkEscapeError);
	});

	it("rejects a ..-escape symlink resolving above the clone root", async () => {
		await symlink("../../../../etc/passwd", join(unitDir, "leak"));

		await expect(
			scanForEscapingSymlinks(unitDir, remote(cloneRoot), everything),
		).rejects.toBeInstanceOf(SymlinkEscapeError);
	});

	it("allows a symlink resolving inside the clone", async () => {
		await writeFile(join(cloneRoot, "shared.txt"), "shared");
		await symlink("../shared.txt", join(unitDir, "link"));

		await expect(
			scanForEscapingSymlinks(unitDir, remote(cloneRoot), everything),
		).resolves.toBeUndefined();
	});

	it("allows a symlink to a sibling dir inside the clone (multi-dir plugin)", async () => {
		const siblingDir = join(cloneRoot, "other-unit");
		await mkdir(siblingDir, { recursive: true });
		await writeFile(join(siblingDir, "c.txt"), "c");
		await symlink("../other-unit", join(unitDir, "sibling-link"));

		await expect(
			scanForEscapingSymlinks(unitDir, remote(cloneRoot), everything),
		).resolves.toBeUndefined();
	});

	it("allows a broken symlink that is lexically inside the clone (copied verbatim)", async () => {
		await symlink("./does-not-exist.txt", join(unitDir, "dangling"));

		await expect(
			scanForEscapingSymlinks(unitDir, remote(cloneRoot), everything),
		).resolves.toBeUndefined();
	});

	it("rejects a broken symlink that is lexically escaping the clone root", async () => {
		await symlink(
			"../../../nonexistent-outside.txt",
			join(unitDir, "dangling"),
		);

		await expect(
			scanForEscapingSymlinks(unitDir, remote(cloneRoot), everything),
		).rejects.toBeInstanceOf(SymlinkEscapeError);
	});

	it("finds a deeply-nested escaping symlink (recursion at any depth)", async () => {
		const deep = join(unitDir, "a", "b", "c", "d");
		await mkdir(deep, { recursive: true });
		await symlink("/etc/passwd", join(deep, "leak"));

		await expect(
			scanForEscapingSymlinks(unitDir, remote(cloneRoot), everything),
		).rejects.toBeInstanceOf(SymlinkEscapeError);
	});

	it("does not infinite-loop on a symlink-to-directory cycle (link to ancestor)", async () => {
		// symlink inside unitDir pointing back at unitDir (its own ancestor).
		// Target is inside the clone, so it must be ALLOWED and the scan must
		// terminate without descending into the symlinked dir.
		await symlink(unitDir, join(unitDir, "cycle"));

		await expect(
			scanForEscapingSymlinks(unitDir, remote(cloneRoot), everything),
		).resolves.toBeUndefined();
	});

	it("validates symlinked dirs without descending into them", async () => {
		// A real escaping symlink-to-dir must be flagged on the link itself,
		// not by walking through it.
		const outside = await mkdtemp(join(tmpdir(), "agntc-outside-"));
		try {
			await symlink(outside, join(unitDir, "escape-dir"));
			await expect(
				scanForEscapingSymlinks(unitDir, remote(cloneRoot), everything),
			).rejects.toBeInstanceOf(SymlinkEscapeError);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	describe("a folder elsewhere in the clone a link leads to", () => {
		async function linkIn(base: string, links: Record<string, string>) {
			for (const [path, target] of Object.entries(links)) {
				await mkdir(dirname(join(base, path)), { recursive: true });
				await symlink(target, join(base, path));
			}
		}

		/** A link to a folder holding a link out of the source root. */
		async function linkToALeak(): Promise<void> {
			await writeFile(join(unitDir, "SKILL.md"), "");
			await linkIn(cloneRoot, {
				"shared/deep/leak": "/etc/passwd",
				"unit/shared": "../shared",
			});
		}

		it("rejects a link out of the clone in it, as a copy would read it in the link's place", async () => {
			await linkToALeak();

			await expect(
				scanForEscapingSymlinks(unitDir, remote(cloneRoot), everything),
			).rejects.toThrow(
				new SymlinkEscapeError("shared/deep/leak", "/etc/passwd"),
			);
		});

		it("allows it in a local source, whose copy links to the folder rather than reading it", async () => {
			await linkToALeak();

			await expect(
				scanForEscapingSymlinks(unitDir, local(cloneRoot), everything),
			).resolves.toBeUndefined();
		});

		it("allows a link out of the clone that no copy reads: through a link above the unit, a chain, .git, or a folder a copied folder links to", async () => {
			await linkIn(cloneRoot, {
				"above/leak": "/etc/passwd",
				"unit/up": "..",
				"chained/leak": "/etc/passwd",
				alias: "chained",
				"unit/chain": "../alias",
				".git/leak": "/etc/passwd",
				"unit/history": "../.git",
				"b/leak": "/etc/passwd",
				"a/to-b": "../b",
				"unit/a": "../a",
			});

			await expect(
				scanForEscapingSymlinks(unitDir, remote(cloneRoot), everything),
			).resolves.toBeUndefined();
		});

		it("finishes on two folders linking to each other, both reached from the unit", async () => {
			await linkIn(cloneRoot, {
				"a/to-b": "../b",
				"b/to-a": "../a",
				"unit/a": "../a",
				"unit/b": "../b",
			});

			await expect(
				scanForEscapingSymlinks(unitDir, remote(cloneRoot), everything),
			).resolves.toBeUndefined();
		});
	});

	it("reads only what its filter keeps, so a link the copy drops isn't judged", async () => {
		await symlink("/etc/passwd", join(unitDir, "dropped"));

		await expect(
			scanForEscapingSymlinks(
				unitDir,
				remote(cloneRoot),
				(path) => path !== "dropped",
			),
		).resolves.toBeUndefined();
	});

	it("names the offending relative path and target in the error", async () => {
		await symlink("/etc/passwd", join(unitDir, "leak"));

		try {
			await scanForEscapingSymlinks(unitDir, remote(cloneRoot), everything);
			expect.unreachable("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(SymlinkEscapeError);
			expect((err as SymlinkEscapeError).name).toBe("SymlinkEscapeError");
			const message = (err as SymlinkEscapeError).message;
			expect(message).toContain("leak");
			expect(message).toContain("/etc/passwd");
		}
	});
});

describe("checkEscapingSymlinks", () => {
	// Centralised scan-and-narrow wrapper: returns a discriminated result so the
	// three install/replay call sites own only their distinct surfacing.
	let cloneRoot: string;
	let unitDir: string;

	beforeEach(async () => {
		cloneRoot = await mkdtemp(join(tmpdir(), "agntc-check-symlink-test-"));
		unitDir = join(cloneRoot, "unit");
		await mkdir(unitDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(cloneRoot, { recursive: true, force: true });
	});

	it("returns { ok: true } when there is no escaping symlink", async () => {
		await writeFile(join(unitDir, "a.txt"), "a");

		const result = await checkEscapingSymlinks(
			unitDir,
			remote(cloneRoot),
			everything,
		);

		expect(result).toEqual({ ok: true });
	});

	it("returns { ok: false, message } for a SymlinkEscapeError", async () => {
		await symlink("/etc/passwd", join(unitDir, "leak"));

		const result = await checkEscapingSymlinks(
			unitDir,
			remote(cloneRoot),
			everything,
		);

		expect(result.ok).toBe(false);
		// message carries the SymlinkEscapeError's message verbatim.
		const message = (result as { ok: false; message: string }).message;
		expect(message).toContain("leak");
		expect(message).toContain("/etc/passwd");
	});

	it("rethrows a non-SymlinkEscapeError (e.g. a generic Error)", async () => {
		// A missing directory makes scanForEscapingSymlinks throw an ENOENT
		// Error (not a SymlinkEscapeError), which must propagate unchanged.
		await expect(
			checkEscapingSymlinks(
				join(cloneRoot, "does-not-exist"),
				remote(cloneRoot),
				everything,
			),
		).rejects.not.toBeInstanceOf(SymlinkEscapeError);
		await expect(
			checkEscapingSymlinks(
				join(cloneRoot, "does-not-exist"),
				remote(cloneRoot),
				everything,
			),
		).rejects.toThrow();
	});
});
