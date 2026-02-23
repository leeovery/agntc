import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDriver, AgentId } from "../src/drivers/types.js";

vi.mock("../src/drivers/registry.js", () => ({
	getRegisteredAgentIds: vi.fn(),
	getDriver: vi.fn(),
}));

import { detectAgents } from "../src/detect-agents.js";
import { getDriver, getRegisteredAgentIds } from "../src/drivers/registry.js";

const mockGetRegisteredAgentIds = vi.mocked(getRegisteredAgentIds);
const mockGetDriver = vi.mocked(getDriver);

function makeDriver(detectResult: boolean | Error): AgentDriver {
	return {
		detect:
			detectResult instanceof Error
				? vi.fn().mockRejectedValue(detectResult)
				: vi.fn().mockResolvedValue(detectResult),
		getTargetDir: vi.fn().mockReturnValue(null),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("detectAgents", () => {
	it("returns both agents when both detected", async () => {
		const claudeDriver = makeDriver(true);
		const codexDriver = makeDriver(true);

		mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
		mockGetDriver.mockImplementation((id: AgentId) => {
			if (id === "claude") return claudeDriver;
			return codexDriver;
		});

		const result = await detectAgents("/my/project");

		expect(result).toEqual(["claude", "codex"]);
	});

	it("returns only detected agent when one detected", async () => {
		const claudeDriver = makeDriver(true);
		const codexDriver = makeDriver(false);

		mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
		mockGetDriver.mockImplementation((id: AgentId) => {
			if (id === "claude") return claudeDriver;
			return codexDriver;
		});

		const result = await detectAgents("/my/project");

		expect(result).toEqual(["claude"]);
	});

	it("returns empty array when none detected", async () => {
		const claudeDriver = makeDriver(false);
		const codexDriver = makeDriver(false);

		mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
		mockGetDriver.mockImplementation((id: AgentId) => {
			if (id === "claude") return claudeDriver;
			return codexDriver;
		});

		const result = await detectAgents("/my/project");

		expect(result).toEqual([]);
	});

	it("detects agents in parallel using Promise.all", async () => {
		const callOrder: string[] = [];
		const claudeDriver: AgentDriver = {
			detect: vi.fn().mockImplementation(async () => {
				callOrder.push("claude-start");
				await new Promise((r) => setTimeout(r, 10));
				callOrder.push("claude-end");
				return true;
			}),
			getTargetDir: vi.fn().mockReturnValue(null),
		};
		const codexDriver: AgentDriver = {
			detect: vi.fn().mockImplementation(async () => {
				callOrder.push("codex-start");
				await new Promise((r) => setTimeout(r, 10));
				callOrder.push("codex-end");
				return true;
			}),
			getTargetDir: vi.fn().mockReturnValue(null),
		};

		mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
		mockGetDriver.mockImplementation((id: AgentId) => {
			if (id === "claude") return claudeDriver;
			return codexDriver;
		});

		await detectAgents("/my/project");

		// Both should start before either ends (parallel execution)
		expect(callOrder.indexOf("codex-start")).toBeLessThan(
			callOrder.indexOf("claude-end"),
		);
	});

	it("treats individual detection failure as not detected", async () => {
		const claudeDriver = makeDriver(true);
		const codexDriver = makeDriver(new Error("detection failed"));

		mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
		mockGetDriver.mockImplementation((id: AgentId) => {
			if (id === "claude") return claudeDriver;
			return codexDriver;
		});

		const result = await detectAgents("/my/project");

		expect(result).toEqual(["claude"]);
	});

	it("returns empty array when all detections fail", async () => {
		const claudeDriver = makeDriver(new Error("claude error"));
		const codexDriver = makeDriver(new Error("codex error"));

		mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
		mockGetDriver.mockImplementation((id: AgentId) => {
			if (id === "claude") return claudeDriver;
			return codexDriver;
		});

		const result = await detectAgents("/my/project");

		expect(result).toEqual([]);
	});

	it("passes projectDir to each driver detect call", async () => {
		const claudeDriver = makeDriver(true);
		const codexDriver = makeDriver(false);

		mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
		mockGetDriver.mockImplementation((id: AgentId) => {
			if (id === "claude") return claudeDriver;
			return codexDriver;
		});

		await detectAgents("/my/project");

		expect(claudeDriver.detect).toHaveBeenCalledWith("/my/project");
		expect(codexDriver.detect).toHaveBeenCalledWith("/my/project");
	});

	it("returns empty array when no agents are registered", async () => {
		mockGetRegisteredAgentIds.mockReturnValue([]);

		const result = await detectAgents("/my/project");

		expect(result).toEqual([]);
	});
});
