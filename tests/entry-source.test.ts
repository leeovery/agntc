import { describe, expect, it } from "vitest";
import {
	groupReAddCommands,
	isSameSource,
	keySuffix,
	reAddCommand,
	recordedSubpath,
	sourceIdOf,
} from "../src/entry-source.js";
import { makeEntry } from "./helpers/factories.js";

const local = (overrides = {}) =>
	makeEntry({ ref: null, commit: null, ...overrides });

describe("keySuffix", () => {
	it("is the path below owner/repo", () => {
		expect(keySuffix("owner/repo/skills/go")).toBe("skills/go");
	});

	it("is empty for a root key", () => {
		expect(keySuffix("owner/repo")).toBe("");
	});
});

describe("reAddCommand", () => {
	it("re-adds a root skill by its repo", () => {
		expect(reAddCommand("owner/repo", makeEntry({ type: "skill" }))).toBe(
			"npx agntc add owner/repo",
		);
	});

	it("re-adds a skill by its key's path", () => {
		expect(reAddCommand("owner/repo/go", makeEntry({ type: "skill" }))).toBe(
			"npx agntc add owner/repo/go",
		);
	});

	it("re-adds a skill by its recorded path over its key", () => {
		expect(
			reAddCommand(
				"owner/repo/go",
				makeEntry({ type: "skill", sourceSubpath: "skills/lang/go" }),
			),
		).toBe("npx agntc add owner/repo/skills/lang/go");
	});

	it("re-adds a pack with --pack", () => {
		expect(reAddCommand("owner/repo/tools", makeEntry({ type: "pack" }))).toBe(
			"npx agntc add owner/repo/tools --pack",
		);
	});

	it("re-adds a root pack with --pack", () => {
		expect(reAddCommand("owner/repo", makeEntry({ type: "pack" }))).toBe(
			"npx agntc add owner/repo --pack",
		);
	});

	it("pins a version after the path and before --pack", () => {
		expect(
			reAddCommand(
				"owner/repo/tools",
				makeEntry({ type: "pack", sourceSubpath: "packs/tools" }),
				"v2.0.0",
			),
		).toBe("npx agntc add owner/repo/packs/tools@v2.0.0 --pack");
	});

	it("re-adds a legacy entry with no type as a skill", () => {
		expect(reAddCommand("owner/repo/go", makeEntry())).toBe(
			"npx agntc add owner/repo/go",
		);
	});

	it("re-adds a local entry by its folder", () => {
		expect(reAddCommand("/src/go", local({ type: "skill" }))).toBe(
			"npx agntc add /src/go",
		);
	});

	it("re-adds a local entry with a recorded path by the folder it was added from plus that path", () => {
		expect(
			reAddCommand("/src/repo/go", local({ sourceSubpath: "skills/lang/go" })),
		).toBe("npx agntc add /src/repo/skills/lang/go");
	});

	it("re-adds a local pack with --pack", () => {
		expect(reAddCommand("/src/tools", local({ type: "pack" }))).toBe(
			"npx agntc add /src/tools --pack",
		);
	});
});

