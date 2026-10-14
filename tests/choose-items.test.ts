import { describe, expect, it } from "vitest";
import {
	type ChoiceContext,
	chooseItems,
	menuOption,
	offeredItems,
	optionLine,
	type Selection,
	selectionFromFlags,
	unansweredMenu,
} from "../src/choose-items.js";
import type {
	Discovery,
	FoundPack,
	FoundSkill,
	StrayAssets,
} from "../src/discover.js";

const ctx: ChoiceContext = {
	source: "owner/repo",
	rootName: "repo",
	scope: "project",
};
const AUTO: Selection = { kind: "auto" };

function skill(path: string, extra: Partial<FoundSkill> = {}): FoundSkill {
	return { name: path.split("/").pop() || "repo", path, ...extra };
}

function pack(path: string, extra: Partial<FoundPack> = {}): FoundPack {
	return {
		name: path.split("/").pop() || "repo",
		path,
		skills: [],
		supportFolders: [],
		assetDirs: [],
		...extra,
	};
}

function found(parts: {
	packs?: FoundPack[];
	skills?: FoundSkill[];
	strays?: StrayAssets[];
}): Discovery {
	return { packs: [], skills: [], strays: [], ...parts };
}

const LARAVEL = pack("laravel", {
	skills: [skill("laravel/skills/api"), skill("laravel/skills/models")],
	assetDirs: ["agents", "hooks"],
});

describe("selectionFromFlags", () => {
	it("is auto with no flags", () => {
		expect(selectionFromFlags({})).toEqual({
			ok: true,
			selection: { kind: "auto" },
		});
	});

	it("reads --skill names", () => {
		expect(selectionFromFlags({ skill: ["a", "b"] })).toEqual({
			ok: true,
			selection: { kind: "skills", names: ["a", "b"] },
		});
	});

	it("reads --pack, and --plugin as --pack", () => {
		const pack = { ok: true, selection: { kind: "pack" } };
		expect(selectionFromFlags({ pack: true })).toEqual(pack);
		expect(selectionFromFlags({ plugin: true })).toEqual(pack);
		expect(selectionFromFlags({ pack: true, plugin: true })).toEqual(pack);
	});

	it("reads --all", () => {
		expect(selectionFromFlags({ all: true })).toEqual({
			ok: true,
			selection: { kind: "all" },
		});
	});

	it("refuses --skill with --pack, naming both", () => {
		expect(selectionFromFlags({ skill: ["a"], pack: true })).toEqual({
			ok: false,
			message: "--skill and --pack can't be combined",
		});
	});

	it("names --plugin when that's the flag the user gave", () => {
		expect(selectionFromFlags({ all: true, plugin: true })).toEqual({
			ok: false,
			message: "--plugin and --all can't be combined",
		});
	});

	it("refuses all three, naming each", () => {
		expect(selectionFromFlags({ skill: ["a"], pack: true, all: true })).toEqual(
			{
				ok: false,
				message: "--skill, --pack and --all can't be combined",
			},
		);
	});

	it("takes --list alone or with --pack", () => {
		expect(selectionFromFlags({ list: true })).toEqual({
			ok: true,
			selection: { kind: "auto" },
		});
		expect(selectionFromFlags({ list: true, pack: true })).toEqual({
			ok: true,
			selection: { kind: "pack" },
		});
	});

	it.each([
		[{ skill: ["a"] }, "--skill and --list can't be combined"],
		[{ all: true }, "--all and --list can't be combined"],
	])("refuses --list with %o", (flags, message) => {
		expect(selectionFromFlags({ list: true, ...flags })).toEqual({
			ok: false,
			message,
		});
	});
});

describe("offeredItems", () => {
	it("is every pack worth installing, then every loose skill, each by path", () => {
		const items = offeredItems(
			found({
				packs: [pack("z", { assetDirs: ["hooks"] }), pack("empty")],
				skills: [skill("b"), skill("a")],
			}),
		);

		expect(items.map((item) => item.kind)).toEqual(["pack", "skill", "skill"]);
		expect(
			items.map((item) =>
				item.kind === "pack" ? item.pack.path : item.skill.path,
			),
		).toEqual(["z", "a", "b"]);
	});
});

