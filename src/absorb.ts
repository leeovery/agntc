import { skillTarget } from "./asset-targets.js";
import { checkFileCollisions } from "./collision-check.js";
import type { Discovery } from "./discover.js";
import { isSameSource, type SourceId, sourceIdOf } from "./entry-source.js";
import type { Manifest } from "./manifest.js";
import { memberName } from "./source-parser.js";

/** The installed entries whose recorded files a pack's install lands on. */
export interface Claims {
	/** Loose skills from the pack's own source: the pack takes them over. */
	absorbed: string[];
	/** Every other entry in the way, with the files the pack would write over. */
	clashes: Map<string, string[]>;
}

/**
 * Sorts out whose files a pack keyed `key` would write over: loose skill
 * entries from its own source are absorbed, anything else clashes.
 */
export function claimFiles(
	incomingFiles: string[],
	manifest: Manifest,
	key: string,
	source: SourceId,
): Claims {
	const claims: Claims = { absorbed: [], clashes: new Map() };
	for (const [other, files] of checkFileCollisions(
		incomingFiles,
		manifest,
		key,
	)) {
		if (isLooseSkillFrom(other, manifest, source)) {
			claims.absorbed.push(other);
		} else {
			claims.clashes.set(other, files);
		}
	}
	return claims;
}

function isLooseSkillFrom(
	key: string,
	manifest: Manifest,
	source: SourceId,
): boolean {
	const entry = manifest[key];
	return (
		entry !== undefined &&
		(entry.type ?? "skill") === "skill" &&
		isSameSource(sourceIdOf(key, entry), source)
	);
}

export function absorptionNote(packKey: string, looseKey: string): string {
	return `${packKey} now includes ${memberName(looseKey)}, installed on its own before`;
}

/** Names the loose skills a pack took over, for when its copy then failed. */
export function takenOverRemoved(looseKeys: string[]): string {
	const [noun, verb] =
		looseKeys.length === 1 ? ["skill", "was"] : ["skills", "were"];
	return `the ${noun} it took over ${verb} removed: ${looseKeys.join(", ")}`;
}

/**
 * Every discovered skill, loose or in a pack, that an installed pack from
 * `source` already holds: its path, to that pack's key.
 */
export function skillsInInstalledPacks(
	discovery: Discovery,
	manifest: Manifest,
	source: SourceId,
): Map<string, string> {
	const packed = new Map<string, string>();
	const skills = [
		...discovery.skills,
		...discovery.packs.flatMap((pack) => pack.skills),
	];
	for (const skill of skills) {
		const pack = packHolding(skill.name, manifest, source);
		if (pack !== undefined) {
			packed.set(skill.path, pack);
		}
	}
	return packed;
}

/** The installed pack from `source` that holds the skill `name`, if any. */
function packHolding(
	name: string,
	manifest: Manifest,
	source: SourceId,
): string | undefined {
	const target = skillTarget(name);
	return Object.entries(manifest).find(
		([key, entry]) =>
			entry.type === "pack" &&
			entry.files.includes(target) &&
			isSameSource(sourceIdOf(key, entry), source),
	)?.[0];
}
