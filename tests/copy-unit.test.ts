import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyBareSkill } from "../src/copy-bare-skill.js";
import { copyPluginAssets } from "../src/copy-plugin-assets.js";
import { copyUnit, toComputeInput } from "../src/copy-unit.js";
import type { DetectedType } from "../src/type-detection.js";

vi.mock("../src/copy-plugin-assets.js", () => ({
	copyPluginAssets: vi.fn(),
}));
vi.mock("../src/copy-bare-skill.js", () => ({
	copyBareSkill: vi.fn(),
}));

const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
const mockCopyBareSkill = vi.mocked(copyBareSkill);

type StandaloneDetected = Extract<
	DetectedType,
	{ type: "bare-skill" | "plugin" }
>;

const pluginDetected: StandaloneDetected = {
	type: "plugin",
	assetDirs: ["skills", "agents"],
};
const bareDetected: StandaloneDetected = { type: "bare-skill" };

beforeEach(() => {
	vi.clearAllMocks();
});

describe("toComputeInput", () => {
	it("maps a plugin to a plugin ComputeInput", () => {
		const input = toComputeInput(pluginDetected, "/src/unit");
		expect(input).toEqual({
			type: "plugin",
			sourceDir: "/src/unit",
			assetDirs: ["skills", "agents"],
		});
	});

	it("maps a bare-skill to a bare-skill ComputeInput", () => {
		const input = toComputeInput(bareDetected, "/src/unit");
		expect(input).toEqual({
			type: "bare-skill",
			sourceDir: "/src/unit",
		});
	});

	it("carries the install name onto a bare-skill ComputeInput", () => {
		const input = toComputeInput(bareDetected, "/src/unit", "my-skill");
		expect(input).toEqual({
			type: "bare-skill",
			sourceDir: "/src/unit",
			skillName: "my-skill",
		});
	});
});

describe("copyUnit", () => {
	it("dispatches a plugin to copyPluginAssets and returns its copiedFiles + assetCounts", async () => {
		mockCopyPluginAssets.mockResolvedValue({
			copiedFiles: [".claude/skills/a/"],
			assetCounts: { skills: 1 },
		});

		const result = await copyUnit(pluginDetected, {
			sourceDir: "/src/unit",
			projectDir: "/proj",
		});

		expect(mockCopyPluginAssets).toHaveBeenCalledWith({
			sourceDir: "/src/unit",
			assetDirs: ["skills", "agents"],
			projectDir: "/proj",
		});
		expect(mockCopyBareSkill).not.toHaveBeenCalled();
		expect(result).toEqual({
			copiedFiles: [".claude/skills/a/"],
			assetCounts: { skills: 1 },
		});
	});

	it("dispatches a bare-skill to copyBareSkill and counts it as one skill", async () => {
		mockCopyBareSkill.mockResolvedValue({
			copiedFiles: [".claude/skills/my-skill/"],
		});

		const result = await copyUnit(bareDetected, {
			sourceDir: "/src/unit",
			projectDir: "/proj",
		});

		expect(mockCopyBareSkill).toHaveBeenCalledWith({
			sourceDir: "/src/unit",
			projectDir: "/proj",
		});
		expect(mockCopyPluginAssets).not.toHaveBeenCalled();
		expect(result).toEqual({
			copiedFiles: [".claude/skills/my-skill/"],
			assetCounts: { skills: 1 },
		});
	});
});
