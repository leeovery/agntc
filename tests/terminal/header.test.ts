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

	it("keeps the version alone when where would be cut below 12 columns", () => {
		const version = "1.0.0-alpha.20261016.1234567890";
		expect(
			renderHeader(
				{ command: "update", where: LONG_WHERE, version },
				60,
				plain,
			),
		).toEqual([` ■ agntc update${gap(12)}v${version}`]);
	});

	it("cuts where to exactly 12 columns, and gives way to the version alone at 11", () => {
		const where = `~/${"deep/".repeat(10)}project`;
		// 60 columns leave 42 after the left side; a 26-digit version leaves where 12.
		expect(
			renderHeader(
				{ command: "update", where, version: "1".repeat(26) },
				60,
				plain,
			),
		).toEqual([` ■ agntc update  …eep/project · v${"1".repeat(26)}`]);
		expect(
			renderHeader(
				{ command: "update", where, version: "1".repeat(27) },
				60,
				plain,
			),
		).toEqual([` ■ agntc update${gap(16)}v${"1".repeat(27)}`]);
	});

	it("shows where whole when it fills its room exactly, and cuts it a column over", () => {
		// 80 columns leave 65 after the left side; ` · v0.5.3` leaves where 56.
		expect(
			renderHeader(
				{ command: "add", where: "x".repeat(56), version: "0.5.3" },
				80,
				plain,
			),
		).toEqual([` ■ agntc add  ${"x".repeat(56)} · v0.5.3`]);
		expect(
			renderHeader(
				{ command: "add", where: "x".repeat(57), version: "0.5.3" },
				80,
				plain,
			),
		).toEqual([` ■ agntc add  …${"x".repeat(55)} · v0.5.3`]);
	});

	it("keeps a short where whole in less than 12 columns", () => {
		const version = "1.0.0-alpha.20261016.123456789";
		expect(
			renderHeader({ command: "update", where: "global", version }, 60, plain),
		).toEqual([` ■ agntc update${gap(4)}global · v${version}`]);
	});

	it("keeps a short where that fills its room exactly", () => {
		const version = "1.0.0-alpha.20261016.12345678901";
		expect(
			renderHeader({ command: "update", where: "global", version }, 60, plain),
		).toEqual([` ■ agntc update${gap(2)}global · v${version}`]);
	});

	it("drops the right side when not even the version fits", () => {
		expect(
			renderHeader(
				{ command: "update", where: LONG_WHERE, version: "9".repeat(42) },
				60,
				plain,
			),
		).toEqual([" ■ agntc update"]);
		expect(
			renderHeader({ command: "update", version: "9".repeat(42) }, 60, plain),
		).toEqual([" ■ agntc update"]);
	});

	it.each([
		[60, 35],
		[80, 55],
		[100, 75],
	])("keeps the version beside a long where at %i, cutting where from the left", (width, tail) => {
		const where = `~/${"deep/".repeat(30)}project`;
		const [line = ""] = renderHeader(
			{ command: "add", where, version: "0.5.3" },
			width,
			plain,
		);
		expect(line).toBe(` ■ agntc add  …${where.slice(-tail)} · v0.5.3`);
		expect(line.length).toBe(width - 1);
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
