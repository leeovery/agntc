import { access } from "node:fs/promises";
import { join } from "node:path";
import { isCancel, log, select } from "@clack/prompts";

export type PreCheckResult =
	| { status: "fresh" }
	| { status: "reconfigure" }
	| { status: "cancel" };

export async function preCheck(cwd: string): Promise<PreCheckResult> {
	const configPath = join(cwd, "agntc.json");

	try {
		await access(configPath);
	} catch {
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
