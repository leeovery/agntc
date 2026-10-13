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
	itemPath,
	pathLabel,
} from "./install-item.js";
import { agntcCommand, type ScopeName } from "./scope.js";
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
	/** Show what the source holds instead of installing. */
	list?: boolean;
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
	/** Where the suggested commands install. */
	scope: ScopeName;
	/**
	 * Discovered skill paths an installed pack from this source already holds,
	 * each to that pack's key. Such a skill is never installed on its own.
	 */
	packed?: ReadonlyMap<string, string>;
}

export interface MenuOption {
	value: InstallItem;
	label: string;
	hint?: string;
}

/**
 * `install` with no items installs nothing and is not an error: everything
 * asked for is already installed in a pack, as the notes say.
 */
export type ChoiceOutcome =
	| { kind: "install"; items: InstallItem[]; notes: string[] }
	| { kind: "menu"; options: MenuOption[]; notes: string[] }
	| { kind: "refuse"; message: string };

export interface Choice {
	/** Printed before anything else, a menu or a refusal included. */
	strayNotices: string[];
	outcome: ChoiceOutcome;
}

/**
 * Turns the add flags into a selection, refusing any two that clash. `--list`
 * shows what `add` would read, so of the selectors it takes only `--pack`.
 */
export function selectionFromFlags(flags: SelectionFlags): SelectionResult {
	const packFlag = flags.pack ? "--pack" : flags.plugin ? "--plugin" : null;
	const given = [
		flags.skill !== undefined ? "--skill" : null,
		packFlag,
		flags.all ? "--all" : null,
	].filter((flag) => flag !== null);
	const [selector] = given;

	if (given.length > 1) {
		return clash(given);
	}
	if (flags.list && selector !== undefined && selector !== packFlag) {
		return clash([selector, "--list"]);
	}
	if (flags.skill !== undefined) {
		return { ok: true, selection: { kind: "skills", names: flags.skill } };
	}
	if (packFlag !== null) {
		return { ok: true, selection: { kind: "pack" } };
	}
	return { ok: true, selection: { kind: flags.all ? "all" : "auto" } };
}

function clash(flags: string[]): SelectionResult {
	return { ok: false, message: `${joinWithAnd(flags)} can't be combined` };
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
		strayNotices: strayNotices(discovery, ctx),
		outcome: decide(discovery, selection, ctx),
	};
}

/** One notice per folder whose agents or hooks won't be installed, with the `--pack` line that would. */
export function strayNotices(
	discovery: Discovery,
	ctx: ChoiceContext,
): string[] {
	return discovery.strays.map((stray) => strayNotice(stray, ctx));
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

	const { items, notes } = withoutPacked(
		matched.map(({ skill }): InstallItem => ({ kind: "skill", skill })),
		ctx,
	);
	const installing = new Set(items.map(itemPath));
	const present = new Set([...installing, ...(ctx.packed?.keys() ?? [])]);
	const taken = matched.filter(({ skill }) => installing.has(skill.path));
	return install(items, [
		...notes,
		...taken.flatMap((match) => packedSkillNotes(match, present, ctx)),
	]);
}

function chooseAll(discovery: Discovery, ctx: ChoiceContext): ChoiceOutcome {
	const offered = offeredItems(discovery);
	if (offered.length === 0) {
		return refuse(nothingToInstall(discovery, ctx));
	}
	const { items, notes } = withoutPacked(offered, ctx);
	return install(items, notes);
}

/**
 * Installs the one thing a source offers, else shows the menu. Whether there
 * is a menu turns on what the source holds, so a skill already installed in a
 * pack is left out of the menu rather than making the choice for the user.
 */
function chooseAuto(discovery: Discovery, ctx: ChoiceContext): ChoiceOutcome {
	const offered = offeredItems(discovery);
	if (offered.length === 0) {
		return refuse(nothingToInstall(discovery, ctx));
	}
	const { items, notes } = withoutPacked(offered, ctx);
	if (offered.length === 1 || items.length === 0) {
		return install(items, notes);
	}
	return {
		kind: "menu",
		options: items.map((item) => menuOption(item, ctx.rootName)),
		notes,
	};
}

/** Leaves out each skill an installed pack already holds, saying so. */
function withoutPacked(
	items: InstallItem[],
	ctx: ChoiceContext,
): { items: InstallItem[]; notes: string[] } {
	const kept: InstallItem[] = [];
	const notes: string[] = [];
	for (const item of items) {
		const pack =
			item.kind === "skill" ? ctx.packed?.get(item.skill.path) : undefined;
		if (item.kind === "skill" && pack !== undefined) {
			notes.push(
				`${item.skill.name} is already installed as part of the pack ${pack}`,
			);
		} else {
			kept.push(item);
		}
	}
	return { items: kept, notes };
}

/**
 * Every pack worth installing, by path, then every loose skill, by path: what
 * the menu offers, `--all` installs and `--list` shows.
 */
export function offeredItems(discovery: Discovery): InstallItem[] {
	const packs = discovery.packs
		.filter((pack) => !isEmptyPack(pack))
		.sort(byPath)
		.map((pack): InstallItem => ({ kind: "pack", pack }));
	const skills = [...discovery.skills]
		.sort(byPath)
		.map((skill): InstallItem => ({ kind: "skill", skill }));
	return [...packs, ...skills];
}

export function menuOption(item: InstallItem, rootName: string): MenuOption {
	const label = itemLabel(item, rootName);
	const hint =
		item.kind === "pack"
			? `pack · ${pluralize(item.pack.skills.length, "skill")}`
			: item.skill.description?.split("\n")[0]?.trim();
	return { value: item, label, ...(hint ? { hint } : {}) };
}

/** A menu option as one line of text, for when there's no menu to show it in. */
export function optionLine({ label, hint }: MenuOption): string {
	return hint === undefined ? label : `${label} (${hint})`;
}

/** Why a menu can't stand in for a person, listing what it would have offered. */
export function unansweredMenu(options: MenuOption[]): string {
	const found = options.map((option) => `  ${optionLine(option)}`);
	return [
		"found more than one thing to install — name what to install with --skill, --pack or --all, or add the path to one skill or pack:",
		...found,
	].join("\n");
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
	const command = agntcCommand(ctx.scope, "add", [
		addSource(stray.path, ctx),
		"--pack",
	]);
	return `${pathLabel(stray.path, ctx.rootName)} has ${dirs} that won't be installed — to install them as a pack: ${command}`;
}

/**
 * Notes that a skill taken out of a pack installs on its own, naming what the
 * pack holds that isn't `present`: installed already, or alongside it.
 */
function packedSkillNotes(
	{ skill, pack }: SkillMatch,
	present: Set<string>,
	ctx: ChoiceContext,
): string[] {
	if (pack === undefined) {
		return [];
	}
	const note = `${skill.name} is part of the pack ${pathLabel(pack.path, ctx.rootName)} — installed on its own`;
	const leftOut = leftOutOf(pack, present);
	return [leftOut === "" ? note : `${note}, without ${leftOut}`];
}

function leftOutOf(pack: FoundPack, present: Set<string>): string {
	const otherSkills = pack.skills
		.filter((skill) => !present.has(skill.path))
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