describe("optionLine", () => {
	it("puts the hint after the label, when there is one", () => {
		expect(
			optionLine(menuOption({ kind: "pack", pack: LARAVEL }, "repo")),
		).toBe("laravel (pack · 2 skills)");
		expect(
			optionLine(
				menuOption({ kind: "skill", skill: skill("tools/a") }, "repo"),
			),
		).toBe("tools/a");
	});

	it("counts a pack's support folders after its skills", () => {
		const workflows = pack("", {
			skills: [skill("skills/start"), skill("skills/plan")],
			supportFolders: [
				{ name: "gates", path: "skills/gates" },
				{ name: "shared", path: "skills/shared" },
			],
		});
		const shared = pack("p", {
			supportFolders: [{ name: "shared", path: "p/skills/shared" }],
		});

		expect(
			optionLine(menuOption({ kind: "pack", pack: workflows }, "repo")),
		).toBe("repo (pack · 2 skills, 2 folders)");
		expect(optionLine(menuOption({ kind: "pack", pack: shared }, "repo"))).toBe(
			"p (pack · 0 skills, 1 folder)",
		);
	});
});

describe("unansweredMenu", () => {
	it("names the flags and the path that answer it, then lists what it would have offered", () => {
		const options = [
			menuOption({ kind: "pack", pack: LARAVEL }, "repo"),
			menuOption(
				{ kind: "skill", skill: skill("a", { description: "Does A\nmore" }) },
				"repo",
			),
		];

		expect(unansweredMenu(options)).toBe(
			[
				"found more than one thing to install — name what to install with --skill, --pack or --all, or add the path to one skill or pack:",
				"  laravel (pack · 2 skills)",
				"  a (Does A)",
			].join("\n"),
		);
	});
});

