import { describe, expect, it } from "vitest";
import {
	blockLayout,
	renderProgress,
	renderRow,
	renderRowsWithin,
	renderRowWithin,
} from "../../src/terminal/block.js";
import { visibleWidth } from "../../src/terminal/layout.js";
import { createStyle } from "../../src/terminal/style.js";
import type { Progress, Row } from "../../src/terminal/types.js";

const plain = createStyle(0);
const color = createStyle(3);
const gap = (columns: number) => " ".repeat(columns);

function block(rows: Row[], width: number, style = plain): string[] {
	const layout = blockLayout(rows, width);
	return rows.flatMap((row) => renderRow(row, layout, width, style));
}

const LONG_SUBJECT = "owner/a-very-long-repository-name-here";
const LONG_META = "feature/a-very-long-branch-name-here";
const APPLE = "rshankras/claude-code-apple-skills";
const attentionRow: Row = {
	status: "attention",
	subject: "petekp/claude-skills",
	meta: "HEAD",
	detail: { label: "not checked", aside: "Could not resolve host: github.com" },
};
const REASON =
	"it would remove macos-hig, which is still in the source but would no longer be installed.";

describe("blockLayout", () => {
	it("gives the subject column the widest subject and 3", () => {
		expect(
			blockLayout([{ status: "done", subject: "owner/alpha" }], 80),
		).toEqual({ subjectWidth: 14, metaWidth: 0, detailAt: 17 });
	});

	it("caps the subject column at 45% of the width", () => {
		const rows: Row[] = [{ status: "done", subject: LONG_SUBJECT }];
		expect(blockLayout(rows, 80).subjectWidth).toBe(36);
		expect(blockLayout(rows, 100).subjectWidth).toBe(41);
	});

	it("measures each child's name, glyph included, into the subject column", () => {
		expect(
			blockLayout(
				[
					{
						status: "done",
						subject: "owner/x",
						children: [{ name: "a-long-child-name", status: "done" }],
					},
				],
				80,
			),
		).toEqual({ subjectWidth: 25, metaWidth: 0, detailAt: 28 });
	});

	it.each([
		[100, 20],
		[80, 16],
		[60, 12],
		[40, 10],
	])("caps the meta column at a fifth of %i, never under 10", (width, cap) => {
		expect(
			blockLayout([{ status: "done", subject: "a", meta: LONG_META }], width)
				.metaWidth,
		).toBe(cap);
	});

	it("measures only the metas that fit the cap", () => {
		expect(
			blockLayout(
				[
					{ status: "done", subject: "a", meta: LONG_META },
					{ status: "done", subject: "b", meta: "^0.10.12" },
				],
				60,
			).metaWidth,
		).toBe(11);
	});

	it("gives the meta column the widest meta and 3, from any row", () => {
		expect(
			blockLayout(
				[
					{ status: "done", subject: "a", meta: "^1.0.0" },
					{ status: "done", subject: "b" },
				],
				80,
			),
		).toEqual({ subjectWidth: 4, metaWidth: 9, detailAt: 16 });
	});
});

