import { describe, expect, it } from "vitest";
import { renderHeader } from "../../src/terminal/header.js";
import { createStyle } from "../../src/terminal/style.js";

const plain = createStyle(0);
const gap = (columns: number) => " ".repeat(columns);
const LONG_WHERE = "~/Code/clients/acme/very-long-project-name/checkout";

describe("renderHeader", () => {
	it.each([
		[100, 68],
		[80, 48],
	])("puts where and the version on the right at %i", (width, spaces) => {
		expect(
			renderHeader(
				{ command: "update", where: "project", version: "0.5.3" },
				width,
				plain,
			),
		).toEqual([` ■ agntc update${gap(spaces)}project · v0.5.3`]);
	});

	it("drops the right side below 60 columns, however short", () => {
		expect(
			renderHeader(
				{ command: "add", where: "global", version: "0.5.3" },
				40,
				plain,
			),
		).toEqual([" ■ agntc add"]);
		expect(
			renderHeader(
				{ command: "add", where: "global", version: "0.5.3" },
				59,
				plain,
			),
		).toEqual([" ■ agntc add"]);
	});

	it("cuts a long where from the left to fit", () => {
		expect(
			renderHeader(
				{ command: "update", where: LONG_WHERE, version: "0.5.3" },
				60,
				plain,
			),
		).toEqual([" ■ agntc update  …/very-long-project-name/checkout · v0.5.3"]);
	});

	it("shows a long where whole when it fits", () => {
		expect(
			renderHeader(
				{ command: "update", where: LONG_WHERE, version: "0.5.3" },
				100,
				plain,
			),
		).toEqual([` ■ agntc update${gap(24)}${LONG_WHERE} · v0.5.3`]);
	});

	it("drops the right side when where would be cut below about 12 columns", () => {
		expect(
			renderHeader(
				{
					command: "update",
					where: LONG_WHERE,
					version: "1.0.0-alpha.20261016.1234567890",
				},
				60,
				plain,
			),
		).toEqual([" ■ agntc update"]);
	});

	it("leaves out whichever of where and the version is absent", () => {
		expect(
			renderHeader({ command: "init", version: "0.5.3" }, 80, plain),
		).toEqual([` ■ agntc init${gap(60)}v0.5.3`]);
		expect(
			renderHeader({ command: "list", where: "global" }, 80, plain),
		).toEqual([` ■ agntc list${gap(60)}global`]);
		expect(renderHeader({ command: "list" }, 80, plain)).toEqual([
			" ■ agntc list",
		]);
	});

	it("paints the mark in the accent, agntc bold and the right side dim", () => {
		expect(
			renderHeader(
				{ command: "update", where: "project", version: "0.5.3" },
				80,
				createStyle(3),
			),
		).toEqual([
			` \x1b[38;2;167;139;250m■\x1b[39m \x1b[1magntc\x1b[22m update${gap(48)}\x1b[2mproject · v0.5.3\x1b[22m`,
		]);
	});
});
