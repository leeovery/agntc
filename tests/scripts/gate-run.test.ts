import { existsSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	GATES,
	gateCalls,
	git,
	leftNothing,
	npmConfigRead,
	npmEnv,
	recorded,
	run,
	scratchPath,
	start,
	useGateRepo,
	worktrees,
} from "../helpers/script-repo.js";

useGateRepo();

async function until(file: string): Promise<void> {
	while (!existsSync(file)) {
		await new Promise((resume) => setTimeout(resume, 20));
	}
}

/** Adds a worktree at the folder given, then takes the folder away. */
function strandedWorktree(folder: string): void {
	git("worktree", "add", "-q", "--detach", folder);
	rmSync(folder, { recursive: true, force: true });
}

describe("scripts/gate's steps", () => {
	it.each(
		GATES.map((step, at) => [step, at] as const),
	)("stop when %s fails, recording nothing", async (step, at) => {
		const { status, output } = await run("gate", {
			extra: { NPM_FAIL: step },
		});

		expect(status).not.toBe(0);
		expect(gateCalls()).toEqual(GATES.slice(0, at + 1));
		expect(recorded()).toEqual([]);
		expect(output).toContain("failed or was stopped, so nothing is recorded");
		expect(leftNothing()).toBe(true);
	});

	it("see no npm config, NODE_PATH, NODE_OPTIONS or node_modules/.bin but the checkout's own", async () => {
		const { status } = await run("gate", {
			extra: {
				NODE_PATH: "/elsewhere/node_modules",
				NODE_OPTIONS: "--no-warnings",
				npm_config_registry: "https://registry.example",
				NPM_CONFIG_CACHE: "/elsewhere/cache",
				PATH: `/elsewhere/node_modules/.bin:${scratchPath("bin")}:node_modules/.bin:/x/node_modules/.bin/:${process.env.PATH}`,
			},
		});

		expect(status).toBe(0);
		const given = npmEnv();
		expect(given.has("NODE_PATH")).toBe(false);
		expect(given.has("NODE_OPTIONS")).toBe(false);
		expect(given.has("npm_config_registry")).toBe(false);
		expect(given.has("NPM_CONFIG_CACHE")).toBe(false);
		const user = given.get("NPM_CONFIG_USERCONFIG");
		const global = given.get("NPM_CONFIG_GLOBALCONFIG");
		expect(user).toMatch(/\/agntc-gate\.\w+\/user\.npmrc$/);
		expect(global).toMatch(/\/agntc-gate\.\w+\/global\.npmrc$/);
		expect(npmConfigRead()).toBe("");
		expect(given.get("PATH")).not.toContain("node_modules/.bin");
	});

	it("get a TMPDIR inside the checkout's folder, gone with it", async () => {
		await run("gate");

		const given = npmEnv().get("TMPDIR")!;
		expect(given).toMatch(/\/agntc-gate\.\w+\/tmp$/);
		expect(existsSync(given)).toBe(false);
	});
});

describe("scripts/gate's checkout", () => {
	it.each([
		["passes", {}],
		["fails", { NPM_FAIL: "run typecheck" }],
	])("is removed when the gate %s", async (_, extra) => {
		await run("gate", { extra });

		expect(gateCalls()).not.toEqual([]);
		expect(leftNothing()).toBe(true);
	});

	it.each([
		["SIGINT", 130, {}],
		["SIGTERM", 143, {}],
		["SIGINT", 130, { NPM_CATCH: "1" }],
		["SIGTERM", 143, { NPM_CATCH: "1" }],
	] as const)("is removed when the gate is stopped by %s, which says so and exits %i (%o)", async (signal, code, extra) => {
		const hung = scratchPath("hung");
		const gate = start("gate", { extra: { NPM_HANG: hung, ...extra } });
		await until(hung);

		process.kill(-gate.pid, signal);
		const { status, output } = await gate.done;

		expect(status).toBe(code);
		expect(output).toContain(`gate: stopped by ${signal}`);
		expect(recorded()).toEqual([]);
		expect(leftNothing()).toBe(true);
	});

	it("is forgotten by a later gate once a killed gate left it, and no other worktree is", async () => {
		const stale = scratchPath("old", "agntc-gate.ABC123", "agntc");
		const away = scratchPath("away");
		const running = scratchPath("other", "agntc-gate.XYZ789", "agntc");
		strandedWorktree(stale);
		strandedWorktree(away);
		git("worktree", "add", "-q", "--detach", running);

		const { status } = await run("gate");

		expect(status).toBe(0);
		const left = worktrees();
		expect(left).not.toContain(stale);
		expect(left).toContain(away);
		expect(left).toContain(running);
	});
});