describe("renderRow", () => {
	it.each([
		80, 100,
	])("lays a group and its children in columns at %i", (width) => {
		expect(
			block(
				[
					{
						status: "done",
						subject: "owner/alpha",
						meta: "^1.0.0",
						detail: { move: { from: "v1.0.0", to: "v1.1.0" } },
						children: [
							{ name: "one", detail: "skill" },
							{ name: "two", detail: "pack · 2 skills" },
						],
					},
					{
						status: "unchanged",
						subject: "owner/beta",
						meta: "^2.0.0",
						detail: "up to date",
					},
				],
				width,
			),
		).toEqual([
			" ✓ owner/alpha   ^1.0.0   v1.0.0 → v1.1.0",
			"   ├─ one                 skill",
			"   └─ two                 pack · 2 skills",
			" ○ owner/beta    ^2.0.0   up to date",
		]);
	});

	it("leaves no trailing space on a row without detail or meta", () => {
		expect(
			block(
				[
					{ status: "done", subject: "owner/alpha", meta: "^1.0.0" },
					{ status: "done", subject: "owner/b" },
				],
				80,
			),
		).toEqual([" ✓ owner/alpha   ^1.0.0", " ✓ owner/b"]);
	});

	it("keeps the detail column on a row without meta", () => {
		expect(
			block(
				[
					{
						status: "done",
						subject: "owner/alpha",
						meta: "^1.0.0",
						detail: "a",
					},
					{ status: "done", subject: "owner/b", detail: "b" },
				],
				80,
			),
		).toEqual([" ✓ owner/alpha   ^1.0.0   a", ` ✓ owner/b${gap(16)}b`]);
	});

	it("pushes a subject's detail down when it overruns the capped column at 80", () => {
		expect(
			block(
				[
					{ status: "done", subject: LONG_SUBJECT, detail: "installed" },
					{ status: "done", subject: "owner/short", detail: "installed" },
				],
				80,
			),
		).toEqual([
			` ✓ ${LONG_SUBJECT}`,
			`${gap(39)}installed`,
			` ✓ owner/short${gap(25)}installed`,
		]);
	});

	it("fits the same subject in its column at 100", () => {
		expect(
			block(
				[
					{ status: "done", subject: LONG_SUBJECT, detail: "installed" },
					{ status: "done", subject: "owner/short", detail: "installed" },
				],
				100,
			),
		).toEqual([
			` ✓ ${LONG_SUBJECT}   installed`,
			` ✓ owner/short${gap(30)}installed`,
		]);
	});

	it("takes the meta down with the detail, in its column", () => {
		expect(
			block(
				[{ status: "done", subject: LONG_SUBJECT, meta: "^1.0", detail: "x" }],
				80,
			),
		).toEqual([` ✓ ${LONG_SUBJECT}`, `${gap(39)}^1.0   x`]);
	});

	it("follows a move with its note", () => {
		expect(
			block(
				[
					{
						status: "failed",
						subject: "owner/alpha",
						meta: "^1.4.0",
						detail: {
							move: { from: "v1.4.0", to: "v1.5.0" },
							note: "not applied",
						},
					},
				],
				80,
			),
		).toEqual([" ✗ owner/alpha   ^1.4.0   v1.4.0 → v1.5.0  not applied"]);
	});

	const failedGroup: Row = {
		status: "failed",
		subject: "owner/alpha",
		meta: "^1.4.0",
		detail: { move: { from: "v1.4.0", to: "v1.5.0" }, note: "not applied" },
		children: [{ name: "macos", detail: REASON }],
	};

	it("wraps a child's detail inside the detail column at 80", () => {
		expect(block([failedGroup], 80)).toEqual([
			" ✗ owner/alpha   ^1.4.0   v1.4.0 → v1.5.0  not applied",
			"   └─ macos               it would remove macos-hig, which is still in the",
			`${gap(26)}source but would no longer be installed.`,
		]);
	});

	it("wraps it wider at 100", () => {
		expect(block([failedGroup], 100)).toEqual([
			" ✗ owner/alpha   ^1.4.0   v1.4.0 → v1.5.0  not applied",
			"   └─ macos               it would remove macos-hig, which is still in the source but would no",
			`${gap(26)}longer be installed.`,
		]);
	});

	it("wraps a row's own detail, continuing in its column", () => {
		expect(
			block(
				[
					{
						status: "attention",
						subject: "owner/alpha",
						detail:
							"not checked · Could not resolve host: github.com, so the entry is left untouched",
					},
				],
				80,
			),
		).toEqual([
			" ! owner/alpha   not checked · Could not resolve host: github.com, so the entry",
			`${gap(17)}is left untouched`,
		]);
	});

	it("puts a child's status glyph after its branch", () => {
		expect(
			block(
				[
					{
						status: "failed",
						subject: "owner/alpha",
						children: [
							{ name: "one", status: "done", detail: "updated" },
							{ name: "two", status: "failed", detail: "copy failed" },
						],
					},
				],
				80,
			),
		).toEqual([
			" ✗ owner/alpha",
			"   ├─ ✓ one      updated",
			"   └─ ✗ two      copy failed",
		]);
	});

	it("keeps a child longer than its row's subject on its own line", () => {
		expect(
			block(
				[
					{
						status: "done",
						subject: "owner/x",
						children: [
							{ name: "a-long-child-name", detail: "skill" },
							{ name: "b", status: "done", detail: "skill" },
						],
					},
				],
				80,
			),
		).toEqual([
			" ✓ owner/x",
			"   ├─ a-long-child-name   skill",
			`   └─ ✓ b${gap(17)}skill`,
		]);
	});

	it("pushes a child's detail down when its name overruns the capped column", () => {
		expect(
			block(
				[
					{
						status: "done",
						subject: "owner/x",
						children: [{ name: LONG_SUBJECT, detail: "skill" }],
					},
				],
				80,
			),
		).toEqual([" ✓ owner/x", `   └─ ${LONG_SUBJECT}`, `${gap(39)}skill`]);
	});

	it("puts a move's note below the move when the two don't fit together", () => {
		expect(
			block(
				[
					{
						status: "failed",
						subject: APPLE,
						meta: "^0.10.12",
						detail: {
							move: { from: "v0.10.12", to: "v0.11.0" },
							note: "not applied",
						},
					},
				],
				80,
			),
		).toEqual([
			` ✗ ${APPLE}  ^0.10.12   v0.10.12 → v0.11.0`,
			`${gap(50)}not applied`,
		]);
	});

	it("drops the detail below a meta wider than its capped column", () => {
		expect(
			block(
				[
					{
						status: "done",
						subject: "owner/alpha",
						meta: LONG_META,
						detail: "pack · 14 skills, 2 folders",
					},
					{
						status: "done",
						subject: "owner/beta",
						meta: "^1.0.0",
						detail: "skill",
					},
				],
				60,
			),
		).toEqual([
			` ✓ owner/alpha   ${LONG_META}`,
			`${gap(26)}pack · 14 skills, 2 folders`,
			" ✓ owner/beta    ^1.0.0   skill",
		]);
	});

	it("keeps an 8-character meta in its column at 60, the row on two lines", () => {
		expect(
			block(
				[
					{
						status: "failed",
						subject: APPLE,
						meta: "^0.10.12",
						detail: { move: { from: "v0.10.12", to: "v0.11.0" } },
					},
				],
				60,
			),
		).toEqual([` ✗ ${APPLE}`, `${gap(30)}^0.10.12   v0.10.12 → v0.11.0`]);
	});

	it("reads a label then its aside, wrapping as one detail", () => {
		expect(block([attentionRow], 80)).toEqual([
			" ! petekp/claude-skills   HEAD   not checked · Could not resolve host:",
			`${gap(33)}github.com`,
		]);
	});

	it("runs a branch's trunk down past a wrapped child with a sibling below", () => {
		expect(
			block(
				[
					{
						status: "done",
						subject: "owner/alpha",
						children: [
							{ name: "one", detail: REASON },
							{ name: "two", detail: REASON },
						],
					},
				],
				80,
			),
		).toEqual([
			" ✓ owner/alpha",
			"   ├─ one        it would remove macos-hig, which is still in the source but",
			`   │${gap(13)}would no longer be installed.`,
			"   └─ two        it would remove macos-hig, which is still in the source but",
			`${gap(17)}would no longer be installed.`,
		]);
	});

	it("treats an empty detail as absent", () => {
		expect(
			block(
				[
					{
						status: "done",
						subject: "owner/alpha",
						meta: "^1.0.0",
						detail: "",
						children: [{ name: "one", detail: "" }],
					},
				],
				80,
			),
		).toEqual([" ✓ owner/alpha   ^1.0.0", "   └─ one"]);
		expect(
			block([{ status: "done", subject: "owner/alpha", detail: "" }], 40),
		).toEqual([" ✓ owner/alpha"]);
	});

	describe("below 60 columns", () => {
		it("lets the meta lead the detail when it can't follow the subject", () => {
			expect(
				block(
					[
						{
							status: "done",
							subject: APPLE,
							meta: "^1.4.0",
							detail: { move: { from: "v1.4.0", to: "v1.5.0" } },
						},
					],
					40,
				),
			).toEqual([` ✓ ${APPLE}`, "   ^1.4.0  v1.4.0 → v1.5.0"]);
		});

		it("wraps a label's aside under the subject", () => {
			expect(block([attentionRow], 40)).toEqual([
				" ! petekp/claude-skills  HEAD",
				"   not checked · Could not resolve",
				"   host: github.com",
			]);
		});

		it("puts a move's note below it there too", () => {
			expect(
				block(
					[
						{
							status: "failed",
							subject: APPLE,
							meta: "^0.10.12",
							detail: {
								move: { from: "v0.10.12", to: "v0.11.0" },
								note: "not applied",
							},
						},
					],
					40,
				),
			).toEqual([
				` ✗ ${APPLE}`,
				"   ^0.10.12  v0.10.12 → v0.11.0",
				"   not applied",
			]);
		});

		it("puts every detail on its own line, under the subject or the child", () => {
			expect(
				block(
					[
						{
							status: "done",
							subject: "owner/alpha",
							meta: "^1.0.0",
							detail: { move: { from: "v1.0.0", to: "v1.1.0" } },
							children: [
								{ name: "one", detail: "skill" },
								{
									name: "two",
									status: "failed",
									detail:
										"it would remove macos-hig, which is still in the source",
								},
							],
						},
						{
							status: "attention",
							subject: "owner/beta",
							detail: "not checked · Could not resolve host: github.com",
						},
					],
					40,
				),
			).toEqual([
				" ✓ owner/alpha  ^1.0.0",
				"   v1.0.0 → v1.1.0",
				"   ├─ one",
				"   │  skill",
				"   └─ ✗ two",
				"        it would remove macos-hig,",
				"        which is still in the source",
				" ! owner/beta",
				"   not checked · Could not resolve",
				"   host: github.com",
			]);
		});
	});

	describe("a child's aside", () => {
		const shared: Row = {
			status: "done",
			subject: "owner/repo",
			meta: "HEAD",
			detail: "2 of 3 installed",
			children: [
				{ name: "laravel", detail: "pack · 2 skills" },
				{ name: "laravel", aside: "skills/laravel", detail: "skill" },
			],
		};

		it("follows the name a space on, the detail column measured past it", () => {
			expect(block([shared], 80)).toEqual([
				" ✓ owner/repo                  HEAD   2 of 3 installed",
				"   ├─ laravel                         pack · 2 skills",
				"   └─ laravel skills/laravel          skill",
			]);
		});

		it("is dim", () => {
			expect(block([shared], 80, color).at(-1)).toBe(
				`   \x1b[2m└─\x1b[22m laravel \x1b[2mskills/laravel\x1b[22m${gap(10)}\x1b[2mskill\x1b[22m`,
			);
		});

		it("goes under the name, at its column, where it won't fit beside it", () => {
			expect(block([shared], 24).slice(-3)).toEqual([
				"   └─ laravel",
				"      skills/laravel",
				"      skill",
			]);
		});
	});

	describe("in colour", () => {
		it("paints the glyph, a bold subject, dim meta and a dim-then-bold move", () => {
			expect(
				block(
					[
						{
							status: "done",
							subject: "owner/alpha",
							meta: "^1.0.0",
							detail: { move: { from: "v1.0.0", to: "v1.1.0" } },
							children: [{ name: "one", detail: "skill" }],
						},
					],
					80,
					color,
				),
			).toEqual([
				" \x1b[32m✓\x1b[39m \x1b[1mowner/alpha\x1b[22m   \x1b[2m^1.0.0\x1b[22m   \x1b[2mv1.0.0 →\x1b[22m \x1b[1mv1.1.0\x1b[22m",
				`   \x1b[2m└─\x1b[22m one${gap(17)}\x1b[2mskill\x1b[22m`,
			]);
		});

		it("dims an unchanged row end to end, with no bold, its children too", () => {
			expect(
				block(
					[
						{
							status: "unchanged",
							subject: "owner/beta",
							meta: "^2.0.0",
							detail: { move: { from: "v2.0.0", to: "v2.0.0" } },
							children: [{ name: "one", detail: "skill" }],
						},
					],
					80,
					color,
				),
			).toEqual([
				" \x1b[2m○ owner/beta   ^2.0.0   v2.0.0 → v2.0.0\x1b[22m",
				` \x1b[2m  └─ one${gap(16)}skill\x1b[22m`,
			]);
		});

		it("paints a move's note in the row's colour", () => {
			expect(
				block(
					[
						{
							status: "failed",
							subject: "a",
							detail: { move: { from: "v1", to: "v2" }, note: "not applied" },
						},
					],
					80,
					color,
				),
			).toEqual([
				" \x1b[31m✗\x1b[39m \x1b[1ma\x1b[22m   \x1b[2mv1 →\x1b[22m \x1b[1mv2\x1b[22m  \x1b[31mnot applied\x1b[39m",
			]);
		});

		it("keeps a child's reason normal under a failed row", () => {
			expect(
				block(
					[
						{
							status: "failed",
							subject: "owner/alpha",
							children: [{ name: "b", detail: "reason" }],
						},
					],
					80,
					color,
				)[1],
			).toBe(`   \x1b[2m└─\x1b[22m b${gap(10)}reason`);
		});

		it("keeps a failed or attention child's reason normal under a done row, its glyph painted", () => {
			expect(
				block(
					[
						{
							status: "done",
							subject: "owner/alpha",
							children: [
								{ name: "b", status: "failed", detail: "reason" },
								{ name: "c", status: "attention", detail: "kept" },
								{ name: "d", status: "done", detail: "updated" },
							],
						},
					],
					80,
					color,
				).slice(1),
			).toEqual([
				`   \x1b[2m├─\x1b[22m \x1b[31m✗\x1b[39m b${gap(8)}reason`,
				`   \x1b[2m├─\x1b[22m \x1b[33m!\x1b[39m c${gap(8)}kept`,
				`   \x1b[2m└─\x1b[22m \x1b[32m✓\x1b[39m d${gap(8)}\x1b[2mupdated\x1b[22m`,
			]);
		});

		it("dims a done child's detail under a failed row", () => {
			expect(
				block(
					[
						{
							status: "failed",
							subject: "owner/alpha",
							children: [{ name: "b", status: "done", detail: "updated" }],
						},
					],
					80,
					color,
				)[1],
			).toBe(
				`   \x1b[2m└─\x1b[22m \x1b[32m✓\x1b[39m b${gap(8)}\x1b[2mupdated\x1b[22m`,
			);
		});

		it("dims a child without a status under a subject row, and keeps it normal under an attention row", () => {
			const child = (status: "subject" | "attention") =>
				block(
					[
						{
							status,
							subject: "owner/alpha",
							children: [{ name: "b", detail: "11 folders" }],
						},
					],
					80,
					color,
				)[1];
			expect(child("subject")).toBe(
				`   \x1b[2m└─\x1b[22m b${gap(10)}\x1b[2m11 folders\x1b[22m`,
			);
			expect(child("attention")).toBe(
				`   \x1b[2m└─\x1b[22m b${gap(10)}11 folders`,
			);
		});

		it("paints a label in its row's colour and the aside dim", () => {
			expect(block([attentionRow], 80, color)).toEqual([
				" \x1b[33m!\x1b[39m \x1b[1mpetekp/claude-skills\x1b[22m   \x1b[2mHEAD\x1b[22m   \x1b[33mnot checked\x1b[39m \x1b[2m· Could not resolve host:\x1b[22m",
				`${gap(33)}\x1b[2mgithub.com\x1b[22m`,
			]);
		});

		it("dims a label on an unchanged row with the rest of it", () => {
			expect(
				block(
					[
						{
							status: "unchanged",
							subject: "a",
							detail: { label: "up to date" },
						},
					],
					80,
					color,
				),
			).toEqual([" \x1b[2m○ a   up to date\x1b[22m"]);
		});

		it("draws the trunk dim", () => {
			expect(
				block(
					[
						{
							status: "done",
							subject: "owner/alpha",
							children: [{ name: "one", detail: REASON }, { name: "two" }],
						},
					],
					80,
					color,
				)[2],
			).toBe(
				`   \x1b[2m│\x1b[22m${gap(13)}\x1b[2mwould no longer be installed.\x1b[22m`,
			);
		});

		it("dims a child marked unchanged end to end", () => {
			expect(
				block(
					[
						{
							status: "done",
							subject: "owner/alpha",
							children: [
								{ name: "b", status: "unchanged", detail: "up to date" },
							],
						},
					],
					80,
					color,
				)[1],
			).toBe(` \x1b[2m  └─ ○ b${gap(8)}up to date\x1b[22m`);
		});
	});
});

