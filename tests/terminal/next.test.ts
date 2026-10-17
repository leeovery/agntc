import { describe, expect, it } from "vitest";
import type { SubjectMessage } from "../../src/message.js";
import { adviceItem, remedyItem, renderNext } from "../../src/terminal/next.js";
import { createStyle } from "../../src/terminal/style.js";
import type { NextItem } from "../../src/terminal/types.js";

describe("Next items from messages", () => {
	const STILL_IN_SOURCE: SubjectMessage = {
		subject: "owner/repo/macos",
		detail:
			"can't be updated: it would remove macos-hig. The existing install is unchanged.",
		text: "owner/repo/macos can't be updated: it would remove macos-hig. The existing install is unchanged.",
		remedy: {
			lead: "To update it anyway:",
			steps: [
				{ command: "npx agntc remove owner/repo/macos" },
				{ command: "npx agntc add owner/repo/macos --pack" },
			],
		},
		plain: "the machine sentence",
	};

	it("puts a message's remedy under its subject, the row having said what happened", () => {
		expect(remedyItem(STILL_IN_SOURCE)).toEqual({
			subject: "owner/repo/macos",
			remedy: STILL_IN_SOURCE.remedy,
		});
	});

	it("queues nothing for a message with no remedy", () => {
		const { remedy: _, ...told } = STILL_IN_SOURCE;
		expect(remedyItem(told)).toBeNull();
	});

	it("leads an advice's remedy with what it says, the row having said less", () => {
		expect(
			adviceItem({
				subject: "owner/repo",
				detail: "Pinned to v1.0.0, newer tags available (latest: v1.2.0).",
				text: "",
				remedy: {
					lead: "To upgrade:",
					steps: [{ command: "npx agntc add owner/repo@v1.2.0" }],
				},
				plain: "",
			}),
		).toEqual({
			subject: "owner/repo",
			remedy: {
				lead: "Pinned to v1.0.0, newer tags available (latest: v1.2.0). To upgrade:",
				steps: [{ command: "npx agntc add owner/repo@v1.2.0" }],
			},
		});
	});
});

const plain = createStyle(0);

const abort: NextItem = {
	subject: "macos",
	remedy: {
		lead: "To update it anyway:",
		steps: [
			{ command: "npx agntc remove o/r/macos" },
			{ command: "npx agntc add o/r@^1.4.0 --skill macos" },
		],
	},
};

const upgrade: NextItem = {
	subject: "o/r",
	remedy: {
		lead: "Its newest tag v2.0.0 is outside ^1.0.2. To move to it:",
		steps: [{ command: "npx agntc add o/r" }],
	},
};

describe("renderNext", () => {
	it("prints nothing without items", () => {
		expect(renderNext([], 80, plain)).toEqual([]);
	});

	it.each([
		80, 100,
	])("opens with a blank line and Next, the items a blank line apart, at %i", (width) => {
		expect(renderNext([abort, upgrade], width, plain)).toEqual([
			"",
			" Next",
			"   macos — to update it anyway:",
			"     npx agntc remove o/r/macos",
			"     npx agntc add o/r@^1.4.0 --skill macos",
			"",
			"   o/r — its newest tag v2.0.0 is outside ^1.0.2. To move to it:",
			"     npx agntc add o/r",
		]);
	});

	it("wraps the heading at column 3", () => {
		expect(
			renderNext(
				[
					{
						subject: "laravel",
						remedy: {
							lead: "Its SKILL.md is gone and 2 skills are now named laravel. To follow one:",
							steps: [
								{ command: "npx agntc remove o/r/laravel" },
								{
									choice: [
										"npx agntc add o/r --skill a/laravel",
										"npx agntc add o/r --skill b/laravel",
									],
								},
							],
						},
					},
				],
				40,
				plain,
			),
		).toEqual([
			"",
			" Next",
			"   laravel — its SKILL.md is gone and 2",
			"   skills are now named laravel. To",
			"   follow one:",
			"     npx agntc remove o/r/laravel",
			"     then one of",
			"     npx agntc add o/r --skill a/laravel",
			"     npx agntc add o/r --skill b/laravel",
		]);
	});

	it("wraps a subject too long for its line, the lead running on from it", () => {
		expect(
			renderNext(
				[{ ...abort, subject: "owner/a-very-long-repository-name-here" }],
				40,
				plain,
			).slice(2, 5),
		).toEqual([
			"   owner/",
			"   a-very-long-repository-name-here —",
			"   to update it anyway:",
		]);
	});

	it("leaves the dash out without a subject, the lead as written", () => {
		expect(
			renderNext(
				[{ subject: "", remedy: { lead: "To retry:", steps: [] } }],
				80,
				plain,
			),
		).toEqual(["", " Next", "   To retry:"]);
	});

	it.each([
		["GitHub rejected the token. To retry:"],
		["SKILL.md is gone. To restore it:"],
	])("keeps the case of a lead opening on a name: %s", (lead) => {
		expect(
			renderNext(
				[{ subject: "o/r", remedy: { lead, steps: [] } }],
				80,
				plain,
			)[2],
		).toBe(`   o/r — ${lead}`);
	});

	it("leaves the dash out without a lead", () => {
		expect(
			renderNext(
				[
					{
						subject: "macos",
						remedy: {
							lead: "",
							steps: [{ command: "npx agntc update macos" }],
						},
					},
				],
				80,
				plain,
			),
		).toEqual(["", " Next", "   macos", "     npx agntc update macos"]);
	});

	it("paints Next and the subject bold and commands in the accent", () => {
		expect(renderNext([upgrade], 80, createStyle(3))).toEqual([
			"",
			" \x1b[1mNext\x1b[22m",
			"   \x1b[1mo/r\x1b[22m — its newest tag v2.0.0 is outside ^1.0.2. To move to it:",
			"     \x1b[38;2;167;139;250mnpx agntc add o/r\x1b[39m",
		]);
	});
});
