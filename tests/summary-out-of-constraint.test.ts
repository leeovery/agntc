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

	it("renders the actionable <current> -> <latestOverall> available line with the bare re-add command", () => {
		const infos: OutOfConstraintInfo[] = [
			{
				key: "owner/plugin-a",
				current: "v1.3.0",
				latestOverall: "v2.0.0",
				commands: ["npx agntc add owner/plugin-a"],
			},
		];
		const result = renderOutOfConstraintSection(infos);
		expect(result).toEqual([
			"Newer versions outside constraints:",
			"  owner/plugin-a  v1.3.0 -> v2.0.0 available. To upgrade: npx agntc add owner/plugin-a",
		]);
	});

	it("uses the Group label as the prefix and the entry-built command as given", () => {
		const infos: OutOfConstraintInfo[] = [
			{
				label: "owner/repo@^1.2.3",
				current: "v1.2.3",
				latestOverall: "v3.0.0",
				commands: ["npx agntc add owner/repo/skills/a"],
			},
		];
		const result = renderOutOfConstraintSection(infos);
		expect(result).toEqual([
			"Newer versions outside constraints:",
			"  owner/repo@^1.2.3  v1.2.3 -> v3.0.0 available. To upgrade: npx agntc add owner/repo/skills/a",
		]);
	});

	it("lists a group's several re-add commands one per line, once each", () => {
		const infos: OutOfConstraintInfo[] = [
			{
				label: "owner/repo",
				current: "v1.2.3",
				latestOverall: "v3.0.0",
				commands: [
					"npx agntc add owner/repo/a",
					"npx agntc add owner/repo/tools --pack",
					"npx agntc add owner/repo/a",
				],
			},
		];
		const result = renderOutOfConstraintSection(infos);
		expect(result).toEqual([
			"Newer versions outside constraints:",
			[
				"  owner/repo  v1.2.3 -> v3.0.0 available. To upgrade:",
				"    npx agntc add owner/repo/a",
				"    npx agntc add owner/repo/tools --pack",
			].join("\n"),
		]);
	});

	// The single-key path (runSingleUpdate) populates `key` only (no label), so the
	// `label ?? key` fallback renders the key as the prefix.
	it("falls back to key as the prefix when no label is set (single-key path)", () => {
		const infos: OutOfConstraintInfo[] = [
			{
				key: "owner/plugin-a",
				current: "v1.3.0",
				latestOverall: "v2.0.0",
				commands: ["npx agntc add owner/plugin-a"],
			},
		];
		const result = renderOutOfConstraintSection(infos);
		expect(result).toEqual([
			"Newer versions outside constraints:",
			"  owner/plugin-a  v1.3.0 -> v2.0.0 available. To upgrade: npx agntc add owner/plugin-a",
		]);
	});

	it("keeps the informative tone — no ! or warning language and preserves the header", () => {
		const infos: OutOfConstraintInfo[] = [
			{
				key: "owner/plugin",
				current: "v1.3.0",
				latestOverall: "v2.0.0",
				commands: ["npx agntc add owner/plugin"],
			},
		];
		const result = renderOutOfConstraintSection(infos);
		expect(result[0]).toBe("Newer versions outside constraints:");
		const allText = result.join(" ");
		expect(allText).not.toContain("!");
		expect(allText).not.toContain("warning");
		expect(allText).not.toContain("Warning");
		expect(allText).not.toContain("WARNING");
	});

	it("still emits one line per info (collection collapse preserved)", () => {
		const infos: OutOfConstraintInfo[] = [
			{
				label: "owner/repo-a",
				current: "v1.3.0",
				latestOverall: "v2.0.0",
				commands: ["npx agntc add owner/repo-a"],
			},
			{
				label: "owner/repo-b",
				current: "v2.1.0",
				latestOverall: "v3.1.0",
				commands: ["npx agntc add owner/repo-b"],
			},
		];
		const result = renderOutOfConstraintSection(infos);
		expect(result).toEqual([
			"Newer versions outside constraints:",
			"  owner/repo-a  v1.3.0 -> v2.0.0 available. To upgrade: npx agntc add owner/repo-a",
			"  owner/repo-b  v2.1.0 -> v3.1.0 available. To upgrade: npx agntc add owner/repo-b",
		]);
	});
});
