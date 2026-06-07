import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/fs-utils.js", () => ({
	validateLocalSourcePath: vi.fn(),
}));

import { prepareReinstall } from "../src/clone-reinstall.js";
import { validateLocalSourcePath } from "../src/fs-utils.js";
import { makeEntry } from "./helpers/factories.js";

const mockValidate = vi.mocked(validateLocalSourcePath);

beforeEach(() => {
	vi.clearAllMocks();
	mockValidate.mockResolvedValue({ valid: true });
});

describe("prepareReinstall", () => {
	describe("remote entry (commit !== null)", () => {
		it("returns ok with options that omit sourceDir and do not validate the path", async () => {
			const entry = makeEntry({ commit: "a".repeat(40) });

			const result = await prepareReinstall(
				"owner/repo",
				entry,
				"/fake/project",
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.options.key).toBe("owner/repo");
			expect(result.options.entry).toBe(entry);
			expect(result.options.projectDir).toBe("/fake/project");
			expect(result.options.sourceDir).toBeUndefined();
			expect(mockValidate).not.toHaveBeenCalled();
		});

		it("carries manifest, newRef and newCommit from opts", async () => {
			const entry = makeEntry({ commit: "a".repeat(40) });
			const manifest = { "owner/repo": entry };

			const result = await prepareReinstall(
				"owner/repo",
				entry,
				"/fake/project",
				{ manifest, newRef: "v2.0.0", newCommit: "b".repeat(40) },
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.options.manifest).toBe(manifest);
			expect(result.options.newRef).toBe("v2.0.0");
			expect(result.options.newCommit).toBe("b".repeat(40));
		});
	});

	describe("local entry (commit === null)", () => {
		it("validates the path and returns options carrying sourceDir: key", async () => {
			const key = "/Users/lee/Code/my-plugin";
			const entry = makeEntry({ commit: null, ref: null });

			const result = await prepareReinstall(key, entry, "/fake/project");

			expect(mockValidate).toHaveBeenCalledWith(key);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.options.sourceDir).toBe(key);
		});

		it("returns not-ok with the validation reason when the path is invalid", async () => {
			const key = "/Users/lee/Code/missing";
			const entry = makeEntry({ commit: null, ref: null });
			mockValidate.mockResolvedValue({
				valid: false,
				reason: "path does not exist",
			});

			const result = await prepareReinstall(key, entry, "/fake/project");

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("path does not exist");
		});
	});
});
