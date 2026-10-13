import {
	comparePaths,
	type Discovery,
	type FoundPack,
	matchSkills,
	type SkillMatch,
	type StrayAssets,
} from "./discover.js";
import {
	type InstallItem,
	isEmptyPack,
	itemLabel,
	pathLabel,
} from "./install-item.js";
import { joinWithAnd, pluralize } from "./summary.js";

/** What the user asked `add` to install. */
export type Selection =
	| { kind: "auto" }
	| { kind: "skills"; names: string[] }
	| { kind: "pack" }
	| { kind: "all" };

export interface SelectionFlags {
	skill?: string[];
	pack?: boolean;
	plugin?: boolean;
	all?: boolean;
}

export type SelectionResult =
	| { ok: true; selection: Selection }
	| { ok: false; message: string };

/** Where the items come from, for labels and the commands notices suggest. */
export interface ChoiceContext {
	/** `owner/repo`, or the local path. */
	source: string;
	/** The `@ref` or `@constraint` the user gave, without the `@`. */
	version?: string;
	rootName: string;
}

export interface MenuOption {
	value: InstallItem;
	label: string;
	hint?: string;
}

export type ChoiceOutcome =
	| { kind: "install"; items: InstallItem[]; notes: string[] }
	| { kind: "menu"; options: MenuOption[] }
	| { kind: "refuse"; message: string };

export interface Choice {
	/** Printed before anything else, a menu or a refusal included. */
	strayNotices: string[];
	outcome: ChoiceOutcome;
}

/** Turns the add flags into a selection, refusing any two that clash. */
export function selectionFromFlags(flags: SelectionFlags): SelectionResult {
	const packFlag = flags.pack ? "--pack" : flags.plugin ? "--plugin" : null;
	const given = [
		flags.skill !== undefined ? "--skill" : null,
		packFlag,
		flags.all ? "--all" : null,
	].filter((flag) => flag !== null);

	if (given.length > 1) {
		return { ok: false, message: `${joinWithAnd(given)} can't be combined` };
	}
	if (flags.skill !== undefined) {
		return { ok: true, selection: { kind: "skills", names: flags.skill } };
	}
	if (packFlag !== null) {
		return { ok: true, selection: { kind: "pack" } };
	}
	return { ok: true, selection: { kind: flags.all ? "all" : "auto" } };
}

/**
 * Decides what to install from what discovery found. `selection.kind ===
 * "pack"` expects a discovery made with `forcePack`.
 */
export function chooseItems(
	discovery: Discovery,
	selection: Selection,
	ctx: ChoiceContext,
): Choice {
	return {
		strayNotices: discovery.strays.map((stray) => strayNotice(stray, ctx)),
		outcome: decide(discovery, selection, ctx),
	};
}

function decide(
	discovery: Discovery,
	selection: Selection,
	ctx: ChoiceContext,
): ChoiceOutcome {
	switch (selection.kind) {
		case "pack":
			return choosePack(discovery, ctx);
		case "skills":
			return chooseSkills(discovery, selection.names, ctx);
		case "all":
			return chooseAll(discovery, ctx);
		case "auto":
			return chooseAuto(discovery, ctx);
	}
}

function choosePack(discovery: Discovery, ctx: ChoiceContext): ChoiceOutcome {
	const [pack] = discovery.packs;
	if (pack === undefined || isEmptyPack(pack)) {
		return refuse(nothingToInstall(discovery, ctx));
	}
	return install([{ kind: "pack", pack }]);
}

function chooseSkills(
	discovery: Discovery,
	names: string[],
	ctx: ChoiceContext,
): ChoiceOutcome {
	const { matched, missing, ambiguous } = matchSkills(discovery, names);
	const problems = [
		...(missing.length > 0
			? [`no skill named ${missing.map(quote).join(", ")}`]
			: []),
		...ambiguous.map(
			({ name, paths }) =>
				`${quote(name)} matches more than one skill: ${paths.join(", ")}`,
		),
	];
	if (problems.length > 0) {
		return refuse(problems.join("\n"));
	}

	const chosen = new Set(matched.map(({ skill }) => skill.path));
	return install(
		matched.map(({ skill }) => ({ kind: "skill", skill })),
		matched.flatMap((match) => packedSkillNotes(match, chosen, ctx)),
	);
}