describe("renderRowWithin", () => {
	const WRAPS =
		"already installed as part of the pack /Users/someone/code/skills/some-long-pack-name";
	const row: Row = {
		status: "done",
		subject: "owner/repo",
		meta: "HEAD",
		detail: "5 skills",
		children: [
			{ name: "a", status: "note", detail: "short" },
			{ name: "b", status: "note", detail: WRAPS },
			{ name: "c", status: "note", detail: "short" },
		],
	};
	const layout = blockLayout([row], 60);
	const within = (room: number, style = plain) =>
		renderRowWithin(row, room, layout, 60, style);
	const whole = renderRow(row, layout, 60, plain);
	const HEAD = ` ✓ owner/repo   HEAD   5 skills`;
	const A = `   ├─ · a${gap(14)}short`;

	it("draws the whole row when it fits", () => {
		expect(whole.length).toBeGreaterThan(4);
		expect(within(whole.length)).toEqual(whole);
	});

	it("keeps the children that fit whole, then counts the rest as children, not lines", () => {
		expect(within(whole.length - 1)).toEqual([HEAD, A, "   └─ … 2 more"]);
	});

	it("keeps the head and the count when no child fits beside them", () => {
		expect(within(2)).toEqual([HEAD, "   └─ … 3 more"]);
	});

	it("keeps the head alone when not even the count fits", () => {
		expect(within(1)).toEqual([HEAD]);
	});

	it("draws nothing when the head doesn't fit", () => {
		expect(within(0)).toEqual([]);
	});

	it("keeps its subject on one line, cut from the left, with the count when it fits, when its head doesn't fit", () => {
		const long: Row = {
			...row,
			subject:
				"owner/a-repository-name-long-enough-to-wrap-onto-three-lines-at-forty-columns",
		};
		const narrow = blockLayout([long], 40);
		expect(
			renderRow({ ...long, children: [] }, narrow, 40, plain).length,
		).toBeGreaterThan(2);
		const [short = ""] = renderRowWithin(long, 1, narrow, 40, plain);
		expect(short).toMatch(/^ ✓ …[^ ]+-at-forty-columns$/);
		expect(short).toHaveLength(39);
		expect(renderRowWithin(long, 2, narrow, 40, plain)).toEqual([
			short,
			"   └─ … 3 more",
		]);
	});

	it("dims its one-line head whole when it's unchanged", () => {
		const quiet: Row = { status: "unchanged", subject: "x".repeat(80) };
		const [short] = renderRowWithin(
			quiet,
			1,
			blockLayout([quiet], 40),
			40,
			color,
		);
		expect(short).toBe(` \x1b[2m○ …${"x".repeat(35)}\x1b[22m`);
	});

	it("charges a count that wraps by every line it takes", () => {
		const removal: Row = {
			status: "subject",
			subject: "owner/repo",
			fields: [
				{ label: "version", value: "v1.0.0" },
				{
					label: ".claude/skills/",
					value: Array.from({ length: 11 }, (_, index) => `folder-${index}`),
					noun: "folder",
				},
				{ label: ".claude/agents/", value: ["one.md"], noun: "agent" },
				{ label: ".claude/hooks/", value: ["lint.sh"], noun: "hook" },
			],
		};
		const narrow = blockLayout([removal], 40);
		const within = (room: number) =>
			renderRowWithin(removal, room, narrow, 40, plain);
		expect(within(4)).toEqual([
			" ● owner/repo",
			"   version          v1.0.0",
			"   … 11 more folders, 1 more agent, 1",
			"   more hook",
		]);
		expect(within(3)).toEqual([
			" ● owner/repo",
			"   … 11 more folders, 1 more agent, 1",
			"   more hook, 1 more",
		]);
	});

	it("paints the count dim", () => {
		expect(within(2, color)[1]).toBe(" \x1b[2m  └─ … 3 more\x1b[22m");
	});
});

