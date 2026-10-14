import { describe, expect, it } from "vitest";
import {
	groupReAddCommands,
	isSameSource,
	localItemPath,
	localRootOf,
	reAddCommand,
	restoreCommand,
	type SourceId,
	sourceIdOf,
	sourceKeyOf,
} from "../src/entry-source.js";
import { parseSource } from "../src/source-parser.js";
import { makeEntry } from "./helpers/factories.js";

const local = (overrides = {}) =>
	makeEntry({ ref: null, commit: null, ...overrides });

describe("reAddCommand for a source off GitHub shorthand", () => {
	const GITLAB_HTTPS = "https://gitlab.com/acme/skills.git";
	const GITLAB_SSH = "git@gitlab.com:acme/skills.git";

	it.each([
		[
			GITLAB_HTTPS,
			"npx agntc add https://gitlab.com/acme/skills/packs/tools@v2.0.0 --pack",
		],
		[
			GITLAB_SSH,
			"npx agntc add git@gitlab.com:acme/skills/packs/tools@v2.0.0 --pack",
		],
		[
			"git@github.com:acme/skills.git",
			"npx agntc add git@github.com:acme/skills/packs/tools@v2.0.0 --pack",
		],
		[
			"https://github.com/acme/skills.git",
			"npx agntc add acme/skills/packs/tools@v2.0.0 --pack",
		],
		[
			"https://github.com/acme/skills",
			"npx agntc add acme/skills/packs/tools@v2.0.0 --pack",
		],
	])("re-adds a pack cloned from %s from that source", (cloneUrl, command) => {
		expect(
			reAddCommand(
				"acme/skills/tools",
				makeEntry({ type: "pack", cloneUrl, sourceSubpath: "packs/tools" }),
				"project",
				"v2.0.0",
			),
		).toBe(command);
	});

	it.each([
		GITLAB_HTTPS,
		GITLAB_SSH,
	])("prints a %s line that parses back to the same clone URL and path", async (cloneUrl) => {
		const command = reAddCommand(
			"acme/skills/go",
			makeEntry({ type: "skill", cloneUrl, sourceSubpath: "skills/go" }),
			"project",
		);

		expect(
			await parseSource(command.replace("npx agntc add ", "")),
		).toMatchObject({ cloneUrl, startPath: "skills/go", ref: null });
	});

	it("re-adds a root entry by the URL alone", () => {
		expect(
			reAddCommand(
				"acme/skills",
				makeEntry({ type: "skill", cloneUrl: GITLAB_HTTPS }),
				"project",
			),
		).toBe("npx agntc add https://gitlab.com/acme/skills");
	});

	it("puts a group's loose skills on one --skill line by the URL", () => {
		const skill = (key: string) => ({
			key,
			entry: makeEntry({ type: "skill", cloneUrl: GITLAB_SSH }),
		});

		expect(
			groupReAddCommands(
				[skill("acme/skills/a"), skill("acme/skills/b")],
				"project",
				"v1.0.0",
			),
		).toEqual(["npx agntc add git@gitlab.com:acme/skills@v1.0.0 --skill a b"]);
	});
});

