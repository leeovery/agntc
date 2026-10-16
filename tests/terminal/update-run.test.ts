import { describe, expect, it } from "vitest";
import { blockLayout, renderRow } from "../../src/terminal/block.js";
import { createStyle } from "../../src/terminal/style.js";
import type { Row } from "../../src/terminal/types.js";

// The update run from the mock-up Lee picked, rendered against its own text.

const plain = createStyle(0);
const gap = (columns: number) => " ".repeat(columns);
const BRANCH = "feature/a-very-long-branch-name-that-is-the-intent";

const groups: Row[] = [
	{
		status: "done",
		subject: "leeovery/agentic-skills",
		meta: "^0.2.4",
		detail: { move: { from: "v0.2.4", to: "v0.2.5" } },
		children: [
			{ name: "laravel", detail: "pack · 14 skills" },
			{ name: "nuxt", detail: "pack · 9 skills, 2 folders" },
		],
	},
	{
		status: "done",
		subject: "referodesign/refero_skill",
		meta: "^1.0.2",
		detail: { move: { from: "v1.0.2", to: "v1.0.3" } },
		children: [{ name: "refero-design", detail: "skill" }],
	},
	{
		status: "unchanged",
		subject: "leeovery/agentic-workflows",
		meta: "^0.8.18",
		detail: "up to date",
	},
	{
		status: "unchanged",
		subject: "github/gh-stack",
		meta: "^0.2.1",
		detail: "up to date",
	},
	{
		status: "attention",
		subject: "petekp/claude-skills",
		meta: "HEAD",
		detail: {
			label: "not checked",
			aside: "Could not resolve host: github.com",
		},
	},
	{
		status: "failed",
		subject: "rshankras/claude-code-apple-skills",
		meta: "^1.4.0",
		detail: { move: { from: "v1.4.0", to: "v1.5.0" }, note: "not applied" },
		children: [
			{
				name: "macos",
				detail:
					"it would remove macos-hig, which is still in the source but would no longer be installed. The install is unchanged.",
			},
		],
	},
];

const branchy: Row = {
	status: "done",
	subject: "leeovery/branchy",
	meta: BRANCH,
	detail: { move: { from: "1a2b3c4", to: "5d6e7f8" } },
};

// The mock's header runs into the last column, which its own rule keeps
// clear; the header keeps that margin, so only the rows are compared.
const MOCK = [
	" ✓ leeovery/agentic-skills              ^0.2.4    v0.2.4 → v0.2.5",
	"   ├─ laravel                                     pack · 14 skills",
	"   └─ nuxt                                        pack · 9 skills, 2 folders",
	" ✓ referodesign/refero_skill            ^1.0.2    v1.0.2 → v1.0.3",
	"   └─ refero-design                               skill",
	" ○ leeovery/agentic-workflows           ^0.8.18   up to date",
	" ○ github/gh-stack                      ^0.2.1    up to date",
	" ! petekp/claude-skills                 HEAD      not checked · Could not resolve host: github.com",
	" ✗ rshankras/claude-code-apple-skills   ^1.4.0    v1.4.0 → v1.5.0  not applied",
	"   └─ macos                                       it would remove macos-hig, which is still in the",
	"                                                  source but would no longer be installed. The",
	"                                                  install is unchanged.",
];

function rendered(
	rows: readonly Row[],
	layoutRows: readonly Row[],
	width: number,
): string[] {
	const layout = blockLayout(layoutRows, width);
	return rows.flatMap((row) => renderRow(row, layout, width, plain));
}

describe("the mock-up's update run", () => {
	it("renders as the mock at 100", () => {
		expect(rendered(groups, groups, 100)).toEqual(MOCK);
	});

	it("moves only its own row's detail down for a meta too long for the column", () => {
		expect(rendered([...groups, branchy], [...groups, branchy], 100)).toEqual([
			...MOCK,
			` ✓ leeovery/branchy${gap(21)}${BRANCH}`,
			`${gap(50)}1a2b3c4 → 5d6e7f8`,
		]);
	});

	it.each([
		100, 80, 60,
	])("keeps every other row in its columns beside that meta at %i", (width) => {
		expect(rendered(groups, [...groups, branchy], width)).toEqual(
			rendered(groups, groups, width),
		);
	});
});
