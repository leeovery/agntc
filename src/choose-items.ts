import {
	comparePaths,
	type Discovery,
	type FoundPack,
	type FoundSkill,
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
import {
	type Advice,
	type RichMessage,
	type SubjectMessage,
	sentence,
} from "./message.js";
import { agntcCommand, type ScopeName } from "./scope.js";
import { locateSource } from "./source-parser.js";
import { formatPackCounts, joinWithAnd } from "./summary.js";

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
	/**
	 * What `add` takes to reach the source: `owner/repo`, the clone URL for
	 * another host or SSH, or the local path.
	 */
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
 * What the choice says of one skill, named by its label: left out, as an
 * installed pack holds it, or taken out of its pack to install on its own.
 */
export interface SkillNote extends SubjectMessage {
	/** The skill's path in the source. */
	path: string;
	/** The installed pack holding the skill, by key, when it's left out for that. */
	heldBy?: string;
}

/**
 * `install` with no items installs nothing and is not an error: everything
 * asked for is already installed in a pack, as the notes say.
 */
export type ChoiceOutcome =
	| { kind: "install"; items: InstallItem[]; notes: SkillNote[] }
	| { kind: "menu"; options: MenuOption[]; notes: SkillNote[] }
	| { kind: "refuse"; message: string };

/**
 * A folder whose agents or hooks won't be installed: advice carrying the
 * `--pack` line that would install them, or a warning where there's none.
 */
export type StrayNotice = Advice | RichMessage;

export interface Choice {
	/** Told before anything else, a menu or a refusal included. */
	strayNotices: StrayNotice[];
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

/** One notice per folder whose agents or hooks won't be installed, with the `--pack` line that would where there is one. */
export function strayNotices(
	discovery: Discovery,
	ctx: ChoiceContext,
): StrayNotice[] {
	return discovery.strays.map((stray) =>
		strayNotice(stray, discovery.packs, ctx),
	);
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
		...taken.flatMap((match) => takenSkillNotes(match, present, ctx)),
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
): { items: InstallItem[]; notes: SkillNote[] } {
	const kept: InstallItem[] = [];
	const notes: SkillNote[] = [];
	for (const item of items) {
		const pack =
			item.kind === "skill" ? ctx.packed?.get(item.skill.path) : undefined;
		if (item.kind === "skill" && pack !== undefined) {
			notes.push({
				...skillNote(item.skill, heldDetail(pack), ctx),
				heldBy: pack,
			});
		} else {
			kept.push(item);
		}
	}
	return { items: kept, notes };
}

/** Why a skill is left out: the installed pack `pack` holds it. */
export function heldDetail(pack: string): string {
	return `already installed as part of the pack ${pack}`;
}

/** `<name> is <detail>`, said of the skill its label names. */
function skillNote(
	skill: FoundSkill,
	detail: string,
	ctx: ChoiceContext,
): SkillNote {
	const text = `${skill.name} is ${detail}`;
	return {
		subject: pathLabel(skill.path, ctx.rootName),
		detail,
		text,
		plain: text,
		path: skill.path,
	};
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
			? `pack · ${formatPackCounts({
					skills: item.pack.skills.length,
					folders: item.pack.supportFolders.length,
				})}`
			: skillHint(item.skill);
	return { value: item, label, ...(hint ? { hint } : {}) };
}

/** What a skill's option says of it: its description's first line. */
export function skillHint(skill: FoundSkill): string | undefined {
	return skill.description?.split("\n")[0]?.trim();
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

/**
 * Gives the `--pack` line that would install a stray's agents and hooks, unless
 * its folder holds packs, which `--pack` refuses to bundle.
 */
function strayNotice(
	stray: StrayAssets,
	packs: FoundPack[],
	ctx: ChoiceContext,
): StrayNotice {
	const label = pathLabel(stray.path, ctx.rootName);
	const left = `has ${joinWithAnd(stray.assetDirs.map((dir) => `${dir}/`))} that won't be installed`;
	const held = packs.filter((pack) => isWithin(pack.path, stray.path));
	if (held.length > 0) {
		const paths = held.map((pack) => pack.path).join(", ");
		return sentence(
			`${label} ${left} — it contains packs (${paths}), so --pack can't bundle it`,
		);
	}
	const command = agntcCommand(ctx.scope, "add", [
		locateSource(ctx.source, stray.path, ctx.version),
		"--pack",
	]);
	return {
		subject: label,
		detail: `${left}.`,
		text: `${label} ${left}.`,
		remedy: { lead: "To install them as a pack:", steps: [{ command }] },
		plain: `${label} ${left} — to install them as a pack: ${command}`,
	};
}

/** Whether `path` is below `folder`, both relative to the source root. */
function isWithin(path: string, folder: string): boolean {
	return folder === "" || path.startsWith(`${folder}/`);
}

/**
 * Notes that a skill taken out of a pack installs on its own, naming what the
 * pack holds that isn't `present` (installed already, or alongside it), its
 * support folders included.
 */
function takenSkillNotes(
	{ skill, pack }: SkillMatch,
	present: Set<string>,
	ctx: ChoiceContext,
): SkillNote[] {
	if (pack === undefined) {
		return [];
	}
	const taken = `part of the pack ${pathLabel(pack.path, ctx.rootName)} — installed on its own`;
	const leftOut = leftOutOf(pack, present);
	const detail = leftOut === "" ? taken : `${taken}, without ${leftOut}`;
	return [skillNote(skill, detail, ctx)];
}

function leftOutOf(pack: FoundPack, present: Set<string>): string {
	const otherSkills = pack.skills
		.filter((skill) => !present.has(skill.path))
		.map((skill) => skill.name)
		.join(", ");
	const assets =
		pack.assetDirs.length > 0 ? `its ${pack.assetDirs.join("/")}` : "";
	// Support folders go last, so the names after "its support folders" are plainly theirs.
	return joinWithAnd(
		[otherSkills, assets, supportFoldersOf(pack)].filter((part) => part !== ""),
	);
}

function supportFoldersOf({ supportFolders }: FoundPack): string {
	if (supportFolders.length === 0) {
		return "";
	}
	const noun = supportFolders.length === 1 ? "folder" : "folders";
	const names = supportFolders.map((folder) => folder.name).join(", ");
	return `its support ${noun} ${names}`;
}

function byPath(a: { path: string }, b: { path: string }): number {
	return comparePaths(a.path, b.path);
}

function quote(name: string): string {
	return `"${name}"`;
}

function install(items: InstallItem[], notes: SkillNote[] = []): ChoiceOutcome {
	return { kind: "install", items, notes };
}

function refuse(message: string): ChoiceOutcome {
	return { kind: "refuse", message };
}
