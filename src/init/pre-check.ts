import { join } from "node:path";
import { isCancel, log, select } from "@clack/prompts";
import { pathExists } from "./scaffold-utils.js";

export type PreCheckResult =
	| { status: "fresh" }
	| { status: "reconfigure" }
	| { status: "cancel" };

export async function preCheck(cwd: string): Promise<PreCheckResult> {
	const configPath = join(cwd, "agntc.json");

	if (!(await pathExists(configPath))) {
		return { status: "fresh" };
	}

	log.warn("This directory is already initialized.");

	const result = await select({
		message: "What would you like to do?",
		options: [
			{ value: "reconfigure", label: "Reconfigure" },
			{ value: "cancel", label: "Cancel" },
		],
	});

	if (isCancel(result) || result === "cancel") {
		return { status: "cancel" };
	}

	return { status: "reconfigure" };
}
