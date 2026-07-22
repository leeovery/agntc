import { beforeEach, describe, expect, it, vi } from "vitest";

// This regression test deliberately does NOT mock copy-safety, so both clone
// entry points run against the REAL assertSubpathWithinClone via the single
// shared resolveGuardedSourceDir helper. It proves the singleton path
// (cloneAndReinstall) and the grouped path (processGroupUpdate/reinstallMember)
// reject the SAME escaping sourceSubpath pre-flight through that one helper — so
// a one-sided divergence (removing or weakening the guard at only one site)
// would fail here.

vi.mock("@clack/prompts", async () => {
	const { mockClack } = await import("./helpers/clack-mock.js");
	return mockClack();
});

vi.mock("../src/git-clone.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/git-clone.js")>()),
	cloneSource: vi.fn(),
	cleanupTempDir: vi.fn(),
}));

import { cloneAndReinstall } from "../src/clone-reinstall.js";
import { cleanupTempDir, cloneSource } from "../src/git-clone.js";
import type { ManifestEntry } from "../src/manifest.js";
import type { GroupTarget } from "../src/update-check.js";
import { type EntryGroup, processGroupUpdate } from "../src/update-groups.js";
import { makeEntry } from "./helpers/factories.js";

const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);

const CLONE_DIR = "/tmp/agntc-clone";
const REMOTE_SHA = "b".repeat(40);
// `../evil` resolves to /tmp/evil — a sibling of the clone dir, i.e. lexically
// outside the clone root — so the real guard must reject it at BOTH sites.
const ESCAPING_SUBPATH = "../evil";
const CONTAINMENT_MESSAGE = 'subpath "../evil" resolves outside the clone root';

beforeEach(() => {
	vi.clearAllMocks();
	mockCloneSource.mockResolvedValue({ tempDir: CLONE_DIR, commit: REMOTE_SHA });
	mockCleanupTempDir.mockResolvedValue(undefined);
});

describe("shared sourceSubpath containment guard — both clone entry points", () => {
	it("singleton path (cloneAndReinstall) rejects an escaping sourceSubpath pre-flight (clone-failed, install intact)", async () => {
		const entry = makeEntry({
			files: [".claude/skills/evil/"],
			sourceSubpath: ESCAPING_SUBPATH,
		});

		const result = await cloneAndReinstall({
			key: "owner/repo/evil",
			entry,
			projectDir: "/fake/project",
		});

		expect(result).toEqual({
			status: "failed",
			failureReason: "clone-failed",
			message: CONTAINMENT_MESSAGE,
		});
	});

	it("grouped path (processGroupUpdate) rejects the same escaping sourceSubpath pre-flight (failed member, siblings unaffected)", async () => {
		const member = {
			key: "owner/repo/evil",
			entry: makeEntry({
				ref: "main",
				commit: "a".repeat(40),
				files: [".claude/skills/evil/"],
				sourceSubpath: ESCAPING_SUBPATH,
			}),
		};
		const group: EntryGroup = {
			cloneUrl: "https://github.com/owner/repo.git",
			versionIntent: "main",
			constrained: false,
			members: [member],
		};
		const target: GroupTarget = {
			kind: "branch",
			resolvedSha: "d".repeat(40),
		};

		const { outcomes } = await processGroupUpdate(
			group,
			[member],
			target,
			"/fake/project",
		);

		expect(outcomes).toHaveLength(1);
		const outcome = outcomes[0]!;
		expect(outcome.status).toBe("failed");
		expect(outcome.summary).toBe(
			`owner/repo/evil: Failed — ${CONTAINMENT_MESSAGE}`,
		);
	});

	it("both entry points surface the identical containment error for the same escaping subpath", async () => {
		const singleton = await cloneAndReinstall({
			key: "owner/repo/evil",
			entry: makeEntry({
				files: [".claude/skills/evil/"],
				sourceSubpath: ESCAPING_SUBPATH,
			}),
			projectDir: "/fake/project",
		});

		const member = {
			key: "owner/repo/evil",
			entry: makeEntry({
				ref: "main",
				commit: "a".repeat(40),
				files: [".claude/skills/evil/"],
				sourceSubpath: ESCAPING_SUBPATH,
			}),
		};
		const { outcomes } = await processGroupUpdate(
			{
				cloneUrl: "https://github.com/owner/repo.git",
				versionIntent: "main",
				constrained: false,
				members: [member],
			},
			[member],
			{ kind: "branch", resolvedSha: "d".repeat(40) },
			"/fake/project",
		);

		const singletonMessage =
			singleton.status === "failed" ? singleton.message : "";
		expect(singletonMessage).toBe(CONTAINMENT_MESSAGE);
		expect(outcomes[0]!.summary).toContain(singletonMessage);
	});
});
