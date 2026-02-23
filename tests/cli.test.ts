import { execFileSync, execSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const CLI = resolve(ROOT, "dist/cli.js");

function run(args: string[]): {
	stdout: string;
	stderr: string;
	exitCode: number;
} {
	try {
		const stdout = execFileSync("node", [CLI, ...args], {
			encoding: "utf-8",
			cwd: ROOT,
			env: { ...process.env, NO_COLOR: "1" },
		});
		return { stdout, stderr: "", exitCode: 0 };
	} catch (error: unknown) {
		const err = error as {
			stdout: string;
			stderr: string;
			status: number;
		};
		return {
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
			exitCode: err.status ?? 1,
		};
	}
}

beforeAll(() => {
	execSync("npm run build", { cwd: ROOT, stdio: "pipe" });
});

describe("build output", () => {
	it("produces dist/cli.js with node shebang", () => {
		const content = readFileSync(CLI, "utf-8");
		expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
	});

	it("dist/cli.js is executable", () => {
		accessSync(CLI, constants.X_OK);
	});
});

describe("agntc --help", () => {
	it("includes add, list, remove, and update in output", () => {
		const { stdout, exitCode } = run(["--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("add");
		expect(stdout).toContain("list");
		expect(stdout).toContain("remove");
		expect(stdout).toContain("update");
	});
});

describe("agntc add", () => {
	it("exits non-zero with no source argument", () => {
		const { exitCode } = run(["add"]);
		expect(exitCode).not.toBe(0);
	});

	it("exits non-zero with malformed source (bare repo name)", () => {
		const { stdout, exitCode } = run(["add", "repo"]);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("owner/repo");
	});
});

describe("agntc list", () => {
	it("exits 0 and outputs placeholder message", () => {
		const { stdout, exitCode } = run(["list"]);
		expect(exitCode).toBe(0);
		expect(stdout.length).toBeGreaterThan(0);
	});
});

describe("agntc remove", () => {
	it("exits 0 with no key argument (interactive mode)", () => {
		const { exitCode } = run(["remove"]);
		expect(exitCode).toBe(0);
	});
});

describe("agntc update", () => {
	it("exits 0 with no key argument (all-plugins mode)", () => {
		const { exitCode } = run(["update"]);
		expect(exitCode).toBe(0);
	});
});

describe("agntc init", () => {
	it("appears in --help output with description", () => {
		const { stdout, exitCode } = run(["--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("init");
		expect(stdout).toContain("Scaffold a new agntc plugin");
	});

	it("exits with code 0", () => {
		const { exitCode } = run(["init"]);
		expect(exitCode).toBe(0);
	});

	it("ignores extra arguments", () => {
		const { exitCode } = run(["init", "extra", "args"]);
		expect(exitCode).toBe(0);
	});
});

describe("agntc with no arguments", () => {
	it("shows help", () => {
		const { stdout } = run([]);
		expect(stdout).toContain("add");
		expect(stdout).toContain("list");
		expect(stdout).toContain("remove");
		expect(stdout).toContain("update");
	});
});

describe("agntc with unknown command", () => {
	it("exits non-zero", () => {
		const { exitCode } = run(["unknown-command"]);
		expect(exitCode).not.toBe(0);
	});
});
