import { describe, expect, it } from "vitest";
import {
	type OutOfConstraintInfo,
	renderOutOfConstraintSection,
} from "../src/summary.js";

describe("renderOutOfConstraintSection", () => {
	it("returns empty array when no out-of-constraint info exists", () => {
		const result = renderOutOfConstraintSection([]);
		expect(result).toEqual([]);
	});

	it("returns info line for single constrained plugin with out-of-constraint version", () => {
		const infos: OutOfConstraintInfo[] = [
			{ key: "owner/plugin-a", latestOverall: "v2.0.0", constraint: "^1.0" },
		];
		const result = renderOutOfConstraintSection(infos);
		expect(result).toEqual([
			"Newer versions outside constraints:",
			"  owner/plugin-a  v2.0.0 available (constraint: ^1.0)",
		]);
	});

	it("returns info lines for multiple plugins with out-of-constraint versions", () => {
		const infos: OutOfConstraintInfo[] = [
			{ key: "owner/plugin-a", latestOverall: "v2.0.0", constraint: "^1.0" },
			{ key: "owner/plugin-b", latestOverall: "v3.1.0", constraint: "^2.0" },
		];
		const result = renderOutOfConstraintSection(infos);
		expect(result).toEqual([
			"Newer versions outside constraints:",
			"  owner/plugin-a  v2.0.0 available (constraint: ^1.0)",
			"  owner/plugin-b  v3.1.0 available (constraint: ^2.0)",
		]);
	});

	it("uses info tone with no exclamation marks or warning language", () => {
		const infos: OutOfConstraintInfo[] = [
			{ key: "owner/plugin", latestOverall: "v2.0.0", constraint: "^1.0" },
		];
		const result = renderOutOfConstraintSection(infos);
		const allText = result.join(" ");
		expect(allText).not.toContain("!");
		expect(allText).not.toContain("warning");
		expect(allText).not.toContain("Warning");
		expect(allText).not.toContain("WARNING");
	});
});