describe("groupReAddCommands", () => {
	const skill = (key: string, sourceSubpath?: string) => ({
		key,
		entry: makeEntry({
			type: "skill",
			...(sourceSubpath !== undefined ? { sourceSubpath } : {}),
		}),
	});
	const pack = (key: string) => ({ key, entry: makeEntry({ type: "pack" }) });

	it("puts a mixed group's loose skills on one --skill line by folder name, in order, and each pack on its own", () => {
		expect(
			groupReAddCommands([
				skill("owner/repo/zeta", "skills/zeta"),
				pack("owner/repo/web"),
				skill("owner/repo/alpha"),
				pack("owner/repo/tools"),
				{ key: "owner/repo/mid", entry: makeEntry() },
			]),
		).toEqual([
			"npx agntc add owner/repo --skill alpha mid zeta",
			"npx agntc add owner/repo/web --pack",
			"npx agntc add owner/repo/tools --pack",
		]);
	});

	it("pins every line to a version", () => {
		expect(
			groupReAddCommands(
				[skill("owner/repo/a"), skill("owner/repo/b"), pack("owner/repo/p")],
				"v2.0.0",
			),
		).toEqual([
			"npx agntc add owner/repo@v2.0.0 --skill a b",
			"npx agntc add owner/repo/p@v2.0.0 --pack",
		]);
	});

	it("keeps a lone loose skill's path form", () => {
		expect(
			groupReAddCommands([
				skill("owner/repo/go", "skills/lang/go"),
				pack("owner/repo/p"),
			]),
		).toEqual([
			"npx agntc add owner/repo/skills/lang/go",
			"npx agntc add owner/repo/p --pack",
		]);
	});

	it("gives a group of packs a line each", () => {
		expect(
			groupReAddCommands([pack("owner/repo/a"), pack("owner/repo/b")]),
		).toEqual([
			"npx agntc add owner/repo/a --pack",
			"npx agntc add owner/repo/b --pack",
		]);
	});
});

describe("isSameSource", () => {
	it("matches remote entries on their clone URL", () => {
		expect(
			isSameSource(
				sourceIdOf("owner/repo/a", makeEntry()),
				sourceIdOf("owner/repo/tools", makeEntry()),
			),
		).toBe(true);
	});

	it("tells remote entries of different repos apart", () => {
		expect(
			isSameSource(
				sourceIdOf("owner/repo/a", makeEntry()),
				sourceIdOf("other/repo/a", makeEntry()),
			),
		).toBe(false);
	});

	it("uses a recorded clone URL over the one the key implies", () => {
		const mirrored = makeEntry({
			cloneUrl: "https://gitlab.com/owner/repo.git",
		});
		expect(
			isSameSource(
				sourceIdOf("owner/repo/a", mirrored),
				sourceIdOf("owner/repo/tools", makeEntry()),
			),
		).toBe(false);
	});

	it("never matches a local entry with a remote one", () => {
		expect(
			isSameSource(
				sourceIdOf("/src/repo/a", local({ sourceSubpath: "skills/a" })),
				sourceIdOf("owner/repo/a", makeEntry()),
			),
		).toBe(false);
	});

	it("matches a local pack with a loose skill added from the folder holding it", () => {
		expect(
			isSameSource(
				sourceIdOf("/src/repo/tools", local({ type: "pack" })),
				sourceIdOf("/src/repo/a", local({ sourceSubpath: "tools/skills/a" })),
			),
		).toBe(true);
	});

	it("tells local entries of unrelated folders apart, even with a shared prefix", () => {
		expect(
			isSameSource(
				sourceIdOf("/src/repo/a", local({ sourceSubpath: "skills/a" })),
				sourceIdOf("/src/repo-two/b", local({ sourceSubpath: "skills/b" })),
			),
		).toBe(false);
	});
});

describe("recordedSubpath", () => {
	it("omits a remote path the key alone leads to", () => {
		expect(
			recordedSubpath("owner/repo/go", makeEntry(), "/tmp/clone", "go"),
		).toBeUndefined();
	});

	it("records a remote path the key doesn't lead to", () => {
		expect(
			recordedSubpath("owner/repo/go", makeEntry(), "/tmp/clone", "lang/go"),
		).toBe("lang/go");
	});

	it("omits a local path that is the key's own folder", () => {
		expect(recordedSubpath("/src/go", local(), "/src/go", "")).toBeUndefined();
	});

	it("records a local path relative to the folder the key sits in", () => {
		expect(
			recordedSubpath(
				"/src/repo/go",
				local({ sourceSubpath: "go" }),
				"/src/repo",
				"lang/go",
			),
		).toBe("lang/go");
	});

	it("records a local path below a key with no recorded path, so the key's folder leads to it", () => {
		expect(recordedSubpath("/src/go", local(), "/src/go", "skills/go")).toBe(
			"go/skills/go",
		);
	});
});
