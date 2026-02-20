import { describe, it, expect } from "vitest";
import {
  computeEffectiveAgents,
  findDroppedAgents,
} from "../src/agent-compat.js";

describe("computeEffectiveAgents", () => {
  it("returns intersection of entry agents and new config agents", () => {
    expect(computeEffectiveAgents(["claude", "codex"], ["claude"])).toEqual([
      "claude",
    ]);
  });

  it("returns all when agents match exactly", () => {
    expect(
      computeEffectiveAgents(["claude", "codex"], ["claude", "codex"]),
    ).toEqual(["claude", "codex"]);
  });

  it("returns empty when no overlap", () => {
    expect(computeEffectiveAgents(["codex"], ["claude"])).toEqual([]);
  });

  it("ignores new agents not in entry", () => {
    expect(
      computeEffectiveAgents(["claude"], ["claude", "codex"]),
    ).toEqual(["claude"]);
  });

  it("preserves order from entry agents", () => {
    expect(
      computeEffectiveAgents(["codex", "claude"], ["claude", "codex"]),
    ).toEqual(["codex", "claude"]);
  });
});

describe("findDroppedAgents", () => {
  it("returns agents in entry but not in new config", () => {
    expect(findDroppedAgents(["claude", "codex"], ["claude"])).toEqual([
      "codex",
    ]);
  });

  it("returns empty when no agents dropped", () => {
    expect(
      findDroppedAgents(["claude", "codex"], ["claude", "codex"]),
    ).toEqual([]);
  });

  it("returns all when none overlap", () => {
    expect(findDroppedAgents(["codex"], ["claude"])).toEqual(["codex"]);
  });

  it("ignores new agents not in entry", () => {
    expect(
      findDroppedAgents(["claude"], ["claude", "codex"]),
    ).toEqual([]);
  });

  it("returns single dropped agent from multi-agent entry", () => {
    expect(
      findDroppedAgents(["claude", "codex"], ["codex"]),
    ).toEqual(["claude"]);
  });
});
