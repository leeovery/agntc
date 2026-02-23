import { Command } from "commander";
import { withExitSignal } from "../exit-signal.js";

export async function runInit(): Promise<void> {
	// Stub — flow is built in subsequent tasks and wired in task 1-6
}

export const initCommand = new Command("init")
	.description("Scaffold a new agntc plugin")
	.allowExcessArguments(true)
	.action(
		withExitSignal(async () => {
			await runInit();
		}),
	);
