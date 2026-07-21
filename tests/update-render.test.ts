import { describe, expect, it } from "vitest";
import type { EntryGroup } from "../src/update-groups.js";
import { groupLabel } from "../src/update-render.js";
import { makeEntry } from "./helpers/factories.js";

function makeGroup(
	memberKeys: string[],
	versionIntent: string | null,
): EntryGroup {
	return {
		cloneUrl: "https://github.com/owner/repo.git",
		versionIntent,
		constrained:
			typeof versionIntent === "string" && versionIntent.startsWith("^"),
		members: memberKeys.map((key) => ({ key, entry: makeEntry() })),
	};
}

describe("groupLabel", () => {
	it("returns the bare owner/repo label when the repo has a single group", () => {
		const group = makeGroup(["owner/repo"], "^1.2.3");

		expect(groupLabel(group, [group])).toBe("owner/repo");
	});

	it("disambiguates two groups of one repo with @<constraint> and @<tag> intent suffixes", () => {
		const caret = makeGroup(["owner/repo/a"], "^1.2.3");
		const pin = makeGroup(["owner/repo/b"], "v2.0.0");
		const groups = [caret, pin];

		expect(groupLabel(caret, groups)).toBe("owner/repo@^1.2.3");
		expect(groupLabel(pin, groups)).toBe("owner/repo@v2.0.0");
	});

	it("uses the @HEAD sentinel for a HEAD-tracked group (versionIntent===null) in a multi-group repo", () => {
		const head = makeGroup(["owner/repo/a"], null);
		const pin = makeGroup(["owner/repo/b"], "v2.0.0");
		const groups = [head, pin];

		expect(groupLabel(head, groups)).toBe("owner/repo@HEAD");
	});

	it("renders @main for a branch group and @v2.0.0 for an exact-pin group when the repo is multi-group", () => {
		const branch = makeGroup(["owner/repo/a"], "main");
		const pin = makeGroup(["owner/repo/b"], "v2.0.0");
		const groups = [branch, pin];

		expect(groupLabel(branch, groups)).toBe("owner/repo@main");
		expect(groupLabel(pin, groups)).toBe("owner/repo@v2.0.0");
	});

	it("derives the same repo label for a standalone (owner/repo) and a collection member (owner/repo/member)", () => {
		const standalone = makeGroup(["owner/repo"], "^1.2.3");
		const collection = makeGroup(["owner/repo/member"], "^1.2.3");

		expect(groupLabel(standalone, [standalone])).toBe("owner/repo");
		expect(groupLabel(collection, [collection])).toBe("owner/repo");
	});
});
