import { describe, expect, it } from "vitest";
import {
	agntcCommand,
	commandTitle,
	globalScope,
	projectScope,
} from "../src/scope.js";

describe("projectScope and globalScope", () => {
	it("root a project at the given folder and global installs at home", () => {
		expect(projectScope("/work/app")).toEqual({
			name: "project",
			root: "/work/app",
		});
		expect(globalScope("/home/lee")).toEqual({
			name: "global",
			root: "/home/lee",
		});
	});
});

describe("agntcCommand", () => {
	it("carries -g after the command only for the global scope", () => {
		expect(agntcCommand("project", "add", ["owner/repo"])).toBe(
			"npx agntc add owner/repo",
		);
		expect(agntcCommand("global", "add", ["owner/repo"])).toBe(
			"npx agntc add -g owner/repo",
		);
	});

	it("leaves plain arguments bare: repos, versions, constraints and flags", () => {
		expect(
			agntcCommand("project", "add", [
				"owner/repo/skills/go@^1.2.0",
				"--skill",
				"a_b",
				"c-d",
			]),
		).toBe("npx agntc add owner/repo/skills/go@^1.2.0 --skill a_b c-d");
		expect(agntcCommand("project", "add", ["owner/repo@~1.0", "--pack"])).toBe(
			"npx agntc add owner/repo@~1.0 --pack",
		);
	});

	it("single-quotes a path with a space", () => {
		expect(
			agntcCommand("global", "add", ["/Users/lee/My Skills/go", "--pack"]),
		).toBe("npx agntc add -g '/Users/lee/My Skills/go' --pack");
	});

	it("single-quotes a path with a quote, escaping the quote", () => {
		expect(agntcCommand("project", "remove", ["/src/lee's/go"])).toBe(
			"npx agntc remove '/src/lee'\\''s/go'",
		);
	});

	it.each([
		"/src/a$b",
		"/src/a;b",
		"/src/a*b",
		"/src/a(b)",
		"/src/a&b",
	])("single-quotes a path with a shell metacharacter: %s", (path) => {
		expect(agntcCommand("project", "add", [path])).toBe(
			`npx agntc add '${path}'`,
		);
	});
});

describe("commandTitle", () => {
	it("says global only for the global scope", () => {
		expect(commandTitle("list", "project")).toBe("agntc list");
		expect(commandTitle("list", "global")).toBe("agntc list · global");
	});
});
