import { describe, expect, it } from "vitest";
import {
	blockLayout,
	renderProgress,
	renderRow,
} from "../../src/terminal/block.js";
import { createStyle } from "../../src/terminal/style.js";
import type { Row } from "../../src/terminal/types.js";

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

	it.each([
		[59, " ⠁ owner/alpha  ^1.0.0  updating to v1.0.1…"],
		[40, " ⠁ owner/alpha  ^1.0.0  updating to v1…"],
	])("follows the subject and meta with what it's doing below 60 columns, cut to fit, at %i", (width, line) => {
		expect(
			renderProgress(progress, "⠁", width, plain, blockLayout(subjects, width)),
		).toBe(line);
	});

	it.each([
		80, 100,
	])("follows a subject wider than its column with what it's doing at %i", (width) => {
		const layout = blockLayout([{ subject: LOCAL, meta: "local" }], width);
		expect(
			renderProgress(
				{ subject: LOCAL, meta: "local", text: "reinstalling…" },
				"⠁",
				width,
				plain,
				layout,
			),
		).toBe(` ⠁ ${LOCAL}  reinstalling…`);
	});

	it("cuts what it's doing to fit, and a line without a subject too", () => {
		const layout = blockLayout([{ subject: LOCAL }], 70);
		expect(
			renderProgress(
				{ subject: LOCAL, text: "reinstalling from its source…" },
				"⠁",
				70,
				plain,
				layout,
			),
		).toBe(` ⠁ ${LOCAL}  reinstallin…`);
		expect(renderProgress({ text: "x".repeat(30) }, "⠁", 20, plain)).toBe(
			` ⠁ ${"x".repeat(15)}…`,
		);
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
