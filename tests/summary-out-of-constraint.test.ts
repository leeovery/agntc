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
				repo: "owner/plugin-a",
				constraint: "^1.0",
			},
		];
		const result = renderOutOfConstraintSection(infos);
		expect(result).toEqual([
			"Newer versions outside constraints:",
			"  owner/plugin-a  v1.3.0 -> v2.0.0 available. To upgrade: npx agntc add owner/plugin-a",
		]);
	});

	// The all-mode footer disambiguates a multi-group repo by @intent on the PREFIX
	// (info.label), but the re-add command is always the BARE owner/repo (info.repo)
	// — a bare add re-resolves latest and re-establishes caret, never the @intent.
	it("uses the Group label as the prefix but the bare owner/repo in the command for a multi-group repo", () => {
		const infos: OutOfConstraintInfo[] = [
			{
				label: "owner/repo@^1.2.3",
				current: "v1.2.3",
				latestOverall: "v3.0.0",
				repo: "owner/repo",
				constraint: "^1.2.3",
			},
		];
		const result = renderOutOfConstraintSection(infos);
		expect(result).toEqual([
			"Newer versions outside constraints:",
			"  owner/repo@^1.2.3  v1.2.3 -> v3.0.0 available. To upgrade: npx agntc add owner/repo",
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
				repo: "owner/plugin-a",
				constraint: "^1.0",
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
				repo: "owner/plugin",
				constraint: "^1.0",
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
				repo: "owner/repo-a",
				constraint: "^1.0",
			},
			{
				label: "owner/repo-b",
				current: "v2.1.0",
				latestOverall: "v3.1.0",
				repo: "owner/repo-b",
				constraint: "^2.0",
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
