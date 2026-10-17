import { describe, expect, it } from "vitest";
import {
	type OutOfConstraintInfo,
	outOfConstraintMessage,
	upgradeAdvice,
} from "../src/summary.js";

describe("outOfConstraintMessage", () => {
	it("words the actionable <current> → <latestOverall> move at a terminal, -> in its machine sentence, and the bare re-add that makes it", () => {
		const info: OutOfConstraintInfo = {
			subject: "owner/plugin-a",
			current: "v1.3.0",
			latestOverall: "v2.0.0",
			commands: ["npx agntc add owner/plugin-a"],
		};

		expect(outOfConstraintMessage(info)).toEqual({
			subject: "owner/plugin-a",
			detail:
				"Newer version outside the constraint: v1.3.0 → v2.0.0 available.",
			text: "owner/plugin-a  v1.3.0 → v2.0.0 available.",
			remedy: {
				lead: "To upgrade:",
				steps: [{ command: "npx agntc add owner/plugin-a" }],
			},
			plain:
				"owner/plugin-a  v1.3.0 -> v2.0.0 available. To upgrade: npx agntc add owner/plugin-a",
		});
	});

	it("is about the group label it's given, the command as given", () => {
		const message = outOfConstraintMessage({
			subject: "owner/repo@^1.2.3",
			current: "v1.2.3",
			latestOverall: "v3.0.0",
			commands: ["npx agntc add owner/repo/skills/a"],
		});

		expect(message.subject).toBe("owner/repo@^1.2.3");
		expect(message.remedy.steps).toEqual([
			{ command: "npx agntc add owner/repo/skills/a" },
		]);
	});

	it("lists a group's several re-add commands once each, a line each in its sentence", () => {
		const message = outOfConstraintMessage({
			subject: "owner/repo",
			current: "v1.2.3",
			latestOverall: "v3.0.0",
			commands: [
				"npx agntc add owner/repo/a",
				"npx agntc add owner/repo/tools --pack",
				"npx agntc add owner/repo/a",
			],
		});

		expect(message.remedy.steps).toEqual([
			{ command: "npx agntc add owner/repo/a" },
			{ command: "npx agntc add owner/repo/tools --pack" },
		]);
		expect(message.plain).toBe(
			[
				"owner/repo  v1.2.3 -> v3.0.0 available. To upgrade:",
				"    npx agntc add owner/repo/a",
				"    npx agntc add owner/repo/tools --pack",
			].join("\n"),
		);
	});

	it("keeps the informative tone — no ! or warning language", () => {
		const message = outOfConstraintMessage({
			subject: "owner/plugin",
			current: "v1.3.0",
			latestOverall: "v2.0.0",
			commands: ["npx agntc add owner/plugin"],
		});

		for (const words of [message.detail, message.plain]) {
			expect(words).not.toContain("!");
			expect(words.toLowerCase()).not.toContain("warning");
		}
	});
});

describe("upgradeAdvice", () => {
	it("runs one command on after its lead", () => {
		expect(upgradeAdvice(["npx agntc add owner/repo"])).toEqual({
			remedy: {
				lead: "To upgrade:",
				steps: [{ command: "npx agntc add owner/repo" }],
			},
			plain: "To upgrade: npx agntc add owner/repo",
		});
	});

	it("sets several commands a line each, and names each once", () => {
		const advice = upgradeAdvice([
			"npx agntc add a",
			"npx agntc add b",
			"npx agntc add a",
		]);

		expect(advice.remedy.steps).toEqual([
			{ command: "npx agntc add a" },
			{ command: "npx agntc add b" },
		]);
		expect(advice.plain).toBe(
			"To upgrade:\n    npx agntc add a\n    npx agntc add b",
		);
	});
});
