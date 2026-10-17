import { pluralize } from "../summary.js";
import { LOOKS } from "../terminal/tally.js";
import type { Child, Row } from "../terminal/types.js";
import type { InitTally } from "../ui.js";
import type { ScaffoldResult } from "./scaffold-utils.js";
import type { InitType } from "./type-select.js";

/** What to do once a scaffold has created something. */
export const NEXT_STEP: Readonly<Record<InitType, string>> = {
	skill: "Done. Edit `SKILL.md` to define your skill.",
	pack: "Done. Add skills under `skills/`, agents to `agents/` and hooks to `hooks/`.",
};

/**
 * What `init` asks about: the folder it scaffolds, as what, and how many
 * files it will create, then the scaffold's files as a tree, those `existing`
 * already there, which it leaves as they are.
 */
export function scaffoldRow(
	subject: string,
	type: InitType,
	paths: readonly string[],
	existing: readonly string[] = [],
): Row {
	const creating = paths.length - existing.length;
	return {
		status: "subject",
		subject,
		detail: `${type} · will create ${pluralize(creating, "file")}`,
		children: scaffoldTree(paths, existing),
	};
}

/**
 * `/`-joined paths as a tree: each folder once, before the first path in it,
 * named with a trailing `/`; what's in a folder a level under it. Each file
 * is a `file`, which a cut tree counts, its folders aside; one `existing`
 * says it's already there.
 */
export function scaffoldTree(
	paths: readonly string[],
	existing: readonly string[] = [],
): Child[] {
	const children: Child[] = [];
	const shown = new Set<string>();
	for (const path of paths) {
		const segments = path.split("/");
		segments.forEach((segment, depth) => {
			const at = segments.slice(0, depth + 1).join("/");
			if (shown.has(at)) {
				return;
			}
			shown.add(at);
			const folder = depth < segments.length - 1;
			children.push(
				folder
					? { name: `${segment}/`, depth }
					: {
							name: segment,
							depth,
							noun: "file",
							...(existing.includes(path)
								? { detail: LOOKS.init.existing.label }
								: {}),
						},
			);
		});
	}
	return children;
}

/**
 * Each file in the order the scaffold lists it: created, or already there,
 * and left as it is.
 */
export function scaffoldedRows(
	paths: readonly string[],
	{ skipped }: ScaffoldResult,
): Row[] {
	return paths.map((path) =>
		skipped.includes(path)
			? {
					status: LOOKS.init.existing.status,
					subject: path,
					detail: { label: LOOKS.init.existing.label },
				}
			: {
					status: LOOKS.init.created.status,
					subject: path,
					detail: { label: LOOKS.init.created.label },
				},
	);
}

/** Each file the scaffold lists, counted by what became of it. */
export function initTally({ created, skipped }: ScaffoldResult): InitTally {
	return { created: created.length, existing: skipped.length };
}
