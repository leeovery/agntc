import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyBareSkill } from "../src/copy-bare-skill.js";
import { copyPluginAssets } from "../src/copy-plugin-assets.js";
import { copyUnit, toComputeInput } from "../src/copy-unit.js";
import type { AgentWithDriver } from "../src/drivers/types.js";
import type { DetectedType } from "../src/type-detection.js";

vi.mock("../src/copy-plugin-assets.js", () => ({
	copyPluginAssets: vi.fn(),
}));
vi.mock("../src/copy-bare-skill.js", () => ({
	copyBareSkill: vi.fn(),
}));

const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
const mockCopyBareSkill = vi.mocked(copyBareSkill);

const agents: AgentWithDriver[] = [
	{
		id: "claude",
		driver: { detect: async () => true, getTargetDir: () => null },
	},
];

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
		const input = toComputeInput(pluginDetected, "/src/unit", agents);
		expect(input).toEqual({
			type: "plugin",
			sourceDir: "/src/unit",
			assetDirs: ["skills", "agents"],
			agents,
		});
	});

	it("maps a bare-skill to a bare-skill ComputeInput", () => {
		const input = toComputeInput(bareDetected, "/src/unit", agents);
		expect(input).toEqual({
			type: "bare-skill",
			sourceDir: "/src/unit",
			agents,
		});
	});
});

describe("copyUnit", () => {
	it("dispatches a plugin to copyPluginAssets and returns copiedFiles + assetCountsByAgent", async () => {
		mockCopyPluginAssets.mockResolvedValue({
			copiedFiles: [".claude/skills/a/"],
			assetCountsByAgent: { claude: { skills: 1 } },
		});

		const result = await copyUnit(pluginDetected, {
			sourceDir: "/src/unit",
			agents,
			projectDir: "/proj",
		});

		expect(mockCopyPluginAssets).toHaveBeenCalledWith({
			sourceDir: "/src/unit",
			assetDirs: ["skills", "agents"],
			agents,
			projectDir: "/proj",
		});
		expect(mockCopyBareSkill).not.toHaveBeenCalled();
		expect(result).toEqual({
			copiedFiles: [".claude/skills/a/"],
			assetCountsByAgent: { claude: { skills: 1 } },
		});
	});

	it("dispatches a bare-skill to copyBareSkill and returns copiedFiles with no assetCountsByAgent", async () => {
		mockCopyBareSkill.mockResolvedValue({
			copiedFiles: [".claude/skills/my-skill/"],
		});

		const result = await copyUnit(bareDetected, {
			sourceDir: "/src/unit",
			agents,
			projectDir: "/proj",
		});

		expect(mockCopyBareSkill).toHaveBeenCalledWith({
			sourceDir: "/src/unit",
			projectDir: "/proj",
			agents,
		});
		expect(mockCopyPluginAssets).not.toHaveBeenCalled();
		expect(result).toEqual({
			copiedFiles: [".claude/skills/my-skill/"],
			assetCountsByAgent: undefined,
		});
	});
});