describe("chooseItems", () => {
	describe("stray notices", () => {
		it("names the stray's path, only the dirs it has, and the --pack command", () => {
			const choice = chooseItems(
				found({
					skills: [skill("tools/x/lint")],
					strays: [{ path: "tools/x", assetDirs: ["agents"] }],
				}),
				AUTO,
				ctx,
			);

			expect(choice.strayNotices).toEqual([
				"tools/x has agents/ that won't be installed — to install them as a pack: npx agntc add owner/repo/tools/x --pack",
			]);
		});

		it("names both dirs and uses the repo name for a root stray", () => {
			const choice = chooseItems(
				found({
					skills: [skill("skills/a")],
					strays: [{ path: "", assetDirs: ["agents", "hooks"] }],
				}),
				AUTO,
				ctx,
			);

			expect(choice.strayNotices).toEqual([
				"repo has agents/ and hooks/ that won't be installed — to install them as a pack: npx agntc add owner/repo --pack",
			]);
		});

		it("carries the user's own @ suffix after the path", () => {
			const choice = chooseItems(
				found({ strays: [{ path: "p", assetDirs: ["hooks"] }] }),
				AUTO,
				{ ...ctx, version: "^1.0" },
			);

			expect(choice.strayNotices[0]).toContain(
				"npx agntc add 'owner/repo/p@^1.0' --pack",
			);
		});

		it("uses the local path for a local source", () => {
			const choice = chooseItems(
				found({ strays: [{ path: "p", assetDirs: ["hooks"] }] }),
				AUTO,
				{ source: "/home/me/skills", rootName: "skills", scope: "project" },
			);

			expect(choice.strayNotices[0]).toContain(
				"npx agntc add /home/me/skills/p --pack",
			);
		});

		it("carries -g for a global add", () => {
			const choice = chooseItems(
				found({ strays: [{ path: "p", assetDirs: ["hooks"] }] }),
				AUTO,
				{ ...ctx, scope: "global" },
			);

			expect(choice.strayNotices[0]).toContain(
				"to install them as a pack: npx agntc add -g owner/repo/p --pack",
			);
		});

		it("says why, with no command, for a root stray holding a pack, which --pack refuses", () => {
			const choice = chooseItems(
				found({
					packs: [pack("packs/p", { skills: [skill("packs/p/skills/a")] })],
					strays: [{ path: "", assetDirs: ["agents"] }],
				}),
				AUTO,
				ctx,
			);

			expect(choice.strayNotices).toEqual([
				"repo has agents/ that won't be installed — it contains packs (packs/p), so --pack can't bundle it",
			]);
		});

		it("says why for a stray whose folder holds packs further down, naming each", () => {
			const choice = chooseItems(
				found({
					packs: [pack("tools/a/p"), pack("tools/q"), pack("other/r")],
					strays: [{ path: "tools", assetDirs: ["hooks"] }],
				}),
				AUTO,
				ctx,
			);

			expect(choice.strayNotices).toEqual([
				"tools has hooks/ that won't be installed — it contains packs (tools/a/p, tools/q), so --pack can't bundle it",
			]);
		});

		it("keeps the --pack command when the packs sit beside the stray, not in it", () => {
			const choice = chooseItems(
				found({
					packs: [pack("toolsx/p"), pack("other/q")],
					strays: [{ path: "tools", assetDirs: ["hooks"] }],
				}),
				AUTO,
				ctx,
			);

			expect(choice.strayNotices).toEqual([
				"tools has hooks/ that won't be installed — to install them as a pack: npx agntc add owner/repo/tools --pack",
			]);
		});

		it("come with a menu and with a refusal alike", () => {
			const strays: StrayAssets[] = [{ path: "", assetDirs: ["hooks"] }];
			const menu = chooseItems(
				found({ skills: [skill("a"), skill("b")], strays }),
				AUTO,
				ctx,
			);
			const refusal = chooseItems(found({ strays }), AUTO, ctx);

			expect(menu.outcome.kind).toBe("menu");
			expect(menu.strayNotices).toHaveLength(1);
			expect(refusal.outcome.kind).toBe("refuse");
			expect(refusal.strayNotices).toHaveLength(1);
		});
	});

	describe("nothing found", () => {
		it("refuses, saying no skills or packs were found", () => {
			for (const selection of [AUTO, { kind: "all" } as const]) {
				expect(chooseItems(found({}), selection, ctx).outcome).toEqual({
					kind: "refuse",
					message: "no skills or packs were found",
				});
			}
		});
	});

	describe("--pack", () => {
		it("installs the one pack discovery bundled", () => {
			const choice = chooseItems(
				found({ packs: [LARAVEL] }),
				{ kind: "pack" },
				ctx,
			);

			expect(choice.outcome).toEqual({
				kind: "install",
				items: [{ kind: "pack", pack: LARAVEL }],
				notes: [],
			});
		});

		it("installs a pack holding only support folders", () => {
			const shared = pack("", {
				supportFolders: [{ name: "shared", path: "skills/shared" }],
			});

			const choice = chooseItems(
				found({ packs: [shared] }),
				{ kind: "pack" },
				ctx,
			);

			expect(choice.outcome).toEqual({
				kind: "install",
				items: [{ kind: "pack", pack: shared }],
				notes: [],
			});
		});

		it("refuses a pack with no skills, agents or hooks", () => {
			const choice = chooseItems(
				found({ packs: [pack("")] }),
				{ kind: "pack" },
				ctx,
			);

			expect(choice.outcome).toEqual({
				kind: "refuse",
				message: "nothing to install — repo has no skills, agents or hooks",
			});
		});
	});

	describe("--skill", () => {
		it("installs each matched skill loose, in the order asked", () => {
			const choice = chooseItems(
				found({ skills: [skill("a"), skill("b/c")] }),
				{ kind: "skills", names: ["c", "a"] },
				ctx,
			);

			expect(choice.outcome).toEqual({
				kind: "install",
				items: [
					{ kind: "skill", skill: skill("b/c") },
					{ kind: "skill", skill: skill("a") },
				],
				notes: [],
			});
		});

		it("refuses the whole command when any name is missing", () => {
			const choice = chooseItems(
				found({ skills: [skill("a")] }),
				{ kind: "skills", names: ["a", "x", "y"] },
				ctx,
			);

			expect(choice.outcome).toEqual({
				kind: "refuse",
				message: 'no skill named "x", "y"',
			});
		});

		it("refuses an ambiguous name, listing its paths", () => {
			const choice = chooseItems(
				found({ skills: [skill("a/foo"), skill("b/foo"), skill("bar")] }),
				{ kind: "skills", names: ["foo", "bar"] },
				ctx,
			);

			expect(choice.outcome).toEqual({
				kind: "refuse",
				message: '"foo" matches more than one skill: a/foo, b/foo',
			});
		});

		it("reports missing and ambiguous names together", () => {
			const choice = chooseItems(
				found({ skills: [skill("a/foo"), skill("b/foo")] }),
				{ kind: "skills", names: ["foo", "x"] },
				ctx,
			);

			expect(choice.outcome).toEqual({
				kind: "refuse",
				message:
					'no skill named "x"\n"foo" matches more than one skill: a/foo, b/foo',
			});
		});

		it("installs a skill from a pack loose, noting the pack and what it leaves out", () => {
			const choice = chooseItems(
				found({ packs: [LARAVEL] }),
				{ kind: "skills", names: ["api"] },
				ctx,
			);

			expect(choice.outcome).toEqual({
				kind: "install",
				items: [{ kind: "skill", skill: skill("laravel/skills/api") }],
				notes: [
					"api is part of the pack laravel — installed on its own, without models and its agents/hooks",
				],
			});
		});

		it("mentions only the pack's skills when it has no agents or hooks", () => {
			const choice = chooseItems(
				found({ packs: [{ ...LARAVEL, assetDirs: [] }] }),
				{ kind: "skills", names: ["api"] },
				ctx,
			);

			expect(choice.outcome).toMatchObject({
				notes: [
					"api is part of the pack laravel — installed on its own, without models",
				],
			});
		});

		it("mentions only the agents or hooks the pack has", () => {
			const choice = chooseItems(
				found({
					packs: [pack("p", { skills: [skill("p/a")], assetDirs: ["hooks"] })],
				}),
				{ kind: "skills", names: ["a"] },
				ctx,
			);

			expect(choice.outcome).toMatchObject({
				notes: [
					"a is part of the pack p — installed on its own, without its hooks",
				],
			});
		});

		it("names the support folders left behind, last", () => {
			const choice = chooseItems(
				found({
					packs: [
						{
							...LARAVEL,
							supportFolders: [
								{ name: "gates", path: "laravel/skills/gates" },
								{ name: "shared", path: "laravel/skills/shared" },
							],
						},
					],
				}),
				{ kind: "skills", names: ["api"] },
				ctx,
			);

			expect(choice.outcome).toMatchObject({
				items: [{ kind: "skill", skill: skill("laravel/skills/api") }],
				notes: [
					"api is part of the pack laravel — installed on its own, without models, its agents/hooks and its support folders gates, shared",
				],
			});
		});

		it("names a lone support folder left behind, even with every skill taken", () => {
			const choice = chooseItems(
				found({
					packs: [
						pack("p", {
							skills: [skill("p/skills/a")],
							supportFolders: [{ name: "shared", path: "p/skills/shared" }],
						}),
					],
				}),
				{ kind: "skills", names: ["a"] },
				ctx,
			);

			expect(choice.outcome).toMatchObject({
				notes: [
					"a is part of the pack p — installed on its own, without its support folder shared",
				],
			});
		});

		it("doesn't count skills also being installed as left out", () => {
			const choice = chooseItems(
				found({ packs: [{ ...LARAVEL, assetDirs: [] }] }),
				{ kind: "skills", names: ["api", "models"] },
				ctx,
			);

			expect(choice.outcome).toMatchObject({
				notes: [
					"api is part of the pack laravel — installed on its own",
					"models is part of the pack laravel — installed on its own",
				],
			});
		});

		it("names a root pack by the repo name", () => {
			const choice = chooseItems(
				found({ packs: [pack("", { skills: [skill("a")] })] }),
				{ kind: "skills", names: ["a"] },
				ctx,
			);

			expect(choice.outcome).toMatchObject({
				notes: ["a is part of the pack repo — installed on its own"],
			});
		});
	});

	describe("--all", () => {
		it("installs every pack as a pack, then every loose skill", () => {
			const choice = chooseItems(
				found({ packs: [LARAVEL], skills: [skill("tools/lint")] }),
				{ kind: "all" },
				ctx,
			);

			expect(choice.outcome).toEqual({
				kind: "install",
				items: [
					{ kind: "pack", pack: LARAVEL },
					{ kind: "skill", skill: skill("tools/lint") },
				],
				notes: [],
			});
		});

		it("leaves out a pack with nothing to install", () => {
			const choice = chooseItems(
				found({ packs: [pack("empty")], skills: [skill("a")] }),
				{ kind: "all" },
				ctx,
			);

			expect(choice.outcome).toMatchObject({
				items: [{ kind: "skill", skill: skill("a") }],
			});
		});
	});

	describe("no flag", () => {
		it("installs one pack without a menu", () => {
			expect(
				chooseItems(found({ packs: [LARAVEL] }), AUTO, ctx).outcome,
			).toEqual({
				kind: "install",
				items: [{ kind: "pack", pack: LARAVEL }],
				notes: [],
			});
		});

		it("installs one loose skill without a menu", () => {
			expect(
				chooseItems(found({ skills: [skill("", { name: "repo" })] }), AUTO, ctx)
					.outcome,
			).toEqual({
				kind: "install",
				items: [{ kind: "skill", skill: { name: "repo", path: "" } }],
				notes: [],
			});
		});

		it("offers a menu of packs, then loose skills, each sorted by path", () => {
			const choice = chooseItems(
				found({
					packs: [pack("z-pack", { skills: [skill("z-pack/s")] }), LARAVEL],
					skills: [skill("tools/b"), skill("tools/a")],
				}),
				AUTO,
				ctx,
			);

			expect(
				choice.outcome.kind === "menu" &&
					choice.outcome.options.map((option) => option.label),
			).toEqual(["laravel", "z-pack", "tools/a", "tools/b"]);
		});

		it("labels a pack with its skill count and a skill with its description's first line", () => {
			const choice = chooseItems(
				found({
					packs: [LARAVEL, pack("one", { skills: [skill("one/s")] })],
					skills: [
						skill("tools/lint", {
							description: "Lints things.\nAnd more besides.",
						}),
						skill("tools/bare"),
					],
				}),
				AUTO,
				ctx,
			);

			expect(choice.outcome).toEqual({
				kind: "menu",
				options: [
					{
						value: { kind: "pack", pack: LARAVEL },
						label: "laravel",
						hint: "pack · 2 skills",
					},
					{
						value: {
							kind: "pack",
							pack: pack("one", { skills: [skill("one/s")] }),
						},
						label: "one",
						hint: "pack · 1 skill",
					},
					{
						value: { kind: "skill", skill: skill("tools/bare") },
						label: "tools/bare",
					},
					{
						value: {
							kind: "skill",
							skill: skill("tools/lint", {
								description: "Lints things.\nAnd more besides.",
							}),
						},
						label: "tools/lint",
						hint: "Lints things.",
					},
				],
				notes: [],
			});
		});

		it("labels a root pack with the repo name", () => {
			const choice = chooseItems(
				found({
					packs: [pack("", { skills: [skill("s")] })],
					skills: [skill("other/x")],
				}),
				AUTO,
				ctx,
			);

			expect(choice.outcome).toMatchObject({
				options: [{ label: "repo" }, { label: "other/x" }],
			});
		});

		it("leaves empty packs off the menu", () => {
			const choice = chooseItems(
				found({ packs: [pack("empty")], skills: [skill("a"), skill("b")] }),
				AUTO,
				ctx,
			);

			expect(choice.outcome).toMatchObject({
				options: [{ label: "a" }, { label: "b" }],
			});
		});

		it("refuses when the only packs found are empty, naming them", () => {
			const choice = chooseItems(
				found({ packs: [pack("a"), pack("b")] }),
				AUTO,
				ctx,
			);

			expect(choice.outcome).toEqual({
				kind: "refuse",
				message: "nothing to install — a and b have no skills, agents or hooks",
			});
		});
	});

	describe("a skill an installed pack from the source already holds", () => {
		const API_NOTE =
			"api is already installed as part of the pack owner/repo/laravel";
		const packed: ChoiceContext = {
			...ctx,
			packed: new Map([
				["laravel/skills/api", "owner/repo/laravel"],
				["tools/api", "owner/repo/laravel"],
			]),
		};

		it("--skill neither installs it nor says it installs on its own, only that the pack has it", () => {
			const choice = chooseItems(
				found({ packs: [LARAVEL] }),
				{ kind: "skills", names: ["api", "models"] },
				packed,
			);

			expect(choice.outcome).toEqual({
				kind: "install",
				items: [{ kind: "skill", skill: skill("laravel/skills/models") }],
				notes: [
					API_NOTE,
					"models is part of the pack laravel — installed on its own, without its agents/hooks",
				],
			});
		});

		it("--skill on a sibling doesn't count it among what the sibling installs without", () => {
			const choice = chooseItems(
				found({ packs: [LARAVEL] }),
				{ kind: "skills", names: ["models"] },
				packed,
			);

			expect(choice.outcome).toMatchObject({
				notes: [
					"models is part of the pack laravel — installed on its own, without its agents/hooks",
				],
			});
		});

		it("--skill naming only skills the pack has installs nothing, with no refusal", () => {
			const choice = chooseItems(
				found({ packs: [LARAVEL] }),
				{ kind: "skills", names: ["api"] },
				packed,
			);

			expect(choice.outcome).toEqual({
				kind: "install",
				items: [],
				notes: [API_NOTE],
			});
		});

		it("--all leaves it out, saying so, and installs the rest", () => {
			const choice = chooseItems(
				found({ skills: [skill("tools/api"), skill("tools/lint")] }),
				{ kind: "all" },
				packed,
			);

			expect(choice.outcome).toEqual({
				kind: "install",
				items: [{ kind: "skill", skill: skill("tools/lint") }],
				notes: [API_NOTE],
			});
		});

		it("--all with only such skills installs nothing, with no refusal", () => {
			const choice = chooseItems(
				found({ skills: [skill("tools/api")] }),
				{ kind: "all" },
				packed,
			);

			expect(choice.outcome).toEqual({
				kind: "install",
				items: [],
				notes: [API_NOTE],
			});
		});

		it("leaves it off the menu, saying so, and still shows the menu", () => {
			const choice = chooseItems(
				found({ skills: [skill("tools/api"), skill("tools/lint")] }),
				AUTO,
				packed,
			);

			expect(choice.outcome).toEqual({
				kind: "menu",
				options: [
					{
						value: { kind: "skill", skill: skill("tools/lint") },
						label: "tools/lint",
					},
				],
				notes: [API_NOTE],
			});
		});

		it("installs nothing when it is all a source offers", () => {
			const choice = chooseItems(
				found({ skills: [skill("tools/api")] }),
				AUTO,
				packed,
			);

			expect(choice.outcome).toEqual({
				kind: "install",
				items: [],
				notes: [API_NOTE],
			});
		});

		it("still offers the pack that holds it", () => {
			const choice = chooseItems(
				found({ packs: [LARAVEL], skills: [skill("tools/lint")] }),
				AUTO,
				packed,
			);

			expect(choice.outcome).toMatchObject({
				kind: "menu",
				options: [{ label: "laravel" }, { label: "tools/lint" }],
				notes: [],
			});
		});
	});
});
