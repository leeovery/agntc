import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Manifest, ManifestEntry } from "../src/manifest.js";
import type { UpdateCheckResult } from "../src/update-check.js";

vi.mock("../src/update-check.js", () => ({
  checkForUpdate: vi.fn(),
}));

import { checkForUpdate } from "../src/update-check.js";
import { checkAllForUpdates } from "../src/update-check-all.js";

const mockCheckForUpdate = vi.mocked(checkForUpdate);

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    ref: null,
    commit: "a".repeat(40),
    installedAt: "2026-02-01T00:00:00.000Z",
    agents: ["claude"],
    files: [".claude/skills/test/"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("checkAllForUpdates", () => {
  it("returns empty map for empty manifest", async () => {
    const manifest: Manifest = {};

    const result = await checkAllForUpdates(manifest);

    expect(result).toEqual(new Map());
    expect(mockCheckForUpdate).not.toHaveBeenCalled();
  });

  it("returns single plugin check result", async () => {
    const entry = makeEntry();
    const manifest: Manifest = { "owner/repo": entry };
    const expected: UpdateCheckResult = { status: "up-to-date" };
    mockCheckForUpdate.mockResolvedValue(expected);

    const result = await checkAllForUpdates(manifest);

    expect(result).toEqual(new Map([["owner/repo", { status: "up-to-date" }]]));
    expect(mockCheckForUpdate).toHaveBeenCalledWith("owner/repo", entry);
  });

  it("checks multiple plugins in parallel", async () => {
    const entryA = makeEntry();
    const entryB = makeEntry();
    const manifest: Manifest = {
      "alice/skills": entryA,
      "bob/tools": entryB,
    };

    const callOrder: string[] = [];
    let resolveA!: (value: UpdateCheckResult) => void;
    let resolveB!: (value: UpdateCheckResult) => void;

    const promiseA = new Promise<UpdateCheckResult>((r) => {
      resolveA = r;
    });
    const promiseB = new Promise<UpdateCheckResult>((r) => {
      resolveB = r;
    });

    mockCheckForUpdate.mockImplementation(
      async (key: string, _entry: ManifestEntry) => {
        callOrder.push(`start:${key}`);
        if (key === "alice/skills") return promiseA;
        return promiseB;
      },
    );

    const resultPromise = checkAllForUpdates(manifest);

    // Both should have started before either resolves
    await vi.waitFor(() => {
      expect(callOrder).toEqual(["start:alice/skills", "start:bob/tools"]);
    });

    resolveB({ status: "up-to-date" });
    resolveA({ status: "update-available", remoteCommit: "b".repeat(40) });

    const result = await resultPromise;

    expect(result.get("alice/skills")).toEqual({
      status: "update-available",
      remoteCommit: "b".repeat(40),
    });
    expect(result.get("bob/tools")).toEqual({ status: "up-to-date" });
  });

  it("yields check-failed for individual failures without blocking others", async () => {
    const entryA = makeEntry();
    const entryB = makeEntry();
    const manifest: Manifest = {
      "alice/skills": entryA,
      "bob/tools": entryB,
    };

    mockCheckForUpdate.mockImplementation(
      async (key: string, _entry: ManifestEntry) => {
        if (key === "alice/skills") throw new Error("network timeout");
        return { status: "up-to-date" };
      },
    );

    const result = await checkAllForUpdates(manifest);

    expect(result.get("alice/skills")).toEqual({
      status: "check-failed",
      reason: "network timeout",
    });
    expect(result.get("bob/tools")).toEqual({ status: "up-to-date" });
  });

  it("returns local status for local plugin", async () => {
    const localEntry = makeEntry({ ref: null, commit: null });
    const manifest: Manifest = { "/path/to/local": localEntry };
    mockCheckForUpdate.mockResolvedValue({ status: "local" });

    const result = await checkAllForUpdates(manifest);

    expect(result.get("/path/to/local")).toEqual({ status: "local" });
  });

  it("handles mixed statuses correctly", async () => {
    const manifest: Manifest = {
      "alice/skills": makeEntry(),
      "bob/tools": makeEntry({ ref: "v1.0" }),
      "/local/plugin": makeEntry({ ref: null, commit: null }),
      "carol/lib": makeEntry(),
      "dave/broken": makeEntry(),
    };

    mockCheckForUpdate.mockImplementation(
      async (key: string, _entry: ManifestEntry) => {
        switch (key) {
          case "alice/skills":
            return {
              status: "update-available",
              remoteCommit: "b".repeat(40),
            };
          case "bob/tools":
            return { status: "newer-tags", tags: ["v2.0", "v3.0"] };
          case "/local/plugin":
            return { status: "local" };
          case "carol/lib":
            return { status: "up-to-date" };
          case "dave/broken":
            throw new Error("connection refused");
          default:
            throw new Error(`unexpected key: ${key}`);
        }
      },
    );

    const result = await checkAllForUpdates(manifest);

    expect(result.size).toBe(5);
    expect(result.get("alice/skills")).toEqual({
      status: "update-available",
      remoteCommit: "b".repeat(40),
    });
    expect(result.get("bob/tools")).toEqual({
      status: "newer-tags",
      tags: ["v2.0", "v3.0"],
    });
    expect(result.get("/local/plugin")).toEqual({ status: "local" });
    expect(result.get("carol/lib")).toEqual({ status: "up-to-date" });
    expect(result.get("dave/broken")).toEqual({
      status: "check-failed",
      reason: "connection refused",
    });
  });

  it("returns results for all plugins even when all fail", async () => {
    const manifest: Manifest = {
      "alice/skills": makeEntry(),
      "bob/tools": makeEntry(),
      "carol/lib": makeEntry(),
    };

    mockCheckForUpdate.mockRejectedValue(new Error("network down"));

    const result = await checkAllForUpdates(manifest);

    expect(result.size).toBe(3);
    for (const [, value] of result) {
      expect(value).toEqual({
        status: "check-failed",
        reason: "network down",
      });
    }
  });

  it("returns newer-tags for tag-pinned plugin", async () => {
    const tagEntry = makeEntry({ ref: "v1.0", commit: "c".repeat(40) });
    const manifest: Manifest = { "owner/repo": tagEntry };
    mockCheckForUpdate.mockResolvedValue({
      status: "newer-tags",
      tags: ["v2.0", "v3.0"],
    });

    const result = await checkAllForUpdates(manifest);

    expect(result.get("owner/repo")).toEqual({
      status: "newer-tags",
      tags: ["v2.0", "v3.0"],
    });
    expect(mockCheckForUpdate).toHaveBeenCalledWith("owner/repo", tagEntry);
  });

  it("converts non-Error throws to check-failed with stringified reason", async () => {
    const manifest: Manifest = { "owner/repo": makeEntry() };
    mockCheckForUpdate.mockRejectedValue("string error");

    const result = await checkAllForUpdates(manifest);

    expect(result.get("owner/repo")).toEqual({
      status: "check-failed",
      reason: "string error",
    });
  });
});
