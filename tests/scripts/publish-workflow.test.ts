import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");

function read(path: string): string {
	return readFileSync(join(root, path), "utf-8");
}

/** Each `run:` of a workflow, a block scalar's lines joined. */
function workflowRuns(text: string): string[] {
	const runs: string[] = [];
	const lines = text.split("\n");
	for (const [index, line] of lines.entries()) {
		const match = /^(\s*)(?:- )?run: (.*)$/.exec(line);
		if (!match) {
			continue;
		}
		if (match[2] !== "|") {
			runs.push(match[2]!);
			continue;
		}
		const indent = match[1]!.length;
		const block: string[] = [];
		for (const next of lines.slice(index + 1)) {
			if (next.trim() !== "" && next.search(/\S/) <= indent) {
				break;
			}
			block.push(next.trim());
		}
		runs.push(block.filter(Boolean).join("\n"));
	}
	return runs;
}

/** The steps scripts/gate runs, in order. */
function gateSteps(): string[] {
	return [...read("scripts/gate").matchAll(/^run (.+)$/gm)].map(
		(step) => step[1]!,
	);
}

it("publishes only after the gate's steps, in the gate's order, and setting the version", () => {
	const runs = workflowRuns(read(".github/workflows/publish.yml"));
	const steps = gateSteps();
	const publish = runs.findIndex((run) => run.startsWith("npm publish"));

	expect(steps).toHaveLength(5);
	expect(publish).toBeGreaterThan(-1);
	expect(runs.slice(0, steps.length)).toEqual(steps);
	expect(runs.slice(steps.length, publish)).toEqual([
		`VERSION=\${GITHUB_REF_NAME#v}\nnpm pkg set version="$VERSION"`,
	]);
});