describe("reAddCommand", () => {
	it("re-adds a root skill by its repo", () => {
		expect(
			reAddCommand("owner/repo", makeEntry({ type: "skill" }), "project"),
		).toBe("npx agntc add owner/repo");
	});

	it("re-adds a skill by its key's path", () => {
		expect(
			reAddCommand("owner/repo/go", makeEntry({ type: "skill" }), "project"),
		).toBe("npx agntc add owner/repo/go");
	});

	it("re-adds a skill by its recorded path over its key", () => {
		expect(
			reAddCommand(
				"owner/repo/go",
				makeEntry({ type: "skill", sourceSubpath: "skills/lang/go" }),
				"project",
			),
		).toBe("npx agntc add owner/repo/skills/lang/go");
	});

	it("re-adds a pack with --pack", () => {
		expect(
			reAddCommand("owner/repo/tools", makeEntry({ type: "pack" }), "project"),
		).toBe("npx agntc add owner/repo/tools --pack");
	});

	it("re-adds a root pack with --pack", () => {
		expect(
			reAddCommand("owner/repo", makeEntry({ type: "pack" }), "project"),
		).toBe("npx agntc add owner/repo --pack");
	});

	it("pins a version after the path and before --pack", () => {
		expect(
			reAddCommand(
				"owner/repo/tools",
				makeEntry({ type: "pack", sourceSubpath: "packs/tools" }),
				"project",
				"v2.0.0",
			),
		).toBe("npx agntc add owner/repo/packs/tools@v2.0.0 --pack");
	});

	it("re-adds a legacy entry with no type as a skill", () => {
		expect(reAddCommand("owner/repo/go", makeEntry(), "project")).toBe(
			"npx agntc add owner/repo/go",
		);
	});

	it("re-adds a local entry by its folder", () => {
		expect(reAddCommand("/src/go", local({ type: "skill" }), "project")).toBe(
			"npx agntc add /src/go",
		);
	});

	it("re-adds a local entry with a recorded path by the folder it was added from plus that path", () => {
		expect(
			reAddCommand(
				"/src/repo/go",
				local({ sourceSubpath: "skills/lang/go" }),
				"project",
			),
		).toBe("npx agntc add /src/repo/skills/lang/go");
	});

	it("re-adds a local pack with --pack", () => {
		expect(reAddCommand("/src/tools", local({ type: "pack" }), "project")).toBe(
			"npx agntc add /src/tools --pack",
		);
	});
});

describe("restoreCommand", () => {
	const key = "owner/repo/go";

	it("keeps a constrained entry on its constraint, which a bare add would replace with the newest caret", () => {
		expect(
			restoreCommand(
				key,
				makeEntry({ ref: "v1.4.0", constraint: "^1.2.0" }),
				"project",
			),
		).toBe("npx agntc add 'owner/repo/go@^1.2.0'");
	});

	it("keeps an entry tracking a branch on that branch", () => {
		expect(restoreCommand(key, makeEntry({ ref: "main" }), "project")).toBe(
			"npx agntc add owner/repo/go@main",
		);
	});

	it("keeps an entry pinned to a tag on that tag", () => {
		expect(restoreCommand(key, makeEntry({ ref: "v1.0.0" }), "project")).toBe(
			"npx agntc add owner/repo/go@v1.0.0",
		);
	});

	it("adds an entry on HEAD bare", () => {
		expect(restoreCommand(key, makeEntry({ ref: null }), "project")).toBe(
			"npx agntc add owner/repo/go",
		);
	});

	it("re-adds the tag a version change picked over what the entry tracks", () => {
		expect(
			restoreCommand(
				key,
				makeEntry({ ref: "v1.0.0", constraint: "^1.0.0" }),
				"project",
				"v2.0.0",
			),
		).toBe("npx agntc add owner/repo/go@v2.0.0");
	});

	it("adds a local entry by its folder, which has no version", () => {
		expect(restoreCommand("/src/repo/go", local(), "project")).toBe(
			"npx agntc add /src/repo/go",
		);
	});
});

describe("reAddCommand for a global entry", () => {
	it("carries -g after add, for a skill, a pinned pack and a local folder", () => {
		expect(
			reAddCommand("owner/repo/go", makeEntry({ type: "skill" }), "global"),
		).toBe("npx agntc add -g owner/repo/go");
		expect(
			reAddCommand(
				"owner/repo/tools",
				makeEntry({ type: "pack" }),
				"global",
				"v2.0.0",
			),
		).toBe("npx agntc add -g owner/repo/tools@v2.0.0 --pack");
		expect(reAddCommand("/src/go", local({ type: "skill" }), "global")).toBe(
			"npx agntc add -g /src/go",
		);
	});
});

