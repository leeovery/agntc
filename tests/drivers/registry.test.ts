import { describe, it, expect } from "vitest";
import { getDriver, getRegisteredAgentIds } from "../../src/drivers/registry.js";
import { ClaudeDriver } from "../../src/drivers/claude-driver.js";

describe("driver registry", () => {
  it("returns claude driver for 'claude'", () => {
    const driver = getDriver("claude");

    expect(driver).toBeInstanceOf(ClaudeDriver);
  });

  it("lists registered agent IDs", () => {
    const ids = getRegisteredAgentIds();

    expect(ids).toEqual(["claude"]);
  });

  it("does not contain codex yet", () => {
    const ids = getRegisteredAgentIds();

    expect(ids).not.toContain("codex");
  });
});