describe("renderRowsWithin", () => {
	const folders = (...names: string[]): Row => ({
		status: "subject",
		subject: `owner/${names[0]}`,
		fields: [{ label: ".claude/skills/", value: names, noun: "folder" }],
		children: [{ name: "a" }, { name: "b" }],
	});
	const first = folders("one", "two");
	const second = folders("three");
	const third = folders("four");
	const rows = [first, second, third];
	const ENTRY = { one: "entry", many: "entries" };
	const layout = blockLayout(rows, 80);
	const within = (room: number, style = plain) =>
		renderRowsWithin({ rows, noun: ENTRY }, room, layout, 80, style);
	const draw = (row: Row) => renderRow(row, layout, 80, plain);
	const head = (row: Row) => draw(row)[0];
	const whole = rows.flatMap(draw);

	it("draws every row whole, in one block's columns, when they all fit", () => {
		expect(within(whole.length)).toEqual(whole);
	});

	it("cuts each row to its head and a count of the rest when only that fits for every row", () => {
		expect(within(6)).toEqual([
			head(first),
			"   … 2 more folders, 2 more",
			head(second),
			"   … 1 more folder, 2 more",
			head(third),
			"   … 1 more folder, 2 more",
		]);
	});

	it("gives the room to spare to the rows in turn, each still cut honestly", () => {
		expect(within(8)).toEqual([
			...draw(first),
			head(second),
			"   … 1 more folder, 2 more",
			head(third),
			"   … 1 more folder, 2 more",
		]);
		expect(within(7)).toEqual([
			head(first),
			"   .claude/skills/  one  two",
			"   └─ … 2 more",
			head(second),
			"   … 1 more folder, 2 more",
			head(third),
			"   … 1 more folder, 2 more",
		]);
	});

	it("counts the rows left out by their noun, at the rows' own level, when not every row fits at its fewest", () => {
		expect(within(5)).toEqual([
			head(first),
			"   … 2 more folders, 2 more",
			head(second),
			"   … 1 more folder, 2 more",
			" … 1 more entry",
		]);
		expect(within(3)).toEqual([
			head(first),
			"   … 2 more folders, 2 more",
			" … 2 more entries",
		]);
	});

	it("keeps the first row's head and the count of the rest when not even it fits at its fewest", () => {
		expect(within(2)).toEqual([head(first), " … 2 more entries"]);
	});

	it("keeps the first row's head alone when the count doesn't fit beside it", () => {
		expect(within(1)).toEqual([head(first)]);
	});

	it("keeps the first row's subject on one line, cut from the left, with the count when it fits, when not even its head fits", () => {
		const long = {
			...first,
			subject:
				"owner/a-repository-name-long-enough-to-wrap-onto-three-lines-at-forty-columns",
		};
		const asked = { rows: [long, second, third], noun: ENTRY };
		const narrow = blockLayout(asked.rows, 40);
		expect(
			renderRow({ ...long, fields: [], children: [] }, narrow, 40, plain),
		).toHaveLength(3);
		const one = renderRowsWithin(asked, 1, narrow, 40, plain);
		expect(one).toHaveLength(1);
		expect(one[0]).toMatch(/^ ● …[^ ]+-at-forty-columns$/);
		expect(one[0]!.length).toBe(39);
		expect(renderRowsWithin(asked, 2, narrow, 40, plain)).toEqual([
			...one,
			" … 2 more entries",
		]);
		expect(renderRowsWithin(asked, 0, narrow, 40, plain)).toEqual([]);
	});

	it("wraps the count of rows left out in the room the width leaves, and charges the first row for every line of it", () => {
		const asked = {
			rows,
			noun: { one: "entry", many: "entries asked about" },
		};
		const narrow = blockLayout(rows, 24);
		expect(renderRowsWithin(asked, 3, narrow, 24, plain)).toEqual([
			" ● owner/one",
			" … 2 more entries asked",
			"   about",
		]);
	});

	it("paints the count of rows left out dim", () => {
		expect(within(3, color).at(-1)).toBe(
			" \x1b[2m…\x1b[22m \x1b[2m2 more entries\x1b[22m",
		);
	});

	it("charges a row its count's every line when fitting rows together", () => {
		const wraps: Row = {
			status: "subject",
			subject: "owner/nuxt",
			fields: [
				{
					label: ".claude/skills/",
					value: Array.from({ length: 11 }, (_, index) => `folder-${index}`),
					noun: "folder",
				},
				{ label: ".claude/agents/", value: ["one.md"], noun: "agent" },
				{ label: ".claude/hooks/", value: ["lint.sh"], noun: "hook" },
			],
		};
		const asked = { rows: [wraps, second], noun: ENTRY };
		const narrow = blockLayout(asked.rows, 40);
		expect(renderRowsWithin(asked, 4, narrow, 40, plain)).toEqual([
			" ● owner/nuxt",
			"   … 11 more folders, 1 more agent, 1",
			"   more hook",
			" … 1 more entry",
		]);
	});

	it("fits a lone row as renderRowWithin does", () => {
		for (const room of [0, 1, 2, 3, 5]) {
			expect(
				renderRowsWithin(
					{ rows: [first], noun: ENTRY },
					room,
					layout,
					80,
					plain,
				),
			).toEqual(renderRowWithin(first, room, layout, 80, plain));
		}
	});
});

