import { describe, it, expect } from "vitest";
import { getDriver, getRegisteredAgentIds } from "../../src/drivers/registry.js";
import { ClaudeDriver } from "../../src/drivers/claude-driver.js";
import { CodexDriver } from "../../src/drivers/codex-driver.js";

describe("driver registry", () => {
  it("returns claude driver for 'claude'", () => {
    const driver = getDriver("claude");

    expect(driver).toBeInstanceOf(ClaudeDriver);
  });

  it("returns codex driver for 'codex'", () => {
    const driver = getDriver("codex");

    expect(driver).toBeInstanceOf(CodexDriver);
  });

  it("lists registered agent IDs including both claude and codex", () => {
    const ids = getRegisteredAgentIds();

    expect(ids).toEqual(["claude", "codex"]);
  });
});
