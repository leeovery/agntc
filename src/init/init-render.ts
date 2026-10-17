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
 * files it will create, then those files as a tree.
 */
export function scaffoldRow(
	subject: string,
	type: InitType,
	paths: readonly string[],
): Row {
	return {
		status: "subject",
		subject,
		detail: `${type} · will create ${pluralize(paths.length, "file")}`,
		children: scaffoldTree(paths),
	};
}

/**
 * `/`-joined paths as a tree: each folder once, before the first path in it,
 * named with a trailing `/`; what's in a folder a level under it.
 */
export function scaffoldTree(paths: readonly string[]): Child[] {
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
			children.push({ name: folder ? `${segment}/` : segment, depth });
		});
	}
	return children;
}

/**
 * Each file in the order the scaffold lists it: created, or skipped as it
 * was there already, and left as it is.
 */
export function scaffoldedRows(
	paths: readonly string[],
	{ skipped }: ScaffoldResult,
): Row[] {
	return paths.map((path) =>
		skipped.includes(path)
			? {
					status: LOOKS.init.skipped.status,
					subject: path,
					detail: { label: LOOKS.init.skipped.label, aside: "already exists" },
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
	return { created: created.length, skipped: skipped.length };
}