describe("a row's nested children", () => {
	const TREE: Row = {
		status: "subject",
		subject: "~/my-pack",
		detail: "pack",
		children: [
			{ name: "agntc.json" },
			{ name: "skills/" },
			{ name: "my-skill/", depth: 1 },
			{ name: "SKILL.md", depth: 2 },
			{ name: "agents/" },
			{ name: "my-agent.md", depth: 1 },
			{ name: "hooks/" },
			{ name: "my-hook.sh", depth: 1 },
		],
	};

	it("hangs each under the child a level up, the branches of levels with a sibling below running on past it", () => {
		expect(block([TREE], 80)).toEqual([
			" ● ~/my-pack           pack",
			"   ├─ agntc.json",
			"   ├─ skills/",
			"   │  └─ my-skill/",
			"   │     └─ SKILL.md",
			"   ├─ agents/",
			"   │  └─ my-agent.md",
			"   └─ hooks/",
			"      └─ my-hook.sh",
		]);
	});

	it("measures a nested child's name from where its level puts it", () => {
		expect(blockLayout([TREE], 80).subjectWidth).toBe(
			"│     └─ SKILL.md".length + 3,
		);
	});

	it("runs the branches on past a nested child's wrapped lines, under its own when a sibling follows", () => {
		const row: Row = {
			status: "subject",
			subject: "x",
			children: [
				{ name: "a/" },
				{ name: "first", depth: 1, detail: "one two three four five six" },
				{ name: "second", depth: 1 },
				{ name: "b/" },
			],
		};
		expect(renderRow(row, blockLayout([row], 30), 30, plain)).toEqual([
			" ● x",
			"   ├─ a/",
			"   │  ├─ first",
			"   │  │  one two three four",
			"   │  │  five six",
			"   │  └─ second",
			"   └─ b/",
		]);
	});

	it("leaves the branch of a level with no sibling below off a nested child's wrapped lines", () => {
		const row: Row = {
			status: "subject",
			subject: "x",
			children: [
				{ name: "a/" },
				{ name: "only", depth: 1, detail: "one two three four five six" },
			],
		};
		expect(renderRow(row, blockLayout([row], 30), 30, plain)).toEqual([
			" ● x",
			"   └─ a/",
			"      └─ only",
			"         one two three four",
			"         five six",
		]);
	});

	it("paints the branches dim", () => {
		expect(block([TREE], 80, color)[3]).toBe(
			"   \x1b[2m│\x1b[22m  \x1b[2m└─\x1b[22m my-skill/",
		);
	});

	it("counts what's left out of the tree as the row's own children, its folders aside", () => {
		const layout = blockLayout([TREE], 80);
		expect(renderRowWithin(TREE, 6, layout, 80, plain)).toEqual([
			" ● ~/my-pack           pack",
			"   ├─ agntc.json",
			"   ├─ skills/",
			"   │  └─ my-skill/",
			"   │     └─ SKILL.md",
			"   └─ … 2 more",
		]);
	});

	it("leaves out a folder whose contents the cut leaves out, those above it too", () => {
		const layout = blockLayout([TREE], 80);
		expect(renderRowWithin(TREE, 5, layout, 80, plain)).toEqual([
			" ● ~/my-pack           pack",
			"   ├─ agntc.json",
			"   └─ … 3 more",
		]);
		expect(renderRowWithin(TREE, 7, layout, 80, plain)).toEqual([
			" ● ~/my-pack           pack",
			"   ├─ agntc.json",
			"   ├─ skills/",
			"   │  └─ my-skill/",
			"   │     └─ SKILL.md",
			"   └─ … 2 more",
		]);
	});

	it("counts children left out by their noun", () => {
		const files: Row = {
			...TREE,
			children: (TREE.children ?? []).map((child) =>
				child.name.endsWith("/") ? child : { ...child, noun: "file" },
			),
		};
		const layout = blockLayout([files], 80);
		expect(renderRowWithin(files, 5, layout, 80, plain).at(-1)).toBe(
			"   └─ … 3 more files",
		);
		expect(renderRowWithin(files, 8, layout, 80, plain).at(-1)).toBe(
			"   └─ … 1 more file",
		);
	});
});

