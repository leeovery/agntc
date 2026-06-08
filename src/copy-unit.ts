import type { ComputeInput } from "./compute-incoming-files.js";
import { copyBareSkill } from "./copy-bare-skill.js";
import type { AssetCounts } from "./copy-plugin-assets.js";
import { copyPluginAssets } from "./copy-plugin-assets.js";
import type { AgentId, AgentWithDriver } from "./drivers/types.js";
import type { DetectedType } from "./type-detection.js";

/**
 * The standalone-unit variants of {@link DetectedType}: the plugin/bare-skill
 * pair that both the standalone install path and each collection member resolve
 * to. Collection/not-agntc never reach the copy/compute step.
 */
type StandaloneDetected = Extract<
	DetectedType,
	{ type: "bare-skill" | "plugin" }
>;

export interface CopyUnitInput {
	sourceDir: string;
	agents: AgentWithDriver[];
	projectDir: string;
	/**
	 * The installed bare-skill directory name (identity = repo/unit basename).
	 * Forwarded to {@link copyBareSkill}; ignored for plugins (their asset dirs
	 * keep their own names). Defaults to `basename(sourceDir)` when omitted — see
	 * {@link copyBareSkill} for why a whole-repo bare skill must pass it.
	 */
	skillName?: string;
}

export interface CopyUnitResult {
	copiedFiles: string[];
	assetCountsByAgent?: Partial<Record<AgentId, AssetCounts>>;
}

/**
 * Maps a resolved standalone unit to the discriminated {@link ComputeInput}
 * consumed by computeIncomingFiles. The plugin/bare-skill arm shape lives here
 * in one place, shared by the standalone and collection-member install paths.
 */
export function toComputeInput(
	detected: StandaloneDetected,
	sourceDir: string,
	agents: AgentWithDriver[],
	skillName?: string,
): ComputeInput {
	if (detected.type === "plugin") {
		return { type: "plugin", sourceDir, assetDirs: detected.assetDirs, agents };
	}
	return { type: "bare-skill", sourceDir, agents, skillName };
}

/**
 * Copies a resolved standalone unit, branching on its detected type to
 * copyPluginAssets (multi-asset plugin) or copyBareSkill (single bare skill).
 * The plugin/bare-skill copy dispatch and the copiedFiles/assetCountsByAgent
 * assembly live here in one place, shared by the standalone and
 * collection-member install paths. A bare skill produces no assetCountsByAgent.
 */
export async function copyUnit(
	detected: StandaloneDetected,
	input: CopyUnitInput,
): Promise<CopyUnitResult> {
	const { sourceDir, agents, projectDir, skillName } = input;

	if (detected.type === "plugin") {
		const pluginResult = await copyPluginAssets({
			sourceDir,
			assetDirs: detected.assetDirs,
			agents,
			projectDir,
		});
		return {
			copiedFiles: pluginResult.copiedFiles,
			assetCountsByAgent: pluginResult.assetCountsByAgent,
		};
	}

	const bareResult = await copyBareSkill({
		sourceDir,
		projectDir,
		agents,
		skillName,
	});
	return { copiedFiles: bareResult.copiedFiles };
}
