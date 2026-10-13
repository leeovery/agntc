import { execFileSync, execSync } from "node:child_process";
import {
	accessSync,
	constants,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const CLI = resolve(ROOT, "dist/cli.js");

// The CLI is exercised from an isolated, empty temp dir rather than the repo
// root. Manifest-reading commands (list, update, remove) resolve the manifest
// from process.cwd(); against the repo root they read the real .agntc manifest
// and perform live GitHub update-checks, which timed out under load (default 5s)
// and flaked this suite. An empty cwd has no manifest, so they do zero network.
let cwd: string;

function run(args: string[]): {
	stdout: string;
	stderr: string;
	exitCode: number;
} {
	try {
		const stdout = execFileSync("node", [CLI, ...args], {
			encoding: "utf-8",
			cwd,
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

// execFileSync pipes stdin and stdout, so every subcommand here runs without a
// terminal and answers with one JSON document.
function runPiped(args: string[]) {
	const result = run(args);
	return { ...result, document: JSON.parse(result.stdout) };
}

beforeAll(() => {
	execSync("npm run build", { cwd: ROOT, stdio: "pipe" });
	cwd = mkdtempSync(join(tmpdir(), "agntc-cli-test-"));
}, 60_000);

afterAll(() => {
	if (cwd) rmSync(cwd, { recursive: true, force: true });
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
		const { document, exitCode } = runPiped(["add", "repo"]);
		expect(exitCode).not.toBe(0);
		expect(document).toMatchObject({ ok: false, command: "add" });
		expect(document.error.message).toContain("owner/repo");
	});
});

describe("agntc list", () => {
	it("exits 0 and prints what's installed as JSON", () => {
		const { document, exitCode } = runPiped(["list"]);
		expect(exitCode).toBe(0);
		expect(document).toEqual({
			ok: true,
			command: "list",
			entries: [],
			warnings: [],
			notes: [],
		});
	});
});

describe("agntc remove", () => {
	it("exits 0 with no key argument and nothing installed", () => {
		const { document, exitCode } = runPiped(["remove"]);
		expect(exitCode).toBe(0);
		expect(document).toMatchObject({ ok: true, removed: [] });
	});
});

describe("agntc update", () => {
	it("exits 0 with no key argument (all-plugins mode)", () => {
		const { document, exitCode } = runPiped(["update"]);
		expect(exitCode).toBe(0);
		expect(document).toMatchObject({ ok: true, items: [] });
	});
});

describe("agntc init", () => {
	it("appears in --help output with description", () => {
		const { stdout, exitCode } = run(["--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("init");
		expect(stdout).toContain("Scaffold a new agntc plugin");
	});

	it("refuses without a terminal", () => {
		const { document, exitCode } = runPiped(["init"]);
		expect(exitCode).not.toBe(0);
		expect(document).toMatchObject({
			ok: false,
			command: "init",
			error: { message: "agntc init needs a terminal" },
		});
	});

	it("rejects extra arguments", () => {
		const { exitCode, stderr } = run(["init", "extra", "args"]);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("too many arguments");
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

describe("banner", () => {
	it("shows on the no-args landing", () => {
		expect(run([]).stdout).toContain("agent skills installer");
	});

	it("shows on --help", () => {
		expect(run(["--help"]).stdout).toContain("agent skills installer");
	});

	it("is suppressed on a subcommand without a terminal, leaving stdout one JSON document", () => {
		const { stdout } = run(["list"]);
		expect(stdout).not.toContain("agent skills installer");
		expect(() => JSON.parse(stdout)).not.toThrow();
	});

	it("is suppressed for --version (clean for scripts)", () => {
		expect(run(["--version"]).stdout).not.toContain("agent skills installer");
	});
});