describe("a row's fields", () => {
	const DETAIL: Row = {
		status: "subject",
		subject: "owner/repo",
		meta: "v1.2.0",
		detail: "pack",
		fields: [
			{ label: "version", value: "v1.2.0" },
			{
				label: "constraint",
				value: "^1.0.0 (v2.0.0 available outside constraint)",
			},
			{
				label: "installs",
				value: ["2 skills", "3 folders", "1 agent", "4 hooks"],
			},
			{ label: "status", value: "v1.3.0 available", status: "newer" },
		],
		children: [{ name: "a", status: "note", detail: "short" }],
	};

	it("lines their values up past the widest label and 2, under the row's head and over its children", () => {
		expect(block([DETAIL], 80)).toEqual([
			" ● owner/repo   v1.2.0   pack",
			"   version     v1.2.0",
			"   constraint  ^1.0.0 (v2.0.0 available outside constraint)",
			"   installs    2 skills  3 folders  1 agent  4 hooks",
			"   status      v1.3.0 available",
			`   └─ · a${gap(16)}short`,
		]);
	});

	it("wraps a value in the room beside its label, a list of them between its items", () => {
		expect(block([DETAIL], 40).slice(2, 7)).toEqual([
			"   version     v1.2.0",
			"   constraint  ^1.0.0 (v2.0.0 available",
			"               outside constraint)",
			"   installs    2 skills  3 folders",
			"               1 agent  4 hooks",
		]);
	});

	it("caps the label column at 45% of the width", () => {
		const row: Row = {
			status: "subject",
			subject: "x",
			fields: [{ label: "a-label-long-enough-to-pass-the-cap", value: "v" }],
		};
		const lines = block([row], 40).slice(1);
		expect(lines.every((line) => line.length <= 39)).toBe(true);
		expect(lines.at(-1)?.indexOf("v", 6)).toBe(3 + Math.floor(40 * 0.45));
	});

	it("paints the labels dim and a value with a status in its colour", () => {
		expect(block([DETAIL], 80, color).slice(1, 5)).toEqual([
			"   \x1b[2mversion\x1b[22m     v1.2.0",
			"   \x1b[2mconstraint\x1b[22m  ^1.0.0 (v2.0.0 available outside constraint)",
			"   \x1b[2minstalls\x1b[22m    2 skills  3 folders  1 agent  4 hooks",
			"   \x1b[2mstatus\x1b[22m      \x1b[38;2;167;139;250mv1.3.0 available\x1b[39m",
		]);
	});

	it("dims them whole on an unchanged row", () => {
		const quiet: Row = { ...DETAIL, status: "unchanged", children: [] };
		expect(block([quiet], 80, color).slice(1, 3)).toEqual([
			" \x1b[2m  version     v1.2.0\x1b[22m",
			" \x1b[2m  constraint  ^1.0.0 (v2.0.0 available outside constraint)\x1b[22m",
		]);
	});

	describe("within a room", () => {
		const layout = blockLayout([DETAIL], 80);
		const within = (room: number) =>
			renderRowWithin(DETAIL, room, layout, 80, plain);
		const HEAD = " ● owner/repo   v1.2.0   pack";

		it("keeps the fields before the children", () => {
			expect(within(5)).toEqual([
				HEAD,
				"   version     v1.2.0",
				"   constraint  ^1.0.0 (v2.0.0 available outside constraint)",
				"   installs    2 skills  3 folders  1 agent  4 hooks",
				"   … 2 more",
			]);
		});

		it("counts what it leaves out under the fields when a field is the first of it", () => {
			expect(within(3)).toEqual([HEAD, "   version     v1.2.0", "   … 4 more"]);
			expect(within(2)).toEqual([HEAD, "   … 5 more"]);
		});

		it("counts a field of items by its noun, those sharing one together, and any other field and child as one more", () => {
			const folders = (count: number) =>
				Array.from({ length: count }, (_, index) => `folder-${index}`);
			const removal: Row = {
				status: "subject",
				subject: "owner/repo",
				fields: [
					{ label: ".claude/skills/", value: ["a"], noun: "folder" },
					{ label: ".claude/skills/", value: folders(33), noun: "folder" },
					{ label: ".agents/skills/", value: ["b"], noun: "folder" },
					{ label: ".claude/agents/", value: ["one.md"], noun: "agent" },
					{ label: "note", value: "plain" },
				],
				children: [{ name: "c" }],
			};
			const lines = renderRowWithin(
				removal,
				3,
				blockLayout([removal], 60),
				60,
				plain,
			);
			expect(lines.at(-1)).toBe("   … 34 more folders, 1 more agent, 2 more");
		});

		it("wraps the count in the room the width leaves, and fits the lines it takes", () => {
			const removal: Row = {
				status: "subject",
				subject: "owner/repo",
				fields: [
					{ label: ".claude/skills/", value: ["a", "b"], noun: "folder" },
					{ label: ".claude/agents/", value: ["one.md"], noun: "agent" },
					{ label: ".claude/hooks/", value: ["lint.sh"], noun: "hook" },
				],
			};
			const layout = blockLayout([removal], 30);
			const within = (room: number) =>
				renderRowWithin(removal, room, layout, 30, plain);
			expect(within(3)).toEqual([
				" ● owner/repo",
				"   … 2 more folders, 1 more",
				"   agent, 1 more hook",
			]);
			expect(within(2)).toEqual([" ● owner/repo"]);
		});

		it("counts it as a child once every field is kept", () => {
			const twoChildren: Row = {
				...DETAIL,
				children: [
					{ name: "a", status: "note" },
					{ name: "b", status: "note" },
				],
			};
			expect(
				renderRowWithin(twoChildren, 6, layout, 80, plain).slice(-2),
			).toEqual(["   status      v1.3.0 available", "   └─ … 2 more"]);
		});
	});
});

