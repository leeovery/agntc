import { describe, expect, it } from "vitest";
import { blockLayout, renderRow } from "../../src/terminal/block.js";
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

	it("pushes a child's detail down when its name overruns the column", () => {
		expect(
			block(
				[
					{
						status: "done",
						subject: "owner/x",
						children: [{ name: "a-long-child-name", detail: "skill" }],
					},
				],
				80,
			),
		).toEqual([" ✓ owner/x", "   └─ a-long-child-name", `${gap(13)}skill`]);
	});

	describe("below 60 columns", () => {
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
				"      skill",
				"   └─ ✗ two",
				"      it would remove macos-hig, which",
				"      is still in the source",
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
