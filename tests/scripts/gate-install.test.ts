import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	commit,
	forgetGateCalls,
	GATES,
	gateCalls,
	repoPath,
	run,
	useGateRepo,
	write,
	writeLater,
} from "../helpers/script-repo.js";

useGateRepo();

describe("scripts/gate's npm ci", () => {
	it("is skipped when node_modules is as its own npm ci left it", () => {
		run("gate");
		forgetGateCalls();

		run("gate");

		expect(gateCalls()).toEqual(GATES);
	});

	it("is skipped past the caches vitest writes into node_modules", () => {
		run("gate");
		forgetGateCalls();
		writeLater("node_modules/.vite/vitest/results.json");
		writeLater("node_modules/.vite-temp/config.mjs");

		run("gate");

		expect(gateCalls()).toEqual(GATES);
	});

	it.each([
		["package-lock.json changes", () => commit({ "package-lock.json": "[]" })],
		["package.json changes", () => commit({ "package.json": "[]" })],
		[
			"npm has installed into node_modules since",
			() => write("node_modules/.package-lock.json", "other"),
		],
		[
			"a file in node_modules is edited by hand",
			() => writeLater("node_modules/pkg/index.js"),
		],
		[
			"node_modules is gone",
			() => rmSync(repoPath("node_modules"), { recursive: true }),
		],
		[
			"node_modules wasn't installed by the gate",
			() => rmSync(repoPath("node_modules", ".agntc-gate")),
		],
	])("runs again when %s", (_, change) => {
		run("gate");
		forgetGateCalls();
		change();

		run("gate");

		expect(gateCalls()).toEqual(["ci", ...GATES]);
	});

	it.each([
		["node's version", { FAKE_NODE_VERSION: "v26.0.0" }],
		["the platform", { FAKE_UNAME: "Linux x86_64" }],
	])("runs again when %s changes", (_, changed) => {
		run("gate");
		forgetGateCalls();

		run("gate", { extra: changed });

		expect(gateCalls()).toEqual(["ci", ...GATES]);
	});

	it("runs again after a failed npm ci", () => {
		run("gate", { extra: { NPM_FAIL: "ci" } });
		forgetGateCalls();

		run("gate");

		expect(gateCalls()).toEqual(["ci", ...GATES]);
	});
});
