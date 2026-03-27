import { describe, expect, it } from "vitest";
import { ClaudeDriver } from "../../src/drivers/claude-driver.js";
import { CodexDriver } from "../../src/drivers/codex-driver.js";
import { CursorDriver } from "../../src/drivers/cursor-driver.js";
import {
	getDriver,
	getRegisteredAgentIds,
} from "../../src/drivers/registry.js";

describe("driver registry", () => {
	it("returns claude driver for 'claude'", () => {
		const driver = getDriver("claude");

		expect(driver).toBeInstanceOf(ClaudeDriver);
	});

	it("returns codex driver for 'codex'", () => {
		const driver = getDriver("codex");

		expect(driver).toBeInstanceOf(CodexDriver);
	});

	it("returns cursor driver for 'cursor'", () => {
		const driver = getDriver("cursor");

		expect(driver).toBeInstanceOf(CursorDriver);
	});

	it("lists registered agent IDs including claude, codex, and cursor", () => {
		const ids = getRegisteredAgentIds();

		expect(ids).toEqual(["claude", "codex", "cursor"]);
	});
});