describe("reAddCommand for a local entry with its root recorded", () => {
	it("re-adds a skill by its folder below the recorded root", () => {
		expect(
			reAddCommand(
				"/src/repo/go",
				local({ localRoot: "/src/repo" }),
				"project",
			),
		).toBe("npx agntc add /src/repo/go");
	});

	it("re-adds a skill recorded with a path by that path below the recorded root", () => {
		expect(
			reAddCommand(
				"/src/repo/go",
				local({ localRoot: "/src/repo", sourceSubpath: "skills/lang/go" }),
				"project",
			),
		).toBe("npx agntc add /src/repo/skills/lang/go");
	});

	it("re-adds a pack by its folder below the recorded root", () => {
		expect(
			reAddCommand(
				"/src/repo/packs/tools",
				local({ type: "pack", localRoot: "/src/repo" }),
				"project",
			),
		).toBe("npx agntc add /src/repo/packs/tools --pack");
	});

	it("re-adds a root skill by the recorded root itself", () => {
		expect(
			reAddCommand("/src/go", local({ localRoot: "/src/go" }), "project"),
		).toBe("npx agntc add /src/go");
	});

	it("quotes a folder with a space so the line pastes", () => {
		expect(
			reAddCommand(
				"/src/My Skills/tools",
				local({ type: "pack", localRoot: "/src/My Skills" }),
				"global",
			),
		).toBe("npx agntc add -g '/src/My Skills/tools' --pack");
	});

	it("quotes a folder with a quote, escaping it", () => {
		expect(
			reAddCommand(
				"/src/lee's/go",
				local({ localRoot: "/src/lee's" }),
				"project",
			),
		).toBe("npx agntc add '/src/lee'\\''s/go'");
	});
});

describe("localRootOf", () => {
	it("is the recorded root when there is one", () => {
		expect(localRootOf("/src/repo/go", local({ localRoot: "/src/repo" }))).toBe(
			"/src/repo",
		);
	});

	it("falls back to the item's own folder for an entry with no recorded path", () => {
		expect(localRootOf("/src/repo/go", local())).toBe("/src/repo/go");
	});

	it("falls back to the folder the key sits in for an entry with a recorded path", () => {
		expect(
			localRootOf("/src/repo/go", local({ sourceSubpath: "skills/go" })),
		).toBe("/src/repo");
	});
});

describe("localItemPath", () => {
	it("is the recorded path when there is one", () => {
		expect(
			localItemPath(
				"/src/repo/go",
				local({ sourceSubpath: "skills/go" }),
				"/src/repo",
			),
		).toBe("skills/go");
	});

	it("is where the key sits below the root otherwise", () => {
		expect(localItemPath("/src/repo/packs/tools", local(), "/src/repo")).toBe(
			"packs/tools",
		);
	});

	it("is empty for an item that is the root", () => {
		expect(localItemPath("/src/go", local(), "/src/go")).toBe("");
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
			groupReAddCommands(
				[
					skill("owner/repo/zeta", "skills/zeta"),
					pack("owner/repo/web"),
					skill("owner/repo/alpha"),
					pack("owner/repo/tools"),
					{ key: "owner/repo/mid", entry: makeEntry() },
				],
				"project",
			),
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
				"project",
				"v2.0.0",
			),
		).toEqual([
			"npx agntc add owner/repo@v2.0.0 --skill a b",
			"npx agntc add owner/repo/p@v2.0.0 --pack",
		]);
	});

	it("keeps a lone loose skill's path form", () => {
		expect(
			groupReAddCommands(
				[skill("owner/repo/go", "skills/lang/go"), pack("owner/repo/p")],
				"project",
			),
		).toEqual([
			"npx agntc add owner/repo/skills/lang/go",
			"npx agntc add owner/repo/p --pack",
		]);
	});

	it("gives a group of packs a line each", () => {
		expect(
			groupReAddCommands(
				[pack("owner/repo/a"), pack("owner/repo/b")],
				"project",
			),
		).toEqual([
			"npx agntc add owner/repo/a --pack",
			"npx agntc add owner/repo/b --pack",
		]);
	});
});

