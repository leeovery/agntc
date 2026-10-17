import { describe, expect, it } from "vitest";
import {
	bandPainter,
	createStyle,
	mix,
	nearest256,
} from "../../src/terminal/style.js";

const DARK = [30, 30, 30] as const;
const LIGHT = [255, 255, 255] as const;

describe("onAccent", () => {
	it.each([
		[3, "\x1b[48;2;167;139;250;38;2;17;17;17mx\x1b[49;39m"],
		[2, "\x1b[48;5;141;38;5;233mx\x1b[49;39m"],
		[1, "\x1b[45;30mx\x1b[49;39m"],
		[0, "x"],
	] as const)("paints dark text on the accent at level %i", (level, painted) => {
		expect(createStyle(level).onAccent("x")).toBe(painted);
	});
});

describe("mix", () => {
	it("moves each channel the share of the way, rounded", () => {
		expect(mix([167, 139, 250], DARK, 0.78)).toEqual([60, 54, 78]);
		expect(mix([167, 139, 250], LIGHT, 0.78)).toEqual([236, 229, 254]);
	});

	it("keeps the start at no share and reaches the end at all of it", () => {
		expect(mix([10, 20, 30], [200, 100, 0], 0)).toEqual([10, 20, 30]);
		expect(mix([10, 20, 30], [200, 100, 0], 1)).toEqual([200, 100, 0]);
	});
});

describe("nearest256", () => {
	it("picks the accent's own 256-colour from the cube", () => {
		expect(nearest256([167, 139, 250])).toBe(141);
	});

	it("picks the grey ramp when it's nearer than the cube", () => {
		expect(nearest256([17, 17, 17])).toBe(233);
		expect(nearest256([60, 54, 78])).toBe(238);
	});

	it("reaches both corners of the cube", () => {
		expect(nearest256([0, 0, 0])).toBe(16);
		expect(nearest256([255, 255, 255])).toBe(231);
	});

	it("never picks one of the theme's 16 colours", () => {
		for (const colour of [
			[128, 0, 0],
			[0, 128, 0],
			[192, 192, 192],
		] as const) {
			expect(nearest256(colour)).toBeGreaterThanOrEqual(16);
		}
	});
});

describe("bandPainter", () => {
	it("mixes the accent 22% into a dark background at truecolor", () => {
		expect(bandPainter(3, DARK)?.("x")).toBe("\x1b[48;2;60;54;78mx\x1b[49m");
	});

	it("mixes it into a light one too", () => {
		expect(bandPainter(3, LIGHT)?.("x")).toBe(
			"\x1b[48;2;236;229;254mx\x1b[49m",
		);
	});

	it("draws the nearest 256-colour at level 2", () => {
		expect(bandPainter(2, DARK)?.("x")).toBe("\x1b[48;5;238mx\x1b[49m");
		expect(bandPainter(2, LIGHT)?.("x")).toBe("\x1b[48;5;255mx\x1b[49m");
	});

	it("has no band below 256 colours", () => {
		expect(bandPainter(1, DARK)).toBeUndefined();
		expect(bandPainter(0, DARK)).toBeUndefined();
	});

	it("has no band with the background unknown", () => {
		expect(bandPainter(3, undefined)).toBeUndefined();
	});
});
