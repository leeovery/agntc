import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
	select: vi.fn(),
	log: { warn: vi.fn() },
	isCancel: (value: unknown): value is symbol => typeof value === "symbol",
}));

vi.mock("node:fs/promises", () => ({
	access: vi.fn(),
}));

import { access } from "node:fs/promises";
import * as p from "@clack/prompts";
import { preCheck } from "../../src/init/pre-check.js";

const mockAccess = vi.mocked(access);
const mockSelect = vi.mocked(p.select);
const mockLogWarn = vi.mocked(p.log.warn);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("preCheck", () => {
	it("returns fresh when agntc.json does not exist", async () => {
		mockAccess.mockRejectedValue(new Error("ENOENT"));

		const result = await preCheck("/some/dir");

		expect(result).toEqual({ status: "fresh" });
	});

	it("displays warning when agntc.json exists", async () => {
		mockAccess.mockResolvedValue(undefined);
		mockSelect.mockResolvedValue("reconfigure");

		await preCheck("/some/dir");

		expect(mockLogWarn).toHaveBeenCalledWith(
			"This directory is already initialized.",
		);
	});

	it("returns reconfigure when user selects Reconfigure", async () => {
		mockAccess.mockResolvedValue(undefined);
		mockSelect.mockResolvedValue("reconfigure");

		const result = await preCheck("/some/dir");

		expect(result).toEqual({ status: "reconfigure" });
	});

	it("returns cancel when user selects Cancel", async () => {
		mockAccess.mockResolvedValue(undefined);
		mockSelect.mockResolvedValue("cancel");

		const result = await preCheck("/some/dir");

		expect(result).toEqual({ status: "cancel" });
	});

	it("returns cancel when user presses Ctrl+C", async () => {
		mockAccess.mockResolvedValue(undefined);
		mockSelect.mockResolvedValue(Symbol("cancel"));

		const result = await preCheck("/some/dir");

		expect(result).toEqual({ status: "cancel" });
	});

	it("triggers for empty agntc.json", async () => {
		mockAccess.mockResolvedValue(undefined);
		mockSelect.mockResolvedValue("reconfigure");

		const result = await preCheck("/some/dir");

		expect(mockLogWarn).toHaveBeenCalledWith(
			"This directory is already initialized.",
		);
		expect(result).toEqual({ status: "reconfigure" });
	});

	it("does not show prompts when agntc.json does not exist", async () => {
		mockAccess.mockRejectedValue(new Error("ENOENT"));

		await preCheck("/some/dir");

		expect(mockLogWarn).not.toHaveBeenCalled();
		expect(mockSelect).not.toHaveBeenCalled();
	});

	it("checks agntc.json at the given path", async () => {
		mockAccess.mockRejectedValue(new Error("ENOENT"));

		await preCheck("/my/project");

		expect(mockAccess).toHaveBeenCalledWith("/my/project/agntc.json");
	});

	it("presents Reconfigure and Cancel options via select", async () => {
		mockAccess.mockResolvedValue(undefined);
		mockSelect.mockResolvedValue("reconfigure");

		await preCheck("/some/dir");

		expect(mockSelect).toHaveBeenCalledOnce();
		const call = mockSelect.mock.calls[0]![0];
		const values = call.options.map((o: { value: string }) => o.value);
		expect(values).toEqual(["reconfigure", "cancel"]);
	});
});