describe("blockLayout from subjects alone", () => {
	it("fixes the same columns as the rows those subjects will be", () => {
		const rows: Row[] = [
			{
				status: "done",
				subject: "owner/alpha",
				meta: "^1.0.0",
				detail: "updated",
				children: [{ name: "a-long-child-name", status: "done" }],
			},
		];
		expect(
			blockLayout(
				[
					{
						subject: "owner/alpha",
						meta: "^1.0.0",
						children: [{ name: "a-long-child-name", status: "done" }],
					},
				],
				80,
			),
		).toEqual(blockLayout(rows, 80));
	});
});

describe("renderProgress", () => {
	const subjects = [{ subject: "owner/alpha", meta: "^1.0.0" }];
	const progress = {
		subject: "owner/alpha",
		meta: "^1.0.0",
		text: "updating to v1.0.1…",
	};
	const LOCAL = "~/Code/agntc-sources/a-rather-long-local-folder-name";

	it("puts the frame in the glyph slot and what it's doing in the detail column", () => {
		expect(
			renderProgress(progress, "⠁", 80, plain, blockLayout(subjects, 80)),
		).toBe(` ⠁ owner/alpha${gap(3)}^1.0.0${gap(3)}updating to v1.0.1…`);
	});

	it("lays a subject out alone without a block's layout", () => {
		expect(renderProgress(progress, "⠁", 80, plain)).toBe(
			` ⠁ owner/alpha${gap(3)}^1.0.0${gap(3)}updating to v1.0.1…`,
		);
	});

	it("follows the frame with what it's doing when it has no subject", () => {
		expect(renderProgress({ text: "Checking 6 repos…" }, "⠂", 80, plain)).toBe(
			" ⠂ Checking 6 repos…",
		);
	});

	it("follows the subject and meta with what it's doing below 60 columns", () => {
		expect(
			renderProgress(progress, "⠁", 59, plain, blockLayout(subjects, 59)),
		).toBe(" ⠁ owner/alpha  ^1.0.0  updating to v1.0.1…");
	});

	it("leaves the meta out for what it's doing before cutting the subject below 12 columns", () => {
		expect(
			renderProgress(progress, "⠁", 40, plain, blockLayout(subjects, 40)),
		).toBe(" ⠁ owner/alpha  updating to v1.0.1…");
	});

	it.each([
		80, 100,
	])("follows a subject wider than its column with its meta and what it's doing at %i", (width) => {
		const layout = blockLayout([{ subject: LOCAL, meta: "local" }], width);
		expect(
			renderProgress(
				{ subject: LOCAL, meta: "local", text: "reinstalling…" },
				"⠁",
				width,
				plain,
				layout,
			),
		).toBe(` ⠁ ${LOCAL}  local  reinstalling…`);
	});

	it("cuts the subject from the left so what it's doing shows whole", () => {
		const layout = blockLayout([{ subject: LOCAL }], 70);
		expect(
			renderProgress(
				{ subject: LOCAL, text: "reinstalling from its source…" },
				"⠁",
				70,
				plain,
				layout,
			),
		).toBe(` ⠁ …${LOCAL.slice(-34)}  reinstalling from its source…`);
	});

	it("follows the meta with what it's doing where the detail column can't hold it whole", () => {
		const text = "reinstalling from its first source…";
		expect(
			renderProgress(
				{ ...progress, text },
				"⠁",
				60,
				plain,
				blockLayout(subjects, 60),
			),
		).toBe(` ⠁ owner/alpha  ^1.0.0  ${text}`);
	});

	it("keeps what it's doing in the detail column while it fills the column exactly, and follows the meta once it's a column over", () => {
		const layout = blockLayout(subjects, 80);
		// 80 columns: the detail column starts at 26, leaving 53 to the margin.
		expect(
			renderProgress(
				{ ...progress, text: "y".repeat(53) },
				"⠁",
				80,
				plain,
				layout,
			),
		).toBe(` ⠁ owner/alpha${gap(3)}^1.0.0${gap(3)}${"y".repeat(53)}`);
		expect(
			renderProgress(
				{ ...progress, text: "y".repeat(54) },
				"⠁",
				80,
				plain,
				layout,
			),
		).toBe(` ⠁ owner/alpha  ^1.0.0  ${"y".repeat(54)}`);
	});

	it.each([
		// 21 columns past the glyph: the half the subject's cut leaves what it's
		// doing is 9, rounded down, so the subject keeps 10.
		[25, " ⠁ …lder-name  reinstal…"],
		[26, " ⠁ …lder-name  reinstall…"],
	])("gives what it's doing half the line, rounded down, where its width would cut the subject below 12, at %i", (width, line) => {
		const KEY =
			"/Volumes/Scratch/sources/a-rather-long-local-source-folder-name";
		expect(
			renderProgress(
				{
					subject: KEY,
					text: "reinstalling from the source it was added from…",
				},
				"⠁",
				width,
				plain,
				blockLayout([{ subject: KEY }], width),
			),
		).toBe(line);
	});

	it("cuts a line without a subject at its end", () => {
		expect(renderProgress({ text: "x".repeat(30) }, "⠁", 20, plain)).toBe(
			` ⠁ ${"x".repeat(15)}…`,
		);
	});

	describe("with a subject too long for the line", () => {
		const KEY =
			"/Volumes/Scratch/sources/a-rather-long-local-source-folder-name";
		const REMOTE =
			"leeovery/a-very-long-repository-name-for-skills/skills/nuxt";
		const BARE = "x".repeat(80);
		const copying = (subject: string, meta?: string) => ({
			subject,
			...(meta === undefined ? {} : { meta }),
			text: "copying…",
		});
		const draw = (shown: Progress & { subject: string }, width: number) =>
			renderProgress(shown, "⠁", width, plain, blockLayout([shown], width));
		/** The subject's tail, after `…`, on the room the line leaves it. */
		const tail = (subject: string, room: number) =>
			`…${subject.slice(-(room - 1))}`;

		it.each([
			[40, KEY, "local", 19],
			[60, KEY, "local", 39],
			[80, KEY, "local", 59],
			[40, REMOTE, "^1.0.0", 18],
			[60, REMOTE, "^1.0.0", 38],
			[80, REMOTE, "^1.0.0", 58],
			[40, BARE, "local", 19],
			[100, BARE, "local", 79],
		])("keeps its tail, its meta and what it's doing on one line at %i", (width, subject, meta, room) => {
			expect(draw(copying(subject, meta), width)).toBe(
				` ⠁ ${tail(subject, room)}  ${meta}  copying…`,
			);
		});

		it("shows it whole at 100 columns where it fits", () => {
			expect(draw(copying(KEY, "local"), 100)).toBe(
				` ⠁ ${KEY}  local  copying…`,
			);
		});

		it("leaves its meta out before cutting it below 12 columns", () => {
			expect(draw(copying(KEY, "a-long-constraint"), 40)).toBe(
				` ⠁ ${tail(KEY, 26)}  copying…`,
			);
		});

		const LONG_TEXT = "reinstalling from the source it was added from…";

		it("cuts a long text at its end once the subject is down to 12 columns", () => {
			expect(draw({ subject: KEY, text: LONG_TEXT }, 40)).toBe(
				` ⠁ ${tail(KEY, 12)}  ${LONG_TEXT.slice(0, 21)}…`,
			);
		});

		it("gives a long text half the line where 12 columns of subject would leave it less", () => {
			expect(draw({ subject: KEY, text: LONG_TEXT }, 24)).toBe(
				` ⠁ ${tail(KEY, 9)}  ${LONG_TEXT.slice(0, 8)}…`,
			);
		});

		it.each([
			20, 40, 60, 80, 100,
		])("is one line inside the width at %i, painted or not", (width) => {
			for (const style of [plain, color]) {
				for (const subject of [KEY, REMOTE, BARE]) {
					const line = renderProgress(
						copying(subject, "local"),
						"⠁",
						width,
						style,
						blockLayout([{ subject, meta: "local" }], width),
					);
					expect(line).not.toContain("\n");
					expect(visibleWidth(line)).toBeLessThanOrEqual(width - 1);
					// At 20, 12 columns of subject would leave the text less than half.
					expect(line).toContain(width === 20 ? "copyin…" : "copying…");
				}
			}
		});
	});

	it("paints the frame in the accent, the subject bold and the rest dim", () => {
		expect(
			renderProgress(progress, "⠁", 80, color, blockLayout(subjects, 80)),
		).toBe(
			` \x1b[38;2;167;139;250m⠁\x1b[39m \x1b[1mowner/alpha\x1b[22m${gap(3)}\x1b[2m^1.0.0\x1b[22m${gap(3)}\x1b[2mupdating to v1.0.1…\x1b[22m`,
		);
		expect(renderProgress({ text: "Checking…" }, "⠁", 80, color)).toBe(
			" \x1b[38;2;167;139;250m⠁\x1b[39m \x1b[2mChecking…\x1b[22m",
		);
	});
});