function chooseAll(discovery: Discovery, ctx: ChoiceContext): ChoiceOutcome {
	const items = candidates(discovery);
	return items.length === 0
		? refuse(nothingToInstall(discovery, ctx))
		: install(items);
}

function chooseAuto(discovery: Discovery, ctx: ChoiceContext): ChoiceOutcome {
	const items = candidates(discovery);
	const [only] = items;
	if (only === undefined) {
		return refuse(nothingToInstall(discovery, ctx));
	}
	if (items.length === 1) {
		return install([only]);
	}
	return {
		kind: "menu",
		options: items.map((item) => menuOption(item, ctx.rootName)),
	};
}

/** Every pack worth installing, by path, then every loose skill, by path. */
function candidates(discovery: Discovery): InstallItem[] {
	const packs = discovery.packs
		.filter((pack) => !isEmptyPack(pack))
		.sort(byPath)
		.map((pack): InstallItem => ({ kind: "pack", pack }));
	const skills = [...discovery.skills]
		.sort(byPath)
		.map((skill): InstallItem => ({ kind: "skill", skill }));
	return [...packs, ...skills];
}

function menuOption(item: InstallItem, rootName: string): MenuOption {
	const label = itemLabel(item, rootName);
	const hint =
		item.kind === "pack"
			? `pack · ${pluralize(item.pack.skills.length, "skill")}`
			: item.skill.description?.split("\n")[0]?.trim();
	return { value: item, label, ...(hint ? { hint } : {}) };
}

function nothingToInstall(discovery: Discovery, ctx: ChoiceContext): string {
	if (discovery.packs.length === 0) {
		return "no skills or packs were found";
	}
	const labels = discovery.packs.map((pack) =>
		pathLabel(pack.path, ctx.rootName),
	);
	return `nothing to install — ${joinWithAnd(labels)} ${labels.length === 1 ? "has" : "have"} no skills, agents or hooks`;
}

function strayNotice(stray: StrayAssets, ctx: ChoiceContext): string {
	const dirs = joinWithAnd(stray.assetDirs.map((dir) => `${dir}/`));
	return `${pathLabel(stray.path, ctx.rootName)} has ${dirs} that won't be installed — to install them as a pack: npx agntc add ${addSource(stray.path, ctx)} --pack`;
}

/**
 * Notes that a skill taken out of a pack installs on its own, naming what the
 * pack holds that isn't being installed alongside it.
 */
function packedSkillNotes(
	{ skill, pack }: SkillMatch,
	chosen: Set<string>,
	ctx: ChoiceContext,
): string[] {
	if (pack === undefined) {
		return [];
	}
	const note = `${skill.name} is part of the pack ${pathLabel(pack.path, ctx.rootName)} — installed on its own`;
	const leftOut = leftOutOf(pack, chosen);
	return [leftOut === "" ? note : `${note}, without ${leftOut}`];
}

function leftOutOf(pack: FoundPack, chosen: Set<string>): string {
	const otherSkills = pack.skills
		.filter((skill) => !chosen.has(skill.path))
		.map((skill) => skill.name)
		.join(", ");
	const assets =
		pack.assetDirs.length > 0 ? `its ${pack.assetDirs.join("/")}` : "";
	return [otherSkills, assets].filter((part) => part !== "").join(" and ");
}

function addSource(path: string, ctx: ChoiceContext): string {
	const located = path === "" ? ctx.source : `${ctx.source}/${path}`;
	return ctx.version === undefined ? located : `${located}@${ctx.version}`;
}

function byPath(a: { path: string }, b: { path: string }): number {
	return comparePaths(a.path, b.path);
}

function quote(name: string): string {
	return `"${name}"`;
}

function install(items: InstallItem[], notes: string[] = []): ChoiceOutcome {
	return { kind: "install", items, notes };
}

function refuse(message: string): ChoiceOutcome {
	return { kind: "refuse", message };
}