describe("groupReAddCommands for a global group", () => {
	it("carries -g on every line", () => {
		expect(
			groupReAddCommands(
				[
					{ key: "owner/repo/a", entry: makeEntry({ type: "skill" }) },
					{ key: "owner/repo/b", entry: makeEntry({ type: "skill" }) },
					{ key: "owner/repo/p", entry: makeEntry({ type: "pack" }) },
				],
				"global",
				"v2.0.0",
			),
		).toEqual([
			"npx agntc add -g owner/repo@v2.0.0 --skill a b",
			"npx agntc add -g owner/repo/p@v2.0.0 --pack",
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

	describe("remote clone URLs of one repo", () => {
		const remote = (cloneUrl: string): SourceId => ({
			kind: "remote",
			cloneUrl,
		});

		it.each([
			["https://github.com/o/r.git", "https://github.com/o/r"],
			["https://github.com/o/r.git", "git@github.com:o/r.git"],
			["https://github.com/o/r", "git@github.com:o/r"],
			["https://lee:token@github.com/o/r.git", "https://github.com/o/r"],
			["ssh://git@github.com:22/o/r.git", "git@github.com:o/r.git"],
			["https://GitHub.com/o/r.git", "git@github.com:o/r.git"],
		])("match whatever the protocol, login, port or .git: %s and %s", (a, b) => {
			expect(isSameSource(remote(a), remote(b))).toBe(true);
		});

		it.each([
			["https://github.com/o/r.git", "https://gitlab.com/o/r.git"],
			["git@github.com:o/r.git", "git@gitlab.com:o/r.git"],
			["https://github.com/o/r.git", "https://github.com/o/other.git"],
			["https://github.com/o/r.git", "https://github.com/x/r.git"],
		])("don't match on another host or repo: %s and %s", (a, b) => {
			expect(isSameSource(remote(a), remote(b))).toBe(false);
		});

		it("tells local repo paths apart by the path itself", () => {
			expect(isSameSource(remote("/srv/a.git"), remote("/srv/a.git"))).toBe(
				true,
			);
			expect(isSameSource(remote("/srv/a.git"), remote("/srv/b.git"))).toBe(
				false,
			);
		});
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

	describe("local entries with their roots recorded", () => {
		const added = (key: string, localRoot: string, overrides = {}) =>
			sourceIdOf(key, local({ localRoot, ...overrides }));

		it("match when added from the same folder", () => {
			expect(
				isSameSource(
					added("/src/repo/tools", "/src/repo", { type: "pack" }),
					added("/src/repo/a", "/src/repo"),
				),
			).toBe(true);
		});

		it("tell a folder apart from one inside it, a nested checkout being a source of its own", () => {
			expect(
				isSameSource(
					added("/src/repo/tools", "/src/repo/tools", { type: "pack" }),
					added("/src/repo/a", "/src/repo"),
				),
			).toBe(false);
		});

		it("match an add from the same folder exactly", () => {
			const fetched = (root: string) =>
				({ kind: "local", root, exact: true }) as const;

			expect(
				isSameSource(fetched("/src/repo"), added("/src/repo/a", "/src/repo")),
			).toBe(true);
			expect(
				isSameSource(
					fetched("/src/repo/tools"),
					added("/src/repo/a", "/src/repo"),
				),
			).toBe(false);
		});

		it("tell unrelated folders apart, neither holding the other", () => {
			expect(
				isSameSource(
					added("/src/repo/a", "/src/repo"),
					added("/src/repo-two/b", "/src/repo-two"),
				),
			).toBe(false);
		});

		it("fall back to either root holding the other against an entry without one", () => {
			expect(
				isSameSource(
					added("/src/repo/tools", "/src/repo/tools", { type: "pack" }),
					sourceIdOf("/src/repo/a", local({ sourceSubpath: "a" })),
				),
			).toBe(true);
		});
	});
});

describe("sourceKeyOf", () => {
	it("is the repo a remote key starts with, as add keys a remote source", async () => {
		const added = await parseSource("owner/repo/packs/tools");

		expect(sourceKeyOf("owner/repo/packs/tools", makeEntry())).toBe(
			added.manifestKey,
		);
		expect(sourceKeyOf("owner/repo", makeEntry())).toBe("owner/repo");
	});

	it("is a local entry's recorded root, which add keys a local source by", () => {
		expect(sourceKeyOf("/src/repo/go", local({ localRoot: "/src/repo" }))).toBe(
			"/src/repo",
		);
	});

	it("is a local entry's derived root when none is recorded", () => {
		expect(
			sourceKeyOf("/src/repo/go", local({ sourceSubpath: "skills/go" })),
		).toBe("/src/repo");
		expect(sourceKeyOf("/src/repo/go", local())).toBe("/src/repo/go");
	});
});