describe("a long path in a row", () => {
	const KEY =
		"/Volumes/Scratch/sources/a-rather-long-local-source-folder-name/with-another-level";
	const REMOTE = "leeovery/a-very-long-repository-name-for-skills/nuxt";
	const BARE = "y".repeat(60);
	const local: Row = {
		status: "done",
		subject: KEY,
		meta: "local",
		detail: "installed",
	};
	const remote: Row = {
		status: "done",
		subject: REMOTE,
		detail: `already installed in ${KEY}`,
	};
	const bare: Row = {
		status: "failed",
		subject: BARE,
		fields: [{ label: "from", value: KEY }],
		children: [{ name: "pack-1", detail: `copied from ${KEY}/pack-1` }],
	};
	const draw = (row: Row, width: number) =>
		renderRow(row, blockLayout([local, remote, bare], width), width, plain);

	it.each([
		[
			40,
			[
				" ✓ /Volumes/Scratch/sources/",
				"   a-rather-long-local-source-folder-na",
				"   me/with-another-level  local",
				"   installed",
			],
		],
		[
			60,
			[
				" ✓ /Volumes/Scratch/sources/",
				"   a-rather-long-local-source-folder-name/",
				`   with-another-level${gap(9)}local   installed`,
			],
		],
		[
			80,
			[
				" ✓ /Volumes/Scratch/sources/a-rather-long-local-source-folder-name/",
				`   with-another-level${gap(18)}local   installed`,
			],
		],
		[100, [` ✓ ${KEY}`, `${gap(48)}local   installed`]],
	])("breaks a local subject after the last `/` that fits at %i, hard where none is in reach", (width, lines) => {
		expect(draw(local, width)).toEqual(lines);
	});

	it.each([
		[
			40,
			[
				" ✓ leeovery/",
				"   a-very-long-repository-name-for-skil",
				"   ls/nuxt",
				"   already installed in /Volumes/",
				"   Scratch/sources/",
				"   a-rather-long-local-source-folder-na",
				"   me/with-another-level",
			],
		],
		[
			100,
			[
				` ✓ ${REMOTE}`,
				`${gap(56)}already installed in /Volumes/Scratch/`,
				`${gap(56)}sources/`,
				`${gap(56)}a-rather-long-local-source-folder-name/`,
				`${gap(56)}with-another-level`,
			],
		],
	])("breaks a remote subject and a path in its detail at a `/` at %i, the path starting beside the words before it", (width, lines) => {
		expect(draw(remote, width)).toEqual(lines);
	});

	it.each([
		[
			40,
			[
				` ✗ ${BARE.slice(0, 36)}`,
				`   ${BARE.slice(36)}`,
				"   from  /Volumes/Scratch/sources/",
				"         a-rather-long-local-source-fol",
				"         der-name/with-another-level",
				"   └─ pack-1",
				"      copied from /Volumes/Scratch/",
				"      sources/",
				"      a-rather-long-local-source-folder",
				"      -name/with-another-level/pack-1",
			],
		],
		[
			80,
			[
				` ✗ ${BARE}`,
				"   from  /Volumes/Scratch/sources/a-rather-long-local-source-folder-name/",
				"         with-another-level",
				`   └─ pack-1${gap(35)}copied from /Volumes/Scratch/`,
				`${gap(47)}sources/`,
				`${gap(47)}a-rather-long-local-source-folde`,
				`${gap(47)}r-name/with-another-level/pack-1`,
			],
		],
	])("breaks a path in a field's value and a child's detail at a `/`, and a subject with none hard, at %i", (width, lines) => {
		expect(draw(bare, width)).toEqual(lines);
	});
});
